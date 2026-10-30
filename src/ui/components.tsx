import { ChevronLeft, Coins } from 'lucide-react';
import type { ReactNode } from 'react';
import { type Card, isRed, rankLabel, rankOf, SUIT_SYMBOLS, suitOf } from '../core/cards';
import type { CpuClass } from '../games/holdem/ai/types';
import { useBackButton } from './hooks';

export const fmt = (n: number) => n.toLocaleString('ko-KR');

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Page({
  title,
  onBack,
  right,
  children,
  footer,
}: {
  title: ReactNode;
  onBack?: () => void;
  right?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useBackButton(() => onBack?.(), !!onBack);
  return (
    <div className="mx-auto flex h-full max-w-lg flex-col">
      <header className="safe-top flex shrink-0 items-center gap-2 px-3 pb-2">
        {onBack ? (
          <button
            onClick={onBack}
            className="-ml-1 rounded-full p-1.5 text-gray-300 active:bg-white/10"
            aria-label="뒤로"
          >
            <ChevronLeft className="h-6 w-6" />
          </button>
        ) : (
          <div className="w-1" />
        )}
        <h1 className="flex-1 truncate text-lg font-extrabold">{title}</h1>
        {right}
      </header>
      <main className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">{children}</main>
      {footer && <footer className="safe-bottom shrink-0 border-t border-white/5 bg-ink px-4 pt-3">{footer}</footer>}
    </div>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

const BUTTON_STYLES: Record<ButtonVariant, string> = {
  primary: 'bg-yellow-400 text-black active:bg-yellow-500',
  secondary: 'bg-gray-800 text-gray-100 border border-gray-700 active:bg-gray-700',
  danger: 'bg-red-600 text-white active:bg-red-700',
  ghost: 'text-gray-300 active:bg-white/10',
};

export function Button({
  children,
  onClick,
  variant = 'secondary',
  disabled,
  className,
  type = 'button',
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  className?: string;
  type?: 'button' | 'submit';
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        'flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-bold transition disabled:pointer-events-none disabled:opacity-35',
        BUTTON_STYLES[variant],
        className,
      )}
    >
      {children}
    </button>
  );
}

export function Modal({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  useBackButton(() => onClose?.());
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-4 sm:items-center" onClick={onClose}>
      <div
        className="pop-in w-full max-w-sm rounded-2xl border border-gray-700 bg-gray-900 p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = '확인',
  danger,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Modal onClose={onCancel}>
      <h2 className="text-lg font-extrabold">{title}</h2>
      <div className="mt-2 text-sm text-gray-300">{message}</div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button onClick={onCancel}>취소</Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

export function Chips({ amount, className }: { amount: number; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1 font-extrabold tabular-nums text-yellow-400', className)}>
      <Coins className="h-[1em] w-[1em]" />
      {fmt(amount)}
    </span>
  );
}

export const CLASS_LABEL: Record<CpuClass, string> = { LOW: '하수', HIGH: '고수' };

export function ClassBadge({ cls, className }: { cls: CpuClass; className?: string }) {
  return (
    <span
      className={cx(
        'rounded-md px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wide',
        cls === 'LOW' ? 'bg-sky-500/20 text-sky-300' : 'bg-orange-500/20 text-orange-300',
        className,
      )}
    >
      {CLASS_LABEL[cls]}
    </span>
  );
}

export function Avatar({ emoji, size = 'md', dim }: { emoji: string; size?: 'sm' | 'md' | 'lg'; dim?: boolean }) {
  const sizes = { sm: 'h-8 w-8 text-lg', md: 'h-11 w-11 text-2xl', lg: 'h-16 w-16 text-4xl' };
  return (
    <div
      className={cx(
        'flex shrink-0 items-center justify-center rounded-full border border-white/10 bg-gray-800',
        sizes[size],
        dim && 'opacity-40 grayscale',
      )}
    >
      {emoji}
    </div>
  );
}

const CARD_SIZES = {
  drawOpponent: 'h-8 w-[14px] text-[8px] rounded-sm',
  xs: 'h-9 w-[26px] text-[10px] rounded',
  sm: 'h-12 w-[34px] text-xs rounded-md',
  board: 'h-14 w-10 text-sm rounded-md max-[380px]:h-[50px] max-[380px]:w-8 max-[380px]:text-xs',
  md: 'h-[62px] w-11 text-sm rounded-md',
  lg: 'h-[78px] w-14 text-base rounded-lg',
};

/** Inline style that delays a card animation, scaled by the animation speed setting. */
export const animDelay = (ms: number) => (ms ? { animationDelay: `calc(${ms}ms * var(--anim, 1))` } : undefined);

export function PlayingCard({
  card,
  size = 'md',
  faceDown,
  highlight,
  dim,
  delay = 0,
  flip,
}: {
  card?: Card;
  size?: keyof typeof CARD_SIZES;
  faceDown?: boolean;
  highlight?: boolean;
  dim?: boolean;
  /** Milliseconds to wait before the card is dealt (for staggered deals). */
  delay?: number;
  /** Turn the card over instead of dealing it (a face-down card being revealed). */
  flip?: boolean;
}) {
  if (faceDown || card === undefined) {
    return <div className={cx('card-back deal-in shrink-0', CARD_SIZES[size])} style={animDelay(delay)} />;
  }
  const suit = SUIT_SYMBOLS[suitOf(card)];
  return (
    <div
      style={animDelay(delay)}
      className={cx(
        'card-face relative flex shrink-0 flex-col justify-between p-0.5 font-black leading-none',
        flip ? 'flip-in' : 'deal-in',
        CARD_SIZES[size],
        isRed(card) ? 'text-red-600' : 'text-gray-900',
        highlight && 'outline-2 outline-offset-1 outline-yellow-400',
        dim && 'opacity-50',
      )}
    >
      <span className="pl-0.5">{rankLabel(rankOf(card))}</span>
      <span className="self-center text-[1.4em]">{suit}</span>
      <span className="self-end pr-0.5 text-[0.8em]">{suit}</span>
    </div>
  );
}

export function EmptyCardSlot({ size = 'md' }: { size?: keyof typeof CARD_SIZES }) {
  return <div className={cx('shrink-0 border border-dashed border-white/15', CARD_SIZES[size])} />;
}

export function Section({ title, children, aside }: { title: ReactNode; children: ReactNode; aside?: ReactNode }) {
  return (
    <section className="mt-5">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-bold uppercase tracking-wider text-gray-400">{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}

export function personalityTags(p?: { tightness: number; aggression: number; bluff: number }): string[] {
  if (!p) return [];
  const tags: string[] = [];
  tags.push(p.tightness >= 0.55 ? '🪨 타이트' : p.tightness <= 0.25 ? '🌊 루즈' : '⚖️ 보통');
  if (p.aggression >= 0.65) tags.push('🔥 공격적');
  else if (p.aggression <= 0.3) tags.push('🐢 수동적');
  if (p.bluff >= 0.35) tags.push('🎭 블러퍼');
  return tags;
}
