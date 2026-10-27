import { ChevronUp, DoorOpen, ScrollText } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { startScreen } from '../app/boot';
import { vibrate } from '../app/native';
import { playSound } from '../app/sound';
import { useApp } from '../app/store';
import { type Card, rankOf, suitOf } from '../core/cards';
import { evaluate } from '../core/evaluator';
import { db } from '../data/db';
import type { SeatRecord, Settings } from '../data/types';
import { legalActions, potTotal } from '../games/holdem/engine';
import { stakeById } from '../games/holdem/stakes';
import type { HandState, PlayerState } from '../games/holdem/types';
import { TableRunner, type TableView } from '../services/tableRunner';
import { Button, Chips, ClassBadge, ConfirmModal, cx, EmptyCardSlot, fmt, Modal, PlayingCard } from '../ui/components';
import { useBackButton } from '../ui/hooks';

type Pos = { top: string; left: string };

/** Opponent seat positions (seats 1..n-1, clockwise from the player at the bottom). */
const SEAT_POSITIONS: Record<number, Pos[]> = {
  2: [{ top: '0%', left: '50%' }],
  3: [
    { top: '8%', left: '22%' },
    { top: '8%', left: '78%' },
  ],
  4: [
    { top: '40%', left: '11%' },
    { top: '0%', left: '50%' },
    { top: '40%', left: '89%' },
  ],
  5: [
    { top: '56%', left: '11%' },
    { top: '9%', left: '21%' },
    { top: '9%', left: '79%' },
    { top: '56%', left: '89%' },
  ],
  6: [
    { top: '56%', left: '11%' },
    { top: '13%', left: '11%' },
    { top: '0%', left: '50%' },
    { top: '13%', left: '89%' },
    { top: '56%', left: '89%' },
  ],
};
function thinkDelay(settings: Settings): number {
  const [lo, hi] = settings.cpuThinkTime === 'SHORT' ? [250, 550] : [700, 1500];
  const speed = settings.animationSpeed === 'SLOW' ? 1.4 : settings.animationSpeed === 'FAST' ? 0.6 : 1;
  return (lo + Math.random() * (hi - lo)) * speed;
}

function preflopLabel(hole: Card[]): string {
  if (hole.length < 2) return '';
  const [a, b] = hole;
  if (rankOf(a) === rankOf(b)) return '포켓 페어';
  const suited = suitOf(a) === suitOf(b);
  const gap = Math.abs(rankOf(a) - rankOf(b));
  if (suited && gap === 1) return '수딧 커넥터';
  if (suited) return '수딧';
  if (gap === 1) return '커넥터';
  return '하이카드';
}

