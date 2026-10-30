import { fullDeck, rankOf, type Card } from '../../core/cards';
import { shuffle, type Rng } from '../../core/rng';
import type { BaccaratBet, BaccaratRound, BlackjackAction, BlackjackHand, BlackjackRound } from './types';

const SHOE_DECKS = 6;

export function makeShoe(rng: Rng): Card[] {
  const cards = Array.from({ length: SHOE_DECKS }, () => fullDeck()).flat();
  return shuffle(cards, rng);
}

function take(deck: Card[]): Card {
  const card = deck.pop();
  if (card === undefined) throw new Error('카드가 부족합니다.');
  return card;
}

function validateBet(balance: number, bet: number) {
  if (!Number.isSafeInteger(bet) || bet <= 0 || bet > balance) throw new Error('베팅 금액을 확인하세요.');
}

// ── Blackjack ────────────────────────────────────────────────────────────

/** Points a single card is worth, counting an ace as 1. */
function cardPoints(card: Card): number {
  const rank = rankOf(card);
  return rank === 14 ? 1 : Math.min(10, rank);
}

export function blackjackValue(cards: Card[]): { total: number; soft: boolean } {
  let total = 0;
  let aces = 0;
  for (const card of cards) {
    total += cardPoints(card);
    if (rankOf(card) === 14) aces++;
  }
  // One ace may count as 11 instead of 1.
  const soft = aces > 0 && total + 10 <= 21;
  return { total: soft ? total + 10 : total, soft };
}

/** Two-card 21 on an unsplit hand. */
const isNatural = (cards: Card[]) => cards.length === 2 && blackjackValue(cards).total === 21;
const isNaturalHand = (hand: BlackjackHand) => !hand.split && isNatural(hand.cards);

/** Insurance costs half the original bet and pays 2:1 when the dealer has blackjack. */
export function insuranceCost(round: BlackjackRound): number {
  return Math.floor(round.hands[0].bet / 2);
}

export function startBlackjack(deck: Card[], balance: number, bet: number): BlackjackRound {
  validateBet(balance, bet);
  const shoe = [...deck];
  // Deal order: player, dealer (face up), player, dealer (face down).
  const cards = [take(shoe)];
  const dealer = [take(shoe)];
  cards.push(take(shoe));
  dealer.push(take(shoe));

  const round: BlackjackRound = {
    kind: 'blackjack',
    phase: 'player',
    deck: shoe,
    dealer,
    hands: [{ cards, bet, stood: false, split: false, splitAces: false }],
    activeHand: 0,
    insurance: 0,
    balance: balance - bet,
    startBalance: balance,
    totalBet: bet,
  };

  if (rankOf(dealer[0]) === 14) {
    // An ace showing: offer insurance (even money with a blackjack) before the dealer peeks.
    round.phase = 'insurance';
  } else {
    peekAndSettleNaturals(round);
  }
  return round;
}

/** The dealer checks the hole card; any blackjack ends the round at once. */
function peekAndSettleNaturals(round: BlackjackRound) {
  if (isNatural(round.dealer) || isNatural(round.hands[0].cards)) finishBlackjack(round);
  else round.phase = 'player';
}

export function blackjackActions(round: BlackjackRound): BlackjackAction[] {
  if (round.phase === 'insurance') {
    const cost = insuranceCost(round);
    return cost > 0 && round.balance >= cost ? ['insurance', 'noInsurance'] : ['noInsurance'];
  }
  if (round.phase !== 'player') return [];

  const hand = round.hands[round.activeHand];
  const actions: BlackjackAction[] = ['hit', 'stand'];
  const firstTwoCards = hand.cards.length === 2 && !hand.splitAces;
  if (firstTwoCards && round.balance >= hand.bet) {
    actions.push('double');
    // Any two cards of the same value split: 8-8, K-Q, A-A …
    const [a, b] = hand.cards;
    if (round.hands.length < 4 && cardPoints(a) === cardPoints(b)) actions.push('split');
  }
  // Late surrender: only as the very first decision of the round.
  if (round.hands.length === 1 && hand.cards.length === 2 && !hand.split) actions.push('surrender');
  return actions;
}

export function actBlackjack(previous: BlackjackRound, action: BlackjackAction): BlackjackRound {
  if (!blackjackActions(previous).includes(action)) throw new Error('지금 할 수 없는 행동입니다.');
  const round: BlackjackRound = structuredClone(previous);

  if (action === 'insurance' || action === 'noInsurance') {
    if (action === 'insurance') {
      const cost = insuranceCost(round);
      round.insurance = cost;
      round.balance -= cost;
      round.totalBet += cost;
    }
    peekAndSettleNaturals(round);
    return round;
  }

  const hand = round.hands[round.activeHand];
  switch (action) {
    case 'hit':
      hand.cards.push(take(round.deck));
      if (blackjackValue(hand.cards).total >= 21) hand.stood = true;
      break;
    case 'stand':
      hand.stood = true;
      break;
    case 'double':
      round.balance -= hand.bet;
      round.totalBet += hand.bet;
      hand.bet *= 2;
      hand.cards.push(take(round.deck));
      hand.stood = true;
      break;
    case 'split': {
      round.balance -= hand.bet;
      round.totalBet += hand.bet;
      const aces = rankOf(hand.cards[0]) === 14;
      // Split aces get one card each and stand.
      const splitHands = hand.cards.map((card): BlackjackHand => ({
        cards: [card, take(round.deck)],
        bet: hand.bet,
        split: true,
        splitAces: aces,
        stood: aces,
      }));
      round.hands.splice(round.activeHand, 1, ...splitHands);
      break;
    }
    case 'surrender':
      hand.surrendered = true;
      hand.stood = true;
      break;
  }

  const next = round.hands.findIndex((candidate) => !candidate.stood && blackjackValue(candidate.cards).total < 21);
  if (next < 0) finishBlackjack(round);
  else round.activeHand = next;
  return round;
}

