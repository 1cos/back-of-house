/* ============================================================
   Daily Operations Journal — journal-ai.js
   AI adapter: real Chef AI bridge + keyword fallback

   The bridge is the existing souschef-chat Edge Function.
   We use system_override to inject a Journal-specific prompt.
   The Edge Function's LLM chain (Local → OpenRouter → Groq)
   is unchanged and requires no modifications.
   ============================================================ */

// ── Config ───────────────────────────────────────────────────
export const JOURNAL_AI_MODE = 'live'; // 'live' | 'mock'

const SUPABASE_URL     = 'https://ydqmumpytgrlceuinoqt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlkcW11bXB5dGdybGNldWlub3F0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg5MzcyOTUsImV4cCI6MjA5NDUxMzI5NX0.MSIKL4nCOxK8YFFTkt9AbFGViiwl-KEhHy6cL25gnKc';
const CHEF_AI_ENDPOINT = `${SUPABASE_URL}/functions/v1/souschef-chat`;
const REQUEST_TIMEOUT_MS = 18000;

// ── Journal-specific system prompt ───────────────────────────
// Injected via system_override — no changes to the Edge Function required.
function buildJournalSystemPrompt(author, openCases, tasks) {
  const caseList = (openCases || []).slice(0, 6).map(c =>
    `- [${c.id}] ${c.title} (${c.category}) — status: ${c.status}`
  ).join('\n') || '  (none)';

  const taskList = (tasks || []).filter(t => t.status !== 'Done' && t.status !== 'Dismissed').slice(0, 8).map(t =>
    `- ${t.title} → ${t.assignTo || '?'} (${t.status})`
  ).join('\n') || '  (none)';

  return `You are an Operations Journal Organizer for Zenos on the Square restaurant, Weatherford TX.

You receive informal messages from the management team and extract structured operational data.
You are NOT a conversational sous-chef. You do NOT answer questions. You analyze messages.

Author of this message: ${author.name} (${author.role}, ${author.dept})

CURRENT OPEN CASES:
${caseList}

CURRENT OPEN TASKS:
${taskList}

RESPONSE FORMAT — respond ONLY with valid JSON, no text outside:
{
  "summary": "One-sentence neutral summary of the message",
  "suggestions": [
    {
      "id": "sug-1",
      "type": "communication|task|case_update|journal_entry|new_case|shift_reflection",
      "title": "Short actionable title",
      "category": "Purchasing|Equipment|Maintenance|Catering|Admin|Service|Kitchen|Staff|Incident|Event|Communication",
      "audience": "general|management|kitchen|foh",
      "assigned_to": "person name or null",
      "due_text": "Wednesday|Friday|Tomorrow or null",
      "related_case_id": "case id from list above or null",
      "status_hint": "information|open|in_progress|resolved|waiting",
      "confidence": 0.0-1.0,
      "details": "Optional extra info or null"
    }
  ],
  "needs_review": true,
  "uncertainties": ["Any uncertain inference listed here"]
}

RULES:
- Types allowed: communication, task, case_update, journal_entry, new_case, shift_reflection
- Distinguish communications (informational) from tasks (require action from someone)
- Link to open cases ONLY when clearly relevant (cooler issue → Reach-in Cooler case)
- Do NOT invent dates, people, or actions not in the message
- Use null when a field is unclear
- Do NOT close a case unless the message explicitly says it is fixed/resolved
- Do NOT merge opinions from different people
- Do NOT add sales data, POS numbers, or KPIs not mentioned
- Preserve the original meaning exactly
- Signal uncertainty in the uncertainties array
- Always return valid JSON. Never add explanation outside the JSON block.`;
}

// ── Main export: interpretJournalMessage ─────────────────────
export async function interpretJournalMessage({ message, author, openCases, tasks, recentMessages }) {
  if (JOURNAL_AI_MODE === 'mock') {
    return _mockFallback(message, author);
  }

  try {
    const result = await _callLiveBridge({ message, author, openCases, tasks, recentMessages });
    if (result && result.suggestions && Array.isArray(result.suggestions)) {
      return { ...result, source: 'live' };
    }
    // Invalid structure — fall back
    console.warn('[JournalAI] Invalid response structure, falling back to mock');
    return _mockFallback(message, author);
  } catch (err) {
    console.warn('[JournalAI] Live bridge failed:', err.message, '— using mock fallback');
    return _mockFallback(message, author);
  }
}