export function TableScreen({ sessionId }: { sessionId: string }) {
  const { settings, reset, showToast } = useApp();
  const [view, setView] = useState<TableView | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [showLog, setShowLog] = useState(false);
  const [balance, setBalance] = useState(0);
  const runnerRef = useRef<TableRunner | null>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    let runner: TableRunner | null = null;
    // Deferred so React StrictMode's mount/unmount/mount in development creates only one runner.
    const timer = setTimeout(async () => {
      const session = await db.sessions.get(sessionId);
      if (!session || !session.active) {
        reset([{ name: 'characterSelect' }, { name: 'lobby' }]);
        return;
      }
      runner = new TableRunner(session, { thinkMs: () => thinkDelay(settingsRef.current), onChange: setView });
      runnerRef.current = runner;
      setView(runner.view());
      void runner.startNextHand();
    }, 0);
    return () => {
      clearTimeout(timer);
      runner?.dispose();
    };
  }, [sessionId, reset]);

  // Wallet balance for rebuys.
  const playerId = view?.session.playerId;
  const phase = view?.phase;
  useEffect(() => {
    if (playerId) db.characters.get(playerId).then((c) => setBalance(c?.balance ?? 0));
  }, [playerId, phase]);

  useFeedback(view, settings);

  const leave = async () => {
    setConfirmLeave(false);
    await runnerRef.current?.leave();
  };
  useBackButton(() => (view?.phase === 'ended' ? undefined : setConfirmLeave(true)));

  if (!view) {
    return <div className="flex h-full items-center justify-center text-sm text-gray-500">테이블 준비 중…</div>;
  }

  const { session, hand, seatOfPlayer } = view;
  const stake = stakeById(session.stakeId);
  const playerIndexOfSeat = (seat: number) => seatOfPlayer.indexOf(seat);
  const result = hand?.result ?? null;
  const winners = new Set(result?.pots.flatMap((p) => p.winners) ?? []);
  const highlight = new Set<Card>(result?.showdown ? [...winners].flatMap((w) => result.hands[w]?.best ?? []) : []);
  const human = playerIndexOfSeat(0);
  const me = human >= 0 && hand ? hand.players[human] : null;
  const myCommitted = me ? me.contributed : 0;
  const handLive = !!hand && !result;

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-lg flex-col overflow-hidden">
      <header className="safe-top flex shrink-0 items-center gap-2 px-3 pb-1.5">
        <button
          className="flex items-center gap-1 rounded-lg border border-gray-800 bg-gray-900 px-2.5 py-1.5 text-xs font-bold text-gray-300 active:bg-gray-800"
          onClick={() => setConfirmLeave(true)}
        >
          <DoorOpen className="h-4 w-4" /> 일어나기
        </button>
        <div className="flex flex-1 items-center justify-center gap-1.5 text-xs">
          <ClassBadge cls={session.cpuClass} />
          <span className="font-bold">{stake.name}</span>
          <span className="tabular-nums text-gray-400">
            {fmt(session.sb)}/{fmt(session.bb)}
          </span>
        </div>
        <div className="rounded-lg bg-gray-900 px-2 py-1.5 text-[11px] tabular-nums text-gray-400">#{session.handsPlayed + (handLive ? 1 : 0)}</div>
      </header>

      {/* Table */}
      <div data-testid="table-board" className="relative mx-2 min-h-0 flex-1">
        <div className="felt absolute inset-x-1 bottom-2 top-10 rounded-[45%]" />
        {session.seats.slice(1, session.seatCount).map((record, k) => {
          const seat = k + 1;
          const i = playerIndexOfSeat(seat);
          const pos = SEAT_POSITIONS[session.seatCount][k];
          return (
            <OpponentSeat
              key={seat}
              pos={pos}
              record={record}
              player={hand && i >= 0 ? hand.players[i] : null}
              hand={hand}
              index={i}
              label={view.seatLabels[seat]}
              thinking={view.thinkingSeat === seat}
              isWinner={i >= 0 && winners.has(i)}
              highlight={highlight}
            />
          );
        })}
        <div className="absolute left-1/2 top-[42%] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2">
          <PotView hand={hand} />
          <div data-testid="community-cards" className="flex gap-1">
            {Array.from({ length: 5 }, (_, i) =>
              hand && hand.board[i] !== undefined ? (
                <PlayingCard
                  key={`${i}-${hand.board[i]}`}
                  card={hand.board[i]}
                  size="board"
                  highlight={highlight.has(hand.board[i])}
                  dim={highlight.size > 0 && !highlight.has(hand.board[i])}
                />
              ) : (
                <EmptyCardSlot key={i} size="board" />
              ),
            )}
          </div>
          {result && (
            <div data-testid="hand-result" className="pointer-events-none absolute inset-x-0 top-full pt-2">
              <ResultBanner hand={hand!} />
            </div>
          )}
        </div>
      </div>

      {/* Me */}
      <div data-testid="my-cards" className="shrink-0 px-3">
        <MySeat
          record={session.seats[0]!}
          player={me}
          hand={hand}
          index={human}
          label={view.seatLabels[0]}
          turn={view.humanTurn}
          isWinner={human >= 0 && winners.has(human)}
          highlight={highlight}
        />
      </div>

      <div className="safe-bottom shrink-0 px-3 pt-2">
        <LogStrip view={view} open={showLog} onToggle={() => setShowLog((v) => !v)} />
        <div className="table-actions flex flex-col justify-end" data-testid="table-actions">
          <ActionArea
            view={view}
            balance={balance}
            onAct={(a) => runnerRef.current?.humanAct(a)}
            onNext={() => void runnerRef.current?.startNextHand()}
            onRebuy={(amount) =>
              runnerRef.current?.rebuy(amount).catch((e: unknown) => showToast(e instanceof Error ? e.message : String(e)))
            }
            onLeave={leave}
          />
        </div>
      </div>

      {confirmLeave && (
        <ConfirmModal
          title="테이블에서 일어날까요?"
          message={
            handLive && me && !me.folded && myCommitted > 0 ? (
              <>
                진행 중인 핸드는 <b>폴드</b> 처리되고, 이미 낸 <b className="text-yellow-400">{fmt(myCommitted)}</b>칩은 잃습니다.
              </>
            ) : handLive && me && !me.folded ? (
              '진행 중인 핸드는 폴드 처리됩니다. 남은 칩은 지갑으로 돌아갑니다.'
            ) : (
              '남은 칩은 지갑으로 돌아갑니다.'
            )
          }
          confirmLabel="일어나기"
          onConfirm={leave}
          onCancel={() => setConfirmLeave(false)}
        />
      )}

      {view.phase === 'ended' && view.endResult && (
        <EndModal
          view={view}
          onDone={async () => {
            if (view.endResult!.playerBankrupt) reset([await startScreen()]);
            else reset([{ name: 'characterSelect' }, { name: 'lobby' }]);
          }}
        />
      )}
    </div>
  );
}

