// GET    /api/session?school=slug  -> who am I in this school (401/403 if not)
// POST   /api/session { school, credential }  -> sign in with a Google ID token
// DELETE /api/session  -> sign out
const { sendJson, query, readJson, isSecure, checkCsrf, handleError } = require('../lib/http');
const { getStore } = require('../lib/store');
const { getSchool } = require('../lib/tenants');
const { SchoolContext } = require('../lib/context');
const { SHEETS } = require('../lib/schema');
const auth = require('../lib/auth');

function publicMember(m, ctx) {
  return {
    email: m.email,
    name: m.name,
    picture: m.picture || '',
    role: m.role,
    settings: ctx.settings()
  };
}

async function memberFor(store, slug, identity) {
  const school = await getSchool(store, String(slug || '').toLowerCase());
  if (!school) return { error: [404, 'School not found.'] };
  const ctx = await SchoolContext.open(store, school, null, [SHEETS.SETTINGS, SHEETS.ADMINS]);
  const member = auth.resolveMember(ctx, identity);
  if (!member) return { error: [403, 'Your Google account (' + identity.email + ') does not have access to this school. Ask the school administrator to add it.'] };
  return { member, ctx, school };
}

module.exports = async function handler(req, res) {
  try {
    const store = getStore();
    const secure = isSecure(req);

    if (req.method === 'GET') {
      const identity = auth.readSession(req);
      if (!identity) return sendJson(res, 401, { error: 'Please sign in.' });
      const found = await memberFor(store, query(req).school, identity);
      if (found.error) return sendJson(res, found.error[0], { error: found.error[1] });
      return sendJson(res, 200, publicMember(found.member, found.ctx));
    }

    if (req.method === 'POST') {
      if (!checkCsrf(req)) return sendJson(res, 403, { error: 'Invalid request.' });
      const body = await readJson(req);
      let identity;
      if (body.testEmail && auth.testModeEnabled()) {
        identity = { email: String(body.testEmail).toLowerCase(), name: String(body.testEmail).split('@')[0], picture: '' };
      } else {
        try {
          identity = await auth.verifyGoogleIdToken(body.credential);
        } catch (e) {
          console.error('Google sign-in rejected:', e.message);
          return sendJson(res, 401, { error: 'Google sign-in failed. Please try again.' });
        }
      }
      const found = await memberFor(store, body.school, identity);
      if (found.error) return sendJson(res, found.error[0], { error: found.error[1] });
      found.ctx.user = found.member;
      found.ctx.log('LOGIN', found.member.email + ' signed in', found.member.adminId || '');
      await found.ctx.flush();
      return sendJson(res, 200, publicMember(found.member, found.ctx), { 'Set-Cookie': auth.createSessionCookie(identity, secure) });
    }

    if (req.method === 'DELETE') {
      if (!checkCsrf(req)) return sendJson(res, 403, { error: 'Invalid request.' });
      return sendJson(res, 200, { success: true }, { 'Set-Cookie': auth.clearSessionCookie(secure) });
    }

    return sendJson(res, 405, { error: 'Method not allowed.' });
  } catch (err) {
    return handleError(res, err, 'session');
  }
};
