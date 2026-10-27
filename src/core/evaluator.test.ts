import { describe, expect, it } from 'vitest';
import { cardsFromString, cardToString } from './cards';
import { evaluate, HandCategory } from './evaluator';

const ev = (s: string) => evaluate(cardsFromString(s));

describe('evaluate', () => {
  it.each([
    ['As Ks Qs Js Ts 2d 3c', HandCategory.STRAIGHT_FLUSH, '로열 플러시'],
    ['9h 8h 7h 6h 5h Ad Ac', HandCategory.STRAIGHT_FLUSH, '스트레이트 플러시'],
    ['Ah 2h 3h 4h 5h Kd Kc', HandCategory.STRAIGHT_FLUSH, '스트레이트 플러시'],
    ['Qs Qh Qd Qc 2s 3s 4h', HandCategory.QUADS, '포카드'],
    ['Ks Kh Kd 2c 2s 3s 4h', HandCategory.FULL_HOUSE, '풀하우스'],
    ['Ks Kh Kd 2c 2s 2h 4h', HandCategory.FULL_HOUSE, '풀하우스'],
    ['As 9s 7s 4s 2s Kd Qc', HandCategory.FLUSH, '플러시'],
    ['Ad 2s 3h 4c 5d Kd Qc', HandCategory.STRAIGHT, '스트레이트'],
    ['Td Js Qh Kc Ad 2d 3c', HandCategory.STRAIGHT, '스트레이트'],
    ['7d 7s 7h Kc 2d 4d 9c', HandCategory.TRIPS, '트리플'],
    ['7d 7s Kh Kc 2d 2h 9c', HandCategory.TWO_PAIR, '투페어'],
    ['7d 7s Kh Qc 2d 4h 9c', HandCategory.PAIR, '원페어'],
    ['7d 8s Kh Qc 2d 4h 9c', HandCategory.HIGH_CARD, '하이카드'],
  ])('%s → %s', (cards, category, name) => {
    const v = ev(cards);
    expect(v.category).toBe(category);
    expect(v.name).toBe(name);
    expect(v.best).toHaveLength(5);
  });

  it('wheel straight is the lowest straight', () => {
    expect(ev('Ad 2s 3h 4c 5d').score).toBeLessThan(ev('2d 3s 4h 5c 6d').score);
  });

  it('uses the higher of two trips for a full house', () => {
    const v = ev('Ks Kh Kd 2c 2s 2h 4h');
    expect(v.ranks).toEqual([13, 13, 13, 2, 2]);
  });

  it('two pair picks the top two pairs and best kicker', () => {
    const v = ev('Ad As Kh Kc 2d 2h 9c');
    expect(v.ranks).toEqual([14, 14, 13, 13, 9]);
  });

  it('kickers decide equal pairs', () => {
    expect(ev('As Ad Kh 7c 5d').score).toBeGreaterThan(ev('Ac Ah Qh 7d 5c').score);
  });

  it('identical boards tie', () => {
    const board = 'As Ks Qd Jc Th';
    expect(ev(`2c 3d ${board}`).score).toBe(ev(`4c 5d ${board}`).score);
  });

  it('flush best cards are all of the flush suit', () => {
    const v = ev('As 9s 7s 4s 2s 3s Kd');
    expect(v.best.map(cardToString).sort()).toEqual(['4s', '7s', '9s', 'As', '3s'].sort());
  });

  it('category ordering', () => {
    const order = [
      '7d 8s Kh Qc 2d',
      '7d 7s Kh Qc 2d',
      '7d 7s Kh Kc 2d',
      '7d 7s 7h Kc 2d',
      '3d 4s 5h 6c 7d',
      'As 9s 7s 4s 2s',
      'Ks Kh Kd 2c 2s',
      'Qs Qh Qd Qc 2s',
      '9h 8h 7h 6h 5h',
    ].map((c) => ev(c).score);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });
});
