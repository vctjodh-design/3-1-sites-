import { fetchTextBatch } from './statshubHttp.js';

/**
 * Soccerway runs on the Livesport/Flashscore platform (project 2034).
 * Its match id is the same code BetExplorer uses in the match URL, so no
 * extra matching is needed. The feeds are `÷`/`¬` encoded text.
 */
const FEED = 'https://2034.flashscore.ninja/2034/x/feed';
const FEED_HEADERS = {
  'x-fsign': 'SW9D1eZo',
  Referer: 'https://uk.soccerway.com/',
  Origin: 'https://uk.soccerway.com',
};
const FEED_TTL = 3 * 60 * 1000;
const CACHE_TTL = 3 * 60 * 1000;

const cache = new Map();
const MAX_CACHE = 40;

/** Split a feed into blocks of ordered [key, value] pairs. */
function parseFeed(text) {
  if (!text || !text.trim() || text.trim() === '0') return [];
  return text
    .split('~')
    .map((chunk) => {
      const pairs = [];
      for (const part of chunk.split('¬')) {
        const index = part.indexOf('÷');
        if (index === -1) continue;
        pairs.push([part.slice(0, index), part.slice(index + 1)]);
      }
      return pairs;
    })
    .filter((pairs) => pairs.length);
}

function firstValue(pairs, keys) {
  for (const [key, value] of pairs) {
    if (keys.includes(key)) return value;
  }
  return null;
}

function playerEntries(pairs) {
  const players = [];
  let current = null;
  for (const [key, value] of pairs) {
    if (key === 'IE' || key === 'IEX') {
      current = { typeCode: value };
      players.push(current);
      continue;
    }
    if (!current) continue;
    if (key === 'IF' || key === 'IFX') current.name = value;
    else if (key === 'IU' || key === 'IUX') current.url = value;
    else if (key === 'IK' || key === 'IKX') current.label = value;
    else if (key === 'IM' || key === 'IMX') current.id = value;
    else if (key === 'IL' || key === 'ILX') current.reason = value;
    else if (key === 'IJ' || key === 'IJX') current.reasonCode = value;
    else if (key === 'ICT' || key === 'ICTX') current.text = value;
  }
  return players.filter((player) => player.name || player.label || player.text);
}

function incidentText(pairs, players) {
  const direct = firstValue(pairs, ['ICT', 'ICTX']);
  if (direct) return direct;
  return players.find((player) => player.text)?.text || '';
}

function minuteValue(label) {
  const match = /(\d+)(?:\+(\d+))?/.exec(String(label || ''));
  if (!match) return 0;
  return Number(match[1]) + (Number(match[2]) || 0) / 100;
}

/** Incidents: goals (with assists), cards (with reason), subs, disallowed goals. */
function buildIncidents(text) {
  const blocks = parseFeed(text);
  const halves = [];
  const goals = [];
  const cards = [];
  const substitutions = [];
  const disallowed = [];
  const other = [];
  let half = null;

  for (const pairs of blocks) {
    const halfName = firstValue(pairs, ['AC']);
    if (halfName) {
      half = {
        name: halfName,
        home: Number(firstValue(pairs, ['IG'])) || 0,
        away: Number(firstValue(pairs, ['IH'])) || 0,
      };
      halves.push(half);
    }

    const id = firstValue(pairs, ['III', 'IIIX']);
    if (!id) continue;

    const players = playerEntries(pairs);
    const type = players[0]?.label || '';
    const side = firstValue(pairs, ['IA', 'IAX']) === '1' ? 'home' : 'away';
    const minute = firstValue(pairs, ['IB', 'IBX']) || '';
    const textValue = incidentText(pairs, players);
    const scoreHome = firstValue(pairs, ['INX']);
    const scoreAway = firstValue(pairs, ['IOX']);
    const record = {
      id,
      side,
      minute,
      order: minuteValue(minute),
      type,
      text: textValue,
      half: half?.name || '',
    };

    if (/disallowed/i.test(type)) {
      disallowed.push({
        ...record,
        player: players[0]?.name || '',
        playerId: firstValue(pairs, ['IMX', 'IM']) || players[0]?.id || '',
        url: firstValue(pairs, ['IUX', 'IU']) || players[0]?.url || '',
        reason: firstValue(pairs, ['ILX', 'IL']) || players[0]?.reason || '',
        varCode: firstValue(pairs, ['IEX']) || '',
      });
      continue;
    }

    if (/goal/i.test(type) && !/assist/i.test(type)) {
      const scorer =
        players.find((player) => /^goal$/i.test(player.label || '')) || players[0] || {};
      const assist = players.find((player) => /assist/i.test(player.label || ''));
      goals.push({
        ...record,
        player: scorer.name || '',
        playerId: scorer.id || '',
        url: scorer.url || '',
        assist: assist?.name || '',
        assistId: assist?.id || '',
        assistUrl: assist?.url || '',
        score:
          scoreHome !== null && scoreAway !== null
            ? { home: Number(scoreHome), away: Number(scoreAway) }
            : null,
      });
      continue;
    }

    if (/card/i.test(type)) {
      cards.push({
        ...record,
        player: players[0]?.name || '',
        playerId: players[0]?.id || '',
        url: players[0]?.url || '',
        reason: players[0]?.reason || firstValue(pairs, ['IL']) || '',
        color: /red/i.test(type) ? 'red' : /yellow/i.test(type) ? 'yellow' : 'other',
      });
      continue;
    }

    if (/substitution/i.test(type)) {
      const out = players.find((player) => /out/i.test(player.label || '')) || null;
      const incoming = players.find((player) => /in/i.test(player.label || '')) || null;
      substitutions.push({
        ...record,
        out: out?.name || '',
        outId: out?.id || '',
        in: incoming?.name || '',
        inId: incoming?.id || '',
      });
      continue;
    }

    other.push({ ...record, player: players[0]?.name || '' });
  }

  return { halves, goals, cards, substitutions, disallowed, other };
}

