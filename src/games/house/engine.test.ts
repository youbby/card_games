import { describe, expect, it } from 'vitest';
import { cardsFromString as cards, fullDeck } from '../../core/cards';
import { createRng } from '../../core/rng';
import { actBlackjack, baccaratValue, bankerDraws, blackjackActions, blackjackValue, makeShoe, playBaccarat, startBlackjack } from './engine';

const shoe = (sequence: string) => [...fullDeck(), ...cards(sequence).reverse()];
describe('blackjack rules and payouts', () => {
  it('counts aces without busting and recognizes soft 17', () => {
    expect(blackjackValue(cards('As 6h'))).toEqual({ total: 17, soft: true });
    expect(blackjackValue(cards('As Ah 9d'))).toEqual({ total: 21, soft: true });
    expect(blackjackValue(cards('As Ah 9d Kh'))).toEqual({ total: 21, soft: false });
  });
  it('pays natural blackjack 3:2 and pushes two naturals', () => {
    const win = startBlackjack(shoe('As 9h Kd 7c'), 1000, 200);
    expect(win.phase).toBe('done'); expect(win.balance).toBe(1300);
    expect(startBlackjack(shoe('As Ah Kd Tc'), 1000, 200).balance).toBe(1000);
    expect(startBlackjack(shoe('9s Ah 8d Tc'), 1000, 200).balance).toBe(800);
  });
  it('dealer stands on soft 17 and wins/pushes at normal odds', () => {
    const win = actBlackjack(startBlackjack(shoe('Ts Ah 8d 6c'), 1000, 200), 'stand');
    expect(win.dealer).toHaveLength(2); expect(win.balance).toBe(1200);
    expect(actBlackjack(startBlackjack(shoe('Ts Ah 7d 6c'), 1000, 200), 'stand').balance).toBe(1000);
  });
  it('double takes one card and settles twice the wager', () => {
    const result = actBlackjack(startBlackjack(shoe('5s 9h 6d 7c Kh 8s'), 1000, 200), 'double');
    expect(result.totalBet).toBe(400); expect(result.hands[0].cards).toHaveLength(3); expect(result.balance).toBe(1400);
  });
  it('split aces receive one card and split 21 pays only 1:1', () => {
    const result = actBlackjack(startBlackjack(shoe('As 9h Ad 7c Ks Qh 8s'), 1000, 200), 'split');
    expect(result.phase).toBe('done'); expect(result.hands).toHaveLength(2);
    expect(result.hands.every((hand) => hand.cards.length === 2)).toBe(true);
    expect(result.balance).toBe(1400);
  });
  it('does not allow additional wagers without available chips or further actions after settlement', () => {
    const round = startBlackjack(shoe('8s 9h 8d 7c'), 200, 200);
    expect(blackjackActions(round)).toEqual(['hit', 'stand']);
    expect(() => actBlackjack(round, 'split')).toThrow();
    const ended = actBlackjack(round, 'stand');
    expect(() => actBlackjack(ended, 'hit')).toThrow();
  });
  it('uses six complete decks', () => { expect(makeShoe(createRng(1))).toHaveLength(312); });
});
describe('baccarat rules and payouts', () => {
  it('uses last digit and counts faces as zero', () => { expect(baccaratValue(cards('As Th 9d'))).toBe(0); });
  it('covers all banker third-card cases', () => {
    for (let total = 0; total <= 9; total++) {
      expect(bankerDraws(total, null)).toBe(total <= 5);
      for (let third = 0; third <= 9; third++) {
        const expected = total <= 2 || total === 3 && third !== 8 || total === 4 && third >= 2 && third <= 7 || total === 5 && third >= 4 && third <= 7 || total === 6 && (third === 6 || third === 7);
        expect(bankerDraws(total, third)).toBe(expected);
      }
    }
  });
  it('natural ends without drawing and pays player/banker correctly', () => {
    const player = playBaccarat(shoe('4s 3h 5d 4c'), 1000, 200, 'player');
    expect(player.player).toHaveLength(2); expect(player.dealer).toHaveLength(2); expect(player.balance).toBe(1200);
    expect(playBaccarat(shoe('3s 4h 4d 5c'), 1000, 200, 'banker').balance).toBe(1190);
  });
  it('tie pays eight times profit and returns ordinary wagers', () => {
    expect(playBaccarat(shoe('4s 3h 4d 5c'), 1000, 200, 'tie').balance).toBe(2600);
    expect(playBaccarat(shoe('4s 3h 4d 5c'), 1000, 200, 'banker').balance).toBe(1000);
    expect(playBaccarat(shoe('4s 3h 4d 5c'), 1000, 200, 'player').balance).toBe(1000);
  });
  it('third card 8 makes banker 3 stand', () => {
    const result = playBaccarat(shoe('2s As 3d 2c 8h'), 1000, 20, 'player');
    expect(result.player).toHaveLength(3); expect(result.dealer).toHaveLength(2);
  });
});
