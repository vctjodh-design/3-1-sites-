import { fetchJson, fetchJsonBatch, statsHubStatus } from './statshubHttp.js';
import { parseDateKey } from './betexplorer.js';

const BASE = 'https://www.statshub.com';
const DAY = 24 * 60 * 60;

/**
 * BetExplorer renders kick-off times in UTC+1 unless a timezone cookie is set.
 * Its fixture page exposes `homepagedata[my_timezone] = '+1'`.
 */
export const BETEXPLORER_UTC_OFFSET_MINUTES = 60;
const KICKOFF_TOLERANCE_MINUTES = 30;
const NAME_MATCH_THRESHOLD = 0.72;

const EVENTS_TTL = 4 * 60 * 1000;
const DETAIL_TTL = 3 * 60 * 1000;
const eventsCache = new Map();
const detailCache = new Map();
const MAX_CACHE = 40;

const NOISE_TOKENS = new Set([
  'fc', 'cf', 'afc', 'sc', 'ac', 'fk', 'sk', 'bk', 'if', 'ff', 'cs', 'ca', 'cd', 'ec', 'se',
  'sa', 'sv', 'tsg', 'vfl', 'vfb', 'nk', 'hnk', 'fcm', 'club', 'the', 'de', 'del', 'fut',
  'futbol', 'football', 'calcio', 'soccer', 'team', 'srl', 'ss', 'as', 'a', 'la', 'le', 'les',
  'el', 'los', 'las', 'der', 'die', 'das', 'il', 'lo', 'gli', 'of', 'and',
]);

/** Common abbreviations and city translations that break naive token matching. */
const TOKEN_ALIASES = new Map(
  Object.entries({
    utd: 'united',
    dep: 'deportivo',
    depor: 'deportivo',
    ath: 'athletic',
    athl: 'athletic',
    praha: 'praha',
    prague: 'praha',
    munchen: 'munchen',
    munich: 'munchen',
    lisboa: 'lisboa',
    lisbon: 'lisboa',
    wien: 'wien',
    vienna: 'wien',
    kobenhavn: 'kobenhavn',
    copenhagen: 'kobenhavn',
    goteborg: 'goteborg',
    gothenburg: 'goteborg',
    warszawa: 'warszawa',
    warsaw: 'warszawa',
    beograd: 'beograd',
    belgrade: 'beograd',
    bucuresti: 'bucuresti',
    bucharest: 'bucuresti',
    kyiv: 'kyiv',
    kiev: 'kyiv',
    milano: 'milano',
    milan: 'milano',
  }),
);

const WOMEN_MARKER = /(^|\s)(w|women|wom|fem|femminile|ladies|damen)(\s|$)/;

