import { cardToString } from '../core/cards';
import { createRng, randomSeed, type Rng } from '../core/rng';
import { db, newId } from '../data/db';
import {
  type Character,
  HAND_HISTORY_LIMIT,
  type HandRecord,
  type InProgressHand,
  type SeatRecord,
  type Stats,
  type TableSession,
} from '../data/types';
import { emptyOpponentModel, type CpuClass, type OpponentModel } from '../games/holdem/ai/types';
import { didPfr, didVpip, potTotal } from '../games/holdem/engine';
import { positionName } from '../games/holdem/positions';
import {
  cpuBankruptThreshold,
  MAX_SEATS,
  MIN_SEATS,
  PLAYER_BANKRUPT_THRESHOLD,
  type StakeId,
  stakeById,
  stakesForClass,
} from '../games/holdem/stakes';
import type { HandState } from '../games/holdem/types';
import { bumpBucket, emptyStats, getSettings } from './characters';
import { reachedProfitLimit, type PokerGameId } from '../games/catalog';
import { cpuBuyIn, deleteCpu, eligibleCpus, ensurePool } from './cpuPool';

const ALL_TABLES = [db.characters, db.sessions, db.hands, db.stats, db.settings, db.rooms];

function seatFor(c: Character, stack: number): SeatRecord {
  return {
    characterId: c.id,
    name: c.name,
    avatar: c.avatar,
    kind: c.kind,
    cpuClass: c.cpuClass,
    buyInTotal: stack,
    stack,
  };
}

export async function getActiveSession(): Promise<TableSession | undefined> {
  return db.sessions.where('active').equals(1).first();
}

export interface StartSessionInput {
  gameId?: PokerGameId;
  playerId: string;
  cpuClass: CpuClass;
  seatCount: number;
  stakeId: StakeId;
  buyIn: number;
  opponentIds: string[];
  rng?: Rng;
}

/** Buys everyone in and opens the table. The player sits in seat 0. */
export async function startSession(input: StartSessionInput): Promise<TableSession> {
  const { playerId, cpuClass, seatCount, stakeId, buyIn, opponentIds } = input;
  const rng = input.rng ?? createRng(randomSeed());
  if (input.gameId && !['holdem', 'draw'].includes(input.gameId)) throw new Error('지원하지 않는 포커 게임입니다.');
  const stake = stakeById(stakeId);
  if (!stake.classes.includes(cpuClass)) throw new Error('이 클래스에서 선택할 수 없는 블라인드입니다.');
  if (seatCount < MIN_SEATS || seatCount > MAX_SEATS) throw new Error('인원은 2~6명입니다.');
  if (opponentIds.length !== seatCount - 1) throw new Error('상대 인원이 맞지 않습니다.');
  if (buyIn < stake.minBuyIn || buyIn > stake.maxBuyIn) throw new Error('바이인 금액이 범위를 벗어났습니다.');

  return db.transaction('rw', ALL_TABLES, async () => {
    if ((await getActiveSession()) || (await db.rooms.where('active').equals(1).count()))
      throw new Error('이미 진행 중인 게임이 있습니다.');
    const player = await db.characters.get(playerId);
    if (!player || player.kind !== 'PLAYER') throw new Error('캐릭터를 찾을 수 없습니다.');
    if (player.status !== 'ACTIVE') throw new Error('파산한 캐릭터는 플레이할 수 없습니다.');
    if (player.balance < buyIn) throw new Error('잔액이 부족합니다.');

    const seats: (SeatRecord | null)[] = [seatFor(player, buyIn)];
    await db.characters.update(player.id, { balance: player.balance - buyIn, lastPlayedAt: Date.now() });

    for (const id of opponentIds) {
      const cpu = await db.characters.get(id);
      if (!cpu || cpu.kind !== 'CPU' || cpu.cpuClass !== cpuClass || cpu.balance < stake.minBuyIn) {
        throw new Error('참가할 수 없는 상대가 있습니다. 다시 뽑아 주세요.');
      }
      const amount = cpuBuyIn(cpu, stake, rng);
      await db.characters.update(cpu.id, { balance: cpu.balance - amount });
      seats.push(seatFor(cpu, amount));
    }

    const stats = (await db.stats.get(player.id)) ?? emptyStats(player.id);
    await db.stats.put({ ...stats, sessions: stats.sessions + 1 });

    const session: TableSession = {
      id: newId(),
      playerId,
      gameId: input.gameId ?? 'holdem',
      initialBuyIn: buyIn,
      profitMultiplier: (await getSettings()).profitLimits[input.gameId ?? 'holdem'],
      cpuClass,
      seatCount,
      stakeId,
      sb: stake.sb,
      bb: stake.bb,
      seats,
      button: -1,
      active: 1,
      startedAt: Date.now(),
      handsPlayed: 0,
      opponentModel: emptyOpponentModel(),
    };
    await db.sessions.add(session);
    return session;
  });
}

