import { rankOf, suitOf } from '../../../core/cards';
import type { Action, HandState } from '../types';
import { passive, raiseTo, situation, type Situation } from './common';
import { chenScore, estimateEquity, type OpponentRange } from './handStrength';
import type { BotContext } from './types';

const EQUITY_ITERATIONS = 500;

/**
 * HIGH: positional preflop ranges, Monte Carlo equity against pot odds,
 * c-bets, semi-bluffs, varied sizing and adjustments to the human's habits.
 */
export function highBotDecide(view: HandState, ctx: BotContext): Action {
  return view.street === 'PREFLOP' ? preflop(view, ctx) : postflop(view, ctx);
}

/** Players who act after `seat` preflop (0 = last to act). */
function playersBehind(view: HandState, seat: number): number {
  const n = view.players.length;
  let count = 0;
  for (let k = 1; k < n; k++) {
    const i = (seat + k) % n;
    if (i === (view.bbIndex + 1) % n) break; // wrapped past the BB
    if (!view.players[i].folded && !view.players[i].allIn) count++;
  }
  return count;
}

function preflop(view: HandState, ctx: BotContext): Action {
  const { personality: pers, rng } = ctx;
  const sit = situation(view);
  const { legal, toCall, stack } = sit;
  const me = view.players[view.toAct];
  const bb = view.bb;
  const chen = chenScore(me.hole);
  const stackBb = (stack + me.bet) / bb;
  const call: Action = legal.canCall ? { type: 'call' } : { type: 'check' };
  const raisedPot = view.currentBet > bb;

  // Short stack: push or fold.
  if (stackBb <= 15) {
    const pushAt = raisedPot ? 10 : 8 - pers.aggression * 2;
    if (chen >= pushAt && legal.canRaise) return { type: 'raise', to: legal.maxRaiseTo };
    if (chen >= pushAt) return call;
    return passive(legal);
  }

  const behind = playersBehind(view, view.toAct);
  const tight = pers.tightness * 2 - 1; // -1..1
  const openAt = 5.5 + behind * 0.7 + tight;

  if (!raisedPot) {
    if (chen >= openAt && legal.canRaise) {
      const limpers = view.players.filter((p, i) => i !== view.bbIndex && i !== view.sbIndex && p.bet === bb).length;
      return raiseTo(legal, bb * (2.5 + rng.next() * 0.5 + limpers), bb);
    }
    if (toCall === 0) return { type: 'check' };
    // Complete from the small blind with reasonable hands.
    if (view.toAct === view.sbIndex && chen >= openAt - 2) return call;
    return passive(legal);
  }

  // Facing a raise.
  const raiseBb = view.currentBet / bb;
  const priceRatio = toCall / (stack + me.bet);
  if (chen >= 12 && legal.canRaise) return raiseTo(legal, view.currentBet * 3, bb);
  const bluff3bet =
    suitOf(me.hole[0]) === suitOf(me.hole[1]) && Math.max(rankOf(me.hole[0]), rankOf(me.hole[1])) === 14;
  if (bluff3bet && legal.canRaise && raiseBb < 5 && rng.next() < pers.bluff * 0.5) {
    return raiseTo(legal, view.currentBet * 3, bb);
  }
  const callAt = 7 + tight + Math.min(4, raiseBb / 3) + (priceRatio > 0.3 ? 2 : 0);
  if (chen >= callAt) return call;
  return passive(legal);
}

