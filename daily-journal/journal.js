/* ============================================================
   Daily Operations Journal v0.2
   journal.js — Journal Feed (entries / shift reflections)
   ============================================================ */

import { USERS, CATEGORIES, STATUS_MAP } from './data.js';
import { toast, openModal, closeModal } from './modal.js';

let _state = null;
let _save  = null;
let _goToChat = null;

export function initJournal(state, save, goToChat) {
  _state    = state;
  _save     = save;
  _goToChat = goToChat;
}

export function renderJournal() {
  renderFilters();
  renderFeed();
}

/* --- Filters ----------------------------------------------- */
export function renderFilters() {
  const bar = document.getElementById('filter-bar');
  if (!bar) return;
  bar.innerHTML = CATEGORIES.map(cat => `
    <button class="filter-pill${cat === _state.categoryFilter ? ' active' : ''}"
            data-cat="${cat}" aria-pressed="${cat === _state.categoryFilter}">
      ${cat}
    </button>`).join('');
  bar.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      _state.categoryFilter = pill.dataset.cat;
      _save(_state);
      renderFilters();
      renderFeed();
    });
  });
}

/* --- Feed -------------------------------------------------- */
export function renderFeed() {
  const wrap = document.getElementById('journal-feed');
  if (!wrap) return;

  const todayStr = new Date().toISOString().split('T')[0];
  const yestDate = new Date(Date.now() - 86400000).toISOString().split('T')[0];

  let filtered = _state.entries;
  if (_state.categoryFilter !== 'All') {
    filtered = filtered.filter(e => e.category === _state.categoryFilter);
  }

  function ageGroup(entry) {
    const d = (entry.created || entry.date || '').split('T')[0];
    if (d === todayStr) return 'today';
    if (d === yestDate) return 'yesterday';
    return 'older';
  }

  const groups = {
    today:     filtered.filter(e => ageGroup(e) === 'today').reverse(),
    yesterday: filtered.filter(e => ageGroup(e) === 'yesterday').reverse(),
    older:     filtered.filter(e => ageGroup(e) === 'older').reverse(),
  };

  function section(label, items) {
    if (!items.length) return '';
    return `<div class="section-header">${label}</div>${items.map(e => entryCardHtml(e)).join('')}`;
  }

  const html = [
    section('Today', groups.today),
    section('Yesterday', groups.yesterday),
    section('Older', groups.older),
  ].filter(Boolean).join('');

  wrap.innerHTML = html || `<div class="empty-state"><p>No entries for this filter.</p></div>`;

  // Bind expand / add-update / change-status / source-link
  wrap.querySelectorAll('.card-main').forEach(el => {
    el.addEventListener('click', () => toggleCard(el.closest('.journal-card')));
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') toggleCard(el.closest('.journal-card')); });
  });
  wrap.querySelectorAll('.btn-add-update').forEach(el => {
    el.addEventListener('click', (ev) => { ev.stopPropagation(); openAddUpdateModal(el.dataset.id); });
  });
  wrap.querySelectorAll('[data-action="change-status"]').forEach(el => {
    el.addEventListener('click', (ev) => { ev.stopPropagation(); openChangeStatusModal(el.dataset.id); });
  });
  wrap.querySelectorAll('.source-link').forEach(el => {
    el.addEventListener('click', (ev) => {
      ev.stopPropagation();
      const msgId = el.dataset.msgId;
      if (_goToChat) _goToChat(msgId);
    });
  });
}

