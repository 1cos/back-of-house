// BOH OS v2 — Home Block: Station Overview
// HOME-01: one compact row per station with urgent/in_progress/ready counts.
//
// Role gate: admin, executive_chef, supervisor.
// Trust & Clean: Supabase access moved to home-prep-service.js.
// Station list derived from fetchAvailableStations() — no hardcoded array.
// No supabase import here.
//
// Content rules (per Composition Engine §BLOCK: station_overview):
//   - One row per station: station name + [N urgent] [N active] [N ready]
//   - Tapping a row opens station-prep via deps.openPanel('station-prep', { stationName })
//   - Financial flag: false
//   - 'Dish Crew' excluded (dish crew has their own block in a future session)

import {
  BLOCK_DEFINITIONS,
  BLOCK_FETCHERS,
  BLOCK_RENDERERS,
} from '../home-block-registry.js';

import { fetchAvailableStations } from '../../services/station-list-service.js';
import { fetchAllStationsOverview } from '../../services/home-prep-service.js';

// Station category excluded from the overview
// (Dish Crew has a dedicated block; Coordinator station is operational, not prep-oriented)
const EXCLUDED_FROM_OVERVIEW = new Set(['Dish Crew']);

// ── Registration ───────────────────────────────────────────────────────

BLOCK_DEFINITIONS['station_overview'] = {
  blockId:        'station_overview',
  basePriority:   3,
  sizeClass:      'M',
  financialFlag:  false,
  // BL-21: authoritative role gate — admin, executive_chef, supervisor
  permittedRoles: new Set(['admin', 'executive_chef', 'supervisor']),
  cacheTTL:       null,
  timeout:        8000,
};

BLOCK_FETCHERS['station_overview'] = async (user /*, signal */) => {
  try {
    // Canonical station list from the existing station-list-service
    const stationResult = await fetchAvailableStations();
    if (!stationResult.ok) throw new Error('station list unavailable');

    // Filter out excluded categories
    const stationNames = stationResult.stations.filter(
      (s) => !EXCLUDED_FROM_OVERVIEW.has(s)
    );

    if (stationNames.length === 0) {
      return { hasContent: false, urgencyScore: 0, data: { stations: [] } };
    }

    const overviewResult = await fetchAllStationsOverview(stationNames);
    if (!overviewResult.ok) throw new Error('overview fetch failed');

    const stations = overviewResult.stations;

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
    throw _err;
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

    if (!data.stations || data.stations.length === 0) {
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
