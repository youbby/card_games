import { useState } from 'react';
import { useApp } from '../app/store';
import { errorMessage } from '../core/errors';
import type { GameId } from '../games/catalog';
import { updateSettings } from '../services/characters';
import { Button, cx, Page } from '../ui/components';
import { GameRules, HandRankings, HELP_TABS } from '../ui/help';

export function HelpScreen({ gameId }: { gameId?: GameId }) {
  const { back, settings, setSettings, showToast } = useApp();
  const [tab, setTab] = useState<'ranks' | GameId>(gameId ?? 'ranks');

  const replayTutorials = () =>
    updateSettings({ tutorialsSeen: [] })
      .then((next) => {
        setSettings(next);
        showToast('다음에 게임에 들어가면 튜토리얼이 다시 나옵니다.');
      })
      .catch((error: unknown) => showToast(errorMessage(error)));

  return (
    <Page title="게임 방법" onBack={back}>
      <div className="sticky top-0 z-10 -mx-4 bg-ink px-4 pb-2">
        <div className="grid grid-cols-5 gap-1 rounded-xl bg-gray-900 p-1 text-xs font-bold">
          {HELP_TABS.map((item) => (
            <button
              key={item.id}
              onClick={() => setTab(item.id)}
              className={cx('rounded-lg py-2', tab === item.id ? 'bg-gray-700 text-white' : 'text-gray-400')}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>
      <div className="mt-2">{tab === 'ranks' ? <HandRankings /> : <GameRules gameId={tab} />}</div>
      <Button className="mt-6 w-full" onClick={replayTutorials} disabled={(settings.tutorialsSeen ?? []).length === 0}>
        튜토리얼 다시 보기
      </Button>
    </Page>
  );
}