/* --- Entry card HTML --------------------------------------- */
function entryCardHtml(entry) {
  const user = USERS.find(u => u.id === (entry.authorId || entry.author));
  const statusCfg = STATUS_MAP[entry.status] || null;
  const isReflection = entry.type === 'reflection';

  const statusHtml = statusCfg
    ? `<span class="status-chip ${statusCfg.cls}">${statusCfg.label}</span>` : '';
  const reflectionBadge = isReflection
    ? `<span class="status-chip chip-purple">Shift Reflection</span>` : '';
  const sourceLinkHtml = entry.sourceMessageId
    ? `<button class="source-link" data-msg-id="${entry.sourceMessageId}" aria-label="View source message">
         ↗ From chat
       </button>` : '';
  const assignHtml = entry.assignTo
    ? `<span class="card-assign">→ ${entry.assignTo}</span>` : '';

  const updatesHtml = (entry.updates || []).map(u => {
    const au = USERS.find(x => x.id === (u.authorId || u.author)) || { name: u.authorId || u.author };
    return `<div class="update-block"><div class="update-time"><strong>${au.name}</strong></div>${escHtml(u.text)}</div>`;
  }).join('');

  const borderClass = statusBorderClass(entry);

  return `
    <article class="journal-card ${borderClass}" data-id="${entry.id}">
      <div class="card-main" tabindex="0" role="button" aria-expanded="false">
        <div class="card-body">
          <div class="card-meta">
            <span class="card-tag">${entry.category}</span>
            ${user ? `<span class="card-author"><strong>${user.name}</strong> · ${user.role}</span>` : ''}
            ${sourceLinkHtml}
          </div>
          ${entry.title ? `<div class="card-title">${entry.title}</div>` : ''}
          <div class="card-text">${escHtml(entry.text)}</div>
        </div>
      </div>
      <div class="card-footer">
        ${statusHtml}
        ${reflectionBadge}
        ${assignHtml}
      </div>
      <div class="card-expanded" id="exp-${entry.id}">
        <div class="card-expanded-inner">
          ${updatesHtml}
          <div class="expand-actions">
            <button class="btn btn-sm btn-ghost btn-add-update" data-id="${entry.id}">+ Add Update</button>
            <button class="btn btn-sm btn-ghost" data-action="change-status" data-id="${entry.id}">Change Status</button>
          </div>
        </div>
      </div>
    </article>`;
}

function statusBorderClass(entry) {
  if (entry.type === 'reflection') return 'status-reflection';
  const s = entry.status;
  if (s === 'Resolved' || s === 'Closed') return 'status-positive';
  if (entry.category === 'Incident') return 'status-urgent';
  if (s === 'In progress' || s === 'Waiting' || s === 'Open') return 'status-followup';
  return 'status-note';
}

function toggleCard(card) {
  const exp = card?.querySelector('.card-expanded');
  const btn = card?.querySelector('.card-main');
  if (!exp || !btn) return;
  const isOpen = exp.classList.contains('open');
  exp.classList.toggle('open', !isOpen);
  btn.setAttribute('aria-expanded', String(!isOpen));
}

function escHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

/* --- Add Update modal -------------------------------------- */
let _updateTargetId = null;

function openAddUpdateModal(entryId) {
  _updateTargetId = entryId;
  const t = document.getElementById('upd-text');
  if (t) t.value = '';
  openModal('modal-add-update');
}

export function initJournalModals() {
  document.getElementById('btn-save-update')?.addEventListener('click', () => {
    const text = document.getElementById('upd-text')?.value.trim();
    if (!text) { toast('Please write an update.', 'error'); return; }
    const entry = _state.entries.find(e => e.id === _updateTargetId);
    if (!entry) return;
    entry.updates = entry.updates || [];
    entry.updates.push({ authorId: _state.currentUserId, text, created: new Date().toISOString() });
    _save(_state);
    closeModal('modal-add-update');
    renderFeed();
    toast('Update saved.', 'success');
  });
  document.getElementById('btn-cancel-update')?.addEventListener('click', () => closeModal('modal-add-update'));
  document.getElementById('btn-close-update')?.addEventListener('click', () => closeModal('modal-add-update'));

  // Change status
  let _statusTargetId = null;
  document.getElementById('btn-save-status')?.addEventListener('click', () => {
    const newStatus = document.getElementById('cs-status')?.value;
    const entry = _state.entries.find(e => e.id === _statusTargetId);
    if (!entry) return;
    entry.status = newStatus;
    _save(_state);
    closeModal('modal-change-status');
    renderFeed();
    toast(`Status → ${newStatus}.`, 'success');
  });
  document.getElementById('btn-cancel-status')?.addEventListener('click', () => closeModal('modal-change-status'));
  document.getElementById('btn-close-status')?.addEventListener('click', () => closeModal('modal-change-status'));

  // Intercept change-status opens (need to set _statusTargetId)
  document.addEventListener('doj:openChangeStatus', (e) => {
    _statusTargetId = e.detail.id;
    const entry = _state.entries.find(x => x.id === _statusTargetId);
    const sel = document.getElementById('cs-status');
    if (sel && entry) sel.value = entry.status || 'Open';
    openModal('modal-change-status');
  });
}