export async function saveInProgress(sessionId: string, hand: InProgressHand | undefined): Promise<void> {
  await db.sessions.update(sessionId, { inProgressHand: hand });
}

/** Seats taking part in the next hand, in seat order. */
export function seatsInPlay(session: TableSession): { seat: number; record: SeatRecord }[] {
  return session.seats.flatMap((record, seat) => (record && record.stack > 0 ? [{ seat, record }] : []));
}

/** Next occupied seat (with chips) clockwise from the previous button. */
export function nextButton(session: TableSession): number {
  const inPlay = seatsInPlay(session).map((s) => s.seat);
  const after = inPlay.find((s) => s > session.button);
  return after ?? inPlay[0];
}

function updateOpponentModel(model: OpponentModel, hand: HandState, human: number): OpponentModel {
  const next = { ...model, hands: model.hands + 1 };
  if (didVpip(hand, human)) next.vpip++;
  let betPending = false;
  let street = '';
  for (const a of hand.actions) {
    if (a.street !== street) {
      street = a.street;
      betPending = false;
    }
    if (a.street === 'PREFLOP') continue;
    if (a.player === human) {
      if (betPending) {
        next.betsFaced++;
        if (a.kind === 'fold') next.foldsToBet++;
      }
      betPending = false;
    } else if (a.kind === 'bet' || a.kind === 'raise') {
      betPending = true;
    }
  }
  return next;
}

export interface RecordHandInput {
  session: TableSession;
  hand: HandState;
  /** Seat index (in session.seats) for each player index in `hand`. */
  seatOfPlayer: number[];
  seed: number;
}

