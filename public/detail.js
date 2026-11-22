function detailPlayersTab(data) {
  const sh = data.statshub;
  if (!sh) {
    return `
      <section class="detail-section">
        <div class="section-head"><h2>Players</h2><span class="section-sub">StatsHub</span></div>
        <p class="section-note">Player stats need a StatsHub fixture for this match.</p>
      </section>`;
  }

  const side = state.detail.matrixSide;
  const matrix = sh.matrices?.[side];
  const gameCount = matrix?.matches?.length || 0;

  const homeSquad = sh.squads?.home || [];
  const awaySquad = sh.squads?.away || [];
  const squadBlock =
    homeSquad.length || awaySquad.length
      ? `
      <div class="squad-head">
        ${beLogo(data, 'home') ? `<img src="${escapeHtml(imageUrl(beLogo(data, 'home')))}" alt="" loading="lazy" />` : ''}
        <b>${escapeHtml(sh.homeTeam.name)}</b>
      </div>
      ${squadRows(homeSquad)}
      <div class="squad-head">
        ${beLogo(data, 'away') ? `<img src="${escapeHtml(imageUrl(beLogo(data, 'away')))}" alt="" loading="lazy" />` : ''}
        <b>${escapeHtml(sh.awayTeam.name)}</b>
      </div>
      ${squadRows(awaySquad)}`
      : '<p class="section-note">Per-player match ratings are not available for this match yet.</p>';

  return `
    <section class="detail-section">
      <div class="section-head"><h2>Player stats</h2><span class="section-sub">Last ${gameCount} games · StatsHub</span></div>
      ${matrixControls(data)}
      ${playerMatrix(data, side)}
    </section>
    <section class="detail-section">
      <div class="section-head"><h2>Match ratings</h2><span class="section-sub">This match</span></div>
      ${squadBlock}
    </section>`;
}

function lineupGroup(position) {
  const code = String(position || '').toUpperCase();
  if (code === 'G' || code === 'GK') return 'GK';
  if (code.includes('B') || code.startsWith('D') || code.startsWith('SW')) return 'D';
  if (code.includes('M')) return 'M';
  return 'F';
}

function lineupStatValue(playerId, matrix, stat, count = 5) {
  const player = (matrix?.players || []).find((row) => String(row.id) === String(playerId));
  const cells = [];
  let total = 0;
  let games = 0;
  for (const match of matrix?.matches || []) {
    const row = player?.stats?.[String(match.id)];
    if (!row) continue;
    const minutes = Number(row.minutesPlayed) || 0;
    if (minutes <= 0) continue;
    const value = Number(row[stat]);
    if (!Number.isFinite(value)) continue;
    total += value;
    games += 1;
    if (cells.length < count) cells.push(value);
  }
  return { cells, avg: games ? total / games : null };
}

function lineupNode(player, side, x, y, stat, matrix) {
  const jersey = player.jersey === null || player.jersey === undefined ? '' : `<i>${player.jersey}</i>`;
  const { cells, avg } = lineupStatValue(player.id, matrix, stat);
  const strip = Array.from(
    { length: 5 },
    (_value, index) => `<i>${cells[index] === undefined ? '·' : matrixText(cells[index], stat)}</i>`,
  ).join('');

  return `<div class="pitch-player ${side}" style="left:${x}%;top:${y}%">
    <span class="pitch-pill">${avg === null ? '–' : matrixText(avg, stat)}</span>
    <span class="pitch-photo">${playerPhoto(player, 'pitch-img')}${jersey}</span>
    <span class="pitch-name">${escapeHtml(player.name)}</span>
    <span class="pitch-strip">${strip}</span>
  </div>`;
}

function lineupPitch(home, away, matrices, stats) {
  const rows = { GK: 92, D: 74, M: 56, F: 38 };
  const groupsFor = (lineup) => {
    const groups = { GK: [], D: [], M: [], F: [] };
    for (const player of lineup?.starters || []) groups[lineupGroup(player.position)].push(player);
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) => (a.jersey ?? 99) - (b.jersey ?? 99));
    }
    return groups;
  };

  const render = (lineup, side) => {
    const groups = groupsFor(lineup);
    let markup = '';
    for (const key of ['GK', 'D', 'M', 'F']) {
      const row = groups[key];
      if (!row.length) continue;
      row.forEach((player, index) => {
        const x = row.length === 1 ? 50 : 13 + (74 * index) / (row.length - 1);
        const y = side === 'home' ? rows[key] : 100 - rows[key];
        markup += lineupNode(
          player,
          side,
          Math.round(x),
          y,
          stats[side],
          matrices[side],
        );
      });
    }
    return markup;
  };

  return `<div class="pitch">
    <span class="pitch-half"></span><span class="pitch-circle"></span>
    <span class="pitch-box top"></span><span class="pitch-box bottom"></span>
    ${home ? render(home, 'home') : ''}
    ${away ? render(away, 'away') : ''}
  </div>`;
}

