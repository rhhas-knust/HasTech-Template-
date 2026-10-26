// Picks the storage backend: Google Sheets in production, in-memory for local dev/tests.
const path = require('path');
const { SheetsStore } = require('./sheets');
const { MemoryStore } = require('./memory');

let store = null;

function getStore() {
  if (store) return store;
  if ((process.env.STORE || 'sheets') === 'memory') {
    const file = process.env.MEMORY_STORE_FILE === 'none' ? null
      : (process.env.MEMORY_STORE_FILE || path.join(__dirname, '..', '..', '.data', 'dev-db.json'));
    store = new MemoryStore(file);
  } else {
    store = new SheetsStore();
  }
  return store;
}

function setStore(s) { store = s; }

function isMemoryStore() {
  return getStore() instanceof MemoryStore;
}

module.exports = { getStore, setStore, isMemoryStore };
