// In-memory store with the same API as SheetsStore. Used for local development and tests.
// Optionally persists to a JSON file so a local demo survives restarts.
const fs = require('fs');
const path = require('path');

class MemoryStore {
  constructor(file) {
    this.file = file || null;
    this.books = {};
    if (this.file && fs.existsSync(this.file)) this.books = JSON.parse(fs.readFileSync(this.file, 'utf8'));
  }

  _save() {
    if (!this.file) return;
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.books));
  }

  _book(id) {
    if (!this.books[id]) throw new Error('Spreadsheet not found: ' + id);
    return this.books[id];
  }

  createSpreadsheet(id) {
    if (!this.books[id]) this.books[id] = {};
    this._save();
  }

  async loadTables(spreadsheetId, sheetNames) {
    const book = this._book(spreadsheetId);
    const out = {};
    sheetNames.forEach(n => {
      // Sheets omits trailing empty cells/rows; mimic that so code handles ragged rows.
      const rows = (book[n] || []).map(r => trimRight(r.slice()));
      while (rows.length && !rows[rows.length - 1].length) rows.pop();
      out[n] = JSON.parse(JSON.stringify(rows));
    });
    return out;
  }

  async appendRows(spreadsheetId, sheet, rows) {
    const tab = this._book(spreadsheetId)[sheet];
    if (!tab) throw new Error('Tab not found: ' + sheet);
    const first = tab.length + 1;
    rows.forEach(r => tab.push(r.map(v => (v === undefined || v === null ? '' : v))));
    this._save();
    return first;
  }

  async updateCells(spreadsheetId, updates) {
    const book = this._book(spreadsheetId);
    updates.forEach(u => {
      const tab = book[u.sheet];
      if (!tab) throw new Error('Tab not found: ' + u.sheet);
      while (tab.length < u.row) tab.push([]);
      const row = tab[u.row - 1];
      while (row.length < u.col) row.push('');
      row[u.col - 1] = u.value === undefined || u.value === null ? '' : u.value;
    });
    this._save();
  }

  async deleteRowIfMatches(spreadsheetId, sheet, row, col, expected) {
    const tab = this._book(spreadsheetId)[sheet];
    if (!tab || !tab[row - 1] || tab[row - 1][col - 1] !== expected) return false;
    tab.splice(row - 1, 1);
    this._save();
    return true;
  }

  async ensureSheets(spreadsheetId, headersByName) {
    const book = this._book(spreadsheetId);
    const missing = [];
    Object.keys(headersByName).forEach(name => {
      if (!book[name]) { book[name] = []; missing.push(name); }
      if (!book[name].length) book[name].push(headersByName[name].slice());
    });
    this._save();
    return missing;
  }
}

function trimRight(row) {
  while (row.length && (row[row.length - 1] === '' || row[row.length - 1] === undefined)) row.pop();
  return row;
}

module.exports = { MemoryStore };
