/**
 * A card is an integer 0..51: rank = (card >> 2) + 2 (2..14), suit = card & 3.
 * Integers keep the evaluator and Monte Carlo simulations fast.
 */
export type Card = number;

export const SUIT_CHARS = ['s', 'h', 'd', 'c'] as const;
export const SUIT_SYMBOLS = ['♠', '♥', '♦', '♣'] as const;
const RANK_CHARS = '23456789TJQKA';

export function makeCard(rank: number, suit: number): Card {
  return ((rank - 2) << 2) | suit;
}

export function rankOf(card: Card): number {
  return (card >> 2) + 2;
}

export function suitOf(card: Card): number {
  return card & 3;
}

export function isRed(card: Card): boolean {
  const s = suitOf(card);
  return s === 1 || s === 2;
}

export function rankLabel(rank: number): string {
  return rank === 10 ? '10' : RANK_CHARS[rank - 2];
}

/** "As", "Td", "2c" */
export function cardToString(card: Card): string {
  return RANK_CHARS[rankOf(card) - 2] + SUIT_CHARS[suitOf(card)];
}

export function cardFromString(text: string): Card {
  const rank = RANK_CHARS.indexOf(text[0].toUpperCase()) + 2;
  const suit = SUIT_CHARS.indexOf(text[1].toLowerCase() as (typeof SUIT_CHARS)[number]);
  if (rank < 2 || suit < 0) throw new Error(`잘못된 카드 표기입니다: ${text}`);
  return makeCard(rank, suit);
}

export function cardsFromString(text: string): Card[] {
  return text.trim().split(/\s+/).filter(Boolean).map(cardFromString);
}

export function fullDeck(): Card[] {
  return Array.from({ length: 52 }, (_, i) => i);
}
