import 'fake-indexeddb/auto';
import Dexie from 'dexie';
import { beforeEach, describe, expect, it } from 'vitest';
import { cardsFromString, fullDeck } from '../core/cards';
import { backfillGameWins, CardGamesDb, db } from '../data/db';
import type { HandRecord, Stats } from '../data/types';
import { profitTarget, reachedProfitLimit } from '../games/catalog';
import { createPlayer, getSettings, updateProfitLimit } from './characters';
import { factoryReset } from './factoryReset';
import { actHouse, betHouse, closeHouseRoom, openHouseRoom, recoverHouseRooms } from './house';
import { listCpus, pickOpponents } from './cpuPool';
import { stakeById } from '../games/holdem/stakes';
import { endSession, startSession } from './session';
import { TableRunner } from './tableRunner';

beforeEach(async () => {
  await factoryReset();
});
async function room(gameId: 'blackjack' | 'baccarat' = 'blackjack', buyIn = 1000) {
  const player = await createPlayer('테스트');
  const value = await openHouseRoom({ playerId: player.id, gameId, buyIn, cpuClass: 'LOW', stakeId: 'ENTRY' });
  return { player, room: value };
}
async function rig(id: string, sequence: string) {
  await db.rooms.update(id, { deck: [...fullDeck(), ...fullDeck(), ...cardsFromString(sequence).reverse()] });
}
describe('per-game profit limits', () => {
  it('uses net profit and accepts the exact boundary and overrun', () => {
    expect(profitTarget(1000, 1000, 5)).toBe(6000);
    expect(reachedProfitLimit(5999, 1000, 1000, 5)).toBe(false);
    expect(reachedProfitLimit(6000, 1000, 1000, 5)).toBe(true);
    expect(reachedProfitLimit(9000, 1000, 1000, 5)).toBe(true);
    expect(reachedProfitLimit(999999, 1000, 1000, null)).toBe(false);
    expect(profitTarget(1000, 2000, 5)).toBe(7000); // Additional deposits are not winnings.
  });
  it('persists independent settings and serializes simultaneous changes', async () => {
    await Promise.all([updateProfitLimit('blackjack', 3), updateProfitLimit('baccarat', null)]);
    const settings = await getSettings();
    expect(settings.profitLimits).toEqual({ holdem: 5, draw: 5, blackjack: 3, baccarat: null });
    await expect(updateProfitLimit('draw', -1)).rejects.toThrow();
  });
  it('pays the entire last winning round, blocks another round, and permits fresh re-entry', async () => {
    await updateProfitLimit('baccarat', 1);
    const { player, room: initial } = await room('baccarat');
    await rig(initial.id, '4s 3h 4d 5c'); // Tie: +3,200 exceeds the 1,000 profit target.
    const result = await betHouse(initial.id, 400, 'tie');
    expect(result.balance).toBe(4200);
    await expect(betHouse(initial.id, 20)).rejects.toThrow('수익 목표');
    expect((await db.stats.get(player.id))!.byGame?.baccarat).toEqual({ hands: 1, net: 3200, won: 1 });
    expect((await closeHouseRoom(initial.id)).cashOut).toBe(4200);
    expect((await db.characters.get(player.id))!.balance).toBe(13200);
    const second = await openHouseRoom({
      playerId: player.id,
      gameId: 'baccarat',
      buyIn: 2000,
      cpuClass: 'LOW',
      stakeId: 'ENTRY',
    });
    expect(profitTarget(second.initialBuyIn, second.initialBuyIn, second.profitMultiplier)).toBe(4000);
    await rig(second.id, '4s 3h 5d 4c');
    await expect(betHouse(second.id, 20, 'player')).resolves.toBeDefined();
  });
  it('freezes a room limit at entry even when settings change', async () => {
    const { room: initial } = await room();
    await updateProfitLimit('blackjack', 1);
    expect((await db.rooms.get(initial.id))!.profitMultiplier).toBe(5);
  });
  it('blocks blackjack at exactly 6,000 after entering with 1,000 and a five-times profit limit', async () => {
    const { room: initial } = await room();
    await db.rooms.update(initial.id, { balance: 5800 });
    await rig(initial.id, 'Ts Ah 8d 6c');
    await betHouse(initial.id, 200);
    await actHouse(initial.id, 'noInsurance');
    const result = await actHouse(initial.id, 'stand');
    expect(result.balance).toBe(6000);
    await expect(betHouse(initial.id, 20)).rejects.toThrow('수익 목표');
  });
});
describe('dealer rooms and recovery', () => {
  it('selects a dealer from the chosen class and does not change the CPU wallet', async () => {
    const before = await listCpus('LOW');
    const { room: initial } = await room('baccarat');
    expect(before.some((cpu) => cpu.id === initial.dealer.id)).toBe(true);
    await rig(initial.id, '4s 3h 5d 4c');
    const result = await betHouse(initial.id, 20, 'player');
    expect(result.dealer).toEqual(initial.dealer);
    await closeHouseRoom(initial.id);
    expect((await listCpus('LOW')).map((cpu) => cpu.balance)).toEqual(before.map((cpu) => cpu.balance));
  });
  it('persists double-down/split exposure and recovers a pending round as a loss exactly once', async () => {
    const { player, room: initial } = await room();
    await rig(initial.id, '8s 9h 8d 7c 2h 3c');
    await betHouse(initial.id, 200);
    const split = await actHouse(initial.id, 'split');
    expect(split.balance).toBe(600);
    expect(await recoverHouseRooms()).toBe(1);
    expect((await db.characters.get(player.id))!.balance).toBe(9600);
    expect((await db.stats.get(player.id))!.netProfit).toBe(-400);
    expect(await recoverHouseRooms()).toBe(0);
    await closeHouseRoom(initial.id);
    expect((await db.characters.get(player.id))!.balance).toBe(9600);
    expect(await db.hands.count()).toBe(1);
  });
  it('forbids simultaneous poker and dealer rooms and rejects stale actions', async () => {
    const { player, room: initial } = await room();
    const opponents = await pickOpponents('LOW', stakeById('ENTRY'), 1);
    await expect(
      startSession({
        playerId: player.id,
        cpuClass: 'LOW',
        seatCount: 2,
        stakeId: 'ENTRY',
        buyIn: 1000,
        opponentIds: opponents.map((cpu) => cpu.id),
      }),
    ).rejects.toThrow('이미');
    await rig(initial.id, 'As 9h Kd 7c');
    await betHouse(initial.id, 200);
    await expect(actHouse(initial.id, 'hit')).rejects.toThrow();
    expect(await db.hands.count()).toBe(1);
    await expect(betHouse(initial.id, -20)).rejects.toThrow();
  });
  it('losing the room bankroll cannot spend remaining wallet chips', async () => {
    const { player, room: initial } = await room('blackjack', 400);
    await rig(initial.id, '9s Th 8d Ac');
    const lost = await betHouse(initial.id, 400);
    expect(lost.balance).toBe(0);
    await expect(betHouse(initial.id, 20)).rejects.toThrow();
    expect((await closeHouseRoom(initial.id)).bankrupt).toBe(false);
    expect((await db.characters.get(player.id))!.balance).toBe(9600);
  });
  it('blocks poker continuation at its configured threshold', async () => {
    const player = await createPlayer('포커');
    const opponents = await pickOpponents('LOW', stakeById('ENTRY'), 1);
    const session = await startSession({
      playerId: player.id,
      gameId: 'draw',
      cpuClass: 'LOW',
      seatCount: 2,
      stakeId: 'ENTRY',
      buyIn: 1000,
      opponentIds: opponents.map((cpu) => cpu.id),
    });
    session.seats[0]!.stack = 6000;
    await db.sessions.put(session);
    const runner = new TableRunner(session, { thinkMs: () => 0, onChange: () => undefined });
    await runner.startNextHand();
    await runner.startNextHand();
    expect(runner.view().phase).toBe('profitLimit');
    expect(runner.view().hand).toBeNull();
    runner.dispose();
    await endSession(session.id);
  });
});
it('upgrades a v1 database without dropping characters or historic stats', async () => {
  const name = `migration-${Date.now()}`;
  const old = new Dexie(name);
  old.version(1).stores({
    characters: 'id, kind, cpuClass, status, name',
    sessions: 'id, playerId, active',
    hands: 'id, playerId, sessionId, [playerId+playedAt]',
    stats: 'characterId',
    settings: 'id',
  });
  await old.table('characters').put({ id: 'legacy', name: '기존', balance: 12345 });
  await old.table('stats').put({ characterId: 'legacy', handsPlayed: 8, handsWon: 3, netProfit: 500 });
  old.close();
  const upgraded = new CardGamesDb(name);
  try {
    expect((await upgraded.characters.get('legacy'))!.balance).toBe(12345);
    expect((await upgraded.stats.get('legacy'))!.byGame).toEqual({ holdem: { hands: 8, net: 500, won: 3 } });
  } finally {
    await upgraded.delete();
  }
});

describe('per-game win backfill', () => {
  const record = (gameId: 'holdem' | 'blackjack', won: boolean) =>
    ({ playerId: 'p', gameId, won }) as unknown as HandRecord;

  it('counts wins from history when it covers every hand', () => {
    const stats = {
      characterId: 'p',
      handsWon: 3,
      byGame: { holdem: { hands: 2, net: 0 }, blackjack: { hands: 2, net: 0 } },
    } as unknown as Stats;
    backfillGameWins(stats, [
      record('holdem', true),
      record('holdem', false),
      record('blackjack', true),
      record('blackjack', true),
    ]);
    expect(stats.byGame!.holdem!.won).toBe(1);
    expect(stats.byGame!.blackjack!.won).toBe(2);
  });

  it('scales the kept history when older hands were trimmed', () => {
    const stats = {
      characterId: 'p',
      handsWon: 0,
      byGame: { holdem: { hands: 10, net: 0 }, blackjack: { hands: 1, net: 0 } },
    } as unknown as Stats;
    backfillGameWins(stats, [record('holdem', true), record('holdem', false), record('blackjack', false)]);
    expect(stats.byGame!.holdem!.won).toBe(5);
    expect(stats.byGame!.blackjack!.won).toBe(0);
  });
});
