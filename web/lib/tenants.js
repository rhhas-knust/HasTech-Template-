// Looks up schools in the registry spreadsheet (tab SCHOOLS: SLUG | NAME | SPREADSHEET_ID | STATUS | CREATED_AT).
const { REGISTRY_SHEET, REGISTRY_HEADERS } = require('./schema');
const { nowIso } = require('./util');

const CACHE_MS = 60 * 1000;
let cache = { at: 0, schools: null };

function registryId() {
  const id = process.env.REGISTRY_SPREADSHEET_ID || (process.env.STORE === 'memory' ? 'registry' : '');
  if (!id) throw new Error('REGISTRY_SPREADSHEET_ID is not set');
  return id;
}

function isValidSlug(slug) {
  return typeof slug === 'string' && /^[a-z0-9](?:[a-z0-9-]{0,38}[a-z0-9])?$/.test(slug);
}

async function listSchools(store, { fresh } = {}) {
  if (!fresh && cache.schools && Date.now() - cache.at < CACHE_MS) return cache.schools;
  const tables = await store.loadTables(registryId(), [REGISTRY_SHEET]);
  const rows = tables[REGISTRY_SHEET] || [];
  const header = (rows[0] || REGISTRY_HEADERS).map(h => String(h).trim());
  const col = name => header.indexOf(name);
  const schools = rows.slice(1).map(r => ({
    slug: String(r[col('SLUG')] || '').trim().toLowerCase(),
    name: String(r[col('NAME')] || '').trim(),
    spreadsheetId: String(r[col('SPREADSHEET_ID')] || '').trim(),
    status: String(r[col('STATUS')] || 'ACTIVE').trim().toUpperCase() || 'ACTIVE'
  })).filter(s => s.slug && s.spreadsheetId);
  cache = { at: Date.now(), schools };
  return schools;
}

/** Returns { slug, name, spreadsheetId } for an active school, or null. */
async function getSchool(store, slug) {
  if (!isValidSlug(slug)) return null;
  const schools = await listSchools(store);
  return schools.find(s => s.slug === slug && s.status === 'ACTIVE') || null;
}

async function registerSchool(store, { slug, name, spreadsheetId }) {
  if (!isValidSlug(slug)) throw new Error('School link name must be lowercase letters, numbers and dashes, e.g. bright-future');
  await store.ensureSheets(registryId(), { [REGISTRY_SHEET]: REGISTRY_HEADERS });
  const existing = await listSchools(store, { fresh: true });
  if (existing.some(s => s.slug === slug)) return false;
  await store.appendRows(registryId(), REGISTRY_SHEET, [[slug, name, spreadsheetId, 'ACTIVE', nowIso()]]);
  cache = { at: 0, schools: null };
  return true;
}

module.exports = { getSchool, listSchools, registerSchool, isValidSlug, registryId };
