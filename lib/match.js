import * as cheerio from 'cheerio';

const BASE_URL = 'https://www.betexplorer.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

export const MARKETS = {
  '1x2': { key: '1x2', label: '1X2', endpoint: '1x2', columns: ['1', 'X', '2'] },
  ou: { key: 'ou', label: 'Over/Under', endpoint: 'ou', columns: ['Over', 'Under'] },
  ah: { key: 'ah', label: 'Asian Handicap', endpoint: 'ah', columns: ['1', '2'] },
  dnb: { key: 'dnb', label: 'Draw No Bet', endpoint: 'ha', columns: ['1', '2'] },
  dc: { key: 'dc', label: 'Double Chance', endpoint: 'dc', columns: ['1X', '12', 'X2'] },
  bts: { key: 'bts', label: 'Both Teams to Score', endpoint: 'bts', columns: ['Yes', 'No'] },
};

const baseCache = new Map();
const oddsCache = new Map();
const BASE_TTL = 15 * 60 * 1000;
const ODDS_TTL = 5 * 60 * 1000;

function clean(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pad(value) {
  return String(value).padStart(2, '0');
}

function absoluteUrl(value) {
  if (!value) return null;
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('/')) return `${BASE_URL}${value}`;
  return value;
}

function normalizeName(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export function parseMatchUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl || ''), BASE_URL);
  } catch {
    return null;
  }

  if (parsed.protocol !== 'https:' || parsed.hostname !== 'www.betexplorer.com') return null;
  if (!parsed.pathname.startsWith('/football/')) return null;

  const segments = parsed.pathname.split('/').filter(Boolean);
  if (segments.length < 4) return null;

  const id = segments[segments.length - 1];
  if (!/^[A-Za-z0-9]{6,12}$/.test(id)) return null;

  const pathname = parsed.pathname.endsWith('/') ? parsed.pathname : `${parsed.pathname}/`;
  const leaguePath = `/${segments.slice(0, 3).join('/')}/`;

  return {
    url: `${BASE_URL}${pathname}`,
    id,
    pathname,
    leaguePath,
  };
}

async function request(url, options = {}) {
  const { json = false } = options;
  let lastError;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: json
            ? 'application/json,text/javascript,*/*;q=0.8'
            : 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-GB,en;q=0.9',
          Referer: `${BASE_URL}/`,
          'X-Requested-With': 'XMLHttpRequest',
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) throw new Error(`BetExplorer responded with HTTP ${response.status}`);
      return json ? await response.json() : await response.text();
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 350));
    }
  }

  throw lastError;
}

function parseScorerTable($, table) {
  const scorers = [];
  $(table)
    .find('tr')
    .each((_, row) => {
      const cells = $(row)
        .find('td')
        .map((__, cell) => clean($(cell).text()))
        .get();
      const minuteCell = cells.find((cell) => /^\d{1,3}\.?$/.test(cell));
      const nameCell = cells.find(
        (cell) => cell && cell !== minuteCell && !/^\d{1,3}\.?$/.test(cell),
      );
      if (minuteCell && nameCell) {
        scorers.push({ minute: `${minuteCell.replace(/\.$/, '')}'`, name: nameCell });
      }
    });
  return scorers;
}

