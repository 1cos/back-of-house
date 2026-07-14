/* ============================================================
   Daily Operations Journal — journal-ai.js  v2
   AI adapter: real Chef AI bridge + honest fallback

   Bridge: souschef-chat Edge Function (unchanged)
   system_override injects journal-specific prompt.
   LLM chain: Local Mac mini → OpenRouter LLaMA 70B → Groq

   Changes from v1:
   - REQUEST_TIMEOUT_MS 18000 → JOURNAL_AI_TIMEOUT_MS 35000
   - Body read now also covered by AbortController
   - Distinguish: timeout | network | bad_json | real_ai_success
   - PENDING state: timeout/network failure → save msg, show pending UI
   - Keyword fallback suppressed for complex messages (>50 chars)
   - Case matching: title-based fuzzy match when AI returns no case id
   - SW cache buster: version constant forces cache invalidation on update
   ============================================================ */

// ── Cache buster — increment on every deploy of this file ────
export const JOURNAL_AI_VERSION = '2.0.0';

// ── Config ───────────────────────────────────────────────────
export const JOURNAL_AI_MODE = 'live'; // 'live' | 'mock'

// Separate from any Chef AI timeout — Journal AI needs more time
// because the Edge Function loads Bible files + hits LLM + returns JSON.
export const JOURNAL_AI_TIMEOUT_MS = 35000;

const SUPABASE_URL      = 'https://ydqmumpytgrlceuinoqt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkcW11bXB5dGdybGNldWlub3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MzcyOTUsImV4cCI6MjA5NDUxMzI5NX0.MSIKL4nCOxK8YFFTkt9AbFGViiwl-KEhHy6cL25gnKc';
const CHEF_AI_ENDPOINT  = `${SUPABASE_URL}/functions/v1/souschef-chat`;

// ── Failure types (returned to caller, never shown raw to user) ──
export const AI_FAILURE = {
  TIMEOUT: 'timeout',        // AbortController fired at 35s
  NETWORK: 'network',        // fetch threw (offline, DNS, TCP)
  BAD_JSON: 'bad_json',      // LLM returned non-parseable text
  HTTP_ERROR: 'http_error',  // 4xx/5xx from Edge Function
};

// ── Journal-specific system prompt ───────────────────────────
function buildJournalSystemPrompt(author, openCases) {
  // List open cases so AI can match them by ID
  const caseList = (openCases || []).slice(0, 8).map(c =>
    `- id="${c.id}" title="${c.title}" category="${c.category}" status="${c.status}"`
  ).join('\n') || '  (none)';

  return `You are an Operations Journal Organizer for Zenos on the Square restaurant, Weatherford TX.
You receive informal messages from the management team and extract structured operational data.
You are NOT a conversational assistant. You do NOT answer questions. You ONLY analyze messages.

Author: ${author.name} (${author.role})

CURRENT OPEN CASES (use exact id values when linking):
${caseList}

OUTPUT: respond ONLY with a single valid JSON object. No text before or after.
Schema:
{
  "summary": "One-sentence neutral summary",
  "suggestions": [
    {
      "id": "sug-1",
      "type": "communication|task|case_update|journal_entry|new_case",
      "title": "Short actionable title (max 80 chars)",
      "category": "Equipment|Maintenance|Purchasing|Catering|Admin|Service|Kitchen|Staff|Incident|Event|Communication",
      "audience": "management|general|kitchen|foh",
      "assigned_to": "person name or null",
      "due_text": "day name or null",
      "related_case_id": "exact id from OPEN CASES list above or null",
      "status_hint": "open|in_progress|waiting|resolved|information",
      "confidence": 0.0,
      "details": "Extra context or null"
    }
  ],
  "needs_review": true,
  "uncertainties": ["list any uncertain inferences"]
}

RULES — read carefully:
- Link related_case_id ONLY to IDs from the OPEN CASES list above. Never invent IDs.
- Equipment issues (cooler, pasta machine, oven, dishwasher) → match existing Equipment cases when title is similar.
- Distinguish: communication (informational) vs task (requires someone to act).
- When a DECISION is required → type="task", status_hint="waiting", details=describe the options.
- Do NOT invent: dates not mentioned, people not mentioned, confirmed actions not stated.
- Do NOT close a case unless the message says it is fixed/resolved.
- Do NOT add POS data, sales, or cost figures not in the message.
- Signal ALL uncertain inferences in the uncertainties array.
- Always return valid JSON. Never explain outside the JSON.`;
}

