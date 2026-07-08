import { useState } from "react";

// ── UNIT NORMALIZER (inline — same logic as js/unit-normalizer.js boh-v586) ──
const CONVERSIONS = {
  fl_oz:{base:'ml',factor:29.5735}, cup:{base:'ml',factor:236.588},
  tbsp:{base:'ml',factor:14.7868}, tsp:{base:'ml',factor:4.92892},
  pt:{base:'ml',factor:473.176}, qt:{base:'ml',factor:946.353},
  gal:{base:'ml',factor:3785.41}, l:{base:'ml',factor:1000}, ml:{base:'ml',factor:1},
  g:{base:'g',factor:1}, kg:{base:'g',factor:1000},
  lb:{base:'g',factor:453.592}, oz:{base:'g',factor:28.3495},
  buste:{base:'g',factor:907},
  pz:{base:'each',factor:1}, pezzi:{base:'each',factor:1},
  nests:{base:'nests',factor:1}, each:{base:'each',factor:1},
};
const ALIASES = {
  'lt':'l','liter':'l','liters':'l','litre':'l','litres':'l',
  'gram':'g','grams':'g','gr':'g','kilogram':'kg','kilograms':'kg','kilo':'kg',
  'fl oz':'fl_oz','floz':'fl_oz','fluid oz':'fl_oz','fluid ounce':'fl_oz',
  'pound':'lb','pounds':'lb','lbs':'lb',
  'milliliter':'ml','milliliters':'ml','ounce':'oz','ounces':'oz',
};
function resolveUnit(u){ if(!u) return null; const c=u.toLowerCase().trim(); return ALIASES[c]||(CONVERSIONS[c]?c:null); }
function getUnitType(u){ const c=resolveUnit(u); if(!c) return 'unknown'; const b=CONVERSIONS[c]?.base; if(b==='ml') return 'volume'; if(b==='g') return 'weight'; return 'count'; }
function normalizeQty(qty,unit,density=1.0){ const q=parseFloat(qty); if(isNaN(q)||q<0) return null; const c=resolveUnit(unit); if(!c||!CONVERSIONS[c]) return null; const info=CONVERSIONS[c]; const type=getUnitType(c); if(type==='volume'){const ml=q*info.factor; return{g:parseFloat((ml*density).toFixed(4)),ml:parseFloat(ml.toFixed(4)),type};} if(type==='weight'){const g=q*info.factor; return{g:parseFloat(g.toFixed(4)),ml:parseFloat((g/density).toFixed(4)),type};} return{g:null,ml:null,count:q,type:'count'}; }
function calcPortions(sq,su,pq,pu,density=1.0){ const s=normalizeQty(sq,su,density); const p=normalizeQty(pq,pu,density); if(!s||!p) return null; const sb=s.g??s.ml; const pb=p.g??p.ml; if(!sb||!pb||pb<=0) return null; return{portions:parseFloat((sb/pb).toFixed(2)),sb,pb}; }
function fmtNum(n,dec=2){ if(n==null||isNaN(n)) return '—'; if(n===0) return '0'; if(Math.abs(n)>=1000) return Math.round(n).toLocaleString(); if(Math.abs(n)>=100) return n.toFixed(1); return n.toFixed(dec); }