function parseMatchPage(html, parsed) {
  const $ = cheerio.load(html);

  const teamTitles = $('.list-details__item__title')
    .map((_, element) => clean($(element).text()))
    .get()
    .filter(Boolean);
  const teamLogos = $('.list-details__item__team img')
    .map((_, element) => absoluteUrl($(element).attr('src')))
    .get()
    .filter(Boolean);

  const home = teamTitles[0] || '';
  const away = teamTitles[1] || '';

  const dtRaw = String($('#match-date').attr('data-dt') || '');
  const dt = dtRaw.split(',').map((part) => clean(part));
  const hasDate = dt.length >= 5;

  const scoreText = clean($('#js-score').text());
  const scoreMatch = /^(\d+)\s*:\s*(\d+)$/.exec(scoreText);
  const score = scoreMatch ? { home: Number(scoreMatch[1]), away: Number(scoreMatch[2]) } : null;
  const partial = clean($('#js-partial').text()) || null;

  const isFinished = clean($('#isFinished').val()) === '1';
  const isLive = clean($('#isLive').val()) === '1';
  const status = isFinished ? 'FIN' : isLive ? 'LIVE' : 'Scheduled';

  const breadcrumbs = $('.breadcrumb__li')
    .map((_, element) => clean($(element).text()))
    .get()
    .filter(Boolean);
  const league = breadcrumbs[breadcrumbs.length - 2] || '';
  const country = breadcrumbs[breadcrumbs.length - 3] || '';

  const flag = absoluteUrl($('.wrap-section__header__image img').first().attr('src'));

  const scorerTables = $('.list-details--shooters table');
  const homeScorers = parseScorerTable($, scorerTables.eq(0));
  const awayScorers = parseScorerTable($, scorerTables.eq(1));

  const dateKey = hasDate ? `${dt[2]}-${pad(dt[1])}-${pad(dt[0])}` : '';
  const time = hasDate ? `${pad(dt[3])}:${pad(dt[4])}` : '';
  const dateLabel = hasDate ? `${pad(dt[0])}.${pad(dt[1])}.${dt[2]}` : '';

  return {
    match: {
      id: clean($('#eventID').attr('data-event-id')) || parsed.id,
      home,
      away,
      homeLogo: teamLogos[0] || null,
      awayLogo: teamLogos[1] || null,
      score,
      partial,
      status,
      date: dateKey,
      dateLabel,
      time,
      league,
      country,
      flag,
      scorers: { home: homeScorers, away: awayScorers },
      url: parsed.url,
      source: parsed.url,
    },
    params: {
      mutualPar: clean($('#mutual_par').val()),
      season: clean($('#mutual_current_season').val()),
      stageId: clean($('#stage_id').val()),
      leaguePath: parsed.leaguePath,
    },
  };
}

function parseH2H(html, eventId, homeTeam) {
  const $ = cheerio.load(html);
  const groups = [];

  $('#js-mutual-table > .percentage-bar__column').each((_, groupElement) => {
    const $group = $(groupElement);
    const title =
      clean($group.find('.head-to-head__header .table-main__leaguesNames').first().text()) ||
      'Previous meetings';

    const matches = [];
    $group.find('.head-to-head__row').each((__, rowElement) => {
      const $row = $(rowElement);
      const href = $row.find('a[href*="/football/"]').first().attr('href') || '';

      const scores = $row
        .find('.participantAlign .mainResult span')
        .map((___, span) => clean($(span).text()))
        .get()
        .filter((value) => /^\d+$/.test(value))
        .map(Number);
      if (scores.length < 2) return;

      const home = clean($row.find('.table-main__participantHome p').first().text());
      const away = clean($row.find('.table-main__participantAway p').first().text());
      if (!home || !away) return;

      const odds = $row
        .find('.table-main__odds[data-odd]')
        .map((___, cell) => Number($(cell).attr('data-odd')))
        .get()
        .filter((value) => Number.isFinite(value) && value > 1);

      const winnerOdd = Number($row.find('.oddsWinnerBold').first().attr('data-odd'));
      const date =
        clean($row.find('.head-to-head__date .mobileHidden').first().text()) ||
        clean($row.find('.head-to-head__date').text());

      matches.push({
        date,
        home,
        away,
        homeScore: scores[0],
        awayScore: scores[1],
        odds,
        highlight: Number.isFinite(winnerOdd) ? odds.indexOf(winnerOdd) : -1,
        url: absoluteUrl(href),
      });
    });

    if (matches.length) groups.push({ title, matches });
  });

  const allMatches = groups.flatMap((group) => group.matches);
  const recent = allMatches.slice(0, 6);

  let wins = 0;
  let draws = 0;
  let losses = 0;
  for (const match of recent) {
    if (match.homeScore === match.awayScore) {
      draws += 1;
      continue;
    }
    const rowHomeWon = match.homeScore > match.awayScore;
    const currentHomeWon = match.home === homeTeam ? rowHomeWon : !rowHomeWon;
    if (currentHomeWon) wins += 1;
    else losses += 1;
  }

  return {
    summary: { wins, draws, losses, total: recent.length },
    groups,
    matches: allMatches,
    totalMeetings: allMatches.length,
  };
}

