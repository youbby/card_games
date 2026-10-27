import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { createRng } from '../core/rng';
import { db } from '../data/db';
import { CPU_POOL_SIZE } from '../data/types';
import type { CpuClass } from '../games/holdem/ai/types';
import { legalActions } from '../games/holdem/engine';
import { stakeById, type StakeId } from '../games/holdem/stakes';
import { createPlayer, getStats, isNameTaken, listPlayers, updateSettings } from './characters';
import { listCpus, pickOpponents } from './cpuPool';
import { factoryReset, initializeApp } from './factoryReset';
import { endSession, getActiveSession, maintainCpuSeats, recoverOpenSessions, startSession } from './session';
import { TableRunner, type TableView } from './tableRunner';

beforeEach(async () => {
  await factoryReset();
});

async function openTable(playerId: string, cls: CpuClass, seats: number, stakeId: StakeId, buyIn: number, seed = 1) {
  const stake = stakeById(stakeId);
  const opponents = await pickOpponents(cls, stake, seats - 1, createRng(seed));
  return startSession({
    playerId,
    cpuClass: cls,
    seatCount: seats,
    stakeId,
    buyIn,
    opponentIds: opponents.map((c) => c.id),
    rng: createRng(seed),
  });
}

/** Runs a table with an auto-playing human until `done` returns true. */
function drive(
  session: Awaited<ReturnType<typeof startSession>>,
  humanPolicy: (view: TableView) => 'call' | 'leave',
  done: (view: TableView) => boolean,
) {
  return new Promise<{ runner: TableRunner; view: TableView }>((resolve, reject) => {
    let finished = false;
    const runner: TableRunner = new TableRunner(session, {
      thinkMs: () => 0,
      rng: createRng(7),
      onChange: (view) => {
        if (finished) return;
        if (done(view)) {
          finished = true;
          resolve({ runner, view });
          return;
        }
        if (view.log.some((l) => l.text.startsWith('오류'))) reject(new Error(view.log.at(-1)!.text));
        if (view.humanTurn) {
          if (humanPolicy(view) === 'leave') {
            finished = true;
            runner.leave().then(() => resolve({ runner, view: runner.view() }), reject);
            return;
          }
          const legal = legalActions(view.hand!);
          queueMicrotask(() => runner.humanAct(legal.canCall ? { type: 'call' } : { type: 'check' }));
        } else if (view.phase === 'handOver') {
          setTimeout(() => runner.startNextHand(), 0);
        }
      },
    });
    runner.startNextHand().catch(reject);
  });
}

describe('app initialization', () => {
  it('creates 10 LOW and 10 HIGH CPUs with class starting chips', async () => {
    const low = await listCpus('LOW');
    const high = await listCpus('HIGH');
    expect(low).toHaveLength(CPU_POOL_SIZE);
    expect(high).toHaveLength(CPU_POOL_SIZE);
    expect(low.every((c) => c.balance === 10_000)).toBe(true);
    expect(high.every((c) => c.balance === 50_000)).toBe(true);
    expect(new Set([...low, ...high].map((c) => c.name)).size).toBe(20);
  });

  it('initializeApp is idempotent', async () => {
    await initializeApp();
    await initializeApp();
    expect(await listCpus()).toHaveLength(20);
  });
});

describe('characters', () => {
  it('starting chips apply only when a character is created', async () => {
    const a = await createPlayer('하나');
    await updateSettings({ startingChips: 50_000 });
    const b = await createPlayer('두울');
    const players = await listPlayers();
    expect(players.find((p) => p.id === a.id)!.balance).toBe(10_000);
    expect(players.find((p) => p.id === b.id)!.balance).toBe(50_000);
    // CPUs keep their own fixed starting chips.
    expect((await listCpus('LOW')).every((c) => c.balance === 10_000)).toBe(true);
  });

  it('names are unique among active characters, including CPUs', async () => {
    await createPlayer('하나');
    await expect(createPlayer('하나')).rejects.toThrow();
    const cpuName = (await listCpus())[0].name;
    expect(await isNameTaken(cpuName)).toBe(true);
  });
});

