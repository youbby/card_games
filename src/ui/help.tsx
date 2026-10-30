import { useState, type ReactNode } from 'react';
import { useApp } from '../app/store';
import { cardsFromString } from '../core/cards';
import { GAMES, gameName, type GameId } from '../games/catalog';
import { updateSettings } from '../services/characters';
import { Button, cx, Modal, PlayingCard } from './components';

// ── Hand rankings ────────────────────────────────────────────────────────

const HAND_RANKINGS: { name: string; cards: string; text: string }[] = [
  { name: '로열 플러시', cards: 'As Ks Qs Js Ts', text: '같은 무늬 A·K·Q·J·10. 가장 높은 족보' },
  { name: '스트레이트 플러시', cards: '9h 8h 7h 6h 5h', text: '같은 무늬로 이어지는 숫자 5장' },
  { name: '포카드', cards: 'Qs Qh Qd Qc 7s', text: '같은 숫자 4장' },
  { name: '풀하우스', cards: 'Js Jh Jd 4c 4s', text: '같은 숫자 3장 + 같은 숫자 2장' },
  { name: '플러시', cards: 'Ad Jd 8d 6d 2d', text: '같은 무늬 5장 (숫자는 아무거나)' },
  { name: '스트레이트', cards: 'Ts 9h 8d 7c 6s', text: '이어지는 숫자 5장. A는 5-4-3-2-A의 1로도 쓰임' },
  { name: '트리플', cards: '7s 7h 7d Kc 2s', text: '같은 숫자 3장' },
  { name: '투페어', cards: 'Ks Kh 5d 5c 9s', text: '페어 2개' },
  { name: '원페어', cards: 'As Ah Td 6c 3s', text: '같은 숫자 2장' },
  { name: '하이카드', cards: 'Ks Jh 8d 5c 2s', text: '아무 족보도 없을 때 가장 높은 카드로 비교' },
];