function lineupSource(lineup) {
  if (!lineup) return 'Unavailable';
  return lineup.source === 'confirmed' ? 'Confirmed' : 'Predicted';
}

function benchList(lineup, team) {
  if (!lineup?.substitutes?.length) return '';
  return `<div class="bench-col">
    <h3>${escapeHtml(team.shortName || team.name)} <span>${lineup.substitutes.length} subs</span></h3>
    ${lineup.substitutes
      .map(
        (player) => `<div class="bench-row">
          ${playerPhoto(player, 'bench-photo')}
          <b>${escapeHtml(player.name)}</b>
          <small>${escapeHtml(player.position)}${player.minutes ? ` · ${player.minutes}'` : ''}</small>
        </div>`,
      )
      .join('')}
  </div>`;
}

function lineupStatSelect(side, team) {
  const current = state.detail.lineupStat[side];
  const options = LINEUP_STATS.map(
    ([key, label]) =>
      `<option value="${key}"${key === current ? ' selected' : ''}>${label}</option>`,
  ).join('');

  return `<label>
    <span>${escapeHtml(team.shortName || team.name)} stat</span>
    <select data-lineup-stat="${side}">${options}</select>
  </label>`;
}

function teamNewsRows(items) {
  if (!items.length) return '<p class="news-empty">No injuries or suspensions reported.</p>';

  return items
    .map(
      (item) => `<div class="news-row">
        ${playerPhoto(item, 'news-photo')}
        <span class="news-info">
          <b>${escapeHtml(item.name)}</b>
          <small>${escapeHtml(
            [item.position, item.reason, item.note].filter(Boolean).join(' · '),
          )}</small>
        </span>
        <span class="news-status ${item.tone}">${escapeHtml(item.status)}</span>
      </div>`,
    )
    .join('');
}

function teamNewsColumn(items, team) {
  return `<div class="news-col">
    <div class="news-team">
      <b>${escapeHtml(team.shortName || team.name)}</b>
      <span>${items.length ? `${items.length} unavailable` : 'No absences'}</span>
    </div>
    ${teamNewsRows(items)}
  </div>`;
}

function detailLineupsTab(data) {
  const sh = data.statshub;
  if (!sh) {
    return `
      <section class="detail-section">
        <div class="section-head"><h2>Line-ups</h2><span class="section-sub">StatsHub</span></div>
        <p class="section-note">Line-ups need a StatsHub fixture for this match.</p>
      </section>`;
  }

  const home = sh.lineups?.home;
  const away = sh.lineups?.away;
  const news = sh.teamNews || { home: [], away: [] };
  const homeNews = news.home || [];
  const awayNews = news.away || [];
  const unavailable = homeNews.length + awayNews.length;

  const teamMeta = (lineup, team, side) =>
    lineup
      ? `<span class="lineup-team ${side}">
          <b>${escapeHtml(team.shortName || team.name)}</b>
          <em>${escapeHtml(lineup.formation || '—')} · ${lineupSource(lineup)}</em>
        </span>`
      : '';

  const lineupsSection =
    home || away
      ? `<section class="detail-section">
          <div class="section-head"><h2>Line-ups</h2><span class="section-sub">Starting XI · subs</span></div>
          <div class="lineup-meta">
            ${teamMeta(home, sh.homeTeam, 'home')}
            ${teamMeta(away, sh.awayTeam, 'away')}
          </div>
          <div class="lineup-controls">
            ${lineupStatSelect('home', sh.homeTeam)}
            ${lineupStatSelect('away', sh.awayTeam)}
          </div>
          <p class="lineup-note">Pill is the average · cells are the last 5 matches, newest first</p>
          ${lineupPitch(home, away, sh.matrices || {}, state.detail.lineupStat)}
          <div class="bench-grid">
            ${benchList(home, sh.homeTeam)}
            ${benchList(away, sh.awayTeam)}
          </div>
        </section>`
      : `<section class="detail-section">
          <div class="section-head"><h2>Line-ups</h2><span class="section-sub">StatsHub</span></div>
          <p class="section-note">StatsHub has not published a line-up for this fixture yet.</p>
        </section>`;

  return `
    ${lineupsSection}
    <section class="detail-section">
      <div class="section-head"><h2>Team news</h2><span class="section-sub">${unavailable} unavailable</span></div>
      <div class="news-grid">
        ${teamNewsColumn(homeNews, sh.homeTeam)}
        ${teamNewsColumn(awayNews, sh.awayTeam)}
      </div>
    </section>`;
}

