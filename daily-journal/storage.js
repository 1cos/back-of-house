/* ============================================================
   Daily Operations Journal v0.2
   storage.js — localStorage with v0.1 migration
   ============================================================ */

import { buildSeedMessages, buildSeedEntries, buildSeedCases, buildSeedTasks } from './data.js';

const KEY_V2 = 'doj_v2';
const KEY_V1 = 'doj_data'; // legacy

export function loadState() {
  // Try v0.2 first
  try {
    const raw = localStorage.getItem(KEY_V2);
    if (raw) {
      const parsed = JSON.parse(raw);
      return migrateState(parsed);
    }
  } catch (e) { /* ignore */ }

  // Try migrating from v0.1
  let v1entries = [], v1cases = [];
  try {
    const rawV1 = localStorage.getItem(KEY_V1);
    if (rawV1) {
      const v1 = JSON.parse(rawV1);
      v1entries = (v1.entries || []).map(e => ({ ...e, authorId: e.authorId || e.author, sourceMessageId: null }));
      v1cases   = v1.cases || [];
    }
  } catch (e) { /* ignore */ }

  // Build fresh state seeded with mock data
  return freshState(v1entries, v1cases);
}

function freshState(extraEntries = [], extraCases = []) {
  const seedMessages = buildSeedMessages();
  const seedEntries  = buildSeedEntries();
  const seedCases    = buildSeedCases();
  const seedTasks    = buildSeedTasks();

  // Merge v0.1 entries that aren't already in seed
  const allEntries = [...seedEntries, ...extraEntries.filter(e => !seedEntries.find(s => s.id === e.id))];
  const allCases   = [...seedCases,   ...extraCases.filter(c => !seedCases.find(s => s.id === c.id))];

  return {
    version: '0.2',
    currentUserId: 'max',
    currentView: 'chat',           // 'chat' | 'journal'
    currentJournalSection: 'feed', // 'feed' | 'tasks' | 'cases'
    categoryFilter: 'All',
    taskFilter: 'All',
    messages: seedMessages,
    entries: allEntries,
    cases: allCases,
    tasks: seedTasks,
    acceptedSuggestions: [],
    ignoredSuggestions: [],
  };
}

function migrateState(parsed) {
  // Ensure all required keys exist (forward-compat)
  if (!parsed.messages)              parsed.messages = buildSeedMessages();
  if (!parsed.tasks)                 parsed.tasks    = buildSeedTasks();
  if (!parsed.acceptedSuggestions)   parsed.acceptedSuggestions = [];
  if (!parsed.ignoredSuggestions)    parsed.ignoredSuggestions  = [];
  if (!parsed.currentView)           parsed.currentView = 'chat';
  if (!parsed.currentJournalSection) parsed.currentJournalSection = 'feed';
  if (!parsed.categoryFilter)        parsed.categoryFilter = 'All';
  if (!parsed.taskFilter)            parsed.taskFilter = 'All';
  return parsed;
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY_V2, JSON.stringify(state));
  } catch (e) { /* ignore */ }
}

export function resetState() {
  localStorage.removeItem(KEY_V2);
  localStorage.removeItem(KEY_V1);
}
