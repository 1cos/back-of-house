/* ============================================================
   Daily Operations Journal v0.2
   data.js — Users, categories, seed data, AI mock rules
   ============================================================ */

export const USERS = [
  { id: 'max',    name: 'Max',    role: 'Executive Chef',    dept: 'Kitchen',       initials: 'MX', color: '#2563eb' },
  { id: 'bo',     name: 'Bo',     role: 'FOH Manager',       dept: 'Front of House',initials: 'BO', color: '#7c3aed' },
  { id: 'zeno',   name: 'Zeno',   role: 'General Manager',   dept: 'Management',    initials: 'ZN', color: '#0891b2' },
  { id: 'monica', name: 'Monica', role: 'Admin / Finance',   dept: 'Admin',         initials: 'MN', color: '#d97706' },
  { id: 'mike',   name: 'Mike',   role: 'Management',        dept: 'Management',    initials: 'MK', color: '#16a34a' },
];

export const CATEGORIES = [
  'All','Service','Kitchen','Front of House','Staff','Equipment',
  'Maintenance','Purchasing','Event','Incident','Catering','Admin','Communication',
];

export const STATUS_MAP = {
  'Open':        { cls: 'chip-blue',   label: 'Open' },
  'In progress': { cls: 'chip-orange', label: 'In Progress' },
  'Waiting':     { cls: 'chip-gray',   label: 'Waiting' },
  'Resolved':    { cls: 'chip-green',  label: 'Resolved' },
  'Closed':      { cls: 'chip-gray',   label: 'Closed' },
  'Suggested':   { cls: 'chip-purple', label: 'Suggested' },
  'Done':        { cls: 'chip-green',  label: 'Done' },
  'Dismissed':   { cls: 'chip-gray',   label: 'Dismissed' },
};

/* --- AI Mock Keyword Rules --------------------------------- */
// Returns an array of suggestion objects for a given message text

const KEYWORD_RULES = [
  { pattern: /restaurant depot|depot/i,          category: 'Purchasing',    type: 'communication' },
  { pattern: /catering|cheese wheel|tiramisù|tiramissu/i, category: 'Catering', type: 'case_update' },
  { pattern: /fridge|cooler|reach.?in/i,         category: 'Equipment',     type: 'case_update'   },
  { pattern: /oven|dishwasher|machine|printer/i,  category: 'Equipment',     type: 'entry'         },
  { pattern: /technician|service|repair|called zeno/i, category: 'Maintenance', type: 'entry'      },
  { pattern: /invoice|payment|receipt|filed|scheduled payment/i, category: 'Admin', type: 'entry'  },
  { pattern: /reservation/i,                      category: 'Service',       type: 'entry'         },
  { pattern: /staff|call.?out|coverage/i,         category: 'Staff',         type: 'entry'         },
  { pattern: /wednesday|tomorrow|friday|saturday|monday|tuesday|thursday/i, hasDueDate: true },
  { pattern: /called|scheduled|arriving|arriving at/i, statusHint: 'In progress' },
  { pattern: /received|paid|fixed|replaced|resolved|closed/i, statusHint: 'Resolved' },
];

const PERSON_RE = /\b(max|monica|zeno|bo|mike)\b/gi;

export function analyzeMessage(text) {
  const suggestions = [];
  const textLow = text.toLowerCase();
  let category = 'Communication';
  let statusHint = null;
  let hasDueDate = false;
  const mentionedPeople = [];

  // Keyword scan
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern && rule.pattern.test(text)) {
      if (rule.category) category = rule.category;
      if (rule.type) {
        // Don't duplicate type suggestions
        if (!suggestions.find(s => s.type === rule.type)) {
          suggestions.push({ type: rule.type, category: rule.category || category });
        }
      }
      if (rule.statusHint) statusHint = rule.statusHint;
      if (rule.hasDueDate) hasDueDate = true;
    }
  }

  // Person mentions
  let m;
  while ((m = PERSON_RE.exec(text)) !== null) {
    const name = m[0].charAt(0).toUpperCase() + m[0].slice(1).toLowerCase();
    if (!mentionedPeople.includes(name)) mentionedPeople.push(name);
  }

  // If no specific type found, add generic communication
  if (!suggestions.length) suggestions.push({ type: 'communication', category });

  return { suggestions, category, statusHint, hasDueDate, mentionedPeople };
}

