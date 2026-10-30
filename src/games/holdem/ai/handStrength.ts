import { type Card, rankOf, suitOf } from '../../../core/cards';
import { evaluate, scoreHand } from '../../../core/evaluator';
import type { Rng } from '../../../core/rng';

/** Chen formula preflop score (-1..20). AA = 20, 72o ≈ -1. */
export function chenScore(hole: Card[]): number {
  const [a, b] = hole;
  const hi = Math.max(rankOf(a), rankOf(b));
  const lo = Math.min(rankOf(a), rankOf(b));
  const value = (r: number) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);

  let score = value(hi);
  if (hi === lo) return Math.ceil(Math.max(5, score * 2));
  if (suitOf(a) === suitOf(b)) score += 2;
  const gap = hi - lo - 1;
  score -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
  if (gap <= 1 && hi < 12) score += 1;
  return Math.ceil(score);
}

/**
 * What an opponent's actions say about their hole cards. A random hand is
 * `{ minChen: -Infinity, madeHandChance: 0 }`.
 */
export interface OpponentRange {
  /** Hole cards weaker than this Chen score are unlikely (e.g. after a preflop raise). */
  minChen: number;
  /** Chance (0..1) that their hole cards improved the current board, after betting into it. */
  madeHandChance: number;
}

const RANDOM_HAND: OpponentRange = { minChen: -Infinity, madeHandChance: 0 };
/** Rejection-sampling attempts per opponent hand before accepting whatever came up. */
const RANGE_TRIES = 25;

/**
 * Monte Carlo equity: the share of the pot won on average (ties count
 * fractionally). Opponents are random hands, or hands drawn from the given
 * ranges by rejection sampling.
 */
export function estimateEquity(
  hole: Card[],
  board: Card[],
  opponents: number | OpponentRange[],
  iterations: number,
  rng: Rng,
): number {
  const ranges = typeof opponents === 'number' ? Array.from({ length: opponents }, () => RANDOM_HAND) : opponents;
  if (ranges.length === 0) return 1;
  const known = new Set([...hole, ...board]);
  const deck: Card[] = [];
  for (let c = 0; c < 52; c++) if (!known.has(c)) deck.push(c);
  const swap = (i: number, j: number) => {
    const t = deck[i];
    deck[i] = deck[j];
    deck[j] = t;
  };

  const boardCategory = board.length >= 3 ? evaluate(board, false).category : -1;
  /** Whether two hole cards make more than the board already shows. */
  const improvesBoard = (a: Card, b: Card) => evaluate([a, b, ...board], false).category > boardCategory;
  const fits = (range: OpponentRange, needsMadeHand: boolean, a: Card, b: Card) =>
    (range.minChen === -Infinity || chenScore([a, b]) >= range.minChen) && (!needsMadeHand || improvesBoard(a, b));

  const needBoard = 5 - board.length;
  let total = 0;
  const fullBoard = [...board];
  const mine: Card[] = [...hole, ...board];
  const opp: Card[] = new Array(7);
  const oppHoles: Card[] = new Array(ranges.length * 2);

  for (let it = 0; it < iterations; it++) {
    // Partial Fisher-Yates: the front of the deck becomes the random sample.
    let pos = 0;
    // Opponents' hole cards first, because their ranges are judged on the current board.
    for (let o = 0; o < ranges.length; o++) {
      const range = ranges[o];
      const needsMadeHand = boardCategory >= 0 && range.madeHandChance > 0 && rng.next() < range.madeHandChance;
      for (let attempt = 0; ; attempt++) {
        swap(pos, pos + rng.int(deck.length - pos));
        swap(pos + 1, pos + 1 + rng.int(deck.length - pos - 1));
        if (attempt >= RANGE_TRIES || fits(range, needsMadeHand, deck[pos], deck[pos + 1])) break;
      }
      oppHoles[o * 2] = deck[pos];
      oppHoles[o * 2 + 1] = deck[pos + 1];
      pos += 2;
    }
    fullBoard.length = board.length;
    mine.length = 2 + board.length;
    for (let i = 0; i < needBoard; i++) {
      swap(pos, pos + rng.int(deck.length - pos));
      fullBoard.push(deck[pos]);
      mine.push(deck[pos]);
      pos++;
    }
    const myScore = scoreHand(mine);

    let best = true;
    let ties = 0;
    for (let o = 0; o < ranges.length; o++) {
      opp[0] = oppHoles[o * 2];
      opp[1] = oppHoles[o * 2 + 1];
      for (let i = 0; i < 5; i++) opp[2 + i] = fullBoard[i];
      const s = scoreHand(opp);
      if (s > myScore) {
        best = false;
        break;
      }
      if (s === myScore) ties++;
    }
    if (best) total += 1 / (ties + 1);
  }
  return total / iterations;
}