function heatPitch(points, label) {
  const max = Math.max(1, ...points.map((point) => Number(point[2]) || 1));
  const circles = points
    .map((point) => {
      const x = Number(point[0]);
      const y = (Number(point[1]) || 0) * 0.64;
      const intensity = Math.min(1, (Number(point[2]) || 1) / max);
      return `<circle cx="${x}" cy="${y}" r="${(1.7 + intensity * 2.8).toFixed(1)}" fill="#ffe6a0" opacity="${(
        0.16 +
        intensity * 0.5
      ).toFixed(2)}"/>`;
    })
    .join('');

  return `<svg class="heat-pitch" viewBox="0 0 100 64" role="img" aria-label="${escapeHtml(
    label,
  )} heatmap">
    <rect width="100" height="64" rx="2" fill="#1c6a46"/>
    <g fill="none" stroke="rgba(255,255,255,.3)" stroke-width="0.4">
      <rect x="2" y="2" width="96" height="60" rx="1"/>
      <path d="M50 2v60"/><circle cx="50" cy="32" r="8"/>
      <rect x="2" y="17" width="12" height="30"/><rect x="86" y="17" width="12" height="30"/>
      <rect x="2" y="25" width="5" height="14"/><rect x="93" y="25" width="5" height="14"/>
    </g>
    <g>${circles}</g>
  </svg>`;
}

function detailHeatmapsTab(data) {
  const sh = data.statshub;
  const items = sh?.heatmaps?.items || [];
  if (!items.length) {
    return `
      <section class="detail-section">
        <div class="section-head"><h2>Heatmaps</h2><span class="section-sub">StatsHub</span></div>
        <p class="section-note">StatsHub has no heatmap data for this fixture yet. Heatmaps appear once player positions are recorded.</p>
      </section>`;
  }

  const side = state.detail.heatSide;
  const filtered = side === 'all' ? items : items.filter((item) => item.side === side);
  const visible = state.detail.heatAll ? filtered : filtered.slice(0, 10);
  const filters = [
    ['all', 'All'],
    ['home', sh.homeTeam.shortName || sh.homeTeam.name],
    ['away', sh.awayTeam.shortName || sh.awayTeam.name],
  ]
    .map(
      ([key, label]) =>
        `<button class="heat-filter-btn${state.detail.heatSide === key ? ' is-active' : ''}" type="button" data-heat-side="${key}">${escapeHtml(
          label,
        )}</button>`,
    )
    .join('');

  return `
    <section class="detail-section">
      <div class="section-head"><h2>Heatmaps</h2><span class="section-sub">${filtered.length} players</span></div>
      <div class="heat-filter" role="group" aria-label="Heatmap team">${filters}</div>
      <div class="heat-grid">
        ${visible
          .map(
            (item) => `<article class="heat-card">
              <div class="heat-head">
                ${playerPhoto(item, 'heat-photo')}
                <b>${escapeHtml(item.name)}</b>
                <small>${escapeHtml(
                  item.side === 'home'
                    ? sh.homeTeam.shortName || sh.homeTeam.name
                    : sh.awayTeam.shortName || sh.awayTeam.name,
                )}</small>
              </div>
              ${heatPitch(item.points, item.name)}
            </article>`,
          )
          .join('')}
      </div>
      ${
        filtered.length > 10
          ? `<button class="show-more" type="button" data-action="heat-all">${
              state.detail.heatAll ? 'Show fewer players' : `Show all ${filtered.length} players`
            }</button>`
          : ''
      }
    </section>`;
}

