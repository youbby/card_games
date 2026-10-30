import { createRng, pick, randomSeed, type Rng, shuffle } from '../core/rng';
import { db, newId } from '../data/db';
import { AVATARS, CPU_NAMES } from '../data/names';
import { type Character, CPU_POOL_SIZE, CPU_STARTING_CHIPS } from '../data/types';
import { randomPersonality } from '../games/holdem/ai';
import type { CpuClass } from '../games/holdem/ai/types';
import type { StakeLevel } from '../games/holdem/stakes';
import { emptyStats } from './characters';

export const CPU_CLASSES: CpuClass[] = ['LOW', 'HIGH'];

async function activeNames(): Promise<Set<string>> {
  const all = await db.characters.toArray();
  return new Set(all.filter((c) => c.status === 'ACTIVE').map((c) => c.name));
}

function uniqueName(taken: Set<string>, rng: Rng): string {
  const free = CPU_NAMES.filter((n) => !taken.has(n));
  if (free.length) return pick(free, rng);
  for (let k = 2; ; k++) {
    const candidate = `${pick(CPU_NAMES, rng)} ${k}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export async function listCpus(cls?: CpuClass): Promise<Character[]> {
  const cpus = await db.characters.where('kind').equals('CPU').toArray();
  return cpus
    .filter((c) => c.status === 'ACTIVE' && (!cls || c.cpuClass === cls))
    .sort((a, b) => b.balance - a.balance);
}

/** Tops up each class to CPU_POOL_SIZE active CPUs. Returns the CPUs created. */
export async function ensurePool(rng: Rng = createRng(randomSeed())): Promise<Character[]> {
  return db.transaction('rw', db.characters, db.stats, async () => {
    const taken = await activeNames();
    const created: Character[] = [];
    for (const cls of CPU_CLASSES) {
      const count = (await listCpus(cls)).length;
      for (let i = count; i < CPU_POOL_SIZE; i++) {
        const name = uniqueName(taken, rng);
        taken.add(name);
        const now = Date.now();
        const cpu: Character = {
          id: newId(),
          kind: 'CPU',
          cpuClass: cls,
          personality: randomPersonality(cls, rng),
          name,
          avatar: pick(AVATARS, rng),
          balance: CPU_STARTING_CHIPS[cls],
          status: 'ACTIVE',
          createdAt: now,
          lastPlayedAt: now,
          peakBalance: CPU_STARTING_CHIPS[cls],
        };
        await db.characters.add(cpu);
        await db.stats.add(emptyStats(cpu.id));
        created.push(cpu);
      }
    }
    return created;
  });
}

/** Bankrupt CPUs are removed entirely; ensurePool() replaces them. */
export async function deleteCpu(id: string): Promise<void> {
  await db.transaction('rw', db.characters, db.stats, async () => {
    await db.characters.delete(id);
    await db.stats.delete(id);
  });
}

export async function eligibleCpus(cls: CpuClass, stake: StakeLevel, excludeIds: string[] = []): Promise<Character[]> {
  const exclude = new Set(excludeIds);
  return (await listCpus(cls)).filter((c) => c.balance >= stake.minBuyIn && !exclude.has(c.id));
}

export async function pickOpponents(
  cls: CpuClass,
  stake: StakeLevel,
  count: number,
  rng: Rng = createRng(randomSeed()),
  excludeIds: string[] = [],
): Promise<Character[]> {
  const pool = await eligibleCpus(cls, stake, excludeIds);
  return shuffle(pool, rng).slice(0, count);
}

/** Aggressive CPUs sit with deeper stacks. Never more than they own. */
export function cpuBuyIn(cpu: Character, stake: StakeLevel, rng: Rng): number {
  const aggression = cpu.personality?.aggression ?? 0.5;
  const fraction = Math.min(1, 0.25 + aggression * 0.6 + rng.next() * 0.2);
  const target = stake.minBuyIn + (stake.maxBuyIn - stake.minBuyIn) * fraction;
  const rounded = Math.round(target / stake.bb) * stake.bb;
  return Math.min(cpu.balance, Math.max(stake.minBuyIn, rounded));
}
