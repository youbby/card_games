import { db } from '../data/db';
import { DEFAULT_SETTINGS } from '../data/types';
import { ensurePool } from './cpuPool';

/** Returns the app to its freshly-installed state: no characters, no records, default settings, a new CPU pool. */
export async function factoryReset(): Promise<void> {
  await db.delete();
  await db.open();
  await db.settings.put({ ...DEFAULT_SETTINGS });
  await ensurePool();
}

/** First launch and every launch: make sure settings and the CPU pool exist. */
export async function initializeApp(): Promise<void> {
  if (!(await db.settings.get('app'))) await db.settings.put({ ...DEFAULT_SETTINGS });
  await ensurePool();
}
