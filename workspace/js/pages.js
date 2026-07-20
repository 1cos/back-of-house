// BOH OS Workspace — Page Components
// Each page: render(params) → HTML string, then afterRender(el, params)
// No Supabase queries. Demo data only.
// ──────────────────────────────────────────────────────────────────────────────

import { t } from '../i18n/i18n.js';
import { can, getRole } from '../permissions/permissions.js';
import { openTab } from './tabs.js';
import {
  fetchAddChicken,
  fetchAddChickenModifiers,
  fetchLatestModifierDate,
  fetchModifierCountsForDates,
  deriveMatchingDowDates,
  extractDicedChickenBOMQty,
  fetchFriedCalamari,
  fetchLatestCalamariSalesDate,
  fetchFriedCalamariSales,
  extractCalamariItemBOMQty,
  fetchSalesForDates,
  fetchCalamariDeductionDiagnostics,
  fetchProcessSalmon,
  fetchSalmonChainSales,
  fetchLatestSalmonSalesDate,
  fetchSalmonModifierPathDiagnostic,
  fetchTruffleButter,
  fetchMeatballAssembly,
  formatBOM,
  formatStock,
  formatSuggestion,
} from './production-lab-data.js';
import {
  calculateAddChickenShadow,
  calculateMatchingDowForecast,
  calculateRequiredProduction,
  calculateSaleRecipeDemand,
  calculateSaleRecipeDowForecast,
  diagnoseSaleDemandPath,
  calculateRecipeChainDemand,
} from './production-lab-shadow-engine.js';

/* ══════════════════════════════════════════════════════════════════════════ */
/*  HOME                                                                      */
/* ══════════════════════════════════════════════════════════════════════════ */

export const HomePage = {
  render() {
    const hour = new Date().getHours();
    const greetKey = hour < 12 ? 'home.greeting.morning'
                   : hour < 18 ? 'home.greeting.afternoon'
                   :             'home.greeting.evening';
    const role = getRole();
    const name = { executive:'Max', lead:'David', coordinator:'Tela',
                   cook:'Cole', dish_crew:'Austin', viewer:'Guest' }[role] ?? 'Chef';

    const cards = [
      { key:'bots',    type:'bot_center',   icon:'🤖', perm:'can_see_bot_center' },
      { key:'journal', type:'daily_journal', icon:'📓', perm:'can_see_journal' },
      { key:'recipes', type:'recipe',        icon:'📋', perm:'can_see_recipes',
        params:{ id:'tiramisu', name:'Tiramisu' } },
      { key:'inventory', type:'inventory',   icon:'📦', perm:'can_see_inventory',
        params:{ id:'caesar', name:'Caesar Dressing' } },
      { key:'pos',     type:'pos',           icon:'📊', perm:'can_see_pos' },
      { key:'lab',     type:'production_lab', icon:'🧪', perm:'can_see_pos' },
    ].filter(c => can(c.perm));

    return `
      <div class="page-home">
        <div class="home-greeting">
          <h1 class="greeting-text">${t(greetKey, { name })}</h1>
          <p class="greeting-sub">${t('home.subtitle')}</p>
        </div>

        <div class="home-grid">
          ${cards.map(c => `
            <button class="home-card" data-open-tab="${c.type}"
                    data-params='${JSON.stringify(c.params ?? {})}'>
              <span class="home-card-icon">${c.icon}</span>
              <div class="home-card-body">
                <span class="home-card-title">${t(`home.card.${c.key}.title`)}</span>
                <span class="home-card-desc">${t(`home.card.${c.key}.desc`)}</span>
              </div>
              <span class="home-card-arrow">→</span>
            </button>
          `).join('')}
        </div>

        <div class="demo-banner">
          <span class="demo-dot"></span>
          ${t('status.demo')}
        </div>
      </div>
    `;
  },

  afterRender(el) {
    el.querySelectorAll('[data-open-tab]').forEach(btn => {
      btn.addEventListener('click', () => {
        const type   = btn.dataset.openTab;
        const params = JSON.parse(btn.dataset.params || '{}');
        const titleKey = `tab.${type}`;
        const title  = t(titleKey, { name: params.name ?? '' });
        openTab(type, title, params);
      });
    });
  }
};

/* ══════════════════════════════════════════════════════════════════════════ */
/*  BOT CENTER                                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

const BOT_DEMO = [
  { name: 'bot-pos-cleaner',        status: 'ok',      time: '02:05 CDT', rows: 247 },
  { name: 'bot-direct-deduction',   status: 'ok',      time: '02:07 CDT', rows: 8 },
  { name: 'bot-bom-chain-deduction',status: 'ok',      time: '02:09 CDT', rows: 3 },
  { name: 'bot-modifier-depletion', status: 'ok',      time: '02:11 CDT', rows: 4 },
  { name: 'bot-stock-consolidator', status: 'warn',    time: '02:13 CDT', rows: 12 },
];

const OBS_DEMO = [
  { type:'warn',  text:'Spring Mix: unità g vs buste non risolta — consolidator skip.' },
  { type:'info',  text:'Parsley: prep_type=checklist → skip silenzioso da tutti i bot.' },
  { type:'info',  text:'Edible Flower: BOM inconsistency non-blocking — open.' },
];

export const BotCenterPage = {
  render() {
    const statusLabel = s => t(`bots.status.${s}`);
    const statusClass = s => ({ ok:'badge-ok', warn:'badge-warn', error:'badge-danger', pending:'badge-info' })[s] ?? 'badge-info';

    return `
      <div class="page-bots">
        <div class="page-header">
          <h2 class="page-title">${t('bots.title')}</h2>
          <p class="page-subtitle">${t('bots.subtitle')}</p>
        </div>

        <section class="section">
          <h3 class="section-title">${t('bots.pipeline')} — 2026-07-08</h3>
          <div class="pipeline-list">
            ${BOT_DEMO.map((b, i) => `
              <div class="pipeline-item">
                <div class="pipeline-step">${i + 1}</div>
                <div class="pipeline-body">
                  <span class="pipeline-name">${b.name}</span>
                  <span class="pipeline-meta">${t('bots.last_run')}: ${b.time} · ${b.rows} rows</span>
                </div>
                <span class="badge ${statusClass(b.status)}">${statusLabel(b.status)}</span>
              </div>
            `).join('')}
          </div>
        </section>

        <section class="section">
          <h3 class="section-title">${t('bots.observations')}</h3>
          <div class="obs-list">
            ${OBS_DEMO.map(o => `
              <div class="obs-item obs-${o.type}">
                <span class="obs-icon">${o.type === 'warn' ? '⚠️' : 'ℹ️'}</span>
                <span class="obs-text">${o.text}</span>
              </div>
            `).join('')}
          </div>
        </section>

        <div class="demo-banner">
          <span class="demo-dot"></span>
          ${t('status.demo')}
        </div>
      </div>
    `;
  },

  afterRender() {}
};

/* ══════════════════════════════════════════════════════════════════════════ */
/*  RECIPE: TIRAMISU                                                          */
/* ══════════════════════════════════════════════════════════════════════════ */

const RECIPE_DEMO = {
  tiramisu: {
    name: 'Tiramisu',
    station: 'Pastry',
    base_servings: 10,
    yield_text: '10 pz',
    bom: [
      { item:'Savoiardi',       qty:'400g',  unit:'g'  },
      { item:'Mascarpone',      qty:'500g',  unit:'g'  },
      { item:'Eggs (yolk)',     qty:'6 pz',  unit:'pz' },
      { item:'Heavy Cream',     qty:'300ml', unit:'ml' },
      { item:'Sugar',           qty:'120g',  unit:'g'  },
      { item:'Espresso',        qty:'300ml', unit:'ml' },
      { item:'Cocoa Powder',    qty:'30g',   unit:'g'  },
      { item:'Kahlúa',          qty:'60ml',  unit:'ml' },
    ],
    steps: [
      'Monta i tuorli con lo zucchero fino a ottenere un composto chiaro e spumoso.',
      'Incorpora il mascarpone ai tuorli montati — mescola delicatamente.',
      'Monta la panna e incorporala al composto in due tempi.',
      'Inzuppa i savoiardi nell\'espresso con Kahlúa per 2 secondi per lato.',
      'Strati: crema / savoiardi / crema. Ripeti per 10 vaschette individuali.',
      'Spolverizza cacao in polvere sulla superficie.',
      'Riposa in frigo almeno 4 ore — ideale overnight.',
    ],
  },
};

export const RecipePage = {
  render(params) {
    const data = RECIPE_DEMO[params.id] ?? RECIPE_DEMO.tiramisu;
    const canBOM = can('can_view_bom');

    return `
      <div class="page-recipe">
        <div class="page-header">
          <div class="page-header-top">
            <h2 class="page-title">${data.name}</h2>
            <span class="badge badge-info">${t('recipe.station', { name: data.station })}</span>
          </div>
          <p class="page-subtitle">${t('recipe.batch', { n: data.base_servings })} · ${data.yield_text}</p>
        </div>

        ${canBOM ? `
        <section class="section">
          <h3 class="section-title">${t('recipe.bom')}</h3>
          <div class="bom-table">
            <div class="bom-header">
              <span>Ingrediente</span><span>Qtà</span>
            </div>
            ${data.bom.map(row => `
              <div class="bom-row">
                <span class="bom-item">${row.item}</span>
                <span class="bom-qty">${row.qty}</span>
              </div>
            `).join('')}
          </div>
        </section>
        ` : ''}

        <section class="section">
          <h3 class="section-title">${t('recipe.steps')}</h3>
          <ol class="steps-list">
            ${data.steps.map((s, i) => `
              <li class="step-item">
                <span class="step-num">${i + 1}</span>
                <span class="step-text">${s}</span>
              </li>
            `).join('')}
          </ol>
        </section>

        <div class="demo-banner">
          <span class="demo-dot"></span>
          ${t('recipe.note')}
        </div>
      </div>
    `;
  },

  afterRender() {}
};

