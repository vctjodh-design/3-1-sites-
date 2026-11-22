'use strict';

const fixturesEl = document.getElementById('fixtures');
const listViewEl = document.getElementById('list-view');
const dateBtn = document.getElementById('date-btn');
const dateLabel = document.getElementById('date-label');
const prevBtn = document.getElementById('prev-day');
const nextBtn = document.getElementById('next-day');
const calendarEl = document.getElementById('calendar');
const calMonthEl = document.getElementById('cal-month');
const calGridEl = document.getElementById('cal-grid');
const calPrevBtn = document.getElementById('cal-prev');
const calNextBtn = document.getElementById('cal-next');
const calTodayBtn = document.getElementById('cal-today');

const detailViewEl = document.getElementById('detail-view');
const detailBodyEl = document.getElementById('detail-body');
const detailTitleEl = document.getElementById('detail-title');
const detailBackBtn = document.getElementById('detail-back');
const detailExternalLink = document.getElementById('detail-external');
const footTimeEl = document.getElementById('foot-time');

const MARKET_TABS = [
  ['1x2', '1X2'],
  ['ou', 'O/U'],
  ['ah', 'AH'],
  ['dnb', 'DNB'],
  ['dc', 'DC'],
  ['bts', 'BTTS'],
];
const MARKET_LABELS = Object.fromEntries(MARKET_TABS);

const state = {
  date: '',
  cache: new Map(),
  requestId: 0,
  calendarOpen: false,
  calMonth: null,
  collapsed: new Set(),
  matchCache: new Map(),
  detail: {
    open: false,
    url: '',
    league: '',
    statshubId: null,
    market: '1x2',
    data: null,
    oddsLoading: false,
    oddsError: null,
    line: null,
    tab: 'match',
    reportStage: 'match',
    commentFilter: 'all',
    commentsAll: false,
    offsetMinutes: 60,
    matrixSide: 'home',
    matrixStat: 'shots',
    matrixRange: 20,
    matrixVenue: 'both',
    matrixAll: false,
    lineupStat: { home: 'fouls', away: 'wasFouled' },
    heatSide: 'all',
    heatAll: false,
    h2hExpanded: false,
    standingsExpanded: false,
    returnScroll: 0,
    requestId: 0,
  },
};

const pad = (value) => String(value).padStart(2, '0');

function toKey(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function fromKey(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, month - 1, day, 12, 0, 0, 0);
}

function addDays(key, amount) {
  const date = fromKey(key);
  date.setDate(date.getDate() + amount);
  return toKey(date);
}

function todayKey() {
  return toKey(new Date());
}

function relativeLabel(key) {
  const today = todayKey();
  if (key === today) return 'Today';
  if (key === addDays(today, -1)) return 'Yesterday';
  if (key === addDays(today, 1)) return 'Tomorrow';
  return fromKey(key).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
}

function fullLabel(key) {
  return fromKey(key).toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return '&#39;';
    }
  });
}

function imageUrl(url) {
  return `/api/img?url=${encodeURIComponent(url)}`;
}

function updateDateControls() {
  const label = relativeLabel(state.date);
  dateLabel.textContent = label;
  dateBtn.setAttribute('aria-label', `Choose date, currently ${fullLabel(state.date)}`);
  document.title = `${label} · Football Fixtures`;
}

/* ---------- fixtures list ---------- */

function showSkeleton() {
  fixturesEl.setAttribute('aria-busy', 'true');
  const rows = Array.from(
    { length: 4 },
    () => `
      <div class="skel-row">
        <span class="sk sk-status"></span>
        <div class="sk-teams">
          <span class="sk sk-name"></span>
          <span class="sk sk-name short"></span>
        </div>
        <span class="sk sk-scores"></span>
        <div class="sk-odds">
          <span class="sk"></span><span class="sk"></span><span class="sk"></span>
        </div>
      </div>`,
  ).join('');

  fixturesEl.innerHTML = `
    <div class="skel" role="status" aria-label="Loading fixtures">
      <div class="skel-league"><span class="sk"></span></div>
      ${rows}
      <div class="skel-league"><span class="sk"></span></div>
      ${rows}
    </div>`;
}

function showError(message) {
  fixturesEl.setAttribute('aria-busy', 'false');
  fixturesEl.innerHTML = `
    <div class="state">
      <div class="state-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 8v5"/><path d="M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg>
      </div>
      <h2>Couldn&rsquo;t load fixtures</h2>
      <p>${escapeHtml(message)}</p>
      <button class="btn" type="button" data-action="retry">Try again</button>
    </div>`;
}

function showEmpty(data) {
  const sync = data?.sync;
  let message = 'There are no football fixtures listed for this date. Try another day.';
  if (sync && !sync.available) {
    message =
      sync.reason ||
      'StatsHub stats are unavailable, so fixtures cannot be matched across both sites.';
  } else if (sync && sync.error) {
    message = `${sync.error} Matches are only shown when both sites list the same fixture.`;
  } else if (sync && sync.betexplorerMatches > 0) {
    message = `BetExplorer lists ${sync.betexplorerMatches} match${
      sync.betexplorerMatches === 1 ? '' : 'es'
    } for this date, but none of them have a matching StatsHub fixture yet.`;
  }

  fixturesEl.setAttribute('aria-busy', 'false');
  fixturesEl.innerHTML = `
    <div class="state">
      <div class="state-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M8 3v4M16 3v4M3 10h18"/><path d="M9 15h6"/></svg>
      </div>
      <h2>No matched fixtures</h2>
      <p>${escapeHtml(message)}</p>
      <button class="btn" type="button" data-action="today">Go to today</button>
    </div>`;
}

function teamMarkup(name, logo, isWinner) {
  const image = logo
    ? `<img class="logo" src="${escapeHtml(imageUrl(logo))}" alt="" loading="lazy" decoding="async" />`
    : '<span class="logo" aria-hidden="true"></span>';

  return `
    <div class="team${isWinner ? ' is-winner' : ''}">
      ${image}
      <span class="team-name" title="${escapeHtml(name)}">${escapeHtml(name)}</span>
    </div>`;
}

