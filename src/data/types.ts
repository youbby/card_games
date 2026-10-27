import type { CpuClass, OpponentModel, Personality } from '../games/holdem/ai/types';
import type { StakeId } from '../games/holdem/stakes';
import type { GameId, PokerGameId } from '../games/catalog';

export type CharacterKind = 'PLAYER' | 'CPU';
export type CharacterStatus = 'ACTIVE' | 'BANKRUPT';

export interface Character {
  id: string;
  kind: CharacterKind;
  cpuClass?: CpuClass;
  personality?: Personality;
  name: string;
  avatar: string;
  /** Wallet balance, excluding chips on a table. */
  balance: number;
  status: CharacterStatus;
  createdAt: number;
  bankruptAt?: number;
  lastPlayedAt: number;
  /** Highest total (wallet + table stack) ever held. */
  peakBalance: number;
}

export interface SeatRecord {
  characterId: string;
  name: string;
  avatar: string;
  kind: CharacterKind;
  cpuClass?: CpuClass;
  buyInTotal: number;
  stack: number;
}

/** Snapshot of the hand being played, used to settle it if the app dies mid-hand. */
export interface InProgressHand {
  seed: number;
  /** Stack per character id at the start of the hand. */
  startStacks: Record<string, number>;
  /** Chips put in so far per character id. */
  committed: Record<string, number>;
}

export interface TableSession {
  id: string;
  playerId: string;
  gameId: PokerGameId;
  initialBuyIn?: number;
  profitMultiplier?: number | null;
  cpuClass: CpuClass;
  seatCount: number;
  stakeId: StakeId;
  sb: number;
  bb: number;
  /** Fixed seats around the table; the player always sits in seat 0. */
  seats: (SeatRecord | null)[];
  /** Seat index of the dealer button for the last hand (-1 before the first). */
  button: number;
  /** 1 while the session is open (indexable), 0 once ended. */
  active: 0 | 1;
  startedAt: number;
  endedAt?: number;
  handsPlayed: number;
  inProgressHand?: InProgressHand;
  opponentModel: OpponentModel;
}

export interface HandRecord {
  gameId?: GameId;
  id: string;
  playerId: string;
  sessionId: string;
  playedAt: number;
  seed: number;
  cpuClass: CpuClass;
  stakeId: StakeId;
  seatCount: number;
  position: string;
  holeCards: string[];
  board: string[];
  opponents: { name: string; cpuClass?: CpuClass }[];
  /** Compact action log, one entry per action: "P:R300" etc. */
  actions: string[];
  potTotal: number;
  net: number;
  wentToShowdown: boolean;
  won: boolean;
  bestHand?: { category: number; name: string };
  vpip: boolean;
  pfr: boolean;
  /** Settled as a fold because the player left or the app closed mid-hand. */
  abandoned: boolean;
}

export interface Bucket {
  hands: number;
  net: number;
}

export interface Stats {
  byGame?: Partial<Record<GameId, Bucket>>;
  characterId: string;
  handsPlayed: number;
  handsWon: number;
  netProfit: number;
  biggestPotWon: number;
  biggestLoss: number;
  bestHand?: { category: number; score: number; name: string; cards: string[]; at: number };
  showdowns: number;
  showdownsWon: number;
  vpipCount: number;
  pfrCount: number;
  byClass: Partial<Record<CpuClass, Bucket>>;
  byStake: Partial<Record<StakeId, Bucket>>;
  bySeatCount: Record<string, Bucket>;
  sessions: number;
  playTimeMs: number;
}

export type AnimationSpeed = 'SLOW' | 'NORMAL' | 'FAST';

export interface Settings {
  profitLimits: Record<GameId, number | null>;
  id: 'app';
  startingChips: number;
  sound: boolean;
  haptics: boolean;
  animationSpeed: AnimationSpeed;
  cpuThinkTime: 'SHORT' | 'NORMAL';
  lastCharacterId?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  profitLimits: { holdem: 5, draw: 5, baccarat: 5, blackjack: 5 },
  id: 'app',
  startingChips: 10_000,
  sound: true,
  haptics: true,
  animationSpeed: 'NORMAL',
  cpuThinkTime: 'NORMAL',
};

export const STARTING_CHIPS_MIN = 1_000;
export const STARTING_CHIPS_MAX = 1_000_000;
export const STARTING_CHIPS_PRESETS = [1_000, 5_000, 10_000, 50_000, 100_000];

export const CPU_STARTING_CHIPS: Record<CpuClass, number> = { LOW: 10_000, HIGH: 50_000 };
export const CPU_POOL_SIZE = 10;
export const HAND_HISTORY_LIMIT = 500;
