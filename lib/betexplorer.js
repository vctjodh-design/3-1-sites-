import * as cheerio from 'cheerio';

const BASE_URL = 'https://www.betexplorer.com';
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

const cache = new Map();
const MAX_CACHE_ENTRIES = 24;

function clean(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim();
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function absoluteUrl(value) {
  if (!value) return null;
  if (value.startsWith('//')) return `https:${value}`;
  if (value.startsWith('/')) return `${BASE_URL}${value}`;
  return value;
}

export function parseDateKey(dateKey) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey || ''));
  if (!match) return null;
  const [, y, m, d] = match.map(Number);
  const check = new Date(Date.UTC(y, m - 1, d));
  if (
    check.getUTCFullYear() !== y ||
    check.getUTCMonth() !== m - 1 ||
    check.getUTCDate() !== d
  ) {
    return null;
  }
  if (y < 2000 || y > 2100) return null;
  return { year: y, month: m, day: d };
}

function normalizeStatus(rawStatus, hasScore) {
  const status = clean(rawStatus);

  if (/^\d{1,2}:\d{2}$/.test(status)) {
    return { state: 'scheduled', label: status };
  }
  if (/^(fin|finished)$/i.test(status)) return { state: 'finished', label: 'FIN' };
  if (/^aet$/i.test(status)) return { state: 'finished', label: 'AET' };
  if (/^(afp|ap|pen|pens)$/i.test(status)) {
    return { state: 'finished', label: status.toUpperCase() };
  }
  if (/^(awd|wo)$/i.test(status)) {
    return { state: 'finished', label: status.toUpperCase() };
  }
  if (/^postp/i.test(status)) return { state: 'postponed', label: 'Postp.' };
  if (/^(canc|can\.)/i.test(status)) return { state: 'cancelled', label: 'Canc.' };
  if (/^aban/i.test(status)) return { state: 'abandoned', label: 'Aband.' };
  if (/^(susp|int)/i.test(status)) return { state: 'suspended', label: 'Susp.' };
  if (/^\d+'/.test(status) || /^(ht|live|1h|2h)$/i.test(status)) {
    return { state: 'live', label: status.toUpperCase() };
  }
  if (!status && hasScore) return { state: 'finished', label: 'FIN' };

  return { state: 'other', label: status || '—' };
}

function scoreParts($, $match) {
  const box = $match.find('.mainResult[data-live-cell="score"]').first();
  return box
    .find('div')
    .map((_, el) => clean($(el).text()))
    .get()
    .filter((value) => /^\d+$/.test(value));
}

function parseMatch($, $match) {
  const href = $match.find('a[data-live-cell="matchlink"]').first().attr('href') || '';
  const dtParts = String($match.attr('data-dt') || '')
    .split(',')
    .map((part) => clean(part));

  if (dtParts.length < 5) return null;

  const [day, month, year, hour, minute] = dtParts;
  if (!/^\d{1,2}$/.test(hour) || !/^\d{1,2}$/.test(minute)) return null;

  const homeBox = $match.find('.table-main__participantHome').first();
  const awayBox = $match.find('.table-main__participantAway').first();
  const home = clean(homeBox.find('p').first().text());
  const away = clean(awayBox.find('p').first().text());
  if (!home || !away) return null;

  const homeLogo = absoluteUrl(
    homeBox.find('img').first().attr('data-src') || homeBox.find('img').first().attr('src'),
  );
  const awayLogo = absoluteUrl(
    awayBox.find('img').first().attr('data-src') || awayBox.find('img').first().attr('src'),
  );

  const scores = scoreParts($, $match);
  const homeScore = scores.length >= 2 ? Number(scores[0]) : null;
  const awayScore = scores.length >= 2 ? Number(scores[1]) : null;
  const hasScore = homeScore !== null && awayScore !== null;

  const oddElements = $match.find('.oddsColumn .table-main__odds');
  const odds = [0, 1, 2].map((index) => {
    const element = oddElements.eq(index);
    const raw = element.find('[data-odd]').first().attr('data-odd');
    const value = Number(raw);
    return Number.isFinite(value) && value > 1 ? value : null;
  });

  let highlight = -1;
  oddElements.each((index, element) => {
    if (highlight === -1 && $(element).hasClass('winner') && odds[index] !== null) {
      highlight = index;
    }
  });

  const rawStatus = $match.find('[data-live-cell="time"]').first().text();
  const status = normalizeStatus(rawStatus, hasScore);

  return {
    id: href || `${home}-${away}-${year}-${month}-${day}`,
    home,
    away,
    homeLogo,
    awayLogo,
    homeScore,
    awayScore,
    odds,
    highlight,
    state: status.state,
    status: status.label,
    time: `${pad(hour)}:${pad(minute)}`,
    date: `${year}-${pad(month)}-${pad(day)}`,
    url: absoluteUrl(href),
  };
}

