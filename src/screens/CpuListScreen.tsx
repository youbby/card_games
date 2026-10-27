import { useState } from 'react';
import { useApp } from '../app/store';
import { db } from '../data/db';
import type { CpuClass } from '../games/holdem/ai/types';
import { listCpus } from '../services/cpuPool';
import { Avatar, Chips, CLASS_LABEL, ClassBadge, cx, fmt, Page, personalityTags } from '../ui/components';
import { useAsync } from '../ui/hooks';

export function CpuListScreen() {
  const back = useApp((s) => s.back);
  const [cls, setCls] = useState<CpuClass>('LOW');
  const { data } = useAsync(async () => {
    const cpus = await listCpus(cls);
    const stats = await db.stats.bulkGet(cpus.map((c) => c.id));
    return cpus.map((c, i) => ({ cpu: c, stats: stats[i] }));
  }, [cls]);

  return (
    <Page title="상대 선수" onBack={back}>
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-gray-900 p-1 text-xs font-bold">
        {(['LOW', 'HIGH'] as CpuClass[]).map((c) => (
          <button key={c} onClick={() => setCls(c)} className={cx('rounded-lg py-2', cls === c ? 'bg-gray-700 text-white' : 'text-gray-400')}>
            {CLASS_LABEL[c]}
          </button>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-gray-500">
        난이도마다 10명의 상대 선수가 대기합니다. 파산한 선수의 자리는 새로운 선수가 채웁니다.
      </p>
      <div className="mt-3 space-y-2">
        {data?.map(({ cpu, stats }) => (
          <div key={cpu.id} className="flex items-center gap-3 rounded-xl border border-gray-800 bg-gray-900 px-3 py-2.5">
            <Avatar emoji={cpu.avatar} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate font-bold">{cpu.name}</span>
                <ClassBadge cls={cls} />
              </div>
              <div className="text-[10px] text-gray-500">{personalityTags(cpu.personality).join(' · ')}</div>
              {stats && stats.handsPlayed > 0 && (
                <div className="text-[10px] text-gray-500">
                  {fmt(stats.handsPlayed)}핸드 · 손익{' '}
                  <span className={stats.netProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}>
                    {stats.netProfit >= 0 ? '+' : ''}
                    {fmt(stats.netProfit)}
                  </span>
                </div>
              )}
            </div>
            <Chips amount={cpu.balance} className="text-sm" />
          </div>
        ))}
      </div>
    </Page>
  );
}
