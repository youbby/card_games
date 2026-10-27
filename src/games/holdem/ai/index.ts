import type { Rng } from '../../../core/rng';
import type { Action, HandState } from '../types';
import { maskedView } from './common';
import { highBotDecide } from './highBot';
import { lowBotDecide } from './lowBot';
import type { BotContext, CpuClass, Personality } from './types';

export * from './types';

/** Decides for the player whose turn it is. Bots only ever see a masked view. */
export function botDecide(cls: CpuClass, state: HandState, ctx: BotContext): Action {
  const view = maskedView(state, state.toAct);
  return cls === 'HIGH' ? highBotDecide(view, ctx) : lowBotDecide(view, ctx);
}

const RANGES: Record<CpuClass, Record<keyof Personality, [number, number]>> = {
  LOW: { tightness: [0.05, 0.5], aggression: [0.1, 0.6], bluff: [0, 0.3] },
  HIGH: { tightness: [0.35, 0.8], aggression: [0.4, 0.9], bluff: [0.15, 0.5] },
};

export function randomPersonality(cls: CpuClass, rng: Rng): Personality {
  const r = RANGES[cls];
  const roll = ([lo, hi]: [number, number]) => Math.round((lo + rng.next() * (hi - lo)) * 100) / 100;
  return { tightness: roll(r.tightness), aggression: roll(r.aggression), bluff: roll(r.bluff) };
}