function comparisonRows(sh) {
  const rows = (sh.comparison || []).slice(0, 12);
  if (!rows.length) return '';

  const cell = (entry) =>
    entry.average === null
      ? '–'
      : `${statText(entry.average)}${entry.rank ? `<small>#${entry.rank}</small>` : ''}`;

  return `
    <div class="cmp-row head"><span>Per game</span><span>${escapeHtml(
      sh.homeTeam.shortName || 'Home',
    )}</span><span>${escapeHtml(sh.awayTeam.shortName || 'Away')}</span></div>
    ${rows
      .map(
        (row) => `
      <div class="cmp-row">
        <span>${escapeHtml(row.label)}</span>
        <span>${cell(row.home)}</span>
        <span>${cell(row.away)}</span>
      </div>`,
      )
      .join('')}`;
}

function recentRows(data, side) {
  const sh = data.statshub;
  const form = sh.form?.[side];
  const matches = form?.matches || [];
  if (!matches.length) return '';
  const logo = beLogo(data, side);

  return `
    <div class="recent-head">
      ${logo ? `<img src="${escapeHtml(imageUrl(logo))}" alt="" loading="lazy" />` : ''}
      <b>${escapeHtml(
        (side === 'home' ? sh.homeTeam : sh.awayTeam).shortName ||
          (side === 'home' ? sh.homeTeam : sh.awayTeam).name,
      )}</b>
      <span class="section-sub">Last ${matches.length}</span>
    </div>
    <div class="recent-table">
      <div class="recent-row head">
        <span>Date</span><span>Opponent</span><span>Res</span><span>Poss</span><span>Shots</span><span>Corners</span>
      </div>
      ${matches
        .map(
          (match) => `
        <div class="recent-row">
          <span>${shiftedDate(match.kickoff).date}</span>
          <span class="recent-opp">${match.isHome ? '' : '@ '}${escapeHtml(match.opponent)}</span>
          <span><i class="form-chip ${match.result || ''}">${(match.result || '?').toUpperCase()}</i> ${
            match.score.home ?? '–'
          }-${match.score.away ?? '–'}</span>
          <span>${match.stats.possession ?? '–'}${match.stats.possession !== null ? '%' : ''}</span>
          <span>${match.stats.shots ?? '–'}</span>
          <span>${match.stats.corners ?? '–'}</span>
        </div>`,
        )
        .join('')}
    </div>`;
}

function detailTeamsTab(data) {
  const sh = data.statshub;
  if (!sh) {
    return `
      <section class="detail-section">
        <div class="section-head"><h2>Teams</h2><span class="section-sub">StatsHub</span></div>
        <p class="section-note">Team stats need a StatsHub fixture for this match.</p>
      </section>`;
  }

  return `
    <section class="detail-section">
      <div class="section-head"><h2>Season averages</h2><span class="section-sub">StatsHub · per game</span></div>
      <div class="cmp-table">${comparisonRows(sh)}</div>
    </section>
    <section class="detail-section">
      <div class="section-head"><h2>Team form</h2><span class="section-sub">Recent matches</span></div>
      ${recentRows(data, 'home')}
      ${recentRows(data, 'away')}
    </section>`;
}

function detailTabPanel(data) {
  switch (state.detail.tab) {
    case 'report':
      return detailReportTab(data);
    case 'players':
      return detailPlayersTab(data);
    case 'teams':
      return detailTeamsTab(data);
    case 'lineups':
      return detailLineupsTab(data);
    case 'heatmaps':
      return detailHeatmapsTab(data);
    case 'h2h':
      return `${detailH2H(data)}${detailStandings(data)}`;
    case 'odds':
      return detailOdds(data);
    default:
      return detailMatchTab(data);
  }
}

/** The UTC offset BetExplorer used for this fixture, measured against StatsHub's timestamp. */
function detailOffsetMinutes(data) {
  const sh = data.statshub;
  const match = data.match;
  if (!sh?.kickoff || !match?.date || !match?.time) return 60;
  const [year, month, day] = match.date.split('-').map(Number);
  const [hour, minute] = match.time.split(':').map(Number);
  if (!year || !Number.isFinite(hour) || !Number.isFinite(minute)) return 60;
  const localEpoch = Date.UTC(year, month - 1, day, hour, minute) / 1000;
  return Math.round((localEpoch - sh.kickoff) / 900) * 15;
}

