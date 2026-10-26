// GET /api/school?slug=bright-future -> public branding for the login screen.
const { sendJson, query, handleError } = require('../lib/http');
const { getStore } = require('../lib/store');
const { getSchool } = require('../lib/tenants');
const { SchoolContext } = require('../lib/context');
const { SHEETS, PUBLIC_SETTINGS } = require('../lib/schema');
const { testModeEnabled } = require('../lib/auth');

module.exports = async function handler(req, res) {
  try {
    const store = getStore();
    const school = await getSchool(store, String(query(req).slug || '').toLowerCase());
    if (!school) return sendJson(res, 404, { error: 'School not found. Check the link you were given.' });
    const ctx = await SchoolContext.open(store, school, null, [SHEETS.SETTINGS]);
    const branding = {};
    PUBLIC_SETTINGS.forEach(k => { branding[k] = ctx.setting(k); });
    return sendJson(res, 200, {
      slug: school.slug,
      branding,
      googleClientId: process.env.GOOGLE_CLIENT_ID || '',
      testMode: testModeEnabled()
    });
  } catch (err) {
    return handleError(res, err, 'school');
  }
};
