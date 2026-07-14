/* ============================================================
   Daily Operations Journal v0.2 — deployed to back-of-house/daily-journal/
   chat.js — Chat view, AI bridge (real + mock fallback), Review sheet
   ============================================================ */

import { USERS, analyzeMessage } from './data.js';
import { toast, openModal, closeModal } from './modal.js';
import { interpretJournalMessage, JOURNAL_AI_MODE, AI_FAILURE, _keywordFallback, JOURNAL_AI_TIMEOUT_MS } from './journal-ai.js';

let _state = null;
let _save  = null;
let _rerenderJournal = null;

export function initChat(state, save, rerenderJournal) {
  _state          = state;
  _save           = save;
  _rerenderJournal = rerenderJournal;
}

function userById(id) {
  return USERS.find(u => u.id === id) || { name: id, initials: '?', color: '#999' };
}

function fmtTime(iso) {
  const d = new Date(iso);
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function avatarHtml(user, size = 32) {
  return `<div class="chat-avatar" style="width:${size}px;height:${size}px;background:${user.color};flex-shrink:0;" aria-hidden="true">${user.initials}</div>`;
}

/* --- Render chat feed -------------------------------------- */
export function renderChat() {
  const feed = document.getElementById('chat-feed');
  if (!feed) return;

  const currentUser = userById(_state.currentUserId);
  feed.innerHTML = _state.messages.map(msg => msgHtml(msg, currentUser)).join('');

  // Bind events
  feed.querySelectorAll('.ai-review-btn').forEach(btn => {
    btn.addEventListener('click', () => openAIReview(btn.dataset.msgId));
  });
  feed.querySelectorAll('.ai-accept-btn').forEach(btn => {
    btn.addEventListener('click', () => acceptAllSuggestions(btn.dataset.msgId));
  });
  feed.querySelectorAll('.ai-ignore-btn').forEach(btn => {
    btn.addEventListener('click', () => ignoreSuggestions(btn.dataset.msgId));
  });
  feed.querySelectorAll('.ai-retry-btn').forEach(btn => {
    btn.addEventListener('click', () => retryAI(btn.dataset.msgId));
  });
  feed.querySelectorAll('.linked-item-tag').forEach(btn => {
    btn.addEventListener('click', () => {
      const type = btn.dataset.type;
      const id   = btn.dataset.id;
      highlightLinkedItem(type, id);
    });
  });
  feed.querySelectorAll('.reaction-btn').forEach(btn => {
    btn.addEventListener('click', () => toggleReaction(btn.dataset.msgId, btn.dataset.emoji));
  });

  // Scroll to bottom
  feed.scrollTop = feed.scrollHeight;
}

function msgHtml(msg, currentUser) {
  const author  = userById(msg.authorId);
  const isMine  = msg.authorId === currentUser.id;
  const ai      = msg.aiResult;
  const linked  = (msg.linkedItems || []);

  const bubbleCls = isMine ? 'bubble-mine' : 'bubble-other';

  // Reactions
  const reactHtml = (msg.reactions || []).filter(r => r.by.length > 0).map(r =>
    `<button class="reaction-btn" data-msg-id="${msg.id}" data-emoji="${r.emoji}" aria-label="React ${r.emoji}">
      ${r.emoji} <span>${r.by.length}</span>
    </button>`
  ).join('');

  // Linked items tags
  const linkedHtml = linked.length
    ? `<div class="linked-items">${linked.map(li =>
        `<button class="linked-item-tag" data-type="${li.type}" data-id="${li.id}" aria-label="View linked ${li.type}">
          ${li.type === 'entry' ? '📋' : li.type === 'task' ? '✅' : li.type === 'case_update' ? '🗂' : '📝'} ${li.title}
        </button>`
      ).join('')}</div>` : '';

  // ── AI card ──────────────────────────────────────────────────────────────────
  let aiCardHtml = '';
  if (ai && ai.analyzing) {
    // Waiting for AI response
    aiCardHtml = `
      <div class="ai-card${isMine ? ' ai-card-mine' : ''} ai-card-analyzing">
        <span class="ai-label">✦ Analyzing…</span>
        <span class="ai-summary" style="color:var(--text-3);font-size:11px;">up to 35s</span>
      </div>`;

  } else if (ai && ai.pending) {
    // Timeout or network failure — honest, no fake suggestions
    const isTimeout = ai.failureType === 'timeout';
    const label     = isTimeout ? 'AI timed out — message saved' : 'AI unreachable — message saved';
    aiCardHtml = `
      <div class="ai-card${isMine ? ' ai-card-mine' : ''} ai-card-pending" role="status">
        <span class="ai-label ai-label-warn">⚠ ${label}</span>
        <span class="ai-summary">Review manually or try again later</span>
        <div class="ai-actions">
          <button class="ai-retry-btn btn-ai" data-msg-id="${msg.id}" aria-label="Retry AI analysis">Retry</button>
          <button class="ai-ignore-btn btn-ai btn-ai-ignore" data-msg-id="${msg.id}" aria-label="Dismiss">Dismiss</button>
        </div>
      </div>`;

  } else if (ai && ai.analyzed && !ai.ignored && !ai.accepted) {
    const isKeyword = ai.source === 'keyword';
    const activeCount = (ai.suggestions || []).filter(s => s.active).length;

    if (isKeyword) {
      // Keyword-only extraction — clearly labeled, no accept-all
      aiCardHtml = `
        <div class="ai-card${isMine ? ' ai-card-mine' : ''} ai-card-keyword" role="status">
          <span class="ai-label ai-label-warn">⚠ Keyword extraction only</span>
          <span class="ai-summary">AI was unavailable — categories detected, no semantic analysis</span>
          <div class="ai-actions">
            <button class="ai-review-btn btn-ai" data-msg-id="${msg.id}">Review</button>
            <button class="ai-ignore-btn btn-ai btn-ai-ignore" data-msg-id="${msg.id}">Dismiss</button>
          </div>
        </div>`;
    } else {
      // Real AI success
      aiCardHtml = `
        <div class="ai-card${isMine ? ' ai-card-mine' : ''}">
          <span class="ai-label" aria-label="AI organized this message">✦ AI organized this message</span>
          <span class="ai-summary">${activeCount} suggestion${activeCount !== 1 ? 's' : ''}</span>
          <div class="ai-actions">
            <button class="ai-review-btn btn-ai" data-msg-id="${msg.id}">Review</button>
            <button class="ai-accept-btn btn-ai btn-ai-accept" data-msg-id="${msg.id}">Accept all</button>
            <button class="ai-ignore-btn btn-ai btn-ai-ignore" data-msg-id="${msg.id}">Ignore</button>
          </div>
        </div>`;
    }

  } else if (ai && ai.accepted && linked.length > 0) {
    aiCardHtml = `
      <div class="ai-card ai-card-done${isMine ? ' ai-card-mine' : ''}">
        ✦ Created ${linked.length} item${linked.length !== 1 ? 's' : ''}
      </div>`;
  }

  const msgContent = isMine
    ? `
      <div class="msg-row msg-row-mine">
        <div class="msg-col-right">
          <div class="bubble ${bubbleCls}">${escHtml(msg.text)}</div>
          <div class="msg-meta-mine">
            <span class="msg-time">${fmtTime(msg.created)}</span>
          </div>
          ${reactHtml ? `<div class="reactions reactions-mine">${reactHtml}</div>` : ''}
          ${linkedHtml}
          ${aiCardHtml}
        </div>
      </div>`
    : `
      <div class="msg-row">
        ${avatarHtml(author)}
        <div class="msg-col">
          <div class="msg-author">${author.name} <span class="msg-role">${author.role}</span></div>
          <div class="bubble ${bubbleCls}">${escHtml(msg.text)}</div>
          <div class="msg-meta">
            <span class="msg-time">${fmtTime(msg.created)}</span>
          </div>
          ${reactHtml ? `<div class="reactions">${reactHtml}</div>` : ''}
          ${linkedHtml}
          ${aiCardHtml}
        </div>
      </div>`;

  return `<div class="msg-wrap" id="msgwrap-${msg.id}">${msgContent}</div>`;
}

function escHtml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\n/g, '<br>');
}

