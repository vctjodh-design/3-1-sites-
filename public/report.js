/* ---------- player-level chance blame (StatsHub per-player xG) ---------- */

/**
 * Per-player xG minus goals for this fixture, straight from the StatsHub matrix.
 * StatsHub has no per-player "big chances missed" field, so the xG left
 * unconverted is the measure of who wasted the openings.
 */
function chanceBlame(data) {
  const sh = data.statshub;
  const score = data.match?.score;
  const eventId = sh?.id;
  if (!sh?.matrices || !eventId || !score) return null;

  const sides = ['home', 'away']
    .map((side) => {
      const matrix = sh.matrices?.[side];
      const team = reportSideName(data, side);
      const teamGoals = side === 'home' ? score.home : score.away;
      const players = (matrix?.players || [])
        .map((player) => {
          const row = player.stats?.[String(eventId)];
          if (!row) return null;
          const rawXg = row.expectedGoals;
          if (rawXg === null || rawXg === undefined || rawXg === '') return null;
          const xg = Number(rawXg);
          if (!Number.isFinite(xg)) return null;
          const shots = Number(row.shots) || 0;
          const goals = Number(row.goals) || 0;
          const minutes = Number(row.minutesPlayed) || 0;
          if (minutes <= 0 && shots === 0 && goals === 0) return null;
          return {
            id: player.id ?? null,
            name: player.name,
            position: player.position || row.position || '',
            image: player.image,
            minutes,
            shots,
            onTarget: Number(row.onTargetScoringAttempt) || 0,
            goals,
            xg,
            gap: xg - goals,
            bigCreated: Number(row.bigChanceCreated) || 0,
          };
        })
        .filter(Boolean)
        .filter((player) => player.shots > 0 || player.goals > 0)
        .sort((a, b) => b.xg - a.xg || b.gap - a.gap);

      const wasters = players.filter((player) => player.gap >= 0.2).sort((a, b) => b.gap - a.gap);
      const clinical = players
        .filter((player) => player.gap <= -0.25)
        .sort((a, b) => a.gap - b.gap);

      return { side, team, teamGoals, players, wasters, clinical };
    })
    .filter((entry) => entry.players.length);

  const wasters = sides.flatMap((entry) =>
    entry.wasters.map((player) => ({ ...player, team: entry.team })),
  );
  const clinical = sides.flatMap((entry) =>
    entry.clinical.map((player) => ({ ...player, team: entry.team })),
  );
  if (!wasters.length && !clinical.length) return null;

  const worst = wasters.slice().sort((a, b) => b.gap - a.gap)[0] || null;
  const best = clinical.slice().sort((a, b) => a.gap - b.gap)[0] || null;
  const shotText = (player) =>
    `${player.shots} shot${player.shots === 1 ? '' : 's'} (${player.onTarget} on target)`;
  const goalText = (goals) => `${goals} goal${goals === 1 ? '' : 's'}`;

  let summary = worst
    ? `${worst.name} (${worst.team}) took ${shotText(worst)} worth ${worst.xg.toFixed(
        2,
      )} xG and ${worst.goals === 0 ? 'did not score' : `scored ${goalText(worst.goals)}`} — ${worst.gap.toFixed(
        2,
      )} xG left unconverted, the biggest individual shortfall in the match.`
    : 'No player finished more than 0.20 xG below their expected goals.';
  if (best) {
    summary += ` ${best.team}'s ${best.name} scored ${goalText(best.goals)} from ${best.xg.toFixed(
      2,
    )} xG.`;
  }

  const detailParts = [];
  for (const entry of sides) {
    if (!entry.wasters.length) continue;
    const names = entry.wasters
      .slice(0, 2)
      .map(
        (player) =>
          `${player.name} ${player.xg.toFixed(2)} xG for ${goalText(player.goals)}`,
      );
    detailParts.push(`${entry.team}: ${names.join(', ')}.`);
  }
  if (best) {
    detailParts.push(
      `${best.team}'s ${best.name} scored ${goalText(best.goals)} from ${best.xg.toFixed(
        2,
      )} xG, so not every chance went unconverted.`,
    );
  }

  return { sides, wasters, clinical, worst, best, summary, detail: detailParts.join(' ') };
}

function reportChanceBlame(data) {
  const blame = chanceBlame(data);
  if (!blame) return '';

  const playerRow = (player) => {
    const tone =
      player.gap >= 0.2 ? ' is-waste' : player.gap <= -0.25 ? ' is-clinical' : '';
    const gapText = `${player.gap > 0 ? '+' : ''}${player.gap.toFixed(2)}`;
    return `<div class="rp-blame-row${tone}">
      ${playerPhoto(player, 'rp-blame-photo')}
      <span class="rp-blame-name"><b>${escapeHtml(player.name)}</b><em>${escapeHtml(
        `${player.position || '—'} · ${player.shots} sh · ${player.onTarget} OT`,
      )}</em></span>
      <span class="rp-blame-num">${player.xg.toFixed(2)}</span>
      <span class="rp-blame-num">${player.goals}</span>
      <span class="rp-blame-gap">${gapText}</span>
    </div>`;
  };

  return `<section class="detail-section">
    <div class="section-head"><h2>Who wasted the chances</h2><span class="section-sub">StatsHub · player xG</span></div>
    <p class="rp-blame-lead">${escapeHtml(blame.summary)}</p>
    <div class="rp-blame-teams">
      ${blame.sides
        .map(
          (entry) => `<div class="rp-blame-team">
            <div class="rp-blame-team-head">
              <b>${escapeHtml(entry.team)}</b>
              <span>${entry.teamGoals} scored · ${entry.players.length} shot-taker${
                entry.players.length === 1 ? '' : 's'
              }</span>
            </div>
            <div class="rp-blame-row is-head">
              <span></span><span>Player</span><span>xG</span><span>G</span><span>xG−G</span>
            </div>
            ${entry.players.slice(0, 6).map(playerRow).join('')}
          </div>`,
        )
        .join('')}
    </div>
    <p class="rp-blame-note">Waste is xG minus goals: a positive number is shooting worth more than it produced. StatsHub publishes no per-player “big chances missed” count, so the xG left unconverted is the measure used here.</p>
  </section>`;
}

