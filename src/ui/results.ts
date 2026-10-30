import type { HandState } from '../games/holdem/types';
import type { BaccaratBet, HouseRound } from '../games/house/types';

export interface RoundSummary {
  tone: 'win' | 'loss' | 'draw' | 'mixed';
  title: string;
  detail: string;
  net: number;
}
export const BACCARAT_LABELS: Record<BaccaratBet, string> = { player: '플레이어', banker: '뱅커', tie: '무승부' };

export function pokerResult(hand: HandState, human: number): RoundSummary | null {
  const result = hand.result;
  if (!result || human < 0 || !hand.players[human]) return null;
  const net = result.net[human];
  const name = (index: number) => (index === human ? '나' : hand.players[index].name);
  const shared = result.pots.some((pot) => pot.winners.includes(human) && pot.winners.length > 1);
  const partial = net < 0 && result.pots.some((pot) => pot.winners.includes(human) && pot.eligible.length > 1);
  const tone = net > 0 ? 'win' : net < 0 ? 'loss' : 'draw';
  const title =
    net > 0 ? (shared ? '내 공동 승리' : '내 승리') : net < 0 ? (partial ? '내 손실' : '내 패배') : '내 무승부';
  let detail: string;
  if (result.pots.length > 1) {
    detail =
      (partial ? '일부 팟 획득 · ' : '') +
      result.pots.map((pot, i) => `${i ? `사이드팟 ${i}` : '메인팟'}: ${pot.winners.map(name).join(', ')}`).join(' · ');
  } else {
    const pot = result.pots[0];
    const winners = pot.winners.map(name).join(', ');
    const how = result.showdown ? result.hands[pot.winners[0]]?.name : net > 0 ? '상대 전원 폴드' : '내 폴드';
    detail = `${net < 0 ? '상대 승리' : shared ? '팟 분배' : '승리자'}: ${winners}${how ? ` · ${how}` : ''}`;
  }
  return { tone, title, detail, net };
}

export function houseResult(round: HouseRound | null, dealerName: string): RoundSummary | null {
  if (!round || round.phase !== 'done') return null;
  const net = round.balance - round.startBalance;
  if (round.kind === 'baccarat') {
    const selected = `내 선택: ${BACCARAT_LABELS[round.choice]}`;
    const actual = round.winner === 'tie' ? '카드 결과: 무승부' : `카드 결과: ${BACCARAT_LABELS[round.winner]} 승리`;
    if (round.winner === 'tie' && round.choice !== 'tie')
      return { tone: 'draw', title: '내 베팅 무승부', detail: `${selected} · ${actual} · 베팅금 반환`, net };
    const won = round.choice === round.winner;
    return {
      tone: won ? 'win' : 'loss',
      title: won ? '내 승리' : '내 패배',
      detail: `${selected} · ${actual} · ${won ? '적중' : '미적중'}`,
      net,
    };
  }
  const wins = round.hands.filter((hand) => (hand.payout ?? 0) > hand.bet).length;
  const losses = round.hands.filter((hand) => (hand.payout ?? 0) < hand.bet).length;
  const draws = round.hands.length - wins - losses;
  const mixed = net === 0 && wins > 0 && losses > 0;
  const tone = net > 0 ? 'win' : net < 0 ? 'loss' : mixed ? 'mixed' : 'draw';
  const title = net > 0 ? '내 승리' : net < 0 ? '내 패배' : mixed ? '내 손익 0' : '내 무승부';
  const single = round.hands[0].result;
  let result: string;
  if (round.hands.length > 1) result = `내 핸드 ${wins}승 ${losses}패 ${draws}무`;
  else if (single === '블랙잭') result = '내 블랙잭';
  else if (single === '버스트') result = '내 버스트';
  else if (single === '서렌더') result = '서렌더 · 베팅 절반 반환';
  else if (single === '승리') result = '딜러를 이겼습니다';
  else if (single === '패배') result = '딜러 승리';
  else result = '동점 · 베팅금 반환';
  if (round.insurance) result += round.insurancePayout ? ' · 보험 적중' : ' · 보험 미적중';
  return { tone, title, detail: `${result} · 상대 딜러: ${dealerName}`, net };
}