/* --- Send message ------------------------------------------ */
export async function sendMessage(text) {
  if (!text.trim()) return;
  const msgId = 'msg-' + Date.now();
  const author = userById(_state.currentUserId);

  // Add message immediately with "analyzing" state
  const newMsg = {
    id: msgId,
    authorId: _state.currentUserId,
    text: text.trim(),
    created: new Date().toISOString(),
    reactions: [],
    aiResult: {
      analyzed: false,
      analyzing: true,
      accepted: false,
      ignored: false,
      suggestions: [],
      source: null,
    },
    linkedItems: [],
  };
  _state.messages.push(newMsg);
  _save(_state);
  renderChat();

  // ── Call real AI bridge (35s timeout, honest failure handling) ──────────────
  const openCases = (_state.cases || []).filter(c => c.status !== 'Resolved' && c.status !== 'Closed');
  let aiResult;
  try {
    const result = await interpretJournalMessage({
      message:      text.trim(),
      author:       { name: author.name, role: author.role, dept: author.dept || author.role },
      openCases,
      tasks:        (_state.tasks || []).filter(t => t.status !== 'Done' && t.status !== 'Dismissed'),
    });

    // Success — normalize suggestions to v0.2 format
    const suggestions = (result.suggestions || []).map(s => ({
      id:            s.id || `sug-${msgId}-${Math.random().toString(36).slice(2,6)}`,
      type:          _mapSuggestionType(s.type),
      title:         s.title || 'Untitled',
      category:      s.category || 'Communication',
      assignTo:      s.assignTo || null,
      dueDateText:   s.dueDateText || null,
      relatedCaseId: _resolveRelatedCase(s.relatedCaseId, openCases),
      statusHint:    s.statusHint || null,
      confidence:    s.confidence || 0.8,
      details:       s.details || null,
      active:        true,
    }));

    aiResult = {
      analyzed:     true,
      analyzing:    false,
      accepted:     false,
      ignored:      false,
      suggestions,
      source:       result.source || 'live',
      summary:      result.summary || null,
      uncertainties: result.uncertainties || [],
    };

  } catch (err) {
    // ── Failure path: distinguish type and respond honestly ──────────────────
    const failureType = err.failureType || AI_FAILURE.NETWORK;
    const isComplex   = text.trim().length > 50;

    if (failureType === AI_FAILURE.TIMEOUT || failureType === AI_FAILURE.NETWORK) {
      // For network/timeout: message saved, AI marked PENDING — no fake suggestions.
      // User sees "AI couldn't reach the server" and can retry manually.
      aiResult = {
        analyzed:     false,
        analyzing:    false,
        pending:      true,          // new state: pending retry
        failureType,
        accepted:     false,
        ignored:      false,
        suggestions:  [],
        source:       'pending',
        summary:      null,
      };
    } else if (isComplex) {
      // Complex message + bad_json/http_error: save pending, don't guess
      aiResult = {
        analyzed:     false,
        analyzing:    false,
        pending:      true,
        failureType,
        accepted:     false,
        ignored:      false,
        suggestions:  [],
        source:       'pending',
        summary:      null,
      };
    } else {
      // Short/simple message + non-timeout error: keyword extraction as explicit fallback
      // Suggestions are inactive (active:false) and labeled clearly as keyword-only.
      const kw = _keywordFallback(text, author, openCases);
      aiResult = {
        analyzed:     true,
        analyzing:    false,
        pending:      false,
        failureType,
        accepted:     false,
        ignored:      false,
        suggestions:  kw.suggestions.map(s => ({ ...s, active: false })),
        source:       'keyword',
        summary:      null,
      };
    }

    console.warn(`[JournalAI] ${failureType}: ${err.message}`);
  }

  // Update the message in state
  const msg = _state.messages.find(m => m.id === msgId);
  if (msg) msg.aiResult = aiResult;
  _save(_state);
  renderChat();
}

