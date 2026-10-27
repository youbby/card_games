import { Settings as SettingsIcon } from 'lucide-react';
import { useState } from 'react';
import { exitApp } from '../app/native';
import { type CreateReason, useApp } from '../app/store';
import { AVATARS } from '../data/names';
import { createPlayer, listPlayers, NAME_MAX_LENGTH, updateSettings } from '../services/characters';
import { Avatar, Button, Chips, cx, Page } from '../ui/components';
import { useAsync } from '../ui/hooks';

const INTRO: Record<CreateReason, { title: string; text: string }> = {
  first: { title: '환영합니다!', text: '플레이할 캐릭터를 만들어 주세요. 로그인은 없고, 캐릭터마다 칩과 전적이 따로 저장됩니다.' },
  allBankrupt: { title: '모든 캐릭터가 파산했습니다', text: '파산한 캐릭터로는 더 이상 플레이할 수 없어요. 새 캐릭터로 다시 시작하세요.' },
  new: { title: '새 캐릭터', text: '이름과 아바타를 고르세요.' },
};

export function CharacterCreateScreen({ reason }: { reason: CreateReason }) {
  const { push, back, reset, setPlayer, setSettings, settings } = useApp();
  const [name, setName] = useState('');
  const [avatar, setAvatar] = useState(() => AVATARS[Math.floor(Math.random() * AVATARS.length)]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const { data: players } = useAsync(listPlayers, []);
  const hasBankrupt = players?.some((p) => p.status === 'BANKRUPT');
  const intro = INTRO[reason];

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      const c = await createPlayer(name, avatar);
      setPlayer(c.id);
      setSettings(await updateSettings({ lastCharacterId: c.id }));
      reset([{ name: 'characterSelect' }, { name: 'lobby' }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page
      title={intro.title}
      onBack={reason === 'new' ? back : exitApp}
      right={
        reason !== 'new' && (
          <button className="rounded-full p-2 text-gray-300 active:bg-white/10" onClick={() => push({ name: 'settings' })} aria-label="설정">
            <SettingsIcon className="h-5 w-5" />
          </button>
        )
      }
      footer={
        <Button variant="primary" className="w-full" disabled={!name.trim() || busy} onClick={submit}>
          캐릭터 만들기
        </Button>
      }
    >
      <p className="text-sm text-gray-400">{intro.text}</p>

      <div className="mt-6 flex flex-col items-center gap-3">
        <Avatar emoji={avatar} size="lg" />
        <input
          value={name}
          maxLength={NAME_MAX_LENGTH}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && submit()}
          placeholder="이름 (최대 12자)"
          className="w-full rounded-xl border border-gray-700 bg-gray-900 px-4 py-3 text-center text-lg font-bold outline-none focus:border-yellow-500"
        />
        {error && <div className="text-sm text-red-400">{error}</div>}
      </div>

      <div className="mt-5 grid grid-cols-5 gap-2">
        {AVATARS.map((a) => (
          <button
            key={a}
            onClick={() => setAvatar(a)}
            className={cx(
              'flex aspect-square items-center justify-center rounded-xl border text-2xl',
              a === avatar ? 'border-yellow-400 bg-yellow-400/10' : 'border-gray-800 bg-gray-900',
            )}
          >
            {a}
          </button>
        ))}
      </div>

      <div className="mt-6 rounded-xl border border-gray-800 bg-gray-900 p-3 text-sm">
        <div className="flex items-center justify-between">
          <span className="text-gray-400">시작 칩</span>
          <Chips amount={settings.startingChips} />
        </div>
        <div className="mt-1 text-[11px] text-gray-500">설정에서 바꿀 수 있으며, 캐릭터를 만들 때만 적용됩니다.</div>
      </div>

      {reason === 'allBankrupt' && hasBankrupt && (
        <Button variant="ghost" className="mt-3 w-full" onClick={() => push({ name: 'characterSelect' })}>
          지난 캐릭터 전적 보기
        </Button>
      )}
    </Page>
  );
}
