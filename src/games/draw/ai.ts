import { type Card, rankOf, suitOf } from '../../core/cards';
import { evaluate, HandCategory, scoreHand } from '../../core/evaluator';
import { createRng, type Rng } from '../../core/rng';
import { maskedView, passive, raiseTo } from '../holdem/ai/common';
import type { BotContext } from '../holdem/ai/types';
import { legalActions, potTotal } from '../holdem/engine';
import type { Action, HandState } from '../holdem/types';

/** Monte Carlo samples per betting decision, spread over the opponents to keep big tables fast on phones. */
const EQUITY_ITERATIONS = 250;
const MIN_ITERATIONS = 80;
/** Rejection-sampling attempts to find an opponent hand matching what they did. */
const RANGE_TRIES = 40;
/** Pat hands (straight or better) kept for sampling players who drew no cards. */
const PAT_POOL_SIZE = 150;
const PAT_TRIES = 20;

/**
 * Five-card draw bot. Only the acting player's cards and public information
 * (bets, how many cards each player drew) influence the decision.
 *
 * LOW plays like a beginner: it keeps pairs, rarely chases draws and bets
 * on its current made hand. HIGH draws properly, estimates its equity by
 * simulation against hands consistent with each opponent's draw and bets,
 * bluffs weak-looking fields and occasionally stands pat on nothing.
 */
export function drawBotDecide(state: HandState, ctx: BotContext, high: boolean): Action {
  const view = maskedView(state, state.toAct);
  const cards = view.players[view.toAct].hole;
  if (view.street === 'DRAW') {
    return { type: 'draw', indices: high ? highDiscards(cards, ctx) : lowDiscards(cards, ctx.rng) };
  }
  return high ? highBet(view, ctx) : lowBet(view, ctx);
}

// ── Drawing ──────────────────────────────────────────────────────────────

const indicesWhere = (cards: Card[], discard: (card: Card) => boolean) =>
  cards.flatMap((card, i) => (discard(card) ? [i] : []));

function rankCounts(cards: Card[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const card of cards) counts.set(rankOf(card), (counts.get(rankOf(card)) ?? 0) + 1);
  return counts;
}

/** The suit with four cards, if any. */
function fourFlushSuit(cards: Card[]): number | undefined {
  return [0, 1, 2, 3].find((suit) => cards.filter((card) => suitOf(card) === suit).length === 4);
}

/** The card that is not part of four consecutive ranks open at both ends (e.g. 6-7-8-9). */
function openEndedOutsider(cards: Card[]): number | undefined {
  const ranks = new Set(cards.map(rankOf));
  if (ranks.size < 4) return undefined;
  for (let low = 2; low <= 10; low++) {
    if ([0, 1, 2, 3].every((k) => ranks.has(low + k))) {
      return cards.findIndex((card) => rankOf(card) < low || rankOf(card) > low + 3);
    }
  }
  return undefined;
}

/** Standard draw strategy shared by the simulations: what a sensible player throws away. */
export function standardDiscards(cards: Card[]): number[] {
  const value = evaluate(cards, false);
  if (value.category >= HandCategory.STRAIGHT) return [];
  const counts = rankCounts(cards);
  if (value.category >= HandCategory.PAIR) {
    // Low pair with four to a flush: chase the flush.
    const suit = fourFlushSuit(cards);
    if (value.category === HandCategory.PAIR && suit !== undefined && value.ranks[0] < 10) {
      return indicesWhere(cards, (card) => suitOf(card) !== suit);
    }
    return indicesWhere(cards, (card) => counts.get(rankOf(card))! < 2);
  }
  const suit = fourFlushSuit(cards);
  if (suit !== undefined) return indicesWhere(cards, (card) => suitOf(card) !== suit);
  const outsider = openEndedOutsider(cards);
  if (outsider !== undefined && outsider >= 0) return [outsider];
  // Nothing: keep an ace or king (at most two high cards), draw the rest.
  const high = cards.filter((card) => rankOf(card) >= 13).slice(0, 2);
  return indicesWhere(cards, (card) => !high.includes(card));
}