/** Persists a finished hand: stacks, history, stats and the opponent model, atomically. */
export async function recordHand({ session, hand, seatOfPlayer, seed }: RecordHandInput): Promise<TableSession> {
  const result = hand.result;
  if (!result) throw new Error('아직 끝나지 않은 핸드입니다.');
  const human = seatOfPlayer.indexOf(0);

  return db.transaction('rw', ALL_TABLES, async () => {
    const seats = session.seats.map((s) => (s ? { ...s } : null));
    hand.players.forEach((p, i) => {
      seats[seatOfPlayer[i]]!.stack = p.stack;
    });
    const next: TableSession = {
      ...session,
      seats,
      button: seatOfPlayer[hand.button],
      handsPlayed: session.handsPlayed + 1,
      inProgressHand: undefined,
      opponentModel: human >= 0 ? updateOpponentModel(session.opponentModel, hand, human) : session.opponentModel,
    };
    await db.sessions.put(next);

    // CPU stats (kept light).
    for (let i = 0; i < hand.players.length; i++) {
      if (i === human) continue;
      const id = hand.players[i].id;
      const s = (await db.stats.get(id)) ?? emptyStats(id);
      const net = result.net[i];
      await db.stats.put({
        ...s,
        handsPlayed: s.handsPlayed + 1,
        handsWon: s.handsWon + (net > 0 ? 1 : 0),
        netProfit: s.netProfit + net,
        showdowns: s.showdowns + (result.showdown && !hand.players[i].folded ? 1 : 0),
        showdownsWon: s.showdownsWon + (result.showdown && net > 0 ? 1 : 0),
      });
    }

    if (human < 0) return next;
    const me = hand.players[human];
    const net = result.net[human];
    const myHand = result.hands[human];
    const wentToShowdown = result.showdown && !me.folded;
    const record: HandRecord = {
      gameId: session.gameId,
      id: newId(),
      playerId: session.playerId,
      sessionId: session.id,
      playedAt: Date.now(),
      seed,
      cpuClass: session.cpuClass,
      stakeId: session.stakeId,
      seatCount: hand.players.length,
      position: positionName(hand.players.length, human, hand.button),
      holeCards: me.hole.map(cardToString),
      board: hand.board.map(cardToString),
      opponents: hand.players.flatMap((p, i) =>
        i === human ? [] : [{ name: p.name, cpuClass: seats[seatOfPlayer[i]]?.cpuClass }],
      ),
      actions: hand.actions.map((a) => `${a.street}:${hand.players[a.player].name}:${a.kind}:${a.to}`),
      potTotal: potTotal(hand),
      net,
      wentToShowdown,
      won: net > 0,
      bestHand: wentToShowdown && myHand ? { category: myHand.category, name: myHand.name } : undefined,
      vpip: session.gameId === 'holdem' && didVpip(hand, human),
      pfr: session.gameId === 'holdem' && didPfr(hand, human),
      abandoned: false,
    };
    await db.hands.add(record);
    await trimHistory(session.playerId);

    const s: Stats = (await db.stats.get(session.playerId)) ?? emptyStats(session.playerId);
    const updated: Stats = {
      ...s,
      handsPlayed: s.handsPlayed + 1,
      handsWon: s.handsWon + (net > 0 ? 1 : 0),
      netProfit: s.netProfit + net,
      biggestPotWon: net > 0 ? Math.max(s.biggestPotWon, record.potTotal) : s.biggestPotWon,
      biggestLoss: Math.max(s.biggestLoss, -net),
      showdowns: s.showdowns + (wentToShowdown ? 1 : 0),
      showdownsWon: s.showdownsWon + (wentToShowdown && net > 0 ? 1 : 0),
      vpipCount: s.vpipCount + (record.vpip ? 1 : 0),
      pfrCount: s.pfrCount + (record.pfr ? 1 : 0),
      byClass: { ...s.byClass },
      byStake: { ...s.byStake },
      bySeatCount: { ...s.bySeatCount },
      byGame: { ...s.byGame },
    };
    bumpBucket(updated.byClass, session.cpuClass, net);
    bumpBucket(updated.byStake, session.stakeId, net);
    bumpBucket(updated.bySeatCount, String(hand.players.length), net);
    bumpBucket(updated.byGame!, session.gameId, net);
    if (wentToShowdown && myHand && (!s.bestHand || myHand.score > s.bestHand.score)) {
      updated.bestHand = {
        category: myHand.category,
        score: myHand.score,
        name: myHand.name,
        cards: myHand.best.map(cardToString),
        at: Date.now(),
      };
    }
    await db.stats.put(updated);

    const player = await db.characters.get(session.playerId);
    if (player) {
      const total = player.balance + seats[0]!.stack;
      if (total > player.peakBalance) await db.characters.update(player.id, { peakBalance: total });
    }
    return next;
  });
}

async function trimHistory(playerId: string) {
  const count = await db.hands.where('playerId').equals(playerId).count();
  if (count <= HAND_HISTORY_LIMIT) return;
  const oldest = await db.hands
    .where('[playerId+playedAt]')
    .between([playerId, 0], [playerId, Infinity])
    .limit(count - HAND_HISTORY_LIMIT)
    .primaryKeys();
  await db.hands.bulkDelete(oldest);
}

export async function rebuyPlayer(session: TableSession, amount: number): Promise<TableSession> {
  const stake = stakeById(session.stakeId);
  return db.transaction('rw', db.characters, db.sessions, async () => {
    const player = await db.characters.get(session.playerId);
    const seat = session.seats[0]!;
    if (
      reachedProfitLimit(seat.stack, session.initialBuyIn ?? seat.buyInTotal, seat.buyInTotal, session.profitMultiplier)
    )
      throw new Error('수익 목표를 달성했습니다. 정산 후 다시 입장해 주세요.');
    if (!player) throw new Error('캐릭터를 찾을 수 없습니다.');
    if (amount < stake.minBuyIn || amount > player.balance || seat.stack + amount > stake.maxBuyIn) {
      throw new Error('리바이 금액이 올바르지 않습니다.');
    }
    await db.characters.update(player.id, { balance: player.balance - amount });
    const seats = [...session.seats];
    seats[0] = { ...seat, stack: seat.stack + amount, buyInTotal: seat.buyInTotal + amount };
    const next = { ...session, seats };
    await db.sessions.put(next);
    return next;
  });
}

export type TableNotice =
  | { type: 'rebuy'; name: string; amount: number }
  | { type: 'bankrupt'; name: string }
  | { type: 'join'; name: string }
  | { type: 'leave'; name: string };

/**
 * Between hands: busted CPUs rebuy from their wallet (any amount) or, with an
 * empty wallet, go bankrupt and are deleted. Empty seats are refilled from the
 * class pool so the table keeps the chosen size when possible.
 */
