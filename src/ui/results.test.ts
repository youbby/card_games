import { describe, expect, it } from 'vitest';
import { createRng } from '../core/rng';
import { startHand } from '../games/holdem/engine';
import type { PotResult } from '../games/holdem/types';
import type { BaccaratBet, BaccaratRound, BlackjackRound } from '../games/house/types';
import { houseResult, pokerResult } from './results';

function poker(net: number[], pots: PotResult[]) {
  const hand = startHand({ players: net.map((_, i) => ({ id: `${i}`, name: i === 0 ? '내이름' : `상대${i}`, stack: 1000 })), button: 0, sb: 10, bb: 20, rng: createRng(1) }).state;
  hand.result = { net, pots, showdown: false, hands: net.map(() => null), payouts: net.map(() => 0) };
  return hand;
}
const pot = (winners: number[], eligible = [0, 1]): PotResult => ({ amount: 40, winners, eligible, shares: winners.map(() => 20) });
function baccarat(choice: BaccaratBet, winner: BaccaratBet, net: number): BaccaratRound {
  return { kind: 'baccarat', phase: 'done', deck: [], player: [], dealer: [], choice, winner, bet: 100, payout: 100 + net, balance: 1000 + net, startBalance: 1000, totalBet: 100 };
}
describe('player-centered poker result', () => {
  it('names me as the winner rather than requiring recognition of my character name', () => {
    expect(pokerResult(poker([20, -20], [pot([0])]), 0)).toMatchObject({ title: '내 승리', tone: 'win', net: 20, detail: '승리자: 나 · 상대 전원 폴드' });
  });
  it('identifies the winning opponent and respects the human player index', () => {
    const summary = pokerResult(poker([-20, 20], [pot([1])]), 0)!;
    expect(summary.title).toBe('내 패배'); expect(summary.detail).toContain('상대 승리: 상대1');
    expect(pokerResult(poker([-20, 20], [pot([1])]), 1)!.title).toBe('내 승리');
  });
  it('distinguishes a chopped pot from a personal win', () => {
    const summary = pokerResult(poker([0, 0], [pot([0, 1])]), 0)!;
    expect(summary.title).toBe('내 무승부'); expect(summary.detail).toContain('팟 분배: 나, 상대1');
  });
  it('shows net loss despite winning a side pot and lists all pot winners', () => {
    const summary = pokerResult(poker([-100, 200, -100], [pot([1], [0, 1, 2]), pot([0], [0, 2])]), 0)!;
    expect(summary.title).toBe('내 손실'); expect(summary.tone).toBe('loss');
    expect(summary.detail).toContain('일부 팟 획득'); expect(summary.detail).toContain('메인팟: 상대1'); expect(summary.detail).toContain('사이드팟 1: 나');
  });
});
describe('player-centered dealer-game result', () => {
  it('does not confuse the baccarat Player side with the user', () => {
    const summary = houseResult(baccarat('banker', 'player', -100), '민준')!;
    expect(summary.title).toBe('내 패배'); expect(summary.detail).toContain('내 선택: 뱅커'); expect(summary.detail).toContain('플레이어 승리');
    expect(houseResult(baccarat('player', 'player', 100), '민준')!.title).toBe('내 승리');
  });
  it('a winning tie bet is my win, whereas a returned banker wager is a push', () => {
    expect(houseResult(baccarat('tie', 'tie', 800), '민준')!).toMatchObject({ title: '내 승리', tone: 'win' });
    const push = houseResult(baccarat('banker', 'tie', 0), '민준')!;
    expect(push.title).toBe('내 베팅 무승부'); expect(push.detail).toContain('베팅금 반환');
  });
  it('describes mixed split hands at net zero without claiming a tie', () => {
    const round: BlackjackRound = { kind: 'blackjack', phase: 'done', deck: [], dealer: [], activeHand: 0, balance: 1000, startBalance: 1000, totalBet: 40, hands: [
      { cards: [], bet: 20, stood: true, split: true, splitAces: false, result: '승리', payout: 40 },
      { cards: [], bet: 20, stood: true, split: true, splitAces: false, result: '패배', payout: 0 },
    ] };
    const summary = houseResult(round, '민준')!;
    expect(summary.title).toBe('내 손익 0'); expect(summary.tone).toBe('mixed');
    expect(summary.detail).toContain('내 핸드 1승 1패 0무'); expect(summary.detail).toContain('상대 딜러: 민준');
    expect(houseResult({ ...round, phase: 'player' }, '민준')).toBeNull();
  });
});
