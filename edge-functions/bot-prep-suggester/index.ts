// bot-prep-suggester — Prep Suggester Step 1
// Brigade · Zenos on the Square
// v18 — Complete POS service dates via RPC.
//   REGRESSION FIX: The v17 posDateRows fetch used an unbounded raw SELECT on
//   pos_daily_clean.  PostgREST hard-caps unordered unlimited SELECTs at 1,000
//   rows.  pos_daily_clean now contains 3,134 rows inside the history window, so
//   the raw fetch returned only the 6 oldest dates (2026-06-27 → 2026-07-03),
//   giving every DOW count = 1 instead of 3.
//
//   Fix: replace the raw SELECT with a call to the read-only SQL RPC
//   get_pos_business_dates(p_start_date, p_end_date) which executes
//   SELECT DISTINCT business_date … ORDER BY ASC server-side.  RPCs return
//   their full result set without the PostgREST row cap.  No client-side
//   Set deduplication of a potentially truncated dataset.
//
//   The valid-sample rule is unchanged:
//     A date enters days[] only when it is not Sunday AND it exists in the
//     complete RPC result.  Genuine zero-demand open days (POS-confirmed date
//     with no deduction for a prep) still contribute zero and increment count.
//
//   All other logic is identical to v17.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const SUPABASE_URL         = Deno.env.get('SUPABASE_URL')
const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
const HISTORY_START = '2026-06-27'
const BUFFER = 1.10

const MEATBALL_RECIPE_ID  = '74de5287-fc1a-4d53-9927-9da0b26070a9'
const PT481_BAGS          = 481
const PT480_MEATBALLS     = 480
const MEATBALLS_PER_BAG   = 5
const POMODORO_PER_BAG_G  = 85
const DEMI_PER_BAG_G      = 15
const BOT_VERSION         = 'v18_complete_pos_service_dates'

// reconcile_status values that make a count row ineligible as stock authority.
const EXCLUDED_RECONCILE_STATUSES = ['invalid_test_data', 'corrected_unit_error']

const CONSTRAINT_OVERRIDES: Record<number,{quality:string,increment:number|null,unit:string}> = {
  233: { quality: 'valid_fixed_batch', increment: 3150, unit: 'g'     },
  261: { quality: 'valid_fixed_batch', increment: 20,   unit: 'pezzi' },
  277: { quality: 'valid_fixed_batch', increment: 13,   unit: 'pezzi' },
  279: { quality: 'valid_scalable',    increment: 1,    unit: 'pezzi' },
  304: { quality: 'valid_fixed_batch', increment: 3500, unit: 'g'     },
  383: { quality: 'valid_scalable',    increment: 1,    unit: 'pezzi' },
  412: { quality: 'valid_fixed_batch', increment: 3500, unit: 'g'     },
  480: { quality: 'valid_fixed_batch', increment: 162,  unit: 'pz'    },
  234: { quality: 'valid_scalable',    increment: 1,    unit: 'g'     },
  255: { quality: 'valid_fixed_batch', increment: 520,  unit: 'g'     },
  256: { quality: 'valid_fixed_batch', increment: 450,  unit: 'g'     },
  271: { quality: 'valid_fixed_batch', increment: 2008, unit: 'g'     },
  273: { quality: 'valid_fixed_batch', increment: 300,  unit: 'g'     },
  327: { quality: 'valid_fixed_batch', increment: 3475, unit: 'g'     },
  340: { quality: 'valid_fixed_batch', increment: 16,   unit: 'pezzi' },
  343: { quality: 'valid_fixed_batch', increment: 1080, unit: 'g'     },
  346: { quality: 'valid_fixed_batch', increment: 1000, unit: 'g'     },
  354: { quality: 'valid_fixed_batch', increment: 550,  unit: 'g'     },
  356: { quality: 'valid_fixed_batch', increment: 10,   unit: 'pezzi' },
  358: { quality: 'valid_fixed_batch', increment: 2000, unit: 'g'     },
  364: { quality: 'valid_fixed_batch', increment: 1000, unit: 'g'     },
  365: { quality: 'valid_fixed_batch', increment: 100,  unit: 'g'     },
  385: { quality: 'valid_fixed_batch', increment: 1450, unit: 'g'     },
  398: { quality: 'valid_fixed_batch', increment: 330,  unit: 'g'     },
  423: { quality: 'valid_fixed_batch', increment: 2800, unit: 'g'     },
  424: { quality: 'valid_fixed_batch', increment: 2520, unit: 'g'     },
  439: { quality: 'valid_fixed_batch', increment: 2000, unit: 'g'     },
  449: { quality: 'valid_fixed_batch', increment: 2500, unit: 'g'     },
  472: { quality: 'valid_fixed_batch', increment: 1500, unit: 'g'     },
  473: { quality: 'valid_scalable',    increment: 1,    unit: 'g'     },
  475: { quality: 'valid_fixed_batch', increment: 50,   unit: 'nests' },
  479: { quality: 'valid_fixed_batch', increment: 3300, unit: 'g'     },
  282: { quality: 'valid_scalable',    increment: 1,    unit: 'pz'    },
  332: { quality: 'valid_scalable',    increment: 1,    unit: 'g'     },
  371: { quality: 'valid_scalable',    increment: 1,    unit: 'g'     },
  382: { quality: 'valid_fixed_batch', increment: 6,    unit: 'pezzi' },
  451: { quality: 'valid_scalable',    increment: 1,    unit: 'g'     },
  318: { quality: 'valid_scalable',    increment: 1,    unit: 'cup'   },
  415: { quality: 'valid_scalable',    increment: 1,    unit: 'g'     },
}