function highDiscards(cards: Card[], ctx: BotContext): number[] {
  const value = evaluate(cards, false);
  // Snowing: stand pat on nothing now and then to represent a made hand.
  if (value.category === HandCategory.HIGH_CARD && ctx.rng.next() < ctx.personality.bluff * 0.12) return [];
  const discards = standardDiscards(cards);
  // With a pair, sometimes keep an ace kicker so the draw looks like two pair.
  if (value.category === HandCategory.PAIR && discards.length === 3 && ctx.rng.next() < 0.3) {
    const ace = discards.find((i) => rankOf(cards[i]) === 14);
    if (ace !== undefined) return discards.filter((i) => i !== ace);
  }
  return discards;
}

function lowDiscards(cards: Card[], rng: Rng): number[] {
  const value = evaluate(cards, false);
  if (value.category >= HandCategory.STRAIGHT) return [];
  const counts = rankCounts(cards);
  if (value.category >= HandCategory.PAIR) return indicesWhere(cards, (card) => counts.get(rankOf(card))! < 2);
  const suit = fourFlushSuit(cards);
  if (suit !== undefined && rng.next() < 0.5) return indicesWhere(cards, (card) => suitOf(card) !== suit);
  // Beginner habit: keep the highest card and hope.
  const top = Math.max(...cards.map(rankOf));
  return indicesWhere(cards, (card) => rankOf(card) !== top).slice(0, 4);
}

// ── Equity ───────────────────────────────────────────────────────────────

interface DrawOpponent {
  /** Cards drawn, once the draw is over. */
  drew?: number;
  /** Bet or raised before the draw. */
  raisedBefore: boolean;
  /** Bet or raised after the draw. */
  betAfter: boolean;
}

function readOpponents(view: HandState): DrawOpponent[] {
  return view.players.flatMap((p, i) => {
    if (i === view.toAct || p.folded) return [];
    const mine = view.actions.filter((a) => a.player === i);
    const aggressive = (street: string) =>
      mine.some((a) => a.street === street && (a.kind === 'bet' || a.kind === 'raise'));
    return [
      {
        drew: mine.find((a) => a.kind === 'draw')?.to,
        raisedBefore: aggressive('PREFLOP'),
        betAfter: aggressive('RIVER'),
      },
    ];
  });
}

/**
 * The unseen cards. Dealing swaps a random card to the front; `mark` and
 * `reset` put a rejected sample back so rejection sampling never runs dry.
 */
class Shoe {
  private readonly cards: Card[] = [];
  /** Index of each card in `cards`, -1 for cards that are not in the shoe. */
  private readonly where = new Array<number>(52).fill(-1);
  private pos = 0;

  constructor(
    known: Card[],
    private readonly rng: Rng,
  ) {
    const seen = new Set(known);
    for (let c = 0; c < 52; c++) {
      if (seen.has(c)) continue;
      this.where[c] = this.cards.length;
      this.cards.push(c);
    }
  }

  private dealAt(j: number): Card {
    const card = this.cards[j];
    const front = this.cards[this.pos];
    this.cards[j] = front;
    this.where[front] = j;
    this.cards[this.pos] = card;
    this.where[card] = this.pos;
    this.pos++;
    return card;
  }

  take(): Card {
    return this.dealAt(this.pos + this.rng.int(this.cards.length - this.pos));
  }

  /** Deals exactly these cards, or returns false (dealing nothing) if any is gone. */
  takeExact(hand: Card[]): boolean {
    if (hand.some((card) => this.where[card] < this.pos)) return false;
    for (const card of hand) this.dealAt(this.where[card]);
    return true;
  }

  hand(): Card[] {
    return [this.take(), this.take(), this.take(), this.take(), this.take()];
  }