function _mapSuggestionType(type) {
  // Map live AI types to v0.2 internal types
  const map = {
    'journal_entry': 'entry',
    'communication': 'communication',
    'task':          'task',
    'case_update':   'case_update',
    'new_case':      'case_update',
    'shift_reflection': 'entry',
    'entry':         'entry',
  };
  return map[type] || 'communication';
}

function _resolveRelatedCase(caseIdFromAI, openCases) {
  if (!caseIdFromAI) return null;
  const cases = openCases || (_state.cases || []).filter(c => c.status !== 'Resolved' && c.status !== 'Closed');
  const found = cases.find(c => c.id === caseIdFromAI);
  return found ? found.id : null;
}

function buildSuggestionTitle(s, text, analysis) {
  // Generate a readable title from the message
  const words = text.split(/\s+/).slice(0, 8).join(' ');
  if (s.type === 'task')         return `Task: ${words}…`;
  if (s.type === 'entry')        return `Note: ${words}…`;
  if (s.type === 'case_update')  return `Case update: ${words}…`;
  return `Note: ${words}…`;
}

function extractDateText(text) {
  const days = ['monday','tuesday','wednesday','thursday','friday','saturday','sunday'];
  const words = ['tomorrow','today','friday','wednesday','saturday'];
  const textLow = text.toLowerCase();
  for (const w of [...days, ...words]) {
    if (textLow.includes(w)) return w.charAt(0).toUpperCase() + w.slice(1);
  }
  return null;
}