function renderDetail(data) {
  state.detail.data = data;
  state.detail.offsetMinutes = detailOffsetMinutes(data);
  const match = data.match;

  detailTitleEl.textContent = match.league || state.detail.league || 'Match details';
  detailExternalLink.href = match.url || state.detail.url;
  document.title = `${match.home} vs ${match.away} · Football`;

  detailBodyEl.innerHTML = [detailHero(data), detailTabs(data), detailTabPanel(data)].join('');
}

function updateMarketTabState(market) {
  detailBodyEl.querySelectorAll('.market-tab').forEach((tab) => {
    const active = tab.dataset.market === market;
    tab.classList.toggle('is-active', active);
    tab.setAttribute('aria-pressed', String(active));
  });
}

async function loadDetail(market, options = {}) {
  const { force = false } = options;
  const detail = state.detail;
  if (!detail.open) return;

  detail.market = market;
  detail.oddsError = null;
  updateMarketTabState(market);

  const cacheKey = `${detail.url}|${market}`;
  const cached = state.matchCache.get(cacheKey);
  const isFresh = cached && Date.now() - cached.timestamp < 60 * 1000;

  if (cached && isFresh && !force) {
    detail.oddsLoading = false;
    const scrollY = window.scrollY;
    renderDetail(cached.data);
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
    return;
  }

  detail.oddsLoading = true;
  if (!detail.data) {
    detailBodyEl.innerHTML = detailSkeleton();
  } else {
    detailBodyEl.querySelector('#odds-section')?.classList.add('is-loading');
  }

  const requestId = ++detail.requestId;

  try {
    const shQuery = detail.statshubId ? `&sh=${encodeURIComponent(detail.statshubId)}` : '';
    const response = await fetch(
      `/api/match?url=${encodeURIComponent(detail.url)}&market=${encodeURIComponent(
        market,
      )}${shQuery}`,
      { headers: { Accept: 'application/json' } },
    );
    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      throw new Error(payload?.error || `Request failed with status ${response.status}.`);
    }
    if (!detail.open || requestId !== detail.requestId) return;

    detail.oddsLoading = false;
    state.matchCache.set(cacheKey, { data: payload, timestamp: Date.now() });
    const scrollY = window.scrollY;
    renderDetail(payload);
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
  } catch (error) {
    if (!detail.open || requestId !== detail.requestId) return;
    detail.oddsLoading = false;

    if (detail.data) {
      detail.oddsError = error.message || 'Please try again.';
      const scrollY = window.scrollY;
      renderDetail(detail.data);
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    } else {
      detailBodyEl.innerHTML = detailError(
        error.message || 'Please check your connection and try again.',
      );
    }
  }
}

function openDetail(matchUrl, leagueName, statshubId) {
  if (!matchUrl) return;
  if (state.calendarOpen) closeCalendar();

  const detail = state.detail;
  detail.open = true;
  detail.url = matchUrl;
  detail.league = leagueName || '';
  detail.statshubId = statshubId || null;
  detail.market = '1x2';
  detail.tab = 'match';
  detail.matrixSide = 'home';
  detail.matrixStat = 'shots';
  detail.matrixRange = 20;
  detail.matrixVenue = 'both';
  detail.matrixAll = false;
  detail.lineupStat = { home: 'fouls', away: 'wasFouled' };
  detail.heatSide = 'all';
  detail.heatAll = false;
  detail.data = null;
  detail.oddsLoading = true;
  detail.oddsError = null;
  detail.line = null;
  detail.h2hExpanded = false;
  detail.standingsExpanded = false;
  detail.returnScroll = window.scrollY || 0;
  detail.requestId += 1;

  listViewEl.hidden = true;
  detailViewEl.hidden = false;
  document.body.classList.add('detail-open');
  detailTitleEl.textContent = leagueName || 'Match details';
  detailExternalLink.href = matchUrl;
  detailBodyEl.innerHTML = detailSkeleton();

  const url = new URL(window.location.href);
  url.searchParams.set('date', state.date);
  url.searchParams.set('match', matchUrl);
  if (detail.statshubId) url.searchParams.set('sh', detail.statshubId);
  else url.searchParams.delete('sh');
  window.history.replaceState(null, '', url.toString());
  window.scrollTo(0, 0);

  loadDetail('1x2', { force: true });
}