// ── Main export ───────────────────────────────────────────────
// Returns: { source, summary, suggestions, needsReview, uncertainties }
// Or throws with err.failureType set to an AI_FAILURE constant.
export async function interpretJournalMessage({ message, author, openCases, tasks }) {
  if (JOURNAL_AI_MODE === 'mock') {
    return _keywordFallback(message, author, openCases);
  }

  let failureType = AI_FAILURE.NETWORK;
  try {
    const result = await _callLiveBridge({ message, author, openCases });
    if (result && Array.isArray(result.suggestions)) {
      return { ...result, source: 'live' };
    }
    // Structurally invalid but parseable JSON
    failureType = AI_FAILURE.BAD_JSON;
    const err = new Error('AI response missing suggestions array');
    err.failureType = failureType;
    throw err;
  } catch (err) {
    // Preserve failureType set by _callLiveBridge, or use the one above
    if (!err.failureType) err.failureType = failureType;
    throw err;
  }
}

// ── Internal: call bridge with 35s timeout ───────────────────
async function _callLiveBridge({ message, author, openCases }) {
  const systemPrompt = buildJournalSystemPrompt(author, openCases);

  const payload = {
    message,
    history:       [],
    user_name:     author.name,
    user_role:     'admin',
    user_station:  author.dept || '',
    system_override: systemPrompt,
  };

  // Single AbortController covers both the fetch and the body read
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), JOURNAL_AI_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(CHEF_AI_ENDPOINT, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body:   JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (fetchErr) {
    clearTimeout(timer);
    const isAbort = fetchErr.name === 'AbortError';
    const err = new Error(isAbort ? 'AI request timed out after 35s' : `Network error: ${fetchErr.message}`);
    err.failureType = isAbort ? AI_FAILURE.TIMEOUT : AI_FAILURE.NETWORK;
    throw err;
  }

  if (!res.ok) {
    clearTimeout(timer);
    const err = new Error(`HTTP ${res.status}: ${res.statusText}`);
    err.failureType = AI_FAILURE.HTTP_ERROR;
    throw err;
  }

  // Body read is also under the same AbortController
  let data;
  try {
    data = await res.json();
  } catch (bodyErr) {
    clearTimeout(timer);
    const isAbort = bodyErr.name === 'AbortError';
    const err = new Error(isAbort ? 'AI response body timed out' : `Body parse error: ${bodyErr.message}`);
    err.failureType = isAbort ? AI_FAILURE.TIMEOUT : AI_FAILURE.BAD_JSON;
    throw err;
  }
  clearTimeout(timer);

  if (data.error) {
    const err = new Error(data.error);
    err.failureType = AI_FAILURE.HTTP_ERROR;
    throw err;
  }

  const rawReply = data.reply || '';
  return _parseJournalResponse(rawReply, openCases);
}

