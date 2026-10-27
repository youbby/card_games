import { type Card, rankOf, suitOf } from '../../../core/cards';
import { scoreHand } from '../../../core/evaluator';
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
 * Monte Carlo equity against `opponents` random hands: share of the pot won
 * on average (ties count fractionally).
 */
export function estimateEquity(hole: Card[], board: Card[], opponents: number, iterations: number, rng: Rng): number {
  if (opponents <= 0) return 1;
  const known = new Set([...hole, ...board]);
  const deck: Card[] = [];
  for (let c = 0; c < 52; c++) if (!known.has(c)) deck.push(c);

  const needBoard = 5 - board.length;
  const draw = needBoard + opponents * 2;
  let total = 0;
  const fullBoard = [...board];
  const mine: Card[] = [...hole, ...board];
  const opp: Card[] = new Array(7);

  for (let it = 0; it < iterations; it++) {
    // Partial Fisher-Yates: the first `draw` cards become a random sample.
    for (let i = 0; i < draw; i++) {
      const j = i + rng.int(deck.length - i);
      const t = deck[i];
      deck[i] = deck[j];
      deck[j] = t;
    }
    fullBoard.length = board.length;
    mine.length = 2 + board.length;
    for (let i = 0; i < needBoard; i++) {
      fullBoard.push(deck[i]);
      mine.push(deck[i]);
    }
    const myScore = scoreHand(mine);

    let best = true;
    let ties = 0;
    for (let o = 0; o < opponents; o++) {
      opp[0] = deck[needBoard + o * 2];
      opp[1] = deck[needBoard + o * 2 + 1];
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