function closeDetail() {
  const detail = state.detail;
  if (!detail.open) return;

  detail.open = false;
  detail.requestId += 1;
  detailBodyEl.innerHTML = '';
  detailViewEl.hidden = true;
  listViewEl.hidden = false;
  document.body.classList.remove('detail-open');

  const url = new URL(window.location.href);
  url.searchParams.set('date', state.date);
  url.searchParams.delete('match');
  url.searchParams.delete('sh');
  window.history.replaceState(null, '', url.toString());

  updateDateControls();
  requestAnimationFrame(() => window.scrollTo(0, detail.returnScroll || 0));
}

/* ---------- events ---------- */

prevBtn.addEventListener('click', () => setDate(addDays(state.date, -1)));
nextBtn.addEventListener('click', () => setDate(addDays(state.date, 1)));

dateBtn.addEventListener('click', () => {
  if (state.calendarOpen) {
    closeCalendar();
  } else {
    openCalendar();
  }
});

calPrevBtn.addEventListener('click', () => shiftMonth(-1));
calNextBtn.addEventListener('click', () => shiftMonth(1));

calTodayBtn.addEventListener('click', () => {
  closeCalendar();
  setDate(todayKey());
});

calGridEl.addEventListener('click', (event) => {
  const dayButton = event.target.closest('.cal-day');
  if (!dayButton) return;
  closeCalendar();
  setDate(dayButton.dataset.date);
});

document.addEventListener('click', (event) => {
  if (!state.calendarOpen) return;
  if (calendarEl.contains(event.target) || dateBtn.contains(event.target)) return;
  closeCalendar();
});

document.addEventListener('keydown', (event) => {
  if (state.detail.open) {
    if (event.key === 'Escape') closeDetail();
    return;
  }
  if (event.key === 'Escape' && state.calendarOpen) {
    closeCalendar();
    dateBtn.focus();
    return;
  }
  if (state.calendarOpen) return;
  if (event.target instanceof Element && event.target.closest('input, textarea, select')) return;
  if (event.key === 'ArrowLeft') setDate(addDays(state.date, -1));
  if (event.key === 'ArrowRight') setDate(addDays(state.date, 1));
});

fixturesEl.addEventListener('click', (event) => {
  const matchLink = event.target.closest('.match[data-match-url]');
  if (matchLink && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) {
    if (!matchLink.dataset.matchUrl) return;
    event.preventDefault();
    try {
      openDetail(matchLink.dataset.matchUrl, matchLink.dataset.league, matchLink.dataset.shId);
    } catch (error) {
      console.error('Could not open match details in place, navigating instead.', error);
      window.location.assign(matchLink.href);
    }
    return;
  }

  const action = event.target.closest('[data-action]')?.dataset.action;
  if (action === 'retry') {
    setDate(state.date, { updateUrl: false });
  }
  if (action === 'today') {
    setDate(todayKey());
  }

  const leagueHead = event.target.closest('.league-head');
  if (leagueHead) {
    const league = leagueHead.closest('.league');
    const collapsed = league.classList.toggle('is-collapsed');
    leagueHead.setAttribute('aria-expanded', String(!collapsed));
    if (collapsed) state.collapsed.add(league.dataset.key);
    else state.collapsed.delete(league.dataset.key);
  }
});

detailBackBtn.addEventListener('click', closeDetail);