/* --- Reactions --------------------------------------------- */
function toggleReaction(msgId, emoji) {
  const msg = _state.messages.find(m => m.id === msgId);
  if (!msg) return;
  const userId = _state.currentUserId;
  let r = msg.reactions.find(x => x.emoji === emoji);
  if (!r) { r = { emoji, by: [] }; msg.reactions.push(r); }
  const idx = r.by.indexOf(userId);
  if (idx > -1) r.by.splice(idx, 1);
  else r.by.push(userId);
  // Remove empty reaction
  msg.reactions = msg.reactions.filter(x => x.by.length > 0);
  _save(_state);
  renderChat();
}

/* --- Accept all suggestions -------------------------------- */
export function acceptAllSuggestions(msgId) {
  const msg = _state.messages.find(m => m.id === msgId);
  if (!msg || !msg.aiResult) return;

  const created = [];
  msg.aiResult.suggestions.filter(s => s.active).forEach(sug => {
    const item = applySuggestion(sug, msg);
    if (item) created.push(item);
  });

  msg.aiResult.accepted = true;
  msg.linkedItems = created;
  _state.acceptedSuggestions.push(msgId);

  _save(_state);
  renderChat();
  if (_rerenderJournal) _rerenderJournal();
  toast(`Accepted — created ${created.length} item${created.length !== 1 ? 's' : ''}.`, 'success');
}

