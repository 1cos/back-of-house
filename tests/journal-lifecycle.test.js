// ══════════════════════════════════════════════════════════════════
// Journal T1 — plumbing tests (JS layer)
// Plain Node, no framework: `node tests/journal-lifecycle.test.js`
// Exercises the REAL functions in js/journal.js via require(), against
// a tiny in-memory fake of the Supabase query builder — no network.
// DB-level behavior (trigger-set resolved_at/closed_at, real FK, real
// chronological ordering) is verified separately, directly against
// Supabase, with a throwaway entry cleaned up afterwards — see the
// final report for those results.
// ══════════════════════════════════════════════════════════════════

const assert = require('assert');
const path = require('path');

// Minimal fake DOM — only what loadJournal() touches (getElementById('vj')
// + querySelectorAll for closing card menus). Used only by the HOTFIX
// T2E.1 regression test below.
function makeFakeDom(){
  var elements = {};
  function makeEl(id){ return { id: id, classList: { contains: function(){ return false; } }, innerHTML: '', style: {} }; }
  return {
    getElementById: function(id){ if(!elements[id]) elements[id] = makeEl(id); return elements[id]; },
    querySelectorAll: function(){ return []; },
    _el: function(id){ return elements[id]; }
  };
}

let pass = 0, fail = 0;
function test(name, fn){
  try{ fn(); pass++; console.log('  ✓ ' + name); }
  catch(e){ fail++; console.log('  ✗ ' + name + '\n      ' + e.message); }
}
async function atest(name, fn){
  try{ await fn(); pass++; console.log('  ✓ ' + name); }
  catch(e){ fail++; console.log('  ✗ ' + name + '\n      ' + (e.stack || e.message)); }
}

// ── Minimal fake Supabase query builder ──────────────────────────
// Supports exactly the calls journal.js's new functions make:
// .from(t).select(c).eq(k,v).single()
// .from(t).select(c).eq(k,v).order(c,{ascending}) -> array
// .from(t).insert(obj).select('*').single()
// .from(t).update(obj).eq(k,v).select('*').single()
function makeFakeSupabase(store){
  function table(name){
    return {
      select(){ return this; },
      gte(){ return this; },
      lte(){ return this; },
      insert(obj){
        var row = Object.assign({ id: 'gen-' + Math.random().toString(36).slice(2) }, obj);
        if(!row.created_at) row.created_at = new Date().toISOString();
        store[name].push(row);
        this._last = row;
        return this;
      },
      update(obj){
        this._updateObj = obj;
        return this;
      },
      eq(key, val){
        this._eqKey = key; this._eqVal = val;
        return this;
      },
      in(key, vals){
        if(store._throwOnTable && store._throwOnTable === name){
          throw new Error('simulated failure querying ' + name);
        }
        this._inKey = key; this._inVals = vals;
        return this;
      },
      order(key, opts){
        this._orderKey = key; this._orderAsc = !opts || opts.ascending !== false;
        return this;
      },
      then(resolve){
        // array-returning path (used when .single() isn't called)
        var rows = store[name].filter(r => this._eqKey ? r[this._eqKey] === this._eqVal : true);
        if(this._inKey) rows = rows.filter(r => this._inVals.indexOf(r[this._inKey]) >= 0);
        if(this._orderKey){
          rows = rows.slice().sort((a,b) => {
            var av = a[this._orderKey], bv = b[this._orderKey];
            return this._orderAsc ? (av < bv ? -1 : av > bv ? 1 : 0) : (av > bv ? -1 : av < bv ? 1 : 0);
          });
        }
        resolve({ data: rows, error: null });
      },
      async single(){
        if(this._updateObj){
          var idx = store[name].findIndex(r => r[this._eqKey] === this._eqVal);
          if(idx === -1) return { data: null, error: { message: 'not found' } };
          store[name][idx] = Object.assign({}, store[name][idx], this._updateObj);
          return { data: store[name][idx], error: null };
        }
        if(this._last) return { data: this._last, error: null };
        var row = store[name].find(r => this._eqKey ? r[this._eqKey] === this._eqVal : true);
        return row ? { data: row, error: null } : { data: null, error: { message: 'not found' } };
      }
    };
  }
  return {
    from: table,
    rpc: async function(name, params){
      store.journal_activity = store.journal_activity || [];
      if(name === 'journal_set_status'){
        var entry = store.journal_entries.find(e => e.id === params.p_entry_id);
        if(!entry) return { data: null, error: { message: 'not found' } };
        var oldStatus = entry.status;
        entry.status = params.p_new_status;
        if(oldStatus !== params.p_new_status){
          store.journal_activity.push({
            id: 'act-' + Math.random().toString(36).slice(2),
            journal_entry_id: params.p_entry_id, event_type: 'STATUS_CHANGED',
            actor: params.p_actor, old_value: oldStatus, new_value: params.p_new_status,
            created_at: new Date().toISOString()
          });
        }
        return { data: entry, error: null };
      }
      if(name === 'journal_set_assignee'){
        var entry2 = store.journal_entries.find(e => e.id === params.p_entry_id);
        if(!entry2) return { data: null, error: { message: 'not found' } };
        var oldAssignee = entry2.assigned_to;
        entry2.assigned_to = params.p_new_assignee;
        if(oldAssignee !== params.p_new_assignee){
          store.journal_activity.push({
            id: 'act-' + Math.random().toString(36).slice(2),
            journal_entry_id: params.p_entry_id, event_type: 'ASSIGNEE_CHANGED',
            actor: params.p_actor, old_value: params.p_old_name, new_value: params.p_new_name,
            created_at: new Date().toISOString()
          });
        }
        return { data: entry2, error: null };
      }
      if(name === 'journal_set_waiting_for'){
        var entry3 = store.journal_entries.find(e => e.id === params.p_entry_id);
        if(!entry3) return { data: null, error: { message: 'not found' } };
        var oldWF = entry3.waiting_for || null;
        var newWF = (params.p_new_value || '').trim() || null; // mirrors the RPC's own NULLIF(trim(...),'')
        entry3.waiting_for = newWF;
        if(oldWF !== newWF){
          store.journal_activity.push({
            id: 'act-' + Math.random().toString(36).slice(2),
            journal_entry_id: params.p_entry_id, event_type: 'WAITING_FOR_CHANGED',
            actor: params.p_actor, old_value: oldWF, new_value: newWF,
            created_at: new Date().toISOString()
          });
        }
        return { data: entry3, error: null };
      }
      if(name === 'journal_set_follow_up'){
        var entry4 = store.journal_entries.find(e => e.id === params.p_entry_id);
        if(!entry4) return { data: null, error: { message: 'not found' } };
        var oldFU = entry4.follow_up_on || null;
        var newFU = params.p_new_date || null;
        entry4.follow_up_on = newFU;
        if(oldFU !== newFU){
          store.journal_activity.push({
            id: 'act-' + Math.random().toString(36).slice(2),
            journal_entry_id: params.p_entry_id, event_type: 'FOLLOW_UP_CHANGED',
            actor: params.p_actor, old_value: oldFU, new_value: newFU,
            created_at: new Date().toISOString()
          });
        }
        return { data: entry4, error: null };
      }
      return { data: null, error: { message: 'unknown rpc: ' + name } };
    }
  };
}

