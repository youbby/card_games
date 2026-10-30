import { ChevronUp, ScrollText } from 'lucide-react';
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
import { Button, Chips, ClassBadge, cx, EmptyCardSlot, fmt, PlayingCard } from '../ui/components';
import { gameName, profitTarget } from '../games/catalog';
import { FloatingNet, GameHeader, LeaveConfirm, SessionEndModal, useLeave, type SessionSummary } from '../ui/game';
import { HelpModal, TutorialModal, useTutorial } from '../ui/help';
import { RoundResult } from '../ui/RoundResult';
import { pokerResult } from '../ui/results';
import { errorMessage } from '../core/errors';

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

/**
 * Stagger for the opening deal: one card at a time around the table from the
 * small blind, like a real dealer. Cards dealt later (draw replacements) come at once.
 */
function dealDelay(hand: HandState, index: number, card: number): number {
  if (hand.street !== 'PREFLOP' || index < 0) return 0;
  const n = hand.players.length;
  const order = card * n + ((index - hand.sbIndex + n) % n);
  return order * (hand.variant === 'draw' ? 40 : 80);
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
  const [showLog, setShowLog] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const [ended, setEnded] = useState<SessionSummary | null>(null);
  const [balance, setBalance] = useState(0);
  const [drawSelection, setDrawSelection] = useState<number[]>([]);
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
      // On a first visit the tutorial is shown first; closing it deals the first hand.
      if ((settingsRef.current.tutorialsSeen ?? []).includes(session.gameId)) void runner.startNextHand();
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
  useEffect(() => {
    setDrawSelection([]);
  }, [view?.hand?.street, view?.session.handsPlayed]);

  const tutorial = useTutorial(view?.session.gameId);
  const finishTutorial = () => {
    tutorial.finish();
    void runnerRef.current?.startNextHand();
  };

  const leave = useLeave(
    async () => {
      const runner = runnerRef.current;
      if (!runner) throw new Error('테이블을 준비하는 중입니다.');
      return { result: await runner.leave(), view: runner.view() };
    },
    ({ result, view: last }) => {
      const seat = last.session.seats[0]!;
      setEnded({
        name: seat.name,
        bankrupt: result.playerBankrupt,
        roundLabel: '핸드',
        rounds: last.session.handsPlayed,
        buyIn: seat.buyInTotal,
        cashOut: result.cashOut,
        abandonedLoss: result.abandonedLoss,
      });
    },
  );

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
  const handLive = !!hand && !result;
  const inHand = handLive && !!me && !me.folded;

  return (
    <div className="mx-auto flex h-full min-h-0 max-w-lg flex-col overflow-hidden">
      <GameHeader
        onLeave={leave.ask}
        leaveDisabled={leave.leaving}
        onHelp={() => setShowHelp(true)}
        right={
          <div className="rounded-lg bg-gray-900 px-2 py-1.5 text-[11px] tabular-nums text-gray-400">
            #{session.handsPlayed + (handLive ? 1 : 0)}
          </div>
        }
      >
        <ClassBadge cls={session.cpuClass} />
        <span className="font-bold">{stake.name}</span>
        <span className="tabular-nums text-gray-400">
          {fmt(session.sb)}/{fmt(session.bb)}
        </span>
      </GameHeader>
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 pb-2 text-[10px] text-gray-500">
        <span>{gameName(session.gameId)}</span>
        <span>
          {session.profitMultiplier == null
            ? '수익 한도 없음'
            : `순이익 ${session.profitMultiplier}배 · 목표 ${fmt(profitTarget(session.initialBuyIn ?? session.seats[0]!.buyInTotal, session.seats[0]!.buyInTotal, session.profitMultiplier)!)}칩`}
        </span>
      </div>

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
        <div
          className={cx(
            'table-center absolute left-1/2 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2',
            session.gameId === 'draw' && 'table-center-draw',
          )}
        >
          <PotView hand={hand} />
          <div data-testid="community-cards" className="flex min-h-14 gap-1">
            {session.gameId === 'draw' ? (
              <div className="flex w-44 items-center justify-center text-center text-xs text-emerald-100/60">
                {hand?.street === 'DRAW' ? '카드 교환 중' : result ? '쇼다운' : '비공개 카드 5장 · 교환 1회'}
              </div>
            ) : (
              <BoardCards hand={hand} highlight={highlight} />
            )}
          </div>
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
          drawSelection={drawSelection}
          onToggleDraw={
            view.humanTurn && hand?.street === 'DRAW'
              ? (index) =>
                  setDrawSelection((selected) =>
                    selected.includes(index) ? selected.filter((i) => i !== index) : [...selected, index],
                  )
              : undefined
          }
        />
      </div>

      <div className="safe-bottom shrink-0 px-3 pt-2">
        <LogStrip view={view} open={showLog} onToggle={() => setShowLog((v) => !v)} onClose={() => setShowLog(false)} />
        <div className="table-actions flex flex-col justify-end" data-testid="table-actions">
          <ActionArea
            view={view}
            balance={balance}
            drawSelection={drawSelection}
            onAct={(a) => runnerRef.current?.humanAct(a)}
            onNext={() => void runnerRef.current?.startNextHand()}
            onRebuy={(amount) => runnerRef.current?.rebuy(amount).catch((e: unknown) => showToast(errorMessage(e)))}
            onLeave={leave.leave}
            leaving={leave.leaving}
          />
        </div>
      </div>

      {leave.confirming && (
        <LeaveConfirm
          stake={{
            inProgress: inHand,
            wagered: inHand ? me.contributed : 0,
            remaining: me ? me.stack : session.seats[0]!.stack,
            settledAs: '폴드',
          }}
          onConfirm={leave.leave}
          onCancel={leave.cancel}
        />
      )}
      {showHelp && <HelpModal gameId={session.gameId} onClose={() => setShowHelp(false)} />}
      {tutorial.open && <TutorialModal gameId={session.gameId} onDone={finishTutorial} />}
      {ended && (
        <SessionEndModal
          summary={ended}
          onDone={async () =>
            reset(ended.bankrupt ? [await startScreen()] : [{ name: 'characterSelect' }, { name: 'lobby' }])
          }
        />
      )}
    </div>
  );
}