function useFeedback(view: TableView | null, settings: Settings) {
  const lastLogId = useRef(0);
  const wasTurn = useRef(false);
  useEffect(() => {
    if (!view) return;
    const fresh = view.log.filter((l) => l.id > lastLogId.current);
    lastLogId.current = view.log.at(-1)?.id ?? lastLogId.current;
    for (const l of fresh) {
      if (l.tone === 'street') playSound('card', settings.sound);
      else if (l.tone === 'win') {
        const mine = l.text.includes(`${view.session.seats[0]!.name} +`);
        playSound(mine ? 'win' : 'lose', settings.sound);
        if (mine) vibrate(settings.haptics, true);
      } else if (l.text.endsWith('폴드')) playSound('fold', settings.sound);
      else if (l.text.endsWith('체크')) playSound('check', settings.sound);
      else if (l.tone === 'action' || l.tone === 'mine') playSound('chip', settings.sound);
    }
    if (view.humanTurn && !wasTurn.current) {
      playSound('turn', settings.sound);
      vibrate(settings.haptics);
    }
    wasTurn.current = view.humanTurn;
  }, [view, settings]);
}

function PotView({ hand }: { hand: HandState | null }) {
  if (!hand) return <div className="h-6" />;
  const total = potTotal(hand);
  return (
    <div className="rounded-full border border-yellow-500/40 bg-black/60 px-3 py-0.5 text-sm font-extrabold">
      <span className="mr-1 text-[10px] text-gray-400">POT</span>
      <span className="tabular-nums text-yellow-400">{fmt(total)}</span>
    </div>
  );
}

function ResultBanner({ hand }: { hand: HandState }) {
  const r = hand.result!;
  const top = r.pots[0];
  const name = top.winners.map((w) => hand.players[w].name).join(', ');
  const how = r.showdown ? r.hands[top.winners[0]]?.name : '나머지 폴드';
  return (
    <div className="pop-in rounded-xl bg-black/70 px-3 py-1 text-center text-xs">
      <span className="font-extrabold text-emerald-300">{name}</span> 승리 · <span className="text-gray-300">{how}</span>
      {r.pots.length > 1 && <span className="text-gray-500"> (+사이드팟 {r.pots.length - 1})</span>}
    </div>
  );
}

function DealerChip() {
  return (
    <span className="absolute -right-1.5 -top-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full border border-gray-400 bg-white text-[10px] font-black text-black">
      D
    </span>
  );
}

