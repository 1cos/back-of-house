// ══════════════════════════════════════════════════════════════
// SOUS CHEF SCAN — chiama Edge Function souschef-scan
// L'AI legge tutto il DB server-side e scrive i warning.
// Niente filtri JavaScript. Niente dataset costruito lato client.
// ══════════════════════════════════════════════════════════════

const SC_THROTTLE_MS = 30 * 60 * 1000;

// silent=true → scan automatica, nessun toast, nessun feedback visivo
window.runSousChefScan = async function(silent = false) {
  const lastScan = parseInt(localStorage.getItem('sc_last_scan') || '0');
  const now = Date.now();
  if (now - lastScan < SC_THROTTLE_MS) {
    if (!silent) {
      const minsLeft = Math.ceil((SC_THROTTLE_MS - (now - lastScan)) / 60000);
      showScToast(`⏳ Prossima scan tra ${minsLeft} min`);
    }
    return;
  }

  const btn = document.getElementById('scBtn');
  if (!silent) {
    if (btn) { btn.style.background = 'rgba(16,185,129,0.15)'; btn.style.borderColor = '#10b981'; }
    showScToast('🔍 Sous Chef sta analizzando...');
  }

  try {
    const res = await fetch(`${SUPABASE_URL}/functions/v1/souschef-scan`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({}),
    });

    if (!res.ok) throw new Error('Scan error: ' + res.status);
    const data = await res.json();

    localStorage.setItem('sc_last_scan', String(now));

    if (data.count === 0) {
      if (!silent) showScToast('✅ Sous Chef — tutto ok');
    } else {
      // Aggiorna sempre il banner, anche in silent
      if (typeof loadWarningsBanner === 'function') loadWarningsBanner();
      if (!silent) showScToast(`⚠️ ${data.count} warning trovati`);
    }

  } catch(e) {
    console.error('[SousChefScan]', e.message);
    if (!silent) showScToast('⚠️ Scan error: ' + e.message);
  } finally {
    if (!silent && btn) { btn.style.background = ''; btn.style.borderColor = ''; }
  }
};