describe('sessions', () => {
  it('buy-in moves chips from wallets to the table and back', async () => {
    const p = await createPlayer('하나');
    const session = await openTable(p.id, 'LOW', 4, 'ENTRY', 1_000);
    expect((await db.characters.get(p.id))!.balance).toBe(9_000);
    for (const seat of session.seats.slice(1)) {
      const cpu = (await db.characters.get(seat!.characterId))!;
      expect(cpu.balance + seat!.stack).toBe(10_000);
    }
    await endSession(session.id);
    expect((await db.characters.get(p.id))!.balance).toBe(10_000);
    expect(await getActiveSession()).toBeUndefined();
  });

  it('rejects stakes outside the class range and unaffordable buy-ins', async () => {
    const p = await createPlayer('하나');
    await expect(openTable(p.id, 'LOW', 3, 'HIGH', 4_000)).rejects.toThrow();
    await expect(openTable(p.id, 'HIGH', 3, 'ENTRY', 400)).rejects.toThrow();
    await expect(openTable(p.id, 'HIGH', 3, 'VIP', 20_000)).rejects.toThrow('잔액');
  });

  it('plays hands, records history and keeps the player books balanced', async () => {
    const p = await createPlayer('하나');
    const session = await openTable(p.id, 'HIGH', 6, 'MID', 5_000);
    const { runner, view } = await drive(
      session,
      () => 'call',
      (v) => v.session.handsPlayed >= 15 || v.phase === 'needRebuy',
    );
    expect(view.session.handsPlayed).toBeGreaterThan(0);
    const result = await runner.leave();
    const after = (await db.characters.get(p.id))!;
    const stats = await getStats(p.id);
    expect(stats.handsPlayed).toBe(view.session.handsPlayed);
    expect(after.balance - 10_000).toBe(stats.netProfit);
    expect(result.cashOut + 5_000).toBe(after.balance);
    expect(await db.hands.where('playerId').equals(p.id).count()).toBe(stats.handsPlayed);
    expect(await listCpus('HIGH')).toHaveLength(CPU_POOL_SIZE);
  });

  it('leaving mid-hand forfeits the chips already committed', async () => {
    const p = await createPlayer('하나');
    const session = await openTable(p.id, 'LOW', 2, 'ENTRY', 2_000);
    const cpuSeat = session.seats[1]!;
    const cpuBefore = (await db.characters.get(cpuSeat.characterId))!.balance + cpuSeat.stack;
    const { view } = await drive(
      session,
      () => 'leave',
      () => false,
    );
    expect(view.phase).toBe('ended');
    const hands = await db.hands.where('playerId').equals(p.id).toArray();
    expect(hands).toHaveLength(1);
    expect(hands[0].abandoned).toBe(true);
    const lost = -hands[0].net;
    expect(lost).toBeGreaterThan(0);
    expect((await db.characters.get(p.id))!.balance).toBe(10_000 - lost);
    expect((await db.characters.get(cpuSeat.characterId))!.balance).toBe(cpuBefore + lost);
  });

  it('a crash mid-hand is settled on the next launch', async () => {
    const p = await createPlayer('하나');
    const session = await openTable(p.id, 'LOW', 3, 'ENTRY', 1_000);
    const ids = session.seats.map((s) => s!.characterId);
    await db.sessions.update(session.id, {
      inProgressHand: {
        seed: 1,
        startStacks: Object.fromEntries(session.seats.map((s) => [s!.characterId, s!.stack])),
        committed: { [ids[0]]: 300, [ids[1]]: 300, [ids[2]]: 100 },
      },
    });
    const result = await recoverOpenSessions();
    expect(result!.abandonedLoss).toBe(300);
    expect((await db.characters.get(p.id))!.balance).toBe(9_700);
    expect(await getActiveSession()).toBeUndefined();
  });
});

describe('bankruptcy', () => {
  it('player is locked when the wallet drops below the lowest buy-in', async () => {
    await updateSettings({ startingChips: 1_000 });
    const p = await createPlayer('하나');
    await db.characters.update(p.id, { balance: 400 });
    const session = await openTable(p.id, 'LOW', 2, 'ENTRY', 400);
    // Heads-up, seat 0 has the first button = small blind, so leaving loses 10.
    await drive(
      session,
      () => 'leave',
      () => false,
    );
    const after = (await db.characters.get(p.id))!;
    expect(after.balance).toBe(390);
    expect(after.status).toBe('BANKRUPT');
    await expect(openTable(p.id, 'LOW', 2, 'ENTRY', 400)).rejects.toThrow();
  });

  it('in game: a CPU with no stack and no wallet is deleted and replaced', async () => {
    const p = await createPlayer('하나');
    const session = await openTable(p.id, 'LOW', 3, 'ENTRY', 1_000);
    const victim = session.seats[1]!;
    await db.characters.update(victim.characterId, { balance: 0 });
    const busted = { ...session, seats: session.seats.map((s, i) => (i === 1 ? { ...s!, stack: 0 } : s)) };
    const { session: next, notices } = await maintainCpuSeats(busted, createRng(3));
    expect(notices.some((n) => n.type === 'bankrupt')).toBe(true);
    expect(await db.characters.get(victim.characterId)).toBeUndefined();
    expect(next.seats[1]).not.toBeNull();
    expect(next.seats[1]!.characterId).not.toBe(victim.characterId);
    expect(await listCpus('LOW')).toHaveLength(CPU_POOL_SIZE);
  });

  it('in game: a busted CPU with wallet chips rebuys, even below the minimum', async () => {
    const p = await createPlayer('하나');
    const session = await openTable(p.id, 'LOW', 2, 'ENTRY', 1_000);
    const cpu = session.seats[1]!;
    await db.characters.update(cpu.characterId, { balance: 150 });
    const busted = { ...session, seats: [session.seats[0], { ...cpu, stack: 0 }] };
    const { session: next, notices } = await maintainCpuSeats(busted, createRng(3));
    expect(notices).toEqual([{ type: 'rebuy', name: cpu.name, amount: 150 }]);
    expect(next.seats[1]!.stack).toBe(150);
  });

  it('after the session: a CPU below its class threshold is deleted', async () => {
    const p = await createPlayer('하나');
    const session = await openTable(p.id, 'HIGH', 2, 'MID', 2_000);
    const cpu = session.seats[1]!;
    // HIGH threshold is 2,000: leave it with 1,500 in total.
    await db.characters.update(cpu.characterId, { balance: 0 });
    await db.sessions.update(session.id, { seats: [session.seats[0], { ...cpu, stack: 1_500 }] });
    await endSession(session.id);
    expect(await db.characters.get(cpu.characterId)).toBeUndefined();
    expect(await listCpus('HIGH')).toHaveLength(CPU_POOL_SIZE);
  });
});

describe('factory reset', () => {
  it('removes everything and recreates the CPU pool', async () => {
    const p = await createPlayer('하나');
    await updateSettings({ startingChips: 77_000 });
    await factoryReset();
    expect(await listPlayers()).toHaveLength(0);
    expect(await db.characters.get(p.id)).toBeUndefined();
    expect(await listCpus()).toHaveLength(20);
    expect((await db.settings.get('app'))!.startingChips).toBe(10_000);
  });
});