function clean(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeName(value) {
  return clean(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['’`]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function nameTokens(normalized) {
  const tokens = normalized.split(' ').filter(Boolean);
  const meaningful = tokens.filter((token) => !NOISE_TOKENS.has(token));
  const chosen = meaningful.length ? meaningful : tokens;
  return chosen.map((token) => TOKEN_ALIASES.get(token) || token);
}

function bigrams(value) {
  const set = new Set();
  for (let index = 0; index < value.length - 1; index += 1) {
    set.add(value.slice(index, index + 2));
  }
  return set;
}

function dice(left, right) {
  const a = bigrams(left);
  const b = bigrams(right);
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const gram of a) if (b.has(gram)) shared += 1;
  return (2 * shared) / (a.size + b.size);
}

function tokenSimilarity(a, b) {
  if (a === b) return 1;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.startsWith(short)) return 0.94;
  if (short.length >= 5 && long.includes(short)) return 0.86;
  if (short.length === 1 && long.startsWith(short)) return 0.72;
  if (short.length >= 4 && long.endsWith(short)) return 0.82;
  const ratio = dice(a, b);
  return ratio >= 0.7 ? ratio * 0.85 : 0;
}

/** Similarity between two free-text team names, 0..1. */
export function nameScore(left, right) {
  const a = normalizeName(left);
  const b = normalizeName(right);
  if (!a || !b) return 0;
  if (WOMEN_MARKER.test(a) !== WOMEN_MARKER.test(b)) return 0;
  if (a === b) return 1;

  const tokensA = nameTokens(a);
  const tokensB = nameTokens(b);
  if (tokensA.join(' ') === tokensB.join(' ')) return 0.98;

  const coverage = (source, target) => {
    let matched = 0;
    let counted = 0;
    for (const token of source) {
      const best = Math.max(0, ...target.map((other) => tokenSimilarity(token, other)));
      // A lone initial ("U. De Chile") is optional when the other side spells it out.
      if (token.length === 1 && best < 0.5) continue;
      counted += 1;
      matched += best;
    }
    return counted ? matched / counted : 0;
  };

  let score = Math.min(coverage(tokensA, tokensB), coverage(tokensB, tokensA));
  if (a.includes(b) || b.includes(a)) score = Math.max(score, 0.93);
  const ratio = dice(a, b);
  if (ratio >= 0.68) score = Math.max(score, ratio * 0.95);
  return score;
}

function teamScore(beName, team) {
  if (!team) return 0;
  return Math.max(nameScore(beName, team.name), nameScore(beName, team.shortName || team.shortname));
}

function logoFor(team) {
  return team && team.id ? `https://images.statshub.com/team/${team.id}.png` : null;
}

function normalizeEvent(entry) {
  if (!entry?.events?.id) return null;
  const events = entry.events;
  const tournament = entry.tournaments || {};
  const category = entry.categories || {};
  const home = entry.homeTeam || {};
  const away = entry.awayTeam || {};

  return {
    id: events.id,
    internalId: events.internalId,
    slug: events.slug,
    url: `${BASE}/fixture/${events.slug}/${events.internalId}`,
    kickoff: Number(events.timeStartTimestamp) || null,
    status: events.status || 'unknown',
    score: { home: events.homeScoreCurrent, away: events.awayScoreCurrent },
    halfTime: { home: events.period1Home, away: events.period1Away },
    homeTeam: { id: home.id, name: home.name, shortName: home.shortname, slug: home.slug },
    awayTeam: { id: away.id, name: away.name, shortName: away.shortname, slug: away.slug },
    tournament: {
      id: events.tournamentId,
      uniqueId: events.uniqueTournamentId,
      seasonId: events.seasonId,
      name: tournament.name || entry.unique_tournaments?.name || '',
      category: category.name || '',
    },
  };
}

function dayWindow(dateKey) {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return null;
  const start = Date.UTC(parsed.year, parsed.month - 1, parsed.day) / 1000;
  return { start: start - 14 * 60 * 60, end: start + DAY + 14 * 60 * 60 };
}

/** All StatsHub events in a window around a calendar date (UTC seconds). */
export async function getStatshubEvents(dateKey) {
  const window = dayWindow(dateKey);
  if (!window) return [];

  const cached = eventsCache.get(dateKey);
  if (cached && Date.now() - cached.timestamp < EVENTS_TTL) return cached.data;

  const url = `${BASE}/api/event/by-date?startOfDay=${window.start}&endOfDay=${window.end}`;
  const payload = await fetchJson(url, { ttl: EVENTS_TTL, timeoutSeconds: 40 });
  if (!payload || !Array.isArray(payload.data)) {
    return cached ? cached.data : [];
  }

  const events = payload.data.map(normalizeEvent).filter(Boolean);
  eventsCache.set(dateKey, { data: events, timestamp: Date.now() });
  while (eventsCache.size > MAX_CACHE) eventsCache.delete(eventsCache.keys().next().value);
  return events;
}

function beLocalToUtcSeconds(match, offsetMinutes = BETEXPLORER_UTC_OFFSET_MINUTES) {
  const [hour, minute] = String(match.time || '').split(':').map(Number);
  const [year, month, day] = String(match.date || '').split('-').map(Number);
  if (!Number.isFinite(hour) || !Number.isFinite(minute) || !year) return null;
  return Date.UTC(year, month - 1, day, hour, minute) / 1000 - offsetMinutes * 60;
}

/** BetExplorer defaults to UTC+1, but daylight saving or a default change shifts it. */
const CANDIDATE_OFFSETS = [60, 0, 120, -60, 180, 30, -120, -180, -300, 300];

function offsetLabel(offsetMinutes) {
  if (offsetMinutes === 0) return 'UTC';
  const sign = offsetMinutes > 0 ? '+' : '-';
  const absolute = Math.abs(offsetMinutes);
  const hours = Math.floor(absolute / 60);
  const minutes = absolute % 60;
  return `UTC${sign}${hours}${minutes ? `:${String(minutes).padStart(2, '0')}` : ''}`;
}

/**
 * Pair BetExplorer fixtures with StatsHub events at one assumed UTC offset.
 * Kick-off time is the anchor; team names break ties inside the tolerance window.
 */
export function matchFixtures(fixtures, events, offsetMinutes = BETEXPLORER_UTC_OFFSET_MINUTES) {
  const candidates = [];

  for (const league of fixtures.leagues || []) {
    for (const match of league.matches) {
      const kickoff = beLocalToUtcSeconds(match, offsetMinutes);
      if (kickoff === null) continue;

      for (const event of events) {
        if (!event.kickoff) continue;
        const deltaMinutes = Math.abs(event.kickoff - kickoff) / 60;
        if (deltaMinutes > KICKOFF_TOLERANCE_MINUTES) continue;

        const home = teamScore(match.home, event.homeTeam);
        const away = teamScore(match.away, event.awayTeam);
        const score = Math.min(home, away);
        if (score < NAME_MATCH_THRESHOLD) continue;

        const closeness = 1 - deltaMinutes / (KICKOFF_TOLERANCE_MINUTES * 2);
        candidates.push({ match, event, score: score + closeness * 0.08, names: score });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);

  const assignedMatches = new Map();
  const usedEvents = new Set();
  for (const candidate of candidates) {
    if (assignedMatches.has(candidate.match.id) || usedEvents.has(candidate.event.id)) continue;
    assignedMatches.set(candidate.match.id, candidate);
    usedEvents.add(candidate.event.id);
  }

  return assignedMatches;
}

/**
 * Try each plausible BetExplorer UTC offset and keep the one that pairs the most fixtures.
 * This keeps the sync correct through daylight-saving changes.
 */
export function calibrateFixtures(fixtures, events) {
  let best = null;
  for (const offsetMinutes of CANDIDATE_OFFSETS) {
    const pairs = matchFixtures(fixtures, events, offsetMinutes);
    if (!best || pairs.size > best.pairs.size) {
      best = { pairs, offsetMinutes };
      if (pairs.size === fixtures.totals?.matches) break;
    }
  }
  return best || { pairs: new Map(), offsetMinutes: BETEXPLORER_UTC_OFFSET_MINUTES };
}

/** Keep only fixtures present on both sites, tagging each with its StatsHub event. */
export function applyIntersection(fixtures, events) {
  const { pairs: assigned, offsetMinutes } = calibrateFixtures(fixtures, events);
  const leagues = [];

  let removed = 0;
  for (const league of fixtures.leagues || []) {
    const matches = [];
    for (const match of league.matches) {
      const pair = assigned.get(match.id);
      if (!pair) {
        removed += 1;
        continue;
      }
      matches.push({
        ...match,
        statshub: {
          id: pair.event.id,
          url: pair.event.url,
          homeId: pair.event.homeTeam.id,
          awayId: pair.event.awayTeam.id,
          kickoff: pair.event.kickoff,
          confidence: Math.round(pair.names * 100) / 100,
        },
      });
    }
    if (matches.length) leagues.push({ ...league, matches });
  }

  return {
    ...fixtures,
    leagues,
    totals: {
      leagues: leagues.length,
      matches: leagues.reduce((total, league) => total + league.matches.length, 0),
    },
    sync: {
      source: 'betexplorer+statshub',
      matched: leagues.reduce((total, league) => total + league.matches.length, 0),
      betexplorerMatches: fixtures.totals?.matches ?? 0,
      removed,
      statshubEvents: events.length,
      offsetMinutes,
      timezone: {
        betexplorer: offsetLabel(offsetMinutes),
        statshub: 'UTC',
      },
    },
  };
}

/* ---------- match detail ---------- */

const MATCH_METRICS = [
  ['ballPossession', 'Possession', '%'],
  ['totalShotsOnGoal', 'Shots', ''],
  ['shotsOnGoal', 'Shots on target', ''],
  ['expectedGoals', 'Expected goals', ''],
  ['bigChanceCreated', 'Big chances', ''],
  ['cornerKicks', 'Corners', ''],
  ['fouls', 'Fouls', ''],
  ['yellowCards', 'Yellow cards', ''],
  ['passes', 'Passes', ''],
  ['pass_accuracy', 'Pass accuracy', '%'],
  ['totalTackle', 'Tackles', ''],
  ['interceptionWon', 'Interceptions', ''],
  ['offsides', 'Offsides', ''],
  ['goalkeeperSaves', 'Saves', ''],
];

/** Every per-match player value StatsHub exposes for the player tables. */
const MATRIX_FIELDS = [
  'shots',
  'onTargetScoringAttempt',
  'goals',
  'goalAssist',
  'scoredOrAssisted',
  'expectedGoals',
  'expectedAssists',
  'xGxA',
  'totalPass',
  'accuratePass',
  'totalCross',
  'accurateCross',
  'possessionLostCtrl',
  'dispossessed',
  'interceptionWon',
  'totalTackle',
  'duelWon',
  'aerialWon',
  'fouls',
  'wasFouled',
  'foulInvolvements',
  'yellowCard',
  'redCard',
  'totalOffside',
  'saves',
  'touches',
  'keyPass',
  'bigChanceCreated',
  'totalClearance',
  'blockedScoringAttempt',
  'shotOffTarget',
  'minutesPlayed',
  'rating',
];
const MATRIX_LIMIT = 20;

function playerImage(playerId) {
  return playerId ? `https://images.statshub.com/player/${playerId}.png` : null;
}

function numberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function buildMatchStats(homeRecord) {
  if (!homeRecord) return null;
  const home = homeRecord.statistics || {};
  const away = homeRecord.opponentStatistics || {};

  const metrics = MATCH_METRICS.map(([key, label, suffix]) => ({
    key,
    label,
    suffix,
    home: numberOrNull(home[key]),
    away: numberOrNull(away[key]),
  })).filter((metric) => metric.home !== null || metric.away !== null);

  return { metrics, home, away };
}

function resultFor(event, teamId) {
  const isHome = event.homeTeam?.id === teamId;
  const own = isHome ? event.score.home : event.score.away;
  const other = isHome ? event.score.away : event.score.home;
  if (own === null || other === null) return null;
  if (own === other) return 'd';
  return own > other ? 'w' : 'l';
}

function buildTeamForm(teamPerformance, teamId) {
  const rows = Array.isArray(teamPerformance?.data) ? teamPerformance.data : [];
  return rows
    .filter((row) => row?.event?.id)
    .map((row) => {
      const isHome = row.homeTeam?.id === teamId;
      const opponent = isHome ? row.awayTeam : row.homeTeam;
      const score = row.event.score || {};
      return {
        id: row.event.id,
        kickoff: Number(row.event.timeStartTimestamp) || null,
        home: row.homeTeam?.shortname || row.homeTeam?.name || '',
        away: row.awayTeam?.shortname || row.awayTeam?.name || '',
        opponent: opponent?.shortname || opponent?.name || '',
        opponentId: opponent?.id ?? null,
        isHome,
        score: { home: score.home ?? null, away: score.away ?? null },
        result: resultFor({ ...row.event, homeTeam: row.homeTeam, awayTeam: row.awayTeam }, teamId),
        stats: {
          possession: numberOrNull(row.statistics?.ballPossession),
          shots: numberOrNull(row.statistics?.totalShotsOnGoal),
          onTarget: numberOrNull(row.statistics?.shotsOnGoal),
          corners: numberOrNull(row.statistics?.cornerKicks),
          fouls: numberOrNull(row.statistics?.fouls),
          yellowCards: numberOrNull(row.statistics?.yellowCards),
          expectedGoals: numberOrNull(row.statistics?.expectedGoals),
          passAccuracy: numberOrNull(row.statistics?.pass_accuracy),
        },
      };
    });
}

function matrixResult(event, isHome) {
  const own = isHome ? event.homeScoreCurrent : event.awayScoreCurrent;
  const other = isHome ? event.awayScoreCurrent : event.homeScoreCurrent;
  if (own === null || own === undefined || other === null || other === undefined) return null;
  if (own === other) return 'd';
  return own > other ? 'w' : 'l';
}

/** Last N matches (all competitions) with each player's full per-game stat line. */
function buildMatrix(playersPerformance, teamId, limit = MATRIX_LIMIT) {
  const eventRows = Array.isArray(playersPerformance?.events) ? playersPerformance.events : [];
  const matches = eventRows
    .filter((entry) => entry?.events?.id)
    .map((entry) => {
      const event = entry.events;
      const isHome = Number(event.homeTeamId) === Number(teamId);
      const opponent = isHome ? entry.awayTeam : entry.homeTeam;
      return {
        id: event.id,
        kickoff: Number(event.timeStartTimestamp) || null,
        isHome,
        opponent: opponent?.shortname || opponent?.name || '',
        opponentId: opponent?.id ?? null,
        competition:
          entry.tournaments?.name || entry.unique_tournaments?.name || '',
        round: event.roundInfo ?? null,
        score: {
          home: numberOrNull(event.homeScoreCurrent),
          away: numberOrNull(event.awayScoreCurrent),
        },
        result: matrixResult(event, isHome),
      };
    })
    .sort((a, b) => (b.kickoff || 0) - (a.kickoff || 0))
    .slice(0, limit);

  const rows = Array.isArray(playersPerformance?.data) ? playersPerformance.data : [];
  const players = rows
    .filter((row) => row?.id && (row.shortname || row.name))
    .map((row) => {
      const stats = {};
      let minutes = 0;
      for (const match of matches) {
        const raw = row.stats?.[String(match.id)];
        if (!raw) continue;
        const values = {};
        for (const field of MATRIX_FIELDS) {
          const value = raw[field];
          if (value === null || value === undefined || value === '') continue;
          const numeric = Number(value);
          values[field] = Number.isFinite(numeric) ? numeric : String(value);
        }
        stats[match.id] = values;
        minutes += Number(raw.minutesPlayed) || 0;
      }
      return {
        id: row.id,
        name: row.shortname || row.name,
        fullName: row.name,
        position: row.position || '',
        image: playerImage(row.id),
        minutes,
        stats,
      };
    })
    .filter((player) => player.minutes > 0 || Object.keys(player.stats).length)
    .sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));

  return { teamId, matches, players };
}

function lineupGroup(position) {
  const code = String(position || '').toUpperCase();
  if (!code) return 'M';
  if (code === 'G' || code === 'GK' || code === 'GOALKEEPER') return 'GK';
  if (code.includes('B') || code.startsWith('D') || code.startsWith('SW')) return 'D';
  if (code.includes('M')) return 'M';
  if (/^(ST|CF|SS|LW|RW|LF|RF|FW|F)/.test(code)) return 'F';
  return 'M';
}

function formationFor(starters) {
  const counts = { D: 0, M: 0, F: 0 };
  for (const player of starters) counts[lineupGroup(player.position)] += 1;
  const parts = [counts.D, counts.M, counts.F];
  return parts.some(Boolean) ? parts.join('-') : '';
}

function lineupPlayer(row) {
  return {
    id: row.playerId ?? row.id ?? null,
    name: row.name || row.shortname || '',
    jersey: row.jerseyNo ?? row.jerseynumber ?? null,
    position: row.position || '',
    minutes: numberOrNull(row.minutesPlayed),
    image: playerImage(row.playerId ?? row.id),
    points: Array.isArray(row.heatmap)
      ? row.heatmap
          .map((point) => ({ x: numberOrNull(point?.x), y: numberOrNull(point?.y) }))
          .filter((point) => point.x !== null && point.y !== null)
      : [],
  };
}

/** Confirmed XI from team-lineup, falling back to StatsHub's predicted XI. */
function buildLineup(confirmedPayload, predictedRows, teamId) {
  const confirmed = (Array.isArray(confirmedPayload?.data) ? confirmedPayload.data : []).filter(
    (row) => row?.playerId,
  );
  const confirmedStarters = confirmed.filter((row) => row.isSubstitute !== true);

  let source = null;
  let rows = [];
  if (confirmedStarters.length >= 11) {
    source = 'confirmed';
    rows = confirmed;
  } else if (Array.isArray(predictedRows) && predictedRows.length) {
    source = 'predicted';
    rows = predictedRows.map((row) => ({ ...row, isSubstitute: row.isStarter === false }));
  } else if (confirmed.length) {
    source = 'confirmed';
    rows = confirmed;
  }

  if (!rows.length) return null;
  const mapped = rows
    .map((row) => ({ player: lineupPlayer(row), substitute: row.isSubstitute === true }))
    .filter((entry) => entry.player.name);
  const starters = mapped.filter((entry) => !entry.substitute).map((entry) => entry.player);
  const substitutes = mapped.filter((entry) => entry.substitute).map((entry) => entry.player);

  return {
    teamId,
    source,
    confirmed: source === 'confirmed',
    formation: formationFor(starters),
    starters,
    substitutes,
  };
}

/** Per-player heatmap grids for this fixture, straight from StatsHub. */
const HEATMAP_CELLS = 170;

/** StatsHub sends raw touch lists; fold them onto one grid so the payload stays small. */
function compactHeatPoints(rawPoints) {
  const cells = new Map();
  for (const point of rawPoints || []) {
    const x = numberOrNull(point?.x);
    const y = numberOrNull(point?.y);
    if (x === null || y === null) continue;
    const key = `${x},${y}`;
    const cell = cells.get(key);
    if (cell) cell.count += numberOrNull(point?.count) || 1;
    else cells.set(key, { x, y, count: numberOrNull(point?.count) || 1 });
  }
  return [...cells.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, HEATMAP_CELLS)
    .map((cell) => [cell.x, cell.y, cell.count]);
}

function buildHeatmaps(payload, homeId, awayId) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  const items = rows
    .map((row) => {
      const points = compactHeatPoints(row?.heatmap_data?.points);
      if (!points.length || !row?.players?.id) return null;
      const teamId = row.players.teamid;
      return {
        id: row.players.id,
        name: row.players.shortname || row.players.name || '',
        fullName: row.players.name || '',
        teamId,
        side: Number(teamId) === Number(homeId) ? 'home' : Number(teamId) === Number(awayId) ? 'away' : null,
        position: row.players.position || '',
        image: playerImage(row.players.id),
        points,
      };
    })
    .filter(Boolean)
    .filter((item) => item.side)
    .sort((a, b) => a.side.localeCompare(b.side) || a.name.localeCompare(b.name));

  return { available: items.length > 0, items };
}