/** Reads each live opponent's hole-card range from how they bet this hand. */
function opponentRanges(view: HandState, ctx: BotContext): OpponentRange[] {
  const ranges: OpponentRange[] = [];
  view.players.forEach((p, i) => {
    if (i === view.toAct || p.folded) return;
    let preflopRaises = 0;
    let calledRaise = false;
    let raiseSeen = false;
    let flopAggression = false;
    let lateAggression = false;
    for (const a of view.actions) {
      const aggressive = a.kind === 'raise' || a.kind === 'bet';
      if (a.street === 'PREFLOP') {
        if (a.player === i && aggressive) preflopRaises++;
        if (a.player === i && a.kind === 'call' && raiseSeen) calledRaise = true;
        if (aggressive) raiseSeen = true;
      } else if (a.player === i && aggressive) {
        if (a.street === 'FLOP') flopAggression = true;
        else lateAggression = true;
      }
    }

    let minChen = preflopRaises >= 2 ? 10 : preflopRaises === 1 ? 7 : calledRaise ? 4 : -Infinity;
    // A loose human plays wider ranges than the textbook.
    const model = ctx.human?.index === i ? ctx.human.model : undefined;
    if (model && model.hands >= 10 && model.vpip / model.hands > 0.45 && minChen !== -Infinity) minChen -= 2;
    // Bets on the turn or river usually mean a real hand; a flop bet less so (c-bets).
    const madeHandChance = lateAggression ? 0.7 : flopAggression ? 0.4 : 0;
    ranges.push({ minChen, madeHandChance });
  });
  return ranges;
}

function humanTendency(ctx: BotContext): { foldsALot: boolean; callsALot: boolean } {
  const m = ctx.human?.model;
  if (!m || m.betsFaced < 6) return { foldsALot: false, callsALot: false };
  const foldRate = m.foldsToBet / m.betsFaced;
  return { foldsALot: foldRate > 0.6, callsALot: foldRate < 0.3 };
}

function postflop(view: HandState, ctx: BotContext): Action {
  const { personality: pers, rng } = ctx;
  const sit: Situation = situation(view);
  const { legal, pot, toCall, opponents } = sit;
  const me = view.players[view.toAct];
  const bb = view.bb;
  const call: Action = legal.canCall ? { type: 'call' } : { type: 'check' };

  const equity = estimateEquity(me.hole, view.board, opponentRanges(view, ctx), EQUITY_ITERATIONS, rng);
  const human = ctx.human;
  const humanInHand = human !== undefined && !view.players[human.index]?.folded;
  const { foldsALot, callsALot } = humanInHand ? humanTendency(ctx) : { foldsALot: false, callsALot: false };
  const bluffRate = pers.bluff * (foldsALot ? 1.6 : callsALot ? 0.3 : 1);
  const size = (fraction: number) => pot * fraction * (0.85 + rng.next() * 0.3);
  const valueSize = callsALot ? 0.85 : 0.6 + pers.aggression * 0.15;
  const iRaisedPreflop = view.preflopRaiser === view.toAct;
  const strongThreshold = opponents > 1 ? 0.65 : 0.72;

  if (toCall === 0) {
    if (!legal.canRaise) return { type: 'check' };
    if (equity >= strongThreshold) {
      if (rng.next() < 0.12) return { type: 'check' }; // occasional slow play
      return raiseTo(legal, size(valueSize), bb);
    }
    if (equity >= 0.5 && rng.next() < 0.4 + pers.aggression * 0.5) return raiseTo(legal, size(0.5), bb);
    if (view.street === 'FLOP' && iRaisedPreflop && opponents <= 2 && rng.next() < 0.55 + pers.aggression * 0.3) {
      return raiseTo(legal, size(0.4), bb); // continuation bet
    }
    if (equity >= 0.3 && view.street !== 'RIVER' && rng.next() < pers.aggression * 0.4) {
      return raiseTo(legal, size(0.5), bb); // semi-bluff
    }
    if (opponents <= 2 && rng.next() < bluffRate * 0.35) return raiseTo(legal, size(0.55), bb);
    return { type: 'check' };
  }

  const potOdds = toCall / (pot + toCall);
  if (equity >= strongThreshold + 0.08 && legal.canRaise && rng.next() < 0.5 + pers.aggression * 0.4) {
    return raiseTo(legal, view.currentBet + size(0.8) + toCall, bb);
  }
  if (equity >= potOdds + 0.05) return call;
  // Implied odds with a draw: call small bets before the river.
  if (view.street !== 'RIVER' && equity >= potOdds * 0.75 && toCall <= pot * 0.35) return call;
  if (legal.canRaise && opponents === 1 && view.street !== 'RIVER' && rng.next() < bluffRate * 0.15) {
    return raiseTo(legal, view.currentBet * 2.5 + pot * 0.3, bb);
  }
  return passive(legal);
}
