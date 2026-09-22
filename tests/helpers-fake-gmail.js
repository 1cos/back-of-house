// Banco di prova per i collector Apps Script.
//
// Non ricopia nessuna logica: carica i file .js REALI di
// apps-script/gmail-vendor-import e li esegue dentro un sandbox con
// GmailApp, PropertiesService, Logger e UrlFetchApp finti. Quello che i
// test osservano sono le chiamate che il codice vero ha deciso di fare.

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const GAS_DIR = path.join(__dirname, '..', 'apps-script', 'gmail-vendor-import');

function fakeAttachment(name, bytes) {
  return { getName: () => name, getBytes: () => (bytes || name) };
}

function fakeMessage({ id, subject, from, body, plainBody, attachments, date }) {
  const att = (attachments || []).map(a =>
    typeof a === 'string' ? fakeAttachment(a) : fakeAttachment(a.name, a.bytes));
  return {
    _id: id,
    getSubject: () => subject,
    getFrom: () => from,
    getBody: () => body,
    getPlainBody: () => (plainBody !== undefined ? plainBody : String(body).replace(/<[^>]+>/g, ' ')),
    getAttachments: () => att,
    getDate: () => date || new Date(),
  };
}

function fakeThread({ id, messages, labels = [], lastMessageDate }) {
  const etichette = new Set(labels);
  return {
    _id: id,
    _labels: etichette,
    getId: () => id,
    getMessages: () => messages,
    getLastMessageDate: () => lastMessageDate || new Date(),
    addLabel: (l) => etichette.add(l.getName()),
    removeLabel: (l) => etichette.delete(l.getName()),
  };
}

// ── Valutatore di query Gmail ───────────────────────────────────────────
//
// Serve perche' un test sulle ESCLUSIONI non puo' limitarsi a uno stub che
// restituisce i thread che gli passo: proverebbe solo lo stub. Qui la query
// scritta nel codice di produzione viene analizzata davvero e applicata ai
// messaggi finti.
//
// Copre soltanto gli operatori usati dai collector di questo progetto. Se la
// query ne acquistasse un altro, il valutatore SOLLEVA invece di ignorarlo in
// silenzio: meglio un test che si rompe di un test che passa per finta.
function analizzaQueryGmail(query) {
  let resto = ' ' + String(query) + ' ';
  const c = { from: null, subject: [], haAllegato: false, senzaEtichetta: [], conEtichetta: [] };
  function consuma(re, fn) {
    let m;
    while ((m = resto.match(re))) { fn(m); resto = resto.replace(m[0], ' '); }
  }
  consuma(/from:\(([^)]*)\)/i, (m) => {
    c.from = (c.from || []).concat(m[1].split(/\s+OR\s+/i).map((x) => x.trim().toLowerCase()).filter(Boolean));
  });
  consuma(/from:([^\s()]+)/i, (m) => { c.from = (c.from || []).concat([m[1].toLowerCase()]); });
  consuma(/-label:([^\s()]+)/i, (m) => c.senzaEtichetta.push(m[1]));
  consuma(/(^|\s)label:([^\s()]+)/i, (m) => c.conEtichetta.push(m[2]));
  consuma(/subject:"([^"]*)"/i, (m) => c.subject.push(m[1].toLowerCase()));
  consuma(/subject:([^\s()"]+)/i, (m) => c.subject.push(m[1].toLowerCase()));
  consuma(/has:attachment/i, () => { c.haAllegato = true; });
  consuma(/after:[0-9/]+/i, () => {});
  if (resto.trim() !== '') {
    throw new Error('clausola non riconosciuta dal valutatore di query: "' + resto.trim() + '"');
  }
  return c;
}

// Semantica di Gmail: la ricerca trova un MESSAGGIO e restituisce il suo
// thread; le etichette invece sono del thread.
function threadMatchaQuery(query, thread) {
  const c = analizzaQueryGmail(query);
  const etichette = [...thread._labels];
  if (c.senzaEtichetta.some((l) => etichette.includes(l))) return false;
  if (c.conEtichetta.some((l) => !etichette.includes(l))) return false;
  const msgs = thread.getMessages();
  if (c.haAllegato && !msgs.some((m) => m.getAttachments().length > 0)) return false;
  if (c.from && !msgs.some((m) => c.from.some((f) => String(m.getFrom()).toLowerCase().includes(f)))) return false;
  if (c.subject.length &&
      !msgs.some((m) => c.subject.every((s) => String(m.getSubject()).toLowerCase().includes(s)))) return false;
  return true;
}

// `rispondi(payload, chiamata)` decide l'esito di ogni invio: e' il solo
// punto in cui il test guida il comportamento del backend.
// `valutaQuery: true` fa valutare davvero la query a GmailApp.search invece
// di restituire tutti i thread.
function caricaGas({ files, threads, props = {}, rispondi, valutaQuery = false }) {
  const inviati = [];
  const log = [];
  const etichetteCreate = new Map();

  function label(nome) {
    if (!etichetteCreate.has(nome)) {
      etichetteCreate.set(nome, {
        getName: () => nome,
        // processLabelPDF legge la coda da qui: i thread che PORTANO
        // l'etichetta in questo momento, non una lista fissata prima.
        getThreads: (start, max) =>
          threads.filter((t) => t._labels.has(nome)).slice(start, start + max),
      });
    }
    return etichetteCreate.get(nome);
  }

  const sandbox = {
    console,
    JSON,
    Date,
    Math,
    String,
    Number,
    Array,
    Object,
    RegExp,
    Error,
    Logger: { log: (m) => log.push(String(m)) },
    PropertiesService: {
      getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null) }),
    },
    GmailApp: {
      search: (q, start, max) => {
        const trovati = valutaQuery ? threads.filter((t) => threadMatchaQuery(q, t)) : threads;
        return (start === undefined) ? trovati : trovati.slice(start, start + max);
      },
      getUserLabelByName: (n) => label(n),
      createLabel: (n) => label(n),
      getThreadById: (id) => threads.find((t) => t.getId() === id) || null,
    },
    UrlFetchApp: {
      fetch: (url, opts) => {
        const payload = JSON.parse(opts.payload);
        const chiamata = { url, payload };
        inviati.push(chiamata);
        const r = rispondi(payload, inviati.length);
        if (r instanceof Error) throw r;
        return { getContentText: () => JSON.stringify(r) };
      },
    },
    Utilities: { base64Encode: (b) => String(b) },
  };
  sandbox.globalThis = sandbox;

  const ctx = vm.createContext(sandbox);
  for (const f of files) {
    vm.runInContext(fs.readFileSync(path.join(GAS_DIR, f), 'utf8'), ctx, { filename: f });
  }
  return { ctx, inviati, log, sandbox };
}

module.exports = { caricaGas, fakeMessage, fakeThread, fakeAttachment,
                   analizzaQueryGmail, threadMatchaQuery, GAS_DIR };
