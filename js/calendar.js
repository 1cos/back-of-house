// calendar.js — TripleSeat Events Calendar (admin only)
// Brigade v216

let _calEvents = []
let _calFilter = 'upcoming' // upcoming | past | all

async function showCalendar() {
  hideAdminMenu()
  document.querySelectorAll('section[id^="v"]').forEach(s => s.classList.add('hidden'))
  const sec = document.getElementById('vkal')
  if (!sec) return
  sec.classList.remove('hidden')
  sec.innerHTML = _calShell()
  await _calLoad()
}

function _calShell() {
  return `
<div style="padding:14px 14px 0;">
  <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
    <div style="font-size:18px;font-weight:700;color:#1e3a5f;">📅 Events</div>
    <button onclick="_calSync()" id="calSyncBtn"
      style="font-size:11px;font-weight:600;color:#059669;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:6px 12px;cursor:pointer;">
      ↻ Sync TripleSeat
    </button>
  </div>
  <div style="display:flex;gap:6px;margin-bottom:12px;">
    <button onclick="_calSetFilter('upcoming')" id="calF_upcoming"
      style="font-size:11px;font-weight:600;padding:5px 12px;border-radius:20px;cursor:pointer;border:1.5px solid #059669;background:#059669;color:white;">
      Upcoming
    </button>
    <button onclick="_calSetFilter('past')" id="calF_past"
      style="font-size:11px;font-weight:600;padding:5px 12px;border-radius:20px;cursor:pointer;border:1.5px solid #e2e8f0;background:white;color:#64748b;">
      Past
    </button>
    <button onclick="_calSetFilter('all')" id="calF_all"
      style="font-size:11px;font-weight:600;padding:5px 12px;border-radius:20px;cursor:pointer;border:1.5px solid #e2e8f0;background:white;color:#64748b;">
      All
    </button>
  </div>
</div>
<div id="calList" style="padding:0 14px 100px;overflow-y:auto;height:calc(100vh - 210px);-webkit-overflow-scrolling:touch;"></div>
`
}

function _calSetFilter(f) {
  _calFilter = f
  ;['upcoming','past','all'].forEach(k => {
    const btn = document.getElementById('calF_' + k)
    if (!btn) return
    if (k === f) {
      btn.style.background = '#059669'
      btn.style.color = 'white'
      btn.style.borderColor = '#059669'
    } else {
      btn.style.background = 'white'
      btn.style.color = '#64748b'
      btn.style.borderColor = '#e2e8f0'
    }
  })
  _calRender()
}

async function _calLoad() {
  const list = document.getElementById('calList')
  if (!list) return
  list.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px;">Loading events…</div>'
  try {
    const client = window.supa || window.supabaseClient
    if (!client) throw new Error('Supabase not ready')
    const { data, error } = await client
      .from('events')
      .select('*')
      .order('event_date', { ascending: true })
    if (error) throw error
    _calEvents = data || []
    _calRender()
  } catch(e) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:#ef4444;font-size:13px;">Error loading events</div>'
  }
}

function _calRender() {
  const list = document.getElementById('calList')
  if (!list) return

  const today = new Date().toISOString().split('T')[0]
  let filtered = _calEvents

  if (_calFilter === 'upcoming') {
    filtered = _calEvents.filter(e => e.event_date >= today)
  } else if (_calFilter === 'past') {
    filtered = _calEvents.filter(e => e.event_date < today)
  }

  if (!filtered.length) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px;">No events found</div>'
    return
  }

  // Group by month
  const byMonth = {}
  filtered.forEach(e => {
    const d = new Date(e.event_date + 'T12:00:00')
    const key = d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
    if (!byMonth[key]) byMonth[key] = []
    byMonth[key].push(e)
  })

  let html = ''
  for (const [month, events] of Object.entries(byMonth)) {
    html += `<div style="font-size:11px;font-weight:700;color:#94a3b8;text-transform:uppercase;letter-spacing:.08em;padding:14px 0 6px;">${month}</div>`
    events.forEach(e => {
      html += _calCard(e)
    })
  }
  list.innerHTML = html
}

