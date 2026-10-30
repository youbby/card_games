import { cardToString } from '../core/cards';
import { createRng, pick, randomSeed } from '../core/rng';
import { db, newId } from '../data/db';
import { HAND_HISTORY_LIMIT, type HandRecord } from '../data/types';
import { reachedProfitLimit, type HouseGameId } from '../games/catalog';
import { actBlackjack, makeShoe, playBaccarat, startBlackjack } from '../games/house/engine';
import {
  isRoundOpen,
  type BaccaratBet,
  type BlackjackAction,
  type HouseRoom,
  type HouseRound,
} from '../games/house/types';
import type { CpuClass } from '../games/holdem/ai/types';
import { PLAYER_BANKRUPT_THRESHOLD, stakeById, type StakeId } from '../games/holdem/stakes';
import { bumpBucket, emptyStats, getSettings } from './characters';

const tables = [db.rooms, db.characters, db.stats, db.hands, db.sessions, db.settings];

const BET_UNIT = 20;
/** A fresh shoe is shuffled before a round when fewer cards than this remain. */
const RESHUFFLE_BELOW = 80;

const BACCARAT_LABELS: Record<BaccaratBet, string> = { player: '플레이어', banker: '뱅커', tie: '무승부' };

export const houseLimitReached = (room: HouseRoom) =>
  reachedProfitLimit(room.balance, room.initialBuyIn, room.initialBuyIn, room.profitMultiplier);

export function houseBetLimits(room: HouseRoom) {
  const unit = Math.max(BET_UNIT, Math.ceil(stakeById(room.stakeId).bb / BET_UNIT) * BET_UNIT);
  return { min: Math.min(unit, room.balance), max: Math.min(unit * 20, room.balance), unit };
}

export async function openHouseRoom(input: {
  playerId: string;
  gameId: HouseGameId;
  cpuClass: CpuClass;
  stakeId: StakeId;
  buyIn: number;
}): Promise<HouseRoom> {
  const stake = stakeById(input.stakeId);
  if (!['blackjack', 'baccarat'].includes(input.gameId) || !stake.classes.includes(input.cpuClass)) {
    throw new Error('입장할 수 없는 방입니다.');
  }
  if (!Number.isSafeInteger(input.buyIn) || input.buyIn < stake.minBuyIn || input.buyIn > stake.maxBuyIn) {
    throw new Error('입장금 범위를 확인하세요.');
  }

  return db.transaction('rw', tables, async () => {
    const busy =
      (await db.sessions.where('active').equals(1).count()) || (await db.rooms.where('active').equals(1).count());
    if (busy) throw new Error('먼저 진행 중인 게임에서 나와 주세요.');

    const player = await db.characters.get(input.playerId);
    if (!player || player.kind !== 'PLAYER' || player.status !== 'ACTIVE' || player.balance < input.buyIn) {
      throw new Error('입장할 칩이 부족합니다.');
    }
    const dealers = await db.characters
      .where('cpuClass')
      .equals(input.cpuClass)
      .filter((c) => c.kind === 'CPU' && c.status === 'ACTIVE')
      .toArray();
    if (!dealers.length) throw new Error('대기 중인 딜러가 없습니다.');

    const rng = createRng(randomSeed());
    const dealer = pick(dealers, rng);
    const settings = await getSettings();
    const room: HouseRoom = {
      id: newId(),
      playerId: input.playerId,
      gameId: input.gameId,
      cpuClass: input.cpuClass,
      stakeId: input.stakeId,
      dealer: { id: dealer.id, name: dealer.name, avatar: dealer.avatar },
      initialBuyIn: input.buyIn,
      balance: input.buyIn,
      profitMultiplier: settings.profitLimits[input.gameId],
      active: 1,
      roundsPlayed: 0,
      startedAt: Date.now(),
      round: null,
      deck: makeShoe(rng),
    };

    await db.characters.update(player.id, { balance: player.balance - input.buyIn, lastPlayedAt: Date.now() });
    const stats = (await db.stats.get(player.id)) ?? emptyStats(player.id);
    await db.stats.put({ ...stats, sessions: stats.sessions + 1 });
    await db.rooms.add(room);
    return room;
  });
}

function describeRound(round: HouseRound, abandoned: boolean): string[] {
  if (round.kind === 'baccarat') {
    return [`베팅: ${BACCARAT_LABELS[round.choice]} · 결과: ${BACCARAT_LABELS[round.winner]}`];
  }
  const lines = round.hands.map((hand, i) => `${i + 1}번 핸드: ${abandoned ? '중단' : hand.result} · 베팅 ${hand.bet}`);
  if (round.insurance) {
    lines.push(`보험 ${round.insurance}: ${abandoned ? '중단' : round.insurancePayout ? '적중' : '미적중'}`);
  }
  return lines;
}