function matchMarkup(match, leagueName) {
  const hasResult =
    (match.state === 'finished' || match.state === 'live') &&
    match.homeScore !== null &&
    match.awayScore !== null;
  const homeWon = hasResult && match.homeScore > match.awayScore;
  const awayWon = hasResult && match.awayScore > match.homeScore;

  let statusLabel = match.status;
  if (match.state === 'scheduled') statusLabel = match.time;
  if (!statusLabel) statusLabel = '—';

  const statusClasses = ['status'];
  if (match.state === 'live') statusClasses.push('is-live');
  if (['postponed', 'cancelled', 'abandoned', 'suspended'].includes(match.state)) {
    statusClasses.push('is-off');
  }

  const scoreMarkup = hasResult
    ? `<span>${match.homeScore}</span><span>${match.awayScore}</span>`
    : '<span></span><span></span>';

  const oddsMarkup = match.odds
    .map((odd, index) => {
      const classes = ['odd'];
      if (odd === null) classes.push('is-empty');
      if (index === match.highlight && odd !== null) classes.push('is-best');
      return `<span class="${classes.join(' ')}">${odd === null ? '–' : odd.toFixed(2)}</span>`;
    })
    .join('');

  const label = hasResult
    ? `${match.home} ${match.homeScore}-${match.awayScore} ${match.away}`
    : `${match.home} versus ${match.away}`;
  const matchUrl = match.url || '';
  const rowInner = `
      <div class="${statusClasses.join(' ')}">${escapeHtml(statusLabel)}</div>
      <div class="teams">
        ${teamMarkup(match.home, match.homeLogo, homeWon)}
        ${teamMarkup(match.away, match.awayLogo, awayWon)}
      </div>
      <div class="scores">${scoreMarkup}</div>
      <div class="odds">${oddsMarkup}</div>`;

  if (!matchUrl) {
    return `
    <div
      class="match is-static"
      data-league="${escapeHtml(leagueName || '')}"
      aria-label="${escapeHtml(label)}"
    >${rowInner}
    </div>`;
  }

  const shId = match.statshub?.id ? String(match.statshub.id) : '';
  const detailHref = `?date=${encodeURIComponent(state.date)}&match=${encodeURIComponent(
    matchUrl,
  )}${shId ? `&sh=${encodeURIComponent(shId)}` : ''}`;

  return `
    <a
      class="match"
      href="${escapeHtml(detailHref)}"
      data-match-url="${escapeHtml(matchUrl)}"
      data-sh-id="${escapeHtml(shId)}"
      data-league="${escapeHtml(leagueName || '')}"
      aria-label="${escapeHtml(label)}. Show match details"
    >${rowInner}
    </a>`;
}

function updateFooterSync(data) {
  if (!footTimeEl) return;
  const sync = data?.sync;
  if (!sync) return;

  if (!sync.available) {
    footTimeEl.textContent = 'StatsHub sync unavailable · showing no fixtures until both sites match.';
    return;
  }
  if (sync.error) {
    footTimeEl.textContent = 'StatsHub unavailable right now · matches cannot be verified.';
    return;
  }

  footTimeEl.textContent = `${sync.matched ?? 0} matches on both sites · odds from BetExplorer · times in ${sync.timezone.betexplorer}`;
}

function render(data) {
  state.collapsed.clear();
  fixturesEl.setAttribute('aria-busy', 'false');
  updateFooterSync(data);

  if (!data.leagues || data.leagues.length === 0) {
    showEmpty(data);
    return;
  }

  fixturesEl.innerHTML = data.leagues
    .map(
      (league) => `
        <section class="league" data-key="${escapeHtml(league.key)}">
          <button class="league-head" type="button" aria-expanded="true">
            ${
              league.flag
                ? `<img class="flag" src="${escapeHtml(imageUrl(league.flag))}" alt="" loading="lazy" decoding="async" />`
                : '<span class="flag flag-empty" aria-hidden="true"></span>'
            }
            <span class="league-name">${escapeHtml(league.name.toUpperCase())}</span>
            <svg class="chev" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 15 6-6 6 6"/></svg>
          </button>
          <div class="league-body">${league.matches
            .map((match) => matchMarkup(match, league.name))
            .join('')}</div>
        </section>`,
    )
    .join('');
}

async function setDate(key, options = {}) {
  const { updateUrl = true } = options;
  state.date = key;
  state.collapsed.clear();

  if (updateUrl) {
    const url = new URL(window.location.href);
    url.searchParams.set('date', key);
    window.history.replaceState(null, '', url);
  }

  updateDateControls();

  const cached = state.cache.get(key);
  if (cached) {
    render(cached.data);
  } else {
    showSkeleton();
  }

  const freshFor = key === todayKey() ? 60 * 1000 : 10 * 60 * 1000;
  if (cached && Date.now() - cached.timestamp < freshFor) return;

  const requestId = ++state.requestId;
  try {
    const response = await fetch(`/api/fixtures?date=${encodeURIComponent(key)}`, {
      headers: { Accept: 'application/json' },
    });
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error || `Request failed with status ${response.status}.`);
    }
    if (requestId !== state.requestId) return;

    state.cache.set(key, { data: payload, timestamp: Date.now() });
    render(payload);
  } catch (error) {
    if (requestId !== state.requestId) return;
    if (!cached) {
      showError(error.message || 'Please check your connection and try again.');
    }
  }
}

/* ---------- calendar ---------- */

function renderCalendar() {
  const monthStart = state.calMonth;
  calMonthEl.textContent = monthStart.toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  });

  const leadingBlanks = (monthStart.getDay() + 6) % 7;
  const daysInMonth = new Date(monthStart.getFullYear(), monthStart.getMonth() + 1, 0).getDate();
  const today = todayKey();

  let markup = '';
  for (let index = 0; index < leadingBlanks; index += 1) {
    markup += '<span class="cal-blank"></span>';
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = toKey(new Date(monthStart.getFullYear(), monthStart.getMonth(), day, 12));
    const classes = ['cal-day'];
    if (key === state.date) classes.push('is-selected');
    if (key === today) classes.push('is-today');
    const label = fromKey(key).toLocaleDateString('en-GB', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
    markup += `<button class="${classes.join(' ')}" type="button" data-date="${key}" aria-label="${escapeHtml(
      label,
    )}"${key === state.date ? ' aria-current="date"' : ''}>${day}</button>`;
  }

  calGridEl.innerHTML = markup;
}