// ── DATA ──────────────────────────────────────────────────────────────────────
// REGOLA CUCINA CONFERMATA (Max, 8 lug 2026):
// TUTTI i salad dressing = 1 ramekin da 2 US fl oz.
// Source of truth = 2 fl oz. 2 fl oz = 59.147 ml = 59.147 g (density=1.0).
// I vecchi valori DB (74g, 78g) erano dati legacy — non sono più una scelta aperta.
const RULES = [
  { canonical:"Balsamic", confidence:"estimated", uses_60d:151,
    recipe:"BALSAMIC VINAIGRETTE (e834c1e2)", recipe_id:"e834c1e2",
    qty:2, unit:"fl_oz", density:1.0, display_qty:"2 fl oz ramekin",
    normalized_g:59.147, normalized_ml:59.147, usage_mode:"fixed_quantity",
    note:"Regola cucina confermata (Max 8/7/2026). 59.147g per porzione. 151 usi/60gg → ~8.9kg non tracciati. Legacy DB serving_qty=74g superato dalla regola cucina.",
    aliases:["Balsamic","balsamic","BALSAMIC ON SIDE","Extra balsamic","Salad now balsamic dressing"] },
  { canonical:"citronette", confidence:"estimated", uses_60d:195,
    recipe:"CITRONETTE (3f433b8b)", recipe_id:"3f433b8b",
    qty:2, unit:"fl_oz", density:1.0, display_qty:"2 fl oz ramekin",
    normalized_g:59.147, normalized_ml:59.147, usage_mode:"fixed_quantity",
    note:"Regola cucina confermata (Max 8/7/2026). 59.147g per porzione. 195 usi/60gg → ~11.5kg non tracciati. Legacy DB serving_qty=78g superato dalla regola cucina.",
    aliases:["citronette","Citronette","Citronette on side","Add Citronette ots"] },
  { canonical:"Caesar", confidence:"estimated", uses_60d:312,
    recipe:"Caesar Dressing (non in DB)", recipe_id:null,
    qty:2, unit:"fl_oz", density:1.0, display_qty:"2 fl oz ramekin",
    normalized_g:59.147, normalized_ml:59.147, usage_mode:"fixed_quantity",
    pending:"linked_recipe_id — recipe Caesar Dressing non esiste nel DB. Prep_task 'Check Caesar' usa unit=squeezer, non utilizzabile per deduction. Da creare recipe o identificare prep_task corretto prima di Fase 3.",
    note:"QTÀ CONFERMATA: 2 fl oz ramekin = 59.147g (Max 8/7/2026). 312 usi/60gg → ~18.5kg non tracciati.",
    aliases:["Caesar","caesar","Caesar dressing","Extra side of Caesar dressing"] },
  { canonical:"Ranch", confidence:"estimated", uses_60d:86,
    recipe:"Ranch Dressing (3cee627c)", recipe_id:"3cee627c",
    qty:2, unit:"fl_oz", density:1.0, display_qty:"2 fl oz ramekin",
    normalized_g:59.147, normalized_ml:59.147, usage_mode:"fixed_quantity",
    note:"Regola cucina confermata (Max 8/7/2026). 59.147g per porzione. 86 usi/60gg → ~5.1kg non tracciati. Legacy DB serving_qty=74g superato dalla regola cucina.",
    aliases:["Ranch","ranch"] },
];
const UNIT_OPTIONS = ["g","kg","ml","l","fl_oz","lb","oz","cup","qt","gal","pt","buste"];

// ── COMPONENTS ────────────────────────────────────────────────────────────────
function Badge({text,color="#6b7280",bg="#f1f5f9",border="#e2e8f0",size=11}){
  return <span style={{background:bg,color,border:`1px solid ${border}`,borderRadius:8,padding:"2px 9px",fontSize:size,fontWeight:700,display:"inline-block"}}>{text}</span>;
}
function ConfBadge({level}){
  const m={confirmed:["✅ CONFIRMED","#059669","#f0fdf4","#bbf7d0"],estimated:["🟡 ESTIMATED","#d97706","#fffbeb","#fde68a"],review:["🔴 REVIEW","#dc2626","#fef2f2","#fca5a5"]};
  const [label,color,bg,border]=m[level]||m.review;
  return <Badge text={label} color={color} bg={bg} border={border}/>;
}