function buildSquad(playersPayload, teamId) {
  const rows = Array.isArray(playersPayload?.data) ? playersPayload.data : [];
  return rows
    .filter((row) => row?.players?.name && Number(row.teamId) === Number(teamId))
    .map((row) => ({
      name: row.players.name,
      shortName: row.players.shortname || row.players.name,
      position: row.match?.position || row.players.position || '',
      jersey: row.players.jerseynumber ?? null,
      started: Boolean(row.match?.started),
      minutes: numberOrNull(row.match?.minutesPlayed),
      goals: numberOrNull(row.match?.goals),
      id: row.players.id ?? null,
      image: playerImage(row.players.id),
      assists: numberOrNull(row.match?.assists),
      shots: numberOrNull(row.match?.shots),
      onTarget: numberOrNull(row.match?.shotsOnTarget),
      yellowCards: numberOrNull(row.match?.yellowCards),
      redCards: numberOrNull(row.match?.redCards),
      rating: numberOrNull(row.match?.rating),
      season: {
        appearances: numberOrNull(row.season?.appearances),
        goals: numberOrNull(row.season?.goals),
        assists: numberOrNull(row.season?.assists),
        minutes: numberOrNull(row.season?.minutesPlayed),
        rating: numberOrNull(row.season?.rating),
      },
    }))
    .sort((a, b) => {
      if (a.started !== b.started) return a.started ? -1 : 1;
      return (b.minutes ?? 0) - (a.minutes ?? 0);
    });
}

