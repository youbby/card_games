import { type Card, rankOf, suitOf } from './cards';

export const HandCategory = {
  HIGH_CARD: 0,
  PAIR: 1,
  TWO_PAIR: 2,
  TRIPS: 3,
  STRAIGHT: 4,
  FLUSH: 5,
  FULL_HOUSE: 6,
  QUADS: 7,
  STRAIGHT_FLUSH: 8,
} as const;
export type HandCategory = (typeof HandCategory)[keyof typeof HandCategory];

const CATEGORY_NAMES_KO = [
  '하이카드',
  '원페어',
  '투페어',
  '트리플',
  '스트레이트',
  '플러시',
  '풀하우스',
  '포카드',
  '스트레이트 플러시',
];

export interface HandValue {
  category: HandCategory;
  /** Larger is better; comparable across any two hands. */
  score: number;
  /** Ranks used for the score, most significant first. */
  ranks: number[];
  /** The cards that make the hand (up to 5). */
  best: Card[];
  name: string;
}

/** Highest straight in a rank bitmask (bit r set = rank r present), 0 if none. */
function straightHigh(mask: number): number {
  const m = mask & (1 << 14) ? mask | 0b10 : mask; // ace also plays low
  for (let high = 14; high >= 5; high--) {
    const need = 0b11111 << (high - 4);
    if ((m & need) === need) return high;
  }
  return 0;
}

function straightRanks(high: number): number[] {
  return high === 5 ? [5, 4, 3, 2, 14] : [high, high - 1, high - 2, high - 3, high - 4];
}

function packScore(category: number, ranks: number[]): number {
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 16 + (ranks[i] ?? 0);
  return score;
}

/** Picks one card per listed rank (repeats allowed), optionally restricted to a suit. */
function pickCards(cards: Card[], ranks: number[], suit = -1): Card[] {
  const used = new Set<Card>();
  const out: Card[] = [];
  for (const r of ranks) {
    const c = cards.find((x) => !used.has(x) && rankOf(x) === r && (suit < 0 || suitOf(x) === suit));
    if (c !== undefined) {
      used.add(c);
      out.push(c);
    }
  }
  return out;
}

/** Evaluates the best hand from any number of cards (typically 2..7). */
export function evaluate(cards: Card[], withBest = true): HandValue {
  const rankCount = new Array<number>(15).fill(0);
  const suitCount = [0, 0, 0, 0];
  const suitMask = [0, 0, 0, 0];
  let mask = 0;
  for (const c of cards) {
    const r = rankOf(c);
    const s = suitOf(c);
    rankCount[r]++;
    suitCount[s]++;
    suitMask[s] |= 1 << r;
    mask |= 1 << r;
  }

  const make = (category: HandCategory, ranks: number[], suit = -1): HandValue => ({
    category,
    score: packScore(category, ranks),
    ranks,
    best: withBest ? pickCards(cards, ranks, suit) : [],
    name: category === HandCategory.STRAIGHT_FLUSH && ranks[0] === 14 ? '로열 플러시' : CATEGORY_NAMES_KO[category],
  });

  const flushSuit = suitCount.findIndex((n) => n >= 5);
  if (flushSuit >= 0) {
    const sf = straightHigh(suitMask[flushSuit]);
    if (sf) {
      const ranks = straightRanks(sf);
      return make(HandCategory.STRAIGHT_FLUSH, ranks, flushSuit);
    }
  }

  const quads: number[] = [];
  const trips: number[] = [];
  const pairs: number[] = [];
  const singles: number[] = [];
  for (let r = 14; r >= 2; r--) {
    const n = rankCount[r];
    if (n === 4) quads.push(r);
    else if (n === 3) trips.push(r);
    else if (n === 2) pairs.push(r);
    else if (n === 1) singles.push(r);
  }
  /** Highest ranks present, excluding the given ones. */
  const kickers = (exclude: number[], count: number) => {
    const out: number[] = [];
    for (let r = 14; r >= 2 && out.length < count; r--) {
      if (rankCount[r] > 0 && !exclude.includes(r)) out.push(r);
    }
    return out;
  };

  if (quads.length) {
    const q = quads[0];
    const ranks = [q, q, q, q, ...kickers([q], 1)];
    return make(HandCategory.QUADS, ranks);
  }

  if (trips.length && (trips.length > 1 || pairs.length)) {
    const t = trips[0];
    const p = Math.max(trips[1] ?? 0, pairs[0] ?? 0);
    const ranks = [t, t, t, p, p];
    return make(HandCategory.FULL_HOUSE, ranks);
  }

  if (flushSuit >= 0) {
    const ranks: number[] = [];
    for (let r = 14; r >= 2 && ranks.length < 5; r--) if (suitMask[flushSuit] & (1 << r)) ranks.push(r);
    return make(HandCategory.FLUSH, ranks, flushSuit);
  }

  const st = straightHigh(mask);
  if (st) {
    const ranks = straightRanks(st);
    return make(HandCategory.STRAIGHT, ranks);
  }

  if (trips.length) {
    const t = trips[0];
    const ranks = [t, t, t, ...kickers([t], 2)];
    return make(HandCategory.TRIPS, ranks);
  }

  if (pairs.length >= 2) {
    const [a, b] = pairs;
    const ranks = [a, a, b, b, ...kickers([a, b], 1)];
    return make(HandCategory.TWO_PAIR, ranks);
  }

  if (pairs.length === 1) {
    const p = pairs[0];
    const ranks = [p, p, ...kickers([p], 3)];
    return make(HandCategory.PAIR, ranks);
  }

  const ranks = singles.slice(0, 5);
  return make(HandCategory.HIGH_CARD, ranks);
}

/** Score only (skips picking the best cards) for Monte Carlo loops. */
export function scoreHand(cards: Card[]): number {
  return evaluate(cards, false).score;
}

export function categoryName(category: number): string {
  return CATEGORY_NAMES_KO[category] ?? '';
}
