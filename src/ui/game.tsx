import { CircleHelp, DoorOpen } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { useApp } from '../app/store';
import { errorMessage } from '../core/errors';
import { useBackButton } from './hooks';
import { Button, ConfirmModal, cx, fmt, Modal } from './components';

/**
 * Shared header for every game screen: "일어나기" on the left, game info in
 * the middle, and a help button. The Android back button asks to leave too.
 */
export function GameHeader({
  onLeave,
  leaveDisabled,
  onHelp,
  children,
  right,
}: {
  onLeave: () => void;
  leaveDisabled?: boolean;
  onHelp: () => void;
  children: ReactNode;
  right?: ReactNode;
}) {
  return (
    <header className="safe-top flex shrink-0 items-center gap-2 px-3 pb-1.5">
      <button
        className="flex items-center gap-1 rounded-lg border border-gray-800 bg-gray-900 px-2.5 py-1.5 text-xs font-bold text-gray-300 active:bg-gray-800 disabled:opacity-40"
        onClick={onLeave}
        disabled={leaveDisabled}
      >
        <DoorOpen className="h-4 w-4" /> 일어나기
      </button>
      <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5 text-xs">{children}</div>
      {right}
      <button className="rounded-full p-1.5 text-gray-400 active:bg-white/10" onClick={onHelp} aria-label="게임 방법">
        <CircleHelp className="h-5 w-5" />
      </button>
    </header>
  );
}

/** What leaving right now costs the player. */
export interface LeaveStake {
  /** A hand or round is still being played. */
  inProgress: boolean;
  /** Chips already in that hand or round, lost on leaving. */
  wagered: number;
  /** Chips that go back to the wallet. */
  remaining: number;
  /** How an unfinished hand is settled: a fold at poker, a loss at house games. */
  settledAs: '폴드' | '패배';
}

export function LeaveConfirm({
  stake,
  onConfirm,
  onCancel,
}: {
  stake: LeaveStake;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const back = (
    <>
      남은 <b className="text-yellow-400">{fmt(stake.remaining)}</b>칩은 지갑으로 돌아갑니다.
    </>
  );
  return (
    <ConfirmModal
      title="자리에서 일어날까요?"
      message={
        stake.inProgress ? (
          <>
            진행 중인 판은 <b>{stake.settledAs}</b> 처리됩니다
            {stake.wagered > 0 && (
              <>
                {' '}
                · 이미 건 <b className="text-red-300">{fmt(stake.wagered)}</b>칩은 잃습니다
              </>
            )}
            .<br />
            {back}
          </>
        ) : (
          back
        )
      }
      confirmLabel="일어나기"
      onConfirm={onConfirm}
      onCancel={onCancel}
    />
  );
}

/**
 * Runs a leave action once at a time and shows its error as a toast, so a
 * double tap or a failed save never leaves the screen in limbo.
 */
export function useLeave<T>(run: () => Promise<T>, onLeft: (result: T) => void) {
  const showToast = useApp((s) => s.showToast);
  const [confirming, setConfirming] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const busy = useRef(false);

  const leave = async () => {
    if (busy.current) return;
    busy.current = true;
    setLeaving(true);
    setConfirming(false);
    try {
      onLeft(await run());
    } catch (error) {
      showToast(errorMessage(error));
    } finally {
      busy.current = false;
      setLeaving(false);
    }
  };

  useBackButton(() => {
    if (!busy.current) setConfirming(true);
  });

  return { confirming, leaving, leave, ask: () => setConfirming(true), cancel: () => setConfirming(false) };
}

export interface SessionSummary {
  name: string;
  bankrupt: boolean;
  /** "핸드" at poker, "판" at house games. */
  roundLabel: string;
  rounds: number;
  buyIn: number;
  cashOut: number;
  abandonedLoss: number;
}

/** Shown after leaving any game: the session's result, or the bankruptcy notice. */
export function SessionEndModal({ summary, onDone }: { summary: SessionSummary; onDone: () => void }) {
  const net = summary.cashOut - summary.buyIn;
  return (
    <Modal>
      {summary.bankrupt ? (
        <>
          <div className="text-center text-5xl">💀</div>
          <h2 className="mt-2 text-center text-xl font-extrabold">파산했습니다</h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            <b>{summary.name}</b>은(는) 더 이상 플레이할 수 없습니다. 전적은 계속 볼 수 있어요. 새 캐릭터로 다시
            도전하세요.
          </p>
        </>
      ) : (
        <>
          <h2 className="text-center text-xl font-extrabold">게임 종료</h2>
          <div className="mt-4 space-y-1.5 text-sm">
            <Row label={`플레이한 ${summary.roundLabel}`} value={fmt(summary.rounds)} />
            <Row label="입장금" value={fmt(summary.buyIn)} />
            {summary.abandonedLoss > 0 && (
              <Row label="중단한 판" value={`−${fmt(summary.abandonedLoss)}`} tone="text-red-400" />
            )}
            <Row label="정산" value={fmt(summary.cashOut)} />
            <Row
              label="손익"
              value={`${net > 0 ? '+' : ''}${fmt(net)}`}
              tone={net > 0 ? 'text-emerald-400' : net < 0 ? 'text-red-400' : undefined}
            />
          </div>
        </>
      )}
      <Button variant="primary" className="mt-5 w-full" onClick={onDone}>
        {summary.bankrupt ? '확인' : '로비로'}
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

/** "+1,200" / "−400" that rises and fades over a seat or hand when a round settles. */
export function FloatingNet({ net, className }: { net: number; className?: string }) {
  if (net === 0) return null;
  return (
    <span className={cx('float-up text-base', net > 0 ? 'text-yellow-300' : 'text-rose-300', className)}>
      {net > 0 ? '+' : '−'}
      {fmt(Math.abs(net))}
    </span>
  );
}
