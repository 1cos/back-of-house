// BOH OS v2 — Home Block: Station Overview
// HOME-01: one compact row per station with urgent/in_progress/ready counts.
//
// Role gate: admin, executive_chef, supervisor.
// Direct Supabase call in the fetcher — counts prep_tasks by category and status.
// No money data. No raw IDs in UI. Navigation only through deps.openPanel.
//
// Content rules (per Composition Engine §BLOCK: station_overview):
//   - One row per station: station name + [N urgent] [N in_progress] [N ready]
//   - Tapping a row opens station-prep via deps.openPanel('station-prep', { stationName })
//   - Financial flag: false

import {
  BLOCK_DEFINITIONS,
  BLOCK_FETCHERS,
  BLOCK_RENDERERS,
} from '../home-block-registry.js';

import { supabase } from '../../core/supabase-client.js';

// ── Stations to display (same order as DB) ────────────────────────────
// These are the operational station categories. Excludes 'Dish Crew'
// (dish crew has their own block) and any archived/meta categories.
const STATION_CATEGORIES = [
  'Oven',
  'Pasta',
  'Fresh Pasta Station',
  'Sauté',
  'Saucier',
  'Salad',
  'Plating',
  'Table Side',
  'Pastry',
];

// ── Registration ───────────────────────────────────────────────────────

BLOCK_DEFINITIONS['station_overview'] = {
  blockId:        'station_overview',
  basePriority:   3,  // executive_chef: 3 per Composition Engine §5.5 override
  sizeClass:      'M',
  financialFlag:  false,
  // BL-21: authoritative role gate — admin, executive_chef, supervisor
  permittedRoles: new Set(['admin', 'executive_chef', 'supervisor']),
  cacheTTL:       null,
  timeout:        8000,
};

BLOCK_FETCHERS['station_overview'] = async (user /*, signal */) => {
  try {
    // Load all non-archived prep tasks with their suggestion status
    const { data: taskRows, error: taskErr } = await supabase
      .from('prep_tasks')
      .select('id, category, in_progress')
      .eq('archived', false)
      .in('category', STATION_CATEGORIES);

    if (taskErr) throw taskErr;
    if (!taskRows || taskRows.length === 0) {
      return { hasContent: false, urgencyScore: 0, data: { stations: [] } };
    }

    // Find latest valid suggestion date (same logic as station-focus)
    const today    = _toLocalDateString(new Date());
    const sevenAgo = _localDateDaysAgo(7);

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

    // Fetch suggestion statuses
    const suggMap = {};
    if (validDate) {
      const allIds = taskRows.map((r) => r.id);
      const { data: suggRows, error: suggErr } = await supabase
        .from('prep_suggestions_daily')
        .select('prep_task_id, status')
        .eq('suggestion_date', validDate)
        .in('prep_task_id', allIds);

      if (!suggErr && suggRows) {
        for (const row of suggRows) {
          suggMap[row.prep_task_id] = row.status;
        }
      }
    }

    // Aggregate per station
    const stationMap = {};
    for (const station of STATION_CATEGORIES) {
      stationMap[station] = { urgent: 0, inProgress: 0, ready: 0, total: 0 };
    }

    for (const task of taskRows) {
      const cat = task.category;
      if (!stationMap[cat]) continue;
      stationMap[cat].total += 1;

      const status = suggMap[task.id] ?? (task.in_progress ? 'in_progress' : null);
      if (status === 'do_first') {
        stationMap[cat].urgent += 1;
      } else if (status === 'in_progress' || task.in_progress) {
        stationMap[cat].inProgress += 1;
      } else if (status === 'looks_good') {
        stationMap[cat].ready += 1;
      }
    }

    // Only include stations that have tasks
    const stations = STATION_CATEGORIES
      .filter((s) => stationMap[s].total > 0)
      .map((s) => ({
        name:       s,
        urgent:     stationMap[s].urgent,
        inProgress: stationMap[s].inProgress,
        ready:      stationMap[s].ready,
        total:      stationMap[s].total,
      }));

    if (stations.length === 0) {
      return { hasContent: false, urgencyScore: 0, data: { stations: [] } };
    }

    const hasUrgent = stations.some((s) => s.urgent > 0);
    return {
      hasContent:   true,
      urgencyScore: hasUrgent ? -2 : 0,
      data:         { stations },
    };

  } catch (_err) {
    return { hasContent: true, urgencyScore: 0, data: { stations: [], error: true } };
  }
};

BLOCK_RENDERERS['station_overview'] = {
  skeleton() {
    const el = document.createElement('div');
    el.className = 'home-station-overview home-station-overview--skeleton';
    for (let i = 0; i < 5; i++) {
      const row = document.createElement('div');
      row.className = 'home-station-overview__skeleton-row';
      el.appendChild(row);
    }
    return el;
  },

  content(data, deps) {
    const el = document.createElement('div');
    el.className = 'home-station-overview';

    const t = (key) => deps.translate(key);

    // Header
    const header = document.createElement('p');
    header.className = 'home-station-overview__header';
    header.textContent = t('home.station_overview_title');
    el.appendChild(header);

    if (data.error || !data.stations || data.stations.length === 0) {
      const msg = document.createElement('p');
      msg.className = 'home-station-overview__empty';
      msg.textContent = t('home.station_overview_empty');
      el.appendChild(msg);
      return el;
    }

    const list = document.createElement('ul');
    list.className = 'home-station-overview__list';
    list.setAttribute('role', 'list');

    for (const station of data.stations) {
      const li = document.createElement('li');
      li.className = 'home-station-overview__row';

      // Status indicator dot
      const dot = document.createElement('span');
      dot.className = `home-station-overview__dot home-station-overview__dot--${_dotClass(station)}`;
      dot.setAttribute('aria-hidden', 'true');

      // Station name
      const name = document.createElement('span');
      name.className = 'home-station-overview__name';
      name.textContent = station.name;

      // Counts
      const counts = document.createElement('span');
      counts.className = 'home-station-overview__counts';
      counts.textContent = _countsText(station, deps);

      li.appendChild(dot);
      li.appendChild(name);
      li.appendChild(counts);

      // Tap → open station
      li.setAttribute('role', 'button');
      li.setAttribute('tabindex', '0');
      li.addEventListener('click', () => {
        deps.openPanel('station-prep', { stationName: station.name });
      });
      li.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          deps.openPanel('station-prep', { stationName: station.name });
        }
      });

      list.appendChild(li);
    }

    el.appendChild(list);
    return el;
  },

  error(deps) {
    const el = document.createElement('div');
    el.className = 'home-station-overview';
    const msg = document.createElement('p');
    msg.className = 'home-station-overview__error';
    msg.textContent = deps.translate('home.block_error');
    el.appendChild(msg);
    return el;
  },
};

// ── Helpers ────────────────────────────────────────────────────────────

function _dotClass(station) {
  if (station.urgent > 0)     return 'urgent';
  if (station.inProgress > 0) return 'active';
  if (station.ready === station.total && station.total > 0) return 'ready';
  return 'normal';
}

function _countsText(station, deps) {
  const parts = [];
  if (station.urgent > 0)     parts.push(`${station.urgent} ${deps.translate('home.station_overview_urgent')}`);
  if (station.inProgress > 0) parts.push(`${station.inProgress} ${deps.translate('home.station_overview_in_progress')}`);
  if (station.ready > 0)      parts.push(`${station.ready} ${deps.translate('home.station_overview_ready')}`);
  return parts.length > 0 ? parts.join(' · ') : deps.translate('home.station_overview_no_data');
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