const CADENCE: Record<string,Record<number,any>> = {
  TWICE_WEEKLY: {
    1: { type: 'first_day',  second_day: 2,    cover: [1,2,3,4], window: 'A' },
    2: { type: 'second_day', second_day: null, cover: [2,3,4],   window: 'A' },
    3: { type: 'shortage',   second_day: null, cover: [3,4],     window: null },
    4: { type: 'first_day',  second_day: 5,    cover: [4,5,6],   window: 'B' },
    5: { type: 'second_day', second_day: null, cover: [5,6],     window: 'B' },
    6: { type: 'shortage',   second_day: null, cover: [6],       window: null },
  },
  THREE_TIMES_WEEKLY: {
    1: { type: 'window',   second_day: null, cover: [1,2], window: 'A' },
    2: { type: 'shortage', second_day: null, cover: [2],   window: null },
    3: { type: 'window',   second_day: null, cover: [3,4], window: 'B' },
    4: { type: 'shortage', second_day: null, cover: [4],   window: null },
    5: { type: 'window',   second_day: null, cover: [5,6], window: 'C' },
    6: { type: 'shortage', second_day: null, cover: [6],   window: null },
  },
}

function addDays(d: string, n: number): string { const x = new Date(d+'T00:00:00Z'); x.setUTCDate(x.getUTCDate()+n); return x.toISOString().slice(0,10) }
function dowNum(d: string): number { return new Date(d+'T00:00:00Z').getUTCDay() }
function dowName(d: string): string { return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][dowNum(d)] }
function isWeekend(d: string): boolean { const w=dowNum(d); return w===5||w===6 }
function nextServiceDay(): string { const d=new Date(); d.setUTCDate(d.getUTCDate()+1); while(d.getUTCDay()===0) d.setUTCDate(d.getUTCDate()+1); return d.toISOString().slice(0,10) }
function buildCoverDates(start: string, dows: number[]): string[] { const s=new Set(dows),r: string[]=[]; for(let i=0;i<7;i++){const d=addDays(start,i); if(s.has(dowNum(d)))r.push(d)} return r }
function getCadenceWindow(shelf: number|null, date: string) {
  const dow=dowNum(date), ct=(shelf===null||shelf>=4)?'TWICE_WEEKLY':'THREE_TIMES_WEEKLY', slot=CADENCE[ct][dow]
  if(!slot) return null
  return {cadenceType:ct, slotType:slot.type, window:slot.window, coverDates:buildCoverDates(date,slot.cover), secondDay:slot.second_day}
}
function calcConfidence(c: boolean[]): string { const s=c.filter(Boolean).length; return s===6?'high':s>=3?'medium':'low' }
function fmtQty(v: number|null, u: string): string { if(v==null) return '?'; if(u==='g'&&v>=1000) return `${(v/1000).toFixed(1)} kg`; return `${Math.round(v)} ${u||''}`.trim() }
function buildDowAvg(ded: Record<string,any>, days: string[]): Record<string,{avg:number,count:number}> {
  const b: Record<string,{sum:number,count:number}>={}
  for(const d of days){const w=dowNum(d); if(!b[w])b[w]={sum:0,count:0}; b[w].sum+=ded[d]!=null?parseFloat(ded[d]):0; b[w].count++}
  const a: Record<string,{avg:number,count:number}>={}
  for(const [w,v] of Object.entries(b)) a[w]={avg:v.count>0?v.sum/v.count:0,count:v.count}
  return a
}
function calcWindowForecast(covers: string[], avg: Record<string,any>, days: string[], ded: Record<string,any>) {
  const gAvg=days.length>0?days.reduce((s,d)=>s+(ded[d]!=null?parseFloat(ded[d]):0),0)/days.length:0
  let total=0,path: string|null=null,samples=0; const comps: any[]=[]
  for(const date of covers){
    const w=dowNum(date),e=avg[w]; let da: number,p: string,n: number
    if(e&&e.count>=2){da=e.avg;p='dow_match';n=e.count;if(date===covers[0]){path=p;samples=n}}
    else if(isWeekend(date)){const we=days.filter(d=>{const x=dowNum(d);return x===5||x===6});da=we.length>0?we.reduce((s,d)=>s+(ded[d]!=null?parseFloat(ded[d]):0),0)/we.length:gAvg;p='weekend_profile';n=we.length;if(date===covers[0])path=p}
    else{const wd=days.filter(d=>{const x=dowNum(d);return x>=1&&x<=4});da=wd.length>0?wd.reduce((s,d)=>s+(ded[d]!=null?parseFloat(ded[d]):0),0)/wd.length:gAvg;p='weekday_profile';n=wd.length;if(date===covers[0])path=p}
    comps.push({date,day_of_week:dowName(date),forecast_qty:Math.round(da*100)/100,forecast_path:p,sample_count:n}); total+=da
  }
  return {total,buffered:total*BUFFER,components:comps,forecastPath:path,sameWeekdaySamples:samples}
}
function calcStatus(stock: number|null, bf: number|null, net: number|null, slot: string, sd: number|null, sat: number|null, rfm: number|null): string {
  if(stock==null) return 'count_first'
  if(bf==null) return 'no_demand_path'
  if(slot==='shortage') return net!=null&&net>0?'do_first':'looks_ok'
  if(slot==='second_day') return net!=null&&net>0?'prep_today':'looks_ok'
  if(bf===0) return 'looks_ok'
  if(net!=null&&net<=0){
    if(sd!=null&&sat!=null&&rfm!=null) return sat>=rfm?'defer_to_tomorrow':'prep_today'
    return 'looks_ok'
  }
  return 'prep_today'
}
function buildReason(status: string, cq: string, conf: string, fc: number, stock: number|null, covers: string[], unit: string, net: number|null, zu: boolean, rc: boolean): string {
  if(status==='out_of_scope')      return 'gray|Azione operativa — nessuna qty|Operational action — no qty|Acción operativa — sin qty'
  if(status==='count_first')       return 'orange|Conta lo stock e aggiorna|Count stock and update|Cuenta el stock y actualiza'
  if(status==='no_demand_path')    return 'gray|Nessun dato di consumo disponibile|No consumption data available|Sin datos de consumo disponibles'
  if(status==='defer_to_tomorrow') return 'green|Stock OK per oggi — ricontrolla domani|Stock OK today — recheck tomorrow|Stock OK hoy — revisa mañana'
  const sf=fmtQty(stock,unit),ff=fmtQty(fc,unit),dn=covers.length
  let color='gray',it='',en='',es=''
  if(status==='do_first'){
    color='red'
    if(zu){it='Risulta finita — verifica rapidamente prima di produrre';en='Shows as empty — quick check before starting';es='Parece acabada — verifica rápidamente antes de producir'}
    else{it='Finita — prepara prima del servizio';en='Out of stock — prep before service';es='Sin stock — prepara antes del servicio'}
  } else if(status==='prep_today'){
    color='orange';it=`Stock basso — copre meno di ${dn} giorni`;en=`Low stock — covers less than ${dn} days`;es=`Stock bajo — cubre menos de ${dn} días`
  } else {
    color='green';it=`Hai ${sf} — arrivi a ${dn>1?'dopodomani':'domani'}`;en=`You have ${sf} — covered for ${dn} day${dn>1?'s':''}`;es=`Tienes ${sf} — cubierto por ${dn} día${dn>1?'s':''}`
  }
  const cnw=(cq==='missing'||cq==='conflicting')&&net!=null&&net>0
  if(zu&&cnw){const note=cq==='missing'?{it:'batch non configurato',en:'batch not configured',es:'lote no configurado'}:{it:'resa ricetta da correggere',en:'recipe yield to fix',es:'rendimiento de receta a corregir'};it=`Risulta finita — verifica. Fabbisogno stimato: ${ff}; ${note.it}.`;en=`Shows as empty — check first. Est. need: ${ff}; ${note.en}.`;es=`Parece acabada — verifica primero. Necesidad estimada: ${ff}; ${note.es}.`}
  else if(!zu&&cq==='conflicting'){it+=' — definisci il batch';en+=' — define the batch';es+=' — define el lote'}
  else if(!zu&&cq==='missing'&&net!=null&&net>0){color=status==='do_first'?'red':'orange';it=`Fabbisogno stimato: ${ff} — definisci il batch`;en=`Estimated need: ${ff} — define the batch`;es=`Necesidad estimada: ${ff} — define el lote`}
  if(rc){it+=' — verifica stock prima di produrre';en+=' — verify stock before producing';es+=' — verifica stock antes de producir'}
  if(conf==='low'){it+=' — pochi dati, verifica prima di produrre';en+=' — limited data, verify before producing';es+=' — datos limitados, verifica antes de producir'}
  return `${color}|${it}|${en}|${es}`
}

