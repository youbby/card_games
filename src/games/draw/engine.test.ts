import { describe, expect, it } from 'vitest';
import { createRng } from '../../core/rng';
import { applyAction, legalActions, startHand } from '../holdem/engine';
import { drawBotDecide } from './ai';

describe('five card draw', () => {
  it('deals five private cards, reaches a draw after betting, then a final betting round', () => {
    let { state } = startHand({
      variant: 'draw',
      players: [
        { id: 'a', name: 'a', stack: 1000 },
        { id: 'b', name: 'b', stack: 1000 },
      ],
      button: 0,
      sb: 10,
      bb: 20,
      rng: createRng(1),
    });
    expect(state.players.every((p) => p.hole.length === 5)).toBe(true);
    state = applyAction(state, { type: 'call' }).state;
    state = applyAction(state, { type: 'check' }).state;
    expect(state.street).toBe('DRAW');
    expect(() => applyAction(state, { type: 'draw', indices: [1, 1] })).toThrow();
    const ownDiscarded = [...state.players[state.toAct].hole];
    const actor = state.toAct;
    state = applyAction(state, { type: 'draw', indices: [0, 1, 2, 3, 4] }).state;
    expect(state.players[actor].hole.every((card) => !ownDiscarded.includes(card))).toBe(true);
    state = applyAction(state, { type: 'draw', indices: [] }).state;
    expect(state.street).toBe('RIVER');
    expect(state.board).toEqual([]);
    state = applyAction(state, { type: 'check' }).state;
    state = applyAction(state, { type: 'check' }).state;
    expect(state.result?.showdown).toBe(true);
    expect(state.players.reduce((sum, p) => sum + p.stack, 0)).toBe(2000);
  });
  it('all-in players still exchange and resolve five-card hands', () => {
    let { state } = startHand({
      variant: 'draw',
      players: [
        { id: 'a', name: 'a', stack: 10 },
        { id: 'b', name: 'b', stack: 20 },
      ],
      button: 0,
      sb: 10,
      bb: 20,
      rng: createRng(2),
    });
    expect(state.street).toBe('DRAW');
    state = applyAction(state, { type: 'draw', indices: [] }).state;
    state = applyAction(state, { type: 'draw', indices: [] }).state;
    expect(state.result).not.toBeNull();
    expect(state.result!.hands.every((hand) => hand?.best.length === 5)).toBe(true);
  });
  it('recycles prior discards without duplicates or returning the current discard', () => {
    let { state } = startHand({
      variant: 'draw',
      players: Array.from({ length: 6 }, (_, i) => ({ id: `${i}`, name: `${i}`, stack: 1000 })),
      button: 0,
      sb: 10,
      bb: 20,
      rng: createRng(3),
    });
    while (state.street !== 'DRAW')
      state = applyAction(state, legalActions(state).canCall ? { type: 'call' } : { type: 'check' }).state;
    for (let i = 0; i < 6; i++) {
      const actor = state.toAct;
      const discarded = [...state.players[actor].hole];
      state = applyAction(state, { type: 'draw', indices: [0, 1, 2, 3, 4] }).state;
      expect(state.players[actor].hole.every((card) => !discarded.includes(card))).toBe(true);
      expect(new Set(state.players.flatMap((p) => p.hole)).size).toBe(30);
    }
  });
  it('finishes bot games for 2–6 players with varying stacks and conserves chips', { timeout: 30_000 }, () => {
    const rng = createRng(42);
    for (let players = 2; players <= 6; players++)
      for (let run = 0; run < 100; run++) {
        const seats = Array.from({ length: players }, (_, i) => ({
          id: `${i}`,
          name: `${i}`,
          stack: 10 + rng.int(990),
        }));
        let { state } = startHand({ variant: 'draw', players: seats, button: run % players, sb: 10, bb: 20, rng });
        let guard = 0;
        while (!state.result) {
          state = applyAction(
            state,
            drawBotDecide(state, { rng, personality: { tightness: 0.5, aggression: 0.5, bluff: 0.2 } }, run % 2 === 0),
          ).state;
          if (++guard > 300) throw new Error('Draw hand did not end');
        }
        expect(state.players.reduce((sum, p) => sum + p.stack, 0)).toBe(seats.reduce((sum, p) => sum + p.stack, 0));
      }
  });
});
