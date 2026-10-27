import { useState } from 'react';
import { startScreen } from '../app/boot';
import { useApp } from '../app/store';
import { type AnimationSpeed, type Settings, STARTING_CHIPS_MAX, STARTING_CHIPS_MIN, STARTING_CHIPS_PRESETS } from '../data/types';
import { getSettings, updateSettings, updateProfitLimit } from '../services/characters';
import { factoryReset } from '../services/factoryReset';
import { Button, cx, fmt, Modal, Page, Section } from '../ui/components';
import { GAMES } from '../games/catalog';

const RESET_WORD = '초기화';

export function SettingsScreen() {
  const { back, settings, setSettings, reset, setPlayer, showToast } = useApp();
  const [custom, setCustom] = useState('');
  const [resetStep, setResetStep] = useState<0 | 1 | 2>(0);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (patch: Partial<Omit<Settings, 'id'>>) => setSettings(await updateSettings(patch));

  const applyCustom = async () => {
    const n = Math.round(Number(custom.replace(/[^\d]/g, '')));
    if (!Number.isFinite(n) || n < STARTING_CHIPS_MIN || n > STARTING_CHIPS_MAX) {
      showToast(`${fmt(STARTING_CHIPS_MIN)} ~ ${fmt(STARTING_CHIPS_MAX)} 사이로 입력하세요`);
      return;
    }
    await save({ startingChips: n });
    setCustom('');
    showToast('시작 칩을 변경했습니다');
  };

  const doReset = async () => {
    setBusy(true);
    try {
      await factoryReset();
      setSettings(await getSettings());
      setPlayer(null);
      reset([await startScreen()]);
      showToast('앱을 초기화했습니다');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="설정" onBack={back}>
      <Section title="시작 칩">
        <p className="mb-2 text-[11px] text-gray-500">새 캐릭터를 만들 때만 적용됩니다. 기존 캐릭터와 상대 선수에는 영향이 없습니다.</p>
        <div className="grid grid-cols-3 gap-2">
          {STARTING_CHIPS_PRESETS.map((n) => (
            <Choice key={n} active={settings.startingChips === n} onClick={() => save({ startingChips: n })}>
              {fmt(n)}
            </Choice>
          ))}
          {!STARTING_CHIPS_PRESETS.includes(settings.startingChips) && (
            <Choice active onClick={() => undefined}>
              {fmt(settings.startingChips)}
            </Choice>
          )}
        </div>
        <div className="mt-2 flex gap-2">
          <input
            inputMode="numeric"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={`직접 입력 (${fmt(STARTING_CHIPS_MIN)}~${fmt(STARTING_CHIPS_MAX)})`}
            className="min-w-0 flex-1 rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm outline-none focus:border-yellow-500"
          />
          <Button className="py-2" disabled={!custom} onClick={applyCustom}>
            적용
          </Button>
        </div>
      </Section>

      <Section title="게임별 방 수익 한도">
        <p className="mb-3 text-xs leading-relaxed text-gray-400">입장금 대비 순이익 기준입니다. 5배는 1,000칩 입장 시 정산 잔액 6,000칩 이상입니다. 당첨금을 모두 지급하고 다음 판을 막으며, 재입장하면 새로 계산합니다. 변경한 설정은 다음 입장부터 적용됩니다.</p>
        <div className="space-y-3">
          {GAMES.map((game) => (
            <label key={game.id} className="flex items-center justify-between gap-2 rounded-xl border border-gray-800 bg-gray-900 p-3 text-sm">
              <span>{game.name}</span>
              <select aria-label={`${game.name} 수익 한도`} value={settings.profitLimits[game.id] ?? 'none'} className="rounded-lg border border-gray-700 bg-gray-950 px-2 py-2 text-yellow-300" onChange={(event) => void updateProfitLimit(game.id, event.target.value === 'none' ? null : Number(event.target.value)).then(setSettings).catch((error: unknown) => showToast(String(error)))}>
                <option value="none">제한 없음</option>
                {[1, 2, 3, 5, 10, 20, 50, 100].map((value) => <option key={value} value={value}>순이익 {value}배</option>)}
              </select>
            </label>
          ))}
        </div>
      </Section>

      <Section title="소리와 진동">
        <div className="space-y-2">
          <Toggle label="효과음" value={settings.sound} onChange={(v) => save({ sound: v })} />
          <Toggle label="진동" value={settings.haptics} onChange={(v) => save({ haptics: v })} />
        </div>
      </Section>

      <Section title="게임 속도">
        <div className="mb-1 text-xs text-gray-400">애니메이션</div>
        <div className="grid grid-cols-3 gap-2">
          {(
            [
              ['SLOW', '느림'],
              ['NORMAL', '보통'],
              ['FAST', '빠름'],
            ] as [AnimationSpeed, string][]
          ).map(([v, l]) => (
            <Choice key={v} active={settings.animationSpeed === v} onClick={() => save({ animationSpeed: v })}>
              {l}
            </Choice>
          ))}
        </div>
        <div className="mb-1 mt-3 text-xs text-gray-400">상대 생각 시간</div>
        <div className="grid grid-cols-2 gap-2">
          <Choice active={settings.cpuThinkTime === 'NORMAL'} onClick={() => save({ cpuThinkTime: 'NORMAL' })}>
            보통
          </Choice>
          <Choice active={settings.cpuThinkTime === 'SHORT'} onClick={() => save({ cpuThinkTime: 'SHORT' })}>
            짧게
          </Choice>
        </div>
      </Section>

      <Section title="데이터">
        <Button variant="danger" className="w-full" onClick={() => setResetStep(1)}>
          전체 초기화
        </Button>
        <p className="mt-2 text-[11px] text-gray-500">모든 캐릭터, 상대 선수, 전적, 설정을 지우고 설치 직후 상태로 되돌립니다.</p>
      </Section>

      <Section title="앱 정보">
        <div className="rounded-xl border border-gray-800 bg-gray-900 p-3 text-xs text-gray-400">
          Card Games v{__APP_VERSION__}
          <div className="mt-1 text-[11px] text-gray-600">게임용 가상 칩만 사용하며 실제 돈과 관련이 없습니다.</div>
        </div>
      </Section>

      {resetStep === 1 && (
        <Modal onClose={() => setResetStep(0)}>
          <h2 className="text-lg font-extrabold text-red-400">전체 초기화</h2>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-gray-300">
            <li>모든 캐릭터와 칩</li>
            <li>모든 상대 선수 (새로 20명 생성)</li>
            <li>모든 전적·세션·핸드 기록</li>
            <li>설정 (기본값으로)</li>
          </ul>
          <p className="mt-2 text-sm text-gray-400">이 작업은 되돌릴 수 없습니다.</p>
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button onClick={() => setResetStep(0)}>취소</Button>
            <Button variant="danger" onClick={() => setResetStep(2)}>
              계속
            </Button>
          </div>
        </Modal>
      )}
      {resetStep === 2 && (
        <Modal onClose={() => setResetStep(0)}>
          <h2 className="text-lg font-extrabold text-red-400">정말 초기화할까요?</h2>
          <p className="mt-2 text-sm text-gray-300">
            확인을 위해 <b className="text-white">{RESET_WORD}</b>를 입력하세요.
          </p>
          <input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            className="mt-3 w-full rounded-xl border border-gray-700 bg-gray-950 px-3 py-2 text-center font-bold outline-none focus:border-red-500"
          />
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Button onClick={() => setResetStep(0)}>취소</Button>
            <Button variant="danger" disabled={typed.trim() !== RESET_WORD || busy} onClick={doReset}>
              초기화
            </Button>
          </div>
        </Modal>
      )}
    </Page>
  );
}

function Choice({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'rounded-xl border py-2.5 text-sm font-bold tabular-nums',
        active ? 'border-yellow-400 bg-yellow-400/10 text-yellow-300' : 'border-gray-800 bg-gray-900 text-gray-300',
      )}
    >
      {children}
    </button>
  );
}

function Toggle({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button onClick={() => onChange(!value)} className="flex w-full items-center justify-between rounded-xl border border-gray-800 bg-gray-900 px-3 py-3">
      <span className="text-sm">{label}</span>
      <span className={cx('relative h-6 w-11 rounded-full transition', value ? 'bg-yellow-400' : 'bg-gray-700')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white transition-all', value ? 'left-[22px]' : 'left-0.5')} />
      </span>
    </button>
  );
}
