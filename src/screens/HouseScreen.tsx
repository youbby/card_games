import { useEffect, useRef, useState } from 'react';
import { startScreen } from '../app/boot';
import { useApp } from '../app/store';
import { db } from '../data/db';
import { gameName, profitTarget } from '../games/catalog';
import { baccaratValue, blackjackActions, blackjackValue } from '../games/house/engine';
import type { BaccaratBet, BlackjackAction, HouseRoom } from '../games/house/types';
import { actHouse, betHouse, closeHouseRoom, houseBetLimits, houseLimitReached } from '../services/house';
import { Avatar, Button, Chips, ClassBadge, ConfirmModal, cx, fmt, Page, PlayingCard } from '../ui/components';
import { RoundResult } from '../ui/RoundResult';
import { houseResult } from '../ui/results';

const choices: { value: BaccaratBet; label: string; odds: string }[] = [
  { value: 'player', label: '플레이어', odds: '1:1' }, { value: 'banker', label: '뱅커', odds: '0.95:1' }, { value: 'tie', label: '무승부', odds: '8:1' },
];
const actionNames: Record<BlackjackAction, string> = { hit: '히트', stand: '스탠드', double: '더블다운', split: '스플릿' };
export function HouseScreen({ roomId }: { roomId: string }) {
  const { reset, showToast } = useApp();
  const [room, setRoom] = useState<HouseRoom | null>(null), [bet, setBet] = useState(20);
  const [choice, setChoice] = useState<BaccaratBet>('player');
  const [busy, setBusy] = useState(false), [confirmLeave, setConfirmLeave] = useState(false);
  const working = useRef(false);
  useEffect(() => { let live = true; db.rooms.get(roomId).then((value) => {
    if (!live) return;
    if (!value?.active) { reset([{ name: 'characterSelect' }, { name: 'lobby' }]); return; }
    setRoom(value); setBet(houseBetLimits(value).min);
  }).catch((error: unknown) => showToast(String(error))); return () => { live = false; }; }, [roomId, reset, showToast]);
  const perform = async (job: () => Promise<HouseRoom>) => {
    if (working.current) return;
    working.current = true; setBusy(true);
    try { const next = await job(); setRoom(next); const limits = houseBetLimits(next); setBet((current) => Math.max(limits.min, Math.min(limits.max, current))); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
    finally { working.current = false; setBusy(false); }
  };
  const leave = async () => {
    if (working.current) return;
    working.current = true; setBusy(true);
    try { const result = await closeHouseRoom(roomId); reset(result.bankrupt ? [await startScreen()] : [{ name: 'characterSelect' }, { name: 'lobby' }]); }
    catch (error) { showToast(error instanceof Error ? error.message : String(error)); }
    finally { working.current = false; setBusy(false); setConfirmLeave(false); }
  };
  if (!room) return <Page title="방 준비 중…">{null}</Page>;
  const round = room.round, playing = round?.phase === 'player';
  const limit = !playing && houseLimitReached(room), limits = houseBetLimits(room);
  const legal = round?.kind === 'blackjack' ? blackjackActions(round) : [];
  const summary = houseResult(round, room.dealer.name);
  const target = profitTarget(room.initialBuyIn, room.initialBuyIn, room.profitMultiplier);
  return (
    <Page title={gameName(room.gameId)} onBack={() => setConfirmLeave(true)} right={<Chips amount={room.balance} />}
      footer={<div className="flex h-[200px] flex-col justify-end gap-2">
        {limit || room.balance === 0 && !playing ? <>
          <p className="text-center font-bold text-yellow-300">{limit ? '이번 방의 수익 목표를 달성했습니다!' : '이번 방의 칩을 모두 사용했습니다.'}</p>
          <p className="text-center text-xs text-gray-400">{limit ? '초과 당첨금도 전부 지급했습니다. 나갔다가 다시 입장해 주세요.' : '남은 지갑 잔액으로 다시 입장할 수 있습니다.'}</p>
          <Button className="w-full" variant="primary" disabled={busy} onClick={leave}>정산하고 나가기</Button>
        </> : playing ? <>
          <p className="text-center text-xs text-gray-400">{round.kind === 'blackjack' && `내 ${round.activeHand + 1}번 핸드 차례 · 추가 베팅 가능 칩 ${fmt(room.balance)}`}</p>
          <div className="grid grid-cols-2 gap-2">{(['hit', 'stand', 'double', 'split'] as const).map((action) => <button key={action} className={cx('poker-action', action === 'double' || action === 'split' ? 'poker-action-raise' : 'poker-action-call')} disabled={busy || !legal.includes(action)} onClick={() => void perform(() => actHouse(room.id, action))}>{actionNames[action]}</button>)}</div>
        </> : <>
          {room.gameId === 'baccarat' && <div className="grid grid-cols-3 gap-2">{choices.map((item) => <button key={item.value} disabled={busy} onClick={() => setChoice(item.value)} className={cx('rounded-xl border px-2 py-2 text-xs', choice === item.value ? 'border-yellow-500/60 bg-yellow-400/10 text-yellow-200' : 'border-gray-700 bg-gray-900 text-gray-400')}>{item.label}<span className="ml-1 text-[10px] opacity-60">{item.odds}</span></button>)}</div>}
          <div className="flex items-center justify-between text-xs text-gray-400"><span>베팅 {fmt(limits.min)}~{fmt(limits.max)}</span><Chips amount={bet} /></div>
          <input aria-label="베팅 금액" disabled={busy} type="range" min={0} max={Math.floor(limits.max / 20)} value={Math.floor(bet / 20)} step={1} onChange={(event) => setBet(Math.max(limits.min, Number(event.target.value) * 20))} />
          <div className="grid grid-cols-3 gap-2"><Button className="py-2" disabled={busy} onClick={() => setBet(limits.min)}>최소</Button><Button className="py-2" disabled={busy} onClick={() => setBet(Math.max(limits.min, Math.floor(limits.max / 40) * 20))}>중간</Button><Button className="py-2" disabled={busy} onClick={() => setBet(limits.max === room.balance ? room.balance : Math.floor(limits.max / 20) * 20)}>최대</Button></div>
          <button className="poker-action poker-action-raise" disabled={busy || bet <= 0} onClick={() => void perform(() => betHouse(room.id, bet, choice))}>{busy ? '정산 중…' : `${room.roundsPlayed ? '다음 판' : '시작'} · ${fmt(bet)}칩 베팅`}</button>
        </>}
      </div>}>
      <div className="flex items-center justify-between gap-2 py-1 text-[10px] text-gray-500"><span>입장금 {fmt(room.initialBuyIn)} · {room.roundsPlayed}판</span><span>{target == null ? '수익 한도 없음' : `순이익 ${room.profitMultiplier}배 · 목표 잔액 ${fmt(target)}`}</span></div>
      <div className="mt-2 rounded-[28px] border border-emerald-900/70 bg-gradient-to-b from-emerald-950/60 to-gray-950 p-3">
        <div className="mb-3 flex items-center justify-center gap-2"><Avatar emoji={room.dealer.avatar} size="sm" /><div className="text-sm font-bold">{room.dealer.name} <span className="text-[10px] text-gray-500">상대 딜러</span></div><ClassBadge cls={room.cpuClass} /></div>
        <div className="mb-2 text-center text-[10px] text-emerald-100/70">{room.gameId === 'baccarat' ? '뱅커' : '상대 딜러'} {round && (!playing ? (round.kind === 'blackjack' ? blackjackValue(round.dealer).total : baccaratValue(round.dealer)) : '?')}{round?.kind === 'baccarat' && round.choice === 'banker' && <b className="ml-2 text-yellow-200">내 베팅</b>}</div>
        <div data-testid="house-dealer-cards" className="flex flex-wrap justify-center gap-1">{round ? round.dealer.map((card, i) => <PlayingCard key={i} card={card} size="board" faceDown={playing && i > 0} />) : <><PlayingCard faceDown size="board" /><PlayingCard faceDown size="board" /></>}</div>
        <div data-testid="house-result-slot" className="my-3 h-[84px] shrink-0">{summary ? <RoundResult summary={summary} compact /> : <div className="flex h-full items-center justify-center text-center text-sm text-gray-500">{playing ? '내 차례 · 21을 넘지 않게 선택하세요' : '베팅 후 카드를 받으세요'}</div>}</div>
        {round?.kind === 'blackjack' ? <div className={cx('grid gap-3', round.hands.length > 1 && 'grid-cols-2')}>{round.hands.map((hand, i) => <div data-testid="blackjack-hand" key={i} className={cx('rounded-xl border p-2', playing && round.activeHand === i ? 'border-yellow-500/50 bg-yellow-400/5' : 'border-white/5')}>
          <p className="mb-2 text-center text-xs text-gray-300">내 {i + 1}번 핸드 · {blackjackValue(hand.cards).total}{blackjackValue(hand.cards).soft ? ' (소프트)' : ''}</p><p className={cx('mb-2 h-4 text-center text-xs font-extrabold', (hand.payout ?? 0) > hand.bet ? 'text-yellow-200' : (hand.payout ?? 0) < hand.bet ? 'text-rose-200' : 'text-slate-200')}>{hand.result ? `내 ${hand.result === '블랙잭' ? '블랙잭 승리' : hand.result === '버스트' ? '패배 (버스트)' : hand.result}` : '\u00a0'}</p><div className="flex flex-wrap justify-center gap-1">{hand.cards.map((card, k) => <PlayingCard key={k} card={card} size={round.hands.length > 1 ? 'sm' : 'board'} />)}</div><p className="mt-1 text-center text-[10px] text-gray-500">내 베팅 {fmt(hand.bet)}</p>
        </div>)}</div> : <><p className="mb-2 text-center text-[10px] text-emerald-100/70">플레이어 {round?.kind === 'baccarat' && baccaratValue(round.player)}{round?.kind === 'baccarat' && round.choice === 'player' && <b className="ml-2 text-yellow-200">내 베팅</b>}</p><div className="flex justify-center gap-1">{round?.kind === 'baccarat' ? round.player.map((card, i) => <PlayingCard key={i} card={card} size="board" />) : <><PlayingCard faceDown size="board" /><PlayingCard faceDown size="board" /></>}</div></>}
        <p className="mt-3 text-center text-[10px] text-gray-600">6덱 슈 · 남은 카드 {(round?.deck ?? room.deck).length}장</p>
      </div>
      {confirmLeave && <ConfirmModal title="방에서 나갈까요?" message={playing ? `진행 중인 베팅 ${fmt(round.totalBet)}칩은 패배 처리하고, 남은 ${fmt(room.balance)}칩을 지갑으로 돌려드립니다.` : `${fmt(room.balance)}칩을 지갑으로 정산합니다. 다시 입장하면 새 입장금 기준으로 목표와 딜러를 배정합니다.`} confirmLabel="정산하고 나가기" onConfirm={leave} onCancel={() => setConfirmLeave(false)} />}
    </Page>
  );
}