function openCalendar() {
  state.calendarOpen = true;
  const selected = fromKey(state.date);
  state.calMonth = new Date(selected.getFullYear(), selected.getMonth(), 1, 12);
  renderCalendar();
  calendarEl.hidden = false;
  dateBtn.setAttribute('aria-expanded', 'true');
  requestAnimationFrame(() => {
    calGridEl.querySelector('.cal-day.is-selected')?.focus();
  });
}

function closeCalendar() {
  state.calendarOpen = false;
  calendarEl.hidden = true;
  dateBtn.setAttribute('aria-expanded', 'false');
}

function shiftMonth(amount) {
  state.calMonth = new Date(
    state.calMonth.getFullYear(),
    state.calMonth.getMonth() + amount,
    1,
    12,
  );
  renderCalendar();
}

/* ---------- match details ---------- */

function detailSkeleton() {
  return `
    <div class="detail-skel" role="status" aria-label="Loading match details">
      <span class="sk detail-skel-hero"></span>
      <span class="sk detail-skel-block"></span>
      <span class="sk detail-skel-block"></span>
      <span class="sk detail-skel-block short"></span>
    </div>`;
}

function detailError(message) {
  return `
    <div class="state detail-state">
      <div class="state-icon" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M12 8v5"/><path d="M12 16.5v.5"/><circle cx="12" cy="12" r="9"/></svg>
      </div>
      <h2>Couldn&rsquo;t load match details</h2>
      <p>${escapeHtml(message)}</p>
      <button class="btn" type="button" data-action="detail-retry">Try again</button>
    </div>`;
}

function heroLogoMarkup(logo) {
  return logo
    ? `<img class="hero-logo" src="${escapeHtml(imageUrl(logo))}" alt="" loading="lazy" decoding="async" />`
    : '<span class="hero-logo" aria-hidden="true"></span>';
}

function scorerMarkup(scorer) {
  return `<div class="scorer"><span class="scorer-minute">${escapeHtml(
    scorer.minute,
  )}</span><span>${escapeHtml(scorer.name)}</span></div>`;
}

function detailHero(data) {
  const match = data.match;
  const sh = data.statshub;
  const score = match.score ? `${match.score.home}:${match.score.away}` : 'vs';
  const note = match.partial || (match.status === 'Scheduled' ? 'Kick-off' : '');
  const statusPill =
    match.status === 'FIN'
      ? '<span class="hero-pill">FIN</span>'
      : match.status === 'LIVE'
        ? '<span class="hero-pill live">LIVE</span>'
        : '';
  const dateLine = [match.dateLabel, match.time].filter(Boolean).join(' - ');

  const homeScorers = match.scorers?.home || [];
  const awayScorers = match.scorers?.away || [];
  const scorers =
    homeScorers.length || awayScorers.length
      ? `<div class="hero-scorers">
          <div class="scorer-col home">${homeScorers.map(scorerMarkup).join('')}</div>
          <div class="scorer-col away">${awayScorers.map(scorerMarkup).join('')}</div>
        </div>`
      : '';

  return `
    <section class="match-hero">
      <div class="hero-date">${escapeHtml(dateLine)}${statusPill}</div>
      <div class="hero-top">
        <div class="hero-team">
          ${heroLogoMarkup(match.homeLogo)}
          <div class="hero-name">${escapeHtml(match.home)}</div>
        </div>
        <div class="hero-center">
          <div class="hero-score">${escapeHtml(score)}</div>
          ${note ? `<div class="hero-note">${escapeHtml(note)}</div>` : ''}
        </div>
        <div class="hero-team">
          ${heroLogoMarkup(match.awayLogo)}
          <div class="hero-name">${escapeHtml(match.away)}</div>
        </div>
      </div>
      ${scorers}
      ${
        sh && (sh.venue?.name || sh.referee?.name)
          ? `<div class="hero-meta">${escapeHtml(
              [sh.venue?.name, sh.referee?.name ? `Ref: ${sh.referee.name}` : null]
                .filter(Boolean)
                .join(' · '),
            )}</div>`
          : ''
      }
    </section>`;
}

function limitGroups(groups, limit) {
  const result = [];
  let remaining = limit;
  for (const group of groups) {
    if (remaining <= 0) break;
    const matches = group.matches.slice(0, remaining);
    if (matches.length) result.push({ ...group, matches });
    remaining -= matches.length;
  }
  return result;
}

function meetingMarkup(match) {
  const homeWon = match.homeScore > match.awayScore;
  const awayWon = match.awayScore > match.homeScore;
  return `
    <div class="meeting">
      <span class="meeting-date">${escapeHtml(match.date)}</span>
      <span class="meeting-team home${homeWon ? ' won' : ''}" title="${escapeHtml(
        match.home,
      )}">${escapeHtml(match.home)}</span>
      <span class="meeting-score">${match.homeScore}-${match.awayScore}</span>
      <span class="meeting-team away${awayWon ? ' won' : ''}" title="${escapeHtml(
        match.away,
      )}">${escapeHtml(match.away)}</span>
    </div>`;
}