function RuleCard({rule}){
  const [open,setOpen]=useState(false);
  const norm2floz = rule.normalized_ml ? rule.normalized_ml/29.5735 : null;
  const dep60 = rule.normalized_g ? rule.uses_60d*rule.normalized_g/1000 : null;
  return (
    <div style={{border:"1.5px solid #fde68a",borderRadius:14,overflow:"hidden",marginBottom:12}}>
      <div onClick={()=>setOpen(!open)} style={{padding:"12px 16px",cursor:"pointer",display:"flex",alignItems:"center",gap:10,background:"#fffbeb"}}>
        <div style={{flex:1}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:3}}>
            <span style={{fontWeight:800,fontSize:15,color:"#1e3a5f"}}>{rule.canonical}</span>
            <ConfBadge level={rule.confidence}/>
            {!rule.recipe_id && <Badge text="⚠️ RECIPE LINK PENDING" color="#d97706" bg="#fffbeb" border="#fde68a"/>}
          </div>
          <span style={{fontSize:11,color:"#6b7280"}}>
            {rule.uses_60d} usi/60gg · <b>{rule.display_qty}</b> · bot: <b>{fmtNum(rule.normalized_g)}g / {fmtNum(rule.normalized_ml)}ml</b>
            {dep60 ? ` → ~${fmtNum(dep60,1)}kg non tracciati/60gg` : ""}
          </span>
        </div>
        <span style={{fontSize:16,color:"#94a3b8"}}>{open?"▲":"▼"}</span>
      </div>
      {open && (
        <div style={{padding:"16px",background:"white",borderTop:"0.5px solid #f1f5f9"}}>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12,marginBottom:12}}>
            {/* Chef */}
            <div style={{background:"#f5f3ff",border:"1.5px solid #c4b5fd",borderRadius:12,padding:12}}>
              <div style={{fontSize:11,fontWeight:700,color:"#5b21b6",marginBottom:8,textTransform:"uppercase"}}>👨‍🍳 Chef / Server</div>
              {[["Display qty",rule.display_qty],["Misura",`${rule.qty} ${rule.unit}`],["Recipe",rule.recipe],["Usage",rule.usage_mode]].map(([k,v])=>(
                <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"0.5px solid #ede9fe",fontSize:12}}>
                  <span style={{color:"#64748b"}}>{k}</span><span style={{fontWeight:700,color:"#5b21b6",textAlign:"right",maxWidth:"60%"}}>{v}</span>
                </div>
              ))}
            </div>
            {/* Bot */}
            <div style={{background:"#f0fdf4",border:"1.5px solid #bbf7d0",borderRadius:12,padding:12}}>
              <div style={{fontSize:11,fontWeight:700,color:"#166534",marginBottom:8,textTransform:"uppercase"}}>🤖 Bot (normalizzato)</div>
              {[
                ["normalized_g", fmtNum(rule.normalized_g)+" g"],
                ["normalized_ml", fmtNum(rule.normalized_ml)+" ml"],
                ["in fl oz", norm2floz ? fmtNum(norm2floz,2)+" fl oz" : "—"],
                ["density", rule.density+" g/ml"],
              ].map(([k,v])=>(
                <div key={k} style={{display:"flex",justifyContent:"space-between",padding:"4px 0",borderBottom:"0.5px solid #dcfce7",fontSize:12}}>
                  <span style={{color:"#64748b",fontFamily:"monospace"}}>{k}</span><span style={{fontWeight:700,color:"#166534"}}>{v}</span>
                </div>
              ))}
            </div>
          </div>
          {/* Pending link (Caesar only) */}
          {rule.pending && (
            <div style={{background:"#fffbeb",border:"1px solid #fde68a",borderRadius:10,padding:"10px 14px",marginBottom:10}}>
              <div style={{fontSize:11,fontWeight:700,color:"#92400e",marginBottom:4}}>⏳ PENDING — Recipe link da completare prima di Fase 3</div>
              <div style={{fontSize:12,color:"#1e3a5f"}}>{rule.pending}</div>
            </div>
          )}
          <div style={{fontSize:11,color:"#64748b",background:"#f8fafc",borderRadius:8,padding:"7px 10px"}}>{rule.note}</div>
        </div>
      )}
    </div>
  );
}

