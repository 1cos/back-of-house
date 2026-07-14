// BOH OS v2 — English locale
// Canonical language. All other locales are derived from these keys.

export const en = {
  'app.name':         'BOH OS',
  'mode.station':     'Station Mode',
  'foundation.title': 'Foundation ready',
  'foundation.body':  'The Station Mode application will be built here.',

  // ── Authentication ──────────────────────────────────────────────────
  'auth.title':            'Enter your PIN',
  'auth.pin_label':        'PIN',
  'auth.continue':         'Continue',
  'auth.checking':         'Checking\u2026',
  'auth.invalid_pin':      'PIN not recognized.',
  'auth.connection_error': 'Unable to connect. Try again.',
  'auth.welcome':          'Welcome, {name}',
  'auth.ready':            'Your BOH OS session is ready.',

  // ── Navigation ──────────────────────────────────────────────────────
  'nav.primary':  'Primary navigation',
  'nav.home':     'Home',
  'nav.prep':     'Prep',
  'nav.recipes':  'Recipes',
  'nav.chat':     'Chat',
  'nav.schedule': 'Schedule',

  // ── Station Home ────────────────────────────────────────────────────
  'station_home.good_morning':      'Good morning',
  'station_home.good_afternoon':    'Good afternoon',
  'station_home.good_evening':      'Good evening',
  'station_home.greeting_fallback': 'Welcome',
  'station_home.your_station':      'Your station',
  'station_home.station_unassigned':'Station not assigned',
  'station_home.open_today':        'Open Today',

  // ── Station Prep ────────────────────────────────────────────────────
  'station_prep.title':              'Prep',
  'station_prep.loading':            'Loading prep\u2026',
  'station_prep.task_count':         '{count} active prep tasks',
  'station_prep.empty':              'No prep tasks assigned to this station.',
  'station_prep.error':              'Unable to load prep. Try again later.',
  'station_prep.station_unassigned': 'Station not assigned.',
  'station_prep.status_in_progress': 'In progress',
  'station_prep.status_to_do':       'To do',
  'station_prep.status_ready':       'Ready',

  // ── Station Prep — Bot suggestion statuses ───────────────────────────
  'station_prep.suggestion_do_first':      'DO FIRST',
  'station_prep.suggestion_do_today':      'DO TODAY',
  'station_prep.suggestion_looks_good':    'LOOKS GOOD',
  'station_prep.suggestion_count_first':   'COUNT FIRST',
  'station_prep.suggestion_check_tomorrow':'CHECK TOMORROW',
  'station_prep.suggestion_check':         'CHECK',

  // ── Station Prep — Section headings ──────────────────────────────────
  'station_prep.section_do_first':    'Do first',
  'station_prep.section_do_today':    'Do today',
  'station_prep.section_check':       'Check',
  'station_prep.section_looks_good':  'Looks good',
  'station_prep.section_in_progress': 'In progress',

  // ── Station Prep — Collapsible detail (Task 004H) ────────────────────
  'station_prep.expand_details':     'Show details for {name}',
  'station_prep.collapse_details':   'Hide details for {name}',
  'station_prep.detail_prepare_today':    'Prepare today',
  'station_prep.detail_in_stock':         'In stock',
  'station_prep.detail_why_this_amount':  'Why this amount',
  'station_prep.detail_not_available':    'Not available',
  'station_prep.detail_not_recorded':     'Not recorded',
  'station_prep.detail_no_explanation':   'No explanation available',

  // ── Station Prep — Made today logs (Task 004K) ────────────────────────
  'station_prep.detail_made_today':           'Made today',
  'station_prep.detail_nothing_made_today':   'Nothing made today',
  'station_prep.detail_quantity_not_recorded':'Quantity not recorded',
  'station_prep.detail_user_not_recorded':    'User not recorded',
  'station_prep.detail_time_not_available':   'Time not available',

  // ── Station Prep — Start action (Task 004M) ───────────────────────────
  'station_prep.start':       'Start',
  'station_prep.starting':    'Starting\u2026',
  'station_prep.start_error': 'Unable to start this prep. Try again.',

  // ── Station Prep — Complete action (Task 004P) ────────────────────────
  'station_prep.complete': 'Complete',

  // ── Station Prep — Complete submission feedback (Task 004Q) ───────────
  'station_prep.completing':            'Completing\u2026',
  'station_prep.complete_error':        'Unable to complete this prep. Try again.',
  'station_prep.complete_partial_error':'Production was recorded, but the prep status was not updated. Tell the Chef.',

  // ── Station Prep — Complete Prep Form (Task 004O) ─────────────────────
  'station_prep.complete_form_title':          'Complete prep',
  'station_prep.complete_form_fallback_task':  'Prep task',
  'station_prep.complete_form_quantity':       'Quantity completed',
  'station_prep.complete_form_unit':           'Unit',
  'station_prep.complete_form_confirm':        'Confirm',
  'station_prep.complete_form_cancel':         'Cancel',
  'station_prep.complete_form_quantity_error': 'Enter a quantity greater than zero.',
  'station_prep.complete_form_unit_error':     'Enter a unit.',

  // ── Station Prep — Last physical count (Task 004S) ────────────────────
  'station_prep.detail_last_physical_count': 'Last physical count',
  'station_prep.detail_no_recent_count':     'No recent physical count',
  'station_prep.detail_counted_by':          'Counted by',
  'station_prep.detail_counted_at':          'Counted at',
  'station_prep.detail_reconciliation':      'Reconciliation',
  'station_prep.detail_reconciled_quantity': 'Reconciled quantity',
  'station_prep.detail_reconciliation_note': 'Reconciliation note',

  // ── Station Prep — Physical Count Form (Task 004T) ────────────────────
  'station_prep.count_form_title':          'Count stock',
  'station_prep.count_form_fallback_task':  'Prep task',
  'station_prep.count_form_quantity':       'Physical quantity',
  'station_prep.count_form_unit':           'Unit',
  'station_prep.count_form_confirm':        'Save count',
  'station_prep.count_form_cancel':         'Cancel',
  'station_prep.count_form_quantity_error': 'Enter a quantity of zero or greater.',
  'station_prep.count_form_unit_error':     'Enter a unit.',

  // ── Station Prep — Count action (Task 004V) ───────────────────────────
  'station_prep.count':               'Count stock',
  'station_prep.count_saving':        'Saving count\u2026',
  'station_prep.count_error':         'Unable to save this count. Try again.',
  'station_prep.count_partial_error': 'Count was recorded, but the prep stock was not updated. Tell the Chef.',
};