function detailH2H(data) {
  const h2h = data.h2h;
  if (!h2h || !h2h.groups.length) return '';

  const summary = h2h.summary;
  const total = summary.total || 0;
  const percent = (value) => (total ? Math.round((value / total) * 100) : 0);
  const percentages = {
    win: percent(summary.wins),
    draw: percent(summary.draws),
    loss: percent(summary.losses),
  };

  const groups = state.detail.h2hExpanded
    ? h2h.groups
    : limitGroups(h2h.groups, 6);

  const meetings = groups
    .map(
      (group) => `
        <div class="h2h-group">${escapeHtml(group.title.toUpperCase())}</div>
        ${group.matches.map(meetingMarkup).join('')}`,
    )
    .join('');

  const toggle =
    h2h.totalMeetings > 6
      ? `<button class="show-more" type="button" data-action="h2h-all">${
          state.detail.h2hExpanded
            ? 'Show last 6 meetings'
            : `Show all ${h2h.totalMeetings} meetings`
        }</button>`
      : '';

  const smallLogo = (logo) =>
    logo
      ? `<img src="${escapeHtml(imageUrl(logo))}" alt="" loading="lazy" decoding="async" />`
      : '';

  return `
    <section class="detail-section">
      <div class="section-head">
        <h2>Head to Head</h2>
        <span class="section-sub">Last ${total || 6}</span>
      </div>
      <div class="h2h-teams">
        <div class="h2h-team">${smallLogo(data.match.homeLogo)}<span>${escapeHtml(
          data.match.home,
        )}</span></div>
        <div class="h2h-team away"><span>${escapeHtml(
          data.match.away,
        )}</span>${smallLogo(data.match.awayLogo)}</div>
      </div>
      <div class="h2h-record">
        <span><i class="dot win"></i><b>${summary.wins}</b> wins</span>
        <span><i class="dot draw"></i><b>${summary.draws}</b> draw${
          summary.draws === 1 ? '' : 's'
        }</span>
        <span><i class="dot loss"></i><b>${summary.losses}</b> wins</span>
      </div>
      <div class="h2h-bar">
        <span class="win" style="width:${percentages.win}%">${
          percentages.win >= 16 ? `${percentages.win}%` : ''
        }</span>
        <span class="draw" style="width:${percentages.draw}%">${
          percentages.draw >= 16 ? `${percentages.draw}%` : ''
        }</span>
        <span class="loss" style="width:${percentages.loss}%">${
          percentages.loss >= 16 ? `${percentages.loss}%` : ''
        }</span>
      </div>
      <div class="h2h-list">${meetings}</div>
      ${toggle}
    </section>`;
}