  drawTo(hand: Card[], discards: number[]): Card[] {
    const next = [...hand];
    for (const i of discards) next[i] = this.take();
    return next;
  }

  mark(): number {
    return this.pos;
  }

  reset(mark = 0): void {
    this.pos = mark;
  }
}

/**
 * Share of the pot won on average. Before the draw both sides draw with the
 * standard strategy; after it, opponents' hands are sampled to match how many
 * cards they took and whether they bet.
 */
function drawEquity(mine: Card[], opponents: DrawOpponent[], afterDraw: boolean, rng: Rng): number {
  if (!opponents.length) return 1;
  const shoe = new Shoe(mine, rng);
  const iterations = Math.max(MIN_ITERATIONS, Math.round(EQUITY_ITERATIONS / Math.max(1, opponents.length / 2)));
  let total = 0;
  for (let it = 0; it < iterations; it++) {
    shoe.reset();
    const myFinal = afterDraw ? mine : shoe.drawTo(mine, standardDiscards(mine));
    const myScore = scoreHand(myFinal);
    let best = true;
    let ties = 0;
    for (const opp of opponents) {
      const final = afterDraw ? sampleAfterDraw(opp, shoe, rng) : sampleBeforeDraw(opp, shoe);
      const score = scoreHand(final);
      if (score > myScore) {
        best = false;
        break;
      }
      if (score === myScore) ties++;
    }
    if (best) total += 1 / (ties + 1);
  }
  return total / iterations;
}

/** A hand worth raising with before the draw: jacks or better. */
function openerStrength(hand: Card[]): boolean {
  const value = evaluate(hand, false);
  return value.category >= HandCategory.TWO_PAIR || (value.category === HandCategory.PAIR && value.ranks[0] >= 11);
}

/** A hand worth betting after the draw: two pair, or a pair of tens or better. */
function betterStrength(hand: Card[]): boolean {
  const value = evaluate(hand, false);
  return value.category >= HandCategory.TWO_PAIR || (value.category === HandCategory.PAIR && value.ranks[0] >= 10);
}

let patPool: Card[][] | null = null;

/** Random pat hands, built once: drawing them by rejection would need hundreds of tries each. */
function patHands(): Card[][] {
  if (patPool) return patPool;
  const rng = createRng(0x5eed);
  const shoe = new Shoe([], rng);
  const pool: Card[][] = [];
  while (pool.length < PAT_POOL_SIZE) {
    shoe.reset();
    const hand = shoe.hand();
    if (standardDiscards(hand).length === 0) pool.push(hand);
  }
  return (patPool = pool);
}

/** A pat hand that fits the cards still unseen in this sample. */
function samplePat(shoe: Shoe, rng: Rng): Card[] | null {
  const pool = patHands();
  for (let attempt = 0; attempt < PAT_TRIES; attempt++) {
    const hand = pool[rng.int(pool.length)];
    if (shoe.takeExact(hand)) return hand;
  }
  return null;
}

function sampleBeforeDraw(opp: DrawOpponent, shoe: Shoe): Card[] {
  const mark = shoe.mark();
  let hand = shoe.hand();
  for (let attempt = 1; attempt < RANGE_TRIES && opp.raisedBefore && !openerStrength(hand); attempt++) {
    shoe.reset(mark);
    hand = shoe.hand();
  }
  return shoe.drawTo(hand, standardDiscards(hand));
}

/** A final hand that took as many cards as the opponent did, opened like they did, and could bet like they did. */
function sampleAfterDraw(opp: DrawOpponent, shoe: Shoe, rng: Rng): Card[] {
  const drew = opp.drew ?? 3;
  if (drew === 0) {
    const pat = samplePat(shoe, rng);
    if (pat) return pat;
  }
  const needsBetter = opp.betAfter && rng.next() < 0.75;
  const mark = shoe.mark();
  let final: Card[] = [];
  for (let attempt = 0; attempt < RANGE_TRIES; attempt++) {
    shoe.reset(mark);
    const start = shoe.hand();
    const discards = standardDiscards(start);
    final = shoe.drawTo(start, discards);
    if (discards.length !== drew) continue;
    if (opp.raisedBefore && !openerStrength(start)) continue;
    if (needsBetter && !betterStrength(final)) continue;
    break;
  }
  return final;
}

