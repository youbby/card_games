import { fullDeck, rankOf, type Card } from '../../core/cards';
import { shuffle, type Rng } from '../../core/rng';
import type { BaccaratBet, BaccaratRound, BlackjackAction, BlackjackHand, BlackjackRound } from './types';

export function makeShoe(rng: Rng): Card[] { return shuffle(Array.from({ length: 6 }, () => fullDeck()).flat(), rng); }
export function blackjackValue(cards: Card[]): { total: number; soft: boolean } {
  let total = 0, aces = 0;
  for (const card of cards) { const rank = rankOf(card); total += rank === 14 ? 1 : Math.min(10, rank); if (rank === 14) aces++; }
  const soft = aces > 0 && total + 10 <= 21;
  return { total: total + (soft ? 10 : 0), soft };
}
const natural = (cards: Card[]) => cards.length === 2 && blackjackValue(cards).total === 21;
function take(deck: Card[]): Card { const card = deck.pop(); if (card === undefined) throw new Error('카드가 부족합니다.'); return card; }
function validateBet(balance: number, bet: number) {
  if (!Number.isSafeInteger(bet) || bet <= 0 || bet > balance) throw new Error('베팅 금액을 확인하세요.');
}
export function startBlackjack(deck: Card[], balance: number, bet: number): BlackjackRound {
  validateBet(balance, bet);
  const shoe = [...deck];
  const cards = [take(shoe)], dealer = [take(shoe)];
  cards.push(take(shoe)); dealer.push(take(shoe));
  const round: BlackjackRound = {
    kind: 'blackjack', phase: 'player', deck: shoe, dealer,
    hands: [{ cards, bet, stood: false, split: false, splitAces: false }],
    activeHand: 0, balance: balance - bet, startBalance: balance, totalBet: bet,
  };
  if (natural(dealer) || natural(cards)) finishBlackjack(round);
  return round;
}
export function blackjackActions(round: BlackjackRound): BlackjackAction[] {
  if (round.phase !== 'player') return [];
  const hand = round.hands[round.activeHand];
  const actions: BlackjackAction[] = ['hit', 'stand'];
  if (hand.cards.length === 2 && !hand.splitAces && round.balance >= hand.bet) {
    actions.push('double');
    if (round.hands.length < 4 && rankOf(hand.cards[0]) === rankOf(hand.cards[1])) actions.push('split');
  }
  return actions;
}
export function actBlackjack(previous: BlackjackRound, action: BlackjackAction): BlackjackRound {
  if (!blackjackActions(previous).includes(action)) throw new Error('지금 할 수 없는 행동입니다.');
  const round: BlackjackRound = structuredClone(previous);
  const hand = round.hands[round.activeHand];
  if (action === 'hit') { hand.cards.push(take(round.deck)); if (blackjackValue(hand.cards).total >= 21) hand.stood = true; }
  if (action === 'stand') hand.stood = true;
  if (action === 'double') {
    round.balance -= hand.bet; round.totalBet += hand.bet; hand.bet *= 2;
    hand.cards.push(take(round.deck)); hand.stood = true;
  }
  if (action === 'split') {
    round.balance -= hand.bet; round.totalBet += hand.bet;
    const aces = rankOf(hand.cards[0]) === 14;
    const splitHands = hand.cards.map((card): BlackjackHand => ({
      cards: [card, take(round.deck)], bet: hand.bet, split: true, splitAces: aces, stood: aces,
    }));
    round.hands.splice(round.activeHand, 1, ...splitHands);
  }
  const next = round.hands.findIndex((candidate) => !candidate.stood && blackjackValue(candidate.cards).total < 21);
  if (next < 0) finishBlackjack(round); else round.activeHand = next;
  return round;
}
function finishBlackjack(round: BlackjackRound): void {
  const dealerNatural = natural(round.dealer);
  if (!dealerNatural && round.hands.some((hand) => blackjackValue(hand.cards).total <= 21 && !(natural(hand.cards) && !hand.split))) {
    while (blackjackValue(round.dealer).total < 17) round.dealer.push(take(round.deck));
  }
  const dealerTotal = blackjackValue(round.dealer).total;
  for (const hand of round.hands) {
    const total = blackjackValue(hand.cards).total;
    let payout = 0;
    if (total > 21) hand.result = '버스트';
    else if (dealerNatural) { payout = natural(hand.cards) && !hand.split ? hand.bet : 0; hand.result = payout ? '무승부' : '패배'; }
    else if (natural(hand.cards) && !hand.split) { payout = hand.bet + Math.floor(hand.bet * 1.5); hand.result = '블랙잭'; }
    else if (dealerTotal > 21 || total > dealerTotal) { payout = hand.bet * 2; hand.result = '승리'; }
    else if (total === dealerTotal) { payout = hand.bet; hand.result = '무승부'; }
    else hand.result = '패배';
    hand.payout = payout; round.balance += payout;
  }
  round.phase = 'done';
}

export function baccaratValue(cards: Card[]): number { return cards.reduce((total, card) => total + (rankOf(card) === 14 ? 1 : rankOf(card) >= 10 ? 0 : rankOf(card)), 0) % 10; }
export function bankerDraws(total: number, playerThird: number | null): boolean {
  if (playerThird === null) return total <= 5;
  if (total <= 2) return true;
  if (total === 3) return playerThird !== 8;
  if (total === 4) return playerThird >= 2 && playerThird <= 7;
  if (total === 5) return playerThird >= 4 && playerThird <= 7;
  return total === 6 && (playerThird === 6 || playerThird === 7);
}
export function playBaccarat(deck: Card[], balance: number, bet: number, choice: BaccaratBet): BaccaratRound {
  validateBet(balance, bet);
  if (!['player', 'banker', 'tie'].includes(choice)) throw new Error('베팅 대상을 선택하세요.');
  const shoe = [...deck], player = [take(shoe)], dealer = [take(shoe)];
  player.push(take(shoe)); dealer.push(take(shoe));
  const playerTotal = baccaratValue(player), dealerTotal = baccaratValue(dealer);
  if (playerTotal < 8 && dealerTotal < 8) {
    let third: number | null = null;
    if (playerTotal <= 5) { player.push(take(shoe)); third = baccaratValue([player[2]]); }
    if (bankerDraws(dealerTotal, third)) dealer.push(take(shoe));
  }
  const p = baccaratValue(player), d = baccaratValue(dealer);
  const winner: BaccaratBet = p === d ? 'tie' : p > d ? 'player' : 'banker';
  let payout = 0;
  if (choice === winner) payout = bet + (choice === 'banker' ? Math.floor(bet * 95 / 100) : choice === 'tie' ? bet * 8 : bet);
  else if (winner === 'tie' && choice !== 'tie') payout = bet;
  return { kind: 'baccarat', phase: 'done', deck: shoe, player, dealer, choice, winner, bet, payout, balance: balance - bet + payout, startBalance: balance, totalBet: bet };
}