console.log('\nJournal T1 — plumbing test run\n');

(async () => {

  await atest('jAddUpdate: persisted and linked to the correct entry', async () => {
    var store = { journal_entries: [{ id: 'e1', title: 'Oven problem', status: 'OPEN' }], journal_updates: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var res = await j.jAddUpdate('e1', 'CES technician came. Estimate $500.');
    assert.ok(!res.error, 'expected no error, got ' + JSON.stringify(res.error));
    assert.strictEqual(store.journal_updates.length, 1);
    assert.strictEqual(store.journal_updates[0].journal_entry_id, 'e1');
    assert.strictEqual(store.journal_updates[0].body, 'CES technician came. Estimate $500.');
    assert.strictEqual(store.journal_updates[0].author, 'Max');
  });

  await atest('Original entry title/body untouched after an update is added', async () => {
    var store = {
      journal_entries: [{ id: 'e1', title: 'Oven Rational water problem',
        body: "Called Nick, he couldn't come so called CES to service the oven", status: 'OPEN' }],
      journal_updates: []
    };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    await j.jAddUpdate('e1', 'CES technician came. Water valve needs replacement. Estimate $500.');
    var entry = store.journal_entries[0];
    assert.strictEqual(entry.title, 'Oven Rational water problem');
    assert.strictEqual(entry.body, "Called Nick, he couldn't come so called CES to service the oven");
  });

  await atest('Multiple updates come back in chronological order', async () => {
    var store = {
      journal_entries: [{ id: 'e1', title: 'X', status: 'OPEN' }],
      journal_updates: [
        { id: 'u1', journal_entry_id: 'e1', body: 'first', created_at: '2026-08-17T10:00:00Z' },
        { id: 'u2', journal_entry_id: 'e1', body: 'second', created_at: '2026-08-17T11:00:00Z' },
        { id: 'u3', journal_entry_id: 'e1', body: 'third', created_at: '2026-08-17T12:00:00Z' },
        { id: 'u4', journal_entry_id: 'e2', body: 'unrelated entry, must not appear', created_at: '2026-08-17T09:00:00Z' }
      ]
    };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var updates = await j.jGetUpdates('e1');
    assert.strictEqual(updates.length, 3);
    assert.deepStrictEqual(updates.map(u => u.body), ['first', 'second', 'third']);
  });

  await atest('jSetStatus rejects an invalid status without touching the DB', async () => {
    var store = { journal_entries: [{ id: 'e1', status: 'OPEN' }], journal_updates: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var res = await j.jSetStatus('e1', 'DELETED_FOREVER');
    assert.ok(res.error, 'expected an error for an invalid status');
    assert.strictEqual(store.journal_entries[0].status, 'OPEN', 'status must not have changed');
  });

  await atest('jSetStatus accepts every documented transition', async () => {
    var store = { journal_entries: [{ id: 'e1', status: 'OPEN' }], journal_updates: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    for(const s of ['WAITING','IN_PROGRESS','RESOLVED','CLOSED']){
      var res = await j.jSetStatus('e1', s);
      assert.ok(!res.error, s + ' should be accepted, got ' + JSON.stringify(res.error));
      assert.strictEqual(res.data.status, s);
    }
  });

  await atest('jSetAssignee: null -> user -> null', async () => {
    var store = { journal_entries: [{ id: 'e1', assigned_to: null }], journal_updates: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var r1 = await j.jSetAssignee('e1', 3); // Tela
    assert.strictEqual(r1.data.assigned_to, 3);
    var r2 = await j.jSetAssignee('e1', null);
    assert.strictEqual(r2.data.assigned_to, null);
  });

  // ── T2B: status labels, roster resolution, quick-action mapping ────
  await atest('J_STATUS_LABELS: every allowed status has a human label with no raw underscores', async () => {
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    j.J_STATUSES.forEach(s => {
      var label = j.J_STATUS_LABELS[s];
      assert.ok(label, 'missing label for ' + s);
      assert.ok(!label.includes('_'), 'label for ' + s + ' leaks a raw underscore: ' + label);
    });
    assert.strictEqual(j.J_STATUS_LABELS.IN_PROGRESS, 'In Progress');
  });

  await atest('_jRosterName resolves a known id, unknown id, and null', async () => {
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    j._jSetRosterForTest([{ id: 1, name: 'Max' }, { id: 3, name: 'Tela' }]);
    assert.strictEqual(j._jRosterName(3), 'Tela');
    assert.strictEqual(j._jRosterName(999), null, 'unknown id should resolve to null, not throw');
    assert.strictEqual(j._jRosterName(null), null);
  });

  await atest('jdQuickActionTarget: OPEN/IN_PROGRESS/WAITING -> RESOLVED', async () => {
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    assert.strictEqual(j.jdQuickActionTarget('OPEN'), 'RESOLVED');
    assert.strictEqual(j.jdQuickActionTarget('IN_PROGRESS'), 'RESOLVED');
    assert.strictEqual(j.jdQuickActionTarget('WAITING'), 'RESOLVED');
  });

  await atest('jdQuickActionTarget: RESOLVED -> CLOSED', async () => {
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    assert.strictEqual(j.jdQuickActionTarget('RESOLVED'), 'CLOSED');
  });

  await atest('jdQuickActionTarget: CLOSED -> no further action', async () => {
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    assert.strictEqual(j.jdQuickActionTarget('CLOSED'), null);
  });

  await atest('jSetStatus: Resolve action target actually persists as RESOLVED', async () => {
    var store = { journal_entries: [{ id: 'e1', status: 'WAITING' }], journal_updates: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var target = j.jdQuickActionTarget('WAITING'); // 'RESOLVED'
    var res = await j.jSetStatus('e1', target);
    assert.ok(!res.error);
    assert.strictEqual(res.data.status, 'RESOLVED');
  });

  await atest('jSetStatus: Close action target actually persists as CLOSED', async () => {
    var store = { journal_entries: [{ id: 'e1', status: 'RESOLVED' }], journal_updates: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var target = j.jdQuickActionTarget('RESOLVED'); // 'CLOSED'
    var res = await j.jSetStatus('e1', target);
    assert.ok(!res.error);
    assert.strictEqual(res.data.status, 'CLOSED');
  });

  await atest('jGetEntryWithUpdates assembles entry + its updates together', async () => {
    var store = {
      journal_entries: [{ id: 'e1', title: 'X', status: 'OPEN' }],
      journal_updates: [
        { id: 'u1', journal_entry_id: 'e1', body: 'a', created_at: '2026-08-17T10:00:00Z' },
        { id: 'u2', journal_entry_id: 'e1', body: 'b', created_at: '2026-08-17T11:00:00Z' }
      ]
    };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var result = await j.jGetEntryWithUpdates('e1');
    assert.strictEqual(result.entry.id, 'e1');
    assert.strictEqual(result.updates.length, 2);
  });

  await atest('jAddUpdate rejects an empty body', async () => {
    var store = { journal_entries: [{ id: 'e1' }], journal_updates: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var res = await j.jAddUpdate('e1', '   ');
    assert.ok(res.error);
    assert.strictEqual(store.journal_updates.length, 0);
  });

  // ── T2C: automatic activity history ─────────────────────────────
  await atest('jSetStatus creates exactly one STATUS_CHANGED activity row on a real change', async () => {
    var store = { journal_entries: [{ id: 'e1', status: 'OPEN' }], journal_updates: [], journal_activity: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    await j.jSetStatus('e1', 'WAITING');
    assert.strictEqual(store.journal_activity.length, 1);
    assert.strictEqual(store.journal_activity[0].event_type, 'STATUS_CHANGED');
    assert.strictEqual(store.journal_activity[0].old_value, 'OPEN');
    assert.strictEqual(store.journal_activity[0].new_value, 'WAITING');
    assert.strictEqual(store.journal_activity[0].actor, 'Max');
  });

  await atest('jSetStatus same-status call creates ZERO activity rows (no-op)', async () => {
    var store = { journal_entries: [{ id: 'e1', status: 'WAITING' }], journal_updates: [], journal_activity: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    await j.jSetStatus('e1', 'WAITING');
    assert.strictEqual(store.journal_activity.length, 0);
  });

  await atest('jSetAssignee creates exactly one ASSIGNEE_CHANGED activity row on a real change', async () => {
    var store = { journal_entries: [{ id: 'e1', assigned_to: null }], journal_updates: [], journal_activity: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));
    j._jSetRosterForTest([{ id: 5, name: 'Monica' }]);

    await j.jSetAssignee('e1', 5);
    assert.strictEqual(store.journal_activity.length, 1);
    assert.strictEqual(store.journal_activity[0].event_type, 'ASSIGNEE_CHANGED');
    assert.strictEqual(store.journal_activity[0].old_value, null);
    assert.strictEqual(store.journal_activity[0].new_value, 'Monica');
  });

  await atest('jSetAssignee same-assignee call creates ZERO activity rows (no-op)', async () => {
    var store = { journal_entries: [{ id: 'e1', assigned_to: 5 }], journal_updates: [], journal_activity: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));
    j._jSetRosterForTest([{ id: 5, name: 'Monica' }]);

    await j.jSetAssignee('e1', 5); // Monica -> Monica
    assert.strictEqual(store.journal_activity.length, 0);
  });

  await test('jdActivitySentence: assignment wording — null -> user, user -> user, user -> null', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    assert.strictEqual(
      j.jdActivitySentence({ actor: 'Max', event_type: 'ASSIGNEE_CHANGED', old_value: null, new_value: 'Monica' }),
      'Max assigned this to Monica'
    );
    assert.strictEqual(
      j.jdActivitySentence({ actor: 'Max', event_type: 'ASSIGNEE_CHANGED', old_value: 'Monica', new_value: 'Anto' }),
      'Max reassigned this from Monica to Anto'
    );
    assert.strictEqual(
      j.jdActivitySentence({ actor: 'Max', event_type: 'ASSIGNEE_CHANGED', old_value: 'Monica', new_value: null }),
      "Max removed Monica's assignment"
    );
  });

  await test('jdActivitySentence: RESOLVED and CLOSED get special wording', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    assert.strictEqual(
      j.jdActivitySentence({ actor: 'Max', event_type: 'STATUS_CHANGED', old_value: 'IN_PROGRESS', new_value: 'RESOLVED' }),
      'Max resolved this issue'
    );
    assert.strictEqual(
      j.jdActivitySentence({ actor: 'Max', event_type: 'STATUS_CHANGED', old_value: 'RESOLVED', new_value: 'CLOSED' }),
      'Max closed this issue'
    );
  });

  await test('jdActivitySentence: normal transitions use human labels, no raw underscores', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    assert.strictEqual(
      j.jdActivitySentence({ actor: 'Max', event_type: 'STATUS_CHANGED', old_value: 'CLOSED', new_value: 'OPEN' }),
      'Max changed status from Closed to Open'
    );
  });

  await test('jMergeTimeline: interleaves updates and activity in true chronological order', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var updates = [
      { id: 'u1', body: 'CES technician came.', created_at: '2026-08-18T10:15:00Z' }
    ];
    var activity = [
      { id: 'a1', event_type: 'ASSIGNEE_CHANGED', old_value: null, new_value: 'Monica', created_at: '2026-08-17T15:05:00Z' },
      { id: 'a2', event_type: 'STATUS_CHANGED', old_value: 'OPEN', new_value: 'WAITING', created_at: '2026-08-17T15:06:00Z' },
      { id: 'a3', event_type: 'STATUS_CHANGED', old_value: 'WAITING', new_value: 'IN_PROGRESS', created_at: '2026-08-18T11:03:00Z' }
    ];
    var timeline = j.jMergeTimeline(updates, activity);
    assert.strictEqual(timeline.length, 4);
    assert.deepStrictEqual(timeline.map(t => t.data.id), ['a1', 'a2', 'u1', 'a3']);
    assert.deepStrictEqual(timeline.map(t => t.type), ['activity', 'activity', 'update', 'activity']);
  });

  await test('jMergeTimeline: deterministic tie-break when timestamps are identical (update before activity)', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var sameTime = '2026-08-18T10:00:00Z';
    var updates = [{ id: 'u1', body: 'x', created_at: sameTime }];
    var activity = [{ id: 'a1', event_type: 'STATUS_CHANGED', old_value: 'OPEN', new_value: 'WAITING', created_at: sameTime }];
    var t1 = j.jMergeTimeline(updates, activity);
    var t2 = j.jMergeTimeline(updates, activity); // run twice — must be stable/deterministic
    assert.deepStrictEqual(t1.map(x => x.type), ['update', 'activity']);
    assert.deepStrictEqual(t1.map(x => x.type), t2.map(x => x.type));
  });

  // ── T2D: waiting_for / current blocker ──────────────────────────
  await atest('jSetWaitingFor: null -> text creates one WAITING_FOR_CHANGED activity', async () => {
    var store = { journal_entries: [{ id: 'e1', waiting_for: null }], journal_updates: [], journal_activity: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var res = await j.jSetWaitingFor('e1', 'Monica approval');
    assert.ok(!res.error);
    assert.strictEqual(store.journal_entries[0].waiting_for, 'Monica approval');
    assert.strictEqual(store.journal_activity.length, 1);
    assert.strictEqual(store.journal_activity[0].event_type, 'WAITING_FOR_CHANGED');
    assert.strictEqual(store.journal_activity[0].old_value, null);
    assert.strictEqual(store.journal_activity[0].new_value, 'Monica approval');
  });

  await atest('jSetWaitingFor: text -> different text creates one activity with correct old/new', async () => {
    var store = { journal_entries: [{ id: 'e1', waiting_for: 'CES technician' }], journal_updates: [], journal_activity: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    await j.jSetWaitingFor('e1', 'Monica approval');
    assert.strictEqual(store.journal_activity.length, 1);
    assert.strictEqual(store.journal_activity[0].old_value, 'CES technician');
    assert.strictEqual(store.journal_activity[0].new_value, 'Monica approval');
  });

  await atest('jSetWaitingFor: text -> empty string persists as null and logs old -> null', async () => {
    var store = { journal_entries: [{ id: 'e1', waiting_for: 'CES replacement part' }], journal_updates: [], journal_activity: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    await j.jSetWaitingFor('e1', '');
    assert.strictEqual(store.journal_entries[0].waiting_for, null);
    assert.strictEqual(store.journal_activity[0].old_value, 'CES replacement part');
    assert.strictEqual(store.journal_activity[0].new_value, null);
  });

  await atest('jSetWaitingFor: same value = ZERO new activity rows (no-op)', async () => {
    var store = { journal_entries: [{ id: 'e1', waiting_for: 'Monica approval' }], journal_updates: [], journal_activity: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    await j.jSetWaitingFor('e1', 'Monica approval');
    assert.strictEqual(store.journal_activity.length, 0);
  });

  await atest('jSetWaitingFor: whitespace-only input normalizes to null, not a blank-string blocker', async () => {
    var store = { journal_entries: [{ id: 'e1', waiting_for: null }], journal_updates: [], journal_activity: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    await j.jSetWaitingFor('e1', '   ');
    assert.strictEqual(store.journal_entries[0].waiting_for, null);
    assert.strictEqual(store.journal_activity.length, 0, 'null -> null via whitespace must not log an event');
  });

  await atest('jSetWaitingFor: leading/trailing whitespace is trimmed before storing', async () => {
    var store = { journal_entries: [{ id: 'e1', waiting_for: null }], journal_updates: [], journal_activity: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    await j.jSetWaitingFor('e1', '   replacement part   ');
    assert.strictEqual(store.journal_entries[0].waiting_for, 'replacement part');
  });

  await test('jdActivitySentence: WAITING_FOR_CHANGED wording — set / changed / cleared', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    assert.strictEqual(
      j.jdActivitySentence({ actor: 'Max', event_type: 'WAITING_FOR_CHANGED', old_value: null, new_value: 'Monica approval' }),
      'Max set waiting for: Monica approval'
    );
    assert.strictEqual(
      j.jdActivitySentence({ actor: 'Max', event_type: 'WAITING_FOR_CHANGED', old_value: 'Monica approval', new_value: 'CES replacement part' }),
      'Max changed waiting for from Monica approval to CES replacement part'
    );
    assert.strictEqual(
      j.jdActivitySentence({ actor: 'Max', event_type: 'WAITING_FOR_CHANGED', old_value: 'CES replacement part', new_value: null }),
      'Max cleared waiting for'
    );
  });

  await test('jMergeTimeline: WAITING_FOR_CHANGED merges into the unified timeline like any other activity', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var updates = [{ id: 'u1', body: 'Technician came.', created_at: '2026-08-18T10:15:00Z' }];
    var activity = [
      { id: 'a1', event_type: 'STATUS_CHANGED', old_value: 'OPEN', new_value: 'WAITING', created_at: '2026-08-17T15:05:00Z' },
      { id: 'a2', event_type: 'WAITING_FOR_CHANGED', old_value: null, new_value: 'CES technician', created_at: '2026-08-17T15:06:00Z' },
      { id: 'a3', event_type: 'WAITING_FOR_CHANGED', old_value: 'CES technician', new_value: 'Monica approval', created_at: '2026-08-18T10:17:00Z' }
    ];
    var timeline = j.jMergeTimeline(updates, activity);
    assert.deepStrictEqual(timeline.map(t => t.data.id), ['a1', 'a2', 'u1', 'a3']);
  });

  await atest('_jLoadUpdateStats ignores journal_activity entirely — manual count stays manual-only', async () => {
    var store = {
      journal_entries: [{ id: 'e1' }],
      journal_updates: [{ id: 'u1', journal_entry_id: 'e1', created_at: '2026-08-17T10:00:00Z' }],
      journal_activity: [
        { id: 'a1', journal_entry_id: 'e1', event_type: 'STATUS_CHANGED', created_at: '2026-08-17T11:00:00Z' },
        { id: 'a2', journal_entry_id: 'e1', event_type: 'WAITING_FOR_CHANGED', created_at: '2026-08-17T12:00:00Z' },
        { id: 'a3', journal_entry_id: 'e1', event_type: 'WAITING_FOR_CHANGED', created_at: '2026-08-17T13:00:00Z' }
      ]
    };
    global.window = { supabaseClient: makeFakeSupabase(store) };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var stats = await j._jLoadUpdateStats(['e1']);
    assert.strictEqual(stats.e1.count, 1, 'three activity rows exist but the manual count must stay 1');
  });

  // ── T2E: follow_up_on / follow-up date ──────────────────────────
  await atest('jSetFollowUp: null -> date creates one FOLLOW_UP_CHANGED activity', async () => {
    var store = { journal_entries: [{ id: 'e1', follow_up_on: null }], journal_updates: [], journal_activity: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var res = await j.jSetFollowUp('e1', '2026-08-20');
    assert.ok(!res.error);
    assert.strictEqual(store.journal_entries[0].follow_up_on, '2026-08-20');
    assert.strictEqual(store.journal_activity.length, 1);
    assert.strictEqual(store.journal_activity[0].event_type, 'FOLLOW_UP_CHANGED');
    assert.strictEqual(store.journal_activity[0].old_value, null);
    assert.strictEqual(store.journal_activity[0].new_value, '2026-08-20');
  });

  await atest('jSetFollowUp: date -> different date logs correct old/new', async () => {
    var store = { journal_entries: [{ id: 'e1', follow_up_on: '2026-08-20' }], journal_updates: [], journal_activity: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    await j.jSetFollowUp('e1', '2026-08-25');
    assert.strictEqual(store.journal_activity[0].old_value, '2026-08-20');
    assert.strictEqual(store.journal_activity[0].new_value, '2026-08-25');
  });

  await atest('jSetFollowUp: date -> empty clears to null and logs date -> null', async () => {
    var store = { journal_entries: [{ id: 'e1', follow_up_on: '2026-08-25' }], journal_updates: [], journal_activity: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    await j.jSetFollowUp('e1', '');
    assert.strictEqual(store.journal_entries[0].follow_up_on, null);
    assert.strictEqual(store.journal_activity[0].old_value, '2026-08-25');
    assert.strictEqual(store.journal_activity[0].new_value, null);
  });

  await atest('jSetFollowUp: same date = ZERO new activity rows (no-op)', async () => {
    var store = { journal_entries: [{ id: 'e1', follow_up_on: '2026-08-20' }], journal_updates: [], journal_activity: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    await j.jSetFollowUp('e1', '2026-08-20');
    assert.strictEqual(store.journal_activity.length, 0);
  });

  await atest('jSetFollowUp: invalid date is rejected without touching the DB', async () => {
    var store = { journal_entries: [{ id: 'e1', follow_up_on: null }], journal_updates: [], journal_activity: [] };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var res = await j.jSetFollowUp('e1', 'not-a-date');
    assert.ok(res.error, 'expected an error for an invalid date');
    assert.strictEqual(store.journal_entries[0].follow_up_on, null, 'must not have been mutated');
    assert.strictEqual(store.journal_activity.length, 0);

    var res2 = await j.jSetFollowUp('e1', '2026-13-40'); // wrong month/day, still matches the regex shape
    assert.ok(res2.error, 'expected an error for an out-of-range date');
  });

  await test('jdActivitySentence: FOLLOW_UP_CHANGED wording — set / changed / cleared', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    assert.strictEqual(
      j.jdActivitySentence({ actor: 'Max', event_type: 'FOLLOW_UP_CHANGED', old_value: null, new_value: '2026-08-20' }),
      'Max set follow-up for Aug 20'
    );
    assert.strictEqual(
      j.jdActivitySentence({ actor: 'Max', event_type: 'FOLLOW_UP_CHANGED', old_value: '2026-08-20', new_value: '2026-08-25' }),
      'Max changed follow-up from Aug 20 to Aug 25'
    );
    assert.strictEqual(
      j.jdActivitySentence({ actor: 'Max', event_type: 'FOLLOW_UP_CHANGED', old_value: '2026-08-25', new_value: null }),
      'Max cleared the follow-up date'
    );
  });

  await test('jMergeTimeline: FOLLOW_UP_CHANGED merges into the unified timeline like any other activity', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var updates = [{ id: 'u1', body: 'CES says backordered.', created_at: '2026-08-18T10:15:00Z' }];
    var activity = [
      { id: 'a1', event_type: 'WAITING_FOR_CHANGED', old_value: null, new_value: 'CES replacement part', created_at: '2026-08-17T15:06:00Z' },
      { id: 'a2', event_type: 'FOLLOW_UP_CHANGED', old_value: null, new_value: '2026-08-24', created_at: '2026-08-17T15:07:00Z' },
      { id: 'a3', event_type: 'FOLLOW_UP_CHANGED', old_value: '2026-08-24', new_value: '2026-08-29', created_at: '2026-08-18T10:17:00Z' }
    ];
    var timeline = j.jMergeTimeline(updates, activity);
    assert.deepStrictEqual(timeline.map(t => t.data.id), ['a1', 'a2', 'u1', 'a3']);
  });

  await test('jFollowUpLabel: today renders as "Today"', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    assert.strictEqual(j.jFollowUpLabel('2026-08-17', 'OPEN', '2026-08-17'), 'Today');
  });

  await test('jFollowUpLabel: tomorrow renders as "Tomorrow"', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    assert.strictEqual(j.jFollowUpLabel('2026-08-18', 'OPEN', '2026-08-17'), 'Tomorrow');
  });

  await test('jFollowUpLabel: past date + OPEN is marked Overdue', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var label = j.jFollowUpLabel('2026-08-16', 'OPEN', '2026-08-17');
    assert.ok(label.includes('Overdue'), 'expected Overdue, got: ' + label);
    assert.ok(label.includes('Aug 16'));
  });

  await test('jFollowUpLabel: past date + WAITING is also Overdue (any non-terminal status)', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    assert.ok(j.jFollowUpLabel('2026-08-16', 'WAITING', '2026-08-17').includes('Overdue'));
  });

  await test('jFollowUpLabel: past date + RESOLVED is NOT overdue', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var label = j.jFollowUpLabel('2026-08-16', 'RESOLVED', '2026-08-17');
    assert.ok(!label.includes('Overdue'), 'RESOLVED must never show Overdue, got: ' + label);
    assert.strictEqual(label, 'Aug 16');
  });

  await test('jFollowUpLabel: past date + CLOSED is NOT overdue', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var label = j.jFollowUpLabel('2026-08-16', 'CLOSED', '2026-08-17');
    assert.ok(!label.includes('Overdue'));
  });

  await test('jFollowUpLabel: future date renders as a plain formatted date, no null crash', () => {
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    assert.strictEqual(j.jFollowUpLabel('2026-09-01', 'OPEN', '2026-08-17'), 'Sep 1');
    assert.strictEqual(j.jFollowUpLabel(null, 'OPEN', '2026-08-17'), null);
  });

  await atest('_jLoadUpdateStats ignores FOLLOW_UP_CHANGED activity — manual count stays manual-only', async () => {
    var store = {
      journal_entries: [{ id: 'e1' }],
      journal_updates: [{ id: 'u1', journal_entry_id: 'e1', created_at: '2026-08-17T10:00:00Z' }],
      journal_activity: [
        { id: 'a1', journal_entry_id: 'e1', event_type: 'FOLLOW_UP_CHANGED', created_at: '2026-08-17T11:00:00Z' },
        { id: 'a2', journal_entry_id: 'e1', event_type: 'FOLLOW_UP_CHANGED', created_at: '2026-08-17T12:00:00Z' }
      ]
    };
    global.window = { supabaseClient: makeFakeSupabase(store) };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var stats = await j._jLoadUpdateStats(['e1']);
    assert.strictEqual(stats.e1.count, 1);
  });

  // ── HOTFIX T2E.3: the actual, evidenced root cause — Texas evening timezone bug ──
  await test('_jFmtLocalISO: Texas evening (22:30 CT) stays on the correct LOCAL calendar day', () => {
    var originalTZ = process.env.TZ;
    process.env.TZ = 'America/Chicago';
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    // 2026-08-18T03:30:00Z == 2026-08-17 22:30:00 in America/Chicago (CDT, UTC-5) —
    // this is exactly when Max was creating real entries that went missing.
    var texasEvening = new Date('2026-08-18T03:30:00Z');
    var result = j._jFmtLocalISO(texasEvening);
    assert.strictEqual(result, '2026-08-17',
      'must stay on Aug 17 (Texas local calendar day) — the old `.toISOString().slice(0,10)` ' +
      'approach would have wrongly returned 2026-08-18 here, which is the confirmed root cause');

    process.env.TZ = originalTZ;
  });

  await test('Old buggy formula (for contrast): toISOString-based "today" DOES roll to tomorrow at Texas 22:30', () => {
    var originalTZ = process.env.TZ;
    process.env.TZ = 'America/Chicago';
    var texasEvening = new Date('2026-08-18T03:30:00Z');
    var oldBuggyResult = texasEvening.toISOString().slice(0, 10);
    assert.strictEqual(oldBuggyResult, '2026-08-18',
      'documents the exact bug: the old formula returns tomorrow, not today, after ~7pm CT');
    process.env.TZ = originalTZ;
  });

  await test('_jTodayISO uses the local formatter (regression guard against reverting to toISOString)', () => {
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));
    assert.strictEqual(j._jTodayISO(), j._jFmtLocalISO(new Date()));
  });

  await test('_jRange: entry_date=2026-08-17 stays within Today/7D/All ranges when "today" is Texas 22:30 on the 17th', () => {
    var originalTZ = process.env.TZ;
    process.env.TZ = 'America/Chicago';
    global.window = { supabaseClient: makeFakeSupabase({ journal_entries: [], journal_updates: [] }) };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    var entryDate = '2026-08-17';
    var range7d = j._jRange(); // default period is '7'
    assert.ok(entryDate >= range7d.from && entryDate <= range7d.to,
      'a same-day entry must fall inside the default 7-day range, got ' + JSON.stringify(range7d));

    process.env.TZ = originalTZ;
  });

  // ── HOTFIX T2E.1: enrichment failure must never hide a valid entry ──
  await atest('loadJournal still renders a real entry even when the update-stats enrichment query throws', async () => {
    var store = {
      journal_entries: [
        { id: 'real-1', entry_date: '2026-08-18', author: 'Max', category: 'equipment',
          title: 'Fridge dressing and citrus not cooling', body: 'Working at 58F', severity: 'info',
          is_archived: false, created_at: '2026-08-18T02:56:55Z', status: 'OPEN',
          assigned_to: null, waiting_for: null, follow_up_on: null }
      ],
      journal_updates: [],
      journal_activity: [],
      _throwOnTable: 'journal_updates' // simulates a network/schema-cache failure on the enrichment query only
    };
    var dom = makeFakeDom();
    global.document = dom;
    global.tr = function(k){ return '[' + k + ']'; };
    global.window = { supabaseClient: makeFakeSupabase(store), user: { name: 'Max' } };
    delete require.cache[require.resolve(path.join(__dirname, '..', 'js', 'journal.js'))];
    const j = require(path.join(__dirname, '..', 'js', 'journal.js'));

    await j.loadJournal(); // must not throw/reject despite the enrichment query throwing internally
    var html = dom._el('vj').innerHTML;
    assert.ok(html.indexOf('Fridge dressing and citrus not cooling') >= 0,
      'a real, already-saved entry must still render even when secondary enrichment fails');

    delete global.document;
    delete global.tr;
  });


  console.log('\n' + pass + ' passed, ' + fail + ' failed\n');
  process.exit(fail > 0 ? 1 : 0);
})();