function reportWhy(data) {
  const sw = data.soccerway;
  const score = data.match?.score;
  if (!sw?.hasEvents || !score) return '';

  const stages = sw.stats?.stages || [];
  const stage = stages.find((entry) => /^match$/i.test(entry.name)) || stages[0];
  if (!stage) return '';
  const firstStage = stages.find((entry) => /1st half/i.test(entry.name));
  const secondStage = stages.find((entry) => /2nd half/i.test(entry.name));

  const home = reportSideName(data, 'home');
  const away = reportSideName(data, 'away');
  const goals = sw.goals || [];
  const cards = sw.cards || [];
  const subs = sw.substitutions || [];
  const total = score.home + score.away;
  const line = Number(marketLine(data.prematch?.ou)?.line) || 2.5;

  const pair = (label, at = stage) => {
    const stat = reportStat(at, label);
    return stat ? [statNumber(stat.home), statNumber(stat.away)] : [null, null];
  };

  const [xgH, xgA] = pair('Expected goals (xG)');
  const [xgotH, xgotA] = pair('xG on target (xGOT)');
  const [shotsH, shotsA] = pair('Total shots');
  const [sotH, sotA] = pair('Shots on target');
  const [bigH, bigA] = pair('Big chances');
  const [savesH, savesA] = pair('Goalkeeper saves');
  const [woodH, woodA] = pair('Hit the woodwork');
  const [blockedH, blockedA] = pair('Blocked shots');
  const [cornersH, cornersA] = pair('Corner kicks');
  const [touchesH, touchesA] = pair('Touches in opposition box');
  const [possH, possA] = pair('Ball possession');
  const [foulsH, foulsA] = pair('Fouls');

  const pct = (part, whole) =>
    part !== null && whole ? `${Math.round((part / whole) * 100)}%` : '—';
  const fmt = (value) => (value === null ? '—' : value.toFixed(2));
  const factors = [];
  const add = (weight, title, summary, detail, source) =>
    factors.push({ weight, title, summary, detail, source });

  if (xgH !== null && xgA !== null) {
    const diffH = score.home - xgH;
    const diffA = score.away - xgA;
    if (Math.abs(diffH) >= 0.4 || Math.abs(diffA) >= 0.4) {
      if (diffH < -0.35 && diffA < -0.35) {
        add(
          10,
          'Both sides under-converted',
          `Both teams scored fewer goals than their chances: ${home} ${score.home} from ${fmt(
            xgH,
          )} xG, ${away} ${score.away} from ${fmt(xgA)}.`,
          `The combined xG was ${fmt(xgH + xgA)} but only ${total} goals were scored, so finishing — not chance creation — kept the score down.`,
          'Soccerway stats',
        );
      } else {
        const clinical = diffH >= diffA ? home : away;
        const wasteful = diffH >= diffA ? away : home;
        const clinicalDiff = Math.max(diffH, diffA);
        const wastefulDiff = Math.min(diffH, diffA);
        add(
          10,
          'Finishing decided the scoreline',
          `${clinical} were the more clinical side: ${clinical === home ? score.home : score.away} goal${
            (clinical === home ? score.home : score.away) === 1 ? '' : 's'
          } from ${fmt(clinical === home ? xgH : xgA)} xG, against ${fmt(
            wasteful === home ? xgH : xgA,
          )} xG for ${wasteful}.`,
          `${clinical} finished ${clinicalDiff >= 0 ? '+' : ''}${clinicalDiff.toFixed(
            2,
          )} against their xG while ${wasteful} finished ${wastefulDiff.toFixed(
            2,
          )}; that conversion gap is the clearest reason the result differs from the shot count.`,
          'Soccerway stats',
        );
      }
    }
  }

  const blame = chanceBlame(data);
  if (blame?.worst) {
    add(9, 'Who wasted the chances', blame.summary, blame.detail, 'StatsHub player xG');
  }

  if (shotsH !== null && shotsA !== null && sotH !== null && sotA !== null) {
    add(
      9,
      'Shot accuracy',
      `${home} put ${sotH} of ${shotsH} shots on target (${pct(sotH, shotsH)}); ${away} put ${sotA} of ${shotsA} on target (${pct(
        sotA,
        shotsA,
      )}).`,
      bigH !== null && bigA !== null
        ? `Big chances were ${bigH}-${bigA}. ${home} had ${shotsH} attempts but tested the keeper only ${sotH} times, which is why their pressure did not turn into more goals.`
        : `The on-target rate explains why the team with more shots did not automatically score more.`,
      'Soccerway stats',
    );
  }

  if (xgotH !== null && xgotA !== null && xgH !== null && xgA !== null) {
    add(
      8,
      'Shot quality',
      `${home}'s attempts produced ${fmt(xgotH)} xGOT from ${fmt(xgH)} xG; ${away} produced ${fmt(
        xgotA,
      )} from ${fmt(xgA)}.`,
      `xGOT measures where the shots actually went. ${
        xgotH < xgH ? `${home} under-hit their chances` : `${home} struck the ball well`
      }, while ${xgotA > xgA ? `${away} improved their chances with better placement` : `${away} did not improve theirs`}.`,
      'Soccerway stats',
    );
  }

  for (const entry of sw.disallowed || []) {
    let beforeHome = 0;
    let beforeAway = 0;
    for (const goal of goals) {
      if (goal.order >= entry.order) continue;
      if (goal.side === 'home') beforeHome += 1;
      else beforeAway += 1;
    }
    const team = entry.side === 'home' ? home : away;
    add(
      8,
      'Goal ruled out',
      `${entry.player}'s ${entry.minute} goal for ${team} was disallowed${
        entry.reason ? ` for ${entry.reason.toLowerCase()}` : ''
      }.`,
      `The score was ${beforeHome}-${beforeAway} at the time, so the disallowed goal would have made it ${
        entry.side === 'home' ? beforeHome + 1 : beforeHome
      }-${entry.side === 'home' ? beforeAway : beforeAway + 1}.`,
      'Soccerway incidents',
    );
  }

  const halfTime = (sw.halves || [])[0];
  if (halfTime && halfTime.home !== halfTime.away) {
    const leaderSide = halfTime.home > halfTime.away ? 'home' : 'away';
    const leaderWon = leaderSide === 'home' ? score.home > score.away : score.away > score.home;
    if (!leaderWon) {
      const [sShotsH, sShotsA] = pair('Total shots', secondStage || stage);
      const [sxgH, sxgA] = pair('Expected goals (xG)', secondStage || stage);
      add(
        8,
        'The lead did not hold',
        `${leaderSide === 'home' ? home : away} led ${halfTime.home}-${halfTime.away} at half-time but did not win.`,
        `After the break ${home} had ${sShotsH ?? '—'} shots${
          sxgH !== null ? ` (${fmt(sxgH)} xG)` : ''
        } to ${away}'s ${sShotsA ?? '—'}${
          sxgA !== null ? ` (${fmt(sxgA)} xG)` : ''
        }, and the score changed in that spell.`,
        'Soccerway stats',
      );
    }
  }

  if (total === 0 && xgH !== null && xgA !== null) {
    const saves = (savesH || 0) + (savesA || 0);
    const wood = (woodH || 0) + (woodA || 0);
    const blocked = (blockedH || 0) + (blockedA || 0);
    add(
      10,
      'Why it stayed 0-0',
      `The teams combined for ${fmt(xgH + xgA)} xG but no goals.`,
      `${saves} saves, ${blocked} blocked shots and ${wood} strike${
        wood === 1 ? '' : 's'
      } off the woodwork kept the game level.`,
      'Soccerway stats',
    );
  }

  if (firstStage && secondStage) {
    const [fxgH, fxgA] = pair('Expected goals (xG)', firstStage);
    const [sxgH, sxgA] = pair('Expected goals (xG)', secondStage);
    if (fxgH !== null && sxgH !== null) {
      const homeDrop = fxgH - sxgH;
      const awayDrop = fxgA - sxgA;
      add(
        7,
        'The half-by-half shift',
        `First half: ${home} ${fmt(fxgH)} xG, ${away} ${fmt(fxgA)}. Second half: ${home} ${fmt(
          sxgH,
        )} xG, ${away} ${fmt(sxgA)}.`,
        `${home}'s xG ${homeDrop >= 0 ? 'fell' : 'rose'} by ${Math.abs(homeDrop).toFixed(
          2,
        )} after the break and ${away}'s ${awayDrop >= 0 ? 'fell' : 'rose'} by ${Math.abs(
          awayDrop,
        ).toFixed(2)}. ${goals.length ? 'Goals by half: ' + (sw.halves || []).map((half) => `${half.name} ${half.home}-${half.away}`).join(', ') + '.' : ''}`,
        'Soccerway stats',
      );
    }
  }

  const stoppedBy = () => {
    const saves = (savesH || 0) + (savesA || 0);
    const wood = (woodH || 0) + (woodA || 0);
    const blocked = (blockedH || 0) + (blockedA || 0);
    const tail = `${saves} saves, ${blocked} blocked shots and ${wood} strike${
      wood === 1 ? '' : 's'
    } off the woodwork`;
    if (total > line) return `${tail} were not enough to keep the game under ${line}`;
    if (total < line) return `${tail} kept the game under ${line}`;
    return `${tail} left the game exactly on the ${line} line`;
  };

  if (xgH !== null && xgA !== null) {
    add(
      6,
      `Why the total was ${total > line ? 'over' : total < line ? 'under' : 'on'} ${line}`,
      `${total} goals arrived from ${fmt(xgH + xgA)} combined xG.`,
      `${stoppedBy()}. The final score was ${score.home}-${score.away}.`,
      'Soccerway stats',
    );
  }

  if (possH !== null && cornersH !== null) {
    add(
      5,
      'Territory vs penetration',
      `${home} had ${possH}% possession, ${cornersH} corners and ${touchesH ?? '—'} touches in the box; ${away} had ${possA}%, ${cornersA} corners and ${touchesA ?? '—'} box touches.`,
      `Territory favoured ${
        possH > possA ? home : away
      }, but the scoreline was settled by the conversion numbers above rather than by who held the ball.`,
      'Soccerway stats',
    );
  }

  if (cards.length) {
    const reds = cards.filter((card) => card.color === 'red');
    const homeCards = cards.filter((card) => card.side === 'home').length;
    const awayCards = cards.filter((card) => card.side === 'away').length;
    const reasons = [...new Set(cards.map((card) => card.reason).filter(Boolean))];
    add(
      reds.length ? 9 : 4,
      reds.length ? 'A red card changed the numbers' : 'Discipline',
      `${cards.length} card${cards.length === 1 ? '' : 's'}: ${home} ${homeCards}, ${away} ${awayCards}.`,
      reds.length
        ? `${reds.map((card) => `${card.player} (${card.side === 'home' ? home : away}) was sent off at ${card.minute}`).join('; ')}.`
        : `Bookings were for ${reasons.join(', ').toLowerCase() || 'various fouls'}; fouls finished ${foulsH ?? '—'}-${foulsA ?? '—'} and no red card was shown.`,
      'Soccerway incidents',
    );
  }

  if (subs.length) {
    const scorerOff = subs.find((sub) => goals.some((goal) => goal.player === sub.out));
    const earliest = subs.reduce(
      (min, sub) => (min === null || sub.order < min ? sub.order : min),
      null,
    );
    add(
      3,
      'Bench impact',
      `${subs.length} substitutions were made${earliest ? `, the first on ${subs.find((sub) => sub.order === earliest)?.minute}` : ''}.`,
      scorerOff
        ? `${String(scorerOff.out).replace(/\.$/, '')}, who scored, was withdrawn on ${
            scorerOff.minute
          } for ${String(scorerOff.in).replace(/\.$/, '')}.`
        : 'No goalscorer was substituted.',
      'Soccerway incidents',
    );
  }

  if (data.prematch) {
    const prices = [
      ['1', home, bestPrice(data.prematch['1x2'], '1')],
      ['X', 'the draw', bestPrice(data.prematch['1x2'], 'X')],
      ['2', away, bestPrice(data.prematch['1x2'], '2')],
    ].filter((entry) => entry[2]);
    if (prices.length === 3) {
      const favourite = prices.reduce((best, entry) =>
        !best || entry[2].value < best[2].value ? entry : best,
      );
      const resultColumn = score.home > score.away ? '1' : score.home === score.away ? 'X' : '2';
      const landed = prices.find((entry) => entry[0] === resultColumn);
      add(
        2,
        'Pre-match context',
        `${favourite[1]} were the favourites at ${favourite[2].value.toFixed(2)}; ${landed[1]} were priced ${landed[2].value.toFixed(
          2,
        )}.`,
        `The market ${resultColumn === favourite[0] ? 'called the result' : 'was beaten'}. This is context, not a cause: the reasons above come from what happened on the pitch.`,
        'BetExplorer odds',
      );
    }
  }

  factors.sort((a, b) => b.weight - a.weight);

  const resultText =
    score.home === score.away
      ? `The match finished level at ${score.home}-${score.away}.`
      : `${score.home > score.away ? home : away} won ${Math.max(score.home, score.away)}-${Math.min(
          score.home,
          score.away,
        )}.`;
  const lead = factors
    .slice(0, 2)
    .map((factor) => factor.summary)
    .join(' ');

  const timelineText = goals
    .map(
      (goal) =>
        `${goal.minute} ${goal.player} (${goal.side === 'home' ? home : away})${
          goal.assist ? `, assist ${goal.assist}` : ''
        }`,
    )
    .join('; ');
  const goalTimeline = goals.length
    ? `${timelineText}${timelineText.endsWith('.') ? '' : '.'}`
    : 'No goals were scored.';
  const disallowedText = (sw.disallowed || []).length
    ? ` ${sw.disallowed
        .map(
          (entry) =>
            `${entry.player}'s ${entry.minute} goal was ruled out${entry.reason ? ` for ${entry.reason.toLowerCase()}` : ''}.`,
        )
        .join(' ')}`
    : '';

  const ledger = [
    {
      label: 'Score',
      verdict: `${score.home}-${score.away}`,
      reason: `${goalTimeline}${disallowedText}`,
    },
    {
      label: 'BTTS',
      verdict: score.home > 0 && score.away > 0 ? 'Yes' : 'No',
      reason:
        score.home > 0 && score.away > 0
          ? `Both teams scored: ${home} ${score.home}, ${away} ${score.away}.`
          : `${score.home === 0 ? home : away} did not score${xgH !== null && xgA !== null ? ` despite ${fmt(score.home === 0 ? xgH : xgA)} xG` : ''}.`,
    },
    {
      label: 'Goals',
      verdict: `${total} · ${total > line ? 'over' : total < line ? 'under' : 'push'} ${line}`,
      reason:
        xgH !== null && xgA !== null
          ? `Combined xG ${fmt(xgH + xgA)} produced ${total} goal${total === 1 ? '' : 's'}; ${stoppedBy()}.`
          : `${total} goals were scored against a ${line} line.`,
    },
    {
      label: 'Result',
      verdict: score.home > score.away ? `${home} win` : score.home < score.away ? `${away} win` : 'Draw',
      reason: factors[0]?.summary || 'See the reasons below.',
    },
  ];

  return `<section class="detail-section">
    <div class="section-head"><h2>Why this happened</h2><span class="section-sub">Cause and effect · three sources</span></div>
    <p class="rp-why-lead">${escapeHtml(`${resultText} ${lead}`.trim())}</p>
    <div class="rp-ledger">
      ${ledger
        .map(
          (row) => `<div class="rp-ledger-row">
            <span class="rp-ledger-label">${escapeHtml(row.label)}</span>
            <b class="rp-ledger-verdict">${escapeHtml(row.verdict)}</b>
            <p>${escapeHtml(row.reason)}</p>
          </div>`,
        )
        .join('')}
    </div>
    <div class="rp-factors">
      ${factors
        .map(
          (factor) => `<article class="rp-factor">
            <b class="rp-factor-title">${escapeHtml(factor.title)}</b>
            <p class="rp-factor-summary">${escapeHtml(factor.summary)}</p>
            <p class="rp-factor-detail">${escapeHtml(factor.detail)}</p>
            <small>${escapeHtml(factor.source)}</small>
          </article>`,
        )
        .join('')}
    </div>
  </section>`;
}

function reportStat(stage, label) {
  for (const group of stage?.groups || []) {
    const found = group.stats.find((stat) => stat.label.toLowerCase() === label.toLowerCase());
    if (found) return found;
  }
  return null;
}

function statNumber(value) {
  const number = Number.parseFloat(String(value ?? '').replace('%', ''));
  return Number.isFinite(number) ? number : null;
}

function reportEvidence(data) {
  const sw = data.soccerway;
  if (!sw?.hasEvents) return '';

  const stage = (sw.stats?.stages || []).find((entry) => /^match$/i.test(entry.name));
  const home = reportSideName(data, 'home');
  const away = reportSideName(data, 'away');
  const goals = sw.goals || [];
  const squared = reportOutcome(data);
  const bullets = [];

  const xg = reportStat(stage, 'Expected goals (xG)');
  if (xg && squared.score) {
    const homeXg = statNumber(xg.home);
    const awayXg = statNumber(xg.away);
    if (homeXg !== null && awayXg !== null) {
      const homeDiff = squared.score.home - homeXg;
      const awayDiff = squared.score.away - awayXg;
      bullets.push({
        label: 'Goals vs xG',
        text: `${home} ${squared.score.home} goal${squared.score.home === 1 ? '' : 's'} from ${homeXg.toFixed(
          2,
        )} xG (${homeDiff >= 0 ? '+' : ''}${homeDiff.toFixed(2)}); ${away} ${
          squared.score.away
        } from ${awayXg.toFixed(2)} xG (${awayDiff >= 0 ? '+' : ''}${awayDiff.toFixed(2)}).`,
        source: 'Soccerway stats',
      });
    }
  }

  const shots = reportStat(stage, 'Total shots');
  const onTarget = reportStat(stage, 'Shots on target');
  if (shots && onTarget) {
    bullets.push({
      label: 'Shooting',
      text: `${home} ${shots.home} shots (${onTarget.home} on target), ${away} ${shots.away} shots (${onTarget.away} on target).`,
      source: 'Soccerway stats',
    });
  }

  const firstHalf = (sw.halves || [])[0];
  if (firstHalf && squared.score) {
    bullets.push({
      label: 'Half story',
      text: `Half-time ${firstHalf.home}-${firstHalf.away}; second half ${squared.score.home - firstHalf.home}-${squared.score.away - firstHalf.away}.`,
      source: 'Soccerway summary',
    });
  }

  if (goals.length) {
    bullets.push({
      label: 'Goals',
      text: goals
        .map(
          (goal) =>
            `${goal.minute} ${goal.player}${goal.assist ? ` (assist ${goal.assist})` : ''} for ${
              goal.side === 'home' ? home : away
            }${goal.score ? ` — ${goal.score.home}-${goal.score.away}` : ''}`,
        )
        .join('; ') + '.',
      source: 'Soccerway incidents',
    });
  }

  if (sw.disallowed?.length) {
    bullets.push({
      label: 'Goal ruled out',
      text: sw.disallowed
        .map(
          (entry) =>
            `${entry.minute} ${entry.player} (${entry.side === 'home' ? home : away})${
                            entry.reason ? ` — ${entry.reason.toLowerCase()}` : ''
            }, goal disallowed`,
        )
        .join('; ') + '.',
      source: 'Soccerway incidents',
    });
  }

  const cards = sw.cards || [];
  if (cards.length) {
    const grouped = ['home', 'away']
      .map((side) => {
        const list = cards.filter((card) => card.side === side);
        if (!list.length) return null;
        return `${side === 'home' ? home : away} ${list.length} (${list
          .map((card) => `${card.reason || card.type} ${card.minute}`)
          .join(', ')})`;
      })
      .filter(Boolean);
    bullets.push({
      label: 'Discipline',
      text: `${grouped.join('; ')}.`,
      source: 'Soccerway incidents',
    });
  }

  const bttsPrice = data.prematch?.bts ? bestPrice(data.prematch.bts, 'Yes') : null;
  const ouPrice = data.prematch?.ou ? bestPrice(data.prematch.ou, 'Over') : null;
  const ouLine = data.prematch?.ou ? marketLine(data.prematch.ou)?.line : null;
  if (bttsPrice || ouPrice) {
    bullets.push({
      label: 'Market read',
      text: [
        bttsPrice ? `BTTS yes was ${bttsPrice.value.toFixed(2)} and ${squared.btts ? 'landed' : 'did not land'}` : null,
        ouPrice && ouLine
          ? `O/U ${ouLine}: over was ${ouPrice.value.toFixed(2)} and ${squared.total} goals was ${
              squared.total > Number(ouLine) ? 'over' : squared.total < Number(ouLine) ? 'under' : 'a push'
            }`
          : null,
      ]
        .filter(Boolean)
        .join('; ') + '.',
      source: 'BetExplorer odds',
    });
  }

  const news = data.statshub?.teamNews;
  if (news && (news.home?.length || news.away?.length)) {
    bullets.push({
      label: 'Availability',
      text: `${home} ${news.home?.length || 0} unavailable${
        news.home?.length ? ` (${news.home.map((item) => `${item.name} ${item.status.toLowerCase()}`).join(', ')})` : ''
      }; ${away} ${news.away?.length || 0} unavailable${
        news.away?.length ? ` (${news.away.map((item) => `${item.name} ${item.status.toLowerCase()}`).join(', ')})` : ''
      }.`,
      source: 'StatsHub team news',
    });
  }

  if (!bullets.length) return '';

  return `<section class="detail-section">
    <div class="section-head"><h2>What the data shows</h2><span class="section-sub">Facts only</span></div>
    <div class="rp-evidence">
      ${bullets
        .map(
          (bullet) => `<div class="rp-evidence-row">
            <b>${escapeHtml(bullet.label)}</b>
            <p>${escapeHtml(bullet.text)}</p>
            <small>${escapeHtml(bullet.source)}</small>
          </div>`,
        )
        .join('')}
    </div>
  </section>`;
}

function goalType(text) {
  const value = String(text || '').toLowerCase();
  const tags = [];
  if (value.includes('penalty')) tags.push('Penalty');
  else if (value.includes('free kick') || value.includes('free-kick')) tags.push('Free kick');
  else if (
    value.includes('corner kick') ||
    value.includes('from a corner') ||
    value.includes('from the corner')
  ) {
    tags.push('Corner');
  }
  if (value.includes('rebound')) tags.push('Rebound');
  if (value.includes('header')) tags.push('Header');
  if (value.includes('counter')) tags.push('Counter');
  if (
    value.includes('through') ||
    value.includes('super pass') ||
    value.includes('lofted pass')
  ) {
    tags.push('Through ball');
  }
  if (
    value.includes('outside the box') ||
    value.includes('from distance') ||
    value.includes('long range')
  ) {
    tags.push('Outside the box');
  }
  return [...new Set(tags.length ? tags : ['Open play'])].slice(0, 3).join(' · ');
}

function reportGoals(data) {
  const sw = data.soccerway;
  const goals = sw?.goals || [];
  const disallowed = sw?.disallowed || [];
  if (!goals.length && !disallowed.length) return '';

  const home = reportSideName(data, 'home');
  const away = reportSideName(data, 'away');

  return `<section class="detail-section">
    <div class="section-head"><h2>Goals</h2><span class="section-sub">${goals.length} scored · Soccerway</span></div>
    <div class="rp-events">
      ${goals
        .map(
          (goal) => `<article class="rp-event">
            <span class="rp-minute">${escapeHtml(goal.minute)}</span>
            <div class="rp-event-body">
              <div class="rp-event-title">
                <b>${escapeHtml(goal.player)}</b>
                <span class="rp-side">${escapeHtml(goal.side === 'home' ? home : away)}</span>
                <span class="rp-goal-type">${escapeHtml(goalType(goal.text))}</span>
                ${goal.score ? `<span class="rp-score-badge">${goal.score.home}-${goal.score.away}</span>` : ''}
              </div>
              ${goal.assist ? `<div class="rp-assist">Assist: ${escapeHtml(goal.assist)}</div>` : '<div class="rp-assist">No assist recorded</div>'}
              ${goal.text ? `<p class="rp-quote">${escapeHtml(goal.text)}</p>` : ''}
            </div>
          </article>`,
        )
        .join('')}
      ${disallowed
        .map(
          (entry) => `<article class="rp-event is-disallowed">
            <span class="rp-minute">${escapeHtml(entry.minute)}</span>
            <div class="rp-event-body">
              <div class="rp-event-title">
                <b>${escapeHtml(entry.player)}</b>
                <span class="rp-side">${escapeHtml(entry.side === 'home' ? home : away)}</span>
                <span class="rp-score-badge">disallowed</span>
              </div>
              ${entry.reason ? `<div class="rp-assist">Reason: ${escapeHtml(entry.reason)}</div>` : ''}
              ${entry.text ? `<p class="rp-quote">${escapeHtml(entry.text)}</p>` : ''}
            </div>
          </article>`,
        )
        .join('')}
    </div>
  </section>`;
}

function reportCards(data) {
  const cards = data.soccerway?.cards || [];
  if (!cards.length) return '';
  const home = reportSideName(data, 'home');
  const away = reportSideName(data, 'away');

  return `<section class="detail-section">
    <div class="section-head"><h2>Cards</h2><span class="section-sub">${cards.length} · with reasons</span></div>
    <div class="rp-events">
      ${cards
        .map(
          (card) => `<article class="rp-event">
            <span class="rp-minute">${escapeHtml(card.minute)}</span>
            <div class="rp-event-body">
              <div class="rp-event-title">
                <i class="rp-card-swatch ${card.color}"></i>
                <b>${escapeHtml(card.player)}</b>
                <span class="rp-side">${escapeHtml(card.side === 'home' ? home : away)}</span>
              </div>
              <div class="rp-assist">${escapeHtml(card.type)}${card.reason ? ` — ${escapeHtml(card.reason)}` : ''}</div>
              ${card.text ? `<p class="rp-quote">${escapeHtml(card.text)}</p>` : ''}
            </div>
          </article>`,
        )
        .join('')}
    </div>
  </section>`;
}

function reportSubstitutions(data) {
  const subs = data.soccerway?.substitutions || [];
  if (!subs.length) return '';
  const home = reportSideName(data, 'home');
  const away = reportSideName(data, 'away');

  return `<section class="detail-section">
    <div class="section-head"><h2>Substitutions</h2><span class="section-sub">${subs.length} · Soccerway</span></div>
    <div class="rp-events">
      ${subs
        .map(
          (sub) => `<article class="rp-event">
            <span class="rp-minute">${escapeHtml(sub.minute)}</span>
            <div class="rp-event-body">
              <div class="rp-event-title">
                <b>${escapeHtml(sub.in || '—')}</b>
                <span class="rp-side">on for ${escapeHtml(sub.out || '—')} · ${escapeHtml(
                  sub.side === 'home' ? home : away,
                )}</span>
              </div>
              ${sub.text ? `<p class="rp-quote">${escapeHtml(sub.text)}</p>` : ''}
            </div>
          </article>`,
        )
        .join('')}
    </div>
  </section>`;
}

function reportStats(data) {
  const stages = data.soccerway?.stats?.stages || [];
  const stage = stages.find((entry) => entry.name && entry.groups?.length);
  const hasValues = stages.some((entry) =>
    (entry.groups || []).some((group) =>
      (group.stats || []).some((stat) => statNumber(stat.home) || statNumber(stat.away)),
    ),
  );
  if (!stages.length || !stage || !hasValues) return '';

  const keys = [
    ['match', 'Match'],
    ['first', '1st Half'],
    ['second', '2nd Half'],
  ];
  const active = keys.find(([key]) => key === state.detail.reportStage) || keys[0];
  const wanted = stages.find(
    (entry) => entry.name.toLowerCase() === active[1].toLowerCase(),
  ) || stage;
  const home = reportSideName(data, 'home');
  const away = reportSideName(data, 'away');

  return `<section class="detail-section">
    <div class="section-head"><h2>Match stats by period</h2><span class="section-sub">Soccerway</span></div>
    <div class="rp-stage-tabs" role="group" aria-label="Stats period">
      ${keys
        .map(
          ([key, label]) =>
            `<button class="rp-stage${key === active[0] ? ' is-active' : ''}" type="button" data-report-stage="${key}">${label}</button>`,
        )
        .join('')}
    </div>
    <div class="rp-stat-head"><span>${escapeHtml(home)}</span><span></span><span>${escapeHtml(away)}</span></div>
    ${wanted.groups
      .map(
        (group) => `<div class="rp-stat-group">${escapeHtml(group.name)}</div>
        ${group.stats
          .map((stat) => {
            const homeValue = statNumber(stat.home);
            const awayValue = statNumber(stat.away);
            return `<div class="rp-stat-row">
              <span class="rp-stat-val${homeValue !== null && awayValue !== null && homeValue > awayValue ? ' is-strong' : ''}">${statText(stat.home)}</span>
              <span class="rp-stat-label">${escapeHtml(stat.label)}</span>
              <span class="rp-stat-val away${homeValue !== null && awayValue !== null && awayValue > homeValue ? ' is-strong' : ''}">${statText(stat.away)}</span>
            </div>`;
          })
          .join('')}`,
      )
      .join('')}
  </section>`;
}

function commentBadge(type) {
  const value = String(type || '').toLowerCase();
  if (value.includes('whistle')) return 'FT';
  if (value.includes('goal')) return 'G';
  if (value.includes('card')) return value.includes('red') ? 'R' : 'Y';
  if (value.includes('substitution')) return 'SUB';
  if (value.includes('corner')) return 'C';
  if (value.includes('time')) return 'T';
  if (value.includes('funfact')) return 'F';
  return '·';
}

function reportCommentary(data) {
  const all = data.soccerway?.commentary || [];
  if (!all.length) return '';

  const filter = state.detail.commentFilter === 'important' ? 'important' : 'all';
  const filtered = filter === 'important' ? all.filter((row) => row.important) : all;
  const visible = state.detail.commentsAll ? filtered : filtered.slice(0, 25);

  return `<section class="detail-section">
    <div class="section-head"><h2>Commentary</h2><span class="section-sub">${all.length} entries · Soccerway</span></div>
    <div class="rp-comment-tabs" role="group" aria-label="Commentary filter">
      <button class="rp-comment-filter${filter === 'all' ? ' is-active' : ''}" type="button" data-comment-filter="all">All comments</button>
      <button class="rp-comment-filter${filter === 'important' ? ' is-active' : ''}" type="button" data-comment-filter="important">Important only</button>
    </div>
    <div class="rp-comments">
      ${visible
        .map(
          (row) => `<div class="rp-comment${row.important ? ' is-important' : ''}">
            <span class="rp-comment-minute">${escapeHtml(row.minute)}</span>
            <i class="rp-comment-badge">${escapeHtml(commentBadge(row.type))}</i>
            <p>${escapeHtml(row.text)}</p>
          </div>`,
        )
        .join('')}
    </div>
    ${
      filtered.length > 25
        ? `<button class="show-more" type="button" data-action="comments-all">${
            state.detail.commentsAll ? 'Show fewer comments' : `Show all ${filtered.length} comments`
          }</button>`
        : ''
    }
  </section>`;
}

function formSummary(form) {
  const matches = form?.matches || [];
  let wins = 0;
  let draws = 0;
  let losses = 0;
  let goalsFor = 0;
  let goalsAgainst = 0;
  for (const match of matches) {
    if (match.result === 'w') wins += 1;
    else if (match.result === 'd') draws += 1;
    else if (match.result === 'l') losses += 1;
    const own = match.isHome ? match.score.home : match.score.away;
    const other = match.isHome ? match.score.away : match.score.home;
    if (own !== null && other !== null) {
      goalsFor += own;
      goalsAgainst += other;
    }
  }
  return {
    matches,
    wins,
    draws,
    losses,
    goalsFor,
    goalsAgainst,
    ppg: matches.length ? (wins * 3 + draws) / matches.length : null,
  };
}

function reportPrematch(data) {
  const sh = data.statshub;
  const sw = data.soccerway;
  const h2h = data.h2h;
  const home = reportSideName(data, 'home');
  const away = reportSideName(data, 'away');
  const news = sh?.teamNews || { home: [], away: [] };
  const homeForm = formSummary(sh?.form?.home);
  const awayForm = formSummary(sh?.form?.away);
  const lineup = (side) => sh?.lineups?.[side] || null;

  const formRow = (name, form, side) =>
    form.matches.length
      ? `<div class="rp-form-row">
          <span class="rp-form-team">${escapeHtml(name)}</span>
          <span class="rp-form-record"><b>${form.wins}</b>W <b>${form.draws}</b>D <b>${form.losses}</b>L</span>
          <span class="rp-form-detail">${form.goalsFor}-${form.goalsAgainst} · ${form.ppg.toFixed(2)} PPG</span>
          ${formChips(sh?.form?.[side])}
        </div>`
      : '';

  const lineupRow = (name, side) => {
    const entry = lineup(side);
    if (!entry) return '';
    return `<div class="rp-dossier-row"><span>${escapeHtml(name)} XI</span><b>${escapeHtml(
      entry.formation || '—',
    )} · ${escapeHtml(lineupSource(entry))}</b></div>`;
  };

  const h2hSummary = h2h?.summary;

  const keyPlayers = (side) =>
    (sh?.squads?.[side] || [])
      .slice()
      .sort(
        (a, b) =>
          (b.season?.goals || 0) - (a.season?.goals || 0) ||
          (b.season?.rating || 0) - (a.season?.rating || 0),
      )
      .slice(0, 3);

  const keyPlayerRows = (side, name) => {
    const players = keyPlayers(side);
    if (!players.length) return '';
    return `<div class="rp-subhead">Key players · ${escapeHtml(name)}</div>
      <div class="rp-players">
        ${players
          .map(
            (player) => `<div class="rp-player-row">
              ${playerPhoto(player, 'rp-player-photo')}
              <span class="rp-player-name"><b>${escapeHtml(player.shortName)}</b><em>${escapeHtml(
                player.position,
              )}</em></span>
              <span class="rp-player-stat">${player.season?.goals || 0}G ${
                player.season?.assists || 0
              }A</span>
              <span class="rp-player-rating">${statText(player.season?.rating)}</span>
            </div>`,
          )
          .join('')}
      </div>`;
  };

  return `<section class="detail-section">
    <div class="section-head"><h2>Pre-match dossier</h2><span class="section-sub">Before kick-off</span></div>

    <div class="rp-dossier">
      <div class="rp-dossier-row"><span>Kick-off</span><b>${escapeHtml(
        `${data.match.dateLabel || data.match.date || ''} ${data.match.time || ''}`.trim() || '—',
      )}</b></div>
      ${sw?.info?.REF ? `<div class="rp-dossier-row"><span>Referee</span><b>${escapeHtml(sw.info.REF)}</b></div>` : ''}
      ${sw?.info?.VEN ? `<div class="rp-dossier-row"><span>Venue</span><b>${escapeHtml(sw.info.VEN)}</b></div>` : ''}
      ${sw?.info?.ATT ? `<div class="rp-dossier-row"><span>Attendance</span><b>${escapeHtml(sw.info.ATT)}</b></div>` : ''}
      ${h2hSummary ? `<div class="rp-dossier-row"><span>H2H (last ${h2hSummary.total})</span><b>${h2hSummary.wins}W ${h2hSummary.draws}D ${h2hSummary.losses}L</b></div>` : ''}
      ${lineupRow(home, 'home')}
      ${lineupRow(away, 'away')}
    </div>

    <div class="rp-subhead">Form · last ${homeForm.matches.length || 20}</div>
    ${formRow(home, homeForm, 'home')}
    ${formRow(away, awayForm, 'away')}

    ${keyPlayerRows('home', home)}
    ${keyPlayerRows('away', away)}

    ${sh ? comparisonRows(sh) : ''}

    <div class="rp-subhead">Availability</div>
    <div class="news-grid">
      ${teamNewsColumn(news.home || [], sh?.homeTeam || { name: home })}
      ${teamNewsColumn(news.away || [], sh?.awayTeam || { name: away })}
    </div>
  </section>`;
}

function reportSources() {
  return `<section class="detail-section">
    <div class="section-head"><h2>Sources</h2><span class="section-sub">Three-site report</span></div>
    <p class="rp-source">BetExplorer: odds, H2H, standings. StatsHub: form, lineups, team news, player and team stats. Soccerway: incidents, card reasons, assists, commentary, match info and first/second-half splits. The “why” section is generated only from these feeds: every reason names the numbers or quotes behind it.</p>
  </section>`;
}

function detailReportTab(data) {
  const sw = data.soccerway;
  const parts = [reportHero(data), reportMarkets(data), reportWhy(data), reportChanceBlame(data), reportEvidence(data), reportGoals(data), reportCards(data), reportSubstitutions(data), reportStats(data), reportCommentary(data), reportPrematch(data), reportSources()];

  if (!sw) {
    parts.unshift(`<section class="detail-section">
      <div class="section-head"><h2>Match report</h2><span class="section-sub">Soccerway</span></div>
      <p class="section-note">Soccerway did not return a report for this match. Pre-match data from BetExplorer and StatsHub is still shown below.</p>
    </section>`);
  }

  return parts.filter(Boolean).join('');
}

