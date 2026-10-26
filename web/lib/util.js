// Shared helpers: dates in the school's timezone, input validation, money formatting.
const crypto = require('crypto');

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value) {
  if (value === '' || value === null || value === undefined) return null;
  if (typeof value === 'number') {
    // Sheets serial number (days since 1899-12-30) from a cell a person typed by hand.
    return new Date(Math.round((value - 25569) * 86400000));
  }
  if (typeof value === 'string' && DATE_ONLY.test(value)) return new Date(value + 'T12:00:00Z');
  const d = new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** "yyyy-MM-dd" for a value, as a calendar date in the given timezone. */
function dateKey(value, tz) {
  if (typeof value === 'string' && DATE_ONLY.test(value)) return value;
  const d = parseDate(value);
  if (!d) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(d).map(x => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

function todayKey(tz) {
  return dateKey(new Date(), tz);
}

function timeOf(value) {
  const d = parseDate(value);
  return d ? d.getTime() : 0;
}

function formatLongDate(value, tz) {
  const d = parseDate(value);
  if (!d) return 'N/A';
  const zone = typeof value === 'string' && DATE_ONLY.test(value) ? 'UTC' : tz;
  return new Intl.DateTimeFormat('en-GB', { timeZone: zone, day: 'numeric', month: 'long', year: 'numeric' }).format(d);
}

function nowIso() {
  return new Date().toISOString();
}

function uuid() {
  return crypto.randomUUID();
}

class UserError extends Error {}

/** Trimmed string from user input, limited in length; '' for missing values. */
function str(v, max = 500) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max);
}

function required(value, message) {
  if (value === '' || value === undefined || value === null) throw new UserError(message);
  return value;
}

function oneOf(value, allowed, message) {
  if (allowed.indexOf(value) === -1) throw new UserError(message);
  return value;
}

function optionalDate(value, message) {
  const v = str(value, 40);
  if (v && !DATE_ONLY.test(v)) throw new UserError(message);
  return v;
}

function optionalEmail(value, message) {
  const v = str(value, 200).toLowerCase();
  if (v && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw new UserError(message);
  return v;
}

function formatMoney(amount, currency) {
  return (currency || 'GHS') + ' ' + (Number(amount) || 0).toFixed(2);
}

module.exports = {
  parseDate, dateKey, todayKey, timeOf, formatLongDate, nowIso, uuid,
  UserError, str, required, oneOf, optionalDate, optionalEmail, formatMoney, DATE_ONLY
};
