// "Sign in with Google": verifies Google ID tokens, keeps a signed session cookie, and decides
// whether the signed-in Gmail account is allowed into a given school (and with which role).
const crypto = require('crypto');
const { SHEETS, STATUS, ROLES, ROLE_RANK } = require('./schema');

const COOKIE = 'hst_session';
const SESSION_HOURS = 12;
const GOOGLE_ISSUERS = ['accounts.google.com', 'https://accounts.google.com'];

let jwksCache = { at: 0, maxAge: 0, keys: [] };

function sessionSecret() {
  const s = process.env.SESSION_SECRET;
  if (s && s.length >= 32) return s;
  if (process.env.STORE === 'memory' && !process.env.VERCEL) return 'local-dev-secret-not-for-production-use-0000';
  throw new Error('SESSION_SECRET must be set to a random string of at least 32 characters');
}

function b64urlDecode(s) {
  return Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

function b64urlEncode(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function googleKeys() {
  if (jwksCache.keys.length && Date.now() - jwksCache.at < jwksCache.maxAge) return jwksCache.keys;
  const res = await fetch('https://www.googleapis.com/oauth2/v3/certs');
  if (!res.ok) throw new Error('Could not fetch Google signing keys: ' + res.status);
  const m = /max-age=(\d+)/.exec(res.headers.get('cache-control') || '');
  jwksCache = { at: Date.now(), maxAge: (m ? parseInt(m[1], 10) : 3600) * 1000, keys: (await res.json()).keys || [] };
  return jwksCache.keys;
}

/** Verifies a Google Sign-In credential and returns { email, name, picture }. Throws if invalid. */
async function verifyGoogleIdToken(idToken) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('GOOGLE_CLIENT_ID is not set');
  const parts = String(idToken || '').split('.');
  if (parts.length !== 3) throw new Error('Malformed token');
  const header = JSON.parse(b64urlDecode(parts[0]).toString('utf8'));
  if (header.alg !== 'RS256') throw new Error('Unexpected token algorithm');
  const jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if (!jwk) throw new Error('Unknown signing key');
  const key = crypto.createPublicKey({ key: jwk, format: 'jwk' });
  const valid = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), key, b64urlDecode(parts[2]));
  if (!valid) throw new Error('Bad token signature');

  const claims = JSON.parse(b64urlDecode(parts[1]).toString('utf8'));
  const now = Math.floor(Date.now() / 1000);
  if (GOOGLE_ISSUERS.indexOf(claims.iss) === -1) throw new Error('Wrong token issuer');
  if (claims.aud !== clientId) throw new Error('Token was issued for a different app');
  if (!claims.exp || claims.exp < now - 60) throw new Error('Token expired');
  if (!claims.email || claims.email_verified !== true) throw new Error('Google account email is not verified');
  return { email: String(claims.email).toLowerCase(), name: claims.name || claims.email, picture: claims.picture || '' };
}

function sign(payload) {
  return b64urlEncode(crypto.createHmac('sha256', sessionSecret()).update(payload).digest());
}

function createSessionCookie(identity, secure) {
  const body = b64urlEncode(JSON.stringify({
    email: identity.email, name: identity.name, picture: identity.picture || '',
    exp: Date.now() + SESSION_HOURS * 3600 * 1000
  }));
  const value = body + '.' + sign(body);
  return COOKIE + '=' + value + '; Path=/; HttpOnly; SameSite=Lax; Max-Age=' + SESSION_HOURS * 3600 + (secure ? '; Secure' : '');
}

function clearSessionCookie(secure) {
  return COOKIE + '=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0' + (secure ? '; Secure' : '');
}

/** Returns the signed-in identity from the request cookie, or null. */
function readSession(req) {
  const header = req.headers.cookie || '';
  const match = header.split(/;\s*/).find(c => c.indexOf(COOKIE + '=') === 0);
  if (!match) return null;
  const [body, sig] = match.slice(COOKIE.length + 1).split('.');
  if (!body || !sig) return null;
  const expected = sign(body);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(b64urlDecode(body).toString('utf8'));
    if (!data.exp || data.exp < Date.now()) return null;
    return { email: String(data.email).toLowerCase(), name: data.name, picture: data.picture };
  } catch (e) {
    return null;
  }
}

function superAdmins() {
  return (process.env.HASTECH_SUPER_ADMINS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
}

/**
 * Decides whether this Gmail account may use the school. HASTECH super admins can open any
 * school; everyone else needs an ACTIVE row in the school's ADMINS tab with their email.
 * Returns { email, name, picture, role, adminId } or null.
 */
function resolveMember(ctx, identity) {
  if (!identity) return null;
  if (superAdmins().indexOf(identity.email) !== -1) {
    return Object.assign({}, identity, { role: ROLES.SUPER_ADMIN, adminId: null, hastech: true });
  }
  const row = ctx.rows(SHEETS.ADMINS).find(a => String(a.EMAIL).trim().toLowerCase() === identity.email);
  if (!row || row.STATUS !== STATUS.ACTIVE) return null;
  const role = ROLE_RANK[row.ROLE] ? row.ROLE : ROLES.STAFF;
  return Object.assign({}, identity, { name: row.NAME || identity.name, role, adminId: row.ID });
}

function hasRole(member, minimum) {
  return !!member && (ROLE_RANK[member.role] || 0) >= (ROLE_RANK[minimum] || 99);
}

/** Local development / automated tests only: sign in as any email without Google. */
function testModeEnabled() {
  return process.env.AUTH_TEST_MODE === '1' && process.env.STORE === 'memory' && !process.env.VERCEL;
}

module.exports = {
  verifyGoogleIdToken, createSessionCookie, clearSessionCookie, readSession, resolveMember, hasRole, testModeEnabled, superAdmins
};