function OpponentSeat({
  pos,
  record,
  player,
  hand,
  index,
  label,
  thinking,
  isWinner,
  highlight,
}: {
  pos: Pos;
  record: SeatRecord | null;
  player: PlayerState | null;
  hand: HandState | null;
  index: number;
  label?: string;
  thinking: boolean;
  isWinner: boolean;
  highlight: Set<Card>;
}) {
  const style = { top: pos.top, left: pos.left, transform: 'translateX(-50%)' };
  if (!record) {
    return (
      <div className="absolute flex w-[76px] flex-col items-center" style={style}>
        <div className="flex h-11 w-11 items-center justify-center rounded-full border border-dashed border-white/20 text-[10px] text-white/30">
          빈자리
        </div>
      </div>
    );
  }
  const reveal = !!hand?.result?.showdown && !!player && !player.folded;
  const isButton = !!hand && index === hand.button;
  return (
    <div className="absolute z-10 flex w-[76px] flex-col items-center" style={style}>
      <div
        className={cx(
          'relative flex w-full flex-col items-center rounded-xl border border-white/10 bg-black/55 px-1 pb-1 pt-1.5 transition',
          thinking && 'glow-turn',
          isWinner && 'glow-win',
          (player?.folded || !player) && 'opacity-45',
        )}
      >
        {isButton && <DealerChip />}
        <div className="flex h-9 items-center -space-x-2">
          {player && !player.folded ? (
            player.hole.length ? (
              player.hole.map((c, k) => <PlayingCard key={k} card={c} size="xs" faceDown={!reveal} highlight={reveal && highlight.has(c)} />)
            ) : (
              <>
                <PlayingCard size="xs" faceDown />
                <PlayingCard size="xs" faceDown />
              </>
            )
          ) : (
            <span className="text-xl">{record.avatar}</span>
          )}
        </div>
        <div className="mt-0.5 flex w-full items-center justify-center gap-1">
          {player && !player.folded && <span className="text-sm">{record.avatar}</span>}
          <span className="truncate text-[11px] font-bold">{record.name}</span>
        </div>
        <span className="text-[11px] font-extrabold tabular-nums text-yellow-400">{fmt(player ? player.stack : record.stack)}</span>
        {reveal && hand?.result?.hands[index] && (
          <span className="mt-0.5 truncate text-[9px] font-bold text-emerald-300">{hand.result.hands[index]!.name}</span>
        )}
      </div>
      <div className="mt-0.5 flex h-4 items-center gap-1">
        {thinking ? (
          <span className="thinking text-[10px] font-bold text-yellow-300">생각 중…</span>
        ) : label ? (
          <span className="rounded-full bg-black/60 px-1.5 text-[10px] font-bold text-yellow-200">{label}</span>
        ) : !player && record.stack === 0 ? (
          <span className="text-[10px] text-gray-500">대기</span>
        ) : null}
      </div>
    </div>
  );
}