function applySuggestion(sug, sourceMsg) {
  const now = new Date().toISOString();
  const authorUser = userById(sourceMsg.authorId);

  if (sug.type === 'task') {
    const task = {
      id: 'task-' + Date.now() + Math.random().toString(36).slice(2,6),
      title: sug.title,
      assignTo: sug.assignTo || authorUser.name,
      assignedBy: sourceMsg.authorId,
      status: 'Open',
      dueDateText: sug.dueDateText || null,
      category: sug.category,
      relatedCaseId: sug.relatedCaseId || null,
      sourceMessageId: sourceMsg.id,
      created: now,
    };
    _state.tasks.push(task);
    return { type: 'task', id: task.id, title: sug.title };
  }

  if (sug.type === 'entry' || sug.type === 'communication') {
    const entry = {
      id: 'entry-' + Date.now() + Math.random().toString(36).slice(2,6),
      type: 'note',
      category: sug.category,
      title: sug.title,
      text: sourceMsg.text,
      authorId: sourceMsg.authorId,
      status: sug.status || sug.statusHint || 'Open',
      assignTo: sug.assignTo || null,
      created: now,
      date: new Date().toISOString().split('T')[0],
      updates: [],
      sourceMessageId: sourceMsg.id,
    };
    _state.entries.push(entry);
    return { type: 'entry', id: entry.id, title: sug.title };
  }

  if (sug.type === 'case_update') {
    const caseObj = sug.relatedCaseId ? _state.cases.find(c => c.id === sug.relatedCaseId) : null;
    if (caseObj) {
      caseObj.timeline.push({
        author: authorUser.name,
        text: sug.details || sourceMsg.text,
        date: 'Today',
        sourceMessageId: sourceMsg.id,
      });
      if (sug.statusHint === 'Resolved') caseObj.status = 'Resolved';
      return { type: 'case_update', id: caseObj.id, title: `Case updated: ${caseObj.title}` };
    }
    // No related case — create an entry instead
    const entry = {
      id: 'entry-' + Date.now() + Math.random().toString(36).slice(2,6),
      type: 'note',
      category: sug.category,
      title: sug.title,
      text: sug.details || sourceMsg.text,
      authorId: sourceMsg.authorId,
      status: sug.statusHint || 'Open',
      assignTo: null,
      created: now,
      date: new Date().toISOString().split('T')[0],
      updates: [],
      sourceMessageId: sourceMsg.id,
    };
    _state.entries.push(entry);
    return { type: 'entry', id: entry.id, title: sug.title };
  }

  return null;
}

/* --- Retry AI (for pending/timeout messages) --------------- */
async function retryAI(msgId) {
  const msg = _state.messages.find(m => m.id === msgId);
  if (!msg) return;

  // Reset to analyzing state
  msg.aiResult = { analyzed: false, analyzing: true, pending: false, accepted: false, ignored: false, suggestions: [], source: null };
  _save(_state);
  renderChat();

  const author = userById(msg.authorId);
  const openCases = (_state.cases || []).filter(c => c.status !== 'Resolved' && c.status !== 'Closed');

  try {
    const result = await interpretJournalMessage({
      message:   msg.text,
      author:    { name: author.name, role: author.role, dept: author.dept || author.role },
      openCases,
      tasks:     (_state.tasks || []).filter(t => t.status !== 'Done' && t.status !== 'Dismissed'),
    });
    const suggestions = (result.suggestions || []).map(s => ({
      id:            s.id || `sug-retry-${Date.now()}-${Math.random().toString(36).slice(2,5)}`,
      type:          _mapSuggestionType(s.type),
      title:         s.title || 'Untitled',
      category:      s.category || 'Communication',
      assignTo:      s.assignTo || null,
      dueDateText:   s.dueDateText || null,
      relatedCaseId: _resolveRelatedCase(s.relatedCaseId, openCases),
      statusHint:    s.statusHint || null,
      confidence:    s.confidence || 0.8,
      details:       s.details || null,
      active:        true,
    }));
    msg.aiResult = { analyzed: true, analyzing: false, pending: false, accepted: false, ignored: false, suggestions, source: result.source || 'live', summary: result.summary || null };
  } catch (err) {
    const failureType = err.failureType || AI_FAILURE.NETWORK;
    msg.aiResult = { analyzed: false, analyzing: false, pending: true, failureType, accepted: false, ignored: false, suggestions: [], source: 'pending', summary: null };
    console.warn(`[JournalAI retry] ${failureType}: ${err.message}`);
  }
  _save(_state);
  renderChat();
}

/* --- Ignore suggestions ------------------------------------ */
function ignoreSuggestions(msgId) {
  const msg = _state.messages.find(m => m.id === msgId);
  if (!msg || !msg.aiResult) return;
  msg.aiResult.ignored = true;
  _state.ignoredSuggestions.push(msgId);
  _save(_state);
  renderChat();
}

