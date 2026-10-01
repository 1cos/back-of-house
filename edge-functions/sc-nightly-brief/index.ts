// sc-nightly-brief v39 -- Feature performance wording now states same-weekday
// baseline explicitly (Micro-task 24): "median of the last N Fridays" instead
// of generic "MEDIANA storica" / "historical median". No algorithm, RPC,
// threshold, or classification change -- get_feature_recent_comparison() and
// its same-weekday/median logic are untouched; this only changes how its
// already-computed prior_selling_days field is surfaced in the briefing copy.
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const OPENROUTER_API_KEY = Deno.env.get('OPENROUTER_API_KEY');
const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY');
const GOOGLE_TRANSLATE_API_KEY = Deno.env.get('GOOGLE_TRANSLATE_API_KEY');

const BEVERAGE_GROUPS = [
  'Beer','Common Cocktails','House Cocktails','NA Beverages','Mocktail',
  'Gin','Rum','Scotch','Tequila','Liqueurs',
  'Red  Wine BOTTLE','Red Wine GLASS','Sparkling Wine BOTTLE','Sparkling Wine GLASS',
  'Peach Festival'
];

async function callLLM(prompt: string, maxTokens = 800): Promise<string> {
  if (OPENROUTER_API_KEY) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://1cos.github.io/back-of-house',
          'X-Title': 'Brigade -- Zenos on the Square'
        },
        body: JSON.stringify({
          model: 'meta-llama/llama-3.3-70b-instruct',
          max_tokens: maxTokens,
          temperature: 0.3,
          messages: [{ role: 'user', content: prompt }]
        })
      });
      if (res.ok) {
        const data = await res.json();
        const text = data.choices?.[0]?.message?.content;
        if (text) return text;
      }
    } catch(_) {}
  }
  if (GROQ_API_KEY) {
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
      body: JSON.stringify({
        model: 'llama-3.3-70b-versatile',
        max_tokens: maxTokens,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }]
      })
    });
    const data = await res.json();
    return data.choices?.[0]?.message?.content || '';
  }
  throw new Error('Nessuna chiave AI disponibile');
}

function parsePoints(raw: string): string[] {
  try {
    const cleaned = raw.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
    const parsed = JSON.parse(cleaned);
    if (Array.isArray(parsed)) return parsed.filter((p: any) => typeof p === 'string' && p.trim());
  } catch(_) {
    const m = raw.match(/\[[\s\S]*\]/);
    if (m) try { return JSON.parse(m[0]); } catch(_) {}
  }
  return [];
}

