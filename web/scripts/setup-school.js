// Adds a school to the shared app. Run once per new school from your computer:
//
//   node scripts/setup-school.js --slug bright-future --name "Bright Future Academy" \
//        --sheet <spreadsheet ID> --admin headteacher@gmail.com [--demo]
//
// Before running: create a blank Google Sheet for the school and share it (Editor) with the
// service account email printed below. Reads credentials from .env (see .env.example).
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
if (fs.existsSync(path.join(ROOT, '.env'))) {
  fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split(/\r?\n/).forEach(line => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  });
}

const { getStore } = require('../lib/store');
const { registerSchool, isValidSlug } = require('../lib/tenants');
const { setupSchool } = require('../lib/domain/setup');
const { serviceAccountEmail } = require('../lib/google');

function arg(name) {
  const i = process.argv.indexOf('--' + name);
  return i === -1 ? null : (process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true);
}

function sheetIdFrom(value) {
  const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(value || '');
  return m ? m[1] : value;
}

(async () => {
  const slug = String(arg('slug') || '').toLowerCase();
  const name = arg('name');
  const sheet = sheetIdFrom(arg('sheet'));
  const admin = String(arg('admin') || '').toLowerCase();
  if (!isValidSlug(slug) || !name || !sheet || !/@/.test(admin)) {
    console.log('Usage: node scripts/setup-school.js --slug bright-future --name "Bright Future Academy" --sheet <sheet ID or URL> --admin head@gmail.com [--demo]');
    process.exit(1);
  }
  console.log('Service account (share the sheet with this email as Editor): ' + (serviceAccountEmail() || '(not configured)'));
  const store = getStore();
  const summary = await setupSchool(store, { slug, spreadsheetId: sheet }, {
    schoolName: name, adminEmail: admin, adminName: arg('admin-name') || 'School Administrator', demo: !!arg('demo')
  });
  const added = await registerSchool(store, { slug, name, spreadsheetId: sheet });
  console.log('Sheet prepared:', JSON.stringify(summary));
  console.log(added ? 'Registered "' + slug + '" in the school registry.' : '"' + slug + '" was already registered.');
  console.log('Staff can now open: https://<your-vercel-domain>/' + slug + '  and sign in with ' + admin);
})().catch(e => { console.error('Setup failed:', e.message); process.exit(1); });
