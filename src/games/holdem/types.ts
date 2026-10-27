import type { Card } from '../../core/cards';
import type { HandValue } from '../../core/evaluator';

export type Street = 'PREFLOP' | 'DRAW' | 'FLOP' | 'TURN' | 'RIVER' | 'SHOWDOWN';

export interface SeatInput {
  id: string;
  name: string;
  stack: number;
}

export interface PlayerState {
  id: string;
  name: string;
  startStack: number;
  stack: number;
  hole: Card[];
  /** Chips put in on the current street. */
  bet: number;
  /** Chips put in during the whole hand. */
  contributed: number;
  folded: boolean;
  allIn: boolean;
  /** Acted since the last full raise (a player who has may not re-raise an incomplete raise). */
  hasActed: boolean;
}

export type Action =
  | { type: 'draw'; indices: number[] }
  | { type: 'fold' }
  | { type: 'check' }
  | { type: 'call' }
  /** Bet or raise to a total street bet of `to`. */
  | { type: 'raise'; to: number };

export type ActionKind = 'sb' | 'bb' | 'fold' | 'check' | 'call' | 'bet' | 'raise' | 'draw';

export interface ActionRecord {
  street: Street;
  player: number;
  kind: ActionKind;
  /** Chips added by this action. */
  amount: number;
  /** Street bet total after the action. */
  to: number;
  allIn: boolean;
}

export interface LegalActions {
  canFold: boolean;
  canCheck: boolean;
  canCall: boolean;
  callAmount: number;
  canRaise: boolean;
  minRaiseTo: number;
  maxRaiseTo: number;
}

export interface PotResult {
  amount: number;
  eligible: number[];
  winners: number[];
  /** Chips paid to each winner, parallel to `winners`. */
  shares: number[];
}

export interface HandResult {
  showdown: boolean;
  pots: PotResult[];
  /** Hand value per player (null when folded or no showdown). */
  hands: (HandValue | null)[];
  payouts: number[];
  net: number[];
}

export interface HandState {
  variant?: 'holdem' | 'draw';
  discards?: Card[];
  drawDone?: boolean[];
  drawSeed?: number;
  players: PlayerState[];
  button: number;
  sbIndex: number;
  bbIndex: number;
  sb: number;
  bb: number;
  deck: Card[];
  board: Card[];
  street: Street;
  /** Index of the player to act, -1 when nobody can act. */
  toAct: number;
  currentBet: number;
  /** Size of the last full bet/raise increment. */
  minRaise: number;
  lastAggressor: number;
  preflopRaiser: number;
  actions: ActionRecord[];
  result: HandResult | null;
}

export type HandEvent =
  | { type: 'draw'; player: number; count: number }
  | { type: 'action'; record: ActionRecord }
  | { type: 'street'; street: Street; cards: Card[] }
  | { type: 'end'; result: HandResult };