function calcMeatballShadow(
  sugDate: string, histEnd: string, days: string[],
  bagDemandByDate: Record<string,number>,
  stock481: number|null, stock480: number|null,
  src481: string, src480: string,
): Record<string,any> {
  const dowAvg = buildDowAvg(bagDemandByDate, days)
  const cw = getCadenceWindow(7, sugDate)
  const covers = cw ? cw.coverDates : []
  const {total: rf, buffered: bf, components: fcomps, forecastPath} =
    calcWindowForecast(covers, dowAvg, days, bagDemandByDate)
  const forecastBagsRounded = Math.ceil(bf)
  let bagsToAssemble: number|null = null
  let shadowStatus = 'count_finished_bags'
  let blockingReason: string|null = null
  if (stock481 === null) {
    shadowStatus   = 'count_finished_bags'
    blockingReason = 'pt481.current_stock IS NULL — physical count of finished bags required before assembly planning'
  } else {
    bagsToAssemble = Math.max(forecastBagsRounded - stock481, 0)
    if (bagsToAssemble === 0) {
      shadowStatus = 'no_assembly_needed'
    } else if (stock480 === null) {
      shadowStatus   = 'count_loose_meatballs'
      blockingReason = 'pt480.current_stock IS NULL — physical count of cooked meatballs required'
    } else {
      const req = bagsToAssemble * MEATBALLS_PER_BAG
      const short = Math.max(req - stock480, 0)
      if (short > 0) {
        shadowStatus   = 'assembly_blocked_by_meatballs'
        blockingReason = `Need ${req}pz meatballs, have ${stock480}pz (shortage: ${short}pz). Produce at least ${short}pz — scalable, 162 not mandatory.`
      } else {
        shadowStatus = 'ready_to_assemble'
      }
    }
  }
  const meatballsRequired = (bagsToAssemble != null && bagsToAssemble > 0) ? bagsToAssemble * MEATBALLS_PER_BAG : null
  const meatballsShortage = (meatballsRequired != null && stock480 != null) ? Math.max(meatballsRequired - stock480, 0) : null
  const pomodoro_g = (bagsToAssemble != null && bagsToAssemble > 0) ? bagsToAssemble * POMODORO_PER_BAG_G : null
  const demi_g = (bagsToAssemble != null && bagsToAssemble > 0) ? bagsToAssemble * DEMI_PER_BAG_G : null
  const coverDows = covers.map((d: string) => dowNum(d))
  const minSamples = coverDows.reduce((min: number, dw: number) => Math.min(min, (dowAvg[dw]?.count) ?? 0), Infinity)
  const confidence = (isFinite(minSamples) && minSamples >= 2) ? 'medium' : 'low'
  return {
    shadow_status: shadowStatus, blocking_reason: blockingReason,
    forecast_bags: Math.round(bf * 100) / 100,
    bags_to_assemble: bagsToAssemble,
    meatballs_required: meatballsRequired, meatballs_shortage: meatballsShortage,
    pomodoro_required_g: pomodoro_g, demi_required_g: demi_g,
    confidence,
    debug: { cadence_type: cw?.cadenceType, slot_type: cw?.slotType, cover_dates: covers,
      forecast_path: forecastPath, dow_avg: dowAvg, forecast_components: fcomps,
      raw_forecast: Math.round(rf*100)/100, buffered_forecast: Math.round(bf*100)/100,
      buffer_factor: BUFFER, stock_481: stock481, src_481: src481,
      stock_480: stock480, src_480: src480 },
  }
}

