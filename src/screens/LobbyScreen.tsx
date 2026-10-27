import { BarChart3, Bot, ChevronRight, Settings as SettingsIcon, Users } from 'lucide-react';
import { useApp } from '../app/store';
import { getCharacter, getStats } from '../services/characters';
import { Avatar, Chips, Page, Section } from '../ui/components';
import { useAsync } from '../ui/hooks';
import { GAMES } from '../games/catalog';


export function LobbyScreen() {
  const { playerId, push, back } = useApp();
  const { data } = useAsync(async () => {
    if (!playerId) return null;
    const [player, stats] = await Promise.all([getCharacter(playerId), getStats(playerId)]);
    return player ? { player, stats } : null;
  }, [playerId]);

  if (!data) return <Page title="로비" onBack={back}>{null}</Page>;
  const { player, stats } = data;
  const winRate = stats.handsPlayed ? Math.round((stats.handsWon / stats.handsPlayed) * 100) : 0;

  return (
    <Page
      title="로비"
      onBack={back}
      right={
        <button className="rounded-full p-2 text-gray-300 active:bg-white/10" onClick={() => push({ name: 'settings' })} aria-label="설정">
          <SettingsIcon className="h-5 w-5" />
        </button>
      }
    >
      <div className="rounded-2xl border border-yellow-500/30 bg-gradient-to-br from-gray-900 to-gray-950 p-4">
        <div className="flex items-center gap-3">
          <Avatar emoji={player.avatar} size="lg" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-lg font-extrabold">{player.name}</div>
            <Chips amount={player.balance} className="text-xl" />
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <Stat label="핸드" value={stats.handsPlayed.toLocaleString()} />
          <Stat label="승률" value={`${winRate}%`} />
          <Stat
            label="손익"
            value={`${stats.netProfit >= 0 ? '+' : ''}${stats.netProfit.toLocaleString()}`}
            tone={stats.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}
          />
        </div>
      </div>

      <Section title="게임">
        <div className="space-y-2">
          {GAMES.map((g) => (
            <button
              key={g.id}
              onClick={() => push({ name: 'setup', gameId: g.id })}
              className="flex w-full items-center gap-3 rounded-2xl border border-emerald-700/40 bg-gradient-to-r from-emerald-950 to-gray-900 p-4 text-left active:opacity-80"
            >
              <div className="text-4xl">{g.icon}</div>
              <div className="flex-1">
                <div className="text-lg font-extrabold">{g.name}</div>
                <div className="text-xs text-gray-400">{g.subtitle}</div>
              </div>
              <ChevronRight className="h-5 w-5 text-gray-500" />
            </button>
          ))}
        </div>
      </Section>

      <Section title="메뉴">
        <div className="grid grid-cols-3 gap-2">
          <MenuButton icon={<BarChart3 className="h-5 w-5" />} label="내 전적" onClick={() => push({ name: 'stats', characterId: player.id })} />
          <MenuButton icon={<Bot className="h-5 w-5" />} label="상대 선수" onClick={() => push({ name: 'cpus' })} />
          <MenuButton icon={<Users className="h-5 w-5" />} label="캐릭터 변경" onClick={back} />
        </div>
      </Section>
    </Page>
  );
}

function Stat({ label, value, tone = 'text-gray-100' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg bg-black/30 py-2">
      <div className="text-gray-500">{label}</div>
      <div className={`font-extrabold tabular-nums ${tone}`}>{value}</div>
    </div>
  );
}

function MenuButton({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center gap-1.5 rounded-2xl border border-gray-800 bg-gray-900 py-4 text-xs font-bold text-gray-300 active:bg-gray-800"
    >
      {icon}
      {label}
    </button>
  );
}