detailBodyEl.addEventListener('click', (event) => {
  const sectionTab = event.target.closest('[data-tab]');
  if (sectionTab) {
    state.detail.tab = sectionTab.dataset.tab;
    if (state.detail.data) {
      const scrollY = window.scrollY;
      renderDetail(state.detail.data);
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    }
    return;
  }

  const matrixSide = event.target.closest('[data-matrix-side]');
  if (matrixSide) {
    state.detail.matrixSide = matrixSide.dataset.matrixSide;
    if (state.detail.data) {
      const scrollY = window.scrollY;
      renderDetail(state.detail.data);
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    }
    return;
  }

  const matrixVenue = event.target.closest('[data-matrix-venue]');
  if (matrixVenue) {
    state.detail.matrixVenue = matrixVenue.dataset.matrixVenue;
    if (state.detail.data) {
      const scrollY = window.scrollY;
      renderDetail(state.detail.data);
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    }
    return;
  }

  const heatSide = event.target.closest('[data-heat-side]');
  if (heatSide) {
    state.detail.heatSide = heatSide.dataset.heatSide;
    if (state.detail.data) {
      const scrollY = window.scrollY;
      renderDetail(state.detail.data);
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    }
    return;
  }

  const reportStage = event.target.closest('[data-report-stage]');
  if (reportStage) {
    state.detail.reportStage = reportStage.dataset.reportStage;
    if (state.detail.data) {
      const scrollY = window.scrollY;
      renderDetail(state.detail.data);
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    }
    return;
  }

  const commentFilter = event.target.closest('[data-comment-filter]');
  if (commentFilter) {
    state.detail.commentFilter = commentFilter.dataset.commentFilter;
    state.detail.commentsAll = false;
    if (state.detail.data) {
      const scrollY = window.scrollY;
      renderDetail(state.detail.data);
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    }
    return;
  }

  const marketTab = event.target.closest('[data-market]');
  if (marketTab) {
    loadDetail(marketTab.dataset.market);
    return;
  }

  const line = event.target.closest('[data-line]');
  if (line) {
    state.detail.line = line.dataset.line;
    if (state.detail.data) renderDetail(state.detail.data);
    return;
  }

  const action = event.target.closest('[data-action]')?.dataset.action;
  if (!action) return;

  if (action === 'h2h-all' && state.detail.data) {
    state.detail.h2hExpanded = !state.detail.h2hExpanded;
    renderDetail(state.detail.data);
  }
  if (action === 'standings-all' && state.detail.data) {
    state.detail.standingsExpanded = !state.detail.standingsExpanded;
    renderDetail(state.detail.data);
  }
  if (action === 'matrix-all' && state.detail.data) {
    state.detail.matrixAll = !state.detail.matrixAll;
    const scrollY = window.scrollY;
    renderDetail(state.detail.data);
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
  }
  if (action === 'comments-all' && state.detail.data) {
    state.detail.commentsAll = !state.detail.commentsAll;
    const scrollY = window.scrollY;
    renderDetail(state.detail.data);
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
  }
  if (action === 'heat-all' && state.detail.data) {
    state.detail.heatAll = !state.detail.heatAll;
    const scrollY = window.scrollY;
    renderDetail(state.detail.data);
    requestAnimationFrame(() => window.scrollTo(0, scrollY));
  }
  if (action === 'detail-retry' || action === 'odds-retry') {
    loadDetail(state.detail.market, { force: true });
  }
});

detailBodyEl.addEventListener('change', (event) => {
  const lineupStatSelect = event.target.closest('[data-lineup-stat]');
  if (lineupStatSelect) {
    state.detail.lineupStat[lineupStatSelect.dataset.lineupStat] = lineupStatSelect.value;
    if (state.detail.data) {
      const scrollY = window.scrollY;
      renderDetail(state.detail.data);
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    }
    return;
  }

  const statSelect = event.target.closest('[data-matrix-stat]');
  if (statSelect) {
    state.detail.matrixStat = statSelect.value;
    state.detail.matrixAll = false;
    if (state.detail.data) {
      const scrollY = window.scrollY;
      renderDetail(state.detail.data);
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    }
    return;
  }

  const rangeSelect = event.target.closest('[data-matrix-range]');
  if (rangeSelect) {
    state.detail.matrixRange = Number(rangeSelect.value) || 10;
    if (state.detail.data) {
      const scrollY = window.scrollY;
      renderDetail(state.detail.data);
      requestAnimationFrame(() => window.scrollTo(0, scrollY));
    }
  }
});

function hideBrokenImage(event) {
  if (event.target instanceof HTMLImageElement) {
    event.target.style.visibility = 'hidden';
  }
}

fixturesEl.addEventListener('error', hideBrokenImage, true);
detailBodyEl.addEventListener('error', hideBrokenImage, true);

/* ---------- boot ---------- */

const params = new URLSearchParams(window.location.search);
const requested = params.get('date');
const initialDate = /^\d{4}-\d{2}-\d{2}$/.test(requested || '') ? requested : todayKey();

setDate(initialDate, { updateUrl: false });

const initialMatch = params.get('match');
if (initialMatch) {
  openDetail(initialMatch, '', params.get('sh'));
}
