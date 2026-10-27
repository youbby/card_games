import { legalActions, potTotal } from '../engine';
import type { Action, HandState, LegalActions } from '../types';

/** A copy of the hand state with everything a seat must not see removed. */
export function maskedView(state: HandState, seat: number): HandState {
  return {
    ...state,
    deck: [],
    players: state.players.map((p, i) => ({ ...p, hole: i === seat ? [...p.hole] : [] })),
    actions: [...state.actions],
    board: [...state.board],
  };
}

/** Raise to `target` total, rounded to the big blind and clamped; near-stack sizes become all-in. */
export function raiseTo(legal: LegalActions, target: number, bb: number): Action {
  let to = Math.round(target / bb) * bb;
  to = Math.max(legal.minRaiseTo, Math.min(to, legal.maxRaiseTo));
  if (to >= legal.maxRaiseTo * 0.85) to = legal.maxRaiseTo;
  return { type: 'raise', to };
}

export function passive(legal: LegalActions): Action {
  return legal.canCheck ? { type: 'check' } : { type: 'fold' };
}

export interface Situation {
  legal: LegalActions;
  pot: number;
  toCall: number;
  stack: number;
  /** Live opponents still in the hand. */
  opponents: number;
}

export function situation(view: HandState): Situation {
  const legal = legalActions(view);
  const me = view.players[view.toAct];
  return {
    legal,
    pot: potTotal(view),
    toCall: legal.callAmount,
    stack: me.stack,
    opponents: view.players.filter((p, i) => i !== view.toAct && !p.folded).length,
  };
}