export async function maintainCpuSeats(
  session: TableSession,
  rng: Rng = createRng(randomSeed()),
): Promise<{ session: TableSession; notices: TableNotice[] }> {
  const stake = stakeById(session.stakeId);
  const notices: TableNotice[] = [];
  const seats = session.seats.map((s) => (s ? { ...s } : null));
  const bankruptIds: string[] = [];

  await db.transaction('rw', db.characters, db.sessions, async () => {
    for (let i = 1; i < seats.length; i++) {
      const seat = seats[i];
      if (!seat || seat.stack > 0) continue;
      const cpu = await db.characters.get(seat.characterId);
      if (cpu && cpu.balance > 0) {
        const amount = Math.min(cpu.balance, cpuBuyIn({ ...cpu, balance: Infinity }, stake, rng));
        await db.characters.update(cpu.id, { balance: cpu.balance - amount });
        seat.stack = amount;
        seat.buyInTotal += amount;
        notices.push({ type: 'rebuy', name: seat.name, amount });
      } else {
        bankruptIds.push(seat.characterId);
        notices.push({ type: 'bankrupt', name: seat.name });
        seats[i] = null;
      }
    }
  });
  for (const id of bankruptIds) await deleteCpu(id);
  if (bankruptIds.length) await ensurePool(rng);

  await db.transaction('rw', db.characters, db.sessions, async () => {
    const seatedIds = seats.flatMap((s) => (s ? [s.characterId] : []));
    const candidates = await eligibleCpus(session.cpuClass, stake, seatedIds);
    for (let i = 1; i < session.seatCount; i++) {
      if (seats[i] || candidates.length === 0) continue;
      const cpu = candidates.splice(rng.int(candidates.length), 1)[0];
      const amount = cpuBuyIn(cpu, stake, rng);
      await db.characters.update(cpu.id, { balance: cpu.balance - amount });
      seats[i] = seatFor(cpu, amount);
      notices.push({ type: 'join', name: cpu.name });
    }
    await db.sessions.update(session.id, { seats });
  });

  return { session: { ...session, seats }, notices };
}

/** Settles an unfinished hand as a fold by the player; their chips in the pot go to the CPUs who contributed. */
function settleAbandoned(session: TableSession, hand: InProgressHand): { seats: (SeatRecord | null)[]; lost: number } {
  const seats = session.seats.map((s) => (s ? { ...s } : null));
  const playerId = session.playerId;
  const lost = hand.committed[playerId] ?? 0;
  const cpuIds = Object.keys(hand.startStacks).filter((id) => id !== playerId);
  const cpuCommitted = cpuIds.reduce((sum, id) => sum + (hand.committed[id] ?? 0), 0);

  let remaining = lost;
  cpuIds.forEach((id, k) => {
    const seat = seats.find((s) => s?.characterId === id);
    if (!seat) return;
    const share =
      k === cpuIds.length - 1
        ? remaining
        : Math.floor(lost * (cpuCommitted > 0 ? (hand.committed[id] ?? 0) / cpuCommitted : 1 / cpuIds.length));
    remaining -= share;
    seat.stack = hand.startStacks[id] + share;
  });
  if (seats[0] && hand.startStacks[playerId] !== undefined) seats[0].stack = hand.startStacks[playerId] - lost;
  return { seats, lost };
}

export interface EndSessionResult {
  playerBankrupt: boolean;
  cashOut: number;
  abandonedLoss: number;
}

/**
 * Leaves the table: settles any unfinished hand as a fold, cashes everyone out,
 * then applies bankruptcy (player locked, CPUs deleted) and refills the pool.
 */
