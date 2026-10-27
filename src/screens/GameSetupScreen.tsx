import { Lock, RefreshCw } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useApp } from '../app/store';
import type { Character } from '../data/types';
import type { CpuClass } from '../games/holdem/ai/types';
import { MAX_SEATS, MIN_SEATS, type StakeId, type StakeLevel, stakeById, stakesForClass } from '../games/holdem/stakes';
import { getCharacter } from '../services/characters';
import { pickOpponents } from '../services/cpuPool';
import { stakeAvailability, startSession } from '../services/session';
import { Avatar, Button, Chips, ClassBadge, cx, fmt, Page, personalityTags, Section } from '../ui/components';
import { useAsync } from '../ui/hooks';
import { gameName, type PokerGameId } from '../games/catalog';

const CLASS_INFO: Record<CpuClass, { title: string; desc: string }> = {
  LOW: { title: '하수', desc: '실수가 많은 초보 상대 · 입문~일반' },
  HIGH: { title: '고수', desc: '확률과 성향을 읽는 상대 · 중급~VIP' },
};

export function GameSetupScreen({ gameId = 'holdem' }: { gameId?: PokerGameId }) {
  const { playerId, back, push, showToast, settings } = useApp();
  const [cls, setCls] = useState<CpuClass>('LOW');
  const [seats, setSeats] = useState(4);
  const [stakeId, setStakeId] = useState<StakeId | null>(null);
  const [buyIn, setBuyIn] = useState(0);
  const [opponents, setOpponents] = useState<Character[]>([]);
  const [rollTick, setRollTick] = useState(0);
  const [busy, setBusy] = useState(false);

  const { data: player } = useAsync(() => getCharacter(playerId!), [playerId]);
  const balance = player?.balance ?? 0;
  const { data: availability } = useAsync(() => stakeAvailability(cls, balance), [cls, balance]);

  const stakes = stakesForClass(cls);
  const maxOpponents = availability ? Math.max(0, ...Object.values(availability).map((a) => (a.canAfford ? a.eligibleCpus : 0))) : 0;
  const maxSeats = Math.min(MAX_SEATS, 1 + maxOpponents);

  const stakeOk = (s: StakeLevel) => {
    const a = availability?.[s.id];
    return !!a && a.canAfford && a.eligibleCpus >= seats - 1;
  };

  // Keep the selected stake valid as class/seats/balance change.
  useEffect(() => {
    if (!availability) return;
    if (seats > maxSeats && maxSeats >= MIN_SEATS) {
      setSeats(maxSeats);
      return;
    }
    const current = stakeId ? stakes.find((s) => s.id === stakeId) : undefined;
    if (current && stakeOk(current)) return;
    const fallback = [...stakes].reverse().find(stakeOk) ?? null;
    setStakeId(fallback?.id ?? null);
  }, [availability, cls, seats, maxSeats]);

  const stake = stakeId ? stakeById(stakeId) : null;
  const buyInMax = stake ? Math.min(stake.maxBuyIn, balance) : 0;

  useEffect(() => {
    if (!stake) return;
    setBuyIn(Math.min(buyInMax, Math.max(stake.minBuyIn, Math.round((stake.maxBuyIn * 0.5) / stake.bb) * stake.bb)));
  }, [stakeId, buyInMax]);

  useEffect(() => {
    if (!stake) {
      setOpponents([]);
      return;
    }
    let alive = true;
    pickOpponents(cls, stake, seats - 1).then((o) => alive && setOpponents(o));
    return () => {
      alive = false;
    };
  }, [cls, seats, stakeId, rollTick]);

  const ready = !!stake && opponents.length === seats - 1 && buyIn >= stake.minBuyIn && buyIn <= buyInMax;
  const presets = useMemo(() => {
    if (!stake) return [];
    const mid = Math.round((stake.minBuyIn + buyInMax) / 2 / stake.bb) * stake.bb;
    return [
      { label: '최소', value: stake.minBuyIn },
      { label: '중간', value: mid },
      { label: '최대', value: buyInMax },
    ];
  }, [stake, buyInMax]);

  const start = async () => {
    if (!stake || !player) return;
    setBusy(true);
    try {
      const session = await startSession({
        gameId,
        playerId: player.id,
        cpuClass: cls,
        seatCount: seats,
        stakeId: stake.id,
        buyIn,
        opponentIds: opponents.map((o) => o.id),
      });
      push({ name: 'table', sessionId: session.id });
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
      setRollTick((t) => t + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title={gameName(gameId)}
      onBack={back}
      right={player && <Chips amount={balance} className="text-sm" />}
      footer={
        <Button variant="primary" className="w-full text-base" disabled={!ready || busy} onClick={start}>
          게임 시작
        </Button>
      }
    >
      <div className="mt-2 rounded-xl border border-gray-800 bg-gray-900 p-3 text-xs leading-relaxed text-gray-400">
        {gameId === 'draw' && <p>5장 배분 → 베팅 → 0~5장 교환 → 마지막 베팅 → 족보 비교</p>}
        <p>{settings.profitLimits[gameId] == null ? '방 수익 한도 없음' : `순이익이 입장금의 ${settings.profitLimits[gameId]}배 이상이면 정산 후 퇴장합니다. 마지막 판 당첨금은 전부 지급됩니다.`}</p>
      </div>
      <Section title="① 상대 난이도">
        <div className="grid grid-cols-2 gap-2">
          {(['LOW', 'HIGH'] as CpuClass[]).map((c) => (
            <button
              key={c}
              onClick={() => setCls(c)}
              className={cx(
                'rounded-2xl border p-3 text-left',
                cls === c
                  ? c === 'LOW'
                    ? 'border-sky-400 bg-sky-500/10'
                    : 'border-orange-400 bg-orange-500/10'
                  : 'border-gray-800 bg-gray-900',
              )}
            >
              <ClassBadge cls={c} />
              <div className="mt-1.5 text-[11px] leading-snug text-gray-400">{CLASS_INFO[c].desc}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section title="② 인원 (나 포함)">
        <div className="grid grid-cols-5 gap-2">
          {Array.from({ length: MAX_SEATS - MIN_SEATS + 1 }, (_, i) => i + MIN_SEATS).map((n) => (
            <button
              key={n}
              disabled={n > maxSeats}
              onClick={() => setSeats(n)}
              className={cx(
                'rounded-xl border py-3 text-lg font-extrabold disabled:opacity-25',
                seats === n ? 'border-yellow-400 bg-yellow-400/10 text-yellow-300' : 'border-gray-800 bg-gray-900',
              )}
            >
              {n}
            </button>
          ))}
        </div>
        {availability && maxSeats < MAX_SEATS && (
          <p className="mt-2 text-[11px] text-gray-500">
            {maxSeats < MIN_SEATS ? '지금 참가할 수 있는 상대 선수가 없습니다.' : `참가 가능한 상대가 부족해 최대 ${maxSeats}명까지 가능합니다.`}
          </p>
        )}
      </Section>

      <Section title="③ 블라인드">
        <div className="space-y-2">
          {stakes.map((s) => {
            const a = availability?.[s.id];
            const ok = stakeOk(s);
            const reason = !a
              ? ''
              : !a.canAfford
                ? `최소 ${fmt(s.minBuyIn)}칩 필요`
                : a.eligibleCpus < seats - 1
                  ? `참가 가능한 상대 ${a.eligibleCpus}명`
                  : '';
            return (
              <button
                key={s.id}
                disabled={!ok}
                onClick={() => setStakeId(s.id)}
                className={cx(
                  'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left',
                  stakeId === s.id ? 'border-yellow-400 bg-yellow-400/10' : 'border-gray-800 bg-gray-900',
                  !ok && 'opacity-40',
                )}
              >
                <div className="w-12 font-extrabold">{s.name}</div>
                <div className="flex-1 text-sm tabular-nums">
                  {fmt(s.sb)} / {fmt(s.bb)}
                  <div className="text-[11px] text-gray-500">
                    바이인 {fmt(s.minBuyIn)} ~ {fmt(s.maxBuyIn)}
                  </div>
                </div>
                {!ok && (
                  <span className="flex items-center gap-1 text-[11px] text-gray-400">
                    <Lock className="h-3 w-3" /> {reason}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </Section>

      {stake && (
        <Section title="④ 바이인" aside={<Chips amount={buyIn} />}>
          <input
            type="range"
            className="w-full"
            min={stake.minBuyIn}
            max={buyInMax}
            step={stake.bb}
            value={buyIn}
            onChange={(e) => setBuyIn(Number(e.target.value))}
          />
          <div className="mt-2 grid grid-cols-3 gap-2">
            {presets.map((p) => (
              <Button key={p.label} className="py-2" onClick={() => setBuyIn(p.value)}>
                {p.label}
              </Button>
            ))}
          </div>
          <p className="mt-1 text-[11px] text-gray-500">
            {Math.round(buyIn / stake.bb)}BB · 남는 잔액 {fmt(balance - buyIn)}
          </p>
        </Section>
      )}

      {stake && (
        <Section
          title="⑤ 상대"
          aside={
            <button className="flex items-center gap-1 text-xs font-bold text-gray-400" onClick={() => setRollTick((t) => t + 1)}>
              <RefreshCw className="h-3.5 w-3.5" /> 다시 뽑기
            </button>
          }
        >
          <div className="space-y-1.5">
            {opponents.map((o) => (
              <div key={o.id} className="flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-900 px-3 py-2">
                <Avatar emoji={o.avatar} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-bold">{o.name}</div>
                  <div className="text-[10px] text-gray-500">{personalityTags(o.personality).join(' · ')}</div>
                </div>
                <Chips amount={o.balance} className="text-xs" />
              </div>
            ))}
          </div>
        </Section>
      )}
    </Page>
  );
}