function InventoryCalc(){
  const [stockQty,setStockQty]=useState("5");
  const [stockUnit,setStockUnit]=useState("kg");
  const [dressing,setDressing]=useState("Balsamic");
  const [customPQty,setCustomPQty]=useState("");
  const [customPUnit,setCustomPUnit]=useState("fl_oz");

  const rule=RULES.find(r=>r.canonical===dressing);
  const pQty=parseFloat(customPQty)||rule?.qty||2;
  const pUnit=customPQty?customPUnit:(rule?.unit||"fl_oz");
  const density=rule?.density||1.0;

  const sN=normalizeQty(parseFloat(stockQty)||0,stockUnit,density);
  const pN=normalizeQty(pQty,pUnit,density);
  const bN=normalizeQty(2,"l",density);
  const ramekins=calcPortions(parseFloat(stockQty)||0,stockUnit,pQty,pUnit,density);
  const batches=calcPortions(parseFloat(stockQty)||0,stockUnit,2,"l",density);

  return (
    <div style={{background:"white",borderRadius:16,padding:"18px 20px",border:"1.5px solid #e2e8f0"}}>
      <div style={{fontSize:14,fontWeight:700,color:"#1e3a5f",marginBottom:14}}>🧮 Inventory Calculator — Nessuna domanda al cuoco</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:10,marginBottom:16}}>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:"#64748b",marginBottom:6,textTransform:"uppercase"}}>Stock (cuoco pesa)</div>
          <div style={{display:"flex",gap:6}}>
            <input type="number" min="0" value={stockQty} onChange={e=>setStockQty(e.target.value)}
              style={{flex:1,border:"1.5px solid #c4b5fd",borderRadius:8,padding:"8px 10px",fontSize:16,fontWeight:700,color:"#5b21b6"}}/>
            <select value={stockUnit} onChange={e=>setStockUnit(e.target.value)}
              style={{border:"1.5px solid #c4b5fd",borderRadius:8,padding:"8px",fontSize:13,color:"#5b21b6",background:"#f5f3ff"}}>
              {UNIT_OPTIONS.map(u=><option key={u}>{u}</option>)}
            </select>
          </div>
          <div style={{fontSize:10,color:"#94a3b8",marginTop:3}}>qualunque unità — la app converte</div>
        </div>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:"#64748b",marginBottom:6,textTransform:"uppercase"}}>Dressing</div>
          <select value={dressing} onChange={e=>setDressing(e.target.value)}
            style={{width:"100%",border:"1.5px solid #e2e8f0",borderRadius:8,padding:"9px",fontSize:13,background:"white"}}>
            {RULES.map(r=><option key={r.canonical}>{r.canonical}</option>)}
          </select>
          {rule && <div style={{fontSize:10,color:"#94a3b8",marginTop:3}}>{rule.display_qty}</div>}
        </div>
        <div>
          <div style={{fontSize:11,fontWeight:700,color:"#64748b",marginBottom:6,textTransform:"uppercase"}}>Qty/ramekin (override)</div>
          <div style={{display:"flex",gap:6}}>
            <input type="number" min="0" value={customPQty} onChange={e=>setCustomPQty(e.target.value)}
              placeholder={String(rule?.qty||"")}
              style={{flex:1,border:"1.5px solid #e2e8f0",borderRadius:8,padding:"8px",fontSize:13}}/>
            <select value={customPUnit} onChange={e=>setCustomPUnit(e.target.value)}
              style={{border:"1.5px solid #e2e8f0",borderRadius:8,padding:"8px",fontSize:12,background:"white"}}>
              {UNIT_OPTIONS.map(u=><option key={u}>{u}</option>)}
            </select>
          </div>
          <div style={{fontSize:10,color:"#94a3b8",marginTop:3}}>default: {rule?.qty} {rule?.unit}</div>
        </div>
      </div>

      {/* Normalization display */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:8,marginBottom:12}}>
        {[
          {label:"Stock normalizzato",norm:sN},
          {label:`Porzione (${pQty} ${pUnit})`,norm:pN},
          {label:"Batch (2 LT)",norm:bN},
        ].map((item,i)=>(
          <div key={i} style={{background:"#f8fafc",borderRadius:10,padding:"10px 12px",border:"1px solid #e2e8f0",textAlign:"center"}}>
            <div style={{fontSize:10,color:"#94a3b8",marginBottom:4}}>{item.label}</div>
            <div style={{fontSize:16,fontWeight:800,color:"#1e3a5f"}}>{item.norm?.g!=null?`${fmtNum(item.norm.g)}g`:"—"}</div>
            <div style={{fontSize:11,color:"#64748b"}}>{item.norm?.ml!=null?`${fmtNum(item.norm.ml)} ml`:""}</div>
          </div>
        ))}
      </div>

      {/* Results */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:12}}>
        <div style={{background:ramekins?"#f0fdf4":"#fef2f2",border:`1.5px solid ${ramekins?"#bbf7d0":"#fca5a5"}`,borderRadius:12,padding:"16px",textAlign:"center"}}>
          <div style={{fontSize:11,fontWeight:700,color:ramekins?"#166534":"#991b1b",marginBottom:4}}>Ramekin disponibili</div>
          <div style={{fontSize:36,fontWeight:900,color:ramekins?"#059669":"#dc2626"}}>{ramekins?`~${fmtNum(ramekins.portions,1)}`:"—"}</div>
          <div style={{fontSize:11,color:"#6b7280",marginTop:4}}>{ramekins?`${fmtNum(ramekins.sb)}g ÷ ${fmtNum(ramekins.pb)}g`:"controlla unità"}</div>
        </div>
        <div style={{background:batches?"#eff6ff":"#fef2f2",border:`1.5px solid ${batches?"#93c5fd":"#fca5a5"}`,borderRadius:12,padding:"16px",textAlign:"center"}}>
          <div style={{fontSize:11,fontWeight:700,color:batches?"#1e40af":"#991b1b",marginBottom:4}}>Batch da 2 LT</div>
          <div style={{fontSize:36,fontWeight:900,color:batches?"#2563eb":"#dc2626"}}>{batches?`${fmtNum(batches.portions,2)}`:"—"}</div>
          <div style={{fontSize:11,color:"#6b7280",marginTop:4}}>{batches?`${fmtNum(batches.sb)}g ÷ 2000g`:""}</div>
        </div>
      </div>

      {sN && pN && ramekins && (
        <div style={{background:"#f8fafc",borderRadius:8,padding:"10px 14px",fontSize:11,color:"#374151",lineHeight:1.7,border:"1px solid #e2e8f0"}}>
          <b>Formula:</b> {stockQty} {stockUnit} → {fmtNum(sN.g)}g ÷ {fmtNum(pN.g||pN.ml)}g per ramekin = <b style={{color:"#059669"}}>{fmtNum(ramekins.portions,1)} ramekin</b>
          {batches && <span> · ÷ 2000g/batch = <b style={{color:"#2563eb"}}>{fmtNum(batches.portions,2)} batch</b></span>}
          <br/><span style={{color:"#94a3b8"}}>Density: {density} g/ml · js/unit-normalizer.js boh-v586</span>
        </div>
      )}
    </div>
  );
}