/** Saves the finished (or abandoned) round to history and stats. Runs inside a room transaction. */
async function recordRound(room: HouseRoom, abandoned = false): Promise<void> {
  const round = room.round!;
  const net = room.balance - round.startBalance;
  const mine = round.kind === 'blackjack' ? round.hands.flatMap((hand) => hand.cards) : round.player;

  const record: HandRecord = {
    id: `${room.id}:${room.roundsPlayed}`,
    gameId: room.gameId,
    playerId: room.playerId,
    sessionId: room.id,
    playedAt: Date.now(),
    seed: 0,
    cpuClass: room.cpuClass,
    stakeId: room.stakeId,
    seatCount: 2,
    position: '플레이어',
    holeCards: mine.map(cardToString),
    board: abandoned ? [] : round.dealer.map(cardToString),
    opponents: [{ name: room.dealer.name, cpuClass: room.cpuClass }],
    actions: describeRound(round, abandoned),
    potTotal: round.totalBet,
    net,
    wentToShowdown: false,
    won: net > 0,
    vpip: false,
    pfr: false,
    abandoned,
  };
  await db.hands.add(record);

  const history = await db.hands
    .where('[playerId+playedAt]')
    .between([room.playerId, 0], [room.playerId, Infinity])
    .primaryKeys();
  if (history.length > HAND_HISTORY_LIMIT) {
    await db.hands.bulkDelete(history.slice(0, history.length - HAND_HISTORY_LIMIT));
  }

  const stats = (await db.stats.get(room.playerId)) ?? emptyStats(room.playerId);
  const byGame = { ...stats.byGame };
  bumpBucket(byGame, room.gameId, net);
  await db.stats.put({
    ...stats,
    handsPlayed: stats.handsPlayed + 1,
    handsWon: stats.handsWon + (net > 0 ? 1 : 0),
    netProfit: stats.netProfit + net,
    biggestPotWon: Math.max(stats.biggestPotWon, net > 0 ? round.totalBet + net : 0),
    biggestLoss: Math.max(stats.biggestLoss, -net),
    byGame,
  });

  const player = await db.characters.get(room.playerId);
  if (player) {
    await db.characters.update(player.id, { peakBalance: Math.max(player.peakBalance, player.balance + room.balance) });
  }
}

/** Stores the round on the room, recording it when it is over. */
async function saveRound(room: HouseRoom, round: HouseRound): Promise<HouseRoom> {
  room.round = round;
  room.balance = round.balance;
  if (round.phase === 'done') {
    room.deck = round.deck;
    await recordRound(room);
  }
  await db.rooms.put(room);
  return room;
}

export async function betHouse(roomId: string, bet: number, choice: BaccaratBet = 'player'): Promise<HouseRoom> {
  return db.transaction('rw', tables, async () => {
    const room = await db.rooms.get(roomId);
    if (!room?.active || isRoundOpen(room.round)) throw new Error('진행 중인 판을 마쳐 주세요.');
    if (houseLimitReached(room)) throw new Error('이번 방의 수익 목표를 달성했습니다. 정산 후 다시 입장해 주세요.');

    const limits = houseBetLimits(room);
    const allIn = bet === room.balance;
    if (!Number.isSafeInteger(bet) || bet < limits.min || bet > limits.max || (bet % BET_UNIT !== 0 && !allIn)) {
      throw new Error('베팅은 20칩 단위이며, 남은 칩 전액을 베팅할 수도 있습니다.');
    }

    if (room.deck.length < RESHUFFLE_BELOW) room.deck = makeShoe(createRng(randomSeed()));
    const round =
      room.gameId === 'blackjack'
        ? startBlackjack(room.deck, room.balance, bet)
        : playBaccarat(room.deck, room.balance, bet, choice);
    room.roundsPlayed++;
    return saveRound(room, round);
  });
}

export async function actHouse(roomId: string, action: BlackjackAction): Promise<HouseRoom> {
  return db.transaction('rw', tables, async () => {
    const room = await db.rooms.get(roomId);
    if (!room?.active || !isRoundOpen(room.round)) throw new Error('진행 중인 블랙잭이 없습니다.');
    return saveRound(room, actBlackjack(room.round, action));
  });
}

export interface HouseCloseResult {
  cashOut: number;
  bankrupt: boolean;
  /** Chips already wagered on the unfinished round, now lost. */
  abandonedLoss: number;
}

/** Leaves the room. A round still in progress is recorded as lost. */
export async function closeHouseRoom(roomId: string): Promise<HouseCloseResult> {
  return db.transaction('rw', tables, async () => {
    const room = await db.rooms.get(roomId);
    if (!room) throw new Error('방을 찾을 수 없습니다.');
    const player = await db.characters.get(room.playerId);
    if (!player) throw new Error('캐릭터를 찾을 수 없습니다.');
    if (!room.active) return { cashOut: room.balance, bankrupt: player.status === 'BANKRUPT', abandonedLoss: 0 };

    let abandonedLoss = 0;
    if (isRoundOpen(room.round)) {
      abandonedLoss = room.round.totalBet;
      await recordRound(room, true);
    }

    const balance = player.balance + room.balance;
    const bankrupt = balance < PLAYER_BANKRUPT_THRESHOLD;
    await db.characters.update(player.id, {
      balance,
      peakBalance: Math.max(player.peakBalance, balance),
      status: bankrupt ? 'BANKRUPT' : 'ACTIVE',
      bankruptAt: bankrupt ? Date.now() : undefined,
    });
    await db.rooms.update(room.id, { active: 0, endedAt: Date.now() });
    const stats = (await db.stats.get(player.id)) ?? emptyStats(player.id);
    await db.stats.put({ ...stats, playTimeMs: stats.playTimeMs + Date.now() - room.startedAt });
    return { cashOut: room.balance, bankrupt, abandonedLoss };
  });
}

export async function recoverHouseRooms(): Promise<number> {
  const rooms = await db.rooms.where('active').equals(1).toArray();
  for (const room of rooms) await closeHouseRoom(room.id);
  return rooms.length;
}