function openChangeStatusModal(entryId) {
  document.dispatchEvent(new CustomEvent('doj:openChangeStatus', { detail: { id: entryId } }));
}

/* --- Add Entry modal --------------------------------------- */
export function initAddEntryModal() {
  document.getElementById('btn-save-entry')?.addEventListener('click', () => {
    const category    = document.getElementById('ae-category')?.value;
    const title       = document.getElementById('ae-title')?.value.trim();
    const description = document.getElementById('ae-description')?.value.trim();
    const status      = document.getElementById('ae-status')?.value;
    const assignTo    = document.getElementById('ae-assignto')?.value.trim() || null;

    if (!category)    { toast('Select a category.', 'error'); return; }
    if (!description) { toast('Add a description.', 'error'); return; }

    const entry = {
      id:       'entry-' + Date.now(),
      type:     'note',
      category, title, text: description,
      authorId: _state.currentUserId,
      status,
      assignTo,
      created:  new Date().toISOString(),
      date:     new Date().toISOString().split('T')[0],
      updates:  [],
      sourceMessageId: null,
    };
    _state.entries.push(entry);
    _save(_state);
    closeModal('modal-add-entry');
    renderFeed();
    toast('Entry saved.', 'success');
  });
  document.getElementById('btn-cancel-entry')?.addEventListener('click', () => closeModal('modal-add-entry'));
  document.getElementById('btn-close-entry')?.addEventListener('click', () => closeModal('modal-add-entry'));
}

/* --- Shift Reflection modal -------------------------------- */
export function initReflectionModal() {
  // Mood buttons
  document.querySelectorAll('.mood-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.mood-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
    });
  });
  // Check items
  document.querySelectorAll('.check-item').forEach(item => {
    const cb = item.querySelector('input[type="checkbox"]');
    if (!cb) return;
    item.addEventListener('click', () => { cb.checked = !cb.checked; item.classList.toggle('checked', cb.checked); });
    cb.addEventListener('click', (e) => { e.stopPropagation(); item.classList.toggle('checked', cb.checked); });
  });
  // Follow-up toggle
  document.querySelectorAll('[name="ref-followup"]').forEach(radio => {
    radio.addEventListener('change', () => {
      const extras = document.getElementById('ref-followup-extras');
      if (extras) extras.classList.toggle('visible', radio.value === 'yes' && radio.checked);
    });
  });

  document.getElementById('btn-save-reflection')?.addEventListener('click', () => {
    const perspective = document.getElementById('ref-perspective')?.value;
    if (!perspective) { toast('Select a perspective.', 'error'); return; }
    const feel      = document.querySelector('.mood-btn.selected')?.dataset.feel || '';
    const influences = [];
    document.querySelectorAll('.check-item input:checked').forEach(cb => influences.push(cb.value));
    const well     = document.getElementById('ref-well')?.value.trim();
    const notWell  = document.getElementById('ref-nowell')?.value.trim();
    const nextMgr  = document.getElementById('ref-nextmgr')?.value.trim();
    const followUp = document.getElementById('ref-followup-yes')?.checked;

    const parts = [];
    if (feel)    parts.push(`Shift felt ${feel.toLowerCase()}.`);
    if (well)    parts.push(well);
    if (notWell) parts.push(`Issue: ${notWell}`);
    const text = parts.join(' ') || 'Shift reflection completed.';

    const entry = {
      id:       'entry-' + Date.now(),
      type:     'reflection',
      category: perspective,
      title:    `Shift Reflection — ${perspective}`,
      text,
      authorId: _state.currentUserId,
      status:   null,
      assignTo: followUp ? (document.getElementById('ref-assign')?.value.trim() || null) : null,
      created:  new Date().toISOString(),
      date:     new Date().toISOString().split('T')[0],
      updates:  [],
      sourceMessageId: null,
      reflection: { perspective, feel, influences, well, notWell, nextManager: nextMgr, followUp },
    };
    _state.entries.push(entry);
    _save(_state);
    closeModal('modal-reflection');
    renderFeed();
    toast('Shift reflection saved.', 'success');
  });
  document.getElementById('btn-cancel-reflection')?.addEventListener('click', () => closeModal('modal-reflection'));
  document.getElementById('btn-close-reflection')?.addEventListener('click', () => closeModal('modal-reflection'));
}
