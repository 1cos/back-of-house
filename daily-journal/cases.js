/* ============================================================
   Daily Operations Journal v0.2
   cases.js — Open Cases view
   ============================================================ */

import { USERS, STATUS_MAP } from './data.js';
import { toast } from './modal.js';

let _state   = null;
let _save    = null;
let _goToChat = null;

export function initCases(state, save, goToChat) {
  _state    = state;
  _save     = save;
  _goToChat = goToChat;
}

export function openCasesCount() {
  return (_state.cases || []).filter(c => c.status !== 'Resolved' && c.status !== 'Closed').length;
}

export function renderCases() {
  const wrap = document.getElementById('cases-list');
  if (!wrap) return;

  const cases = _state.cases || [];
  if (!cases.length) {
    wrap.innerHTML = '<div class="empty-state"><p>No cases.</p></div>';
    return;
  }

  wrap.innerHTML = cases.map(c => caseHtml(c)).join('');

  wrap.querySelectorAll('.case-header').forEach(el => {
    el.addEventListener('click', () => {
      const card = el.closest('.case-card');
      card.classList.toggle('open');
      el.setAttribute('aria-expanded', String(card.classList.contains('open')));
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') el.click();
    });
  });
  wrap.querySelectorAll('.btn-add-case-update').forEach(el => {
    el.addEventListener('click', (ev) => { ev.stopPropagation(); toggleCaseUpdateForm(el.dataset.id); });
  });
  wrap.querySelectorAll('.btn-save-case-update').forEach(el => {
    el.addEventListener('click', (ev) => { ev.stopPropagation(); saveCaseUpdate(el.dataset.id); });
  });
  wrap.querySelectorAll('.btn-cancel-case-update').forEach(el => {
    el.addEventListener('click', (ev) => { ev.stopPropagation(); toggleCaseUpdateForm(el.dataset.id); });
  });
  wrap.querySelectorAll('.case-status-select').forEach(el => {
    el.addEventListener('change', () => changeCaseStatus(el.dataset.id, el.value));
  });
  wrap.querySelectorAll('.tl-source-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_goToChat) _goToChat(btn.dataset.msgId);
    });
  });
}

function caseHtml(c) {
  const statusCfg = STATUS_MAP[c.status] || { cls: 'chip-gray', label: c.status };
  const tlHtml = (c.timeline || []).map(t => {
    const srcLink = t.sourceMessageId
      ? `<button class="tl-source-link" data-msg-id="${t.sourceMessageId}" aria-label="View source message">↗</button>` : '';
    return `
      <div class="timeline-entry">
        <div class="tl-dot"></div>
        <div class="tl-author">${t.author}</div>
        <div class="tl-text">${escHtml(t.text)}</div>
        <div class="tl-meta">${t.date} ${srcLink}</div>
      </div>`;
  }).join('');

  const updatesHtml = (c.updates || []).map(u => {
    const au = USERS.find(x => x.id === (u.authorId || u.author)) || { name: u.authorId || u.author };
    return `
      <div class="update-block">
        <div class="update-time"><strong>${au.name}</strong></div>
        ${escHtml(u.text)}
      </div>`;
  }).join('');

  const peopleHtml = (c.people || []).map(p => `<span class="people-pill">${p}</span>`).join('');
  const nextHtml = c.nextAction
    ? `<div class="case-next-action"><strong>Next action</strong>${escHtml(c.nextAction)}</div>` : '';

  return `
    <div class="case-card" data-id="${c.id}">
      <div class="case-header" tabindex="0" role="button" aria-expanded="false">
        <div class="case-icon">${c.icon}</div>
        <div class="case-title-area">
          <div class="case-title">${c.title}</div>
          <div class="case-subtitle">${c.category}</div>
        </div>
        <span class="status-chip ${statusCfg.cls}">${statusCfg.label}</span>
        <svg class="case-chevron" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </div>
      <div class="case-body">
        <p class="text-muted mt-8">${escHtml(c.description)}</p>
        <div class="case-people">${peopleHtml}</div>
        <div class="fieldset-label">Timeline</div>
        <div class="case-timeline">${tlHtml}</div>
        ${updatesHtml}
        ${nextHtml}
        <div class="case-actions">
          <button class="btn btn-sm btn-secondary btn-add-case-update" data-id="${c.id}">+ Add Update</button>
          <label for="cstat-${c.id}" class="visually-hidden">Change status</label>
          <select class="status-select case-status-select" id="cstat-${c.id}" data-id="${c.id}">
            ${['Open','In progress','Waiting','Resolved','Closed'].map(s =>
              `<option value="${s}"${s === c.status ? ' selected' : ''}>${s}</option>`
            ).join('')}
          </select>
        </div>
        <div class="case-update-form" id="cuf-${c.id}">
          <label for="cuf-text-${c.id}" class="visually-hidden">Update text</label>
          <textarea id="cuf-text-${c.id}" placeholder="Write your update…" rows="3"></textarea>
          <div class="expand-actions mt-8">
            <button class="btn btn-sm btn-primary btn-save-case-update" data-id="${c.id}">Save Update</button>
            <button class="btn btn-sm btn-ghost btn-cancel-case-update" data-id="${c.id}">Cancel</button>
          </div>
        </div>
      </div>
    </div>`;
}

function escHtml(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

function toggleCaseUpdateForm(caseId) {
  document.getElementById(`cuf-${caseId}`)?.classList.toggle('open');
}

function saveCaseUpdate(caseId) {
  const textarea = document.getElementById(`cuf-text-${caseId}`);
  const text = textarea?.value.trim();
  if (!text) { toast('Write an update first.', 'error'); return; }
  const c = _state.cases.find(x => x.id === caseId);
  if (!c) return;
  c.updates = c.updates || [];
  c.updates.push({ authorId: _state.currentUserId, text, created: new Date().toISOString() });
  const u = USERS.find(x => x.id === _state.currentUserId);
  c.timeline.push({ author: u?.name || _state.currentUserId, text, date: 'Just now', sourceMessageId: null });
  _save(_state);
  renderCases();
  updateCaseBadge();
  toast('Update saved.', 'success');
}

function changeCaseStatus(caseId, newStatus) {
  const c = _state.cases.find(x => x.id === caseId);
  if (!c) return;
  c.status = newStatus;
  _save(_state);
  renderCases();
  updateCaseBadge();
  toast(`Status → "${newStatus}".`, 'success');
}

export function updateCaseBadge() {
  const b = document.getElementById('cases-badge');
  if (b) b.textContent = openCasesCount();
}

export function scrollToCaseAndOpen(caseId) {
  const card = document.querySelector(`.case-card[data-id="${caseId}"]`);
  if (!card) return;
  card.classList.add('open');
  card.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