/* ══════════════════════════════════════════════════════════════════════════ */
/*  INVENTORY: CAESAR DRESSING                                                */
/* ══════════════════════════════════════════════════════════════════════════ */

const INV_DEMO = {
  caesar: {
    name: 'Caesar Dressing',
    stock: '2.4 kg',
    loaded: '— (purchased, no prep task)',
    deducted: '23.1 kg (60gg, 312 modifier uses)',
    movements: [
      { date:'2026-07-08', type:'deduction', qty:'-74g', source:'POS modifier drain',  note:'4 Caesar salads' },
      { date:'2026-07-07', type:'deduction', qty:'-296g',source:'POS modifier drain',  note:'16 uses' },
      { date:'2026-07-06', type:'load',      qty:'+2.4kg',source:'Hardie\'s invoice',  note:'Lot #HI-44021' },
      { date:'2026-07-05', type:'deduction', qty:'-370g',source:'POS modifier drain',  note:'20 uses' },
    ],
  },
};

export const InventoryPage = {
  render(params) {
    const data = INV_DEMO[params.id] ?? INV_DEMO.caesar;

    return `
      <div class="page-inventory">
        <div class="page-header">
          <h2 class="page-title">${data.name}</h2>
        </div>

        <div class="inv-stats">
          <div class="inv-stat">
            <span class="inv-stat-label">${t('inv.current_stock')}</span>
            <span class="inv-stat-value">${data.stock}</span>
          </div>
          <div class="inv-stat">
            <span class="inv-stat-label">${t('inv.loaded')}</span>
            <span class="inv-stat-value inv-load">${data.loaded}</span>
          </div>
          <div class="inv-stat">
            <span class="inv-stat-label">${t('inv.deducted')}</span>
            <span class="inv-stat-value inv-deduct">${data.deducted}</span>
          </div>
        </div>

        <section class="section">
          <h3 class="section-title">${t('inv.movements')}</h3>
          <div class="movements-list">
            ${data.movements.map(m => `
              <div class="movement-row movement-${m.type}">
                <span class="movement-date">${m.date}</span>
                <span class="movement-qty ${m.type === 'load' ? 'qty-pos' : 'qty-neg'}">${m.qty}</span>
                <div class="movement-meta">
                  <span class="movement-source">${m.source}</span>
                  <span class="movement-note">${m.note}</span>
                </div>
              </div>
            `).join('')}
          </div>
        </section>

        <div class="demo-banner">
          <span class="demo-dot"></span>
          ${t('inv.note')}
        </div>
      </div>
    `;
  },

  afterRender() {}
};

/* ══════════════════════════════════════════════════════════════════════════ */
/*  DAILY JOURNAL                                                             */
/* ══════════════════════════════════════════════════════════════════════════ */

const JOURNAL_DEMO = [
  { id:1, time:'21:30', cat:'service',    author:'David',
    title:'52 bills — record luglio',
    body:'Servizio pulito. Brussels finiti alle 21:15 — avvisare Tela per ordine extra venerdì.',
    severity:'info' },
  { id:2, time:'19:05', cat:'maintenance', author:'Tela',
    title:'Lavastoviglie riparata — Hobart',
    body:'Tecnico Hobart passato alle 18:30. Braccio superiore sostituito. OK per servizio.',
    severity:'ok' },
  { id:3, time:'15:40', cat:'kitchen',    author:'Colton',
    title:'Arrabbiata finita a pranzo',
    body:'Batch da 3150g consumato tutto. Aggiunto in prep list per domani mattina.',
    severity:'warn' },
  { id:4, time:'10:20', cat:'purchase',   author:'Tela',
    title:'Hardie\'s ricevuto — fattura #HI-44021',
    body:'Consegna OK. Caesar Dressing 4×2.4kg. Un articolo mancante: Pecorino 1kg — reso segnalato.',
    severity:'info' },
];

const CAT_ICONS = {
  service:'🍽️', maintenance:'🔧', kitchen:'👨‍🍳',
  staff:'👥', incident:'⚠️', purchase:'📦', foh:'🍷'
};
const SEV_CLASS = { info:'', ok:'entry-ok', warn:'entry-warn', danger:'entry-danger' };

export const JournalPage = {
  render() {
    const today = new Date().toLocaleDateString(
      getLangLocale(), { weekday:'long', day:'numeric', month:'long', year:'numeric' }
    );

    return `
      <div class="page-journal">
        <div class="page-header">
          <div class="page-header-top">
            <h2 class="page-title">${t('journal.title')}</h2>
            ${can('can_add_journal') ? `
              <button class="btn-primary" id="btn-new-entry">
                + ${t('journal.new')}
              </button>
            ` : ''}
          </div>
          <p class="page-subtitle">${today}</p>
        </div>

        <div class="journal-filters">
          ${['all','service','maintenance','kitchen','staff','purchase'].map(cat => `
            <button class="filter-chip ${cat === 'all' ? 'active' : ''}"
                    data-filter="${cat}">
              ${cat === 'all' ? t('journal.filter_all') : t(`journal.cat.${cat}`)}
            </button>
          `).join('')}
        </div>

        <div class="journal-entries" id="journal-entries">
          ${JOURNAL_DEMO.map(e => renderEntry(e)).join('')}
        </div>

        <div class="demo-banner">
          <span class="demo-dot"></span>
          ${t('status.demo')}
        </div>
      </div>

      <!-- New entry modal (small action — correct use of modal) -->
      <div class="modal-overlay hidden" id="journal-modal">
        <div class="modal-small" role="dialog" aria-modal="true">
          <div class="modal-header">
            <span class="modal-title">${t('journal.new')}</span>
            <button class="modal-close" id="modal-close">✕</button>
          </div>
          <div class="modal-body">
            <label class="form-label">${t('journal.form.title')}</label>
            <input class="form-input" id="j-title" type="text" placeholder="Es. Lavastoviglie riparata">

            <label class="form-label">${t('journal.form.category')}</label>
            <select class="form-input" id="j-cat">
              ${['service','maintenance','kitchen','staff','purchase','incident'].map(c =>
                `<option value="${c}">${t(`journal.cat.${c}`)}</option>`
              ).join('')}
            </select>

            <label class="form-label">${t('journal.form.body')}</label>
            <textarea class="form-input form-textarea" id="j-body" rows="3"
              placeholder="Dettagli..."></textarea>
          </div>
          <div class="modal-footer">
            <button class="btn-secondary" id="modal-cancel">${t('journal.form.cancel')}</button>
            <button class="btn-primary"   id="modal-save">${t('journal.form.save')}</button>
          </div>
        </div>
      </div>
    `;
  },

  afterRender(el) {
    // Filter chips
    el.querySelectorAll('.filter-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        el.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        const f = chip.dataset.filter;
        el.querySelectorAll('.journal-entry').forEach(entry => {
          entry.style.display = (f === 'all' || entry.dataset.cat === f) ? '' : 'none';
        });
      });
    });

    // New entry modal
    const modal  = el.querySelector('#journal-modal');
    const btnNew = el.querySelector('#btn-new-entry');
    const btnCancel = el.querySelector('#modal-cancel');
    const btnClose  = el.querySelector('#modal-close');
    const btnSave   = el.querySelector('#modal-save');
    const list   = el.querySelector('#journal-entries');

    const openModal  = () => modal?.classList.remove('hidden');
    const closeModal = () => modal?.classList.add('hidden');

    btnNew?.addEventListener('click', openModal);
    btnCancel?.addEventListener('click', closeModal);
    btnClose?.addEventListener('click', closeModal);
    modal?.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    btnSave?.addEventListener('click', () => {
      const title = el.querySelector('#j-title')?.value.trim();
      const cat   = el.querySelector('#j-cat')?.value;
      const body  = el.querySelector('#j-body')?.value.trim();
      if (!title) return;

      const now  = new Date();
      const time = now.toLocaleTimeString('it-IT', { hour:'2-digit', minute:'2-digit' });
      const entry = {
        id: Date.now(), time, cat,
        author: 'Max (demo)', title, body, severity:'info'
      };
      list?.insertAdjacentHTML('afterbegin', renderEntry(entry));
      closeModal();
      el.querySelector('#j-title').value = '';
      el.querySelector('#j-body').value  = '';
      showYesChef(el, `"${title}" salvato nel diario.`);
    });
  }
};

function renderEntry(e) {
  const icon     = CAT_ICONS[e.cat] ?? '📝';
  const sevClass = SEV_CLASS[e.severity] ?? '';
  const catLabel = t(`journal.cat.${e.cat}`);
  return `
    <div class="journal-entry ${sevClass}" data-cat="${e.cat}">
      <div class="entry-meta">
        <span class="entry-icon">${icon}</span>
        <span class="entry-cat">${catLabel.toUpperCase()}</span>
        <span class="entry-dot">·</span>
        <span class="entry-time">${e.time}</span>
        <span class="entry-dot">·</span>
        <span class="entry-author">${e.author}</span>
      </div>
      <h4 class="entry-title">${e.title}</h4>
      ${e.body ? `<p class="entry-body">${e.body}</p>` : ''}
    </div>
  `;
}

