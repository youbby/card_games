import { useState } from 'react';
import { useApp } from '../app/store';
import { cardFromString } from '../core/cards';
import { db } from '../data/db';
import type { Bucket, HandRecord } from '../data/types';
import { STAKES } from '../games/holdem/stakes';
import { getCharacter, getStats } from '../services/characters';
import { Avatar, Chips, ClassBadge, cx, fmt, Page, PlayingCard, Section } from '../ui/components';
import { useAsync } from '../ui/hooks';

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : '-');
const signed = (n: number) => `${n > 0 ? '+' : ''}${fmt(n)}`;
const tone = (n: number) => (n > 0 ? 'text-emerald-400' : n < 0 ? 'text-red-400' : 'text-gray-300');

export function StatsScreen({ characterId }: { characterId: string }) {
  const back = useApp((s) => s.back);
  const [tab, setTab] = useState<'summary' | 'sessions' | 'hands'>('summary');
  const { data } = useAsync(async () => {
    const [character, stats, sessions, hands] = await Promise.all([
      getCharacter(characterId),
      getStats(characterId),
      db.sessions.where('playerId').equals(characterId).toArray(),
      db.hands.where('[playerId+playedAt]').between([characterId, 0], [characterId, Infinity]).reverse().limit(100).toArray(),
    ]);
    return { character, stats, sessions: sessions.filter((s) => !s.active).sort((a, b) => b.startedAt - a.startedAt), hands };
  }, [characterId]);

  if (!data?.character) return <Page title="전적" onBack={back}>{null}</Page>;
  const { character: c, stats: s, sessions, hands } = data;

  return (
    <Page title="전적" onBack={back}>
      <div className="flex items-center gap-3">
        <Avatar emoji={c.avatar} size="lg" dim={c.status === 'BANKRUPT'} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-lg font-extrabold">
            {c.name} {c.status === 'BANKRUPT' && <span className="text-sm text-red-400">파산</span>}
          </div>
          <Chips amount={c.balance} />
          <div className="text-[11px] text-gray-500">
            최고 {fmt(c.peakBalance)} · 생성 {new Date(c.createdAt).toLocaleDateString('ko-KR')}
            {c.bankruptAt && ` · 파산 ${new Date(c.bankruptAt).toLocaleDateString('ko-KR')}`}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-gray-900 p-1 text-xs font-bold">
        {(
          [
            ['summary', '요약'],
            ['sessions', '세션'],
            ['hands', '핸드'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)} className={cx('rounded-lg py-2', tab === id ? 'bg-gray-700 text-white' : 'text-gray-400')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'summary' && (
        <>
          <div className="mt-4 grid grid-cols-3 gap-2">
            <Tile label="핸드" value={fmt(s.handsPlayed)} />
            <Tile label="승률" value={pct(s.handsWon, s.handsPlayed)} />
            <Tile label="누적 손익" value={signed(s.netProfit)} valueClass={tone(s.netProfit)} />
            <Tile label="최대 획득 팟" value={fmt(s.biggestPotWon)} />
            <Tile label="최대 손실" value={fmt(s.biggestLoss)} />
            <Tile label="플레이 시간" value={`${Math.round(s.playTimeMs / 60000)}분`} />
            <Tile label="VPIP" value={pct(s.vpipCount, s.handsPlayed)} />
            <Tile label="PFR" value={pct(s.pfrCount, s.handsPlayed)} />
            <Tile label="쇼다운 승률" value={pct(s.showdownsWon, s.showdowns)} />
          </div>

          {s.bestHand && (
            <Section title="최고 족보">
              <div className="flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-900 p-3">
                <div className="flex gap-1">
                  {s.bestHand.cards.map((t) => (
                    <PlayingCard key={t} card={cardFromString(t)} size="sm" />
                  ))}
                </div>
                <div>
                  <div className="font-extrabold text-yellow-300">{s.bestHand.name}</div>
                  <div className="text-[11px] text-gray-500">{new Date(s.bestHand.at).toLocaleString('ko-KR')}</div>
                </div>
              </div>
            </Section>
          )}

          <Section title="클래스별">
            <BucketTable
              rows={(['LOW', 'HIGH'] as const).map((k) => ({ label: <ClassBadge cls={k} />, bucket: s.byClass[k] }))}
            />
          </Section>
          <Section title="블라인드별">
            <BucketTable rows={STAKES.map((st) => ({ label: st.name, bucket: s.byStake[st.id] }))} />
          </Section>
          <Section title="인원별">
            <BucketTable rows={[2, 3, 4, 5, 6].map((n) => ({ label: `${n}인`, bucket: s.bySeatCount[String(n)] }))} />
          </Section>
        </>
      )}

      {tab === 'sessions' && (
        <div className="mt-4 space-y-2">
          {sessions.length === 0 && <Empty text="아직 세션 기록이 없습니다." />}
          {sessions.map((x) => {
            const seat = x.seats[0];
            const net = seat ? seat.stack - seat.buyInTotal : 0;
            const stake = STAKES.find((st) => st.id === x.stakeId)!;
            return (
              <div key={x.id} className="rounded-xl border border-gray-800 bg-gray-900 p-3">
                <div className="flex items-center gap-2 text-sm">
                  <ClassBadge cls={x.cpuClass} />
                  <span className="font-bold">{stake.name}</span>
                  <span className="text-gray-500">{x.seatCount}인</span>
                  <span className={cx('ml-auto font-extrabold tabular-nums', tone(net))}>{signed(net)}</span>
                </div>
                <div className="mt-1 text-[11px] text-gray-500">
                  {new Date(x.startedAt).toLocaleString('ko-KR')} · {x.handsPlayed}핸드 · 바이인 {fmt(seat?.buyInTotal ?? 0)}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {tab === 'hands' && (
        <div className="mt-4 space-y-2">
          {hands.length === 0 && <Empty text="아직 핸드 기록이 없습니다." />}
          {hands.map((h) => (
            <HandRow key={h.id} h={h} />
          ))}
          {hands.length === 100 && <p className="text-center text-[11px] text-gray-600">최근 100핸드만 표시합니다.</p>}
        </div>
      )}
    </Page>
  );
}

function Tile({ label, value, valueClass = 'text-gray-100' }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="rounded-xl border border-gray-800 bg-gray-900 px-2 py-2.5 text-center">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={cx('mt-0.5 text-sm font-extrabold tabular-nums', valueClass)}>{value}</div>
    </div>
  );
}

function BucketTable({ rows }: { rows: { label: React.ReactNode; bucket?: Bucket }[] }) {
  return (
    <div className="divide-y divide-gray-800 rounded-xl border border-gray-800 bg-gray-900 text-sm">
      {rows.map((r, i) => (
        <div key={i} className="flex items-center px-3 py-2">
          <div className="w-16">{r.label}</div>
          <div className="flex-1 text-xs text-gray-500">{r.bucket ? `${fmt(r.bucket.hands)}핸드` : '-'}</div>
          <div className={cx('font-bold tabular-nums', tone(r.bucket?.net ?? 0))}>{r.bucket ? signed(r.bucket.net) : ''}</div>
        </div>
      ))}
    </div>
  );
}

function HandRow({ h }: { h: HandRecord }) {
  const [open, setOpen] = useState(false);
  return (
    <button className="w-full rounded-xl border border-gray-800 bg-gray-900 p-2.5 text-left" onClick={() => setOpen((v) => !v)}>
      <div className="flex items-center gap-2">
        <div className="flex gap-0.5">
          {h.holeCards.length ? h.holeCards.map((t) => <PlayingCard key={t} card={cardFromString(t)} size="xs" />) : <span className="text-xs text-gray-500">-</span>}
        </div>
        <div className="flex gap-0.5">
          {h.board.map((t) => (
            <PlayingCard key={t} card={cardFromString(t)} size="xs" />
          ))}
        </div>
        <span className={cx('ml-auto text-sm font-extrabold tabular-nums', tone(h.net))}>{signed(h.net)}</span>
      </div>
      <div className="mt-1 flex gap-2 text-[11px] text-gray-500">
        <span>{h.position}</span>
        <span>팟 {fmt(h.potTotal)}</span>
        {h.bestHand && <span className="text-emerald-400">{h.bestHand.name}</span>}
        {h.abandoned && <span className="text-red-400">중도 이탈(폴드)</span>}
        <span className="ml-auto">{new Date(h.playedAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
      </div>
      {open && (
        <div className="mt-2 space-y-0.5 border-t border-gray-800 pt-2 text-[11px] text-gray-400">
          <div>상대: {h.opponents.map((o) => o.name).join(', ')}</div>
          {h.actions.map((a, i) => {
            const [street, name, kind, to] = a.split(':');
            return (
              <div key={i}>
                <span className="inline-block w-16 text-gray-600">{STREET_KO[street] ?? street}</span>
                {name} {KIND_KO[kind] ?? kind}
                {kind !== 'fold' && kind !== 'check' ? ` ${fmt(Number(to))}` : ''}
              </div>
            );
          })}
        </div>
      )}
    </button>
  );
}

const STREET_KO: Record<string, string> = { PREFLOP: '프리플랍', FLOP: '플랍', TURN: '턴', RIVER: '리버' };
const KIND_KO: Record<string, string> = { sb: 'SB', bb: 'BB', fold: '폴드', check: '체크', call: '콜', bet: '벳', raise: '레이즈' };

function Empty({ text }: { text: string }) {
  return <div className="py-10 text-center text-sm text-gray-600">{text}</div>;
}
