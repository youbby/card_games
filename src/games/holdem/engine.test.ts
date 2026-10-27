import { describe, expect, it } from 'vitest';
import { type Card, cardsFromString } from '../../core/cards';
import { createRng } from '../../core/rng';
import { applyAction, legalActions, potTotal, startHand, type Step } from './engine';
import { buildPots, splitPot } from './pots';
import type { Action, HandState } from './types';

const seats = (...stacks: number[]) => stacks.map((stack, i) => ({ id: `p${i}`, name: `P${i}`, stack }));

function start(stacks: number[], button = 0, sb = 10, bb = 20, seed = 1) {
  return startHand({ players: seats(...stacks), button, sb, bb, rng: createRng(seed) });
}

/** Overrides hole cards and the remaining deck so the outcome is known. */
function rig(state: HandState, holes: string[], board: string) {
  state.players.forEach((p, i) => (p.hole = cardsFromString(holes[i])));
  const used = new Set<Card>([...state.players.flatMap((p) => p.hole), ...cardsFromString(board)]);
  const rest = state.deck.filter((c) => !used.has(c));
  const b = cardsFromString(board);
  // Deck pops from the end: burn, flop x3, burn, turn, burn, river.
  const order = [rest[0], b[0], b[1], b[2], rest[1], b[3], rest[2], b[4]];
  state.deck = [...rest.slice(3), ...order.reverse()];
}

function act(step: Step, ...actions: Action[]): Step {
  let s = step;
  for (const a of actions) s = applyAction(s.state, a);
  return s;
}

const fold: Action = { type: 'fold' };
const check: Action = { type: 'check' };
const call: Action = { type: 'call' };
const raise = (to: number): Action => ({ type: 'raise', to });

function totalChips(s: HandState) {
  return s.players.reduce((sum, p) => sum + p.stack, 0) + (s.result ? 0 : potTotal(s));
}

describe('blinds and action order', () => {
  it('3-handed: SB/BB left of button, UTG acts first preflop', () => {
    const { state } = start([1000, 1000, 1000], 0);
    expect(state.sbIndex).toBe(1);
    expect(state.bbIndex).toBe(2);
    expect(state.toAct).toBe(0);
    expect(potTotal(state)).toBe(30);
  });

  it('heads-up: button is SB and acts first preflop, BB acts first postflop', () => {
    const step = start([1000, 1000], 0);
    expect(step.state.sbIndex).toBe(0);
    expect(step.state.bbIndex).toBe(1);
    expect(step.state.toAct).toBe(0);
    const after = act(step, call, check);
    expect(after.state.street).toBe('FLOP');
    expect(after.state.toAct).toBe(1);
  });

  it('BB gets the option when everyone limps', () => {
    const step = act(start([1000, 1000, 1000], 0), call, call);
    expect(step.state.street).toBe('PREFLOP');
    expect(step.state.toAct).toBe(2);
    const legal = legalActions(step.state);
    expect(legal.canCheck).toBe(true);
    expect(legal.canRaise).toBe(true);
  });

  it('postflop action starts left of the button', () => {
    const step = act(start([1000, 1000, 1000], 0), call, call, check);
    expect(step.state.street).toBe('FLOP');
    expect(step.state.board).toHaveLength(3);
    expect(step.state.toAct).toBe(1);
  });
});

describe('raises', () => {
  it('min raise is the last raise increment', () => {
    const step = act(start([5000, 5000, 5000], 0), raise(60)); // +40 over BB
    expect(legalActions(step.state).minRaiseTo).toBe(100);
    const step2 = act(step, raise(200)); // +140
    expect(legalActions(step2.state).minRaiseTo).toBe(340);
  });

  it('undersized raise is coerced to the minimum', () => {
    const step = act(start([5000, 5000, 5000], 0), raise(25));
    expect(step.state.players[0].bet).toBe(40);
  });

  it('incomplete all-in raise does not reopen betting', () => {
    // P0 raises to 100, P1 (SB) calls, P2 (BB) shoves 130 total: +30 < 80.
    const step = act(start([5000, 5000, 130], 0), raise(100), call, raise(130));
    expect(step.state.players[2].allIn).toBe(true);
    expect(step.state.toAct).toBe(0);
    const legal = legalActions(step.state);
    expect(legal.canCall).toBe(true);
    expect(legal.callAmount).toBe(30);
    expect(legal.canRaise).toBe(false);
  });

  it('full all-in raise reopens betting', () => {
    const step = act(start([5000, 5000, 300], 0), raise(100), call, raise(300));
    expect(legalActions(step.state).canRaise).toBe(true);
  });

  it('cannot raise when everyone else is all-in', () => {
    const step = act(start([5000, 200], 0), raise(1000), raise(200));
    // P1 had only 200 → called all-in for less; the board runs out and P0 gets 800 back.
    expect(step.state.result).not.toBeNull();
    expect(step.state.result!.pots.at(-1)).toMatchObject({ amount: 800, winners: [0] });
  });
});

