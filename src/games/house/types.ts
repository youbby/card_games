import type { Card } from '../../core/cards';
import type { Character } from '../../data/types';
import type { CpuClass } from '../holdem/ai/types';
import type { StakeId } from '../holdem/stakes';
import type { HouseGameId } from '../catalog';

export type BlackjackAction = 'hit' | 'stand' | 'double' | 'split';
export interface BlackjackHand { cards: Card[]; bet: number; stood: boolean; split: boolean; splitAces: boolean; result?: string; payout?: number }
export interface BlackjackRound {
  kind: 'blackjack'; phase: 'player' | 'done'; deck: Card[]; dealer: Card[];
  hands: BlackjackHand[]; activeHand: number; balance: number; startBalance: number; totalBet: number;
}
export type BaccaratBet = 'player' | 'banker' | 'tie';
export interface BaccaratRound {
  kind: 'baccarat'; phase: 'done'; deck: Card[]; player: Card[]; dealer: Card[];
  choice: BaccaratBet; winner: BaccaratBet; bet: number; payout: number;
  balance: number; startBalance: number; totalBet: number;
}
export type HouseRound = BlackjackRound | BaccaratRound;
export interface HouseRoom {
  id: string; playerId: string; gameId: HouseGameId; cpuClass: CpuClass; stakeId: StakeId;
  dealer: Pick<Character, 'id' | 'name' | 'avatar'>; initialBuyIn: number; balance: number;
  profitMultiplier: number | null; active: 0 | 1; roundsPlayed: number; startedAt: number; endedAt?: number;
  deck: Card[]; round: HouseRound | null;
}
