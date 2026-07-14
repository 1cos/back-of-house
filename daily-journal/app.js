/* ============================================================
   Daily Operations Journal v0.2 — Chat-first
   app.js — Main orchestrator
   ============================================================ */

import { USERS }              from './data.js';
import { loadState, saveState, resetState } from './storage.js';
import { initGlobalKeyboard, openModal, closeModal, toast } from './modal.js';
import { initChat, renderChat, initComposer, scrollToMessage, openAIReview } from './chat.js';
import { initJournal, renderJournal, renderFeed, initJournalModals, initAddEntryModal, initReflectionModal } from './journal.js';
import { initTasks, renderTasks }     from './tasks.js';
import { initCases, renderCases, updateCaseBadge, scrollToCaseAndOpen } from './cases.js';

/* --- State ------------------------------------------------- */
let state;

function save(s) { saveState(s); }

/* --- View switching ---------------------------------------- */
function setView(view) {
  state.currentView = view;
  save(state);

  document.getElementById('view-chat').style.display   = view === 'chat'    ? 'flex' : 'none';
  document.getElementById('view-journal').style.display = view === 'journal' ? 'block': 'none';

  document.querySelectorAll('.main-tab').forEach(t => t.classList.toggle('active', t.dataset.view === view));

  // Show/hide filter bar (only in journal feed)
  const filterBar = document.getElementById('filter-bar');
  if (filterBar) filterBar.style.display = (view === 'journal' && state.currentJournalSection === 'feed') ? 'flex' : 'none';

  if (view === 'chat')    renderChat();
  if (view === 'journal') renderCurrentJournalSection();
}

function setJournalSection(section) {
  state.currentJournalSection = section;
  save(state);

  document.querySelectorAll('.journal-tab').forEach(t => t.classList.toggle('active', t.dataset.section === section));

  document.getElementById('section-feed').style.display  = section === 'feed'  ? 'block' : 'none';
  document.getElementById('section-tasks').style.display = section === 'tasks' ? 'block' : 'none';
  document.getElementById('section-cases').style.display = section === 'cases' ? 'block' : 'none';

  const filterBar = document.getElementById('filter-bar');
  if (filterBar) filterBar.style.display = section === 'feed' ? 'flex' : 'none';

  renderCurrentJournalSection();
}

function renderCurrentJournalSection() {
  const s = state.currentJournalSection;
  if (s === 'feed')  { renderJournal(); }
  if (s === 'tasks') { renderTasks(); }
  if (s === 'cases') { renderCases(); updateCaseBadge(); }
}

/* --- Go to chat + highlight message ------------------------ */
function goToChat(msgId) {
  setView('chat');
  requestAnimationFrame(() => scrollToMessage(msgId));
}

/* --- User switcher ----------------------------------------- */
function onUserChange(userId) {
  state.currentUserId = userId;
  const u = USERS.find(x => x.id === userId);
  if (!u) return;
  save(state);
  // Update all avatars in header
  document.querySelectorAll('.header-user-avatar').forEach(el => {
    el.textContent = u.initials;
    el.style.background = u.color;
  });
  renderChat();
  toast(`Switched to ${u.name}`, '');
}

/* --- Global events ----------------------------------------- */
function bindGlobalEvents() {
  document.addEventListener('doj:showLinkedItem', (e) => {
    const { type, id } = e.detail;
    if (type === 'case') {
      setView('journal');
      setJournalSection('cases');
      requestAnimationFrame(() => scrollToCaseAndOpen(id));
    } else {
      setView('journal');
      setJournalSection('feed');
    }
  });

  document.addEventListener('doj:openCreateCase', () => {
    openModal('modal-add-case');
  });
}

/* --- Reset demo data --------------------------------------- */
function resetDemo() {
  if (!confirm('Reset all demo data? This will restore the original mock messages, entries, and cases.')) return;
  resetState();
  state = loadState();
  reinitModules();
  setView('chat');
  toast('Demo reset.', 'success');
}

function reinitModules() {
  initChat(state, save, () => renderCurrentJournalSection());
  initJournal(state, save, goToChat);
  initTasks(state, save, goToChat);
  initCases(state, save, goToChat);
  updateCaseBadge();
}

/* --- Create case modal ------------------------------------- */
function initCreateCaseModal() {
  document.getElementById('btn-save-case')?.addEventListener('click', () => {
    const title    = document.getElementById('cc-title')?.value.trim();
    const category = document.getElementById('cc-category')?.value;
    const desc     = document.getElementById('cc-description')?.value.trim();
    if (!title) { toast('Add a case title.', 'error'); return; }
    const icons = { 'Equipment':'🔧','Incident':'⚡','Catering':'🎪','Staff':'👥','Maintenance':'🛠','Admin':'📁','Service':'🍽','Kitchen':'👨‍🍳','Purchasing':'🛒' };
    const c = {
      id: 'case-' + Date.now(),
      icon: icons[category] || '📋',
      title, category,
      status: 'Open',
      people: [USERS.find(u => u.id === state.currentUserId)?.name || ''],
      description: desc,
      timeline: [],
      nextAction: null,
      updates: [],
    };
    state.cases.push(c);
    save(state);
    closeModal('modal-add-case');
    updateCaseBadge();
    toast(`Case created: ${title}.`, 'success');
  });
  document.getElementById('btn-cancel-case')?.addEventListener('click', () => closeModal('modal-add-case'));
  document.getElementById('btn-close-case')?.addEventListener('click', () => closeModal('modal-add-case'));
}

/* --- Bootstrap --------------------------------------------- */
function init() {
  // Load or seed state
  state = loadState();

  // Init modules
  initChat(state, save, () => renderCurrentJournalSection());
  initJournal(state, save, goToChat);
  initTasks(state, save, goToChat);
  initCases(state, save, goToChat);

  // Global keyboard / modal
  initGlobalKeyboard();
  bindGlobalEvents();

  // Main navigation tabs
  document.querySelectorAll('.main-tab').forEach(tab => {
    tab.addEventListener('click', () => setView(tab.dataset.view));
  });

  // Journal sub-tabs
  document.querySelectorAll('.journal-tab').forEach(tab => {
    tab.addEventListener('click', () => setJournalSection(tab.dataset.section));
  });

  // User select
  const userSel = document.getElementById('user-select');
  if (userSel) {
    userSel.value = state.currentUserId;
    userSel.addEventListener('change', () => onUserChange(userSel.value));
    // Sync avatar
    onUserChange(state.currentUserId);
  }

  // Composer
  initComposer();

  // Journal modals
  initJournalModals();
  initAddEntryModal();
  initReflectionModal();
  initCreateCaseModal();

  // "Add Entry" in journal header
  document.getElementById('btn-add-entry')?.addEventListener('click', () => openModal('modal-add-entry'));
  // "Shift Reflection" in journal header
  document.getElementById('btn-reflection')?.addEventListener('click', () => openModal('modal-reflection'));

  // Reset demo
  document.getElementById('btn-reset-demo')?.addEventListener('click', resetDemo);

  // Set initial view from saved state
  setView(state.currentView || 'chat');
  if (state.currentView === 'journal') setJournalSection(state.currentJournalSection || 'feed');

  updateCaseBadge();
}

document.addEventListener('DOMContentLoaded', init);