function MySeat({
  record,
  player,
  hand,
  index,
  label,
  turn,
  isWinner,
  highlight,
}: {
  record: SeatRecord;
  player: PlayerState | null;
  hand: HandState | null;
  index: number;
  label?: string;
  turn: boolean;
  isWinner: boolean;
  highlight: Set<Card>;
}) {
  const handName = useMemo(() => {
    if (!player || !hand || player.hole.length < 2) return '';
    if (hand.board.length < 3) return preflopLabel(player.hole);
    return evaluate([...player.hole, ...hand.board], false).name;
  }, [player, hand]);
  const isButton = !!hand && index === hand.button;
  return (
    <div
      className={cx(
        'relative flex items-center gap-3 rounded-2xl border border-yellow-500/30 bg-gray-900/90 px-3 py-2 transition',
        turn && 'glow-turn',
        isWinner && 'glow-win',
        player?.folded && 'opacity-60',
      )}
    >
      {isButton && <DealerChip />}
      <div className="flex gap-1">
        {player?.hole.length ? (
          player.hole.map((c, k) => (
            <PlayingCard
              key={k}
              card={c}
              size="lg"
              dim={player.folded || (highlight.size > 0 && !highlight.has(c))}
              highlight={highlight.has(c)}
            />
          ))
        ) : (
          <>
            <EmptyCardSlot size="lg" />
            <EmptyCardSlot size="lg" />
          </>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-lg">{record.avatar}</span>
          <span className="truncate text-sm font-bold">{record.name}</span>
        </div>
        <Chips amount={player ? player.stack : record.stack} className="text-base" />
        <div className="flex h-5 items-center gap-1.5">
          {handName && !player?.folded && (
            <span className="rounded-full bg-emerald-950 px-2 text-[11px] font-bold text-emerald-300">{handName}</span>
          )}
          {label && <span className="text-[11px] font-bold text-yellow-200">{label}</span>}
        </div>
      </div>
    </div>
  );
}

function LogStrip({ view, open, onToggle }: { view: TableView; open: boolean; onToggle: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [open, view.log]);
  const last = view.log.at(-1);
  const toneClass = (t: string) =>
    t === 'win' ? 'text-yellow-300 font-bold' : t === 'street' ? 'text-emerald-300' : t === 'system' ? 'text-gray-500' : t === 'mine' ? 'text-sky-300' : 'text-gray-300';
  return (
    <div className="relative mb-2 h-8 rounded-xl border border-gray-800 bg-gray-950/95">
      {open && (
        <div ref={ref} className="absolute inset-x-0 bottom-full z-40 mb-1 max-h-40 space-y-0.5 overflow-y-auto rounded-xl border border-gray-700 bg-gray-950 p-3 text-[11px]">
          {view.log.map((l) => (
            <div key={l.id} className={toneClass(l.tone)}>
              {l.text}
            </div>
          ))}
        </div>
      )}
      <button className="flex h-full w-full items-center gap-2 px-3 text-left text-[11px]" onClick={onToggle} aria-expanded={open} aria-label="핸드 기록">
        <ScrollText className="h-3.5 w-3.5 shrink-0 text-gray-500" />
        <span className={cx('flex-1 truncate', last && toneClass(last.tone))}>{last?.text ?? ''}</span>
        <ChevronUp className={cx('h-3.5 w-3.5 text-gray-500 transition', open && 'rotate-180')} />
      </button>
    </div>
  );
}

function ActionArea({
  view,
  balance,
  onAct,
  onNext,
  onRebuy,
  onLeave,
}: {
  view: TableView;
  balance: number;
  onAct: (a: Parameters<TableRunner['humanAct']>[0]) => void;
  onNext: () => void;
  onRebuy: (amount: number) => void;
  onLeave: () => void;
}) {
  const { hand, phase, session } = view;
  const stake = stakeById(session.stakeId);
  const human = view.seatOfPlayer.indexOf(0);

  if (phase === 'needRebuy') {
    return <RebuyPanel balance={balance} stake={stake} stack={session.seats[0]!.stack} onRebuy={onRebuy} onLeave={onLeave} />;
  }
  if (phase === 'noOpponents') {
    return (
      <div className="space-y-2 pb-1">
        <p className="text-center text-sm text-gray-400">함께 플레이할 수 있는 상대 선수가 없습니다.</p>
        <Button variant="primary" className="w-full" onClick={onLeave}>
          일어나기
        </Button>
      </div>
    );
  }
  if (phase === 'handOver' && hand?.result) {
    const net = human >= 0 ? hand.result.net[human] : 0;
    return (
      <div className="flex h-14 items-center gap-2">
        <div className={cx('w-24 text-center text-lg font-extrabold tabular-nums', net > 0 ? 'text-emerald-400' : net < 0 ? 'text-red-400' : 'text-gray-400')}>
          {net > 0 ? '+' : ''}
          {fmt(net)}
        </div>
        <Button variant="primary" className="flex-1 py-3.5 text-base" onClick={onNext}>
          다음 핸드
        </Button>
      </div>
    );
  }
  if (view.humanTurn && hand) return <BetControls hand={hand} onAct={onAct} />;

  const thinking = view.thinkingSeat !== null ? session.seats[view.thinkingSeat]?.name : null;
  const folded = human >= 0 && hand?.players[human].folded;
  return (
    <div className="flex h-14 items-center justify-center text-sm text-gray-500">
      {phase === 'starting' ? '카드를 섞는 중…' : folded ? '폴드했습니다 · 핸드 진행 중' : thinking ? `${thinking} 차례` : '…'}
    </div>
  );
}

function BetControls({ hand, onAct }: { hand: HandState; onAct: (a: Parameters<TableRunner['humanAct']>[0]) => void }) {
  const legal = legalActions(hand);
  const [raiseOpen, setRaiseOpen] = useState(false);
  const [amount, setAmount] = useState(legal.minRaiseTo);
  const pot = potTotal(hand);
  const isBet = hand.currentBet === 0;
  const bb = hand.bb;

  useEffect(() => {
    setAmount(legal.minRaiseTo);
    setRaiseOpen(false);
  }, [hand.toAct, hand.actions.length, legal.minRaiseTo]);

  const clamp = (v: number) => Math.max(legal.minRaiseTo, Math.min(legal.maxRaiseTo, Math.round(v / bb) * bb));
  // Pot-sized raise: call first, then raise by the resulting pot.
  const potRaise = (fraction: number) => clamp(hand.currentBet + (pot + legal.callAmount) * fraction);
  const presets = [
    { label: '½팟', value: potRaise(0.5) },
    { label: '¾팟', value: potRaise(0.75) },
    { label: '팟', value: potRaise(1) },
    { label: '올인', value: legal.maxRaiseTo },
  ];
  const callIsAllIn = legal.canCall && legal.callAmount >= hand.players[hand.toAct].stack;

  return (
    <div className="grid h-full min-h-0 grid-rows-[1fr_56px] gap-2">
      <div
        aria-hidden={!raiseOpen || !legal.canRaise}
        className={cx('flex min-h-0 flex-col justify-between rounded-xl border border-gray-800 bg-gray-900 p-2.5', (!raiseOpen || !legal.canRaise) && 'invisible')}
      >
        <div className="mb-1.5 flex items-center justify-between text-xs">
          <span className="text-gray-400">{isBet ? '벳' : '레이즈'} 금액</span>
          <Chips amount={amount} className="text-base" />
        </div>
        <div className="h-5 shrink-0">
          {legal.maxRaiseTo > legal.minRaiseTo && (
            <input
              type="range"
              className="w-full"
              aria-label="레이즈 금액"
              min={legal.minRaiseTo}
              max={legal.maxRaiseTo}
              step={bb}
              value={amount}
              onChange={(e) => {
                // The slider steps by BB from the minimum, so snap the last step to the full stack.
                const v = Number(e.target.value);
                setAmount(v + bb > legal.maxRaiseTo ? legal.maxRaiseTo : clamp(v));
              }}
            />
          )}
        </div>
        <div className="mt-1.5 grid grid-cols-4 gap-1.5">
          {presets.map((p) => (
            <button
              key={p.label}
              onClick={() => setAmount(p.value)}
              className={cx(
                'rounded-lg border py-1.5 text-xs font-bold',
                amount === p.value ? 'border-yellow-400 text-yellow-300' : 'border-gray-700 text-gray-300',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
      <div className="grid h-14 grid-cols-3 gap-2">
        <button
          disabled={!legal.canFold}
          onClick={() => onAct({ type: 'fold' })}
          className="rounded-xl bg-red-600 py-3.5 text-sm font-extrabold text-white active:bg-red-700 disabled:opacity-25"
        >
          폴드
        </button>
        {legal.canCheck ? (
          <button onClick={() => onAct({ type: 'check' })} className="rounded-xl bg-slate-600 py-3.5 text-sm font-extrabold text-white active:bg-slate-700">
            체크
          </button>
        ) : (
          <button onClick={() => onAct({ type: 'call' })} className="rounded-xl bg-blue-600 py-2 text-sm font-extrabold leading-tight text-white active:bg-blue-700">
            {callIsAllIn ? '올인 콜' : '콜'}
            <div className="text-[11px] font-bold text-blue-200 tabular-nums">{fmt(legal.callAmount)}</div>
          </button>
        )}
        {raiseOpen ? (
          <button
            onClick={() => onAct({ type: 'raise', to: amount })}
            className="rounded-xl bg-emerald-500 py-2 text-sm font-extrabold leading-tight text-black active:bg-emerald-600"
          >
            {amount >= legal.maxRaiseTo ? '올인' : isBet ? '벳' : '레이즈'}
            <div className="text-[11px] font-bold tabular-nums">{fmt(amount)}</div>
          </button>
        ) : (
          <button
            disabled={!legal.canRaise}
            onClick={() => setRaiseOpen(true)}
            className="rounded-xl bg-emerald-600 py-3.5 text-sm font-extrabold text-white active:bg-emerald-700 disabled:opacity-25"
          >
            {legal.minRaiseTo >= legal.maxRaiseTo && legal.canRaise ? '올인' : isBet ? '벳' : '레이즈'}
          </button>
        )}
      </div>
    </div>
  );
}

function RebuyPanel({
  balance,
  stake,
  stack,
  onRebuy,
  onLeave,
}: {
  balance: number;
  stake: ReturnType<typeof stakeById>;
  stack: number;
  onRebuy: (amount: number) => void;
  onLeave: () => void;
}) {
  const max = Math.min(balance, stake.maxBuyIn - stack);
  const can = max >= stake.minBuyIn;
  const [amount, setAmount] = useState(() => (can ? Math.min(max, Math.max(stake.minBuyIn, Math.round(stake.maxBuyIn / 2 / stake.bb) * stake.bb)) : 0));
  return (
    <div className="space-y-2 pb-1">
      <p className="text-center text-sm font-bold text-red-300">칩을 모두 잃었습니다</p>
      {can ? (
        <>
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>리바이 (지갑 {fmt(balance)})</span>
            <Chips amount={amount} />
          </div>
          <input type="range" className="w-full" min={stake.minBuyIn} max={max} step={stake.bb} value={amount} onChange={(e) => setAmount(Number(e.target.value))} />
          <div className="grid grid-cols-2 gap-2">
            <Button onClick={onLeave}>일어나기</Button>
            <Button variant="primary" onClick={() => onRebuy(amount)}>
              리바이
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-center text-xs text-gray-500">지갑 잔액이 최소 바이인({fmt(stake.minBuyIn)})보다 적어 리바이할 수 없습니다.</p>
          <Button variant="primary" className="w-full" onClick={onLeave}>
            일어나기
          </Button>
        </>
      )}
    </div>
  );
}

function EndModal({ view, onDone }: { view: TableView; onDone: () => void }) {
  const r = view.endResult!;
  const seat = view.session.seats[0]!;
  const net = r.cashOut - seat.buyInTotal;
  return (
    <Modal>
      {r.playerBankrupt ? (
        <>
          <div className="text-center text-5xl">💀</div>
          <h2 className="mt-2 text-center text-xl font-extrabold">파산했습니다</h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            <b>{seat.name}</b>은(는) 더 이상 플레이할 수 없습니다. 전적은 계속 볼 수 있어요. 새 캐릭터로 다시 도전하세요.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-center text-xl font-extrabold">게임 종료</h2>
          <div className="mt-4 space-y-1.5 text-sm">
            <Row label="플레이한 핸드" value={`${view.session.handsPlayed}`} />
            <Row label="바이인" value={fmt(seat.buyInTotal)} />
            <Row label="정산" value={fmt(r.cashOut)} />
            <Row
              label="손익"
              value={`${net >= 0 ? '+' : ''}${fmt(net)}`}
              tone={net > 0 ? 'text-emerald-400' : net < 0 ? 'text-red-400' : undefined}
            />
          </div>
        </>
      )}
      <Button variant="primary" className="mt-5 w-full" onClick={onDone}>
        {r.playerBankrupt ? '확인' : '로비로'}
      </Button>
    </Modal>
  );
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-400">{label}</span>
      <span className={cx('font-bold tabular-nums', tone)}>{value}</span>
    </div>
  );
}