async function translatePoints(points: string[], targetLang: string): Promise<string[]> {
  if (!points.length) return [];
  if (GOOGLE_TRANSLATE_API_KEY) {
    try {
      const params = new URLSearchParams({ key: GOOGLE_TRANSLATE_API_KEY, target: targetLang, format: 'text' });
      points.forEach(p => params.append('q', p));
      const res = await fetch(`https://translation.googleapis.com/language/translate/v2?${params}`, { method: 'POST' });
      if (res.ok) {
        const data = await res.json();
        const translations = data?.data?.translations;
        if (translations && translations.length === points.length) {
          return translations.map((t: any) => t.translatedText);
        }
      }
    } catch(_) {}
  }
  if (GROQ_API_KEY) {
    try {
      const results = await Promise.all(points.map(async (p) => {
        const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${GROQ_API_KEY}` },
          body: JSON.stringify({
            model: 'llama-3.3-70b-versatile',
            max_tokens: 200,
            temperature: 0.1,
            messages: [{ role: 'user', content: `Translate this kitchen briefing point to ${targetLang === 'en' ? 'English' : 'Spanish'}. Return ONLY the translated text, nothing else:\n${p}` }]
          })
        });
        const data = await res.json();
        return data.choices?.[0]?.message?.content?.trim() || p;
      }));
      return results;
    } catch(_) {}
  }
  return points;
}

serve(async () => {
  try {
    const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const now = new Date();
    const cdt = new Date(now.getTime() - 5 * 60 * 60 * 1000);
    const todayStr = cdt.toISOString().slice(0, 10);
    const isMonday = cdt.getDay() === 1;

    // --- CALCOLA IERI ---
    const yesterday = new Date(cdt);
    yesterday.setDate(yesterday.getDate() - 1);
    const ydStr = yesterday.toISOString().slice(0, 10);

    // --- STAZIONI NON CHIUSE ieri sera ---
    const { data: allChecks } = await sb
      .from('closing_checks')
      .select('station')
      .eq('archived', false);
    const activeStations = [...new Set((allChecks || []).map((c: any) => c.station))];

    const { data: closedLogs } = await sb
      .from('closing_log')
      .select('check_id')
      .eq('log_date', ydStr);

    let closedStations: string[] = [];
    if (closedLogs && closedLogs.length > 0) {
      const checkIds = closedLogs.map((l: any) => l.check_id);
      const { data: closedChecks } = await sb
        .from('closing_checks')
        .select('station')
        .in('id', checkIds);
      closedStations = [...new Set((closedChecks || []).map((c: any) => c.station))];
    }

    const missingStations = activeStations.filter(s => !closedStations.includes(s));

    // Se ci sono stazioni non chiuse → crea office_item orange
    if (missingStations.length > 0) {
      await sb.from('office_items').insert({
        source: 'ai_scan',
        priority: 'orange',
        status: 'open',
        title: `⚠️ Stazioni non chiuse ieri sera`,
        body: `Le seguenti stazioni non hanno completato la closing checklist il ${ydStr}:\n${missingStations.map(s => '• ' + s).join('\n')}`,
        ai_options: JSON.stringify([{ label: 'Ok, visto', action: 'ignore', params: {} }]),
        notify_brigade: false,
        from_user: 'sc-nightly-brief'
      });
    }

    // Micro-task 24: weekday label needed for FEATURE PERFORMANCE wording,
    // computed here (independent of the isMonday anomalies block further
    // down, which computes its own targetDow/weekdayLabel for a different
    // purpose and is left untouched). Lightweight single-row read, no write,
    // no change to any existing query below.
    let featureWeekdayLabel = 'same weekday';
    try {
      const { data: ydRow } = await sb.from('pos_daily_summary').select('day_of_week').eq('sale_date', ydStr).maybeSingle();
      if (ydRow && ydRow.day_of_week) featureWeekdayLabel = ydRow.day_of_week + 's';
    } catch(_) {}

    // --- FEATURE PERFORMANCE (vs propria storia — deterministico, no LLM math) ---
    // Reuses the existing get_feature_recent_comparison() SQL function as-is —
    // no recomputation of medians/classification here. Only STRONG/WEAK are
    // surfaced; NORMAL stays silent and INSUFFICIENT_HISTORY is excluded from
    // Briefing entirely (a brand-new Feature isn't automatically noteworthy).
    // Non-causal by construction: only qty/median/%/net/share are passed to
    // the LLM, never a "why" — the prompt rule below forbids inventing one.
    // Micro-task 24: wording now surfaces the RPC's own prior_selling_days
    // (the real same-weekday count already used to compute the median) and
    // the weekday name, so the comparison basis is explicit -- e.g. "median
    // of the last 5 Fridays" -- instead of a generic "MEDIANA storica".
    let featureCtx = '';
    let featureCtxStaff = '';
    try {
      const { data: featureRows } = await sb.rpc('get_feature_recent_comparison', { p_business_date: ydStr });
      const notable = (featureRows || []).filter((r: any) => r.classification === 'STRONG' || r.classification === 'WEAK');
      if (notable.length > 0) {
        featureCtx = 'FEATURE PERFORMANCE (confronto con la MEDIANA -- il valore tipico, NON una media aritmetica -- calcolata sugli ultimi N same-weekday storici realmente disponibili per quel Feature (N = prior_selling_days, gia fornito qui sotto); valori gia calcolati, non ricalcolare):\n' +
          notable.map((r: any) => {
            const pct = Number(r.pct_vs_prior_median);
            const sign = pct > 0 ? '+' : '';
            return r.menu_item + ': ' + r.classification + ' — ' + r.quantity + ' venduti ieri vs median of the last ' +
              r.prior_selling_days + ' ' + featureWeekdayLabel + ' (' + r.prior_median_qty + ')' +
              ' (' + sign + pct.toFixed(0) + '%), $' + Number(r.net_sales).toFixed(0) +
              ' (' + Number(r.feature_net_share_pct).toFixed(1) + '% delle vendite nette)';
          }).join('\n');
        featureCtxStaff = 'FEATURE PERFORMANCE (confronto con la MEDIANA -- il valore tipico, NON una media -- calcolata sugli ultimi N same-weekday storici (N = prior_selling_days, gia fornito qui sotto), non ricalcolare):\n' +
          notable.map((r: any) => {
            const pct = Number(r.pct_vs_prior_median);
            const sign = pct > 0 ? '+' : '';
            return r.menu_item + ': ' + r.classification + ' — ' + r.quantity + ' venduti ieri vs median of the last ' +
              r.prior_selling_days + ' ' + featureWeekdayLabel + ' (' + r.prior_median_qty + ')' +
              ' (' + sign + pct.toFixed(0) + '%)';
          }).join('\n');
      }
    } catch(_) {
      // If the RPC isn't reachable for any reason, Briefing continues exactly
      // as before — Feature performance is additive, never a hard dependency.
    }

    // --- DATI VENDITE E NOTE ---
    let salesData: any[] = [];
    let topItemsRaw: any[] = [];
    let notesData: any[] = [];
    let avgData: any[] = [];
    let sameWeekdayDates: string[] = [];
    let targetDow: string | null = null;

    if (isMonday) {
      const weekDays: string[] = [];
      for (let d = 6; d >= 1; d--) {
        const dd = new Date(cdt);
        dd.setDate(dd.getDate() - d);
        weekDays.push(dd.toISOString().slice(0, 10));
      }
      const { data: s } = await sb.from('pos_daily_summary').select('sale_date, net_sales, bill_count, day_of_week').in('sale_date', weekDays).order('sale_date', { ascending: true });
      salesData = s || [];
      const { data: t } = await sb.from('pos_sales_by_item').select('menu_item, menu_group, quantity').in('sale_date', weekDays).lt('quantity', 1000).order('quantity', { ascending: false });
      topItemsRaw = (t || []).filter((r: any) => !BEVERAGE_GROUPS.includes(r.menu_group));
      const { data: n } = await sb.from('operation_notes').select('user_name, note, note_date, sentiment').in('note_date', weekDays).order('created_at', { ascending: true });
      notesData = n || [];
    } else {
      const { data: s } = await sb.from('pos_daily_summary').select('sale_date, net_sales, bill_count, day_of_week').eq('sale_date', ydStr).maybeSingle();
      salesData = s ? [s] : [];
      const { data: t } = await sb.from('pos_sales_by_item').select('menu_item, menu_group, quantity').eq('sale_date', ydStr).lt('quantity', 1000).order('quantity', { ascending: false }).limit(30);
      topItemsRaw = (t || []).filter((r: any) => !BEVERAGE_GROUPS.includes(r.menu_group));
      // Same-weekday baseline (v38): a Friday is compared to prior Fridays,
      // not to a 30-day average blending every weekday together. Target day
      // is always excluded (sale_date < ydStr); up to the last 6 same-weekdays;
      // fewer than 3 available -> avgData stays empty -> no anomalies for that day.
      targetDow = salesData.length ? salesData[0].day_of_week : null;
      if (targetDow) {
        const { data: dowRows } = await sb.from('pos_daily_summary')
          .select('sale_date')
          .eq('day_of_week', targetDow)
          .lt('sale_date', ydStr)
          .order('sale_date', { ascending: false })
          .limit(6);
        sameWeekdayDates = (dowRows || []).map((r: any) => r.sale_date);
      }
      if (sameWeekdayDates.length >= 3) {
        const { data: avg } = await sb.from('pos_sales_by_item').select('menu_item, menu_group, quantity').in('sale_date', sameWeekdayDates).lt('quantity', 1000);
        avgData = (avg || []).filter((r: any) => !BEVERAGE_GROUPS.includes(r.menu_group));
      }
      const { data: n } = await sb.from('operation_notes').select('user_name, note, sentiment').eq('note_date', ydStr).order('created_at', { ascending: true });
      notesData = n || [];
    }

    const itemTotals: Record<string, number> = {};
    for (const r of topItemsRaw) { itemTotals[r.menu_item] = (itemTotals[r.menu_item] || 0) + Number(r.quantity); }
    const topItems = Object.entries(itemTotals).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([item, qty]) => ({ item, qty }));

    const avgByItem: Record<string, number> = {};
    if (avgData.length) {
      const counts: Record<string, number[]> = {};
      for (const r of avgData) { if (!counts[r.menu_item]) counts[r.menu_item] = []; counts[r.menu_item].push(Number(r.quantity)); }
      for (const [item, vals] of Object.entries(counts)) { avgByItem[item] = vals.reduce((a: number, b: number) => a + b, 0) / vals.length; }
    }

    const weekdayLabel = targetDow ? targetDow + 's' : 'same weekday';
    const anomalies = topItems
      .filter(({ item, qty }) => { const avg = avgByItem[item]; if (!avg) return false; return Math.abs(qty - avg) / avg > 0.5; })
      .map(({ item, qty }) => { const avg = avgByItem[item]; const pct = Math.round(((qty - avg) / avg) * 100); return item + ': ' + qty + ' servings, ' + (pct > 0 ? '+' : '') + pct + '% vs average of the last ' + sameWeekdayDates.length + ' ' + weekdayLabel; });

    const salesCtx = isMonday
      ? salesData.map(s => s.day_of_week + ' ' + s.sale_date + ': ' + s.bill_count + ' bills, $' + Number(s.net_sales).toFixed(0)).join('\n')
      : salesData.length ? salesData[0].day_of_week + ': ' + salesData[0].bill_count + ' bills, $' + Number(salesData[0].net_sales).toFixed(0) : 'No sales data';

    const topCtx = topItems.length ? topItems.slice(0, 6).map(({ item, qty }) => item + ': ' + qty + ' portions').join('\n') : 'No food sales data available';
    const anomalyCtx = anomalies.length ? 'ANOMALIES vs same-weekday historical average (NOT a 30-day blended avg, valori gia calcolati, non ricalcolare):\n' + anomalies.join('\n') : '';
    const notesCtx = notesData.length ? 'BRIGADE NIGHT NOTES:\n' + notesData.map((n: any) => n.user_name + ': "' + n.note + '"').join('\n') : '';
    const missingCtx = missingStations.length > 0 ? `STAZIONI NON CHIUSE IERI: ${missingStations.join(', ')}` : '';
    const noFoodData = topItems.length === 0;

    const adminPrompt = 'Sei il sous chef digitale di Max, executive chef di Zenos on the Square, Weatherford TX.\n\nCRITICAL: Usa SOLO i numeri esatti qui sotto. NON inventare o stimare dati.\n\n' +
      (isMonday ? 'SETTIMANA:\n' : 'IERI:\n') + salesCtx + '\n\n' +
      (noFoodData ? 'Nessun dato vendite cibo.\n\n' : 'PIATTI TOP (porzioni esatte vendute):\n' + topCtx + '\n\n') +
      (anomalyCtx ? anomalyCtx + '\n\n' : '') +
      (featureCtx ? featureCtx + '\n\n' : '') +
      (missingCtx ? missingCtx + '\n\n' : '') +
      (notesCtx ? notesCtx + '\n\n' : '') +
      'REGOLE:\n' +
      '- Tono diretto come un vero sous chef\n' +
      '- Cita SOLO numeri dai dati sopra\n' +
      '- Piatti solo in porzioni, mai in dollari\n' +
      '- Max 5 punti\n' +
      '- Se ci sono STAZIONI NON CHIUSE: primo punto sempre le stazioni mancanti\n' +
      '- Se ci sono BRIGADE NIGHT NOTES: includi sempre un punto sintetico — tono generale, chi ha coperto stazioni extra, segnalazioni\n' +
      '- Se ci sono dati FEATURE PERFORMANCE: includi un punto sintetico per ciascun Feature elencato, citando SOLO i numeri forniti (mai il motivo, mai perché è successo) — questi punti restano SEMPRE meno prioritari di stazioni non chiuse o anomalie di vendita serie\n' +
      '- IMPORTANTE per FEATURE PERFORMANCE: i dati sopra riportano gia la frase esatta "median of the last N {weekday}s" (es. "median of the last 5 Fridays") — riportala SEMPRE per intero e testuale nel punto del briefing, non accorciarla mai e non sostituirla MAI con "mediana storica", "historical median", "media storica" o wording generico senza weekday/numero; il confronto resta sempre con una MEDIANA (il valore tipico), MAI con una media aritmetica; NON ricalcolare la percentuale, riporta esattamente quella fornita nei dati (questa regola vale solo per FEATURE PERFORMANCE — le ANOMALIES ora si basano sulla media dei soli giorni storici con lo stesso giorno della settimana, es. venerdi vs venerdi precedenti, non piu su una media a 30 giorni mista)\n' +
      '- IMPORTANTE per le ANOMALIES: riporta SEMPRE il confronto esattamente come fornito nei dati (es. "vs average of the last 6 Fridays"), non scrivere mai semplicemente "vs avg" o "vs media"\n' +
      '- Ordina i punti per importanza: 1) stazioni non chiuse, 2) anomalie di vendita rilevanti, 3) performance Feature, 4) note di turno, 5) altro\n' +
      '- Niente titoli, niente markdown\n' +
      '- Lingua: italiano\n\n' +
      'Rispondi SOLO con array JSON: ["punto 1", "punto 2"]';

    const staffPrompt = 'Sei il sous chef digitale della brigata di Zenos on the Square.\n\nCRITICAL: Usa SOLO i numeri esatti qui sotto. NON inventare dati.\n\n' +
      (isMonday ? 'SETTIMANA:\n' : 'IERI:\n') +
      (isMonday ? salesData.map(s => s.day_of_week + ': ' + s.bill_count + ' bills').join('\n') : salesData.length ? salesData[0].day_of_week + ': ' + salesData[0].bill_count + ' bills' : 'No data') + '\n\n' +
      (noFoodData ? 'Nessun dato cibo.\n\n' : 'PIATTI TOP:\n' + topCtx + '\n\n') +
      (anomalyCtx ? anomalyCtx + '\n\n' : '') +
      (featureCtxStaff ? featureCtxStaff + '\n\n' : '') +
      (notesCtx ? notesCtx + '\n\n' : '') +
      'REGOLE:\n- Tono caldo, diretto, motivante\n- ZERO prezzi, ZERO dollari\n- SOLO numeri dai dati sopra\n- Se ci sono dati FEATURE PERFORMANCE: al massimo un punto sintetico, mai il motivo; i dati sopra riportano gia la frase esatta "median of the last N {weekday}s" -- riportala per intero, MAI accorciata in "mediana storica"/"historical median"/wording generico; il confronto resta con una MEDIANA (valore tipico) MAI con una media aritmetica, e non ricalcolare la percentuale fornita\n- Se ci sono ANOMALIES: riporta il confronto esattamente come fornito (es. "vs average of the last 6 Fridays"), mai un generico "vs avg"\n- Max 3 punti\n- Lingua: italiano\n\nRispondi SOLO con array JSON: ["punto 1", "punto 2"]';

    const [adminRaw, staffRaw] = await Promise.all([callLLM(adminPrompt, 600), callLLM(staffPrompt, 700)]);
    let points = parsePoints(adminRaw);
    const pointsStaff = parsePoints(staffRaw);

    // Garantisce primo punto stazioni non chiuse anche se AI non lo mette
    if (missingStations.length > 0) {
      const missingPoint = `⚠️ Stazioni non chiuse ieri sera: ${missingStations.join(', ')}`;
      const alreadyMentioned = points.some(p => missingStations.some(s => p.includes(s)) || p.includes('non chius'));
      if (!alreadyMentioned) points = [missingPoint, ...points];
    }

    const [points_en, points_es, points_staff_en, points_staff_es] = await Promise.all([
      translatePoints(points, 'en'),
      translatePoints(points, 'es'),
      translatePoints(pointsStaff, 'en'),
      translatePoints(pointsStaff, 'es')
    ]);

    await sb.from('briefing').delete().eq('date', todayStr);
    await sb.from('briefing').insert({
      date: todayStr,
      points: points.length ? points : ['Briefing non disponibile.'],
      points_en: points_en.length ? points_en : [],
      points_es: points_es.length ? points_es : [],
      points_staff: pointsStaff, // no filler -- empty array is a valid, honest result when nothing staff-relevant exists
      points_staff_en: points_staff_en.length ? points_staff_en : [],
      points_staff_es: points_staff_es.length ? points_staff_es : [],
      generated_at: now.toISOString()
    });

    return new Response(JSON.stringify({
      ok: true, date: todayStr, isMonday, missingStations, points, points_staff: pointsStaff
    }), { headers: { 'Content-Type': 'application/json' } });

  } catch(e: any) {
    console.error('sc-nightly-brief error:', e);
    return new Response(JSON.stringify({ error: e.message }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
});