function _calCard(e) {
  const d = new Date(e.event_date + 'T12:00:00')
  const dayName = d.toLocaleDateString('en-US', { weekday: 'short' })
  const dayNum = d.getDate()
  const today = new Date().toISOString().split('T')[0]
  const isPast = e.event_date < today
  const isToday = e.event_date === today

  const statusColor = {
    confirmed: '#059669',
    tentative: '#f59e0b',
    cancelled: '#ef4444'
  }[e.status] || '#94a3b8'

  const statusBg = {
    confirmed: '#f0fdf4',
    tentative: '#fffbeb',
    cancelled: '#fff5f5'
  }[e.status] || '#f8fafc'

  // Time
  let timeStr = ''
  if (e.event_time) {
    const [h, m] = e.event_time.split(':')
    const hr = parseInt(h)
    const ampm = hr >= 12 ? 'PM' : 'AM'
    const hr12 = hr % 12 || 12
    timeStr = `${hr12}:${m} ${ampm}`
  }

  // Documents
  const docs = Array.isArray(e.documents) ? e.documents : []
  const docLabels = {
    'banquet_event_order': 'BEO',
    'kitchen_sheet': 'Kitchen Sheet',
    'menu': 'Menu',
    'contract': 'Contract'
  }
  let docsHtml = ''
  if (docs.length) {
    docsHtml = '<div style="display:flex;gap:6px;margin-top:10px;flex-wrap:wrap;">'
    docs.forEach(doc => {
      const label = docLabels[doc.type] || doc.name || 'PDF'
      docsHtml += `
        <a href="${doc.url}" target="_blank" rel="noopener"
          style="display:inline-flex;align-items:center;gap:4px;font-size:10px;font-weight:600;
                 color:#2563eb;background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;
                 padding:4px 8px;text-decoration:none;">
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
          ${label}
        </a>`
    })
    docsHtml += '</div>'
  }

  // TripleSeat link
  const tsLink = e.tripleseat_id
    ? `<a href="https://lc.tripleseat.com/events/${e.tripleseat_id}" target="_blank"
        style="font-size:10px;color:#94a3b8;text-decoration:none;">View in TripleSeat ↗</a>`
    : ''

  return `
<div style="background:white;border-radius:16px;border:0.5px solid rgba(59,130,246,0.1);
            box-shadow:0 2px 8px rgba(30,58,95,0.06);margin-bottom:10px;overflow:hidden;
            opacity:${isPast ? '0.65' : '1'};">
  <div style="display:flex;gap:0;">
    <!-- Date column -->
    <div style="min-width:52px;background:${isToday ? '#1e3a5f' : '#f8fafc'};
                display:flex;flex-direction:column;align-items:center;justify-content:center;
                padding:12px 8px;border-right:0.5px solid rgba(59,130,246,0.08);">
      <div style="font-size:10px;font-weight:600;color:${isToday ? '#93c5fd' : '#94a3b8'};text-transform:uppercase;">${dayName}</div>
      <div style="font-size:22px;font-weight:800;color:${isToday ? 'white' : '#1e3a5f'};line-height:1.1;">${dayNum}</div>
    </div>
    <!-- Content -->
    <div style="flex:1;padding:12px 14px;">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:8px;">
        <div style="font-size:14px;font-weight:700;color:#1e3a5f;line-height:1.3;">${e.name}</div>
        <span style="font-size:10px;font-weight:600;color:${statusColor};background:${statusBg};
                     border-radius:6px;padding:2px 7px;white-space:nowrap;flex-shrink:0;">
          ${(e.status || 'tentative').charAt(0).toUpperCase() + (e.status || 'tentative').slice(1)}
        </span>
      </div>
      <div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
        ${timeStr ? `<span style="font-size:12px;color:#475569;">🕐 ${timeStr}</span>` : ''}
        ${e.guest_count ? `<span style="font-size:12px;color:#475569;">👥 ${e.guest_count} guests</span>` : ''}
        ${e.room_name ? `<span style="font-size:12px;color:#475569;">📍 ${e.room_name}</span>` : ''}
      </div>
      ${e.contact_name ? `<div style="font-size:11px;color:#94a3b8;margin-top:4px;">Contact: ${e.contact_name}</div>` : ''}
      ${docsHtml}
      ${docs.length === 0 && tsLink ? '<div style="margin-top:8px;">' + tsLink + '</div>' : ''}
      ${docs.length > 0 ? '<div style="margin-top:6px;">' + tsLink + '</div>' : ''}
    </div>
  </div>
</div>`
}

async function _calSync() {
  const btn = document.getElementById('calSyncBtn')
  if (btn) { btn.textContent = '↻ Syncing…'; btn.style.opacity = '0.6'; btn.disabled = true }
  try {
    const res = await fetch('https://ydqmumpytgrlceuinoqt.supabase.co/functions/v1/tripleseat-sync', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    })
    const result = await res.json()
    if (result.success) {
      if (btn) { btn.textContent = `✓ ${result.inserted} new, ${result.updated} updated`; btn.style.opacity = '1' }
      await _calLoad()
      setTimeout(() => { if (btn) { btn.textContent = '↻ Sync TripleSeat'; btn.disabled = false } }, 3000)
    } else {
      throw new Error(result.error || 'Sync failed')
    }
  } catch(e) {
    if (btn) { btn.textContent = '✗ Error — retry'; btn.style.opacity = '1'; btn.disabled = false }
    console.error('TripleSeat sync error:', e)
    alert('Sync error: ' + e.message)
  }
}