export async function endSession(sessionId: string, latestHand?: InProgressHand): Promise<EndSessionResult> {
  const outcome = await db.transaction('rw', ALL_TABLES, async () => {
    const session = await db.sessions.get(sessionId);
    if (!session || !session.active) throw new Error('진행 중인 게임이 없습니다.');
    const unfinished = latestHand ?? session.inProgressHand;

    let seats = session.seats;
    let abandonedLoss = 0;
    if (unfinished) {
      const settled = settleAbandoned(session, unfinished);
      seats = settled.seats;
      abandonedLoss = settled.lost;
      await recordAbandoned(session, unfinished, abandonedLoss);
    }

    const cpuIds: string[] = [];
    let cashOut = 0;
    for (const seat of seats) {
      if (!seat) continue;
      const c = await db.characters.get(seat.characterId);
      if (!c) continue;
      await db.characters.update(c.id, { balance: c.balance + seat.stack, lastPlayedAt: Date.now() });
      if (c.kind === 'CPU') cpuIds.push(c.id);
      else cashOut = seat.stack;
    }

    const endedAt = Date.now();
    await db.sessions.put({ ...session, seats, active: 0, endedAt, inProgressHand: undefined });
    const stats = (await db.stats.get(session.playerId)) ?? emptyStats(session.playerId);
    await db.stats.put({ ...stats, playTimeMs: stats.playTimeMs + (endedAt - session.startedAt) });

    const player = await db.characters.get(session.playerId);
    let playerBankrupt = false;
    if (player && player.balance < PLAYER_BANKRUPT_THRESHOLD) {
      await db.characters.update(player.id, { status: 'BANKRUPT', bankruptAt: endedAt });
      playerBankrupt = true;
    }

    const bankruptCpus: string[] = [];
    for (const id of cpuIds) {
      const cpu = await db.characters.get(id);
      if (cpu?.cpuClass && cpu.balance < cpuBankruptThreshold(cpu.cpuClass)) bankruptCpus.push(id);
    }
    return { playerBankrupt, cashOut, abandonedLoss, bankruptCpus };
  });

  for (const id of outcome.bankruptCpus) await deleteCpu(id);
  await ensurePool();
  return { playerBankrupt: outcome.playerBankrupt, cashOut: outcome.cashOut, abandonedLoss: outcome.abandonedLoss };
}

async function recordAbandoned(session: TableSession, hand: InProgressHand, lost: number) {
  const record: HandRecord = {
    gameId: session.gameId,
    id: newId(),
    playerId: session.playerId,
    sessionId: session.id,
    playedAt: Date.now(),
    seed: hand.seed,
    cpuClass: session.cpuClass,
    stakeId: session.stakeId,
    seatCount: Object.keys(hand.startStacks).length,
    position: '-',
    holeCards: [],
    board: [],
    opponents: session.seats.slice(1).flatMap((s) => (s ? [{ name: s.name, cpuClass: s.cpuClass }] : [])),
    actions: [],
    potTotal: Object.values(hand.committed).reduce((a, b) => a + b, 0),
    net: -lost,
    wentToShowdown: false,
    won: false,
    vpip: false,
    pfr: false,
    abandoned: true,
  };
  await db.hands.add(record);
  const s = (await db.stats.get(session.playerId)) ?? emptyStats(session.playerId);
  const byClass = { ...s.byClass };
  const byStake = { ...s.byStake };
  const byGame = { ...s.byGame };
  bumpBucket(byClass, session.cpuClass, -lost);
  bumpBucket(byStake, session.stakeId, -lost);
  bumpBucket(byGame, session.gameId, -lost);
  await db.stats.put({
    ...s,
    handsPlayed: s.handsPlayed + 1,
    netProfit: s.netProfit - lost,
    biggestLoss: Math.max(s.biggestLoss, lost),
    byClass,
    byStake,
    byGame,
  });
}

/** App start: close any table left open by a crash or force-quit. */
export async function recoverOpenSessions(): Promise<EndSessionResult | null> {
  const open = await getActiveSession();
  return open ? endSession(open.id) : null;
}

/** On app start: lock players who can no longer afford any table. */
export async function sweepBankruptPlayers(): Promise<void> {
  const players = await db.characters.where('kind').equals('PLAYER').toArray();
  for (const p of players) {
    if (p.status === 'ACTIVE' && p.balance < PLAYER_BANKRUPT_THRESHOLD) {
      await db.characters.update(p.id, { status: 'BANKRUPT', bankruptAt: Date.now() });
    }
  }
}

export interface SetupAvailability {
  /** Number of CPUs that can afford this stake. */
  eligibleCpus: number;
  canAfford: boolean;
  allowed: boolean;
}

export async function stakeAvailability(cls: CpuClass, balance: number): Promise<Record<StakeId, SetupAvailability>> {
  const out = {} as Record<StakeId, SetupAvailability>;
  for (const stake of stakesForClass(cls)) {
    const eligible = (await eligibleCpus(cls, stake)).length;
    const canAfford = balance >= stake.minBuyIn;
    out[stake.id] = { eligibleCpus: eligible, canAfford, allowed: canAfford && eligible > 0 };
  }
  return out;
}
