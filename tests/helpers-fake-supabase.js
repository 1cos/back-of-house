// Supabase finto: un piccolo database in memoria con la catena PostgREST
// che vdaiApprove usa davvero (select/eq/in/not/limit/single, update, insert).
'use strict';
//
// INV15B — opzionale `opts.notNull = { tabella: { colonna: default } }`:
// riproduce un vincolo NOT NULL con default di Postgres. Su insert una
// chiave ASSENTE prende il default, una chiave presente a null fallisce
// con 23502 come in produzione; su update un null esplicito fallisce.
// Senza opts il comportamento e' identico a prima.
function makeSb(db, log, opts) {
  log = log || { updates: [], inserts: [] };
  const notNull = (opts && opts.notNull) || {};
  function violazione(t, payload) {
    const cols = notNull[t] || {};
    for (const c of Object.keys(cols)) {
      if (Object.prototype.hasOwnProperty.call(payload, c) && payload[c] === null) {
        return { code: '23502', message: 'null value in column "' + c + '" of relation "' + t + '" violates not-null constraint' };
      }
    }
    return null;
  }
  function rows(t) { return db[t] || (db[t] = []); }
  // FC04-UX — i filtri su campi JSON ("assunzioni->>tipo") leggono dentro l'oggetto.
  function campo(r, k) {
    if (typeof k === 'string' && k.includes('->>')) {
      const [a, b] = k.split('->>');
      const v = r[a] && r[a][b];
      return v === undefined || v === null ? v : String(v);
    }
    return r[k];
  }
  function apply(t, filters) {
    return rows(t).filter(r => filters.every(f => {
      if (f.op === 'eq')  return campo(r, f.k) === f.v;
      if (f.op === 'neq') return r[f.k] !== f.v;
      if (f.op === 'in')  return f.v.includes(r[f.k]);
      if (f.op === 'isnull') return r[f.k] === null || r[f.k] === undefined;
      if (f.op === 'notnull') return r[f.k] !== null && r[f.k] !== undefined;
      // INV15 — confronti numerici: la recovery del prezzo usa .gt() per
      // scartare le righe senza prezzo, e un test che non li applica
      // proverebbe il contrario di quello che dice.
      if (f.op === 'gt')  return Number(r[f.k]) >  Number(f.v);
      if (f.op === 'gte') return Number(r[f.k]) >= Number(f.v);
      if (f.op === 'lt')  return Number(r[f.k]) <  Number(f.v);
      if (f.op === 'lte') return Number(r[f.k]) <= Number(f.v);
      return true;
    }));
  }
  function builder(t, mode, payload) {
    const filters = [];
    let limit = null;
    let ordine = null;
    const self = {
      select() { return self; },
      eq(k, v) { filters.push({ op: 'eq', k, v }); return self; },
      neq(k, v) { filters.push({ op: 'neq', k, v }); return self; },
      in(k, v) { filters.push({ op: 'in', k, v }); return self; },
      is(k, v) { if (v === null) filters.push({ op: 'isnull', k }); return self; },
      not(k, _op, v) { if (v === null) filters.push({ op: 'notnull', k }); return self; },
      gt(k, v)  { filters.push({ op: 'gt',  k, v }); return self; },
      gte(k, v) { filters.push({ op: 'gte', k, v }); return self; },
      lt(k, v)  { filters.push({ op: 'lt',  k, v }); return self; },
      lte(k, v) { filters.push({ op: 'lte', k, v }); return self; },
      // INV15 — order() era un no-op. Una query "la piu' recente" che si
      // appoggia a order+limit passerebbe per caso, nell'ordine di
      // inserimento. Adesso ordina davvero: i test diventano piu' severi,
      // non piu' comodi.
      order(k, opts) { if (k) ordine = { k, asc: !(opts && opts.ascending === false) }; return self; },
      range() { return self; },
      limit(n) { limit = n; return self; },
      // XCF-GG — insert(...).select('id').single(): prima l'inserimento non
      // avveniva affatto (single() saltava run()). Ora inserisce e
      // restituisce la riga nuova, come PostgREST.
      async single() { if (mode === 'insert') { run(); const all = rows(t); return { data: { ...all[all.length - 1] }, error: null }; }
        const r = apply(t, filters); return { data: r[0] ? { ...r[0] } : null, error: r.length ? null : { message: 'not found' } }; }, // copia, come PostgREST
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    function run() {
      if (mode === 'select') {
        let r = apply(t, filters);
        if (ordine) {
          r = r.slice().sort((a, b) => {
            const av = a[ordine.k], bv = b[ordine.k];
            if (av === bv) return 0;
            if (av === null || av === undefined) return 1;
            if (bv === null || bv === undefined) return -1;
            return (av < bv ? -1 : 1) * (ordine.asc ? 1 : -1);
          });
        }
        if (limit) r = r.slice(0, limit);
        return { data: r.map(x => ({ ...x })), error: null };
      }
      if (mode === 'update') {
        const v = violazione(t, payload || {});
        if (v) { log.updates.push({ table: t, rejected: true, patch: { ...payload } }); return { data: null, error: v }; }
        const hit = apply(t, filters);
        for (const r of hit) Object.assign(r, payload);
        log.updates.push({ table: t, filters: filters.map(f => f.k + (f.op === 'eq' ? '=' + f.v : '')), patch: { ...payload }, n: hit.length });
        return { data: hit.map(x => ({ ...x })), error: null };
      }
      if (mode === 'insert') {
        const arr = Array.isArray(payload) ? payload : [payload];
        for (const r of arr) { const v = violazione(t, r); if (v) { log.inserts.push({ table: t, rejected: true, rows: [{ ...r }] }); return { data: null, error: v }; } }
        const cols = notNull[t] || {};
        for (const r of arr) {
          const def = {};
          for (const c of Object.keys(cols)) if (!Object.prototype.hasOwnProperty.call(r, c)) def[c] = cols[c];
          rows(t).push({ id: 'new-' + (rows(t).length + 1), ...def, ...r });
        }
        log.inserts.push({ table: t, rows: arr.map(x => ({ ...x })) });
        return { data: arr, error: null };
      }
      return { data: [], error: null };
    }
    return self;
  }
  const sb = {
    from(t) {
      return {
        select: (...a) => builder(t, 'select').select(...a),
        update: (d) => builder(t, 'update', d),
        insert: (d) => builder(t, 'insert', d),
        upsert: (d) => builder(t, 'insert', d),
      };
    },
    _db: db, _log: log,
  };
  return sb;
}
module.exports = { makeSb };