const MONTHS_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
];

function expectedReturnLabel(expected) {
  if (!expected?.day || !expected?.month) return null;
  return `${expected.day} ${MONTHS_SHORT[expected.month - 1] || ''}`.trim();
}

function humanizeReason(reason) {
  return String(reason || '')
    .replace(/_/g, ' ')
    .replace(/^./, (character) => character.toUpperCase())
    .trim();
}

/** Injuries and suspensions for one team, as StatsHub lists them. */
function buildTeamNews(playersPerformance) {
  const rows = Array.isArray(playersPerformance?.unavailability)
    ? playersPerformance.unavailability
    : [];

  return rows
    .filter((row) => row?.name)
    .map((row) => {
      const suspended = row.kind === 'suspension';
      const doubtful = row.status === 'dayToDay' || row.status === 'doubtful';
      const status = suspended
        ? 'Suspended'
        : row.status === 'out'
          ? 'Out'
          : doubtful
            ? 'Doubtful'
            : 'Injured';
      const back = expectedReturnLabel(row.expectedReturn);
      const note =
        suspended && row.matches
          ? `${row.matches} match${row.matches === 1 ? '' : 'es'} ban`
          : back
            ? `Back ${back}`
            : '';

      return {
        id: row.playerId ?? null,
        name: row.name,
        position: row.position || '',
        image: playerImage(row.playerId),
        kind: row.kind || 'injury',
        reason: humanizeReason(row.reason),
        status,
        tone: suspended ? 'suspended' : doubtful ? 'doubt' : 'out',
        note,
      };
    })
    .sort(
      (a, b) =>
        (a.tone === 'out' ? 1 : 0) - (b.tone === 'out' ? 1 : 0) ||
        a.name.localeCompare(b.name),
    );
}