/* --- Seed data --------------------------------------------- */

export function buildSeedMessages() {
  const now = Date.now();
  const mins = (n) => new Date(now - n * 60 * 1000).toISOString();

  return [
    {
      id: 'msg-1',
      authorId: 'monica',
      text: 'Mercoledì vado da Restaurant Depot per gli spiedini di Max e per una torta da tenere alla Scuderia. Se vi serve qualcos\'altro fatemelo sapere. Il catering di sabato ha chiesto due cambiamenti e ho inserito il mini tiramisù e una pasta fredda servita nella cheese wheel. Piace tantissimo.',
      created: mins(87),
      reactions: [{ emoji: '👍', by: ['zeno', 'bo'] }, { emoji: '🎉', by: ['max'] }],
      aiResult: {
        analyzed: true,
        accepted: false,
        ignored: false,
        suggestions: [
          {
            id: 'sug-1a',
            type: 'communication',
            title: 'Restaurant Depot trip — Wednesday',
            category: 'Purchasing',
            audience: 'General',
            assignTo: 'Monica',
            active: true,
          },
          {
            id: 'sug-1b',
            type: 'task',
            title: 'Purchase skewers requested by Max',
            category: 'Purchasing',
            assignTo: 'Monica',
            dueDateText: 'Wednesday',
            relatedPerson: 'Max',
            active: true,
          },
          {
            id: 'sug-1c',
            type: 'case_update',
            title: 'Saturday catering menu changes',
            category: 'Catering',
            details: 'Added mini tiramisù · Added cold pasta in cheese wheel',
            relatedCaseId: 'case-saturday',
            active: true,
          },
        ],
      },
      linkedItems: [],
    },
    {
      id: 'msg-2',
      authorId: 'max',
      text: 'The reach-in by salad is at 45 degrees. I moved the salmon to the walk-in. Zeno knows about it.',
      created: mins(74),
      reactions: [],
      aiResult: {
        analyzed: true,
        accepted: false,
        ignored: false,
        suggestions: [
          {
            id: 'sug-2a',
            type: 'case_update',
            title: 'Reach-in cooler #2 — temperature issue',
            category: 'Equipment',
            details: 'Running at 45°F. Salmon moved to walk-in.',
            relatedCaseId: 'case-cooler',
            active: true,
          },
          {
            id: 'sug-2b',
            type: 'entry',
            title: 'Reach-in cooler running warm',
            category: 'Equipment',
            status: 'In progress',
            active: true,
          },
        ],
      },
      linkedItems: [],
    },
    {
      id: 'msg-3',
      authorId: 'zeno',
      text: 'Called Zeno Appliance. Technician will be here at 2 PM.',
      created: mins(62),
      reactions: [{ emoji: '👍', by: ['max', 'monica'] }],
      aiResult: {
        analyzed: true,
        accepted: false,
        ignored: false,
        suggestions: [
          {
            id: 'sug-3a',
            type: 'case_update',
            title: 'Technician scheduled — Reach-in Cooler',
            category: 'Maintenance',
            details: 'Zeno Appliance scheduled for 2 PM today.',
            relatedCaseId: 'case-cooler',
            statusHint: 'In progress',
            active: true,
          },
        ],
      },
      linkedItems: [],
    },
    {
      id: 'msg-4',
      authorId: 'bo',
      text: 'Service felt steady overall. Guests were happy, but we had one reservation issue during the manager transition.',
      created: mins(48),
      reactions: [],
      aiResult: {
        analyzed: true,
        accepted: false,
        ignored: false,
        suggestions: [
          {
            id: 'sug-4a',
            type: 'entry',
            title: 'Shift note — Front of House',
            category: 'Service',
            status: 'Open',
            active: true,
          },
          {
            id: 'sug-4b',
            type: 'task',
            title: 'Review reservation log from manager transition',
            category: 'Service',
            assignTo: 'Bo',
            active: true,
          },
        ],
      },
      linkedItems: [],
    },
    {
      id: 'msg-5',
      authorId: 'max',
      text: 'Kitchen was busy but controlled. Pasta station recovered after the main rush. We ran out of scallops late in service.',
      created: mins(35),
      reactions: [{ emoji: '💪', by: ['zeno'] }],
      aiResult: {
        analyzed: true,
        accepted: false,
        ignored: false,
        suggestions: [
          {
            id: 'sug-5a',
            type: 'entry',
            title: 'Kitchen shift note',
            category: 'Kitchen',
            status: 'Open',
            active: true,
          },
          {
            id: 'sug-5b',
            type: 'task',
            title: 'Prep extra scallops for tomorrow',
            category: 'Kitchen',
            assignTo: 'Max',
            active: true,
          },
        ],
      },
      linkedItems: [],
    },
    {
      id: 'msg-6',
      authorId: 'monica',
      text: 'Invoice received for the cooler repair. I filed it and scheduled payment.',
      created: mins(18),
      reactions: [{ emoji: '✅', by: ['zeno', 'max'] }],
      aiResult: {
        analyzed: true,
        accepted: false,
        ignored: false,
        suggestions: [
          {
            id: 'sug-6a',
            type: 'case_update',
            title: 'Cooler repair invoice filed',
            category: 'Admin',
            details: 'Invoice received and filed. Payment scheduled.',
            relatedCaseId: 'case-cooler',
            statusHint: 'Resolved',
            active: true,
          },
          {
            id: 'sug-6b',
            type: 'entry',
            title: 'Cooler repair — invoice filed',
            category: 'Admin',
            status: 'Resolved',
            active: true,
          },
        ],
      },
      linkedItems: [],
    },
  ];
}

