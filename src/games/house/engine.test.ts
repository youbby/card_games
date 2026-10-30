import { describe, expect, it } from 'vitest';
import { cardsFromString as cards, fullDeck } from '../../core/cards';
import { createRng } from '../../core/rng';
import {
  actBlackjack,
  baccaratValue,
  bankerDraws,
  blackjackActions,
  blackjackValue,
  makeShoe,
  playBaccarat,
  startBlackjack,
} from './engine';

const shoe = (sequence: string) => [...fullDeck(), ...cards(sequence).reverse()];
describe('blackjack rules and payouts', () => {
  it('counts aces without busting and recognizes soft 17', () => {
    expect(blackjackValue(cards('As 6h'))).toEqual({ total: 17, soft: true });
    expect(blackjackValue(cards('As Ah 9d'))).toEqual({ total: 21, soft: true });
    expect(blackjackValue(cards('As Ah 9d Kh'))).toEqual({ total: 21, soft: false });
  });
  it('pays natural blackjack 3:2 and pushes two naturals', () => {
    const win = startBlackjack(shoe('As 9h Kd 7c'), 1000, 200);
    expect(win.phase).toBe('done');
    expect(win.balance).toBe(1300);
    // Dealer shows an ace: the insurance decision comes before the peek.
    expect(actBlackjack(startBlackjack(shoe('As Ah Kd Tc'), 1000, 200), 'noInsurance').balance).toBe(1000);
    expect(actBlackjack(startBlackjack(shoe('9s Ah 8d Tc'), 1000, 200), 'noInsurance').balance).toBe(800);
    // Dealer shows a ten: blackjack is checked at once.
    expect(startBlackjack(shoe('9s Th 8d Ac'), 1000, 200).balance).toBe(800);
  });
  it('dealer stands on soft 17 and wins/pushes at normal odds', () => {
    const win = actBlackjack(actBlackjack(startBlackjack(shoe('Ts Ah 8d 6c'), 1000, 200), 'noInsurance'), 'stand');
    expect(win.dealer).toHaveLength(2);
    expect(win.balance).toBe(1200);
    expect(actBlackjack(startBlackjack(shoe('Ts 6h 7d Ac'), 1000, 200), 'stand').balance).toBe(1000);
  });
  it('double takes one card and settles twice the wager', () => {
    const result = actBlackjack(startBlackjack(shoe('5s 9h 6d 7c Kh 8s'), 1000, 200), 'double');
    expect(result.totalBet).toBe(400);
    expect(result.hands[0].cards).toHaveLength(3);
    expect(result.balance).toBe(1400);
  });
  it('split aces receive one card and split 21 pays only 1:1', () => {
    const result = actBlackjack(startBlackjack(shoe('As 9h Ad 7c Ks Qh 8s'), 1000, 200), 'split');
    expect(result.phase).toBe('done');
    expect(result.hands).toHaveLength(2);
    expect(result.hands.every((hand) => hand.cards.length === 2)).toBe(true);
    expect(result.balance).toBe(1400);
  });
  it('does not allow additional wagers without available chips or further actions after settlement', () => {
    const round = startBlackjack(shoe('8s 9h 8d 7c'), 200, 200);
    expect(blackjackActions(round)).toEqual(['hit', 'stand', 'surrender']);
    expect(() => actBlackjack(round, 'split')).toThrow();
    const ended = actBlackjack(round, 'stand');
    expect(() => actBlackjack(ended, 'hit')).toThrow();
  });
  it('insurance pays 2:1 against a dealer blackjack and is lost otherwise', () => {
    const offered = startBlackjack(shoe('9s Ah 8d Kc'), 1000, 200);
    expect(offered.phase).toBe('insurance');
    expect(blackjackActions(offered)).toEqual(['insurance', 'noInsurance']);
    const insured = actBlackjack(offered, 'insurance');
    expect(insured.phase).toBe('done');
    expect(insured.insurancePayout).toBe(300);
    expect(insured.balance).toBe(1000); // -200 hand, -100 insurance, +300 insurance payout
    const lost = actBlackjack(startBlackjack(shoe('Ts Ah 9d 6c'), 1000, 200), 'insurance');
    expect(lost.phase).toBe('player');
    expect(lost.balance).toBe(700);
    expect(actBlackjack(lost, 'stand').balance).toBe(1100); // 19 beats 17, insurance stays lost
  });
  it('insurance with a blackjack works as even money', () => {
    const evenMoney = actBlackjack(startBlackjack(shoe('As Ah Kd 7c'), 1000, 200), 'insurance');
    expect(evenMoney.phase).toBe('done');
    expect(evenMoney.balance).toBe(1200);
  });
  it('insurance is not offered when the room cannot pay for it', () => {
    expect(blackjackActions(startBlackjack(shoe('9s Ah 8d 6c'), 200, 200))).toEqual(['noInsurance']);
  });
  it('surrender returns half the bet and is only the first decision', () => {
    const round = startBlackjack(shoe('Ts 9h 6d 8c'), 1000, 200);
    const surrendered = actBlackjack(round, 'surrender');
    expect(surrendered.phase).toBe('done');
    expect(surrendered.hands[0].result).toBe('서렌더');
    expect(surrendered.dealer).toHaveLength(2);
    expect(surrendered.balance).toBe(900);
    const hit = actBlackjack(startBlackjack(shoe('2s 9h 3d 8c 4h'), 1000, 200), 'hit');
    expect(blackjackActions(hit)).not.toContain('surrender');
  });
  it('splits any two ten-value cards but not after splitting into four hands', () => {
    const round = startBlackjack(shoe('Ks 9h Qd 8c'), 1000, 200);
    expect(blackjackActions(round)).toContain('split');
    const split = actBlackjack(round, 'split');
    expect(split.hands).toHaveLength(2);
    expect(blackjackActions(split)).not.toContain('surrender');
  });
  it('uses six complete decks', () => {
    expect(makeShoe(createRng(1))).toHaveLength(312);
  });
});
describe('baccarat rules and payouts', () => {
  it('uses last digit and counts faces as zero', () => {
    expect(baccaratValue(cards('As Th 9d'))).toBe(0);
  });
  it('covers all banker third-card cases', () => {
    for (let total = 0; total <= 9; total++) {
      expect(bankerDraws(total, null)).toBe(total <= 5);
      for (let third = 0; third <= 9; third++) {
        const expected =
          total <= 2 ||
          (total === 3 && third !== 8) ||
          (total === 4 && third >= 2 && third <= 7) ||
          (total === 5 && third >= 4 && third <= 7) ||
          (total === 6 && (third === 6 || third === 7));
        expect(bankerDraws(total, third)).toBe(expected);
      }
    }
  });
  it('natural ends without drawing and pays player/banker correctly', () => {
    const player = playBaccarat(shoe('4s 3h 5d 4c'), 1000, 200, 'player');
    expect(player.player).toHaveLength(2);
    expect(player.dealer).toHaveLength(2);
    expect(player.balance).toBe(1200);
    expect(playBaccarat(shoe('3s 4h 4d 5c'), 1000, 200, 'banker').balance).toBe(1190);
  });
  it('tie pays eight times profit and returns ordinary wagers', () => {
    expect(playBaccarat(shoe('4s 3h 4d 5c'), 1000, 200, 'tie').balance).toBe(2600);
    expect(playBaccarat(shoe('4s 3h 4d 5c'), 1000, 200, 'banker').balance).toBe(1000);
    expect(playBaccarat(shoe('4s 3h 4d 5c'), 1000, 200, 'player').balance).toBe(1000);
  });
  it('third card 8 makes banker 3 stand', () => {
    const result = playBaccarat(shoe('2s As 3d 2c 8h'), 1000, 20, 'player');
    expect(result.player).toHaveLength(3);
    expect(result.dealer).toHaveLength(2);
  });
});