export function HandRankings() {
  return (
    <div className="space-y-2">
      <p className="text-xs leading-relaxed text-gray-400">
        위에 있을수록 강합니다. 같은 족보끼리는 높은 숫자가 이기고, 남은 카드(키커)까지 같으면 팟을 나눕니다. 무늬에는
        순위가 없습니다.
      </p>
      {HAND_RANKINGS.map((rank, i) => (
        <div key={rank.name} className="flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-900 p-2">
          <span className="w-4 text-center text-xs font-bold text-gray-500">{i + 1}</span>
          <div className="flex shrink-0 gap-0.5">
            {cardsFromString(rank.cards).map((card) => (
              <PlayingCard key={card} card={card} size="xs" />
            ))}
          </div>
          <div className="min-w-0">
            <div className="text-sm font-bold text-yellow-200">{rank.name}</div>
            <div className="text-[11px] leading-4 text-gray-400">{rank.text}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Game rules ───────────────────────────────────────────────────────────

function Rules({ sections }: { sections: { title: string; items: ReactNode[] }[] }) {
  return (
    <div className="space-y-4">
      {sections.map((section) => (
        <section key={section.title}>
          <h3 className="mb-1.5 text-sm font-extrabold text-yellow-200">{section.title}</h3>
          <ul className="list-disc space-y-1 pl-4 text-[13px] leading-relaxed text-gray-300">
            {section.items.map((item, i) => (
              <li key={i}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

const COMMON_TABLE_RULES = {
  title: '공통',
  items: [
    '판마다 정해진 수익 목표(설정에서 변경)에 닿으면 마지막 판까지 정산하고 새 판을 막습니다.',
    '왼쪽 위 일어나기: 진행 중인 판은 폴드·패배 처리되고 남은 칩은 지갑으로 돌아갑니다. 앱을 꺼도 같습니다.',
  ],
};

const RULES: Record<GameId, { title: string; items: ReactNode[] }[]> = {
  holdem: [
    {
      title: '목표',
      items: [
        '내 카드 2장과 가운데 공용 카드 5장, 총 7장 중 가장 좋은 5장으로 족보를 만듭니다.',
        '마지막까지 남아 가장 높은 족보를 보여주거나, 상대를 모두 폴드시키면 팟을 가져갑니다.',
      ],
    },
    {
      title: '진행 순서',
      items: [
        '딜러 버튼(D) 왼쪽 두 사람이 스몰 블라인드(SB)와 빅 블라인드(BB)를 강제로 냅니다. 2인일 때는 딜러가 SB입니다.',
        '프리플랍 베팅 → 플랍(공용 3장) → 베팅 → 턴(1장) → 베팅 → 리버(1장) → 베팅 → 쇼다운.',
        '판이 끝나면 딜러 버튼이 왼쪽으로 한 칸 이동합니다.',
      ],
    },
    {
      title: '행동',
      items: [
        <>
          <b>폴드</b>: 이번 판을 포기합니다. 이미 낸 칩은 돌려받지 못합니다.
        </>,
        <>
          <b>체크</b>: 아무도 베팅하지 않았을 때 칩을 내지 않고 넘깁니다.
        </>,
        <>
          <b>콜</b>: 현재 베팅액만큼 맞춥니다.
        </>,
        <>
          <b>벳·레이즈</b>: 금액을 올립니다. 최소한 직전에 올린 폭만큼 올려야 합니다. ½팟·¾팟·팟·올인 버튼으로 빠르게
          고를 수 있습니다.
        </>,
        <>
          <b>올인</b>: 노리밋이라 언제든 가진 칩을 모두 걸 수 있습니다. 올인한 사람은 자신이 낸 만큼만 이길 수 있고,
          넘는 칩은 사이드팟이 됩니다.
        </>,
      ],
    },
    COMMON_TABLE_RULES,
  ],
  draw: [
    {
      title: '목표',
      items: [
        '공용 카드 없이 각자 비공개 카드 5장으로 족보를 겨룹니다.',
        '한 번의 교환으로 필요 없는 카드를 바꿔 족보를 높입니다.',
      ],
    },
    {
      title: '진행 순서',
      items: [
        '블라인드 → 첫 베팅 → 카드 교환(0~5장, 한 번) → 마지막 베팅 → 쇼다운.',
        '교환할 때는 내 카드를 눌러 버릴 카드를 고르고 교환 버튼을 누릅니다. 아무것도 고르지 않으면 5장 모두 교환하고, 그대로 두려면 아래 "교환 없이 유지"를 누릅니다.',
        '행동(폴드·체크·콜·레이즈·올인)과 사이드팟은 홀덤과 같습니다.',
      ],
    },
    {
      title: '요령',
      items: [
        '페어는 나머지 3장을, 트리플은 2장을, 투페어는 1장을 바꾸는 것이 기본입니다.',
        '같은 무늬 4장이나 이어지는 숫자 4장(양쪽이 열린)은 1장을 바꿔 플러시·스트레이트를 노려볼 만합니다.',
        '상대가 바꾼 장수가 힌트입니다. 0장은 이미 완성된 손, 1장은 투페어나 드로우, 3장은 원페어일 가능성이 큽니다.',
      ],
    },
    COMMON_TABLE_RULES,
  ],
  baccarat: [
    {
      title: '목표',
      items: [
        '플레이어·뱅커 중 9에 더 가까운 쪽을 맞히거나, 무승부에 겁니다.',
        '내가 정하는 것은 베팅뿐이고 카드는 규칙에 따라 자동으로 진행됩니다.',
      ],
    },
    {
      title: '점수 계산',
      items: [
        'A는 1, 2~9는 숫자 그대로, 10·J·Q·K는 0점입니다.',
        '합계의 일의 자리만 셉니다. 7 + 8 = 15 → 5점.',
        '처음 두 장이 8 또는 9면 내추럴로, 양쪽 모두 더 받지 않고 끝납니다.',
      ],
    },
    {
      title: '세 번째 카드',
      items: [
        '플레이어: 0~5점이면 한 장 더 받고, 6·7점이면 멈춥니다.',
        '뱅커: 플레이어가 멈췄으면 0~5점에서 한 장 더 받습니다.',
        '플레이어가 세 번째 카드를 받았으면 뱅커는 0~2점 항상 받고, 3점은 그 카드가 8이 아닐 때, 4점은 2~7일 때, 5점은 4~7일 때, 6점은 6·7일 때 받습니다. 7점은 멈춥니다.',
      ],
    },
    {
      title: '배당',
      items: [
        '플레이어 적중: 건 금액만큼 이익(1:1).',
        '뱅커 적중: 이익의 5%를 수수료로 뗀 0.95:1. 뱅커가 조금 더 자주 이기기 때문입니다.',
        '무승부 적중: 8:1. 무승부가 나오면 플레이어·뱅커에 건 금액은 그대로 돌려받습니다.',
        '장기적으로는 뱅커가 가장 유리하고 무승부 베팅이 가장 불리합니다.',
      ],
    },
    COMMON_TABLE_RULES,
  ],
  blackjack: [
    {
      title: '목표',
      items: [
        '21을 넘지 않으면서 딜러보다 21에 가까우면 이깁니다. 21을 넘으면 버스트로 바로 집니다.',
        '2~10은 숫자 그대로, J·Q·K는 10, A는 1 또는 11입니다. A를 11로 세는 손을 소프트라고 합니다.',
        '처음 두 장이 A와 10점 카드면 블랙잭으로, 건 금액의 1.5배를 이익으로 받습니다.',
      ],
    },
    {
      title: '행동',
      items: [
        <>
          <b>히트</b>: 한 장 더 받습니다. <b>스탠드</b>: 그대로 멈춥니다.
        </>,
        <>
          <b>더블다운</b>: 처음 두 장일 때 베팅을 두 배로 늘리고 딱 한 장만 받습니다.
        </>,
        <>
          <b>스플릿</b>: 처음 두 장의 점수가 같으면(8·8, K·Q 등) 같은 금액을 더 걸고 두 핸드로 나눕니다. 최대 4핸드까지
          가능하고, A를 나누면 각각 한 장만 받습니다. 나눈 뒤의 21은 블랙잭이 아닌 일반 승리입니다.
        </>,
        <>
          <b>서렌더</b>: 첫 결정으로만 쓸 수 있습니다. 베팅의 절반을 돌려받고 포기합니다.
        </>,
      ],
    },
    {
      title: '인슈어런스 (보험)',
      items: [
        '딜러의 보이는 카드가 A면 먼저 보험을 걸지 정합니다. 비용은 베팅의 절반입니다.',
        '딜러가 블랙잭이면 보험이 2:1로 지급되어 본 베팅의 손실을 메웁니다. 아니면 보험금만 잃고 계속합니다.',
        '내가 블랙잭일 때 보험을 걸면 "이븐 머니": 딜러 결과와 상관없이 건 금액만큼 확정 이익입니다.',
        '장기적으로 보험은 손해인 경우가 많습니다.',
      ],
    },
    {
      title: '딜러 규칙',
      items: [
        '딜러의 보이는 카드가 A나 10점이면 숨긴 카드를 확인하고, 블랙잭이면 바로 끝냅니다.',
        '딜러는 16 이하면 반드시 받고, 소프트 17을 포함해 17 이상이면 멈춥니다.',
        '6덱 슈를 쓰며, 80장 미만이 남으면 새로 섞습니다.',
      ],
    },
    {
      title: '기본 전략 요약',
      items: [
        '딜러 카드가 7 이상이면 17이 될 때까지 히트, 2~6이면 12~16에서 스탠드하는 편이 유리합니다.',
        '합계 11은 더블다운, A·A와 8·8은 항상 스플릿, 10·10과 5·5는 스플릿하지 않습니다.',
        '16으로 딜러의 9·10·A를 상대할 때는 서렌더를 고려하세요.',
      ],
    },
    COMMON_TABLE_RULES,
  ],
};

export function GameRules({ gameId }: { gameId: GameId }) {
  return <Rules sections={RULES[gameId]} />;
}

const isPoker = (gameId: GameId) => gameId === 'holdem' || gameId === 'draw';

/** In-game help: the current game's rules, plus hand rankings at poker tables. */
export function HelpModal({ gameId, onClose }: { gameId: GameId; onClose: () => void }) {
  const [tab, setTab] = useState<'rules' | 'ranks'>('rules');
  return (
    <Modal onClose={onClose}>
      <h2 className="text-lg font-extrabold">{gameName(gameId)} 방법</h2>
      {isPoker(gameId) && (
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl bg-gray-950 p-1 text-xs font-bold">
          {(
            [
              ['rules', '규칙'],
              ['ranks', '족보'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={cx('rounded-lg py-1.5', tab === id ? 'bg-gray-700 text-white' : 'text-gray-400')}
            >
              {label}
            </button>
          ))}
        </div>
      )}
      <div className="mt-3 max-h-[60vh] overflow-y-auto pr-1">
        {tab === 'ranks' ? <HandRankings /> : <GameRules gameId={gameId} />}
      </div>
      <Button variant="primary" className="mt-4 w-full" onClick={onClose}>
        닫기
      </Button>
    </Modal>
  );
}

// ── First-visit tutorial ─────────────────────────────────────────────────

const TUTORIALS: Record<GameId, { icon: string; title: string; text: string }[]> = {
  holdem: [
    {
      icon: '♠️',
      title: '텍사스 홀덤',
      text: '내 카드 2장과 가운데 공용 카드 5장으로 가장 좋은 족보를 만드는 게임이에요. 상대를 모두 포기시켜도 이깁니다.',
    },
    {
      icon: '🃏',
      title: '테이블 보기',
      text: '아래쪽이 내 자리예요. 내 카드 옆 초록 표시가 지금 내 족보이고, D·SB·BB 칩은 딜러와 블라인드 위치를 알려줘요.',
    },
    {
      icon: '👆',
      title: '내 차례',
      text: '내 자리가 노랗게 빛나면 폴드·체크(콜)·레이즈 중에서 고르세요. 레이즈를 누르면 금액 조절과 ½팟·팟·올인 버튼이 열려요.',
    },
    {
      icon: '❓',
      title: '막히면',
      text: '오른쪽 위 ? 버튼에서 규칙과 족보 순위를 언제든 볼 수 있어요. 왼쪽 위 일어나기로 정산하고 나갈 수 있어요.',
    },
  ],
  draw: [
    {
      icon: '🃏',
      title: '파이브 카드 드로우',
      text: '공용 카드 없이 각자 5장으로 족보를 겨뤄요. 중간에 한 번, 원하는 카드를 바꿀 수 있어요.',
    },
    {
      icon: '🔁',
      title: '카드 교환',
      text: '교환 차례가 오면 버릴 카드를 눌러 고르고 교환 버튼을 누르세요. 고르지 않으면 "모두 교환", 완성된 패는 "교환 없이 유지".',
    },
    {
      icon: '🕵️',
      title: '상대 읽기',
      text: '상대가 몇 장 바꿨는지 기록에 남아요. 한 장도 안 바꿨다면 이미 강한 패일 수 있어요.',
    },
    {
      icon: '❓',
      title: '막히면',
      text: '오른쪽 위 ? 버튼에서 규칙과 족보를 볼 수 있어요. 베팅 방법은 홀덤과 같아요.',
    },
  ],
  baccarat: [
    {
      icon: '♦️',
      title: '바카라',
      text: '플레이어와 뱅커 중 9에 더 가까운 쪽을 맞히는 게임이에요. 카드는 규칙대로 자동으로 나와요.',
    },
    {
      icon: '🎯',
      title: '베팅하기',
      text: '아래에서 플레이어·뱅커·무승부 중 하나를 고르고, 슬라이더나 최소·중간·최대 버튼으로 금액을 정한 뒤 베팅하세요.',
    },
    {
      icon: '🔢',
      title: '점수',
      text: '10·J·Q·K는 0점, A는 1점이고 합계의 일의 자리만 셉니다. 카드가 한 장씩 공개되는 걸 지켜보세요.',
    },
  ],
  blackjack: [
    {
      icon: '♣️',
      title: '블랙잭',
      text: '21을 넘지 않으면서 딜러보다 높으면 이겨요. 처음 두 장이 21이면 블랙잭으로 1.5배를 받아요.',
    },
    {
      icon: '👆',
      title: '내 선택',
      text: '히트(한 장 더)·스탠드(멈춤)가 기본이고, 처음 두 장일 때는 더블다운·스플릿·서렌더도 쓸 수 있어요.',
    },
    {
      icon: '🛡️',
      title: '보험',
      text: '딜러가 A를 보이면 보험을 걸지 먼저 물어봐요. 딜러가 블랙잭일 때 손실을 메워주지만 보통은 손해예요.',
    },
    {
      icon: '❓',
      title: '막히면',
      text: '오른쪽 위 ? 버튼에서 규칙과 기본 전략 요약을 볼 수 있어요.',
    },
  ],
};

/** Shows a game's tutorial the first time it is played. */
export function useTutorial(gameId: GameId | undefined) {
  const { settings, setSettings } = useApp();
  const seen = settings.tutorialsSeen ?? [];
  const [dismissed, setDismissed] = useState(false);
  const open = !!gameId && !dismissed && !seen.includes(gameId);
  const finish = () => {
    setDismissed(true);
    if (gameId && !seen.includes(gameId)) {
      void updateSettings({ tutorialsSeen: [...seen, gameId] })
        .then(setSettings)
        .catch(() => undefined);
    }
  };
  return { open, finish };
}

export function TutorialModal({ gameId, onDone }: { gameId: GameId; onDone: () => void }) {
  const steps = TUTORIALS[gameId];
  const [step, setStep] = useState(0);
  const current = steps[step];
  const last = step === steps.length - 1;
  return (
    <Modal onClose={onDone}>
      <div key={step} className="pop-in text-center">
        <div className="text-5xl">{current.icon}</div>
        <h2 className="mt-3 text-lg font-extrabold">{current.title}</h2>
        <p className="mt-2 min-h-[4.5rem] text-sm leading-relaxed text-gray-300">{current.text}</p>
      </div>
      <div className="mt-3 flex justify-center gap-1.5" aria-label={`${step + 1} / ${steps.length}`}>
        {steps.map((_, i) => (
          <span
            key={i}
            className={cx('h-1.5 rounded-full transition-all', i === step ? 'w-5 bg-yellow-400' : 'w-1.5 bg-gray-600')}
          />
        ))}
      </div>
      <div className="mt-5 grid grid-cols-2 gap-2">
        <Button onClick={onDone}>건너뛰기</Button>
        <Button variant="primary" onClick={() => (last ? onDone() : setStep(step + 1))}>
          {last ? '시작하기' : '다음'}
        </Button>
      </div>
    </Modal>
  );
}

export const HELP_TABS: { id: 'ranks' | GameId; label: string }[] = [
  { id: 'ranks', label: '족보' },
  ...GAMES.map((game) => ({ id: game.id, label: game.name.replace('텍사스 ', '').replace('파이브 카드 ', '') })),
];