const BOT_NAME = 'bot-prep-suggester'
async function finishRun(supa: any, runId: string, status: string, rowsRead: number, rowsWritten: number, warnings: number, errors: number, summary: string, meta: any) {
  const { error: updErr } = await supa.from('bot_runs').update({
    status, rows_read: rowsRead, rows_written: rowsWritten,
    warnings_count: warnings, errors_count: errors,
    summary, finished_at: new Date().toISOString(),
    metadata: { ...meta, version: BOT_VERSION, run_id: runId },
  }).eq('id', runId)
  if (updErr) return { logging_failed: true, logging_error: updErr.message }
  return {}
}

Deno.serve(async (req: Request) => {
  const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type'}
  if(req.method==='OPTIONS') return new Response('ok',{headers:cors})
  const t0=Date.now(), supa=createClient(SUPABASE_URL,SUPABASE_SERVICE_KEY)
  const respond=(b: any,s=200)=>new Response(JSON.stringify(b),{status:s,headers:{...cors,'Content-Type':'application/json'}})
  const body=await req.json().catch(()=>({}))
  const authHeader = req.headers.get('Authorization') || ''
  const isServiceCall = authHeader.includes(SUPABASE_SERVICE_KEY || '')
  const brigadeToken = typeof body.brigade_token === 'string' ? body.brigade_token : null
  if (!isServiceCall) {
    if (!brigadeToken || brigadeToken.length !== 64) {
      return respond({ success: false, error: 'brigade_session_required' }, 401)
    }
    const { data: sessData, error: sessErr } = await supa.rpc('brigade_validate_session', { p_token: brigadeToken })
    if (sessErr || !sessData?.ok) return respond({ success: false, error: 'invalid_or_expired_session' }, 401)
  }
  const { data: flagRow } = await supa.from('feature_flags').select('state')
    .eq('flag_name', 'meatball_assembly_model_enabled').single()
  const meatballFlag: string = flagRow?.state ?? 'off'
  const dryRun=body.dry_run!==false
  const filterIds=Array.isArray(body.prep_task_ids)&&body.prep_task_ids.length>0?body.prep_task_ids.map(Number):null
  const sugDate=(typeof body.suggestion_date==='string'&&body.suggestion_date.match(/^\d{4}-\d{2}-\d{2}$/))?body.suggestion_date:nextServiceDay()
  const runTimestamp = new Date().toISOString()
  const { data: runRow, error: runInsertErr } = await supa.from('bot_runs').insert({
    bot_name: BOT_NAME, run_date: sugDate, status: 'running', started_at: runTimestamp,
    summary: `${BOT_VERSION} starting for suggestion_date=${sugDate}${dryRun?' [dry-run]':''} flag=${meatballFlag}`,
    metadata: { version: BOT_VERSION, dry_run: dryRun, suggestion_date: sugDate, meatball_flag: meatballFlag },
  }).select('id').single()
  const runId = runRow?.id ?? null
  if (runInsertErr || !runId) return respond({ success: false, error: 'Failed bot_runs insert', detail: runInsertErr?.message }, 500)
  try {
    // ── histEnd: latest business_date in pos_daily_clean ─────────────────────
    const {data:lr}=await supa.from('pos_daily_clean').select('business_date').order('business_date',{ascending:false}).limit(1).single()
    const histEnd=lr?.business_date||HISTORY_START

    // ── v18 fix: complete POS service-date set via RPC ────────────────────────
    // get_pos_business_dates(p_start_date, p_end_date) executes
    //   SELECT DISTINCT business_date FROM pos_daily_clean
    //   WHERE business_date BETWEEN p_start AND p_end ORDER BY ASC
    // server-side.  RPC results are never subject to the PostgREST 1,000-row
    // row cap that truncated the v17 raw SELECT.
    const { data: posDateRpc, error: rpcErr } = await supa.rpc('get_pos_business_dates', {
      p_start_date: HISTORY_START,
      p_end_date:   histEnd,
    })
    if (rpcErr) throw new Error(`get_pos_business_dates RPC failed: ${rpcErr.message}`)
    const posDateSet = new Set<string>(
      (posDateRpc || []).map((r: any) => r.business_date as string)
    )
    // Build days[] from RPC-confirmed distinct dates, preserving Sunday exclusion.
    // Genuine zero-demand open days: a date in posDateSet with no stock_deduction
    // for a specific prep still enters days[] and contributes zero to that prep's
    // DOW accumulator, correctly incrementing count.
    const days: string[] = []
    let cur = HISTORY_START
    while (cur <= histEnd) {
      if (dowNum(cur) !== 0 && posDateSet.has(cur)) days.push(cur)
      cur = addDays(cur, 1)
    }
    // ── END v18 fix ───────────────────────────────────────────────────────────

    let ptQ=supa.from('prep_tasks').select('id,name,category,unit,current_stock,min_cover_days,prep_type,recipe_id').eq('archived',false)
    if(filterIds) ptQ=ptQ.in('id',filterIds)
    const {data:pts,error:ptE}=await ptQ; if(ptE) throw new Error(`prep_tasks: ${ptE.message}`)
    const rids=[...new Set((pts as any[]).map((p:any)=>p.recipe_id).filter(Boolean))], slMap: Record<string,any>={}
    for(let i=0;i<rids.length;i+=50){const{data:rs}=await supa.from('recipes').select('id,shelf_life_days').in('id',rids.slice(i,i+50));for(const r of(rs||[]))slMap[r.id]=r.shelf_life_days}
    const now=new Date().toISOString()

    const excludedStatusFilter = EXCLUDED_RECONCILE_STATUSES.join(',')
    const{data:sc}=await supa.from('prep_stock_counts')
      .select('prep_task_id,counted_qty,unit,qty_native,reconciled_qty,reconcile_status,counted_at,expires_at,source')
      .or(`expires_at.is.null,expires_at.gt.${now}`)
      .or(`reconcile_status.is.null,reconcile_status.not.in.(${excludedStatusFilter})`)
      .order('counted_at',{ascending:false})

    const cbt: Record<number,any>={}; for(const c of(sc||[])){if(!cbt[c.prep_task_id])cbt[c.prep_task_id]=c}
    const tids=(pts as any[]).map((p:any)=>p.id), allDed: any[]=[]
    for(let i=0;i<tids.length;i+=50){const{data:d}=await supa.from('stock_deductions').select('prep_task_id,business_date,quantity,unit,source').in('prep_task_id',tids.slice(i,i+50)).gte('business_date',HISTORY_START).lte('business_date',histEnd);if(d)allDed.push(...d)}
    const dbt: Record<number,Record<string,number>>={}
    for(const d of allDed){if(!dbt[d.prep_task_id])dbt[d.prep_task_id]={};dbt[d.prep_task_id][d.business_date]=(dbt[d.prep_task_id][d.business_date]||0)+parseFloat(d.quantity||0)}
    const results: any[]=[],ins: any[]=[]
    for(const pt of (pts as any[])){
      const tid=pt.id
      if(pt.prep_type==='checklist'){results.push({prep_task_id:tid,name:pt.name,status:'out_of_scope',reason:'gray|Azione operativa — nessuna qty|Operational action — no qty|Acción operativa — sin qty'});continue}
      const shelf: number|null=pt.recipe_id?(slMap[pt.recipe_id]??null):null
      const cw=getCadenceWindow(shelf,sugDate)
      let stock: number|null=null,src='none',sunit=pt.unit
      const fc=cbt[tid]
      if(fc){
        let q: number
        if (fc.qty_native != null) {
          q = parseFloat(fc.qty_native)
        } else {
          const rq = parseFloat(fc.counted_qty)
          const cu = (fc.unit || '').toLowerCase().trim()
          const tu = (pt.unit || '').toLowerCase().trim()
          if (cu === 'kg' && tu === 'g') q = rq * 1000
          else if (cu === 'g' && tu === 'kg') q = rq / 1000
          else q = rq
        }
        // CREW-UX 40 — VALUE dal saldo mantenuto; il conteggio resta PROVENIENZA.
        // q sopravvive solo come fallback quando current_stock e' NULL: nessuna
        // semantica nuova sul NULL. src e sunit restano invariati.
        stock=(pt.current_stock!=null)?parseFloat(pt.current_stock):q
        src='prep_stock_counts';sunit=pt.unit
      }
      else if(pt.current_stock!=null){stock=parseFloat(pt.current_stock);src='db_snapshot_unverified';sunit=pt.unit}
      const td: Record<string,number>=dbt[tid]||{},hd=Object.keys(td).length>0
      const ov=CONSTRAINT_OVERRIDES[tid],cq=ov?.quality||'missing',mi=ov?.increment??null
      if(!hd){
        const row={prep_task_id:tid,suggestion_date:sugDate,generated_at:runTimestamp,bot_run_id:runId,history_start_date:HISTORY_START,history_end_date:histEnd,service_days:days.length,same_weekday_samples:0,profile_samples:0,current_stock:stock,stock_source:src,stock_unit:sunit,forecast:null,forecast_unit:pt.unit,demand_source:'none',forecast_path:null,sample_days:0,coverage_days:0,net_requirement:null,planned_output:null,output_unit:pt.unit,production_constraint_quality:cq,minimum_increment:mi,confidence:'low',status:'no_demand_path',reason:'gray|Nessun dato di consumo disponibile|No consumption data available|Sin datos de consumo disponibles',debug_json:{forecast_components:[],demand_path:'no_demand_path',cadence_type:cw?.cadenceType||'unknown'}}
        results.push({name:pt.name,...row});if(!dryRun)ins.push(row);continue
      }
      const da=buildDowAvg(td,days),covers=cw?cw.coverDates:[]
      const{total:rf,buffered:bf,components:fc2,forecastPath:fp,sameWeekdaySamples:sws}=calcWindowForecast(covers,da,days,td)
      let net: number|null=null; if(stock!=null) net=Math.max(bf-stock,0)
      let sat: number|null=null,rfm: number|null=null
      const slot=cw?.slotType||'shortage',sd=cw?.secondDay||null
      if(slot==='first_day'&&sd!=null&&stock!=null){
        const ta=da[dowNum(sugDate)]?.avg||0; sat=Math.max(stock-ta,0)
        const tc=getCadenceWindow(shelf,addDays(sugDate,1))
        if(tc){const{buffered:tb}=calcWindowForecast(tc.coverDates,da,days,td);rfm=tb}
      }
      const zu=stock===0&&src==='db_snapshot_unverified'&&!fc
      const status=calcStatus(stock,bf,net,slot,sd,sat,rfm)
      let po: number|null=null
      if(status!=='defer_to_tomorrow'&&status!=='looks_ok'&&status!=='count_first'&&status!=='no_demand_path'){
        if(net!=null&&net>0){if(cq==='valid_fixed_batch'&&mi)po=Math.ceil(net/mi)*mi;else if(cq==='valid_scalable')po=Math.ceil(net)}
        else po=0
      }
      let flc=false
      const aq=Object.values(td).map(Number),ap=aq.length>0?(aq.reduce((s,v)=>s+v,0)/aq.length)*covers.length:0
      if(po!=null&&po>0&&ap>0&&po>ap*3) flc=true
      const cc: boolean[]=[fp==='dow_match'&&sws>=2,src==='prep_stock_counts'||src==='reconstructed',true,cq==='valid_fixed_batch'||cq==='valid_scalable',true,hd]
      if(src==='db_snapshot_unverified'||src==='none') cc[1]=false
      const conf=(flc||zu||status==='count_first')?'low':calcConfidence(cc)
      let rd: any=null,flagRc=false
      const re=src==='db_snapshot_unverified'&&(status==='prep_today'||status==='do_first')&&po!=null&&po>0&&(cq==='valid_fixed_batch'||cq==='valid_scalable')&&net!=null&&net>0
      if(re){
        const cpb=(cq==='valid_fixed_batch'&&mi)?Math.ceil(net!/mi):Math.ceil(net!)
        const d1=(cq==='valid_fixed_batch'&&mi)?net!-(cpb-1)*mi!:1
        const isSc1=cq==='valid_scalable'&&mi===1
        if(!isSc1||cpb>10){flagRc=true;rd={flag_recount:true,current_planned_batches:cpb,stock_delta_to_drop_one_batch:Math.round(d1*100)/100,stock_delta_to_cancel:Math.round(net!*100)/100,recount_changes_decision:true,unit:pt.unit}}
        else rd={flag_recount:false,reason:'scalable_increment_1_not_significant'}
      } else rd={flag_recount:false}
      const reason=buildReason(status,cq,conf,bf,stock,covers,pt.unit,net,zu,flagRc)
      const dj={cadence_type:cw?.cadenceType,slot_type:slot,window:cw?.window,cover_dates:covers,forecast_components:fc2,raw_forecast:Math.round(rf*100)/100,buffered_forecast:Math.round(bf*100)/100,buffer_factor:BUFFER,required_until_next_window:Math.round(bf*100)/100,stock_detail:{source:src,value:stock,unit:sunit,fresh_count:fc?{counted_qty:fc.counted_qty,unit:fc.unit,qty_native:fc.qty_native,counted_at:fc.counted_at,expires_at:fc.expires_at}:null,db_current_stock:pt.current_stock},defer_detail:sat!=null?{stock_after_today:Math.round(sat*100)/100,req_from_tomorrow:rfm!=null?Math.round(rfm*100)/100:null,can_defer:status==='defer_to_tomorrow'}:null,constraint_detail:{quality:cq,minimum_increment:mi,source:ov?'explicit_override':'default_missing'},net_requirement:net!=null?Math.round(net*100)/100:null,planned_output:po,shelf_life_days:shelf,dow_avg:Object.fromEntries(Object.entries(da).map(([k,v])=>[k,{avg:Math.round(v.avg*100)/100,count:v.count}])),confidence_checks:cc,confidence_score:cc.filter(Boolean).length,sanity_cap_triggered:flc,flag_recount:flagRc,zero_unverified:zu,recount_detail:rd,excluded_count_statuses:EXCLUDED_RECONCILE_STATUSES}
      const row={prep_task_id:tid,suggestion_date:sugDate,generated_at:runTimestamp,bot_run_id:runId,history_start_date:HISTORY_START,history_end_date:histEnd,service_days:days.length,same_weekday_samples:sws,profile_samples:0,current_stock:stock,stock_source:src,stock_unit:sunit,forecast:Math.round(bf*100)/100,forecast_unit:pt.unit,demand_source:'stock_deductions',forecast_path:fp,sample_days:days.length,coverage_days:covers.length,net_requirement:net!=null?Math.round(net*100)/100:null,planned_output:po,output_unit:pt.unit,production_constraint_quality:cq,minimum_increment:mi,confidence:conf,status,reason,debug_json:dj}
      results.push({name:pt.name,...row});if(!dryRun)ins.push(row)
    }
    let wr: any=null
    if(!dryRun&&ins.length>0){const{data:up,error:ue}=await supa.from('prep_suggestions_daily').upsert(ins,{onConflict:'prep_task_id,suggestion_date'}).select('id,prep_task_id,status');if(ue)throw new Error(`upsert: ${ue.message}`);wr={rows_written:up?.length||0}}
    const rowsWritten = dryRun?0:(wr?.rows_written||0)
    let shadowWritten = false
    let shadowStatus: string|null = null
    if (meatballFlag === 'shadow' && !dryRun) {
      const { data: bagDemandRows } = await supa.from('pos_daily_clean').select('business_date, portions_sold').eq('recipe_id', MEATBALL_RECIPE_ID).eq('action', 'map').gte('business_date', HISTORY_START).lte('business_date', histEnd)
      const bagDemandByDate: Record<string,number> = {}
      for (const r of (bagDemandRows || [])) { const d = r.business_date; bagDemandByDate[d] = (bagDemandByDate[d] || 0) + parseFloat(r.portions_sold) }
      const { data: stockRows } = await supa.from('prep_tasks').select('id, current_stock').in('id', [PT481_BAGS, PT480_MEATBALLS])
      const stock481Row = (stockRows || []).find((r: any) => r.id === PT481_BAGS)
      const stock480Row = (stockRows || []).find((r: any) => r.id === PT480_MEATBALLS)
      const stock481: number|null = stock481Row?.current_stock != null ? parseFloat(stock481Row.current_stock) : null
      const stock480: number|null = stock480Row?.current_stock != null ? parseFloat(stock480Row.current_stock) : null
      const src481 = cbt[PT481_BAGS] ? 'prep_stock_counts' : (stock481 != null ? 'db_snapshot_unverified' : 'none')
      const src480 = cbt[PT480_MEATBALLS] ? 'prep_stock_counts' : (stock480 != null ? 'db_snapshot_unverified' : 'none')
      const shadow = calcMeatballShadow(sugDate, histEnd, days, bagDemandByDate, stock481, stock480, src481, src480)
      shadowStatus = shadow.shadow_status
      const shadowRow = { bot_run_id: runId, suggestion_date: sugDate, business_date: histEnd, model_version: 'v1', feature_flag_state: 'shadow', historical_start_date: HISTORY_START, history_end_date: histEnd, service_days: days.length, finished_bag_stock: stock481, finished_bag_stock_source: src481, forecast_bags: shadow.forecast_bags, bags_to_assemble: shadow.bags_to_assemble, loose_meatballs_stock: stock480, meatballs_required: shadow.meatballs_required, meatballs_shortage: shadow.meatballs_shortage, pomodoro_required_g: shadow.pomodoro_required_g, demi_required_g: shadow.demi_required_g, shadow_status: shadow.shadow_status, blocking_reason: shadow.blocking_reason, confidence: shadow.confidence, debug_json: shadow.debug, generated_at: runTimestamp }
      const { error: shadowErr } = await supa.from('meatball_shadow_suggestions').insert(shadowRow)
      if (!shadowErr) { shadowWritten = true } else if (shadowErr.code === '23505') { shadowWritten = true } else { console.warn(`[bot-prep-suggester] shadow write error: ${shadowErr.message}`) }
    }
    const summary = `${BOT_VERSION} suggestion_date=${sugDate}${dryRun?' [dry-run]':''}: ${results.length} processed, ${rowsWritten} written, service_days=${days.length}, flag=${meatballFlag}, shadow=${shadowWritten}`
    const logResult = await finishRun(supa, runId, 'success', results.length, rowsWritten, 0, 0, summary, { dry_run: dryRun, execution_mode: dryRun?'dry_run':'live', suggestion_date: sugDate, history_start: HISTORY_START, history_end: histEnd, service_days: days.length, pos_dates_count: posDateSet.size, meatball_flag: meatballFlag, shadow_written: shadowWritten })
    return respond({success:true,run_id:runId,dry_run:dryRun,suggestion_date:sugDate,processed:results.length,written:rowsWritten,service_days:days.length,pos_dates_count:posDateSet.size,elapsed_ms:Date.now()-t0,meatball_flag:meatballFlag,shadow_written:shadowWritten,shadow_status:shadowStatus,...logResult,_debug_days:days})
  } catch(err: any){
    console.error('[bot-prep-suggester] ERROR:',err)
    const logResult = await finishRun(supa, runId, 'failed', 0, 0, 0, 1, `${BOT_VERSION} FAILED: ${err.message}`, { dry_run: dryRun, error: err.message })
    return respond({success:false,run_id:runId,error:err.message,...logResult},500)
  }
})