/* --- AI Review modal --------------------------------------- */
let _reviewMsgId = null;

export function openAIReview(msgId) {
  _reviewMsgId = msgId;
  const msg  = _state.messages.find(m => m.id === msgId);
  if (!msg || !msg.aiResult) return;

  const body = document.getElementById('review-body');
  if (!body) return;

  const currentUser = userById(_state.currentUserId);
  body.innerHTML = reviewBodyHtml(msg, currentUser);

  // Bind toggles
  body.querySelectorAll('.sug-toggle').forEach(cb => {
    cb.addEventListener('change', () => {
      const sugId = cb.dataset.sugId;
      const sug   = msg.aiResult.suggestions.find(s => s.id === sugId);
      if (sug) sug.active = cb.checked;
    });
  });

  openModal('modal-ai-review');
}

function reviewBodyHtml(msg, currentUser) {
  const sugs = msg.aiResult.suggestions;
  if (!sugs.length) return '<p class="text-muted">No suggestions for this message.</p>';

  return sugs.map(sug => {
    const icon = sug.type === 'task' ? '✅' : sug.type === 'case_update' ? '🗂' : '📋';
    const typeLabel = sug.type === 'task' ? 'Task' : sug.type === 'case_update' ? 'Case update' : 'Journal entry';

    // Find related case name
    let caseName = '';
    if (sug.relatedCaseId) {
      const c = _state.cases.find(x => x.id === sug.relatedCaseId);
      if (c) caseName = c.title;
    }

    return `
      <div class="review-suggestion" data-sug-id="${sug.id}">
        <div class="review-sug-header">
          <label class="review-sug-check">
            <input type="checkbox" class="sug-toggle" data-sug-id="${sug.id}" ${sug.active ? 'checked' : ''}>
            <span class="review-sug-icon">${icon}</span>
            <span class="review-sug-type">${typeLabel}</span>
          </label>
        </div>
        <div class="review-sug-body">
          <div class="form-group">
            <label>Title</label>
            <input type="text" class="sug-title-input" data-sug-id="${sug.id}" value="${escAttr(sug.title)}">
          </div>
          <div class="form-row">
            <div class="form-group">
              <label>Category</label>
              <input type="text" class="sug-cat-input" data-sug-id="${sug.id}" value="${escAttr(sug.category)}">
            </div>
            <div class="form-group">
              <label>Assign to</label>
              <input type="text" class="sug-assign-input" data-sug-id="${sug.id}" value="${escAttr(sug.assignTo || '')}">
            </div>
          </div>
          ${sug.dueDateText ? `<div class="form-group"><label>Due</label><input type="text" class="sug-due-input" data-sug-id="${sug.id}" value="${escAttr(sug.dueDateText)}"></div>` : ''}
          ${caseName ? `<div class="review-related-case">🗂 Related: <strong>${caseName}</strong></div>` : ''}
          ${sug.details ? `<div class="review-details">${escHtml(sug.details)}</div>` : ''}
        </div>
      </div>`;
  }).join('<hr class="review-divider">');
}

