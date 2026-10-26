// Local development server: serves public/ and the api/ functions the same way Vercel does.
// With STORE=memory (the default here) it creates a demo school at http://localhost:3000/demo
// and no Google setup is needed. Usage: npm run dev
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
loadDotEnv(path.join(ROOT, '.env'));
process.env.STORE = process.env.STORE || 'memory';
if (process.env.STORE === 'memory' && process.env.AUTH_TEST_MODE === undefined) process.env.AUTH_TEST_MODE = '1';

const { getStore, isMemoryStore } = require('../lib/store');
const { registerSchool, registryId } = require('../lib/tenants');
const { setupSchool } = require('../lib/domain/setup');

const PORT = parseInt(process.env.PORT || '3000', 10);
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };

function loadDotEnv(file) {
  if (!fs.existsSync(file)) return;
  fs.readFileSync(file, 'utf8').split(/\r?\n/).forEach(line => {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^"(.*)"$/, '$1');
  });
}

async function bootstrapDemo() {
  if (!isMemoryStore()) return;
  const store = getStore();
  store.createSpreadsheet(registryId());
  store.createSpreadsheet('demo-school');
  const added = await registerSchool(store, { slug: 'demo', name: 'Bright Future Academy', spreadsheetId: 'demo-school' });
  if (added) {
    await setupSchool(store, { slug: 'demo', spreadsheetId: 'demo-school' }, {
      schoolName: 'Bright Future Academy', adminEmail: process.env.DEV_ADMIN_EMAIL || 'admin@example.com', adminName: 'Demo Administrator', demo: true
    });
  }
}

function serveStatic(req, res, pathname) {
  let file = pathname === '/' ? '/index.html' : pathname;
  if (/^\/[a-z0-9-]+\/?$/.test(file) && !path.extname(file)) file = '/index.html';
  const full = path.normalize(path.join(ROOT, 'public', file));
  if (!full.startsWith(path.join(ROOT, 'public'))) { res.statusCode = 403; return res.end(); }
  fs.readFile(full, (err, data) => {
    if (err) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(full)] || 'application/octet-stream');
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  const { pathname } = new URL(req.url, 'http://localhost');
  const m = /^\/api\/([a-z]+)$/.exec(pathname);
  if (m) {
    const file = path.join(ROOT, 'api', m[1] + '.js');
    if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
    try { return await require(file)(req, res); } catch (e) { console.error(e); res.statusCode = 500; return res.end('Error'); }
  }
  serveStatic(req, res, pathname);
});

bootstrapDemo().then(() => {
  server.listen(PORT, () => {
    console.log('HASTECH School web app running at http://localhost:' + PORT + (isMemoryStore() ? '/demo  (in-memory demo data)' : ''));
  });
}).catch(e => { console.error('Startup failed:', e); process.exit(1); });

module.exports = server;
