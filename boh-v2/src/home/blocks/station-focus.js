// BOH OS v2 — Home Block: Station Focus
// HOME-01: up to 3 highest-priority prep items for the user's station.
//
// Role gate: staff, supervisor (NOT admin, executive_chef — they see station_overview).
// Reuses existing fetchStationPrepTasks + fetchPrepSuggestions services.
// These are injected via deps.fetchService (the home panel renderer wires them).
//
// Content rules (per Composition Engine §BLOCK: station_focus):
//   - Station name header
//   - Up to 3 prep items ordered: do_first → do_today → in_progress
//   - Each item: name + suggestion status label + quantity/unit if known
//   - One action: "Open station" → deps.openPanel('station-prep', { stationName })
//   - If no urgent prep: show calm "Station looks ready" text
//   - Always shown for station users with defaultStation (never empty for them)

import {
  BLOCK_DEFINITIONS,
  BLOCK_FETCHERS,
  BLOCK_RENDERERS,
} from '../home-block-registry.js';

import { supabase } from '../../core/supabase-client.js';

// ── Registration ───────────────────────────────────────────────────────

BLOCK_DEFINITIONS['station_focus'] = {
  blockId:        'station_focus',
  basePriority:   2,
  sizeClass:      'M',
  financialFlag:  false,
  // BL-21: authoritative role gate — staff and supervisor only
  permittedRoles: new Set(['staff', 'supervisor']),
  cacheTTL:       null,
  timeout:        8000,
};

BLOCK_FETCHERS['station_focus'] = async (user /*, signal */) => {
  const stationName = typeof user.defaultStation === 'string'
    ? user.defaultStation.trim()
    : null;

  // No station assigned — hasContent true but shows info state
  if (!stationName) {
    return {
      hasContent:   true,
      urgencyScore: 0,
      data:         { stationName: null, items: [], noStation: true },
    };
  }

  try {
    // Fetch tasks for this station
    const { data: taskRows, error: taskErr } = await supabase
      .from('prep_tasks')
      .select('id, name, unit, current_stock, in_progress, prep_type')
      .eq('category', stationName)
      .eq('archived', false)
      .order('name', { ascending: true });

    if (taskErr) throw taskErr;

    if (!taskRows || taskRows.length === 0) {
      return {
        hasContent:   true,
        urgencyScore: 0,
        data:         { stationName, items: [], noStation: false },
      };
    }

    const taskIds = taskRows.map((r) => r.id);

    // Fetch suggestions for all task IDs (paginated, reusing same logic pattern)
    const today    = _toLocalDateString(new Date());
    const sevenAgo = _localDateDaysAgo(7);

    // Find latest valid suggestion date (≥50 rows)
    const { data: dateRows, error: dateErr } = await supabase
      .from('prep_suggestions_daily')
      .select('suggestion_date, prep_task_id')
      .gte('suggestion_date', sevenAgo)
      .lte('suggestion_date', today)
      .order('suggestion_date', { ascending: false })
      .limit(500);

    let validDate = null;
    if (!dateErr && dateRows && dateRows.length > 0) {
      const counts = new Map();
      for (const row of dateRows) {
        counts.set(row.suggestion_date, (counts.get(row.suggestion_date) ?? 0) + 1);
      }
      const seen = [];
      for (const row of dateRows) {
        const d = row.suggestion_date;
        if (!seen.includes(d)) {
          seen.push(d);
          if (counts.get(d) >= 50) { validDate = d; break; }
        }
      }
    }

    // Fetch suggestions for valid date
    const suggMap = {};
    if (validDate) {
      const { data: suggRows, error: suggErr } = await supabase
        .from('prep_suggestions_daily')
        .select('prep_task_id, status, planned_output, output_unit')
        .eq('suggestion_date', validDate)
        .in('prep_task_id', taskIds);

      if (!suggErr && suggRows) {
        for (const row of suggRows) {
          suggMap[row.prep_task_id] = {
            status:       row.status,
            plannedOutput: row.planned_output,
            outputUnit:    row.output_unit,
          };
        }
      }
    }

    // Merge and rank
    const scored = taskRows.map((task) => {
      const sugg = suggMap[task.id] ?? null;
      const status = sugg?.status ?? (task.in_progress ? 'in_progress' : null);
      return {
        id:      task.id,
        name:    task.name,
        unit:    task.unit,
        stock:   task.current_stock,
        status,
        plannedOutput: sugg?.plannedOutput ?? null,
        outputUnit:    sugg?.outputUnit ?? task.unit ?? null,
        score:   _statusScore(status),
      };
    });

    // Sort by priority score, take top 3
    scored.sort((a, b) => a.score - b.score);
    const items = scored.filter((t) => t.score < 99).slice(0, 3);
    const hasUrgent = items.some((t) => t.status === 'do_first');

    return {
      hasContent:   true,
      urgencyScore: hasUrgent ? -2 : 0,
      data:         { stationName, items, noStation: false },
    };

  } catch (_err) {
    return {
      hasContent:   true,
      urgencyScore: 0,
      data:         { stationName, items: [], error: true, noStation: false },
    };
  }
};