describe('hand endings', () => {
  it('everyone folds to the BB', () => {
    const step = act(start([1000, 1000, 1000], 0), fold, fold);
    const r = step.state.result!;
    expect(r.showdown).toBe(false);
    expect(r.net).toEqual([0, -10, 10]);
  });

  it('uncalled bet is returned', () => {
    const step = act(start([1000, 1000], 0), raise(500), fold);
    expect(step.state.result!.net).toEqual([20, -20]);
  });

  it('all-in preflop runs out the board', () => {
    const step = act(start([1000, 1000], 0), raise(1000), call);
    expect(step.state.board).toHaveLength(5);
    expect(step.state.result!.showdown).toBe(true);
    expect(totalChips(step.state)).toBe(2000);
  });

  it('side pots with three different stacks', () => {
    const step = start([300, 600, 1000], 0);
    // P0 has the best hand, P1 second, P2 worst.
    rig(step.state, ['As Ad', 'Ks Kd', 'Qs Qd'], '2c 7h 9d Jc 3s');
    const end = act(step, raise(300), raise(600), raise(1000));
    const r = end.state.result!;
    // P2 cannot raise (everyone else is all-in), so it only calls 600.
    expect(r.pots.map((p) => p.amount)).toEqual([900, 600]);
    expect(r.pots.map((p) => p.winners)).toEqual([[0], [1]]);
    expect(end.state.players.map((p) => p.stack)).toEqual([900, 600, 400]);
  });

  it('best hand wins both main and side pot', () => {
    const step = start([300, 1000, 1000], 0);
    // P0 and P1 make the same straight, but P2 has a heart flush.
    rig(step.state, ['2c 3c', '2d 3d', 'Ah Kh'], 'Ts Jh Qh 9h 8s');
    const end = act(step, raise(300), call, call, check, check, check, check, check, check);
    const r = end.state.result!;
    // P2 makes the heart flush and wins everything.
    expect(r.pots[0].winners).toEqual([2]);
    expect(totalChips(end.state)).toBe(2300);
  });

  it('chopped pot', () => {
    const step = start([1000, 1000], 0);
    rig(step.state, ['2c 3d', '2d 3c'], 'As Ks Qd Jc Th');
    const end = act(step, call, check, check, check, check, check, check, check);
    expect(end.state.result!.net).toEqual([0, 0]);
  });
});

describe('pots', () => {
  it('buildPots merges slices with the same eligible players', () => {
    expect(buildPots([100, 100, 100], [false, false, false])).toEqual([{ amount: 300, eligible: [0, 1, 2] }]);
  });

  it('folded chips go to the pot but folded players are not eligible', () => {
    expect(buildPots([50, 200, 200], [true, false, false])).toEqual([{ amount: 450, eligible: [1, 2] }]);
  });

  it('odd chip goes to the first winner left of the button', () => {
    expect(splitPot(101, [0, 2], 1, 3)).toEqual([50, 51]);
    expect(splitPot(101, [0, 2], 2, 3)).toEqual([51, 50]);
  });
});

describe('random play invariants', () => {
  it('chips are conserved and hands always finish', () => {
    const rng = createRng(42);
    for (let hand = 0; hand < 3000; hand++) {
      const n = 2 + rng.int(5);
      const stacks = Array.from({ length: n }, () => 1 + rng.int(3000));
      let step = start(stacks, rng.int(n), 10, 20, hand + 1);
      const total = stacks.reduce((a, b) => a + b, 0);
      let guard = 0;
      while (!step.state.result) {
        const legal = legalActions(step.state);
        const roll = rng.next();
        let a: Action;
        if (legal.canRaise && roll < 0.25) {
          a = raise(legal.minRaiseTo + rng.int(legal.maxRaiseTo - legal.minRaiseTo + 1));
        } else if (roll < 0.4 && legal.canFold) a = fold;
        else a = legal.canCall ? call : check;
        step = applyAction(step.state, a);
        expect(++guard).toBeLessThan(200);
      }
      expect(step.state.players.reduce((s, p) => s + p.stack, 0)).toBe(total);
      expect(step.state.players.every((p) => p.stack >= 0)).toBe(true);
    }
  });
});
