import { ChevronDown, ChevronRight, Plus, Settings as SettingsIcon, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { exitApp } from '../app/native';
import { useApp } from '../app/store';
import type { Character } from '../data/types';
import { deletePlayer, getStats, listPlayers, updateSettings } from '../services/characters';
import { Avatar, Button, Chips, ConfirmModal, cx, Page } from '../ui/components';
import { useAsync } from '../ui/hooks';
import { startScreen } from '../app/boot';

export function CharacterSelectScreen() {
  const { push, back, reset, setPlayer, setSettings, settings } = useApp();
  const canGoBack = useApp((s) => s.stack.length > 1);
  const { data, reload } = useAsync(async () => {
    const players = await listPlayers();
    const stats = await Promise.all(players.map((p) => getStats(p.id)));
    return players.map((p, i) => ({ player: p, stats: stats[i] }));
  }, []);
  const [showBankrupt, setShowBankrupt] = useState(false);
  const [deleting, setDeleting] = useState<Character | null>(null);
  const [confirmExit, setConfirmExit] = useState(false);

  const active = data?.filter((d) => d.player.status === 'ACTIVE') ?? [];
  const bankrupt = data?.filter((d) => d.player.status === 'BANKRUPT') ?? [];
  const bankruptOpen = showBankrupt || (data !== undefined && active.length === 0);
  const lastId = settings.lastCharacterId;
  active.sort((a, b) => (a.player.id === lastId ? -1 : b.player.id === lastId ? 1 : 0));

  const choose = async (p: Character) => {
    setPlayer(p.id);
    setSettings(await updateSettings({ lastCharacterId: p.id }));
    push({ name: 'lobby' });
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    await deletePlayer(deleting.id);
    setDeleting(null);
    const next = await startScreen();
    if (next.name === 'characterSelect') reload();
    else reset([next]);
  };

  return (
    <Page
      title="누구로 플레이할까요?"
      onBack={canGoBack ? back : () => setConfirmExit(true)}
      right={
        <button className="rounded-full p-2 text-gray-300 active:bg-white/10" onClick={() => push({ name: 'settings' })} aria-label="설정">
          <SettingsIcon className="h-5 w-5" />
        </button>
      }
      footer={
        <Button variant="primary" className="w-full" onClick={() => push({ name: 'characterCreate', reason: 'new' })}>
          <Plus className="h-4 w-4" /> 새 캐릭터
        </Button>
      }
    >
      <div className="space-y-2">
        {active.map(({ player, stats }) => (
          <div
            key={player.id}
            className={cx(
              'flex items-center gap-3 rounded-2xl border bg-gray-900 p-3',
              player.id === lastId ? 'border-yellow-500/50' : 'border-gray-800',
            )}
          >
            <button className="flex min-w-0 flex-1 items-center gap-3 text-left" onClick={() => choose(player)}>
              <Avatar emoji={player.avatar} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate font-bold">{player.name}</span>
                  {player.id === lastId && <span className="text-[10px] font-bold text-yellow-400">최근</span>}
                </div>
                <Chips amount={player.balance} className="text-sm" />
                <div className="text-[11px] text-gray-500">
                  {stats.handsPlayed}핸드 · 승률 {stats.handsPlayed ? Math.round((stats.handsWon / stats.handsPlayed) * 100) : 0}%
                </div>
              </div>
              <ChevronRight className="h-5 w-5 text-gray-600" />
            </button>
            <button className="rounded-full p-2 text-gray-600 active:bg-white/10" onClick={() => setDeleting(player)} aria-label="삭제">
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>

      {bankrupt.length > 0 && (
        <div className="mt-6">
          <button className="flex w-full items-center gap-1 text-xs font-bold text-gray-500" onClick={() => setShowBankrupt((v) => !v)}>
            <ChevronDown className={cx('h-4 w-4 transition', !bankruptOpen && '-rotate-90')} /> 파산한 캐릭터 {bankrupt.length}
          </button>
          {bankruptOpen && (
            <div className="mt-2 space-y-2">
              {bankrupt.map(({ player, stats }) => (
                <div key={player.id} className="flex items-center gap-3 rounded-2xl border border-gray-800/60 bg-gray-900/50 p-3">
                  <button
                    className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    onClick={() => push({ name: 'stats', characterId: player.id })}
                  >
                    <Avatar emoji={player.avatar} dim />
                    <div className="min-w-0 flex-1 text-gray-400">
                      <div className="truncate font-bold">{player.name} 💀</div>
                      <div className="text-[11px]">
                        최고 {player.peakBalance.toLocaleString()} · {stats.handsPlayed}핸드 · 생존{' '}
                        {Math.max(1, Math.ceil(((player.bankruptAt ?? Date.now()) - player.createdAt) / 86_400_000))}일
                      </div>
                    </div>
                    <span className="text-[11px] text-gray-500">전적 보기</span>
                  </button>
                  <button className="rounded-full p-2 text-gray-700 active:bg-white/10" onClick={() => setDeleting(player)} aria-label="삭제">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {deleting && (
        <ConfirmModal
          title="캐릭터 삭제"
          message={
            <>
              <b>{deleting.name}</b>의 칩과 전적이 모두 삭제됩니다. 되돌릴 수 없습니다.
            </>
          }
          confirmLabel="삭제"
          danger
          onConfirm={confirmDelete}
          onCancel={() => setDeleting(null)}
        />
      )}
      {confirmExit && (
        <ConfirmModal title="앱 종료" message="게임을 종료할까요?" confirmLabel="종료" onConfirm={exitApp} onCancel={() => setConfirmExit(false)} />
      )}
    </Page>
  );
}