// ── Betting ──────────────────────────────────────────────────────────────

function humanTendency(view: HandState, ctx: BotContext): { foldsALot: boolean; callsALot: boolean } {
  const human = ctx.human;
  const m = human?.model;
  if (!human || view.players[human.index]?.folded || !m || m.betsFaced < 6)
    return { foldsALot: false, callsALot: false };
  const foldRate = m.foldsToBet / m.betsFaced;
  return { foldsALot: foldRate > 0.6, callsALot: foldRate < 0.3 };
}

function highBet(view: HandState, ctx: BotContext): Action {
  const { personality: pers, rng } = ctx;
  const legal = legalActions(view);
  const pot = potTotal(view);
  const bb = view.bb;
  const toCall = legal.callAmount;
  const afterDraw = view.street !== 'PREFLOP';
  const opponents = readOpponents(view);
  const equity = drawEquity(view.players[view.toAct].hole, opponents, afterDraw, rng);
  const { foldsALot, callsALot } = humanTendency(view, ctx);

  const fairShare = 1 / (opponents.length + 1);
  const valueAt = Math.max(0.52, fairShare + 0.16);
  const raiseAt = Math.max(0.7, fairShare + 0.32);
  const size = (fraction: number) => pot * fraction * (0.85 + rng.next() * 0.3);
  const call: Action = legal.canCall ? { type: 'call' } : { type: 'check' };
  // After the draw, a field that drew two or more cards rarely holds much.
  const weakField = afterDraw && opponents.every((opp) => (opp.drew ?? 0) >= 2);
  // Bluffs only pay against players who fold; most CPUs call everything after the draw.
  const bluffRate = pers.bluff * (foldsALot ? 1.2 : callsALot ? 0 : 0.25);

  if (toCall === 0) {
    if (!legal.canRaise) return { type: 'check' };
    if (equity >= valueAt) return raiseTo(legal, view.currentBet + size(callsALot ? 0.85 : 0.6), bb);
    if (weakField && opponents.length <= 2 && rng.next() < bluffRate * 0.6) {
      return raiseTo(legal, view.currentBet + size(0.6), bb);
    }
    return { type: 'check' };
  }

  const potOdds = toCall / (pot + toCall);
  if (legal.canRaise && equity >= raiseAt && rng.next() < 0.5 + pers.aggression * 0.4) {
    return raiseTo(legal, view.currentBet + toCall + size(0.8), bb);
  }
  if (equity >= potOdds + 0.03) return call;
  // Before the draw a cheap call keeps a drawing hand alive.
  if (!afterDraw && toCall <= bb * 2 && equity >= potOdds * 0.8) return call;
  return passive(legal);
}

/** Beginner betting: looks only at the current made hand and calls too often. */
function lowBet(view: HandState, ctx: BotContext): Action {
  const { personality: pers, rng } = ctx;
  const legal = legalActions(view);
  const value = evaluate(view.players[view.toAct].hole, false);
  const strong =
    value.category >= HandCategory.TWO_PAIR || (value.category === HandCategory.PAIR && value.ranks[0] >= 12);
  if (legal.canRaise && strong && rng.next() < 0.3 + pers.aggression * 0.5) {
    const target = view.currentBet + Math.max(view.bb * 2, Math.round(potTotal(view) * 0.5));
    return raiseTo(legal, target, view.bb);
  }
  if (legal.canCheck) return { type: 'check' };
  if (strong || legal.callAmount <= view.bb * 5 || rng.next() < 0.35) return { type: 'call' };
  return { type: 'fold' };
}