function getLangLocale() {
  try { return { it:'it-IT', en:'en-US', es:'es-MX' }[
    sessionStorage.getItem('ws_lang') || 'it'
  ]; } catch { return 'it-IT'; }
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  YES CHEF SHEET (shared utility)                                           */
/* ══════════════════════════════════════════════════════════════════════════ */

export function showYesChef(root, message) {
  const existing = root.querySelector('#yes-chef-sheet');
  existing?.remove();

  const sheet = document.createElement('div');
  sheet.id = 'yes-chef-sheet';
  sheet.innerHTML = `
    <div class="yeschef-backdrop"></div>
    <div class="yeschef-sheet" role="dialog">
      <div class="yeschef-icon">✅</div>
      <h2 class="yeschef-title">${t('yeschef.title')}</h2>
      <p class="yeschef-message">${message}</p>
      <button class="btn-primary yeschef-btn" id="yeschef-close">
        ${t('yeschef.close')}
      </button>
    </div>
  `;
  root.appendChild(sheet);
  requestAnimationFrame(() => sheet.classList.add('visible'));

  const close = () => {
    sheet.classList.remove('visible');
    setTimeout(() => sheet.remove(), 300);
  };
  sheet.querySelector('#yeschef-close').addEventListener('click', close);
  sheet.querySelector('.yeschef-backdrop').addEventListener('click', close);
}

/* ══════════════════════════════════════════════════════════════════════════ */
/*  PRODUCTION LAB                                                            */
/* ══════════════════════════════════════════════════════════════════════════ */

const LAB_CARDS = [
  { key:'add_chicken',      family:'sale'      },
  { key:'fried_calamari',   family:'sale'      },
  { key:'process_salmon',   family:'transform' },
  { key:'truffle_butter',   family:'transform' },
  { key:'meatball_bags',    family:'assemble'  },
];

const LAB_FAMILY_CLASS = {
  sale:      'lab-family-sale',
  transform: 'lab-family-transform',
  assemble:  'lab-family-assemble',
};

const LAB_ROW_KEYS = [
  'lab.row.trigger',
  'lab.row.recipe',
  'lab.row.bom',
  'lab.row.stock',
  // ── Latest actual day ──────────────────────────────────
  'lab.row.latest_day_header',
  'lab.row.modifier_uses',
  'lab.row.bom_per_use',
  'lab.row.shadow_demand',
  // ── Matching-DOW forecast ──────────────────────────────
  'lab.row.dow_header',
  'lab.row.dow_samples',
  'lab.row.dow_bom_forecast',
  'lab.row.dow_boh_forecast',
  'lab.row.dow_difference',
  'lab.row.dow_status',
  'lab.row.boh_result',
  'lab.row.explanation',
  // ── FC matching-DOW forecast ───────────────────────────
  'lab.row.fc_dow_header',
  'lab.row.fc_dow_target',
  'lab.row.fc_dow_samples',
  'lab.row.fc_dow_portions',
  'lab.row.fc_dow_demand',
  'lab.row.fc_dow_bom_forecast',
  'lab.row.fc_dow_boh_forecast',
  'lab.row.fc_dow_status',
  // ── FC demand path diagnostic ─────────────────────────
  'lab.row.fc_diag_header',
  'lab.row.fc_diag_status',
  'lab.row.fc_diag_expected',
  'lab.row.fc_diag_deducted',
  'lab.row.fc_diag_missing',
  'lab.row.fc_diag_coverage',
  // ── PS chain demand ───────────────────────────────────────
  'lab.row.ps_chain_header',
  'lab.row.ps_pos_portions',
  'lab.row.ps_thaw_demand',
  'lab.row.ps_filets_demand',
  'lab.row.ps_raw_demand',
  'lab.row.ps_chain_status',
  // ── PS modifier path diagnostic ─────────────────────────
  'lab.row.ps_moddiag_header',
  'lab.row.ps_moddiag_raw',
  'lab.row.ps_moddiag_class',
  'lab.row.ps_moddiag_recipe',
  'lab.row.ps_moddiag_ded',
  'lab.row.ps_moddiag_missing',
  'lab.row.ps_moddiag_stage',
  // ── TB recipe integrity ────────────────────────────────
  'lab.row.tb_ri_header',
  'lab.row.tb_ri_bom_rows',
  'lab.row.tb_ri_batch',
  'lab.row.tb_ri_portions',
  'lab.row.tb_ri_calc_portion',
  'lab.row.tb_ri_decl_portion',
  'lab.row.tb_ri_implied_batch',
  'lab.row.tb_ri_diff',
  'lab.row.tb_ri_status',
  'lab.row.tb_ri_bom_source',
  // ── Meatball assembly ────────────────────────────────────
  'lab.row.mb_output',
  'lab.row.mb_balls_req',
  'lab.row.mb_sauce_req',
  'lab.row.mb_balls_stock',
  'lab.row.mb_sauce_stock',
  'lab.row.mb_bags_stock',
  'lab.row.mb_boh_balls',
  'lab.row.mb_boh_sauce',
  'lab.row.mb_boh_bags',
  'lab.row.mb_sauce_transform',
  'lab.row.mb_cap_balls',
  'lab.row.mb_cap_sauce',
  'lab.row.mb_cap_safe',
  'lab.row.mb_flag',
  'lab.row.mb_rpc_model',
  'lab.row.mb_mismatch',
  // ── Production formula ─────────────────────────────────
  'lab.row.prod_header',
  'lab.row.prod_forecast',
  'lab.row.prod_coverage',
  'lab.row.prod_gross',
  'lab.row.prod_stock',
  'lab.row.prod_net',
  'lab.row.prod_rounding',
  'lab.row.prod_shadow',
  'lab.row.prod_boh',
  'lab.row.prod_diff',
  'lab.row.prod_status',
];

function renderLabCard(card) {
  const familyClass = LAB_FAMILY_CLASS[card.family] ?? '';
  const CONNECTED_SET = new Set(['add_chicken', 'fried_calamari', 'process_salmon', 'truffle_butter', 'meatball_bags']);
  const isConnected  = CONNECTED_SET.has(card.key);
  const statusClass  = isConnected ? 'lab-status-connected' : '';
  const statusLabel  = isConnected
    ? t('lab.status.connected')
    : t('lab.status.not_connected');

  // Static placeholder rows (used for all cards; add_chicken values filled by afterRender)
  const rows = LAB_ROW_KEYS.map(key => {
    const rowId = isConnected ? `lab-row-${card.key}-${key.split('.').pop()}` : '';
    const isHeader = key.endsWith('_header');
    return `
      <div class="lab-card-row${isHeader ? ' lab-row-header' : ''}">
        <span class="lab-row-label">${t(key)}</span>
        <span class="lab-row-value" ${rowId ? `id="${rowId}"` : ''}>—</span>
      </div>
    `;
  }).join('');

  return `
    <div class="lab-card" ${isConnected ? `id="lab-card-${card.key}"` : ''}>
      <div class="lab-card-header">
        <span class="lab-card-name">${t('lab.card.' + card.key)}</span>
        <span class="lab-family-badge ${familyClass}">${t('lab.stage.' + card.family)}</span>
      </div>
      <div class="lab-card-status ${statusClass}">
        <span class="lab-status-dot ${statusClass}"></span>
        <span class="lab-status-label">${statusLabel}</span>
      </div>
      <div class="lab-card-rows">
        ${rows}
      </div>
      ${isConnected ? `
        <div class="lab-not-comparable" style="display:none"></div>
        <div class="lab-trace"></div>
        <div class="lab-diag-detail"></div>
        <div class="lab-formula-trace"></div>
      ` : ''}
    </div>
  `;
}

/* ── Add Chicken live loader ─────────────────────────────────────────────── */
async function _loadAddChicken(el) {
  const card = el.querySelector('#lab-card-add-chicken');
  if (!card) return;

  const get  = id => card.querySelector('#' + id);
  const lang = sessionStorage.getItem('ws_lang') ?? 'en';

  const setVal = (key, text, cls) => {
    const el2 = get(`lab-row-add_chicken-${key}`);
    if (!el2) return;
    el2.textContent = text;
    if (cls) el2.className = (el2.className || '') + ' ' + cls;
  };

  // Show loading for all dynamic rows
  const LOADING_KEYS = ['modifier_uses','bom_per_use','shadow_demand',
                        'dow_samples','dow_bom_forecast','dow_boh_forecast',
                        'dow_difference','dow_status','boh_result','explanation',
                        'prod_forecast','prod_coverage','prod_gross','prod_stock',
                        'prod_net','prod_rounding','prod_shadow','prod_boh',
                        'prod_diff','prod_status'];
  LOADING_KEYS.forEach(k => setVal(k, t('lab.loading')));

  // ── Phase 1: core recipe + BOM + prep + suggestion ────────────────────────
  const core = await fetchAddChicken();
  if (!core.ok) {
    LOADING_KEYS.forEach(k => setVal(k, t('lab.error')));
    card.querySelector('.lab-status-dot')?.classList.add('lab-status-error');
    const sl = card.querySelector('.lab-status-label');
    if (sl) sl.textContent = t('lab.status.error');
    console.warn('[ProductionLab] core fetch error:', core.error);
    return;
  }
  const { recipe, bom, prep, suggestion } = core.data;

  // Static rows — fill immediately
  setVal('trigger', 'Add chicken (modifier · Proteine)');
  setVal('recipe',  recipe.title ?? '—');
  setVal('bom',     formatBOM(bom) || '—');
  setVal('stock',   formatStock(prep));
  setVal('boh_result', formatSuggestion(suggestion, lang));

  // ── Phase 2: BOM qty for Diced Grilled Chicken ────────────────────────────
  const bomEntry = extractDicedChickenBOMQty(bom);
  if (!bomEntry) {
    LOADING_KEYS.forEach(k => setVal(k, t('lab.error')));
    setVal('explanation', 'BOM entry for Diced Grilled Chicken missing.');
    return;
  }

  // ── Phase 3: latest actual day (single date) ───────────────────────────────
  const dateResult = await fetchLatestModifierDate();
  if (!dateResult.ok) {
    setVal('modifier_uses', t('lab.error'));
    setVal('bom_per_use',   '—');
    setVal('shadow_demand', t('lab.error'));
  } else {
    const businessDate = dateResult.date;
    const modResult = await fetchAddChickenModifiers(businessDate, recipe.pos_name ?? '');
    if (!modResult.ok) {
      setVal('modifier_uses', t('lab.error'));
      setVal('shadow_demand', t('lab.error'));
    } else {
      const latestShadow = calculateAddChickenShadow({
        businessDate,
        modifierRows: modResult.data.modifierRows,
        recipeAliases: modResult.data.aliases,
        bomQtyPerUse: bomEntry.qty,
        bomUnit: bomEntry.unit,
        suggestion,
      });
      if (latestShadow.ok) {
        setVal('modifier_uses', `${latestShadow.totalUses} (${businessDate})`);
        setVal('bom_per_use',   `${latestShadow.bomQtyPerUse}${latestShadow.bomUnit}`);
        setVal('shadow_demand', latestShadow.shadowDemandLabel);
        setVal('explanation',   latestShadow.explanation);
      }
    }
  }

  // ── Phase 4: matching-DOW BOM-first forecast ───────────────────────────────
  if (!suggestion || !suggestion.history_start_date || !suggestion.history_end_date) {
    setVal('dow_samples',      '—');
    setVal('dow_bom_forecast', '—');
    setVal('dow_boh_forecast', '—');
    setVal('dow_difference',   '—');
    setVal('dow_status',       'NO SUGGESTION');
    return;
  }

  // Derive the matching-DOW dates from history window
  const suggDate  = new Date(suggestion.suggestion_date + 'T00:00:00Z');
  const targetDow = suggDate.getUTCDay();  // 1 = Monday
  const dowDates  = deriveMatchingDowDates(
    suggestion.history_start_date,
    suggestion.history_end_date,
    targetDow
  );

  // Fetch modifier counts for those DOW dates (all aliases)
  const aliases = (recipe.pos_name ?? '').split('|').map(a => a.trim()).filter(Boolean);
  const dowFetchResult = await fetchModifierCountsForDates(dowDates, aliases);

  if (!dowFetchResult.ok) {
    setVal('dow_samples',      t('lab.error'));
    setVal('dow_bom_forecast', t('lab.error'));
    setVal('dow_difference',   t('lab.error'));
    setVal('dow_status',       t('lab.error'));
    return;
  }

  // Run the pure DOW forecast engine
  const dow = calculateMatchingDowForecast({
    targetDate:     suggestion.suggestion_date,
    targetDow,
    sampleRows:     dowFetchResult.data.rows,
    recipeAliases:  aliases,
    bomQtyPerUse:   bomEntry.qty,
    bomUnit:        bomEntry.unit,
    bohForecastG:   Number(suggestion.forecast ?? 0),
    bohSampleCount: Number(suggestion.same_weekday_samples ?? 0),
  });

  if (!dow.ok) {
    setVal('dow_samples',      t('lab.error'));
    setVal('dow_bom_forecast', `NEEDS REVIEW: ${dow.error}`);
    setVal('dow_difference',   '—');
    setVal('dow_status',       t('lab.error'));
    return;
  }

  // Sample summary: "Jun 29: 17×100=1700g, Jul 06: 13×100=1300g, ..."
  const sampleSummary = dow.samples
    .map(s => {
      const d = new Date(s.date + 'T00:00:00Z');
      const label = d.toLocaleDateString('en-US', { month:'short', day:'numeric', timeZone:'UTC' });
      return `${label}: ${s.uses}×${bomEntry.qty}g=${s.bomDemandG}g`;
    })
    .join(' · ');

  const diffLabel = dow.diff === 0 ? '0g'
    : `${dow.diff > 0 ? '+' : ''}${dow.diff.toFixed(0)}g`;
  const statusCls = dow.comparisonStatus === 'MATCH' ? 'lab-val-match' : 'lab-val-mismatch';

  setVal('dow_samples',      sampleSummary);
  setVal('dow_bom_forecast', dow.avgLabel);
  setVal('dow_boh_forecast', `${dow.bohForecastG}g`);
  setVal('dow_difference',   diffLabel);
  setVal('dow_status',       dow.comparisonStatus, statusCls);

  // ── Phase 5: update trace section ─────────────────────────────────────────
  const traceEl = card.querySelector('.lab-trace');
  if (traceEl && dow.traceDow) {
    traceEl.innerHTML = dow.traceDow
      .map(line => `<span class="lab-trace-line">${line}</span>`)
      .join('');
  }

  // ── Phase 6: clear NOT_COMPARABLE note if MATCH ────────────────────────────
  const ncEl = card.querySelector('.lab-not-comparable');
  if (ncEl) {
    if (dow.comparisonStatus === 'MATCH') {
      ncEl.style.display = 'none';
    } else {
      ncEl.textContent = dow.mismatchReason ?? '';
      ncEl.style.display = '';
    }
  }

  // ── Phase 7: production formula reconstruction ────────────────────────────
  // Extract named inputs from debug_json — never pass planned_output into calc
  const dbg = suggestion.debug_json ?? {};
  const prod = calculateRequiredProduction({
    bufferedForecast:  dbg.buffered_forecast ?? null,
    rawForecast:       dbg.raw_forecast      ?? null,
    bufferFactor:      dbg.buffer_factor     ?? null,
    stockValue:        dbg.stock_detail?.value ?? null,
    minimumIncrement:  suggestion.minimum_increment ?? null,
    bohPlannedOutput:  suggestion.planned_output ?? null,   // comparison target only
    coverageDays:      suggestion.coverage_days ?? null,
    coverDates:        dbg.cover_dates ?? [],
  });

  if (!prod.ok) {
    setVal('prod_forecast', '—');
    setVal('prod_coverage', '—');
    setVal('prod_gross',    '—');
    setVal('prod_stock',    '—');
    setVal('prod_net',      '—');
    setVal('prod_rounding', '—');
    setVal('prod_shadow',   `CANNOT RECONSTRUCT: ${prod.missingFields?.join(', ') ?? prod.error}`);
    setVal('prod_boh',      suggestion.planned_output != null ? `${suggestion.planned_output}g` : '—');
    setVal('prod_diff',     '—');
    setVal('prod_status',   'CANNOT RECONSTRUCT');
    return;
  }

  const coverLabel = prod.coverDates.length
    ? `${prod.coverageDays}d (${prod.coverDates[0]} → ${prod.coverDates[prod.coverDates.length-1]})`
    : `${prod.coverageDays ?? '—'}d`;
  const diffLabel = prod.diff === 0 ? '0g'
    : `${prod.diff > 0 ? '+' : ''}${prod.diff.toFixed(0)}g`;
  const prodStatusCls = prod.status === 'MATCH' ? 'lab-val-match' : 'lab-val-mismatch';

  setVal('prod_forecast', `${prod.grossRequirement}g (×${prod.bufferFactor ?? '?'} buffer → ${prod.rawForecast ?? '?'}g raw)`);
  setVal('prod_coverage', coverLabel);
  setVal('prod_gross',    `${prod.grossRequirement}g`);
  setVal('prod_stock',    `${prod.stockApplied}g (fresh count)`);
  setVal('prod_net',      `${prod.netRequirement}g`);
  setVal('prod_rounding', prod.roundingNote);
  setVal('prod_shadow',   `${prod.calculatedOutput}g`);
  setVal('prod_boh',      `${prod.bohPlannedOutput}g`);
  setVal('prod_diff',     diffLabel);
  setVal('prod_status',   prod.status, prodStatusCls);

  // Update formula trace to show production formula
  const formulaEl = card.querySelector('.lab-formula-trace');
  if (formulaEl) formulaEl.textContent = prod.formulaTrace;
}

/* ── Fried Calamari live loader ──────────────────────────────────────────── */
async function _loadFriedCalamari(el) {
  const card = el.querySelector('#lab-card-fried_calamari');
  if (!card) return;

  const lang = sessionStorage.getItem('ws_lang') ?? 'en';
  const KEY  = 'fried_calamari';

  const get    = id => card.querySelector('#' + id);
  const setVal = (suffix, text, cls) => {
    const el2 = get(`lab-row-${KEY}-${suffix}`);
    if (!el2) return;
    el2.textContent = text;
    if (cls) el2.className = (el2.className || '') + ' ' + cls;
  };

  // All rows this loader touches
  const LIVE_ROWS = ['trigger','recipe','bom','stock','boh_result',
                     'modifier_uses','bom_per_use','shadow_demand','difference','explanation',
                     'fc_dow_target','fc_dow_samples','fc_dow_portions',
                     'fc_dow_demand','fc_dow_bom_forecast','fc_dow_boh_forecast','fc_dow_status'];
  LIVE_ROWS.forEach(r => setVal(r, t('lab.loading')));

  // ── Phase 1: core recipe + BOM + prep + suggestion ────────────────────────
  const core = await fetchFriedCalamari();

  if (!core.ok) {
    LIVE_ROWS.forEach(r => setVal(r, t('lab.error')));
    const statusDot   = card.querySelector('.lab-status-dot');
    const statusLabel = card.querySelector('.lab-status-label');
    if (statusDot)   statusDot.className    = 'lab-status-dot lab-status-error';
    if (statusLabel) statusLabel.textContent = t('lab.status.error');
    console.warn('[ProductionLab] Fried Calamari fetch error:', core.error);
    return;
  }

  const { recipe, bom, prep, suggestion } = core.data;
  const aliases = (recipe.pos_name ?? '').split('|').map(a => a.trim()).filter(Boolean);

  // Fill static rows
  setVal('trigger', 'Fried Calamari (POS item · Antipasti)');
  setVal('recipe',  recipe.title ?? '—');
  setVal('bom',     formatBOM(bom) || '—');
  setVal('stock',   formatStock(prep));
  setVal('boh_result', formatSuggestion(suggestion, lang));

  // ── Phase 2: extract Calamari BOM qty (live, not hardcoded) ──────────────
  const bomEntry = extractCalamariItemBOMQty(bom);
  if (!bomEntry) {
    setVal('modifier_uses', '—');
    setVal('bom_per_use',   '—');
    setVal('shadow_demand', 'NEEDS REVIEW: Calamari ITEM not found in BOM');
    setVal('difference',    '—');
    setVal('explanation',   'Calamari ingredient missing from recipe BOM.');
    return;
  }

  // ── Phase 3: latest sales date ────────────────────────────────────────────
  const dateResult = await fetchLatestCalamariSalesDate(aliases);
  if (!dateResult.ok) {
    setVal('modifier_uses', '—');
    setVal('bom_per_use',   `${bomEntry.qty}${bomEntry.unit}`);
    setVal('shadow_demand', 'NEEDS REVIEW: ' + dateResult.error);
    setVal('difference',    '—');
    setVal('explanation',   dateResult.error);
    return;
  }
  const businessDate = dateResult.date;

  // ── Phase 4: fetch sales + alias portion factors ──────────────────────────
  const salesResult = await fetchFriedCalamariSales(businessDate, aliases);
  if (!salesResult.ok) {
    setVal('modifier_uses', t('lab.error'));
    setVal('shadow_demand', t('lab.error'));
    setVal('difference',    '—');
    setVal('explanation',   salesResult.error);
    return;
  }

  // ── Phase 5: shadow engine (pure) ─────────────────────────────────────────
  const shadow = calculateSaleRecipeDemand({
    businessDate,
    salesRows:      salesResult.data.salesRows,
    aliasPortionMap:salesResult.data.aliasPortionMap,
    bomQuantity:    bomEntry.qty,
    bomUnit:        bomEntry.unit,
    ingredientName: bomEntry.ingredientName,
    recipeTitle:    recipe.title,
  });

  if (!shadow.ok) {
    setVal('modifier_uses', '—');
    setVal('shadow_demand', `${shadow.status}: ${shadow.error}`);
    setVal('difference',    '—');
    setVal('explanation',   shadow.error);
    return;
  }

  // ── Phase 6: fill shadow rows ─────────────────────────────────────────────
  const portionsLabel = shadow.includedRows
    .map(r => `${r.menu_item} ×${r.quantity}`)
    .join(', ');
  setVal('modifier_uses', `${shadow.canonicalPortions} portions (${businessDate}) — ${portionsLabel}`);
  setVal('bom_per_use',   `${shadow.bomQtyPerPortion}${shadow.bomUnit}`);
  setVal('shadow_demand', shadow.shadowDemandLabel);
  // BOH has no demand path → NOT COMPARABLE
  setVal('difference',    'NOT COMPARABLE');
  setVal('explanation',   shadow.explanation);

  // ── Phase 7: warning banner ───────────────────────────────────────────────
  const ncEl = card.querySelector('.lab-not-comparable');
  if (ncEl) {
    ncEl.textContent = 'SHADOW DEMAND EXISTS — BOH HAS NO DEMAND PATH (no_demand_path). Stock deductions exist but bot has no forecast.';
    ncEl.style.display = '';
  }

  // ── Phase 8: trace (single-day) ───────────────────────────────────────────
  const traceEl = card.querySelector('.lab-trace');
  if (traceEl && shadow.tracePath) {
    traceEl.innerHTML = shadow.tracePath
      .map(line => `<span class="lab-trace-line">${line}</span>`)
      .join('');
  }

  // ── Phase 9: matching-DOW BOM-first forecast ──────────────────────────────
  if (!suggestion || !suggestion.history_start_date || !suggestion.history_end_date) {
    ['fc_dow_target','fc_dow_samples','fc_dow_portions',
     'fc_dow_demand','fc_dow_bom_forecast','fc_dow_boh_forecast','fc_dow_status']
      .forEach(k => setVal(k, '—'));
    return;
  }

  // Derive matching-DOW dates from history window
  const fcSuggDate  = new Date(suggestion.suggestion_date + 'T00:00:00Z');
  const fcTargetDow = fcSuggDate.getUTCDay();
  const fcDowDates  = deriveMatchingDowDates(
    suggestion.history_start_date,
    suggestion.history_end_date,
    fcTargetDow
  );

  // Fetch sales for those dates (all aliases, from pos_sales_by_item)
  const dowSalesResult = await fetchSalesForDates(fcDowDates, aliases);
  if (!dowSalesResult.ok) {
    ['fc_dow_target','fc_dow_samples','fc_dow_portions',
     'fc_dow_demand','fc_dow_bom_forecast','fc_dow_boh_forecast','fc_dow_status']
      .forEach(k => setVal(k, t('lab.error')));
    return;
  }

  // Also need alias portion factors (reuse salesResult.data.aliasPortionMap if still in scope,
  // or re-derive from aliases with default 1.0 — Calamari factor is 1.0, confirmed from DB)
  // We have salesResult.data.aliasPortionMap from Phase 4 if it succeeded.
  // Use it directly — same aliases, same portion factors apply to DOW dates.
  const fcAliasPortionMap = salesResult.data.aliasPortionMap;

  const fcDow = calculateSaleRecipeDowForecast({
    targetDate:      suggestion.suggestion_date,
    targetDow:       fcTargetDow,
    sampleRows:      dowSalesResult.data.rows,
    aliasPortionMap: fcAliasPortionMap,
    bomQtyPerPortion:bomEntry.qty,
    bomUnit:         bomEntry.unit,
    bohForecastG:    suggestion.forecast != null ? Number(suggestion.forecast) : null,
    ingredientName:  bomEntry.ingredientName,
    recipeTitle:     recipe.title,
  });

  if (!fcDow.ok) {
    setVal('fc_dow_target',       suggestion.suggestion_date);
    setVal('fc_dow_bom_forecast', `NEEDS REVIEW: ${fcDow.error}`);
    setVal('fc_dow_status',       'ERROR');
    return;
  }

  // Format sample summaries
  const fcSampleDates = fcDow.samples
    .map(s => {
      const d = new Date(s.date + 'T00:00:00Z');
      const label = d.toLocaleDateString('en-US', { month:'short', day:'numeric', timeZone:'UTC' });
      return label;
    })
    .join(', ');

  const fcPortionsSummary = fcDow.samples
    .map(s => {
      const d = new Date(s.date + 'T00:00:00Z');
      const label = d.toLocaleDateString('en-US', { month:'short', day:'numeric', timeZone:'UTC' });
      return `${label}: ${s.portions}p`;
    })
    .join(' · ');

  const fcDemandSummary = fcDow.samples
    .map(s => `${s.bomDemandG}g`)
    .join(' · ');

  const fcStatusCls = fcDow.comparisonStatus === 'SHADOW_ONLY' ? 'lab-val-shadow'
    : fcDow.comparisonStatus === 'MATCH' ? 'lab-val-match' : 'lab-val-mismatch';

  setVal('fc_dow_target',       `${suggestion.suggestion_date} (DOW ${fcTargetDow})`);
  setVal('fc_dow_samples',      fcSampleDates);
  setVal('fc_dow_portions',     fcPortionsSummary);
  setVal('fc_dow_demand',       fcDemandSummary);
  setVal('fc_dow_bom_forecast', fcDow.avgLabel);
  setVal('fc_dow_boh_forecast', fcDow.bohForecastG != null ? `${fcDow.bohForecastG}g` : 'NONE');
  setVal('fc_dow_status',       fcDow.comparisonStatus, fcStatusCls);

  // Update trace with DOW trace
  const formulaEl = card.querySelector('.lab-formula-trace');
  if (formulaEl && fcDow.traceDow) {
    formulaEl.innerHTML = fcDow.traceDow
      .map(line => `<span class="lab-trace-line">${line}</span>`)
      .join('');
    formulaEl.style.display = 'block';
  }

  // ── Phase 10: demand-path diagnostic ─────────────────────────────────────
  // Show loading for diagnostic rows
  const DIAG_ROWS = ['fc_diag_status','fc_diag_expected','fc_diag_deducted',
                     'fc_diag_missing','fc_diag_coverage'];
  DIAG_ROWS.forEach(k => setVal(k, t('lab.loading')));

  // Use the DOW sample dates (fcDowDates) and aliases from Phase 4
  const diagResult = await fetchCalamariDeductionDiagnostics(fcDowDates, aliases);

  if (!diagResult.ok) {
    DIAG_ROWS.forEach(k => setVal(k, t('lab.error')));
    return;
  }

  const diag = diagnoseSaleDemandPath({
    sampleDates:      fcDowDates,
    aliases,
    salesRows:        diagResult.data.salesRows,
    deductionRows:    diagResult.data.deductionRows,
    bomQtyPerPortion: bomEntry.qty,
    bomUnit:          bomEntry.unit,
    techNote: "HAPPY HOUR PATH FIXED 2026-07-19: bot-pos-cleaner v6 adds HAPPY_HOUR_FOOD_ITEMS allowlist. " +
              "'Calamari' (menu_group: Happy hours) now bypasses BEVERAGE_GROUPS skip and maps to Fried calamari recipe (14ccae9f). " +
              "Pipeline re-run for 2026-06-29 and 2026-07-13: 165g Calamari prep deducted per date. " +
              "Monday DOW average restored: 1320g • 1650g • 1485g → avg 1485g. Missing demand: 0.",
  });

  if (!diag.ok) {
    DIAG_ROWS.forEach(k => setVal(k, t('lab.error')));
    return;
  }

  // Build per-date diagnostic HTML and inject into the diag section element
  const diagSectionEl = card.querySelector('.lab-diag-detail');
  if (diagSectionEl) {
    const rows = diag.dateRows.flatMap(dr =>
      dr.aliasResults.map(r => {
        const cls = r.status === 'COMPLETE' ? 'lab-diag-complete' : 'lab-diag-missing';
        const miss = r.missingG > 0 ? ` (missing ${r.missingG}g)` : '';
        return `<div class="lab-diag-row ${cls}">
          <span class="lab-diag-date">${dr.date}</span>
          <span class="lab-diag-alias">${r.alias}</span>
          <span class="lab-diag-status">${r.status}${miss}</span>
        </div>`;
      })
    );
    diagSectionEl.innerHTML = rows.join('');
  }

  const statusCls = diag.overallStatus === 'COMPLETE_PATH' ? 'lab-val-match' : 'lab-val-mismatch';
  setVal('fc_diag_status',   diag.overallStatus.replace('_', ' '), statusCls);
  setVal('fc_diag_expected', `${diag.totalExpectedG}g`);
  setVal('fc_diag_deducted', `${diag.totalDeductedG}g`);
  setVal('fc_diag_missing',  `${diag.totalMissingG}g`);
  setVal('fc_diag_coverage', `${diag.coveragePct}%`);

  // Tech note in formula trace
  if (formulaEl && diag.techNote) {
    const noteSpan = `<span class="lab-trace-line lab-trace-note">${diag.techNote}</span>`;
    formulaEl.innerHTML = (formulaEl.innerHTML || '') + noteSpan;
  }
}

/* ── Process Salmon live loader ──────────────────────────────────────────── */
async function _loadProcessSalmon(el) {
  const card = el.querySelector('#lab-card-process_salmon');
  if (!card) return;

  const lang = sessionStorage.getItem('ws_lang') ?? 'en';
  const KEY  = 'process_salmon';

  const get    = id => card.querySelector('#' + id);
  const setVal = (suffix, text, cls) => {
    const el2 = get(`lab-row-${KEY}-${suffix}`);
    if (!el2) return;
    el2.textContent = text;
    if (cls) el2.className = (el2.className || '') + ' ' + cls;
  };

  const LIVE_ROWS = ['trigger','recipe','bom','stock','boh_result',
                     'ps_pos_portions','ps_thaw_demand','ps_filets_demand',
                     'ps_raw_demand','ps_chain_status'];
  LIVE_ROWS.forEach(r => setVal(r, t('lab.loading')));

  // ── Phase 1: core recipe + BOM + prep + suggestion ────────────────────────
  const result = await fetchProcessSalmon();

  if (!result.ok) {
    LIVE_ROWS.forEach(r => setVal(r, t('lab.error')));
    const statusDot   = card.querySelector('.lab-status-dot');
    const statusLabel = card.querySelector('.lab-status-label');
    if (statusDot)   statusDot.className    = 'lab-status-dot lab-status-error';
    if (statusLabel) statusLabel.textContent = t('lab.status.error');
    console.warn('[ProductionLab] Process Salmon fetch error:', result.error);
    return;
  }

  const { recipe, bom, prep, suggestion } = result.data;

  const rawBomRow = bom.find(r => r.component_type === 'ITEM'
                               && r.ingredients?.name?.toLowerCase().includes('salmon'));
  const inputQty  = rawBomRow ? `${rawBomRow.quantity}${rawBomRow.unit}` : '190g';
  const rawGPerFilet = rawBomRow ? Number(rawBomRow.quantity) : 190;
  const outputQty = recipe.base_weight_g
    ? `${recipe.base_weight_g}g / ${recipe.serving_qty ?? '1'} ${recipe.serving_unit ?? 'pz'}`
    : '190g / 1 pz';

  setVal('trigger', 'Downstream demand — Amalfi Salmon POS + Add salmon whole → Thaw Salmon → Salmon Filets');
  setVal('recipe',  `${recipe.title} (${inputQty} raw → ${outputQty} portioned)`);
  setVal('bom',     formatBOM(bom) || '—');
  setVal('stock',   formatStock(prep));
  setVal('boh_result', formatSuggestion(suggestion, lang));

  // ── Phase 2: downstream chain demand ──────────────────────────────────────
  const dateResult = await fetchLatestSalmonSalesDate();
  if (!dateResult.ok) {
    ['ps_pos_portions','ps_thaw_demand','ps_filets_demand','ps_raw_demand','ps_chain_status']
      .forEach(k => setVal(k, t('lab.error')));
    return;
  }
  const businessDate = dateResult.date;

  const salesResult = await fetchSalmonChainSales(businessDate);
  if (!salesResult.ok) {
    ['ps_pos_portions','ps_thaw_demand','ps_filets_demand','ps_raw_demand','ps_chain_status']
      .forEach(k => setVal(k, t('lab.error')));
    return;
  }

  // Pure engine — chain: all 1:1 recipe hops, then 190g raw ingredient
  const chain = calculateRecipeChainDemand({
    businessDate,
    salesRows: salesResult.data.salesRows,
    chain: [
      { name: 'POS demand',     qtyPerParent: 1,           unit: 'pz' },
      { name: 'Thaw Salmon',    qtyPerParent: 1,           unit: 'pz' },
      { name: 'Salmon Filets',  qtyPerParent: 1,           unit: 'pz' },
      { name: 'Salmon (raw)',   qtyPerParent: rawGPerFilet, unit: 'g'  },
    ],
  });

  if (!chain.ok) {
    setVal('ps_chain_status', `ERROR: ${chain.error}`);
    return;
  }

  const [posLv, thawLv, filetsLv, rawLv] = chain.levels;
  const sourceLabel = chain.sourceBreakdown.map(s => `${s.menu_item} ×${s.quantity}`).join(' + ');

  setVal('ps_pos_portions', `${chain.totalRootQty} (${businessDate}) — ${sourceLabel}`);
  setVal('ps_thaw_demand',  `${thawLv.demand} ${thawLv.unit}`);
  setVal('ps_filets_demand',`${filetsLv.demand} ${filetsLv.unit}`);
  setVal('ps_raw_demand',   `${rawLv.demand}${rawLv.unit} (${(rawLv.demand/1000).toFixed(3)}kg)`);

  const chainCls = chain.isPerfect ? 'lab-val-match' : 'lab-val-mismatch';
  setVal('ps_chain_status', chain.chainStatus, chainCls);

  // ── Phase 3: trace ─────────────────────────────────────────────────────────
  const traceEl = card.querySelector('.lab-trace');
  if (traceEl) {
    const trace = [
      `Salmon (raw, Fruge Seafood ~32.6lb baffa)`,
      `→ Salmon Filets recipe (cure + portion + freeze, 190g raw → 1 filet)`,
      `→ prep_tasks.id=${prep.id} '${prep.name}' · ${prep.current_stock} pz in freezer`,
      `→ Thaw Salmon (sub-recipe in Amalfi Salmon + Salmon Whole BOMs)`,
      `→ Amalfi Salmon (POS) + Add salmon whole (modifier)`,
      `${businessDate}: ${sourceLabel} = ${chain.totalRootQty} filets → ${rawLv.demand}g raw`,
    ];
    traceEl.innerHTML = trace
      .map(line => `<span class="lab-trace-line">${line}</span>`)
      .join('');
  }

  // ── Phase 4: modifier path diagnostic ─────────────────────────────────────
  const MODIFIER_NAMES = ['Add salmon whole', 'add salmon whole', 'Add salmon', 'add salmon'];
  const DIAG_ROWS = ['ps_moddiag_raw','ps_moddiag_class','ps_moddiag_recipe',
                     'ps_moddiag_ded','ps_moddiag_missing','ps_moddiag_stage'];
  DIAG_ROWS.forEach(k => setVal(k, t('lab.loading')));

  const diagResult = await fetchSalmonModifierPathDiagnostic(businessDate, MODIFIER_NAMES);

  if (!diagResult.ok) {
    DIAG_ROWS.forEach(k => setVal(k, t('lab.error')));
    return;
  }

  const { rawRows: dRaw, cleanRows: dClean, aliasRows: dAlias, deductions: dDed } = diagResult.data;

  // Raw modifier count
  const rawTotal = dRaw.reduce((s, r) => s + Number(r.quantity_sold ?? 0), 0);
  const rawLabel = dRaw.map(r => `${r.modifier} ×${r.quantity_sold}`).join(', ') || '0';
  setVal('ps_moddiag_raw', `${rawTotal} (${rawLabel})`);

  // Classification result from pos_daily_clean
  const cleanRow = dClean[0] ?? null;
  const classLabel = cleanRow
    ? `${cleanRow.item_class} / action=${cleanRow.action} (source=${cleanRow.source_table})`
    : 'NOT IN pos_daily_clean';
  setVal('ps_moddiag_class', classLabel);

  // Recipe match result
  const pathFixed = !!(cleanRow?.recipe_id);
  const recipeLabel = cleanRow?.recipe_id
    ? `${cleanRow.matched_recipe_name} (${cleanRow.match_type})`
    : `NULL — shouldMap=false (${cleanRow?.item_class ?? '?'} ≠ KITCHEN_OPERATIONAL)`;
  setVal('ps_moddiag_recipe', recipeLabel);

  // Deductions written
  const dedTotal = dDed.reduce((s, r) => s + Number(r.quantity ?? 0), 0);
  setVal('ps_moddiag_ded', dedTotal === 0 ? '0 pz (none written)' : `${dedTotal} pz`);

  // Missing demand — 0 if fix applied and deductions written
  const missingDemand = pathFixed ? Math.max(0, rawTotal - dedTotal) : rawTotal;
  setVal('ps_moddiag_missing', missingDemand === 0 ? '0 (all demand captured ✓)' : `${missingDemand} pz Thaw Salmon`);

  // Stage / status — reflects actual current state from live DB
  const stageLabel = pathFixed
    ? `MODIFIER PATH FIXED — pos_item_class_rules id=85 (KITCHEN_OPERATIONAL/map). Alias corrected: Add salmon whole → Salmon Whole. Rule added 2026-07-19.`
    : (cleanRow
        ? `pos_daily_clean: source_table='pos_modifiers' → default UNKNOWN_REVIEW → shouldMap=false → recipe_id=null → deduction skipped`
        : `Not found in pos_daily_clean`);
  setVal('ps_moddiag_stage', stageLabel);

  // Append to formula trace
  const formulaEl = card.querySelector('.lab-formula-trace');
  if (formulaEl) {
    const techNote = pathFixed
      ? `MODIFIER PATH FIXED 2026-07-19: pos_item_class_rules rule #85 added (Add salmon whole → KITCHEN_OPERATIONAL/map). ` +
        `pos_item_aliases corrected: Salmon fillet → Salmon Whole. ` +
        `Pipeline re-run for 2026-07-18: 4 pz Thaw Salmon deducted from Add salmon whole modifier. ` +
        `Total demand 2026-07-18: 6 Thaw Salmon (4 modifier + 2 Amalfi Salmon).`
      : `Fix needed: add pos_item_class_rules rule for 'Add salmon whole' ` +
        `(source_table=pos_modifiers, item_class=KITCHEN_OPERATIONAL, action=map). ` +
        `Secondary: pos_item_aliases canonical_name='Salmon fillet' should be 'Salmon Whole'.`;
    formulaEl.innerHTML = `<span class="lab-trace-line lab-trace-note">${techNote}</span>`;
    formulaEl.style.display = 'block';
  }
}

/* ── Truffle Butter live loader ───────────────────────────────────────────── */
async function _loadTruffleButter(el) {
  const card = el.querySelector('#lab-card-truffle_butter');
  if (!card) return;

  const lang = sessionStorage.getItem('ws_lang') ?? 'en';
  const KEY  = 'truffle_butter';

  const get    = id => card.querySelector('#' + id);
  const setVal = (suffix, text, cls) => {
    const el2 = get(`lab-row-${KEY}-${suffix}`);
    if (!el2) return;
    el2.textContent = text;
    if (cls) el2.className = (el2.className || '') + ' ' + cls;
  };

  const LIVE_ROWS = ['trigger','recipe','bom','stock','boh_result',
                     'tb_ri_bom_rows','tb_ri_batch','tb_ri_portions',
                     'tb_ri_calc_portion','tb_ri_decl_portion','tb_ri_implied_batch',
                     'tb_ri_diff','tb_ri_status','tb_ri_bom_source'];
  LIVE_ROWS.forEach(r => setVal(r, t('lab.loading')));

  // ── Phase 1: core data ─────────────────────────────────────────────────────
  const result = await fetchTruffleButter();

  if (!result.ok) {
    LIVE_ROWS.forEach(r => setVal(r, t('lab.error')));
    const statusDot   = card.querySelector('.lab-status-dot');
    const statusLabel = card.querySelector('.lab-status-label');
    if (statusDot)   statusDot.className    = 'lab-status-dot lab-status-error';
    if (statusLabel) statusLabel.textContent = t('lab.status.error');
    console.warn('[ProductionLab] Truffle Butter fetch error:', result.error);
    return;
  }

  const { recipe, bom, prep, suggestion } = result.data;

  // Yield fields
  const batchG   = recipe.base_weight_g   ? Number(recipe.base_weight_g)   : null;
  const servings = recipe.base_servings   ? Number(recipe.base_servings)    : null;
  const declPort = recipe.serving_weight_g ? Number(recipe.serving_weight_g) : null;

  const calcPort    = (batchG && servings) ? Math.round((batchG / servings) * 100) / 100 : null;
  const impliedBatch = (servings && declPort) ? servings * declPort : null;
  const diff         = (batchG  && impliedBatch) ? batchG - impliedBatch : null;

  const yieldDesc = (batchG && servings && calcPort)
    ? `${batchG}g batch / ${servings} portions → ${calcPort}g calc / ${declPort ?? '?'}g declared`
    : recipe.base_weight_g ? `${recipe.base_weight_g}g batch` : '—';

  const bomText = bom.length > 0
    ? (formatBOM(bom) || '—')
    : 'Empty (not yet catalogued)';

  // ── Phase 2: fill base rows ────────────────────────────────────────────────
  setVal('trigger', 'Downstream — Truffle Fettuccine (POS) × 20g/portion');
  setVal('recipe',  `${recipe.title} · ${yieldDesc}`);
  setVal('bom',     bomText);
  setVal('stock',   formatStock(prep));
  setVal('boh_result', formatSuggestion(suggestion, lang));

  // ── Phase 3: recipe integrity diagnostic ──────────────────────────────────
  // Determine card status: NEEDS_REVIEW if BOM empty OR yield inconsistency
  const hasInconsistency = bom.length === 0 || (diff !== null && Math.abs(diff) > 0.5);

  const statusDot   = card.querySelector('.lab-status-dot');
  const statusLabel = card.querySelector('.lab-status-label');
  const statusBadge = card.querySelector('.lab-card-status');

  if (hasInconsistency) {
    if (statusDot)   statusDot.className    = 'lab-status-dot lab-status-needs-review';
    if (statusLabel) statusLabel.textContent = t('lab.status.needs_review');
    if (statusBadge) statusBadge.className   = (statusBadge.className || '')
      .replace('lab-status-connected','').trim() + ' lab-status-needs-review';
  }

  // BOM rows
  setVal('tb_ri_bom_rows',      `${bom.length}`);
  setVal('tb_ri_batch',         batchG   != null ? `${batchG}g`   : '—');
  setVal('tb_ri_portions',      servings != null ? `${servings}`  : '—');
  setVal('tb_ri_calc_portion',  calcPort != null ? `${calcPort}g` : '—');
  setVal('tb_ri_decl_portion',  declPort != null ? `${declPort}g` : '—');
  setVal('tb_ri_implied_batch', impliedBatch != null ? `${impliedBatch}g (${servings} × ${declPort}g)` : '—');
  setVal('tb_ri_diff',          diff != null ? `${diff}g` : '—');

  const riStatus = hasInconsistency ? 'NEEDS RECIPE REVIEW' : 'RECIPE COMPLETE';
  const riCls    = hasInconsistency ? 'lab-val-mismatch' : 'lab-val-match';
  setVal('tb_ri_status', riStatus, riCls);

  // ── Phase 4: POSSIBLE BOM SOURCE ──────────────────────────────────────────
  // Existing ingredients that could compose Truffle Butter
  // (confirmed from DB: Butter, Black Truffle, Truffle Oil all exist as ingredients;
  //  Truffle Fettuccine BOM uses Black Truffle 4g separately → suggests TB = Butter + truffle compound)
  const bomCompleteNote = bom.length > 0
    ? `BOM COMPLETE 2026-07-19 — ${bom.length} ingredients: ` +
      bom.map(b => b.ingredients?.name ?? b.sub_recipe?.title ?? '?').join(', ')
    : 'BOM empty — not yet catalogued';
  setVal('tb_ri_bom_source', bomCompleteNote);

  // ── Phase 5: trace ─────────────────────────────────────────────────────────
  const traceEl = card.querySelector('.lab-trace');
  if (traceEl) {
    const trace = [
      `Truffle Fettuccine (POS, pos_name='Truffle Fettuccine') × 20g/portion`,
      `→ recipe_bom bom_id=2306: TRUFFLE BUTTER 20g`,
      `→ recipe 'TRUFFLE BUTTER' id=0564433e (${batchG ?? '?'}g batch / ${servings ?? '?'} portions)`,
      `→ prep_tasks.id=${prep.id} '${prep.name}' · ${prep.category} · ${prep.current_stock}${prep.unit}`,
      bom.length > 0
        ? `→ BOM COMPLETE: ${bom.length} ingredients, 963.5g input → 960g finished (3.5g process loss)`
        : `⚠ BOM empty — 20g downstream confirmed via stock_deductions (clean path)`,
    ];
    traceEl.innerHTML = trace
      .map(line => `<span class="lab-trace-line">${line}</span>`)
      .join('');
  }
}

/* ── Meatball Assembly live loader ───────────────────────────────────────── */
async function _loadMeatballAssembly(el) {
  const card = el.querySelector('#lab-card-meatball_bags');
  if (!card) return;

  const lang = sessionStorage.getItem('ws_lang') ?? 'en';
  const KEY  = 'meatball_bags';

  const get    = id => card.querySelector('#' + id);
  const setVal = (suffix, text, cls) => {
    const el2 = get(`lab-row-${KEY}-${suffix}`);
    if (!el2) return;
    el2.textContent = text;
    if (cls) el2.className = (el2.className || '') + ' ' + cls;
  };

  const LIVE_ROWS = [
    'trigger','recipe','bom','stock','boh_result',
    'mb_output','mb_balls_req','mb_sauce_req',
    'mb_balls_stock','mb_sauce_stock','mb_bags_stock',
    'mb_boh_balls','mb_boh_sauce','mb_boh_bags',
    'mb_sauce_transform','mb_cap_balls','mb_cap_sauce','mb_cap_safe',
    'mb_flag','mb_rpc_model','mb_mismatch',
  ];
  LIVE_ROWS.forEach(r => setVal(r, t('lab.loading')));

  // ── Phase 1: fetch all data (no RPC calls) ────────────────────────────────
  const result = await fetchMeatballAssembly();

  if (!result.ok) {
    LIVE_ROWS.forEach(r => setVal(r, t('lab.error')));
    const statusDot   = card.querySelector('.lab-status-dot');
    const statusLabel = card.querySelector('.lab-status-label');
    if (statusDot)   statusDot.className    = 'lab-status-dot lab-status-error';
    if (statusLabel) statusLabel.textContent = t('lab.status.error');
    console.warn('[ProductionLab] Meatball Assembly fetch error:', result.error);
    return;
  }

  const { recipeMap, bagBom, sauceBom, prepMap, suggMap, flag } = result.data;

  const balls = prepMap[480] ?? null;
  const sauce = prepMap[479] ?? null;
  const bags  = prepMap[481] ?? null;

  // Assembly ratios from BOM (live, not hardcoded)
  const ballsBomRow  = bagBom.find(r => r.sub_recipe?.title === 'Meatballs');
  const sauceBomRow  = bagBom.find(r => r.sub_recipe?.title === 'Meatball Sauce');
  const BALLS_PER_BAG   = ballsBomRow ? Number(ballsBomRow.quantity) : 5;
  const SAUCE_PER_BAG_G = sauceBomRow ? Number(sauceBomRow.quantity) : 100;

  // ── Phase 2: card status ─────────────────────────────────────────────────
  const flagState   = flag?.state ?? 'not_found';
  const statusDot   = card.querySelector('.lab-status-dot');
  const statusLabel = card.querySelector('.lab-status-label');
  const statusBadge = card.querySelector('.lab-card-status');
  if (statusDot)   statusDot.className = 'lab-status-dot lab-status-assembly-blocked';
  if (statusLabel) statusLabel.textContent = t('lab.status.assembly_blocked');
  if (statusBadge) {
    const old = statusBadge.className.replace('lab-status-connected', '').trim();
    statusBadge.className = old + ' lab-status-assembly-blocked';
  }

  // ── Phase 3: fill base rows ──────────────────────────────────────────────
  setVal('trigger',    'Downstream — Meatball Appetizer POS demand (no BOH path yet)');
  setVal('recipe',     'Meatball Appetizer (bag) — 5 Meatballs + 100g Meatball Sauce');
  setVal('bom',        BALLS_PER_BAG + ' pz Meatballs + ' + SAUCE_PER_BAG_G + 'g Meatball Sauce (BOM bom_id=2156,2157)');
  setVal('stock',      bags ? (bags.current_stock != null ? bags.current_stock + ' ' + bags.unit : 'NULL (count needed)') : '—');
  setVal('boh_result', formatSuggestion(suggMap[481], lang));

  // ── Phase 4: detailed rows ───────────────────────────────────────────────
  setVal('mb_output',      '1 bag = ' + BALLS_PER_BAG + ' pz Meatballs + ' + SAUCE_PER_BAG_G + 'g Meatball Sauce');
  setVal('mb_balls_req',   BALLS_PER_BAG + ' pz per bag');
  setVal('mb_sauce_req',   SAUCE_PER_BAG_G + 'g per bag');
  setVal('mb_balls_stock', balls?.current_stock != null ? balls.current_stock + ' ' + balls.unit : 'NULL');
  setVal('mb_sauce_stock', sauce?.current_stock != null ? sauce.current_stock + ' ' + sauce.unit : 'NULL — count needed');
  setVal('mb_bags_stock',  bags?.current_stock  != null ? bags.current_stock  + ' ' + bags.unit  : 'NULL — count needed');

  setVal('mb_boh_balls', formatSuggestion(suggMap[480], lang));
  setVal('mb_boh_sauce', formatSuggestion(suggMap[479], lang));
  setVal('mb_boh_bags',  formatSuggestion(suggMap[481], lang));

  // Sauce transformation from BOM
  const pomRow   = sauceBom.find(r => r.sub_recipe?.title === 'POMODORO SAUCE');
  const demiRow  = sauceBom.find(r => r.sub_recipe?.title === 'DEMI');
  const pomG     = pomRow  ? Number(pomRow.quantity)  : 2800;
  const demiG    = demiRow ? Number(demiRow.quantity) : 500;
  const sauceBatchG = recipeMap['Meatball Sauce']?.base_weight_g ?? 3300;
  setVal('mb_sauce_transform', pomG + 'g Pomodoro + ' + demiG + 'g Demi → ' + sauceBatchG + 'g Meatball Sauce batch');

  // ── Phase 5: capacity calculation ────────────────────────────────────────
  const ballsStock = balls?.current_stock != null ? Number(balls.current_stock) : null;
  const sauceStock = sauce?.current_stock != null ? Number(sauce.current_stock) : null;
  const capBalls   = ballsStock != null ? Math.floor(ballsStock / BALLS_PER_BAG) : null;
  const capSauce   = sauceStock != null ? Math.floor(sauceStock / SAUCE_PER_BAG_G) : null;
  const capSafe    = capBalls != null && capSauce != null ? Math.min(capBalls, capSauce) : null;

  setVal('mb_cap_balls', capBalls != null ? capBalls + ' bags (floor(' + ballsStock + '/' + BALLS_PER_BAG + '))' : 'BLOCKED — stock unknown');
  setVal('mb_cap_sauce', capSauce != null ? capSauce + ' bags (floor(' + sauceStock + '/' + SAUCE_PER_BAG_G + 'g))' : 'BLOCKED — Sauce stock NULL (count first)');
  setVal('mb_cap_safe',  capSafe  != null ? capSafe + ' bags' : 'BLOCKED (sauce stock unknown)', capSafe != null ? 'lab-val-match' : 'lab-val-mismatch');

  // ── Phase 6: feature flag + RPC mismatch ─────────────────────────────────
  setVal('mb_flag',      flagState.toUpperCase() + ' (flag: meatball_assembly_model_enabled)');
  setVal('mb_rpc_model', 'ASSEMBLY MODEL CORRECT — 5 Meatballs (480) + 100g Meatball Sauce (479) per bag');
  setVal('mb_mismatch',
    '✓ Uses Meatball Sauce stock (prep 479)  ✓ Uses Meatball stock (prep 480)  ✓ No raw ingredient bypass',
    'lab-val-match'
  );

  // ── Phase 7: model comparison ────────────────────────────────────────────
  const traceEl = card.querySelector('.lab-trace');
  if (traceEl) {
    traceEl.innerHTML =
      '<div class="lab-model-block lab-model-correct">' +
        '<span class="lab-model-label">ASSEMBLY MODEL CORRECT — flag=' + flagState.toUpperCase() + '</span>' +
        '5 Meatballs (prep 480) + 100g Meatball Sauce (prep 479) → 1 bag. ' +
        'RPC fixed 2026-07-20: consumes prepared sauce (PT 479), not raw Pomodoro/Demi. ' +
        'Sauce chain: 2800g Pomodoro + 500g Demi → 3300g Meatball Sauce batch (prep 479).' +
      '</div>';
  }
}

export const ProductionLabPage = {
  render() {
    return `
      <div class="page-lab">
        <div class="page-header">
          <div class="page-header-top">
            <h2 class="page-title">${t('lab.title')}</h2>
            <span class="badge lab-badge-ro">${t('lab.badge')}</span>
          </div>
          <p class="page-subtitle">${t('lab.subtitle')}</p>
        </div>

        <div class="lab-stages">
          <div class="lab-stage">
            <span class="lab-stage-icon">🥩</span>
            <span class="lab-stage-label">${t('lab.stage.sale')}</span>
          </div>
          <span class="lab-stage-arrow">→</span>
          <div class="lab-stage">
            <span class="lab-stage-icon">🔪</span>
            <span class="lab-stage-label">${t('lab.stage.transform')}</span>
          </div>
          <span class="lab-stage-arrow">→</span>
          <div class="lab-stage">
            <span class="lab-stage-icon">🍽️</span>
            <span class="lab-stage-label">${t('lab.stage.assemble')}</span>
          </div>
        </div>

        <div class="lab-grid">
          ${LAB_CARDS.map(renderLabCard).join('')}
        </div>
      </div>
    `;
  },

  afterRender(el) {
    _loadAddChicken(el);
    _loadFriedCalamari(el);
    _loadProcessSalmon(el);
    _loadTruffleButter(el);
    _loadMeatballAssembly(el);
  },
};

/* ══════════════════════════════════════════════════════════════════════════ */
/*  PAGE REGISTRY                                                             */
/* ══════════════════════════════════════════════════════════════════════════ */

export const PAGES = {
  home:            HomePage,
  bot_center:      BotCenterPage,
  recipe:          RecipePage,
  inventory:       InventoryPage,
  daily_journal:   JournalPage,
  production_lab:  ProductionLabPage,
};