export function buildSeedCases() {
  const today = new Date().toISOString().split('T')[0];

  return [
    {
      id: 'case-electrical',
      icon: '⚡',
      title: 'City Electrical Damage — Oven and AC',
      category: 'Incident / Insurance / Equipment',
      status: 'Waiting',
      people: ['Zeno', 'Monica', 'Mike', 'Max'],
      description: 'Electrical damage caused by city power surge. Both oven and AC affected. Insurance claim submitted.',
      timeline: [
        { author: 'Max',    text: 'Oven stopped working after electrical incident.',     date: 'Jun 28', sourceMessageId: null },
        { author: 'Zeno',   text: 'Contacted City of Weatherford to file complaint.',    date: 'Jun 29', sourceMessageId: null },
        { author: 'Monica', text: 'Insurance claim submitted. Claim #INS-2026-0412.',    date: 'Jul 1',  sourceMessageId: null },
        { author: 'Mike',   text: 'Technician report attached.',                         date: 'Jul 3',  sourceMessageId: null },
        { author: 'Zeno',   text: 'Waiting for written response from the City.',         date: 'Jul 8',  sourceMessageId: null },
      ],
      nextAction: 'Monica to follow up with the insurance adjuster by Friday.',
      updates: [],
    },
    {
      id: 'case-cooler',
      icon: '🧊',
      title: 'Reach-in Cooler #2',
      category: 'Equipment',
      status: 'Waiting',
      people: ['Zeno', 'Monica', 'Max'],
      description: 'Reach-in cooler running warm (45–48°F). Product moved to walk-in. Technician called.',
      timeline: [
        { author: 'Max',    text: 'Unit running at 45°F. Salmon moved to walk-in.',     date: 'Today', sourceMessageId: 'msg-2' },
        { author: 'Zeno',   text: 'Zeno Appliance called. Technician at 2 PM.',          date: 'Today', sourceMessageId: 'msg-3' },
        { author: 'Monica', text: 'Invoice received. Filed and scheduled payment.',       date: 'Today', sourceMessageId: 'msg-6' },
      ],
      nextAction: null,
      updates: [],
    },
    {
      id: 'case-pasta',
      icon: '🍝',
      title: 'Pasta Machine Motor',
      category: 'Equipment',
      status: 'Open',
      people: ['Mike', 'Max'],
      description: 'Pasta machine making a grinding noise under load. May need motor inspection or replacement.',
      timeline: [
        { author: 'Max',  text: 'Machine making grinding noise during peak service.', date: 'Jul 10', sourceMessageId: null },
        { author: 'Mike', text: 'Contacted service company. Waiting for callback.',    date: 'Jul 11', sourceMessageId: null },
      ],
      nextAction: 'Mike to confirm appointment with service company.',
      updates: [],
    },
    {
      id: 'case-saturday',
      icon: '🎪',
      title: 'Saturday Catering',
      category: 'Catering',
      status: 'In progress',
      people: ['Monica', 'Max', 'Zeno'],
      description: 'Saturday catering event. Menu changes requested by client.',
      timeline: [
        { author: 'Monica', text: 'Initial menu confirmed.', date: 'Jul 8', sourceMessageId: null },
        { author: 'Monica', text: 'Client requested 2 changes: mini tiramisù + cold pasta in cheese wheel.', date: 'Today', sourceMessageId: 'msg-1' },
      ],
      nextAction: 'Confirm final headcount with client.',
      updates: [],
    },
  ];
}

