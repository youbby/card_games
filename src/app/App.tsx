import { useEffect, useState } from 'react';
import { CharacterCreateScreen } from '../screens/CharacterCreateScreen';
import { CharacterSelectScreen } from '../screens/CharacterSelectScreen';
import { CpuListScreen } from '../screens/CpuListScreen';
import { GameSetupScreen } from '../screens/GameSetupScreen';
import { LobbyScreen } from '../screens/LobbyScreen';
import { SettingsScreen } from '../screens/SettingsScreen';
import { StatsScreen } from '../screens/StatsScreen';
import { TableScreen } from '../screens/TableScreen';
import { HouseScreen } from '../screens/HouseScreen';
import { HouseSetupScreen } from '../screens/HouseSetupScreen';
import { HelpScreen } from '../screens/HelpScreen';
import { applyAnimSpeed } from '../ui/motion';
import { boot } from './boot';
import { setUpNative } from './native';
import { currentScreen, useApp } from './store';
import { errorMessage } from '../core/errors';

export function App() {
  const screen = useApp(currentScreen);
  const toast = useApp((s) => s.toast);
  const animationSpeed = useApp((s) => s.settings.animationSpeed);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => applyAnimSpeed(animationSpeed), [animationSpeed]);

  useEffect(() => {
    void setUpNative();
    boot().catch((e: unknown) => setError(errorMessage(e)));
  }, []);

  let content;
  switch (screen.name) {
    case 'boot':
      content = (
        <div className="flex h-full flex-col items-center justify-center gap-3 text-gray-400">
          <div className="text-5xl">♠️</div>
          <div className="text-sm">{error ? `시작 오류: ${error}` : '불러오는 중…'}</div>
        </div>
      );
      break;
    case 'characterSelect':
      content = <CharacterSelectScreen />;
      break;
    case 'characterCreate':
      content = <CharacterCreateScreen reason={screen.reason} />;
      break;
    case 'lobby':
      content = <LobbyScreen />;
      break;
    case 'setup':
      content =
        screen.gameId === 'blackjack' || screen.gameId === 'baccarat' ? (
          <HouseSetupScreen gameId={screen.gameId} />
        ) : (
          <GameSetupScreen gameId={screen.gameId ?? 'holdem'} />
        );
      break;
    case 'table':
      content = <TableScreen key={screen.sessionId} sessionId={screen.sessionId} />;
      break;
    case 'house':
      content = <HouseScreen key={screen.roomId} roomId={screen.roomId} />;
      break;
    case 'stats':
      content = <StatsScreen characterId={screen.characterId} />;
      break;
    case 'cpus':
      content = <CpuListScreen />;
      break;
    case 'settings':
      content = <SettingsScreen />;
      break;
    case 'help':
      content = <HelpScreen gameId={screen.gameId} />;
      break;
  }

  return (
    <>
      {content}
      {toast && (
        <div className="pointer-events-none fixed inset-x-0 bottom-24 z-[60] flex justify-center px-6">
          <div className="pop-in rounded-full border border-gray-700 bg-gray-900/95 px-4 py-2 text-center text-sm shadow-xl">
            {toast}
          </div>
        </div>
      )}
    </>
  );
}