function detailStandings(data) {
  const standings = data.standings;
  if (!standings || !standings.rows.length) return '';

  const rows = standings.rows;
  const featured = rows.filter((row) => row.isHome || row.isAway);
  const showAll = state.detail.standingsExpanded || featured.length < 2;
  const visible = showAll ? rows : featured;

  const head = `
    <div class="standings-row head">
      <span>#</span><span>Team</span>
      <span class="standings-num">P</span>
      <span class="standings-num">GD</span>
      <span class="standings-num">Pts</span>
      <span>Form</span>
    </div>`;

  const body = visible
    .map(
      (row) => `
        <div class="standings-row${row.isHome || row.isAway ? ' is-match' : ''}">
          <span class="standings-rank">${row.rank ?? ''}</span>
          <span class="standings-team">
            ${
              row.logo
                ? `<img src="${escapeHtml(imageUrl(row.logo))}" alt="" loading="lazy" decoding="async" />`
                : ''
            }
            <span title="${escapeHtml(row.team)}">${escapeHtml(row.team)}</span>
          </span>
          <span class="standings-num">${escapeHtml(row.played)}</span>
          <span class="standings-num">${escapeHtml(row.goalDifference)}</span>
          <span class="standings-num">${escapeHtml(row.points)}</span>
          <span class="form">${row.form
            .map(
              (result) =>
                `<i class="${result}" title="${
                  result === 'w' ? 'Win' : result === 'd' ? 'Draw' : 'Loss'
                }"></i>`,
            )
            .join('')}</span>
        </div>`,
    )
    .join('');

  const toggle =
    rows.length > 2
      ? `<button class="show-more" type="button" data-action="standings-all">${
          showAll ? 'Show match teams only' : `Show full table (${rows.length})`
        }</button>`
      : '';

  return `
    <section class="detail-section">
      <div class="section-head">
        <h2>Standings</h2>
        <span class="section-sub">${escapeHtml(data.match.league)}</span>
      </div>
      <div class="standings-table">${head}${body}</div>
      ${toggle}
    </section>`;
}

function oddsTableMarkup(odds) {
  const lines = odds.lines || [];
  let activeLine = lines[0];

  if (odds.hasLines && lines.length) {
    let selected = state.detail.line;
    const preferred =
      lines.find((line) => line.line === '2.5') ||
      lines.reduce((best, line) => (!best || line.rows.length > best.rows.length ? line : best), null);

    if (!selected || !lines.some((line) => line.line === selected)) {
      selected = preferred?.line ?? lines[0].line;
      state.detail.line = selected;
    }
    activeLine = lines.find((line) => line.line === selected) || lines[0];
  }

  const rows = activeLine?.rows || [];
  if (!rows.length) return '<div class="odds-empty">No odds available for this market.</div>';

  const columns = (odds.columns || ['1', 'X', '2']).slice(0, 4);
  const lineTabs = odds.hasLines
    ? `<div class="odds-line-tabs">${lines
        .map(
          (line) =>
            `<button class="odds-line${
              line.line === state.detail.line ? ' is-active' : ''
            }" type="button" data-line="${escapeHtml(line.line)}">${escapeHtml(line.line)}</button>`,
        )
        .join('')}</div>`
    : '';

  const head = `
    <div class="odds-row head" style="--cols:${columns.length}">
      <span class="odds-bookmaker">Bookmaker</span>
      ${columns.map((column) => `<span>${escapeHtml(column)}</span>`).join('')}
    </div>`;

  const body = rows
    .slice(0, 40)
    .map((row) => {
      const cells = columns
        .map((_, index) => {
          const cell = row.odds[index];
          if (!cell) return '<span class="odd-cell">–</span>';
          const movement =
            cell.movement === 'up'
              ? '<span class="move up" aria-label="odds moved up">↑</span>'
              : cell.movement === 'down'
                ? '<span class="move down" aria-label="odds moved down">↓</span>'
                : '';
          return `<span class="odd-cell${cell.best ? ' is-best' : ''}">${cell.value.toFixed(
            2,
          )}${movement}</span>`;
        })
        .join('');

      return `
        <div class="odds-row" style="--cols:${columns.length}">
          <span class="odds-bookmaker" title="${escapeHtml(row.bookmaker)}">${escapeHtml(
            row.bookmaker,
          )}</span>
          ${cells}
        </div>`;
    })
    .join('');

  return `
    ${lineTabs}
    <div class="odds-table">${head}${body}</div>
    <div class="odds-note">Best odds highlighted · arrows show odds movement</div>`;
}

function detailOdds(data) {
  const market = state.detail.market;
  const tabs = MARKET_TABS.map(
    ([key, label]) =>
      `<button type="button" class="market-tab${key === market ? ' is-active' : ''}" data-market="${key}" aria-pressed="${key === market}">${label}</button>`,
  ).join('');

  let content;
  if (state.detail.oddsLoading) {
    content = '<div class="odds-empty">Updating odds…</div>';
  } else if (state.detail.oddsError) {
    content = `<div class="odds-empty">Couldn&rsquo;t load odds. <button type="button" class="link-btn" data-action="odds-retry">Retry</button></div>`;
  } else if (!data.odds) {
    content = '<div class="odds-empty">No odds available for this market.</div>';
  } else {
    content = oddsTableMarkup(data.odds);
  }

  return `
    <section class="detail-section" id="odds-section">
      <div class="section-head">
        <h2>Odds Comparison</h2>
        <span class="section-sub">${escapeHtml(MARKET_LABELS[market] || '')}</span>
      </div>
      <div class="market-tabs" role="group" aria-label="Odds market">${tabs}</div>
      ${content}
    </section>`;
}

/* ---------- StatsHub sections ---------- */

const DETAIL_TABS = [
  ['match', 'Match'],
  ['report', 'Report'],
  ['players', 'Players'],
  ['teams', 'Teams'],
  ['lineups', 'Lineups'],
  ['heatmaps', 'Heatmaps'],
  ['h2h', 'H2H'],
  ['odds', 'Odds'],
];

const MATRIX_STATS = [
  ['shots', 'Shots'],
  ['onTargetScoringAttempt', 'Shots on target'],
  ['goals', 'Goals'],
  ['goalAssist', 'Assists'],
  ['scoredOrAssisted', 'Scored or assisted'],
  ['expectedGoals', 'Expected goals (xG)'],
  ['expectedAssists', 'Expected assists (xA)'],
  ['xGxA', 'xG + xA'],
  ['totalPass', 'Passes'],
  ['accuratePass', 'Accurate passes'],
  ['totalCross', 'Crosses'],
  ['accurateCross', 'Accurate crosses'],
  ['possessionLostCtrl', 'Possession lost'],
  ['dispossessed', 'Dispossessed'],
  ['fouls', 'Fouls committed'],
  ['wasFouled', 'Fouls won'],
  ['foulInvolvements', 'Foul involvements'],
  ['interceptionWon', 'Interceptions won'],
  ['totalTackle', 'Tackles'],
  ['duelWon', 'Duels won'],
  ['aerialWon', 'Aerials won'],
  ['fouls', 'Fouls'],
  ['foulInvolvements', 'Foul involvements'],
  ['yellowCard', 'Yellow cards'],
  ['redCard', 'Red cards'],
  ['totalOffside', 'Offsides'],
  ['saves', 'Saves'],
  ['touches', 'Touches'],
  ['keyPass', 'Key passes'],
  ['bigChanceCreated', 'Big chances created'],
  ['totalClearance', 'Clearances'],
  ['blockedScoringAttempt', 'Blocked shots'],
  ['shotOffTarget', 'Shots off target'],
  ['minutesPlayed', 'Minutes'],
  ['rating', 'Rating'],
];

const LINEUP_STATS = [
  ['fouls', 'Fouls committed'],
  ['wasFouled', 'Fouls won'],
  ['totalTackle', 'Tackles'],
  ['keyPass', 'Key passes'],
  ['shots', 'Shots'],
  ['onTargetScoringAttempt', 'Shots on target'],
  ['foulInvolvements', 'Foul involvements'],
  ['goals', 'Goals'],
  ['goalAssist', 'Assists'],
  ['scoredOrAssisted', 'Scored or assisted'],
  ['totalPass', 'Passes'],
  ['dispossessed', 'Dispossessed'],
  ['yellowCard', 'Yellow cards'],
  ['rating', 'Rating'],
  ['expectedGoals', 'Expected goals (xG)'],
  ['expectedAssists', 'Expected assists (xA)'],
];

const LOWER_IS_BETTER = new Set([
  'possessionLostCtrl',
  'dispossessed',
  'fouls',
  'foulInvolvements',
  'yellowCard',
  'redCard',
  'totalOffside',
]);

function offsetLabel(minutes) {
  if (!Number.isFinite(minutes) || minutes === 0) return 'UTC';
  const sign = minutes > 0 ? '+' : '-';
  const absolute = Math.abs(minutes);
  const hours = Math.floor(absolute / 60);
  const rest = absolute % 60;
  return `UTC${sign}${hours}${rest ? `:${String(rest).padStart(2, '0')}` : ''}`;
}

/** StatsHub timestamps are UTC; shift them into the timezone BetExplorer lists. */
function shiftedDate(epoch) {
  if (!epoch) return { date: '', time: '' };
  const offset = Number.isFinite(state.detail.offsetMinutes) ? state.detail.offsetMinutes : 60;
  const shifted = new Date((Number(epoch) + offset * 60) * 1000);
  return {
    date: `${pad(shifted.getUTCDate())}/${pad(shifted.getUTCMonth() + 1)}`,
    time: `${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}`,
  };
}

function statText(value, suffix = '') {
  if (value === null || value === undefined || value === '') return '–';
  const number = Number(value);
  if (!Number.isFinite(number)) return escapeHtml(value);
  const text = Number.isInteger(number)
    ? String(number)
    : number.toFixed(2).replace(/0$/, '');
  return suffix === '%' ? `${text}%` : text;
}

function detailTabs(data) {
  const tabs = DETAIL_TABS.filter(
    ([key]) => data.statshub || ['match', 'report', 'h2h', 'odds'].includes(key),
  );
  const active = tabs.some(([key]) => key === state.detail.tab) ? state.detail.tab : 'match';
  state.detail.tab = active;

  return `
    <div class="detail-tabs" role="tablist" aria-label="Match detail sections">
      ${tabs
        .map(
          ([key, label]) =>
            `<button class="detail-tab${key === active ? ' is-active' : ''}" type="button" role="tab" aria-selected="${
              key === active
            }" data-tab="${key}">${label}</button>`,
        )
        .join('')}
    </div>`;
}

function infoRows(sh) {
  const rows = [];
  if (sh.competition?.name) rows.push(['Competition', sh.competition.name]);
  const kickoff = shiftedDate(sh.kickoff);
  if (kickoff.time)
    rows.push(['Kick-off', `${kickoff.date} · ${kickoff.time} ${offsetLabel(state.detail.offsetMinutes)}`]);
  if (sh.venue?.name)
    rows.push(['Venue', [sh.venue.name, sh.venue.city].filter(Boolean).join(', ')]);
  if (sh.referee?.name)
    rows.push([
      'Referee',
      `${sh.referee.name}${
        sh.referee.averageCards ? ` · ${sh.referee.averageCards} cards/game` : ''
      }`,
    ]);

  return `<div class="info-grid">${rows
    .map(
      ([label, value]) =>
        `<div class="info-row"><span>${escapeHtml(label)}</span><b>${escapeHtml(
          value,
        )}</b></div>`,
    )
    .join('')}</div>`;
}

function formChips(form) {
  const matches = (form?.matches || []).slice(0, 5).reverse();
  if (!matches.length) return '';
  return `<span class="form-chips">${matches
    .map((match) => {
      const result = (match.result || '?').toUpperCase();
      const label = `${match.isHome ? 'vs' : 'at'} ${match.opponent} ${match.score.home}-${
        match.score.away
      }`;
      return `<i class="form-chip ${match.result || ''}" title="${escapeHtml(
        label,
      )}">${result}</i>`;
    })
    .join('')}</span>`;
}

function matchStatsRows(sh) {
  const metrics = sh.matchStats?.metrics || [];
  if (!metrics.length) {
    return '<p class="section-note">StatsHub has no team stats for this fixture yet. They usually appear around kick-off.</p>';
  }

  return `<div class="ms-table">${metrics
    .map((metric) => {
      const home = metric.home ?? 0;
      const away = metric.away ?? 0;
      const total = Math.abs(home) + Math.abs(away);
      const homeWidth = total ? Math.round((Math.abs(home) / total) * 100) : 50;
      return `
        <div class="ms-row">
          <span class="ms-val${home >= away ? ' is-strong' : ''}">${statText(
            metric.home,
            metric.suffix,
          )}</span>
          <div class="ms-mid">
            <span class="ms-label">${escapeHtml(metric.label)}</span>
            <div class="ms-bar"><span class="ms-home" style="width:${homeWidth}%"></span></div>
          </div>
          <span class="ms-val away${away >= home ? ' is-strong' : ''}">${statText(
            metric.away,
            metric.suffix,
          )}</span>
        </div>`;
    })
    .join('')}</div>`;
}

function squadRows(squad) {
  if (!squad.length) return '';
  return `
    <div class="squad-row head">
      <span>Player</span><span>Min</span><span>G</span><span>A</span><span>Sh</span><span>Rt</span>
    </div>
    ${squad
      .map(
        (player) => `
      <div class="squad-row">
        <span class="sq-name">
          ${playerPhoto(player, 'sq-photo')}
          <span class="sq-text">
            <b>${escapeHtml(player.shortName)}</b>
            <em>${escapeHtml(player.position)}${player.started ? '' : ' · sub'}</em>
            <small>${player.season.appearances ?? 0} apps · ${
              player.season.goals ?? 0
            } goals · ${statText(player.season.rating)} avg</small>
          </span>
        </span>
        <span class="sq-num">${player.minutes ?? '–'}</span>
        <span class="sq-num">${player.goals ?? 0}</span>
        <span class="sq-num">${player.assists ?? 0}</span>
        <span class="sq-num">${player.shots ?? 0}</span>
        <span class="sq-num">${statText(player.rating)}</span>
      </div>`,
      )
      .join('')}`;
}

function beLogo(data, side) {
  return side === 'home' ? data.match.homeLogo : data.match.awayLogo;
}

function playerPhoto(player, className) {
  if (player?.image) {
    return `<img class="${className}" src="${escapeHtml(imageUrl(player.image))}" alt="" loading="lazy" decoding="async" />`;
  }
  const initials = String(player?.name || '')
    .split(' ')
    .map((part) => part[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('');
  return `<span class="${className} is-empty">${escapeHtml(initials)}</span>`;
}

function matrixValue(player, matchId, stat) {
  const row = player.stats?.[String(matchId)] ?? player.stats?.[matchId];
  if (!row) return null;
  const value = row[stat];
  if (value === undefined || value === null || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function matrixText(value, stat) {
  if (value === null || value === undefined) return '–';
  if (stat === 'rating') return value > 0 ? value.toFixed(1) : '–';
  if (stat === 'expectedGoals' || stat === 'expectedAssists' || stat === 'xGxA') {
    return value.toFixed(2);
  }
  if (stat === 'yellowCard' || stat === 'redCard') return value > 0 ? String(value) : '·';
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function matrixSummary(player, matches, stat) {
  let total = 0;
  let games = 0;
  let minutes = 0;
  for (const match of matches) {
    const row = player.stats?.[String(match.id)];
    if (!row) continue;
    const played = Number(row.minutesPlayed) || 0;
    minutes += played;
    if (played <= 0) continue;
    const value = Number(row[stat]);
    if (!Number.isFinite(value)) continue;
    total += value;
    games += 1;
  }
  return {
    avg: games ? total / games : null,
    p90: minutes > 0 ? (total / minutes) * 90 : null,
  };
}

function heatStyle(value, max, stat) {
  if (!Number.isFinite(value) || value <= 0 || !max) return '';
  const alpha = (0.07 + Math.min(1, value / max) * 0.3).toFixed(2);
  return LOWER_IS_BETTER.has(stat)
    ? `background:rgba(246,196,140,${alpha})`
    : `background:rgba(103,199,150,${alpha})`;
}

function matrixControls(data) {
  const sh = data.statshub;
  const side = state.detail.matrixSide;
  const teams = ['home', 'away']
    .map((key) => {
      const team = key === 'home' ? sh.homeTeam : sh.awayTeam;
      const logo = beLogo(data, key);
      return `<button class="mx-team${side === key ? ' is-active' : ''}" type="button" data-matrix-side="${key}">
        ${logo ? `<img src="${escapeHtml(imageUrl(logo))}" alt="" loading="lazy" />` : ''}
        <span>${escapeHtml(team.shortName || team.name)}</span>
      </button>`;
    })
    .join('');

  const statOptions = MATRIX_STATS.map(
    ([key, label]) =>
      `<option value="${key}"${key === state.detail.matrixStat ? ' selected' : ''}>${label}</option>`,
  ).join('');
  const rangeOptions = [5, 10, 15, 20]
    .map(
      (value) =>
        `<option value="${value}"${value === state.detail.matrixRange ? ' selected' : ''}>Last ${value} games</option>`,
    )
    .join('');

  const venues = [
    ['both', 'Home + Away'],
    ['home', 'Home'],
    ['away', 'Away'],
  ]
    .map(
      ([key, label]) =>
        `<button class="mx-venue${state.detail.matrixVenue === key ? ' is-active' : ''}" type="button" data-matrix-venue="${key}">${label}</button>`,
    )
    .join('');

  return `
    <div class="mx-controls">
      <div class="mx-teams">${teams}</div>
      <div class="mx-selects">
        <label><span>Stat</span><select data-matrix-stat>${statOptions}</select></label>
        <label><span>Range</span><select data-matrix-range>${rangeOptions}</select></label>
      </div>
      <div class="mx-venues">${venues}</div>
    </div>`;
}

function playerMatrix(data, side) {
  const sh = data.statshub;
  const matrix = sh.matrices?.[side];
  const team = side === 'home' ? sh.homeTeam : sh.awayTeam;
  const venue = state.detail.matrixVenue;
  const allMatches = matrix?.matches || [];
  const venueMatches =
    venue === 'home'
      ? allMatches.filter((match) => match.isHome)
      : venue === 'away'
        ? allMatches.filter((match) => !match.isHome)
        : allMatches;
  const matches = venueMatches.slice(0, state.detail.matrixRange);
  const players = matrix?.players || [];
  if (!matches.length || !players.length) {
    return '<p class="section-note">StatsHub has no per-game player data for this team yet.</p>';
  }

  const stat = state.detail.matrixStat;
  const visible = state.detail.matrixAll ? players : players.slice(0, 20);
  const max = Math.max(
    0,
    ...players.flatMap((player) => matches.map((match) => matrixValue(player, match.id, stat) || 0)),
  );
  const logo = beLogo(data, side);

  return `
    <div class="matrix-scroll mx-scroll">
      <div class="mx-table" style="--games:${matches.length}">
        <div class="mx-row mx-head">
          <span class="mx-name">
            ${logo ? `<img src="${escapeHtml(imageUrl(logo))}" alt="" loading="lazy" />` : ''}
            <b>${escapeHtml(team.shortName || team.name)}</b>
          </span>
          <span class="mx-stat">Avg</span>
          <span class="mx-stat">${
            stat === 'minutesPlayed' || stat === 'rating' ? '–' : 'P90'
          }</span>
          ${matches
            .map(
              (match) => `
            <span class="mx-game">
              <b>${escapeHtml(match.opponent)}</b>
              <em>${shiftedDate(match.kickoff).date}</em>
              <i class="${match.result || ''}">${(match.result || '').toUpperCase()}</i>
            </span>`,
            )
            .join('')}
        </div>
        ${visible
          .map((player) => {
            const summary = matrixSummary(player, matches, stat);
            return `
          <div class="mx-row">
            <span class="mx-name">
              ${playerPhoto(player, 'mx-photo')}
              <span class="mx-player">
                <b>${escapeHtml(player.name)}</b>
                <em>${escapeHtml(player.position)}</em>
              </span>
            </span>
            <span class="mx-stat is-avg">${matrixText(summary.avg, stat)}</span>
            <span class="mx-stat">${
              stat === 'minutesPlayed' || stat === 'rating' ? '–' : matrixText(summary.p90, stat)
            }</span>
            ${matches
              .map((match) => {
                const row = player.stats?.[String(match.id)];
                const minutes = Number(row?.minutesPlayed) || 0;
                const value = matrixValue(player, match.id, stat);
                if (!row) return '<span class="mx-cell is-empty">–</span>';
                if (minutes <= 0 && stat !== 'minutesPlayed') {
                  return '<span class="mx-cell is-bench">B</span>';
                }
                return `<span class="mx-cell" style="${heatStyle(value, max, stat)}">${matrixText(
                  value,
                  stat,
                )}</span>`;
              })
              .join('')}
          </div>`;
          })
          .join('')}
      </div>
    </div>
    ${
      players.length > 20
        ? `<button class="show-more" type="button" data-action="matrix-all">${
            state.detail.matrixAll ? 'Show fewer players' : `Show all ${players.length} players`
          }</button>`
        : ''
    }`;
}

function detailMatchTab(data) {
  const sh = data.statshub;
  if (!sh) {
    return `
      <section class="detail-section">
        <div class="section-head"><h2>Match stats</h2><span class="section-sub">StatsHub</span></div>
        <p class="section-note">${escapeHtml(
          data.statshubStatus?.reason || 'StatsHub stats are not available for this match.',
        )}</p>
      </section>`;
  }

  return `
    <section class="detail-section">
      <div class="section-head"><h2>Match stats</h2><span class="section-sub">This match · StatsHub</span></div>
      <div class="ms-teamline">
        <span>${escapeHtml(sh.homeTeam.shortName || sh.homeTeam.name)}</span>
        <span>${escapeHtml(sh.awayTeam.shortName || sh.awayTeam.name)}</span>
      </div>
      ${matchStatsRows(sh)}
      ${infoRows(sh)}
    </section>
    <section class="detail-section">
      <div class="section-head"><h2>Recent form</h2><span class="section-sub">Oldest to newest</span></div>
      <div class="form-row">
        <span class="form-team">${escapeHtml(sh.homeTeam.shortName || sh.homeTeam.name)}</span>
        ${formChips(sh.form?.home)}
      </div>
      <div class="form-row">
        <span class="form-team">${escapeHtml(sh.awayTeam.shortName || sh.awayTeam.name)}</span>
        ${formChips(sh.form?.away)}
      </div>
    </section>`;
}

/* ---------- post-match report (BetExplorer + StatsHub + Soccerway) ---------- */

function marketLine(odds) {
  if (!odds?.lines?.length) return null;
  if (!odds.hasLines) return odds.lines[0];
  const preferred = odds.lines.find((line) => String(line.line) === '2.5');
  return preferred || odds.lines[Math.floor(odds.lines.length / 2)] || odds.lines[0];
}

function bestPrice(odds, column) {
  const line = odds ? marketLine(odds) : null;
  if (!line) return null;
  const index = (odds.columns || []).indexOf(column);
  if (index === -1) return null;
  let best = null;
  for (const row of line.rows || []) {
    const value = Number(row.odds?.[index]?.value);
    if (!Number.isFinite(value) || value <= 1) continue;
    if (!best || value > best.value) best = { value, bookmaker: row.bookmaker };
  }
  return best;
}

function oddsText(price) {
  if (!price) return '–';
  return `${price.value.toFixed(2)} · ${Math.round(100 / price.value)}%`;
}

function reportOutcome(data) {
  const match = data.match || {};
  const sw = data.soccerway;
  const score = match.score;
  const halves = sw?.halves || [];
  const first = halves[0];
  const total = score ? score.home + score.away : (sw?.goals || []).length;
  const btts = score ? score.home > 0 && score.away > 0 : null;
  const result = score ? (score.home > score.away ? '1' : score.home === score.away ? 'X' : '2') : null;
  return {
    score,
    first,
    total,
    btts,
    result,
    finished: match.status === 'FIN' || Boolean(sw?.hasEvents),
  };
}

function reportSideName(data, side) {
  const team = side === 'home' ? data.statshub?.homeTeam || null : data.statshub?.awayTeam || null;
  const name = side === 'home' ? data.match?.home : data.match?.away;
  return team?.shortName || team?.name || name || '';
}

function reportHero(data) {
  const { score, first, total, btts, result } = reportOutcome(data);
  const home = reportSideName(data, 'home');
  const away = reportSideName(data, 'away');
  const logo = (side) => {
    const src = beLogo(data, side);
    return src
      ? `<img src="${escapeHtml(imageUrl(src))}" alt="" loading="lazy" />`
      : '<span class="rp-logo-fallback"></span>';
  };

  if (!score) {
    return `<section class="detail-section">
      <div class="section-head"><h2>Match report</h2><span class="section-sub">Soccerway</span></div>
      <p class="section-note">This match has not kicked off yet, so there are no events or commentary. The pre-match dossier is below.</p>
    </section>`;
  }

  const chips = [
    first ? `HT ${first.home}-${first.away}` : null,
    `${total} goal${total === 1 ? '' : 's'}`,
    btts === null ? null : btts ? 'BTTS yes' : 'BTTS no',
    result ? (result === '1' ? `${home} win` : result === '2' ? `${away} win` : 'Draw') : null,
  ].filter(Boolean);

  const statusLabel =
    data.match.status === 'FIN' ? 'Full-time' : data.match.status === 'LIVE' ? 'Live' : 'Scheduled';

  return `<section class="detail-section rp-hero">
    <div class="section-head"><h2>Match report</h2><span class="section-sub">${statusLabel} · Soccerway</span></div>
    <div class="rp-scoreline">
      <span class="rp-team">${logo('home')}<b>${escapeHtml(home)}</b></span>
      <span class="rp-score">${score.home}<i>:</i>${score.away}</span>
      <span class="rp-team away"><b>${escapeHtml(away)}</b>${logo('away')}</span>
    </div>
    <div class="rp-chips">${chips
      .map((chip) => `<span class="rp-chip">${escapeHtml(chip)}</span>`)
      .join('')}</div>
    <p class="rp-source">Score and half split · Soccerway</p>
  </section>`;
}

function reportMarkets(data) {
  const prematch = data.prematch;
  const { total, btts, result } = reportOutcome(data);
  if (!prematch) return '';

  const one = prematch['1x2'];
  const ou = prematch.ou;
  const bts = prematch.bts;
  const line = marketLine(ou)?.line;
  const rows = [];

  if (one) {
    for (const [column, label] of [
      ['1', reportSideName(data, 'home')],
      ['X', 'Draw'],
      ['2', reportSideName(data, 'away')],
    ]) {
      const price = bestPrice(one, column);
      if (!price) continue;
      rows.push({
        market: '1X2',
        selection: label,
        price,
        hit: result === column,
      });
    }
  }

  if (ou) {
    for (const column of ['Over', 'Under']) {
      const price = bestPrice(ou, column);
      if (!price) continue;
      const numeric = Number(line);
      const hit =
        Number.isFinite(numeric) && total > 0
          ? column === 'Over'
            ? total > numeric
            : total < numeric
          : null;
      rows.push({
        market: `O/U ${line ?? ''}`.trim(),
        selection: column,
        price,
        hit,
      });
    }
  }

  if (bts) {
    for (const column of ['Yes', 'No']) {
      const price = bestPrice(bts, column);
      if (!price) continue;
      rows.push({
        market: 'BTTS',
        selection: column,
        price,
        hit: btts === null ? null : column === 'Yes' ? btts : !btts,
      });
    }
  }

  if (!rows.length) return '';

  const title = data.match?.score ? 'Pre-match odds vs outcome' : 'Pre-match odds';

  return `<section class="detail-section">
    <div class="section-head"><h2>${title}</h2><span class="section-sub">BetExplorer · best price</span></div>
    <div class="rp-market">
      <div class="rp-market-row head"><span>Market</span><span>Selection</span><span>Best</span><span>Result</span></div>
      ${rows
        .map(
          (row) => `<div class="rp-market-row${row.hit ? ' is-hit' : ''}">
            <span>${escapeHtml(row.market)}</span>
            <span>${escapeHtml(row.selection)}</span>
            <span class="rp-price">${escapeHtml(oddsText(row.price))}</span>
            <span class="rp-hit">${row.hit === null ? '—' : row.hit ? 'hit' : 'miss'}</span>
          </div>`,
        )
        .join('')}
    </div>
  </section>`;
}