export function buildSeedEntries() {
  const now = Date.now();
  const todayStr = new Date().toISOString().split('T')[0];
  const yest = new Date(now - 86400000).toISOString().split('T')[0];
  const at = (h, m, dateStr = todayStr) => new Date(`${dateStr}T${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:00`).toISOString();

  return [
    {
      id: 'entry-1',
      type: 'note',
      category: 'Equipment',
      title: 'Dishwasher leaking again',
      text: 'Water pooling under unit. Product and chemicals moved away from the area. Need tech call ASAP.',
      authorId: 'max',
      status: 'In progress',
      assignTo: 'Zeno',
      created: at(8, 14),
      date: todayStr,
      updates: [],
      sourceMessageId: null,
    },
    {
      id: 'entry-2',
      type: 'note',
      category: 'Purchasing',
      title: 'Hardie\'s delivery received',
      text: 'Delivery received and checked. One invoice discrepancy on Ribeye case weight — review with Monica tomorrow.',
      authorId: 'monica',
      status: 'Open',
      assignTo: 'Monica',
      created: at(11, 20),
      date: todayStr,
      updates: [],
      sourceMessageId: null,
    },
    {
      id: 'entry-3',
      type: 'note',
      category: 'Incident',
      title: 'Expo printer dropped tickets during rush',
      text: 'Three tickets were lost. Printer restarted and recovered. New ribbon still needed.',
      authorId: 'bo',
      status: 'Resolved',
      assignTo: null,
      created: at(22, 10, yest),
      date: yest,
      updates: [
        { authorId: 'zeno', text: 'Ribbon ordered. Arrives Tuesday.', created: at(22, 45, yest) }
      ],
      sourceMessageId: null,
    },
    {
      id: 'entry-4',
      type: 'note',
      category: 'Staff',
      title: 'Call-out affected dinner coverage',
      text: 'One cook called out at 3 PM. Coverage adjusted internally. No major service impact.',
      authorId: 'zeno',
      status: 'Closed',
      assignTo: null,
      created: at(15, 30, yest),
      date: yest,
      updates: [],
      sourceMessageId: null,
    },
  ];
}

export function buildSeedTasks() {
  const now = new Date().toISOString();
  return [
    {
      id: 'task-1',
      title: 'Follow up on insurance claim — City Electrical',
      assignTo: 'Monica',
      assignedBy: 'zeno',
      status: 'Open',
      dueDateText: 'Friday',
      category: 'Admin',
      relatedCaseId: 'case-electrical',
      sourceMessageId: null,
      created: now,
    },
    {
      id: 'task-2',
      title: 'Contact pasta machine service company',
      assignTo: 'Mike',
      assignedBy: 'max',
      status: 'In progress',
      dueDateText: 'Tomorrow',
      category: 'Equipment',
      relatedCaseId: 'case-pasta',
      sourceMessageId: null,
      created: now,
    },
    {
      id: 'task-3',
      title: 'Review reservation log from yesterday',
      assignTo: 'Bo',
      assignedBy: 'bo',
      status: 'Done',
      dueDateText: 'Today',
      category: 'Service',
      relatedCaseId: null,
      sourceMessageId: 'msg-4',
      created: now,
    },
  ];
}
