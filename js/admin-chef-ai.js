// ── CHEF AI SETTINGS ──
// Aperto dal menu Admin → "Chef AI ⚙️"
// Permette di attivare/disattivare le regole di scansione del Sous Chef.

window.openChefAISettings = function() {
  if (!isAdmin()) return;

  const SC_LABELS = {
    'SC-PRICE-001': { label: 'Prezzo carni anomalo', desc: 'Segnala se $/100g su carne è < $0.10 (possibile catchweight non rilevato)', emoji: '🥩' },
    'SC-PRICE-002': { label: 'Prezzo aumentato >20%', desc: 'Segnala se un articolo è aumentato di oltre il 20% rispetto alla media storica', emoji: '📈' },
    'SC-NOLINK-001': { label: 'Ingredienti senza prezzo', desc: 'Segnala ingredienti attivi senza $/100g calcolato', emoji: '💡' },
    'SC-UNUSED-001': { label: 'Acquistato ma non in ricette', desc: 'Segnala articoli acquistati non collegati a nessuna ricetta', emoji: '🔗' },
  };

  let rules = {};
  try {
    const saved = localStorage.getItem('sc_scan_rules');
    const defaults = { 'SC-PRICE-001': true, 'SC-PRICE-002': true, 'SC-NOLINK-001': true, 'SC-UNUSED-001': false };
    rules = saved ? { ...defaults, ...JSON.parse(saved) } : { ...defaults };
  } catch(_) {
    rules = { 'SC-PRICE-001': true, 'SC-PRICE-002': true, 'SC-NOLINK-001': true, 'SC-UNUSED-001': false };
  }

  const modal = document.createElement('div');
  modal.id = '_chefAIModal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:9400;display:flex;align-items:flex-end;justify-content:center;background:rgba(0,0,0,0.5);';

  const rulesHtml = Object.entries(SC_LABELS).map(([code, cfg]) => {
    const on = rules[code] !== false;
    return `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:0.5px solid #f1f5f9;">
        <span style="font-size:24px;flex-shrink:0;">${cfg.emoji}</span>
        <div style="flex:1;min-width:0;">
          <div style="font-size:13px;font-weight:600;color:#1e293b;">${cfg.label}</div>
          <div style="font-size:11px;color:#64748b;margin-top:2px;line-height:1.4;">${cfg.desc}</div>
        </div>
        <button id="scToggle-${code}"
          onclick="scToggleRule('${code}', this)"
          style="flex-shrink:0;width:48px;height:28px;border-radius:14px;border:none;cursor:pointer;
            background:${on ? '#10b981' : '#e2e8f0'};
            position:relative;transition:background .2s;">
          <span style="position:absolute;top:3px;left:${on ? '22px' : '3px'};width:22px;height:22px;border-radius:50%;background:white;box-shadow:0 1px 3px rgba(0,0,0,0.2);transition:left .2s;display:block;"></span>
        </button>
      </div>`;
  }).join('');

  modal.innerHTML = `
    <div style="background:white;border-radius:24px 24px 0 0;padding:20px;width:100%;max-width:480px;margin:0 auto;max-height:80vh;overflow-y:auto;">
      <div style="width:36px;height:4px;background:#e2e8f0;border-radius:2px;margin:0 auto 16px;"></div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px;">
        <span style="font-size:22px;">🤖</span>
        <div>
          <div style="font-size:16px;font-weight:700;color:#1e293b;">Chef AI — Impostazioni</div>
          <div style="font-size:11px;color:#64748b;margin-top:1px;">Regole di scansione automatica del Sous Chef</div>
        </div>
      </div>
      <div style="background:#f8fafc;border-radius:12px;padding:10px 12px;margin:12px 0;font-size:12px;color:#475569;line-height:1.5;">
        💡 Tap breve sul microfono 🎙️ = scansione immediata.<br>
        Tieni premuto = parla con il Sous Chef.
      </div>
      <div style="margin-bottom:16px;">${rulesHtml}</div>
      <button onclick="
        if(typeof runSousChefScan==='function') runSousChefScan();
        document.getElementById('_chefAIModal')?.remove();
      " style="width:100%;height:48px;border-radius:16px;background:#1e293b;color:white;font-size:14px;font-weight:600;border:none;cursor:pointer;margin-bottom:8px;">
        🔍 Scan ora
      </button>
      <button onclick="document.getElementById('_chefAIModal')?.remove()"
        style="width:100%;height:40px;border-radius:14px;background:#f1f5f9;color:#64748b;font-size:13px;border:none;cursor:pointer;">
        Chiudi
      </button>
    </div>`;

  modal.addEventListener('click', e => { if (e.target === modal) modal.remove(); });
  document.body.appendChild(modal);
};

window.scToggleRule = function(code, btn) {
  let rules = {};
  try {
    const saved = localStorage.getItem('sc_scan_rules');
    const defaults = { 'SC-PRICE-001': true, 'SC-PRICE-002': true, 'SC-NOLINK-001': true, 'SC-UNUSED-001': false };
    rules = saved ? { ...defaults, ...JSON.parse(saved) } : { ...defaults };
  } catch(_) {}
  rules[code] = !rules[code];
  localStorage.setItem('sc_scan_rules', JSON.stringify(rules));
  const on = rules[code];
  btn.style.background = on ? '#10b981' : '#e2e8f0';
  const dot = btn.querySelector('span');
  if (dot) dot.style.left = on ? '22px' : '3px';
};
