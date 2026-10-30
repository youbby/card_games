import type { Card } from '../../core/cards';
import type { Character } from '../../data/types';
import type { CpuClass } from '../holdem/ai/types';
import type { StakeId } from '../holdem/stakes';
import type { HouseGameId } from '../catalog';

export type BlackjackAction = 'hit' | 'stand' | 'double' | 'split' | 'surrender' | 'insurance' | 'noInsurance';

export type BlackjackResult = '블랙잭' | '승리' | '무승부' | '패배' | '버스트' | '서렌더';

export interface BlackjackHand {
  cards: Card[];
  bet: number;
  stood: boolean;
  split: boolean;
  splitAces: boolean;
  surrendered?: boolean;
  result?: BlackjackResult;
  payout?: number;
}

export interface BlackjackRound {
  kind: 'blackjack';
  /** 'insurance' only while the dealer shows an ace and the player has not decided yet. */
  phase: 'insurance' | 'player' | 'done';
  deck: Card[];
  /** dealer[0] is the face-up card. */
  dealer: Card[];
  hands: BlackjackHand[];
  activeHand: number;
  /** Insurance wager (0 when declined or not offered). */
  insurance?: number;
  insurancePayout?: number;
  balance: number;
  startBalance: number;
  totalBet: number;
}

export type BaccaratBet = 'player' | 'banker' | 'tie';

export interface BaccaratRound {
  kind: 'baccarat';
  phase: 'done';
  deck: Card[];
  player: Card[];
  dealer: Card[];
  choice: BaccaratBet;
  winner: BaccaratBet;
  bet: number;
  payout: number;
  balance: number;
  startBalance: number;
  totalBet: number;
}

export type HouseRound = BlackjackRound | BaccaratRound;

export interface HouseRoom {
  id: string;
  playerId: string;
  gameId: HouseGameId;
  cpuClass: CpuClass;
  stakeId: StakeId;
  dealer: Pick<Character, 'id' | 'name' | 'avatar'>;
  initialBuyIn: number;
  balance: number;
  profitMultiplier: number | null;
  active: 0 | 1;
  roundsPlayed: number;
  startedAt: number;
  endedAt?: number;
  deck: Card[];
  round: HouseRound | null;
}

/** A round that still waits for the player's decision. */
export function isRoundOpen(round: HouseRound | null | undefined): round is BlackjackRound {
  return !!round && round.phase !== 'done';
}