function useFeedback(view: TableView | null, settings: Settings) {
  const lastLogId = useRef(0);
  const wasTurn = useRef(false);
  const lastResult = useRef<HandState['result']>(null);
  useEffect(() => {
    if (!view) return;
    const fresh = view.log.filter((l) => l.id > lastLogId.current);
    lastLogId.current = view.log.at(-1)?.id ?? lastLogId.current;
    for (const l of fresh) {
      if (l.tone === 'street') playSound('card', settings.sound);
      else if (l.tone === 'win') continue;
      else if (l.text.endsWith('폴드')) playSound('fold', settings.sound);
      else if (l.text.endsWith('체크')) playSound('check', settings.sound);
      else if (l.tone === 'action' || l.tone === 'mine') playSound('chip', settings.sound);
    }
    const result = view.hand?.result;
    if (result && result !== lastResult.current) {
      const net = result.net[view.seatOfPlayer.indexOf(0)] ?? 0;
      playSound(net > 0 ? 'win' : net < 0 ? 'lose' : 'check', settings.sound);
      if (net > 0) vibrate(settings.haptics, true);
      lastResult.current = result;
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
    <div
      key={total}
      className="bump rounded-full border border-yellow-500/40 bg-black/60 px-3 py-0.5 text-sm font-extrabold"
    >
      <span className="mr-1 text-[10px] text-gray-400">POT</span>
      <span className="tabular-nums text-yellow-400">{fmt(total)}</span>
    </div>
  );
}

/** Community cards. Newly dealt cards come one after another, also when an all-in runs the board out. */
function BoardCards({ hand, highlight }: { hand: HandState | null; highlight: Set<Card> }) {
  const shownBefore = useRef({ key: -1, count: 0 });
  const handKey = hand?.drawSeed ?? -1;
  const board = hand?.board ?? [];
  const before = shownBefore.current.key === handKey ? shownBefore.current.count : 0;
  useEffect(() => {
    shownBefore.current = { key: handKey, count: board.length };
  }, [handKey, board.length]);

  return Array.from({ length: 5 }, (_, i) =>
    board[i] !== undefined ? (
      <PlayingCard
        key={`${handKey}-${i}-${board[i]}`}
        card={board[i]}
        size="board"
        delay={i < before ? 0 : (i - before) * 160 + (i >= 3 && before < 3 ? 260 : 0)}
        highlight={highlight.has(board[i])}
        dim={highlight.size > 0 && !highlight.has(board[i])}
      />
    ) : (
      <EmptyCardSlot key={i} size="board" />
    ),
  );
}

function PositionChips({ hand, index, className }: { hand: HandState | null; index: number; className: string }) {
  if (!hand || index < 0) return null;
  const positions = [
    { role: 'D', label: '딜러', seat: hand.button },
    { role: 'SB', label: '스몰 블라인드', seat: hand.sbIndex },
    { role: 'BB', label: '빅 블라인드', seat: hand.bbIndex },
  ].filter((position) => position.seat === index);
  if (!positions.length) return null;
  return (
    <div className={cx('pointer-events-none', className)}>
      {positions.map(({ role, label }) => (
        <span
          key={role}
          className={cx('position-chip', `position-chip-${role.toLowerCase()}`)}
          data-position={role}
          data-player-index={index}
          aria-label={`${hand.players[index].name}: ${label}`}
          title={label}
        >
          {role}
        </span>
      ))}
    </div>
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
  return (
    <div className="absolute z-10 flex w-[76px] flex-col items-center" style={style}>
      <PositionChips
        hand={hand}
        index={index}
        className={cx('absolute top-1 z-20 flex flex-col gap-1', parseFloat(pos.left) > 50 ? '-left-3' : '-right-3')}
      />
      <div
        className={cx(
          'relative flex w-full flex-col items-center rounded-xl border border-white/10 bg-black/55 px-1 pb-1 pt-1.5 transition',
          thinking && 'glow-turn',
          isWinner && 'glow-win',
          (player?.folded || !player) && 'opacity-45',
        )}
      >
        {hand?.result && player && hand.result.net[index] > 0 && (
          <FloatingNet key={hand.drawSeed} net={hand.result.net[index]} className="-top-3" />
        )}
        <div className={cx('flex h-9 items-center', hand?.variant === 'draw' ? '-space-x-0.5' : '-space-x-2')}>
          {player && !player.folded ? (
            player.hole.length ? (
              player.hole.map((c, k) => (
                <PlayingCard
                  key={`${hand!.drawSeed}-${k}-${c}`}
                  card={c}
                  size={hand?.variant === 'draw' ? 'drawOpponent' : 'xs'}
                  faceDown={!reveal}
                  flip={reveal}
                  delay={reveal ? k * 90 : dealDelay(hand!, index, k)}
                  highlight={reveal && highlight.has(c)}
                />
              ))
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
        <span className="text-[11px] font-extrabold tabular-nums text-yellow-400">
          {fmt(player ? player.stack : record.stack)}
        </span>
        {reveal && hand?.result?.hands[index] && (
          <span className="mt-0.5 truncate text-[9px] font-bold text-emerald-300">
            {hand.result.hands[index]!.name}
          </span>
        )}
      </div>
      <div className="mt-0.5 flex h-4 items-center gap-1">
        {hand?.result && player ? (
          <span
            className={cx(
              'rounded-full border px-2 text-[10px] font-extrabold',
              isWinner
                ? 'border-yellow-400/60 bg-yellow-950 text-yellow-200'
                : 'border-gray-600 bg-gray-950 text-gray-300',
            )}
          >
            {isWinner ? (hand.result.net[index] > 0 ? '승리' : '팟 획득') : player.folded ? '폴드' : '패배'}
          </span>
        ) : thinking ? (
          <span className="thinking text-[10px] font-bold text-yellow-300">생각 중…</span>
        ) : label && !/^(SB|BB) /.test(label) ? (
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
  drawSelection = [],
  onToggleDraw,
}: {
  record: SeatRecord;
  player: PlayerState | null;
  hand: HandState | null;
  index: number;
  label?: string;
  turn: boolean;
  isWinner: boolean;
  highlight: Set<Card>;
  drawSelection?: number[];
  onToggleDraw?: (index: number) => void;
}) {
  const handName = useMemo(() => {
    if (!player || !hand || player.hole.length < 2) return '';
    if (hand.variant !== 'draw' && hand.board.length < 3) return preflopLabel(player.hole);
    return evaluate([...player.hole, ...hand.board], false).name;
  }, [player, hand]);
  return (
    <div
      className={cx(
        'relative flex items-center gap-3 rounded-2xl border border-yellow-500/30 bg-gray-900/90 px-3 py-2 transition',
        turn && 'glow-turn',
        isWinner && (hand?.result?.net[index] ?? 0) > 0 && 'glow-win',
        player?.folded && 'opacity-60',
      )}
    >
      {hand?.result && index >= 0 && (
        <FloatingNet key={hand.drawSeed} net={hand.result.net[index]} className="-top-4" />
      )}
      <PositionChips hand={hand} index={index} className="absolute -top-9 right-3 z-20 flex gap-1.5" />
      <div className="flex gap-1">
        {player?.hole.length ? (
          player.hole.map((c, k) => (
            <button
              key={`${hand!.drawSeed}-${k}-${c}`}
              disabled={!onToggleDraw}
              onClick={() => onToggleDraw?.(k)}
              aria-label={`카드 ${k + 1} 교환 선택`}
              aria-pressed={drawSelection.includes(k)}
              className={cx(
                'relative rounded-lg',
                drawSelection.includes(k) && 'outline-2 outline-offset-2 outline-yellow-400',
              )}
            >
              <PlayingCard
                card={c}
                delay={dealDelay(hand!, index, k)}
                size={hand?.variant === 'draw' ? 'board' : 'lg'}
                dim={player.folded || (highlight.size > 0 && !highlight.has(c))}
                highlight={highlight.has(c)}
              />
              {drawSelection.includes(k) && (
                <span className="absolute inset-x-0 bottom-0 rounded-b-md bg-yellow-400 py-0.5 text-[9px] font-bold text-black">
                  교환
                </span>
              )}
            </button>
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
          <span className="shrink-0 rounded border border-yellow-400/30 px-1 text-[9px] font-bold text-yellow-200">
            나
          </span>
        </div>
        <Chips amount={player ? player.stack : record.stack} className="text-base" />
        <div className="flex h-5 items-center gap-1.5">
          {handName && !player?.folded && (
            <span className="rounded-full bg-emerald-950 px-2 text-[11px] font-bold text-emerald-300">{handName}</span>
          )}
          {label && !/^(SB|BB) /.test(label) && <span className="text-[11px] font-bold text-yellow-200">{label}</span>}
        </div>
      </div>
    </div>
  );
}

function LogStrip({
  view,
  open,
  onToggle,
  onClose,
}: {
  view: TableView;
  open: boolean;
  onToggle: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismissOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !containerRef.current?.contains(event.target)) onClose();
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', dismissOutside, true);
    document.addEventListener('keydown', dismissOnEscape);
    return () => {
      document.removeEventListener('pointerdown', dismissOutside, true);
      document.removeEventListener('keydown', dismissOnEscape);
    };
  }, [open, onClose]);
  useEffect(() => {
    if (open && ref.current) ref.current.scrollTop = ref.current.scrollHeight;
  }, [open, view.log]);
  const last = view.log.at(-1);
  const toneClass = (t: string) =>
    t === 'win'
      ? 'text-yellow-300 font-bold'
      : t === 'street'
        ? 'text-emerald-300'
        : t === 'system'
          ? 'text-gray-500'
          : t === 'mine'
            ? 'text-sky-300'
            : 'text-gray-300';
  return (
    <div ref={containerRef} className="relative mb-2 h-8 rounded-xl border border-gray-800 bg-gray-950/95">
      {open && (
        <div
          id="hand-history-panel"
          ref={ref}
          className="absolute inset-x-0 bottom-full z-40 mb-1 max-h-40 space-y-0.5 overflow-y-auto rounded-xl border border-gray-700 bg-gray-950 p-3 text-[11px]"
        >
          {view.log.map((l) => (
            <div key={l.id} className={toneClass(l.tone)}>
              {l.text}
            </div>
          ))}
        </div>
      )}
      <button
        className="flex h-full w-full items-center gap-2 px-3 text-left text-[11px]"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="hand-history-panel"
        aria-label="핸드 기록"
      >
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
  leaving,
  drawSelection,
}: {
  view: TableView;
  balance: number;
  onAct: (a: Parameters<TableRunner['humanAct']>[0]) => void;
  onNext: () => void;
  onRebuy: (amount: number) => void;
  onLeave: () => void;
  leaving: boolean;
  drawSelection: number[];
}) {
  const { hand, phase, session } = view;
  const stake = stakeById(session.stakeId);
  const human = view.seatOfPlayer.indexOf(0);
  const summary = hand ? pokerResult(hand, human) : null;
  if (phase === 'profitLimit')
    return (
      <div className="flex h-full flex-col justify-end gap-2">
        {summary && (
          <div className="result-in">
            <RoundResult summary={summary} compact />
          </div>
        )}
        <p className="text-center text-[11px] text-yellow-200">수익 목표 달성 · 전액 정산 후 새 방에 입장해 주세요.</p>
        <Button className="w-full" variant="primary" disabled={leaving} onClick={onLeave}>
          정산하고 나가기
        </Button>
      </div>
    );

  if (phase === 'needRebuy') {
    return (
      <RebuyPanel
        balance={balance}
        stake={stake}
        stack={session.seats[0]!.stack}
        onRebuy={onRebuy}
        onLeave={onLeave}
        leaving={leaving}
      />
    );
  }
  if (phase === 'noOpponents') {
    return (
      <div className="space-y-2 pb-1">
        <p className="text-center text-sm text-gray-400">함께 플레이할 수 있는 상대 선수가 없습니다.</p>
        <Button variant="primary" className="w-full" disabled={leaving} onClick={onLeave}>
          일어나기
        </Button>
      </div>
    );
  }
  if (phase === 'handOver' && summary) {
    return (
      <div className="flex h-full flex-col justify-end gap-2">
        <div key={hand!.drawSeed} className="result-in">
          <RoundResult summary={summary} />
        </div>
        <Button variant="primary" className="h-14 w-full text-base" onClick={onNext}>
          다음 핸드
        </Button>
      </div>
    );
  }
  if (view.humanTurn && hand?.street === 'DRAW')
    return (
      <div className="space-y-3 pb-1 text-center">
        <p className="text-sm text-gray-300">내 카드에서 교환할 카드를 누르세요 (0~5장).</p>
        <Button className="w-full" variant="primary" onClick={() => onAct({ type: 'draw', indices: drawSelection })}>
          {drawSelection.length ? `${drawSelection.length}장 교환` : '모두 유지'}
        </Button>
      </div>
    );
  if (view.humanTurn && hand) return <BetControls hand={hand} onAct={onAct} />;

  const thinking = view.thinkingSeat !== null ? session.seats[view.thinkingSeat]?.name : null;
  const folded = human >= 0 && hand?.players[human].folded;
  return (
    <div className="flex h-14 items-center justify-center text-sm text-gray-500">
      {phase === 'starting'
        ? '카드를 섞는 중…'
        : folded
          ? '폴드했습니다 · 핸드 진행 중'
          : thinking
            ? `${thinking} 차례`
            : '…'}
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
        className={cx(
          'flex min-h-0 flex-col justify-between rounded-xl border border-gray-800 bg-gray-900 p-2.5',
          (!raiseOpen || !legal.canRaise) && 'invisible',
        )}
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
          className="poker-action poker-action-fold"
        >
          폴드
        </button>
        {legal.canCheck ? (
          <button onClick={() => onAct({ type: 'check' })} className="poker-action poker-action-call">
            체크
          </button>
        ) : (
          <button onClick={() => onAct({ type: 'call' })} className="poker-action poker-action-call">
            {callIsAllIn ? '올인 콜' : '콜'}
            <span className="poker-action-amount">{fmt(legal.callAmount)}</span>
          </button>
        )}
        {raiseOpen ? (
          <button onClick={() => onAct({ type: 'raise', to: amount })} className="poker-action poker-action-raise">
            {amount >= legal.maxRaiseTo ? '올인' : isBet ? '벳' : '레이즈'}
            <span className="poker-action-amount">{fmt(amount)}</span>
          </button>
        ) : (
          <button
            disabled={!legal.canRaise}
            onClick={() => setRaiseOpen(true)}
            className="poker-action poker-action-raise"
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
  leaving,
}: {
  balance: number;
  stake: ReturnType<typeof stakeById>;
  stack: number;
  onRebuy: (amount: number) => void;
  onLeave: () => void;
  leaving: boolean;
}) {
  const max = Math.min(balance, stake.maxBuyIn - stack);
  const can = max >= stake.minBuyIn;
  const [amount, setAmount] = useState(() =>
    can ? Math.min(max, Math.max(stake.minBuyIn, Math.round(stake.maxBuyIn / 2 / stake.bb) * stake.bb)) : 0,
  );
  return (
    <div className="space-y-2 pb-1">
      <p className="text-center text-sm font-bold text-red-300">칩을 모두 잃었습니다</p>
      {can ? (
        <>
          <div className="flex items-center justify-between text-xs text-gray-400">
            <span>리바이 (지갑 {fmt(balance)})</span>
            <Chips amount={amount} />
          </div>
          <input
            type="range"
            className="w-full"
            min={stake.minBuyIn}
            max={max}
            step={stake.bb}
            value={amount}
            onChange={(e) => setAmount(Number(e.target.value))}
          />
          <div className="grid grid-cols-2 gap-2">
            <Button disabled={leaving} onClick={onLeave}>
              일어나기
            </Button>
            <Button variant="primary" onClick={() => onRebuy(amount)}>
              리바이
            </Button>
          </div>
        </>
      ) : (
        <>
          <p className="text-center text-xs text-gray-500">
            지갑 잔액이 최소 바이인({fmt(stake.minBuyIn)})보다 적어 리바이할 수 없습니다.
          </p>
          <Button variant="primary" className="w-full" disabled={leaving} onClick={onLeave}>
            일어나기
          </Button>
        </>
      )}
    </div>
  );
}
