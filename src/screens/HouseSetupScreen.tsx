import { useEffect, useRef, useState } from 'react';
import { useApp } from '../app/store';
import { gameName, type HouseGameId } from '../games/catalog';
import type { CpuClass } from '../games/holdem/ai/types';
import { stakeById, stakesForClass, type StakeId } from '../games/holdem/stakes';
import { getCharacter } from '../services/characters';
import { openHouseRoom } from '../services/house';
import { Button, Chips, ClassBadge, cx, fmt, Page, Section } from '../ui/components';
import { useAsync } from '../ui/hooks';

export function HouseSetupScreen({ gameId }: { gameId: HouseGameId }) {
  const { playerId, back, push, settings, showToast } = useApp();
  const { data: player } = useAsync(() => getCharacter(playerId!), [playerId]);
  const [cls, setCls] = useState<CpuClass>('LOW');
  const [stakeId, setStakeId] = useState<StakeId>('ENTRY');
  const [buyIn, setBuyIn] = useState(1000);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const stakes = stakesForClass(cls), stake = stakeById(stakeId);
  const max = Math.min(stake.maxBuyIn, player?.balance ?? 0);
  const valid = stake.classes.includes(cls) && buyIn >= stake.minBuyIn && buyIn <= max;
  const multiplier = settings.profitLimits[gameId];
  useEffect(() => { if (!stake.classes.includes(cls)) setStakeId(stakes[0].id); }, [cls, stakeId]);
  useEffect(() => { setBuyIn(Math.min(max, Math.max(stake.minBuyIn, Math.round(stake.maxBuyIn / 40) * 20))); }, [stakeId, max]);
  const start = async () => {
    if (!valid || !player || working.current) return;
    working.current = true; setBusy(true);
    try {
      const room = await openHouseRoom({ playerId: player.id, gameId, cpuClass: cls, stakeId, buyIn });
      push({ name: 'house', roomId: room.id });
    } catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
    finally { working.current = false; setBusy(false); }
  };
  return (
    <Page title={gameName(gameId)} onBack={back} right={<Chips amount={player?.balance ?? 0} />} footer={<Button className="w-full" variant="primary" onClick={start} disabled={!valid || busy}>{busy ? '입장 중…' : '딜러 배정받고 입장'}</Button>}>
      <Section title="딜러 난이도">
        <div className="grid grid-cols-2 gap-2">{(['LOW', 'HIGH'] as const).map((value) => (
          <button key={value} onClick={() => setCls(value)} className={cx('rounded-2xl border p-4 text-left', cls === value ? 'border-yellow-500/50 bg-yellow-400/5' : 'border-gray-800 bg-gray-900')}><ClassBadge cls={value} /><p className="mt-2 text-xs text-gray-400">{value === 'LOW' ? '입문·일반 판돈' : '중급·고급·VIP 판돈'}</p></button>
        ))}</div>
        <p className="mt-2 text-xs leading-relaxed text-gray-500">선택한 난이도의 상대 선수 중 한 명이 무작위로 딜러가 됩니다. 방을 나갈 때까지 같은 딜러가 진행합니다. 카드 진행 규칙은 난이도와 무관하게 동일합니다.</p>
      </Section>
      <Section title="판돈 단계"><div className="space-y-2">{stakes.map((level) => (
        <button key={level.id} disabled={(player?.balance ?? 0) < level.minBuyIn} onClick={() => setStakeId(level.id)} className={cx('flex w-full items-center justify-between rounded-xl border p-3 text-sm disabled:opacity-30', stakeId === level.id ? 'border-yellow-500/50 bg-yellow-400/5' : 'border-gray-800 bg-gray-900')}><span>{level.name}</span><span className="text-xs text-gray-400">입장금 {fmt(level.minBuyIn)}~{fmt(level.maxBuyIn)}</span></button>
      ))}</div></Section>
      <Section title="입장금" aside={<Chips amount={buyIn} />}>
        {max >= stake.minBuyIn ? <input aria-label="입장금" type="range" className="w-full" min={stake.minBuyIn} max={max} step={20} value={buyIn} onChange={(event) => setBuyIn(Number(event.target.value))} /> : <p className="text-sm text-gray-400">이 단계에 입장할 칩이 부족합니다.</p>}
        <div className="mt-2 grid grid-cols-3 gap-2">{[['최소', stake.minBuyIn], ['중간', Math.floor((stake.minBuyIn + max) / 40) * 20], ['최대', max]].map(([label, value]) => <Button key={label} className="py-2" disabled={max < stake.minBuyIn} onClick={() => setBuyIn(Number(value))}>{label}</Button>)}</div>
      </Section>
      <Section title="이번 방의 수익 목표"><div className="rounded-xl border border-yellow-500/20 bg-yellow-400/5 p-3 text-sm leading-relaxed">
        {multiplier == null ? '수익 한도 없이 플레이합니다.' : <><b className="text-yellow-300">순이익 {multiplier}배 · 정산 잔액 {fmt(buyIn * (1 + multiplier))}칩 이상</b><p className="mt-1 text-xs text-gray-400">마지막 판의 당첨금을 전부 지급한 뒤 다음 판을 막습니다. 정산 후 다시 입장할 수 있습니다.</p></>}
      </div></Section>
      <details className="mt-4 rounded-xl border border-gray-800 p-3 text-xs leading-relaxed text-gray-400"><summary>게임 규칙</summary><p className="mt-2">{gameId === 'blackjack' ? '6덱 · 딜러는 소프트 17 포함 17 이상 스탠드 · 블랙잭 3:2 · 일반 승리 1:1 · 무승부 원금 반환 · 더블다운·최대 4핸드 스플릿 · A 스플릿은 각 한 장만 배분 · 보험·서렌더 없음' : '6덱 · 플레이어/뱅커/무승부 중 한 곳에 베팅 · 표준 세 번째 카드 규칙 · 플레이어 순이익 1배 · 뱅커 0.95배 · 무승부 8배 · 무승부 시 플레이어/뱅커 원금 반환'}</p><p className="mt-2">20칩 단위 베팅, 남은 칩 전액 베팅 가능. 배당의 1칩 미만은 버립니다. 딜러는 별도 게임 금고로 정산합니다. 진행 중 나가기·강제 종료 시 확정한 베팅은 패배 처리합니다.</p></details>
    </Page>
  );
}
