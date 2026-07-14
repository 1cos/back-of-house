/* ============================================================
   Daily Operations Journal v0.2
   tasks.js — Tasks view
   ============================================================ */

import { USERS, STATUS_MAP } from './data.js';
import { toast } from './modal.js';

let _state = null;
let _save  = null;
let _goToChat = null;

export function initTasks(state, save, goToChat) {
  _state    = state;
  _save     = save;
  _goToChat = goToChat;
}

const TASK_FILTERS = ['All', 'Mine', 'Assigned by me', 'Completed'];
const TASK_STATUSES = ['Suggested','Open','In progress','Done','Dismissed'];

export function renderTasks() {
  renderTaskFilters();
  renderTaskList();
}

function renderTaskFilters() {
  const bar = document.getElementById('task-filter-bar');
  if (!bar) return;
  bar.innerHTML = TASK_FILTERS.map(f => `
    <button class="filter-pill${f === (_state.taskFilter || 'All') ? ' active' : ''}"
            data-filter="${f}" aria-pressed="${f === (_state.taskFilter || 'All')}">
      ${f}
    </button>`).join('');
  bar.querySelectorAll('.filter-pill').forEach(pill => {
    pill.addEventListener('click', () => {
      _state.taskFilter = pill.dataset.filter;
      _save(_state);
      renderTaskFilters();
      renderTaskList();
    });
  });
}

function renderTaskList() {
  const wrap = document.getElementById('task-list');
  if (!wrap) return;

  const userId = _state.currentUserId;
  const user   = USERS.find(u => u.id === userId);
  const fname  = user ? user.name : '';
  const f      = _state.taskFilter || 'All';

  let tasks = _state.tasks || [];
  if (f === 'Mine')           tasks = tasks.filter(t => t.assignTo?.toLowerCase() === fname.toLowerCase());
  if (f === 'Assigned by me') tasks = tasks.filter(t => t.assignedBy === userId);
  if (f === 'Completed')      tasks = tasks.filter(t => t.status === 'Done');
  if (f === 'All')            tasks = tasks.filter(t => t.status !== 'Dismissed');

  if (!tasks.length) {
    wrap.innerHTML = '<div class="empty-state"><p>No tasks for this filter.</p></div>';
    return;
  }

  wrap.innerHTML = tasks.slice().reverse().map(t => taskCardHtml(t)).join('');

  wrap.querySelectorAll('.task-action-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      updateTaskStatus(btn.dataset.taskId, btn.dataset.action);
    });
  });
  wrap.querySelectorAll('.task-source-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (_goToChat) _goToChat(btn.dataset.msgId);
    });
  });
  wrap.querySelectorAll('.task-case-link').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      document.dispatchEvent(new CustomEvent('doj:showLinkedItem', { detail: { type: 'case', id: btn.dataset.caseId } }));
    });
  });
}

function taskCardHtml(t) {
  const statusCfg = STATUS_MAP[t.status] || { cls: 'chip-gray', label: t.status };
  const assignedByUser = USERS.find(u => u.id === t.assignedBy);

  const sourceHtml = t.sourceMessageId
    ? `<button class="task-source-link" data-msg-id="${t.sourceMessageId}" aria-label="View source message">↗ From chat</button>` : '';
  const caseLink = t.relatedCaseId
    ? (() => { const c = _state.cases.find(x => x.id === t.relatedCaseId); return c ? `<button class="task-case-link" data-case-id="${t.relatedCaseId}" aria-label="View case">🗂 ${c.title}</button>` : ''; })() : '';
  const dueHtml = t.dueDateText ? `<span class="task-due">📅 ${t.dueDateText}</span>` : '';
  const assignHtml = t.assignTo ? `<span class="task-assign">→ ${t.assignTo}</span>` : '';
  const byHtml = assignedByUser ? `<span class="task-by">from ${assignedByUser.name}</span>` : '';

  // Action buttons based on status
  let actions = '';
  if (t.status === 'Suggested')    actions = `<button class="btn btn-sm btn-secondary task-action-btn" data-task-id="${t.id}" data-action="Open">Accept</button><button class="btn btn-sm btn-ghost task-action-btn" data-task-id="${t.id}" data-action="Dismissed">Dismiss</button>`;
  if (t.status === 'Open')         actions = `<button class="btn btn-sm btn-secondary task-action-btn" data-task-id="${t.id}" data-action="In progress">Start</button><button class="btn btn-sm btn-ghost task-action-btn" data-task-id="${t.id}" data-action="Dismissed">Dismiss</button>`;
  if (t.status === 'In progress')  actions = `<button class="btn btn-sm btn-primary task-action-btn" data-task-id="${t.id}" data-action="Done">Complete</button>`;
  if (t.status === 'Done')         actions = `<span class="task-done-label">✓ Completed</span>`;
  if (t.status === 'Dismissed')    actions = `<span class="text-muted">Dismissed</span>`;

  const doneCls = t.status === 'Done' ? 'task-card-done' : '';

  return `
    <div class="task-card ${doneCls}">
      <div class="task-card-body">
        <div class="task-header">
          <div class="task-title">${t.title}</div>
          <span class="status-chip ${statusCfg.cls}">${statusCfg.label}</span>
        </div>
        <div class="task-meta">
          ${assignHtml} ${byHtml} ${dueHtml}
          ${sourceHtml} ${caseLink}
        </div>
      </div>
      <div class="task-actions">${actions}</div>
    </div>`;
}

function updateTaskStatus(taskId, newStatus) {
  const t = _state.tasks.find(x => x.id === taskId);
  if (!t) return;
  t.status = newStatus;
  _save(_state);
  renderTaskList();
  toast(`Task → ${newStatus}.`, 'success');
}