function parseStandings(html, homeTeam, awayTeam) {
  const $ = cheerio.load(html);
  const table = $('table.stats-table').first();
  if (!table.length) return null;

  const rows = [];
  table.find('tbody tr').each((_, rowElement) => {
    const $row = $(rowElement);
    const team = clean($row.find('.participant_name a').first().text());
    if (!team) return;

    const rank = Number.parseInt(clean($row.find('.rank').text()), 10);
    const style = $row.find('.team-logo').first().attr('style') || '';
    const logoMatch = /url\(([^)]+)\)/.exec(style);

    const form = $row
      .find('.form-bg')
      .map((__, element) => {
        const classes = String($(element).attr('class') || '');
        if (/\bform-(w|s)\b/.test(classes)) return 'w';
        if (/\bform-d\b/.test(classes)) return 'd';
        if (/\bform-l\b/.test(classes)) return 'l';
        return null;
      })
      .get()
      .filter(Boolean)
      .slice(-5);

    const played = clean($row.find('.matches_played').text());
    const points = clean($row.find('.points').text());
    const goalDifference = clean($row.find('.goals_for_against_diff').text());

    rows.push({
      rank: Number.isFinite(rank) ? rank : null,
      team,
      logo: logoMatch ? absoluteUrl(logoMatch[1].replace(/["']/g, '').trim()) : null,
      played,
      points,
      goalDifference,
      form,
      isHome: normalizeName(team) === normalizeName(homeTeam),
      isAway: normalizeName(team) === normalizeName(awayTeam),
    });
  });

  if (!rows.length) return null;
  return { rows };
}

function parseOdds(html, market) {
  const $ = cheerio.load(html);
  const tables = $('table.oddsComparison__table');
  if (!tables.length) return null;

  const meta = MARKETS[market] || MARKETS['1x2'];
  const headerLabels = tables
    .first()
    .find('thead th.table-main__detail-odds')
    .map((_, element) => clean($(element).text()))
    .get()
    .filter(Boolean);

  const entries = [];
  tables.each((_, tableElement) => {
    $(tableElement)
      .find('tbody tr[data-bid]')
      .each((__, rowElement) => {
        const $row = $(rowElement);
        const cells = $row.find('td.table-main__detail-odds[data-odd]');
        if (!cells.length) return;

        const odds = cells
          .map((___, cellElement) => {
            const $cell = $(cellElement);
            const value = Number($cell.attr('data-odd'));
            if (!Number.isFinite(value) || value <= 1) return null;
            const classes = String($cell.attr('class') || '');
            return {
              value,
              best: /archiveOddsMovement__odds_best|\bcolored\b/.test(classes),
              movement: $cell.find('.icon__increasing').length
                ? 'up'
                : $cell.find('.icon__decreasing').length
                  ? 'down'
                  : null,
            };
          })
          .get()
          .filter(Boolean);

        if (!odds.length) return;

        const bookmaker =
          clean(cells.first().attr('data-bookie')) ||
          clean($row.find('.in-bookmaker-logo-link').first().text()) ||
          'Bookmaker';
        const line = clean($row.find('td.table-main__doubleparameter').first().text()) || null;

        entries.push({ bookmaker, line, odds });
      });
  });

  if (!entries.length) return null;

  const byLine = new Map();
  for (const entry of entries) {
    const key = entry.line || '';
    let bucket = byLine.get(key);
    if (!bucket) {
      bucket = [];
      byLine.set(key, bucket);
    }
    if (bucket.some((row) => row.bookmaker.toLowerCase() === entry.bookmaker.toLowerCase())) {
      continue;
    }
    bucket.push(entry);
  }

  const lines = [...byLine.entries()].map(([line, rows]) => ({
    line: line || null,
    rows,
  }));

  if (lines.some((line) => line.line)) {
    lines.sort((a, b) => Number.parseFloat(a.line) - Number.parseFloat(b.line));
  }

  return {
    market: meta.key,
    label: meta.label,
    columns: headerLabels.length >= meta.columns.length ? headerLabels : meta.columns,
    hasLines: lines.some((line) => line.line !== null),
    lines,
    totalRows: entries.length,
  };
}

async function fetchH2H(params, eventId, homeTeam) {
  if (!params.mutualPar) return null;
  const query = new URLSearchParams({
    par: params.mutualPar,
    new: 'true',
    bt: '1x2',
    lang: 'en',
    cs: params.season || '',
  });
  const html = await request(`${BASE_URL}/gres/ajax/mutual-matches.php?${query}`);
  return parseH2H(html, eventId, homeTeam);
}

async function fetchStandings(params, eventId, homeTeam, awayTeam) {
  if (!params.stageId) return null;
  const query = new URLSearchParams({
    table: 'table',
    table_sub: 'overall',
    ts: params.stageId,
    dcheck: '0',
    'as-ajax': '1',
    l: 'en',
    event_context: eventId,
  });
  const html = await request(`${BASE_URL}${params.leaguePath}standings/?${query}`);
  return parseStandings(html, homeTeam, awayTeam);
}

async function fetchOdds(eventId, market) {
  const meta = MARKETS[market] || MARKETS['1x2'];
  const url = `${BASE_URL}/match-odds/${eventId}/0/${meta.endpoint}/odds/?lang=en`;
  const payload = await request(url, { json: true });
  if (!payload || typeof payload.odds !== 'string') return null;
  return parseOdds(payload.odds, market);
}

async function getBaseDetails(parsed) {
  const cached = baseCache.get(parsed.url);
  if (cached && Date.now() - cached.timestamp < BASE_TTL) return cached.data;

  try {
    const html = await request(parsed.url);
    const page = parseMatchPage(html, parsed);

    const [h2h, standings] = await Promise.all([
      fetchH2H(page.params, page.match.id, page.match.home).catch((error) => {
        console.error(`[match:h2h] ${page.match.id}: ${error.message}`);
        return null;
      }),
      fetchStandings(page.params, page.match.id, page.match.home, page.match.away).catch(
        (error) => {
          console.error(`[match:standings] ${page.match.id}: ${error.message}`);
          return null;
        },
      ),
    ]);

    const data = { match: page.match, h2h, standings };
    baseCache.set(parsed.url, { data, timestamp: Date.now() });
    if (baseCache.size > 30) baseCache.delete(baseCache.keys().next().value);
    return data;
  } catch (error) {
    if (cached) return cached.data;
    throw error;
  }
}

export async function getMatchDetails(rawUrl, requestedMarket = '1x2') {
  const parsed = parseMatchUrl(rawUrl);
  if (!parsed) {
    const error = new Error('Provide a valid BetExplorer football match URL.');
    error.statusCode = 400;
    throw error;
  }

  const market = MARKETS[requestedMarket] ? requestedMarket : '1x2';
  const base = await getBaseDetails(parsed);

  const cacheKey = `${base.match.id}:${market}`;
  const cachedOdds = oddsCache.get(cacheKey);
  let odds = null;

  if (cachedOdds && Date.now() - cachedOdds.timestamp < ODDS_TTL) {
    odds = cachedOdds.data;
  } else {
    try {
      odds = await fetchOdds(base.match.id, market);
      oddsCache.set(cacheKey, { data: odds, timestamp: Date.now() });
      if (oddsCache.size > 60) oddsCache.delete(oddsCache.keys().next().value);
    } catch (error) {
      console.error(`[match:odds] ${base.match.id}/${market}: ${error.message}`);
      odds = cachedOdds ? cachedOdds.data : null;
    }
  }

  return {
    ...base,
    odds,
    market,
    marketLabel: (MARKETS[market] || MARKETS['1x2']).label,
  };
}

/** Pre-match best-odds boards for the markets the report compares against. */
export async function getPrematchOdds(rawUrl) {
  const parsed = parseMatchUrl(rawUrl);
  if (!parsed) return null;

  const markets = ['1x2', 'ou', 'bts'];
  const results = await Promise.all(
    markets.map(async (market) => {
      const cacheKey = `${parsed.id}:${market}`;
      const cached = oddsCache.get(cacheKey);
      if (cached && Date.now() - cached.timestamp < ODDS_TTL) return [market, cached.data];

      try {
        const data = await fetchOdds(parsed.id, market);
        oddsCache.set(cacheKey, { data, timestamp: Date.now() });
        if (oddsCache.size > 60) oddsCache.delete(oddsCache.keys().next().value);
        return [market, data];
      } catch (error) {
        console.error(`[match:prematch] ${parsed.id}/${market}: ${error.message}`);
        return [market, cached ? cached.data : null];
      }
    }),
  );

  return Object.fromEntries(results);
}

export const __test = { parseH2H, parseStandings, parseOdds, parseMatchPage };