// ── Call the existing Chef AI bridge ─────────────────────────
async function _callLiveBridge({ message, author, openCases, tasks, recentMessages }) {
  const systemPrompt = buildJournalSystemPrompt(author, openCases, tasks);

  const payload = {
    // Standard Chef AI fields (bridge reads these)
    message,
    history: [],
    user_name: author.name,
    user_role: 'admin',  // give full context access; Journal is management-only
    user_station: author.dept || '',
    // Journal-specific override — tells the bridge to use our prompt instead of default
    system_override: systemPrompt,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(CHEF_AI_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  }

  const data = await res.json();
  if (data.error) throw new Error(data.error);

  // The Edge Function returns { reply, action, pending }
  // For Journal requests, reply contains the JSON string
  const rawReply = data.reply || '';
  return _parseJournalResponse(rawReply);
}

// ── Parse LLM response into structured suggestions ───────────
function _parseJournalResponse(raw) {
  // Strip markdown fences if present
  let cleaned = raw.trim();
  cleaned = cleaned.replace(/^```json\s*/i, '').replace(/^```\s*/i, '');
  cleaned = cleaned.replace(/\s*```\s*$/g, '').trim();

  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (_) {
    // Attempt to extract JSON object from mixed text
    const match = cleaned.match(/\{[\s\S]+\}/);
    if (match) {
      try { parsed = JSON.parse(match[0]); } catch (_) {}
    }
  }

  if (!parsed || typeof parsed !== 'object') {
    throw new Error('Could not parse JSON from LLM response');
  }

  // Normalize and validate suggestions
  const suggestions = (parsed.suggestions || []).map((s, i) => ({
    id:             s.id || `sug-live-${Date.now()}-${i}`,
    type:           _validateType(s.type),
    title:          s.title || 'Untitled',
    category:       s.category || 'Communication',
    audience:       s.audience || 'general',
    assignTo:       s.assigned_to || null,
    dueDateText:    s.due_text || null,
    relatedCaseId:  s.related_case_id || null,
    statusHint:     s.status_hint || null,
    confidence:     typeof s.confidence === 'number' ? s.confidence : 0.8,
    details:        s.details || null,
    active:         true,
  }));

  return {
    summary:       parsed.summary || '',
    suggestions,
    needsReview:   parsed.needs_review !== false,
    uncertainties: parsed.uncertainties || [],
    source:        'live',
  };
}

const VALID_TYPES = new Set([
  'communication', 'task', 'case_update', 'journal_entry', 'new_case', 'shift_reflection',
  // v0.2 aliases
  'entry', 'communication',
]);

function _validateType(t) {
  if (VALID_TYPES.has(t)) return t;
  // Map to closest valid type
  if (t === 'note' || t === 'entry') return 'journal_entry';
  return 'communication';
}

// ── Keyword fallback (imported from data.js logic) ────────────
// Minimal local keyword analysis — shown with "AI fallback" label
const KEYWORD_RULES_LOCAL = [
  { re: /restaurant depot|depot/i,               category: 'Purchasing',   type: 'communication' },
  { re: /catering|cheese wheel|tiramisù|tiramisu/i, category: 'Catering',  type: 'case_update'   },
  { re: /reach.?in|cooler|fridge|refrigerat/i,   category: 'Equipment',    type: 'case_update'   },
  { re: /oven|dishwasher|machine|printer/i,       category: 'Equipment',    type: 'journal_entry' },
  { re: /technician|service|repair|called/i,      category: 'Maintenance',  type: 'journal_entry' },
  { re: /invoice|payment|receipt|filed/i,         category: 'Admin',        type: 'journal_entry' },
  { re: /reservation/i,                           category: 'Service',      type: 'journal_entry' },
  { re: /staff|call.?out|coverage/i,              category: 'Staff',        type: 'journal_entry' },
];

const PERSON_RE_LOCAL = /\b(max|monica|zeno|bo|mike)\b/gi;

function _mockFallback(text, author) {
  const suggestions = [];
  let category = 'Communication';
  let assignTo = null;

  for (const rule of KEYWORD_RULES_LOCAL) {
    if (rule.re.test(text)) {
      category = rule.category;
      if (!suggestions.find(s => s.type === rule.type)) {
        suggestions.push({
          id:            `sug-mock-${Date.now()}-${suggestions.length}`,
          type:          rule.type,
          title:         `${rule.category}: ${text.split(/\s+/).slice(0, 6).join(' ')}…`,
          category:      rule.category,
          audience:      'management',
          assignTo:      null,
          dueDateText:   null,
          relatedCaseId: null,
          statusHint:    null,
          confidence:    0.5,
          details:       null,
          active:        true,
        });
      }
    }
  }

  // Person mentions for assignTo
  const people = [];
  let m;
  while ((m = PERSON_RE_LOCAL.exec(text)) !== null) {
    const n = m[0][0].toUpperCase() + m[0].slice(1).toLowerCase();
    if (!people.includes(n)) people.push(n);
  }
  if (people.length) assignTo = people[0];

  if (!suggestions.length) {
    suggestions.push({
      id:            `sug-mock-${Date.now()}`,
      type:          'communication',
      title:         text.split(/\s+/).slice(0, 8).join(' ') + (text.split(/\s+/).length > 8 ? '…' : ''),
      category:      'Communication',
      audience:      'management',
      assignTo:      assignTo,
      dueDateText:   null,
      relatedCaseId: null,
      statusHint:    null,
      confidence:    0.4,
      details:       null,
      active:        true,
    });
  }

  return {
    summary:       'Message recorded. AI analysis unavailable — keyword fallback used.',
    suggestions,
    needsReview:   true,
    uncertainties: ['AI service not available — manual review recommended'],
    source:        'mock',
  };
}
