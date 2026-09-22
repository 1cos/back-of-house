// Supabase finto: un piccolo database in memoria con la catena PostgREST
// che vdaiApprove usa davvero (select/eq/in/not/limit/single, update, insert).
'use strict';
function makeSb(db, log) {
  log = log || { updates: [], inserts: [] };
  function rows(t) { return db[t] || (db[t] = []); }
  function apply(t, filters) {
    return rows(t).filter(r => filters.every(f => {
      if (f.op === 'eq')  return r[f.k] === f.v;
      if (f.op === 'neq') return r[f.k] !== f.v;
      if (f.op === 'in')  return f.v.includes(r[f.k]);
      if (f.op === 'isnull') return r[f.k] === null || r[f.k] === undefined;
      if (f.op === 'notnull') return r[f.k] !== null && r[f.k] !== undefined;
      return true;
    }));
  }
  function builder(t, mode, payload) {
    const filters = [];
    let limit = null;
    const self = {
      select() { return self; },
      eq(k, v) { filters.push({ op: 'eq', k, v }); return self; },
      neq(k, v) { filters.push({ op: 'neq', k, v }); return self; },
      in(k, v) { filters.push({ op: 'in', k, v }); return self; },
      is(k, v) { if (v === null) filters.push({ op: 'isnull', k }); return self; },
      not(k, _op, v) { if (v === null) filters.push({ op: 'notnull', k }); return self; },
      order() { return self; },
      range() { return self; },
      limit(n) { limit = n; return self; },
      async single() { const r = apply(t, filters); return { data: r[0] || null, error: r.length ? null : { message: 'not found' } }; },
      then(res, rej) { return Promise.resolve(run()).then(res, rej); },
    };
    function run() {
      if (mode === 'select') { let r = apply(t, filters); if (limit) r = r.slice(0, limit); return { data: r.map(x => ({ ...x })), error: null }; }
      if (mode === 'update') {
        const hit = apply(t, filters);
        for (const r of hit) Object.assign(r, payload);
        log.updates.push({ table: t, filters: filters.map(f => f.k + (f.op === 'eq' ? '=' + f.v : '')), patch: { ...payload }, n: hit.length });
        return { data: hit.map(x => ({ ...x })), error: null };
      }
      if (mode === 'insert') {
        const arr = Array.isArray(payload) ? payload : [payload];
        for (const r of arr) rows(t).push({ id: 'new-' + (rows(t).length + 1), ...r });
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