// ── Parse LLM JSON response ───────────────────────────────────
function _parseJournalResponse(raw, openCases) {
  let cleaned = raw.trim()
    .replace(/^```json\s*/i, '').replace(/^```\s*/i, '')
    .replace(/\s*```\s*$/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (_) {
    // Try to extract JSON object from surrounding text
    const match = cleaned.match(/\{[\s\S]+\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch (_2) {}
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    const err = new Error('Could not parse JSON from AI response');
    err.failureType = AI_FAILURE.BAD_JSON;
    throw err;
  }

  const suggestions = (parsed.suggestions || []).map((s, i) => {
    // Verify related_case_id against actual open cases
    const verifiedCaseId = _resolveCase(s.related_case_id, s.title, openCases);
    return {
      id:            s.id || `sug-live-${Date.now()}-${i}`,
      type:          _validateType(s.type),
      title:         (s.title || 'Untitled').slice(0, 120),
      category:      s.category || 'Equipment',
      audience:      s.audience || 'management',
      assignTo:      s.assigned_to || null,
      dueDateText:   s.due_text || null,
      relatedCaseId: verifiedCaseId,
      statusHint:    s.status_hint || null,
      confidence:    typeof s.confidence === 'number' ? s.confidence : 0.8,
      details:       s.details || null,
      active:        true,
    };
  });

  return {
    summary:       parsed.summary || '',
    suggestions,
    needsReview:   parsed.needs_review !== false,
    uncertainties: parsed.uncertainties || [],
    source:        'live',
  };
}

// ── Case resolution: exact id or fuzzy title match ────────────
// The AI may return the correct id, or it may return a partial title string.
// We also do a title-based fuzzy match as fallback so the Pasta Machine case
// gets linked even if the model outputs "pasta-machine" instead of "case-pasta".
function _resolveCase(rawId, suggestionTitle, openCases) {
  if (!openCases || !openCases.length) return null;

  // 1. Exact id match
  if (rawId) {
    const exact = openCases.find(c => c.id === rawId);
    if (exact) return exact.id;
  }

  // 2. Fuzzy: does the rawId or the suggestion title contain words from a case title?
  const candidates = openCases.map(c => ({
    id:    c.id,
    words: c.title.toLowerCase().replace(/[^a-z0-9\s]/g, '').split(/\s+/).filter(w => w.length > 3),
  }));

  const searchText = ((rawId || '') + ' ' + (suggestionTitle || '')).toLowerCase();
  let bestScore = 0;
  let bestId    = null;

  for (const cand of candidates) {
    const hits = cand.words.filter(w => searchText.includes(w)).length;
    const score = hits / Math.max(cand.words.length, 1);
    if (score > bestScore && score >= 0.4) {
      bestScore = score;
      bestId    = cand.id;
    }
  }

  return bestId;
}

const VALID_TYPES = new Set([
  'communication', 'task', 'case_update', 'journal_entry', 'new_case', 'shift_reflection', 'entry',
]);
function _validateType(t) {
  if (VALID_TYPES.has(t)) return t;
  if (t === 'note') return 'journal_entry';
  return 'communication';
}

// ── Keyword fallback — honest, not presented as AI ───────────
// Only used when JOURNAL_AI_MODE = 'mock' or explicitly requested by caller.
// For real failures, the caller (chat.js) decides what to do based on failureType.
const KEYWORD_RULES = [
  { re: /restaurant depot|depot/i,                   category: 'Purchasing',   type: 'communication' },
  { re: /catering|cheese wheel|tiramisù|tiramisu/i,  category: 'Catering',     type: 'case_update'   },
  { re: /reach.?in|cooler|fridge|refrigerat/i,       category: 'Equipment',    type: 'case_update'   },
  { re: /pasta machine|macchina.*pasta|macchina della pasta/i, category: 'Equipment', type: 'case_update' },
  { re: /oven|dishwasher|machine|printer/i,           category: 'Equipment',    type: 'journal_entry' },
  { re: /technician|service|repair|tecnico|riparaz/i, category: 'Maintenance',  type: 'journal_entry' },
  { re: /invoice|payment|fattura|pagamento/i,         category: 'Admin',        type: 'journal_entry' },
  { re: /reservation|prenotaz/i,                      category: 'Service',      type: 'journal_entry' },
  { re: /staff|call.?out|coverage/i,                  category: 'Staff',        type: 'journal_entry' },
  { re: /decis|decisione|bisogna scegliere|meglio/i,  category: 'Management',   type: 'task'          },
];
const PERSON_RE = /\b(max|monica|zeno|bo|mike|emilio)\b/gi;

export function _keywordFallback(text, author, openCases) {
  const suggestions = [];
  let category = 'Communication';
  const matchedRules = KEYWORD_RULES.filter(r => r.re.test(text));

  for (const rule of matchedRules) {
    if (!suggestions.find(s => s.type === rule.type)) {
      const relatedCaseId = _resolveCase(null, `${rule.category} ${text.slice(0, 40)}`, openCases);
      suggestions.push({
        id:            `sug-kw-${Date.now()}-${suggestions.length}`,
        type:          rule.type,
        title:         `${rule.category}: ${text.split(/\s+/).slice(0, 6).join(' ')}…`,
        category:      rule.category,
        audience:      'management',
        assignTo:      null,
        dueDateText:   null,
        relatedCaseId,
        statusHint:    null,
        confidence:    0.3,
        details:       null,
        active:        false,  // ← inactive by default in keyword fallback
      });
      category = rule.category;
    }
  }

  if (!suggestions.length) {
    suggestions.push({
      id: `sug-kw-${Date.now()}`,
      type: 'communication', title: text.split(/\s+/).slice(0, 6).join(' ') + '…',
      category: 'Communication', audience: 'management',
      assignTo: null, dueDateText: null, relatedCaseId: null,
      statusHint: null, confidence: 0.2, details: null, active: false,
    });
  }

  return {
    summary:       null,
    suggestions,
    needsReview:   true,
    uncertainties: ['Keyword extraction only — no semantic analysis'],
    source:        'keyword',
  };
}
