import type { CpuClass } from './ai/types';

export type StakeId = 'ENTRY' | 'NORMAL' | 'MID' | 'HIGH' | 'VIP';

export interface StakeLevel {
  id: StakeId;
  name: string;
  sb: number;
  bb: number;
  minBuyIn: number;
  maxBuyIn: number;
  classes: CpuClass[];
}

export const STAKES: StakeLevel[] = [
  { id: 'ENTRY', name: '입문', sb: 10, bb: 20, minBuyIn: 400, maxBuyIn: 2_000, classes: ['LOW'] },
  { id: 'NORMAL', name: '일반', sb: 25, bb: 50, minBuyIn: 1_000, maxBuyIn: 5_000, classes: ['LOW'] },
  { id: 'MID', name: '중급', sb: 50, bb: 100, minBuyIn: 2_000, maxBuyIn: 10_000, classes: ['HIGH'] },
  { id: 'HIGH', name: '고급', sb: 100, bb: 200, minBuyIn: 4_000, maxBuyIn: 20_000, classes: ['HIGH'] },
  { id: 'VIP', name: 'VIP', sb: 500, bb: 1_000, minBuyIn: 20_000, maxBuyIn: 100_000, classes: ['HIGH'] },
];

export function stakeById(id: StakeId): StakeLevel {
  return STAKES.find((s) => s.id === id)!;
}

export function stakesForClass(cls: CpuClass): StakeLevel[] {
  return STAKES.filter((s) => s.classes.includes(cls));
}

/** Below this wallet balance a player can no longer sit anywhere. */
export const PLAYER_BANKRUPT_THRESHOLD = Math.min(...STAKES.map((s) => s.minBuyIn));

/** Below this (after a session) a CPU can no longer sit at its class's tables. */
export function cpuBankruptThreshold(cls: CpuClass): number {
  return Math.min(...stakesForClass(cls).map((s) => s.minBuyIn));
}

export const MIN_SEATS = 2;
export const MAX_SEATS = 6;
