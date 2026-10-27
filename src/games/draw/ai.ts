import { rankOf, suitOf } from '../../core/cards';
import { evaluate } from '../../core/evaluator';
import type { BotContext } from '../holdem/ai/types';
import { legalActions, potTotal } from '../holdem/engine';
import type { Action, HandState } from '../holdem/types';

/** Only the acting player's cards and public betting information influence the bot. */
export function drawBotDecide(hand: HandState, context: BotContext, high: boolean): Action {
  const cards = hand.players[hand.toAct].hole, value = evaluate(cards);
  if (hand.street === 'DRAW') {
    if (value.category >= 4) return { type: 'draw', indices: [] };
    const counts = new Map<number, number>();
    cards.forEach((card) => counts.set(rankOf(card), (counts.get(rankOf(card)) ?? 0) + 1));
    let keep = cards.map((card) => counts.get(rankOf(card))! >= 2);
    if (high && value.category === 0) {
      const suit = [0, 1, 2, 3].find((s) => cards.filter((card) => suitOf(card) === s).length === 4);
      if (suit !== undefined) keep = cards.map((card) => suitOf(card) === suit);
      else keep = cards.map((card) => rankOf(card) === Math.max(...cards.map(rankOf)));
    }
    return { type: 'draw', indices: keep.flatMap((held, index) => held ? [] : [index]) };
  }
  const legal = legalActions(hand), rng = context.rng;
  const strong = value.category >= 2 || (value.category === 1 && value.ranks[0] >= (high ? 10 : 12));
  if (legal.canRaise && (strong || (high && rng.next() < context.personality.bluff * 0.25))) {
    return { type: 'raise', to: Math.min(legal.maxRaiseTo, Math.max(legal.minRaiseTo, hand.currentBet + Math.max(hand.bb * 2, Math.round(potTotal(hand) * 0.5)))) };
  }
  if (legal.canCheck) return { type: 'check' };
  if (strong || legal.callAmount <= hand.bb * (high ? 3 : 5) || rng.next() < (high ? 0.12 : 0.35)) return { type: 'call' };
  return { type: 'fold' };
}
