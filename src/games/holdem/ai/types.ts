import type { Rng } from '../../../core/rng';

export type CpuClass = 'LOW' | 'HIGH';

export interface Personality {
  /** 0..1, higher plays fewer hands. */
  tightness: number;
  /** 0..1, higher prefers betting and raising over calling. */
  aggression: number;
  /** 0..1, how often it bluffs. */
  bluff: number;
}

/** What the bots know about the human player from this session. */
export interface OpponentModel {
  hands: number;
  vpip: number;
  /** Times the human faced a bet postflop / times they folded to it. */
  betsFaced: number;
  foldsToBet: number;
}

export interface BotContext {
  personality: Personality;
  rng: Rng;
  /** Model of the human player, used by HIGH bots only. */
  human?: { index: number; model: OpponentModel };
}

export function emptyOpponentModel(): OpponentModel {
  return { hands: 0, vpip: 0, betsFaced: 0, foldsToBet: 0 };
}