export function parseFixtures(html, dateKey) {
  const $ = cheerio.load(html);
  const leagues = [];
  const leagueByKey = new Map();
  const seenMatches = new Set();

  $('ul.leagues-list').each((_, listElement) => {
    const $list = $(listElement);
    const nav = $list.find('li.table-main__tournamentNavLi').first();
    if (!nav.length) return;

    const link = nav.find('a[href^="/football/"]').first();
    const href = link.attr('href') || '';
    let fullName = clean(nav.find('.table-main__leaguesNames').first().text());
    if (!fullName) fullName = clean(link.attr('title'));
    if (!fullName) return;

    const flag = absoluteUrl(
      nav.find('img').first().attr('data-src') || nav.find('img').first().attr('src'),
    );
    const leagueKey = href || fullName.toLowerCase();

    let league = leagueByKey.get(leagueKey);
    if (!league) {
      const separator = fullName.indexOf(':');
      league = {
        key: leagueKey,
        name: fullName,
        country: separator > 0 ? fullName.slice(0, separator).trim() : '',
        flag,
        matches: [],
      };
      leagueByKey.set(leagueKey, league);
      leagues.push(league);
    }

    $list.find('ul.table-main__matchInfo').each((__, matchElement) => {
      const match = parseMatch($, $(matchElement));
      if (!match || seenMatches.has(match.id)) return;
      seenMatches.add(match.id);
      league.matches.push(match);
    });
  });

  const populated = leagues.filter((league) => league.matches.length > 0);
  const descriptions = new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const parsedDate = parseDateKey(dateKey);

  return {
    date: dateKey,
    dateLabel: parsedDate
      ? descriptions.format(new Date(Date.UTC(parsedDate.year, parsedDate.month - 1, parsedDate.day)))
      : dateKey,
    fetchedAt: new Date().toISOString(),
    source: `${BASE_URL}/?year=${parsedDate?.year || ''}&month=${parsedDate?.month || ''}&day=${
      parsedDate?.day || ''
    }`,
    totals: {
      leagues: populated.length,
      matches: populated.reduce((total, league) => total + league.matches.length, 0),
    },
    leagues: populated,
  };
}

async function fetchPage(date) {
  const url = new URL(BASE_URL);
  url.searchParams.set('year', date.year);
  url.searchParams.set('month', date.month);
  url.searchParams.set('day', date.day);

  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
          'Accept-Language': 'en-GB,en;q=0.9',
          Referer: `${BASE_URL}/`,
        },
        signal: AbortSignal.timeout(15000),
      });

      if (!response.ok) {
        throw new Error(`BetExplorer responded with HTTP ${response.status}`);
      }

      const html = await response.text();
      if (!html.includes('table-main__matchInfo')) {
        throw new Error('BetExplorer returned an unexpected page');
      }
      return html;
    } catch (error) {
      lastError = error;
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  throw lastError;
}

function cacheTtl(dateKey, todayKey) {
  return dateKey >= todayKey ? 3 * 60 * 1000 : 6 * 60 * 60 * 1000;
}

export async function getFixtures(dateKey) {
  const parsedDate = parseDateKey(dateKey);
  if (!parsedDate) {
    const error = new Error('Invalid date');
    error.statusCode = 400;
    throw error;
  }

  const cached = cache.get(dateKey);
  const todayKey = new Date().toISOString().slice(0, 10);

  if (cached && Date.now() - cached.timestamp < cacheTtl(dateKey, todayKey)) {
    return cached.data;
  }

  try {
    const html = await fetchPage(parsedDate);
    const data = parseFixtures(html, dateKey);

    cache.set(dateKey, { data, timestamp: Date.now() });
    if (cache.size > MAX_CACHE_ENTRIES) {
      const oldestKey = cache.keys().next().value;
      cache.delete(oldestKey);
    }
    return data;
  } catch (error) {
    if (cached) {
      return { ...cached.data, stale: true };
    }
    throw error;
  }
}

export const __test = { normalizeStatus, parseDateKey };
