import { evaluate, HandCategory } from '../../../core/evaluator';
import type { Action, HandState } from '../types';
import { passive, raiseTo, situation } from './common';
import { chenScore } from './handStrength';
import type { BotContext } from './types';

/**
 * LOW: a loose, mistake-prone beginner. Looks only at its made hand,
 * ignores position, draws and opponents, and calls too much.
 */
export function lowBotDecide(view: HandState, ctx: BotContext): Action {
  const { personality: pers, rng } = ctx;
  const sit = situation(view);
  const { legal, pot, toCall, stack } = sit;
  const me = view.players[view.toAct];
  const bb = view.bb;
  const call: Action = legal.canCall ? { type: 'call' } : { type: 'check' };

  // Random blunders keep it beatable.
  if (rng.next() < 0.1) {
    const roll = rng.next();
    if (roll < 0.15 && legal.canRaise) return raiseTo(legal, legal.minRaiseTo, bb);
    if (roll < 0.6) return call;
    return passive(legal);
  }

  const bigBet = toCall > (stack + toCall) * 0.4;

  if (view.street === 'PREFLOP') {
    const chen = chenScore(me.hole);
    const playable = 3 + pers.tightness * 4;
    if (chen >= 10) {
      if (legal.canRaise && rng.next() < 0.4 + pers.aggression * 0.4) {
        return raiseTo(legal, Math.max(view.currentBet * 3, bb * 3), bb);
      }
      return call;
    }
    if (bigBet) return chen >= 9 ? call : passive(legal);
    if (chen >= playable) return call;
    if (toCall <= bb && rng.next() < 0.5) return call;
    return passive(legal);
  }

  const cat = evaluate([...me.hole, ...view.board], false).category;
  if (toCall === 0) {
    const betChance =
      cat >= HandCategory.TWO_PAIR ? pers.aggression : cat === HandCategory.PAIR ? pers.aggression * 0.3 : 0;
    if (legal.canRaise && rng.next() < betChance) return raiseTo(legal, pot / 3, bb);
    return { type: 'check' };
  }
  if (cat >= HandCategory.TRIPS && legal.canRaise && rng.next() < pers.aggression * 0.5) {
    return raiseTo(legal, view.currentBet * 2.5, bb);
  }
  if (cat >= HandCategory.TWO_PAIR) return call;
  if (cat === HandCategory.PAIR) return !bigBet || rng.next() < 0.3 ? call : passive(legal);
  const station = 0.1 + (1 - pers.tightness) * 0.25;
  if (toCall <= pot * 0.5 && rng.next() < station) return call;
  return passive(legal);
}
