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

function fakeMessage({ id, subject, from, body, plainBody }) {
  return {
    _id: id,
    getSubject: () => subject,
    getFrom: () => from,
    getBody: () => body,
    getPlainBody: () => (plainBody !== undefined ? plainBody : String(body).replace(/<[^>]+>/g, ' ')),
    getAttachments: () => [],
    getDate: () => new Date(),
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

// `rispondi(payload, chiamata)` decide l'esito di ogni invio: e' il solo
// punto in cui il test guida il comportamento del backend.
function caricaGas({ files, threads, props = {}, rispondi }) {
  const inviati = [];
  const log = [];
  const etichetteCreate = new Map();

  function label(nome) {
    if (!etichetteCreate.has(nome)) {
      etichetteCreate.set(nome, { getName: () => nome });
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
      search: () => threads,
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

module.exports = { caricaGas, fakeMessage, fakeThread, GAS_DIR };
