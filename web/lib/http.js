// Small helpers shared by the API endpoints (work both on Vercel and in the local dev server).
const { getStore } = require('./store');
const { getSchool } = require('./tenants');
const { SchoolContext } = require('./context');
const { readSession, resolveMember } = require('./auth');
const { UserError } = require('./util');

const MAX_BODY = 1024 * 1024;

function sendJson(res, status, obj, headers) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  Object.entries(headers || {}).forEach(([k, v]) => res.setHeader(k, v));
  res.end(JSON.stringify(obj));
}

function query(req) {
  return Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);
}

async function readJson(req) {
  if (req.body !== undefined && req.body !== null && req.body !== '') {
    return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY) throw new UserError('Request too large.');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  return text ? JSON.parse(text) : {};
}

function isSecure(req) {
  const proto = req.headers['x-forwarded-proto'];
  if (proto) return proto.split(',')[0].trim() === 'https';
  return !/^(localhost|127\.0\.0\.1)(:\d+)?$/.test(req.headers.host || '');
}

/**
 * State-changing requests must carry our custom header. Browsers won't send it cross-site
 * without a CORS preflight (which we never allow), so this blocks CSRF.
 */
function checkCsrf(req) {
  return req.headers['x-hastech-request'] === '1';
}

/** Loads the school, the signed-in identity and their membership. Responds with an error and returns null if any is missing. */
async function openSchoolForRequest(req, res, slug) {
  const store = getStore();
  const school = await getSchool(store, String(slug || '').toLowerCase());
  if (!school) { sendJson(res, 404, { error: 'School not found.' }); return null; }
  const identity = readSession(req);
  if (!identity) { sendJson(res, 401, { error: 'Please sign in.' }); return null; }
  const ctx = await SchoolContext.open(store, school, null);
  const member = resolveMember(ctx, identity);
  if (!member) { sendJson(res, 403, { error: 'Your Google account (' + identity.email + ') does not have access to this school.' }); return null; }
  ctx.user = member;
  return { store, school, ctx, member };
}

function handleError(res, err, where) {
  if (err instanceof UserError) return sendJson(res, 200, { success: false, message: err.message });
  if (err instanceof SyntaxError) return sendJson(res, 400, { error: 'Invalid request.' });
  console.error(where + ' failed:', err && err.stack ? err.stack : err);
  const quota = err && err.status === 429;
  return sendJson(res, quota ? 503 : 500, {
    error: quota ? 'The school database is busy. Please wait a few seconds and try again.' : 'Something went wrong. Please try again.'
  });
}

module.exports = { sendJson, query, readJson, isSecure, checkCsrf, openSchoolForRequest, handleError };
