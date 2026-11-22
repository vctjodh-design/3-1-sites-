import { getFixtures } from './betexplorer.js';
import { applyIntersection, getStatshubEvents, statsHubStatus } from './statshub.js';

const syncCache = new Map();
const SYNC_TTL = 2 * 60 * 1000;

function emptyPayload(fixtures, sync) {
  return {
    ...fixtures,
    leagues: [],
    totals: { leagues: 0, matches: 0 },
    sync,
  };
}

/**
 * Fixtures limited to matches that exist on both BetExplorer and StatsHub.
 * BetExplorer supplies odds and the match page; StatsHub supplies the stats.
 */
export async function getSyncedFixtures(dateKey) {
  const fixtures = await getFixtures(dateKey);
  const status = await statsHubStatus();

  if (!status.ready) {
    return emptyPayload(fixtures, {
      available: false,
      reason: status.reason,
      betexplorerMatches: fixtures.totals?.matches ?? 0,
    });
  }

  const cached = syncCache.get(dateKey);
  if (cached && Date.now() - cached.timestamp < SYNC_TTL) {
    return { ...cached.data, fetchedAt: fixtures.fetchedAt };
  }

  try {
    const events = await getStatshubEvents(dateKey);
    const synced = applyIntersection(fixtures, events);
    const data = { ...synced, sync: { ...synced.sync, available: true } };
    syncCache.set(dateKey, { data, timestamp: Date.now() });
    while (syncCache.size > 12) syncCache.delete(syncCache.keys().next().value);
    return data;
  } catch (error) {
    console.error(`[fixtures:sync] ${dateKey}: ${error.message}`);
    return emptyPayload(fixtures, {
      available: true,
      error: 'Could not reach StatsHub to match fixtures.',
      betexplorerMatches: fixtures.totals?.matches ?? 0,
    });
  }
}
