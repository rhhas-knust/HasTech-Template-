// Google Sheets API implementation of the store. Every read/write the app makes goes through here.
const { googleFetch } = require('../google');

const API = 'https://sheets.googleapis.com/v4/spreadsheets/';

function columnLetter(col) {
  let s = '';
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function quoteSheet(name) {
  return /^[A-Za-z0-9_]+$/.test(name) ? name : "'" + name.replace(/'/g, "''") + "'";
}

function toCell(v) {
  if (v === undefined || v === null) return '';
  return v;
}

/** Parses the first row number out of an A1 range such as "STUDENTS!A7:S8". */
function firstRowOf(a1) {
  const m = /!(?:[A-Z]+)?(\d+)/.exec(a1 || '');
  if (!m) throw new Error('Unexpected range in Sheets response: ' + a1);
  return parseInt(m[1], 10);
}

class SheetsStore {
  /** Returns { sheetName: rows[][] } including the header row. One API call for all tabs. */
  async loadTables(spreadsheetId, sheetNames) {
    const params = new URLSearchParams({ valueRenderOption: 'UNFORMATTED_VALUE', dateTimeRenderOption: 'FORMATTED_STRING', majorDimension: 'ROWS' });
    sheetNames.forEach(n => params.append('ranges', quoteSheet(n)));
    const data = await googleFetch(API + encodeURIComponent(spreadsheetId) + '/values:batchGet?' + params);
    const out = {};
    sheetNames.forEach((name, i) => { out[name] = ((data.valueRanges || [])[i] || {}).values || []; });
    return out;
  }

  /** Appends rows after the last row of the tab and returns the sheet row number of the first one. */
  async appendRows(spreadsheetId, sheet, rows) {
    const range = encodeURIComponent(quoteSheet(sheet) + '!A1');
    const url = API + encodeURIComponent(spreadsheetId) + '/values/' + range + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS';
    const data = await googleFetch(url, { method: 'POST', body: JSON.stringify({ values: rows.map(r => r.map(toCell)) }) });
    return firstRowOf(data.updates && data.updates.updatedRange);
  }

  /** updates: [{ sheet, row, col, value }] with 1-based row/col. One API call. */
  async updateCells(spreadsheetId, updates) {
    if (!updates.length) return;
    const data = updates.map(u => ({
      range: quoteSheet(u.sheet) + '!' + columnLetter(u.col) + u.row,
      values: [[toCell(u.value)]]
    }));
    await googleFetch(API + encodeURIComponent(spreadsheetId) + '/values:batchUpdate', {
      method: 'POST', body: JSON.stringify({ valueInputOption: 'RAW', data })
    });
  }

  /** Deletes a row only if the given cell still holds the expected value (guards against shifted rows). */
  async deleteRowIfMatches(spreadsheetId, sheet, row, col, expected) {
    const cell = encodeURIComponent(quoteSheet(sheet) + '!' + columnLetter(col) + row);
    const current = await googleFetch(API + encodeURIComponent(spreadsheetId) + '/values/' + cell);
    const value = current.values && current.values[0] && current.values[0][0];
    if (value !== expected) return false;
    const sheetId = await this._sheetId(spreadsheetId, sheet);
    await googleFetch(API + encodeURIComponent(spreadsheetId) + ':batchUpdate', {
      method: 'POST',
      body: JSON.stringify({ requests: [{ deleteDimension: { range: { sheetId, dimension: 'ROWS', startIndex: row - 1, endIndex: row } } }] })
    });
    return true;
  }

  /** Creates any missing tabs and writes their header rows. Used when onboarding a school. */
  async ensureSheets(spreadsheetId, headersByName) {
    const meta = await googleFetch(API + encodeURIComponent(spreadsheetId) + '?fields=sheets.properties');
    const existing = new Set((meta.sheets || []).map(s => s.properties.title));
    const missing = Object.keys(headersByName).filter(n => !existing.has(n));
    if (missing.length) {
      await googleFetch(API + encodeURIComponent(spreadsheetId) + ':batchUpdate', {
        method: 'POST',
        body: JSON.stringify({ requests: missing.map(title => ({ addSheet: { properties: { title, gridProperties: { frozenRowCount: 1 } } } })) })
      });
    }
    const tables = await this.loadTables(spreadsheetId, Object.keys(headersByName));
    const headerWrites = [];
    Object.keys(headersByName).forEach(name => {
      if (!tables[name].length) headersByName[name].forEach((h, i) => headerWrites.push({ sheet: name, row: 1, col: i + 1, value: h }));
    });
    await this.updateCells(spreadsheetId, headerWrites);
    return missing;
  }

  async _sheetId(spreadsheetId, title) {
    const meta = await googleFetch(API + encodeURIComponent(spreadsheetId) + '?fields=sheets.properties');
    const s = (meta.sheets || []).find(x => x.properties.title === title);
    if (!s) throw new Error('Tab not found: ' + title);
    return s.properties.sheetId;
  }
}

module.exports = { SheetsStore, columnLetter, firstRowOf };