export default function App(){
  const [tab,setTab]=useState("calc");
  const tabs=[{id:"calc",label:"🧮 Inventory Calc"},{id:"rules",label:"📋 Modifier Rules"},{id:"engine",label:"⚙️ Normalizer"}];

  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(160deg,#f5f3ff 0%,#ede9fe 50%,#dbeafe 100%)",fontFamily:"Inter,system-ui,sans-serif",padding:"16px"}}>
      <div style={{maxWidth:860,margin:"0 auto"}}>
        <div style={{background:"rgba(255,255,255,0.9)",borderRadius:18,padding:"16px 20px",marginBottom:14,border:"1.5px solid rgba(124,58,237,0.12)"}}>
          <div style={{fontSize:11,fontWeight:700,color:"#7c3aed",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:2}}>Brigade · Phase 2.2 · boh-v587</div>
          <div style={{fontSize:20,fontWeight:800,color:"#1e3a5f",marginBottom:4}}>🫗 Modifier Depletion Lab v2 — Unit Normalizer</div>
          <div style={{fontSize:12,color:"#64748b"}}>js/unit-normalizer.js live · 11/11 acceptance tests pass · Solo lab — nessun bot cambia</div>
        </div>

        {/* Kitchen rule confirmed banner */}
        <div style={{background:"#1e3a5f",borderRadius:14,padding:"12px 16px",marginBottom:14,display:"flex",gap:12,alignItems:"flex-start"}}>
          <span style={{fontSize:22,flexShrink:0}}>✅</span>
          <div style={{fontSize:13,color:"#e2e8f0",lineHeight:1.5}}>
            <b style={{color:"white"}}>Regola cucina confermata (Max, 8 lug 2026):</b> TUTTI i salad dressing = 1 ramekin da 2 fl oz.
            <br/>Source of truth: 2 fl oz = 59.147g · La app normalizza. Zero domande al cuoco.
            <br/><span style={{color:"#94a3b8",fontSize:11}}>I vecchi valori DB (74g Balsamic/Ranch, 78g Citronette) sono legacy — non più valori competing.</span>
          </div>
        </div>

        <div style={{display:"flex",gap:0,marginBottom:16,borderRadius:12,overflow:"hidden",border:"1.5px solid #e2e8f0",background:"#f8fafc"}}>
          {tabs.map(t=>(
            <button key={t.id} onClick={()=>setTab(t.id)} style={{flex:1,padding:"10px 6px",fontSize:13,fontWeight:tab===t.id?700:500,background:tab===t.id?"#1e3a5f":"transparent",color:tab===t.id?"white":"#94a3b8",border:"none",cursor:"pointer"}}>
              {t.label}
            </button>
          ))}
        </div>

        {tab==="calc" && (
          <div>
            <InventoryCalc/>
            <div style={{marginTop:14,background:"white",borderRadius:14,padding:"14px 18px",border:"1px solid #e2e8f0"}}>
              <div style={{fontSize:13,fontWeight:700,color:"#1e3a5f",marginBottom:10}}>✅ Acceptance criteria — 11/11 pass</div>
              <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(180px,1fr))",gap:8}}>
                {[["2 fl_oz","→ 59.15g · 59.15ml"],["5 kg","→ 5000g · 5000ml"],["2 L (o lt)","→ 2000ml · 2000g"],["5000g ÷ 2fl oz","→ ~84.5 ramekin"],["5000g ÷ 2LT","→ 2.5 batch"],["2fl_oz density=1.03","→ 60.92g"]].map(([a,b])=>(
                  <div key={a} style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:10,padding:"8px 12px",fontSize:12}}>
                    <div style={{fontWeight:700,color:"#1e3a5f"}}>{a}</div>
                    <div style={{color:"#059669",fontWeight:600,marginTop:2}}>{b}</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {tab==="rules" && (
          <div>
            <div style={{background:"#f0fdf4",border:"1px solid #bbf7d0",borderRadius:12,padding:"10px 16px",marginBottom:14,fontSize:12,color:"#166534"}}>
              ✅ Regola cucina applicata: tutti i dressing = <b>2 fl oz ramekin = 59.147g</b> · <b>active=false</b> · <b>confidence=estimated</b> · Nessun bot production change.
            </div>
            {RULES.map((rule,i)=><RuleCard key={i} rule={rule}/>)}
          </div>
        )}

        {tab==="engine" && (
          <div style={{background:"white",borderRadius:16,padding:"18px 20px",border:"1.5px solid #e2e8f0"}}>
            <div style={{fontSize:14,fontWeight:700,color:"#1e3a5f",marginBottom:12}}>⚙️ js/unit-normalizer.js — API pubblica</div>
            <div style={{background:"#0f172a",borderRadius:12,padding:"14px 16px",fontFamily:"monospace",fontSize:12,color:"#94a3b8",lineHeight:1.9,overflowX:"auto",marginBottom:16}}>
              <span style={{color:"#7c3aed"}}>// Exports (boh-v586)</span>{"\n"}
              <span style={{color:"#22d3ee"}}>normalizeQty</span>(qty, unit, density=1.0){"\n"}
              {"  → {normalized_g, normalized_ml, display_g, display_ml, unit_type, density}"}{"\n\n"}
              <span style={{color:"#22d3ee"}}>calcPortions</span>(stockQty, stockUnit, portionQty, portionUnit, density){"\n"}
              {"  → {portions, sb (stock base), pb (portion base)}"}{"\n\n"}
              <span style={{color:"#22d3ee"}}>calcBatches</span>(stockQty, stockUnit, batchQty, batchUnit){"\n"}
              <span style={{color:"#22d3ee"}}>convertQty</span>(qty, from, to, density){"\n"}
              <span style={{color:"#22d3ee"}}>formatQty</span>(value, unit) <span style={{color:"#64748b"}}>// auto: 5000g→"5 kg", 2000ml→"2 L"</span>{"\n"}
              <span style={{color:"#22d3ee"}}>buildModifierRule</span>(canonical, qty, unit, display, density, usage_mode, recipe_id){"\n"}
              <span style={{color:"#22d3ee"}}>resolveUnit</span>(unit)        <span style={{color:"#64748b"}}>// "fl oz" → "fl_oz", "lt" → "l"</span>{"\n"}
              <span style={{color:"#22d3ee"}}>loadConversionsFromDB</span>(supa) <span style={{color:"#64748b"}}>// optional override, static fallback always available</span>
            </div>
            <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
              <thead><tr style={{background:"#f8fafc"}}>
                {["Unità","→ ml","→ g (density=1)","Tipo","Alias accettati"].map(h=><th key={h} style={{padding:"6px 10px",textAlign:"left",fontWeight:700,color:"#64748b",borderBottom:"2px solid #e2e8f0"}}>{h}</th>)}
              </tr></thead>
              <tbody>
                {[
                  ["fl_oz","29.57","29.57g","volume","fl oz, fluid oz, floz"],
                  ["cup","236.59","236.59g","volume",""],
                  ["l","1000","1000g","volume","lt, liter, litres"],
                  ["ml","1","1.0g","volume","milliliter"],
                  ["g","1ml","1g","weight","gram, grams, gr"],
                  ["kg","1000ml","1000g","weight","kilo, kilogram"],
                  ["lb","453.6ml","453.6g","weight","pound, pounds, lbs"],
                  ["oz","28.35ml","28.35g","weight","ounce (PESO, ≠ fl oz)"],
                  ["buste","907ml","907g","weight","Spring Mix bag — DB"],
                  ["pz/each","—","—","count","pezzi, each"],
                  ["nests","—","—","count","nests"],
                ].map(([unit,ml,g,type,alias],i)=>(
                  <tr key={i} style={{background:i%2?"#f8fafc":"white",borderBottom:"0.5px solid #f1f5f9"}}>
                    <td style={{padding:"5px 10px",fontFamily:"monospace",fontWeight:700,color:"#7c3aed"}}>{unit}</td>
                    <td style={{padding:"5px 10px",color:"#2563eb"}}>{ml}</td>
                    <td style={{padding:"5px 10px",color:"#059669"}}>{g}</td>
                    <td style={{padding:"5px 10px"}}>
                      <span style={{background:type==="volume"?"#eff6ff":type==="weight"?"#f0fdf4":"#f8fafc",color:type==="volume"?"#2563eb":type==="weight"?"#059669":"#6b7280",borderRadius:4,padding:"1px 6px",fontSize:10,fontWeight:600}}>{type}</span>
                    </td>
                    <td style={{padding:"5px 10px",color:"#94a3b8",fontSize:11}}>{alias}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