/** Stats for Match / 1st Half / 2nd Half, deduplicated per stage. */
function buildStats(text) {
  const blocks = parseFeed(text);
  const stages = [];
  let stage = null;
  let group = null;
  let current = null;

  for (const pairs of blocks) {
    for (const [key, value] of pairs) {
      if (key === 'SE') {
        stage = { name: value, groups: [] };
        stages.push(stage);
        group = null;
        current = null;
      } else if (key === 'SF') {
        if (!stage) continue;
        group = { name: value, stats: [] };
        stage.groups.push(group);
        current = null;
      } else if (key === 'SD') {
        if (!stage) continue;
        if (!group) {
          group = { name: 'Stats', stats: [] };
          stage.groups.push(group);
        }
        current = { id: value, label: '', home: '', away: '' };
        group.stats.push(current);
      } else if (key === 'SG' && current) {
        current.label = value;
      } else if (key === 'SH' && current) {
        current.home = value;
      } else if (key === 'SI' && current) {
        current.away = value;
      }
    }
  }

  // "Top stats" repeats a handful of metrics later; keep the first occurrence.
  for (const item of stages) {
    const seen = new Set();
    item.groups = item.groups
      .map((entry) => ({
        name: entry.name,
        stats: entry.stats.filter((stat) => {
          if (!stat.label || seen.has(stat.id)) return false;
          seen.add(stat.id);
          return true;
        }),
      }))
      .filter((entry) => entry.stats.length);
  }

  return stages;
}

/** Full minute-by-minute commentary, newest first (as Soccerway serves it). */
function buildCommentary(text) {
  return parseFeed(text)
    .map((pairs) => ({
      minute: firstValue(pairs, ['MB']) || '',
      clock: firstValue(pairs, ['MK']) || '',
      type: firstValue(pairs, ['MC']) || '',
      text: firstValue(pairs, ['MD']) || '',
      important: firstValue(pairs, ['MF']) === '1',
    }))
    .filter((row) => row.text && row.minute);
}

function buildInfo(text) {
  const info = {};
  const extras = {};
  for (const pairs of parseFeed(text)) {
    for (let index = 0; index < pairs.length; index += 1) {
      const [key, value] = pairs[index];
      if (key !== 'MIT') continue;
      const next = pairs[index + 1];
      if (!next || next[0] !== 'MIV') continue;
      info[value] = next[1];
    }
    const tv = firstValue(pairs, ['TA']);
    if (tv) extras.tv = tv;
  }
  return { ...info, ...extras };
}

function buildHighlights(text) {
  const block = parseFeed(text).find((pairs) => firstValue(pairs, ['HIT']));
  if (!block) return null;
  return {
    title: firstValue(block, ['HIT']) || 'Match highlights',
    url: firstValue(block, ['HUO']) || '',
    image: firstValue(block, ['HIP']) || '',
  };
}

export async function getSoccerwayMatch(matchId) {
  const id = String(matchId || '');
  if (!/^[A-Za-z0-9]{6,12}$/.test(id)) return null;

  const cached = cache.get(id);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data;

  const urls = {
    incidents: `${FEED}/df_sui_1_${id}`,
    commentary: `${FEED}/df_lc_1_${id}`,
    stats: `${FEED}/df_st_1_${id}`,
    info: `${FEED}/df_sur_1_${id}`,
    highlights: `${FEED}/df_hi_1_${id}`,
  };

  let payloads;
  try {
    payloads = await fetchTextBatch(Object.values(urls), {
      ttl: FEED_TTL,
      timeoutSeconds: 25,
      headers: FEED_HEADERS,
    });
  } catch (error) {
    console.error(`[soccerway] ${id}: ${error.message}`);
    return null;
  }

  const incidentsText = payloads.get(urls.incidents);
  const commentaryText = payloads.get(urls.commentary);
  const statsText = payloads.get(urls.stats);
  const infoText = payloads.get(urls.info);
  const highlightsText = payloads.get(urls.highlights);

  if (
    incidentsText === null &&
    commentaryText === null &&
    statsText === null &&
    infoText === null
  ) {
    return null;
  }

  const incidents = buildIncidents(incidentsText);
  const commentary = buildCommentary(commentaryText);
  const stages = buildStats(statsText);
  const info = buildInfo(infoText);
  const highlights = buildHighlights(highlightsText);

  const data = {
    available: true,
    id,
    goals: incidents.goals
      .slice()
      .sort((a, b) => a.order - b.order),
    cards: incidents.cards.slice().sort((a, b) => a.order - b.order),
    substitutions: incidents.substitutions.slice().sort((a, b) => a.order - b.order),
    disallowed: incidents.disallowed.slice().sort((a, b) => a.order - b.order),
    incidents: incidents.other.slice().sort((a, b) => a.order - b.order),
    halves: incidents.halves,
    stats: { stages },
    commentary,
    importantCommentary: commentary.filter((row) => row.important).length,
    info,
    highlights,
    hasEvents:
      incidents.goals.length +
        incidents.cards.length +
        incidents.substitutions.length +
        incidents.disallowed.length >
      0,
    updatedAt: Date.now(),
  };

  cache.set(id, { data, timestamp: Date.now() });
  while (cache.size > MAX_CACHE) cache.delete(cache.keys().next().value);

  return data;
}

export const __test = { parseFeed, buildIncidents, buildStats, buildCommentary, buildInfo };
