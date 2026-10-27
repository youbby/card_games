import { Equal, Trophy, X } from 'lucide-react';
import type { RoundSummary } from './results';
import { cx, fmt } from './components';

/** A fixed-height, player-centered result: showing it never moves the cards. */
export function RoundResult({ summary, compact = false }: { summary: RoundSummary; compact?: boolean }) {
  const Icon = summary.tone === 'win' ? Trophy : summary.tone === 'loss' ? X : Equal;
  return (
    <div role="status" aria-live="polite" aria-atomic="true" data-testid="round-result" data-outcome={summary.tone} className={cx('round-result', `round-result-${summary.tone}`, compact && 'round-result-compact')}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2"><Icon className="h-5 w-5 shrink-0" aria-hidden="true" /><strong className="text-lg font-black leading-6">{summary.title}</strong></div>
        <div className="shrink-0 text-right"><div className="text-[9px] opacity-70">이번 판 내 순이익</div><div className="text-lg font-extrabold tabular-nums leading-6">{summary.net > 0 ? '+' : ''}{fmt(summary.net)}<span className="ml-0.5 text-[10px]">칩</span></div></div>
      </div>
      <p className="min-h-0 overflow-y-auto text-[11px] leading-4 opacity-85">{summary.detail}</p>
    </div>
  );
}
