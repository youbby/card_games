import { describe, expect, it } from 'vitest';
import { cardsFromString as cards } from '../../core/cards';
import { createRng } from '../../core/rng';
import { applyAction, legalActions, startHand } from '../holdem/engine';
import { drawBotDecide, standardDiscards } from './ai';

describe('draw strategy', () => {
  it('stands pat on a straight or better', () => {
    expect(standardDiscards(cards('9s 8h 7d 6c 5s'))).toEqual([]);
    expect(standardDiscards(cards('Ks Kh 4d 4c 4s'))).toEqual([]);
  });
  it('keeps made hands and draws to them', () => {
    expect(standardDiscards(cards('Ks Kh 4d 4c 9s'))).toEqual([4]);
    expect(standardDiscards(cards('7s 7h 7d Kc 2s'))).toEqual([3, 4]);
    expect(standardDiscards(cards('Qs Qh 9d 5c 2s'))).toEqual([2, 3, 4]);
  });
  it('chases a flush with a low pair, but keeps a high pair', () => {
    expect(standardDiscards(cards('4h 4s 9h Kh 2h'))).toEqual([1]);
    expect(standardDiscards(cards('Qh Qs 9h Kh 2h'))).toEqual([2, 3, 4]);
  });
  it('draws one card to four-flushes and open-ended straights', () => {
    expect(standardDiscards(cards('Ah 9h 6h 3h Ks'))).toEqual([4]);
    expect(standardDiscards(cards('9s 8h 7d 6c Ks'))).toEqual([4]);
  });
  it('keeps only an ace or king with nothing else', () => {
    expect(standardDiscards(cards('As 9h 6d 3c 2s'))).toEqual([1, 2, 3, 4]);
    expect(standardDiscards(cards('Ts 9h 6d 3c 2s'))).toEqual([0, 1, 2, 3, 4]);
  });
});

describe('draw bots', () => {
  it('only ever choose legal actions and finish every hand', () => {
    const rng = createRng(11);
    const personality = { tightness: 0.5, aggression: 0.6, bluff: 0.3 };
    for (let h = 0; h < 40; h++) {
      let { state } = startHand({
        variant: 'draw',
        players: Array.from({ length: 4 }, (_, i) => ({ id: `${i}`, name: `${i}`, stack: 2000 })),
        button: h % 4,
        sb: 10,
        bb: 20,
        rng,
      });
      for (let guard = 0; !state.result; guard++) {
        expect(guard).toBeLessThan(200);
        const action = drawBotDecide(state, { personality, rng }, state.toAct % 2 === 0);
        if (action.type === 'raise') {
          const legal = legalActions(state);
          expect(legal.canRaise).toBe(true);
          expect(action.to).toBeGreaterThanOrEqual(legal.minRaiseTo);
          expect(action.to).toBeLessThanOrEqual(legal.maxRaiseTo);
        }
        state = applyAction(state, action).state;
      }
      expect(state.players.reduce((sum, p) => sum + p.stack, 0)).toBe(8000);
    }
  });
});