function finishBlackjack(round: BlackjackRound): void {
  const dealerNatural = isNatural(round.dealer);
  // The dealer only draws when a hand still needs to be beaten.
  const needsDealer = round.hands.some(
    (hand) => !hand.surrendered && !isNaturalHand(hand) && blackjackValue(hand.cards).total <= 21,
  );
  if (!dealerNatural && needsDealer) {
    while (blackjackValue(round.dealer).total < 17) round.dealer.push(take(round.deck));
  }
  const dealerTotal = blackjackValue(round.dealer).total;

  for (const hand of round.hands) {
    const total = blackjackValue(hand.cards).total;
    let payout = 0;
    if (hand.surrendered) {
      payout = Math.floor(hand.bet / 2);
      hand.result = '서렌더';
    } else if (total > 21) {
      hand.result = '버스트';
    } else if (dealerNatural) {
      payout = isNaturalHand(hand) ? hand.bet : 0;
      hand.result = payout ? '무승부' : '패배';
    } else if (isNaturalHand(hand)) {
      payout = hand.bet + Math.floor(hand.bet * 1.5);
      hand.result = '블랙잭';
    } else if (dealerTotal > 21 || total > dealerTotal) {
      payout = hand.bet * 2;
      hand.result = '승리';
    } else if (total === dealerTotal) {
      payout = hand.bet;
      hand.result = '무승부';
    } else {
      hand.result = '패배';
    }
    hand.payout = payout;
    round.balance += payout;
  }

  const insurance = round.insurance ?? 0;
  round.insurancePayout = dealerNatural ? insurance * 3 : 0;
  round.balance += round.insurancePayout;
  round.phase = 'done';
}

// ── Baccarat ─────────────────────────────────────────────────────────────

export function baccaratValue(cards: Card[]): number {
  const points = (card: Card) => {
    const rank = rankOf(card);
    if (rank === 14) return 1;
    return rank >= 10 ? 0 : rank;
  };
  return cards.reduce((total, card) => total + points(card), 0) % 10;
}

/** Standard banker third-card rule. `playerThird` is null when the player stood on two cards. */
export function bankerDraws(total: number, playerThird: number | null): boolean {
  if (playerThird === null) return total <= 5;
  if (total <= 2) return true;
  if (total === 3) return playerThird !== 8;
  if (total === 4) return playerThird >= 2 && playerThird <= 7;
  if (total === 5) return playerThird >= 4 && playerThird <= 7;
  return total === 6 && (playerThird === 6 || playerThird === 7);
}

/** Total returned for a winning bet: player 1:1, banker 0.95:1, tie 8:1 (fractions of a chip are dropped). */
function baccaratWinPayout(choice: BaccaratBet, bet: number): number {
  if (choice === 'banker') return bet + Math.floor((bet * 95) / 100);
  if (choice === 'tie') return bet + bet * 8;
  return bet * 2;
}

export function playBaccarat(deck: Card[], balance: number, bet: number, choice: BaccaratBet): BaccaratRound {
  validateBet(balance, bet);
  if (!['player', 'banker', 'tie'].includes(choice)) throw new Error('베팅 대상을 선택하세요.');

  const shoe = [...deck];
  const player = [take(shoe)];
  const dealer = [take(shoe)];
  player.push(take(shoe));
  dealer.push(take(shoe));

  const playerTotal = baccaratValue(player);
  const dealerTotal = baccaratValue(dealer);
  // A natural 8 or 9 on either side ends the drawing.
  if (playerTotal < 8 && dealerTotal < 8) {
    let playerThird: number | null = null;
    if (playerTotal <= 5) {
      player.push(take(shoe));
      playerThird = baccaratValue([player[2]]);
    }
    if (bankerDraws(dealerTotal, playerThird)) dealer.push(take(shoe));
  }

  const p = baccaratValue(player);
  const d = baccaratValue(dealer);
  const winner: BaccaratBet = p === d ? 'tie' : p > d ? 'player' : 'banker';
  let payout = 0;
  if (choice === winner) payout = baccaratWinPayout(choice, bet);
  else if (winner === 'tie') payout = bet; // player/banker bets push on a tie

  return {
    kind: 'baccarat',
    phase: 'done',
    deck: shoe,
    player,
    dealer,
    choice,
    winner,
    bet,
    payout,
    balance: balance - bet + payout,
    startBalance: balance,
    totalBet: bet,
  };
}