function buildComparison(payload) {
  const rows = Array.isArray(payload?.data) ? payload.data : [];
  return rows
    .map((row) => ({
      key: row.statKey,
      label: row.statName,
      home: {
        average: numberOrNull(row.homeTeam?.avg),
        rank: numberOrNull(row.homeTeam?.rank),
      },
      away: {
        average: numberOrNull(row.awayTeam?.avg),
        rank: numberOrNull(row.awayTeam?.rank),
      },
      homeAgainst: numberOrNull(row.homeTeamAgainst?.avg),
      awayAgainst: numberOrNull(row.awayTeamAgainst?.avg),
    }))
    .filter((row) => row.home.average !== null || row.away.average !== null);
}

/** Full StatsHub payload for one fixture (match, player, team stats). */
export async function getStatshubMatch(eventId) {
  const id = Number(eventId);
  if (!Number.isFinite(id) || id <= 0) return null;

  const cached = detailCache.get(id);
  if (cached && Date.now() - cached.timestamp < DETAIL_TTL) return cached.data;

  const eventPayload = await fetchJson(`${BASE}/api/event/${id}`, {
    ttl: DETAIL_TTL,
    timeoutSeconds: 25,
  });
  const events = eventPayload?.events;
  if (!events) return cached ? cached.data : null;

  const homeId = events.homeTeamId;
  const awayId = events.awayTeamId;
  const seasonId = events.seasonId;

  const urls = {
    players: `${BASE}/api/event/${id}/players`,
    homePerformance: `${BASE}/api/team/${homeId}/performance?limit=${MATRIX_LIMIT}&location=both&fixtureId=${id}`,
    awayPerformance: `${BASE}/api/team/${awayId}/performance?limit=${MATRIX_LIMIT}&location=both&fixtureId=${id}`,
    homePlayers: `${BASE}/api/team/${homeId}/players/performance?limit=${MATRIX_LIMIT}&location=both&fixtureId=${id}`,
    awayPlayers: `${BASE}/api/team/${awayId}/players/performance?limit=${MATRIX_LIMIT}&location=both&fixtureId=${id}`,
    comparison: `${BASE}/api/teams/comparison?homeTeamId=${homeId}&awayTeamId=${awayId}&seasonId=${seasonId}&tournamentId=${events.tournamentId}`,
    homeLineup: `${BASE}/api/event/${id}/team-lineup?teamId=${homeId}&heatmap=true`,
    awayLineup: `${BASE}/api/event/${id}/team-lineup?teamId=${awayId}&heatmap=true`,
    predicted: `${BASE}/api/event/${id}/predicted-teams-lineup`,
    heatmap: `${BASE}/api/event/${id}/heatmap?homeTeam=${homeId}&awayTeam=${awayId}&tournamentId=${events.tournamentId}&seasonId=${seasonId}`,
  };

  const payloads = await fetchJsonBatch(Object.values(urls), {
    ttl: DETAIL_TTL,
    timeoutSeconds: 35,
  });

  const homePerformance = payloads.get(urls.homePerformance);
  const awayPerformance = payloads.get(urls.awayPerformance);
  const targetRecord = (homePerformance?.data || []).find(
    (row) => String(row?.event?.id) === String(id),
  );

  const homeTeam = eventPayload.homeTeam || {};
  const awayTeam = eventPayload.awayTeam || {};
  const referee = eventPayload.referees || null;
  const venue = eventPayload.venues || null;

  const homeForm = buildTeamForm(homePerformance, homeId);
  const awayForm = buildTeamForm(awayPerformance, awayId);

  const predicted = payloads.get(urls.predicted);
  const lineups = {
    home: buildLineup(payloads.get(urls.homeLineup), predicted?.homeTeam?.data, homeId),
    away: buildLineup(payloads.get(urls.awayLineup), predicted?.awayTeam?.data, awayId),
  };

  let heatmaps = buildHeatmaps(payloads.get(urls.heatmap), homeId, awayId);
  if (!heatmaps.available) {
    const fallback = [];
    for (const side of ['home', 'away']) {
      for (const player of lineups[side]?.starters || []) {
        if (!player.points?.length) continue;
        fallback.push({
          id: player.id,
          name: player.name,
          fullName: player.name,
          teamId: side === 'home' ? homeId : awayId,
          side,
          position: player.position,
          image: player.image,
          points: compactHeatPoints(player.points),
        });
      }
    }
    heatmaps = { available: fallback.length > 0, items: fallback };
  }

  const data = {
    id,
    slug: events.slug,
    url: `${BASE}/fixture/${events.slug}/${events.internalId}`,
    status: events.status,
    kickoff: Number(events.timeStartTimestamp) || null,
    lineupConfirmed: Boolean(events.lineupConfirmed),
    score: { home: events.homeScoreCurrent, away: events.awayScoreCurrent },
    halfTime: { home: events.period1Home, away: events.period1Away },
    competition: {
      name: eventPayload.tournaments?.name || '',
      category: eventPayload.categories?.name || '',
    },
    referee: referee
      ? {
          name: referee.name,
          games: numberOrNull(referee.games),
          yellowCards: numberOrNull(referee.yellowCards),
          redCards: numberOrNull(referee.redCards),
          averageCards: numberOrNull(referee.averageCards),
        }
      : null,
    venue: venue
      ? { name: venue.name, city: venue.cityName, capacity: numberOrNull(venue.capacity) }
      : null,
    homeTeam: {
      id: homeId,
      name: homeTeam.name || '',
      shortName: homeTeam.shortname || homeTeam.name || '',
      logo: logoFor({ id: homeId }),
    },
    awayTeam: {
      id: awayId,
      name: awayTeam.name || '',
      shortName: awayTeam.shortname || awayTeam.name || '',
      logo: logoFor({ id: awayId }),
    },
    teams: [
      {
        id: homeId,
        name: homeTeam.name || '',
        shortName: homeTeam.shortname || '',
        logo: logoFor({ id: homeId }),
      },
      {
        id: awayId,
        name: awayTeam.name || '',
        shortName: awayTeam.shortname || awayTeam.name || '',
        logo: logoFor({ id: awayId }),
      },
    ],
    tournament: {
      name: eventPayload.tournaments?.name || '',
      uniqueId: events.uniqueTournamentId,
      seasonId,
    },
    matchStats: buildMatchStats(targetRecord),
    comparison: buildComparison(payloads.get(urls.comparison)),
    squads: {
      home: buildSquad(payloads.get(urls.players), homeId),
      away: buildSquad(payloads.get(urls.players), awayId),
    },
    matrices: {
      home: buildMatrix(payloads.get(urls.homePlayers), homeId),
      away: buildMatrix(payloads.get(urls.awayPlayers), awayId),
    },
    lineups,
    heatmaps,
    teamNews: {
      home: buildTeamNews(payloads.get(urls.homePlayers)),
      away: buildTeamNews(payloads.get(urls.awayPlayers)),
    },
    form: {
      home: { teamId: homeId, matches: homeForm },
      away: { teamId: awayId, matches: awayForm },
    },
  };

  detailCache.set(id, { data, timestamp: Date.now() });
  while (detailCache.size > MAX_CACHE) detailCache.delete(detailCache.keys().next().value);
  return data;
}

export { statsHubStatus };