BLOCK_RENDERERS['station_focus'] = {
  skeleton() {
    const el = document.createElement('div');
    el.className = 'home-station-focus home-station-focus--skeleton';
    for (let i = 0; i < 3; i++) {
      const row = document.createElement('div');
      row.className = 'home-station-focus__skeleton-row';
      el.appendChild(row);
    }
    return el;
  },

  content(data, deps) {
    const el = document.createElement('div');
    el.className = 'home-station-focus';

    const t = (key) => deps.translate(key);

    // Station name header
    const header = document.createElement('div');
    header.className = 'home-station-focus__header';

    const stationLabel = document.createElement('span');
    stationLabel.className = 'home-station-focus__station-name';
    stationLabel.textContent = data.stationName ?? t('home.station_focus_no_station');
    header.appendChild(stationLabel);
    el.appendChild(header);

    if (data.noStation) {
      const msg = document.createElement('p');
      msg.className = 'home-station-focus__calm';
      msg.textContent = t('home.station_focus_no_station');
      el.appendChild(msg);
      return el;
    }

    // Prep items
    if (data.items && data.items.length > 0) {
      const list = document.createElement('ul');
      list.className = 'home-station-focus__list';
      list.setAttribute('role', 'list');

      for (const item of data.items) {
        const li = document.createElement('li');
        li.className = 'home-station-focus__item';

        const nameEl = document.createElement('span');
        nameEl.className = 'home-station-focus__item-name';
        nameEl.textContent = item.name;

        const badge = document.createElement('span');
        badge.className = `home-station-focus__badge home-station-focus__badge--${_badgeClass(item.status)}`;
        badge.textContent = _statusLabel(item.status, deps);

        li.appendChild(nameEl);
        li.appendChild(badge);

        // Quantity when available
        if (item.plannedOutput != null && item.outputUnit) {
          const qty = document.createElement('span');
          qty.className = 'home-station-focus__qty';
          qty.textContent = `${item.plannedOutput} ${item.outputUnit}`;
          li.appendChild(qty);
        }

        list.appendChild(li);
      }
      el.appendChild(list);
    } else {
      // All prep looks good
      const calm = document.createElement('p');
      calm.className = 'home-station-focus__calm';
      calm.textContent = t('home.station_focus_ready');
      el.appendChild(calm);
    }

    // "Open station" CTA
    if (data.stationName) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'home-station-focus__cta';
      btn.textContent = t('home.station_focus_open');
      btn.addEventListener('click', () => {
        deps.openPanel('station-prep', { stationName: data.stationName });
      });
      el.appendChild(btn);
    }

    return el;
  },

  error(deps) {
    const el = document.createElement('div');
    el.className = 'home-station-focus';
    const msg = document.createElement('p');
    msg.className = 'home-station-focus__error';
    msg.textContent = deps.translate('home.block_error');
    el.appendChild(msg);
    return el;
  },
};

// ── Helpers ────────────────────────────────────────────────────────────

function _statusScore(status) {
  switch (status) {
    case 'do_first':    return 0;
    case 'in_progress': return 1;
    case 'do_today':    return 2;
    case 'check':       return 3;
    case 'count_first': return 4;
    case 'looks_good':  return 99; // exclude from top-3 priority
    default:            return 50;
  }
}

function _badgeClass(status) {
  switch (status) {
    case 'do_first':    return 'urgent';
    case 'in_progress': return 'active';
    case 'do_today':    return 'normal';
    default:            return 'calm';
  }
}

function _statusLabel(status, deps) {
  const map = {
    do_first:    'station_prep.suggestion_do_first',
    do_today:    'station_prep.suggestion_do_today',
    in_progress: 'station_prep.status_in_progress',
    looks_good:  'station_prep.suggestion_looks_good',
    count_first: 'station_prep.suggestion_count_first',
    check:       'station_prep.suggestion_check',
  };
  const key = map[status];
  return key ? deps.translate(key) : (status ?? '—');
}

function _toLocalDateString(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function _localDateDaysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return _toLocalDateString(d);
}
