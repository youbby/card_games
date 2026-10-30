export type GameId = 'holdem' | 'draw' | 'baccarat' | 'blackjack';
export type PokerGameId = 'holdem' | 'draw';
export type HouseGameId = 'baccarat' | 'blackjack';
export const GAMES: { id: GameId; name: string; subtitle: string; icon: string }[] = [
  { id: 'holdem', name: '텍사스 홀덤', subtitle: '노리밋 · 2~6인', icon: '♠️' },
  { id: 'draw', name: '파이브 카드 드로우', subtitle: '카드 교환 · 2~6인', icon: '🃏' },
  { id: 'baccarat', name: '바카라', subtitle: '플레이어 · 뱅커 · 무승부', icon: '♦️' },
  { id: 'blackjack', name: '블랙잭', subtitle: '랜덤 딜러와 21에 도전', icon: '♣️' },
];
export const gameName = (id: GameId = 'holdem') => GAMES.find((game) => game.id === id)!.name;

/** Limits stop new rounds, never reduce a settled payout. Rebuys are not profit. */
export function profitTarget(initialBuyIn: number, deposits: number, multiplier?: number | null): number | null {
  return multiplier == null ? null : deposits + initialBuyIn * multiplier;
}
export function reachedProfitLimit(
  balance: number,
  initialBuyIn: number,
  deposits: number,
  multiplier?: number | null,
): boolean {
  const target = profitTarget(initialBuyIn, deposits, multiplier);
  return target !== null && balance >= target;
}
