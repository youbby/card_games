import Dexie, { type EntityTable } from 'dexie';
import type { Bucket, Character, HandRecord, Settings, Stats, TableSession } from './types';
import type { HouseRoom } from '../games/house/types';

export class CardGamesDb extends Dexie {
  characters!: EntityTable<Character, 'id'>;
  sessions!: EntityTable<TableSession, 'id'>;
  hands!: EntityTable<HandRecord, 'id'>;
  stats!: EntityTable<Stats, 'characterId'>;
  settings!: EntityTable<Settings, 'id'>;
  rooms!: EntityTable<HouseRoom, 'id'>;

  constructor(name = 'card-games') {
    super(name);
    this.version(1).stores({
      characters: 'id, kind, cpuClass, status, name',
      sessions: 'id, playerId, active',
      hands: 'id, playerId, sessionId, [playerId+playedAt]',
      stats: 'characterId',
      settings: 'id',
    });
    this.version(2)
      .stores({ rooms: 'id, playerId, active, gameId' })
      .upgrade(async (tx) => {
        await tx
          .table('stats')
          .toCollection()
          .modify((stats: Stats) => {
            stats.byGame ??= { holdem: { hands: stats.handsPlayed, net: stats.netProfit } };
          });
      });
    // v3: per-game win counts, so win rates are no longer mixed across games.
    this.version(3)
      .stores({})
      .upgrade(async (tx) => {
        const records = (await tx.table('hands').toArray()) as HandRecord[];
        await tx
          .table('stats')
          .toCollection()
          .modify((stats: Stats) => backfillGameWins(stats, records));
      });
  }
}

/**
 * Fills `won` for game buckets saved before it existed. Exact when the player
 * played a single game or the history still holds every hand; otherwise the
 * kept history's win ratio is scaled to the bucket.
 */
export function backfillGameWins(stats: Stats, records: HandRecord[]): void {
  const buckets = Object.entries(stats.byGame ?? {}) as [string, Bucket][];
  const played = buckets.filter(([, bucket]) => bucket.hands > 0);
  for (const [gameId, bucket] of buckets) {
    if (bucket.won !== undefined) continue;
    if (played.length === 1) {
      bucket.won = Math.min(bucket.hands, stats.handsWon ?? 0);
      continue;
    }
    const mine = records.filter((r) => r.playerId === stats.characterId && (r.gameId ?? 'holdem') === gameId);
    const won = mine.filter((r) => r.won).length;
    bucket.won = mine.length >= bucket.hands ? won : mine.length ? Math.round((won / mine.length) * bucket.hands) : 0;
  }
}

export const db = new CardGamesDb();

export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
