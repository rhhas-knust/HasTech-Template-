// A SchoolContext is one request's view of a school's spreadsheet: every tab is read in a
// single API call, business logic works on that in-memory snapshot, and writes are batched
// and sent when the request finishes (flush). Appends that need a unique sequential ID are
// sent immediately so the ID can be derived from the row Google actually wrote to.
const crypto = require('crypto');
const { SHEETS, HEADERS, DEFAULT_SETTINGS } = require('./schema');

class SchoolContext {
  constructor({ store, school, raw, user }) {
    this.store = store;
    this.school = school;
    this.spreadsheetId = school.spreadsheetId;
    this.user = user || null;
    this.headers = {};
    this.tables = {};
    this.pendingAppends = [];
    this.pendingUpdates = [];
    Object.keys(raw).forEach(name => this._ingest(name, raw[name]));
  }

  static async open(store, school, user, sheetNames) {
    const names = sheetNames || Object.values(SHEETS);
    const raw = await store.loadTables(school.spreadsheetId, names);
    return new SchoolContext({ store, school, raw, user });
  }

  _ingest(name, values) {
    const header = (values[0] && values[0].length ? values[0] : HEADERS[name] || []).map(h => String(h).trim());
    this.headers[name] = header;
    this.tables[name] = values.slice(1).map((row, i) => {
      const obj = {};
      header.forEach((h, c) => { obj[h] = row[c] === undefined || row[c] === null ? '' : row[c]; });
      obj._row = i + 2;
      return obj;
    }).filter(obj => header.some(h => obj[h] !== ''));
  }

  _requireTable(sheet) {
    if (!this.tables[sheet]) throw new Error('Tab not loaded: ' + sheet);
    return this.tables[sheet];
  }

  /** Copies of the rows of a tab, as objects keyed by header. */
  rows(sheet) {
    return this._requireTable(sheet).map(r => Object.assign({}, r));
  }

  find(sheet, field, value) {
    const row = this._requireTable(sheet).find(r => r[field] === value);
    return row ? Object.assign({}, row) : null;
  }

  settings() {
    if (!this._settings) {
      const s = Object.assign({}, DEFAULT_SETTINGS);
      (this.tables[SHEETS.SETTINGS] || []).forEach(r => {
        if (r.SETTING && r.VALUE !== '' && r.VALUE !== undefined) s[r.SETTING] = r.VALUE;
      });
      this._settings = s;
    }
    return this._settings;
  }

  setting(key) {
    return this.settings()[key];
  }

  timezone() {
    return String(this.setting('TIMEZONE') || DEFAULT_SETTINGS.TIMEZONE);
  }

  _rowValues(sheet, obj) {
    const header = this.headers[sheet] || HEADERS[sheet];
    return header.map(h => (obj[h] === undefined ? '' : obj[h]));
  }

  /** Queues a new row; it is written on flush(). Works for tabs that weren't loaded (e.g. the activity log). */
  append(sheet, obj) {
    if (this.tables[sheet]) this.tables[sheet].push(Object.assign({}, obj, { _row: null }));
    this.pendingAppends.push({ sheet, values: this._rowValues(sheet, obj) });
    return obj;
  }

  /**
   * Writes a row now and assigns it a sequential ID such as BFA-2026-0007. The number comes
   * from the row Google appended to, so two simultaneous requests can't get the same ID.
   */
  async appendWithSequence(sheet, obj, { field, prefix, pad }) {
    const table = this._requireTable(sheet);
    const pattern = new RegExp('^' + prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\d+)$');
    let maxExisting = 0;
    table.forEach(r => {
      const m = pattern.exec(String(r[field] || ''));
      if (m) maxExisting = Math.max(maxExisting, parseInt(m[1], 10));
    });
    const row = await this.store.appendRows(this.spreadsheetId, sheet, [this._rowValues(sheet, Object.assign({}, obj, { [field]: '' }))]);
    const seq = Math.max(row - 1, maxExisting + 1);
    const id = prefix + String(seq).padStart(pad, '0');
    obj[field] = id;
    this.pendingUpdates.push({ sheet, row, col: this.headers[sheet].indexOf(field) + 1, value: id });
    table.push(Object.assign({}, obj, { _row: row }));
    return obj;
  }

  /** Queues field changes for the row whose idField equals id. Returns false if not found. */
  update(sheet, idField, id, patch) {
    const row = this._requireTable(sheet).find(r => r[idField] === id);
    if (!row) return false;
    Object.keys(patch).forEach(key => {
      if (patch[key] === undefined) return;
      const col = this.headers[sheet].indexOf(key);
      if (col === -1) return;
      row[key] = patch[key];
      if (row._row) this.pendingUpdates.push({ sheet, row: row._row, col: col + 1, value: patch[key] });
    });
    return true;
  }

  /** Deletes the row whose idField equals id, immediately. */
  async remove(sheet, idField, id) {
    const table = this._requireTable(sheet);
    const idx = table.findIndex(r => r[idField] === id);
    if (idx === -1 || !table[idx]._row) return false;
    const ok = await this.store.deleteRowIfMatches(this.spreadsheetId, sheet, table[idx]._row, this.headers[sheet].indexOf(idField) + 1, id);
    if (ok) table.splice(idx, 1);
    return ok;
  }

  userLabel() {
    return this.user ? (this.user.name || this.user.email) : 'SYSTEM';
  }

  log(action, description, relatedId) {
    this.append(SHEETS.ACTIVITY_LOG, {
      LOG_ID: crypto.randomUUID(),
      TIMESTAMP: new Date().toISOString(),
      USER: this.userLabel(),
      ACTION: action,
      DESCRIPTION: description || '',
      RELATED_ID: relatedId || ''
    });
  }

  /** Sends queued writes: one call for all cell updates, one append call per tab. */
  async flush() {
    const updates = this.pendingUpdates;
    const appends = this.pendingAppends;
    this.pendingUpdates = [];
    this.pendingAppends = [];
    if (updates.length) await this.store.updateCells(this.spreadsheetId, updates);
    const bySheet = {};
    appends.forEach(a => { (bySheet[a.sheet] = bySheet[a.sheet] || []).push(a.values); });
    for (const sheet of Object.keys(bySheet)) {
      await this.store.appendRows(this.spreadsheetId, sheet, bySheet[sheet]);
    }
  }
}

module.exports = { SchoolContext };