function escAttr(str) {
  return (str || '').replace(/"/g, '&quot;');
}

export function saveSelectedReview() {
  const msgId = _reviewMsgId;
  if (!msgId) return;
  const msg = _state.messages.find(m => m.id === msgId);
  if (!msg || !msg.aiResult) return;

  // Read back edits from form inputs
  const body = document.getElementById('review-body');
  if (body) {
    body.querySelectorAll('.sug-title-input').forEach(inp => {
      const sug = msg.aiResult.suggestions.find(s => s.id === inp.dataset.sugId);
      if (sug) sug.title = inp.value;
    });
    body.querySelectorAll('.sug-cat-input').forEach(inp => {
      const sug = msg.aiResult.suggestions.find(s => s.id === inp.dataset.sugId);
      if (sug) sug.category = inp.value;
    });
    body.querySelectorAll('.sug-assign-input').forEach(inp => {
      const sug = msg.aiResult.suggestions.find(s => s.id === inp.dataset.sugId);
      if (sug) sug.assignTo = inp.value;
    });
  }

  // Accept active suggestions only
  const activeSugs = msg.aiResult.suggestions.filter(s => s.active);
  const created = activeSugs.map(sug => applySuggestion(sug, msg)).filter(Boolean);

  msg.aiResult.accepted = true;
  msg.linkedItems = [...(msg.linkedItems || []), ...created];
  _state.acceptedSuggestions.push(msgId);

  _save(_state);
  closeModal('modal-ai-review');
  renderChat();
  if (_rerenderJournal) _rerenderJournal();
  toast(`Saved ${created.length} item${created.length !== 1 ? 's' : ''}.`, 'success');
}

export function saveOriginalOnly() {
  const msgId = _reviewMsgId;
  if (!msgId) return;
  const msg = _state.messages.find(m => m.id === msgId);
  if (msg && msg.aiResult) {
    msg.aiResult.suggestions.forEach(s => s.active = false);
    msg.aiResult.ignored = true;
  }
  _save(_state);
  closeModal('modal-ai-review');
  renderChat();
  toast('Message saved as-is.', '');
}

/* --- Highlight source message ------------------------------ */
export function scrollToMessage(msgId) {
  const el = document.getElementById(`msgwrap-${msgId}`);
  if (!el) return;
  el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  el.classList.add('msg-highlight');
  setTimeout(() => el.classList.remove('msg-highlight'), 2000);
}

function highlightLinkedItem(type, id) {
  // Switch to journal and highlight
  toast(`Showing linked ${type}…`, '');
  // Dispatch event for app.js to handle view switch
  document.dispatchEvent(new CustomEvent('doj:showLinkedItem', { detail: { type, id } }));
}

/* --- Plus menu --------------------------------------------- */
export function initComposer() {
  const input  = document.getElementById('chat-input');
  const sendBtn = document.getElementById('chat-send-btn');
  const plusBtn = document.getElementById('chat-plus-btn');
  const plusMenu = document.getElementById('chat-plus-menu');

  if (!input || !sendBtn) return;

  const doSend = () => {
    const text = input.value.trim();
    if (!text) return;
    // Clear input immediately; sendMessage is async but handles its own render
    input.value = '';
    input.style.height = 'auto';
    sendMessage(text).catch(err => console.error('[Journal] sendMessage error:', err));
  };

  sendBtn.addEventListener('click', doSend);

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      doSend();
    }
  });

  // Auto-resize
  input.addEventListener('input', () => {
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 120) + 'px';
  });

  // Plus menu
  if (plusBtn && plusMenu) {
    plusBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      plusMenu.classList.toggle('open');
    });
    document.addEventListener('click', () => plusMenu?.classList.remove('open'));
    plusMenu.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        plusMenu.classList.remove('open');
        handlePlusAction(btn.dataset.action);
      });
    });
  }

  // AI Review save
  document.getElementById('btn-review-save-selected')?.addEventListener('click', saveSelectedReview);
  document.getElementById('btn-review-save-original')?.addEventListener('click', saveOriginalOnly);
  document.getElementById('btn-close-review')?.addEventListener('click', () => closeModal('modal-ai-review'));
  document.getElementById('btn-cancel-review')?.addEventListener('click', () => closeModal('modal-ai-review'));
}

function handlePlusAction(action) {
  if (action === 'quick-update') {
    const input = document.getElementById('chat-input');
    if (input) { input.focus(); input.placeholder = 'Quick update…'; }
  } else if (action === 'photo') {
    toast('Photo upload — coming in production version.', '');
  } else if (action === 'file') {
    toast('File attachment — coming in production version.', '');
  } else if (action === 'create-case') {
    document.dispatchEvent(new CustomEvent('doj:openCreateCase'));
  }
}
