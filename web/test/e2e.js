// End-to-end browser test against the local dev server with in-memory data.
// Needs Playwright with Chromium: npm i -D playwright && npx playwright install chromium
// Run: node test/e2e.js
const path = require('path');
const { spawn } = require('child_process');

function loadPlaywright() {
  for (const p of ['playwright', '/opt/node22/lib/node_modules/playwright']) {
    try { return require(p); } catch (e) { /* try next */ }
  }
  console.error('Playwright is not installed. Run: npm i -D playwright && npx playwright install chromium');
  process.exit(1);
}
const { chromium } = loadPlaywright();

const PORT = 3000 + Math.floor(Math.random() * 1000) + 1000;
const BASE = 'http://localhost:' + PORT;
const results = [];

async function main() {
  const server = spawn(process.execPath, [path.join(__dirname, '..', 'scripts', 'dev-server.js')], {
    env: Object.assign({}, process.env, { PORT: String(PORT), STORE: 'memory', MEMORY_STORE_FILE: 'none', AUTH_TEST_MODE: '1', GOOGLE_CLIENT_ID: '' }),
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let serverLog = '';
  server.stdout.on('data', d => { serverLog += d; });
  server.stderr.on('data', d => { serverLog += d; });
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('dev server did not start: ' + serverLog)), 10000);
    server.stdout.on('data', () => { if (/running at/.test(serverLog)) { clearTimeout(t); resolve(); } });
  });

  const launch = {};
  if (require('fs').existsSync('/opt/pw-browsers/chromium-1194/chrome-linux/chrome')) launch.executablePath = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
  const browser = await chromium.launch(launch);
  try {
    await runScenario(browser);
  } finally {
    await browser.close();
    server.kill();
  }

  let fails = 0;
  results.forEach(r => {
    if (!r.ok) fails++;
    console.log((r.ok ? 'PASS ' : 'FAIL ') + r.name + (r.note ? '  -> ' + r.note : ''));
    r.errs.slice(0, 3).forEach(e => console.log('       console: ' + e));
  });
  console.log('\n' + (results.length - fails) + '/' + results.length + ' passed');
  if (/Error|failed/.test(serverLog)) console.log('\nServer log:\n' + serverLog.split('\n').filter(l => /rror|failed/.test(l)).slice(0, 10).join('\n'));
  process.exit(fails ? 1 : 0);
}

async function newPage(browser) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(5000);
  page.errors = [];
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', e => page.errors.push('PAGEERROR ' + e.message.slice(0, 200)));
  page.on('dialog', d => d.accept());
  await page.addInitScript(() => { window.__opened = []; window.open = url => { window.__opened.push(url); return {}; }; });
  return page;
}

async function runScenario(browser) {
  const page = await newPage(browser);
  const step = async (name, fn) => {
    page.errors = [];
    try { results.push({ name, ok: true, note: (await fn()) || '', errs: page.errors.slice() }); }
    catch (e) { results.push({ name, ok: false, note: e.message.split('\n')[0].slice(0, 220), errs: page.errors.slice() }); }
  };
  const nav = p => page.click('.nav-item[data-page="' + p + '"]');
  const settle = () => page.waitForTimeout(250);
  const toastText = async () => {
    await page.waitForSelector('.toast');
    return page.evaluate(() => { const t = [...document.querySelectorAll('.toast')].map(e => e.innerText.replace(/\n/g, ': ')).join(' | '); document.querySelectorAll('.toast').forEach(e => e.remove()); return t; });
  };
  const rows = sel => page.locator(sel).count();
  const lastPdf = async () => {
    const url = await page.evaluate(() => window.__opened[window.__opened.length - 1]);
    if (!url) throw new Error('no PDF opened');
    const res = await page.request.get(BASE + url);
    if (res.status() !== 200 || res.headers()['content-type'] !== 'application/pdf') throw new Error('PDF ' + res.status() + ' ' + res.headers()['content-type']);
    const body = await res.body();
    if (body.slice(0, 5).toString() !== '%PDF-') throw new Error('not a PDF');
    return body.length + ' bytes';
  };

  await step('Bare domain shows landing page', async () => {
    await page.goto(BASE + '/');
    await page.waitForSelector('#landing-screen:not(.hidden)');
  });

  await step('Unknown school link shows a clear message', async () => {
    await page.goto(BASE + '/no-such-school');
    await page.waitForSelector('#landing-screen:not(.hidden)');
    const t = await page.textContent('#landing-error');
    if (!/couldn.t find a school/.test(t)) throw new Error(t);
  });

  await step('School login screen shows branding', async () => {
    await page.goto(BASE + '/demo');
    await page.waitForSelector('#login-screen:not(.hidden)');
    return await page.textContent('#login-school-name');
  });

  await step('Unknown Gmail account is refused', async () => {
    await page.fill('#test-login-email', 'stranger@example.com');
    await page.click('#test-login-btn');
    await page.waitForFunction(() => /does not have access/.test(document.getElementById('login-error').textContent));
  });

  await step('School admin signs in and sees dashboard', async () => {
    await page.fill('#test-login-email', 'admin@example.com');
    await page.click('#test-login-btn');
    await page.waitForSelector('#app-shell.visible');
    await page.waitForFunction(() => document.getElementById('stat-total-students').textContent === '5');
    return 'role: ' + (await page.textContent('#user-role'));
  });

  await step('Session survives a page reload', async () => {
    await page.reload();
    await page.waitForSelector('#app-shell.visible');
    await page.waitForFunction(() => document.getElementById('stat-total-classes').textContent === '8');
  });

  await step('Student directory lists students', async () => {
    await nav('students');
    await page.waitForSelector('#students-table-body tr button[data-action="view-student"]');
    return (await rows('#students-table-body tr')) + ' rows';
  });

  await step('Register a student', async () => {
    await nav('register-student'); await settle();
    const opts = await page.locator('#sf-class option').count();
    if (opts < 9) throw new Error('class dropdown has ' + opts + ' options');
    await page.fill('#sf-first-name', 'Test'); await page.fill('#sf-last-name', '<b>Pupil</b>');
    await page.fill('#sf-dob', '2016-04-01'); await page.selectOption('#sf-gender', 'Male'); await page.selectOption('#sf-class', 'Primary 3');
    await page.fill('#sf-guardian-name', 'Test Parent');
    await page.click('#student-submit-btn');
    const t = await toastText();
    if (!/registered successfully/.test(t)) throw new Error(t);
    await page.waitForSelector('#page-students.active');
    await page.waitForFunction(() => document.getElementById('students-table-body').textContent.includes('BFA-2026-0006'));
    if (await page.locator('#students-table-body b').count()) throw new Error('HTML in a name was rendered, not escaped');
    return t;
  });

  await step('Profile, edit and profile PDF', async () => {
    await page.click('#students-table-body tr:first-child button[data-action="view-student"]');
    await page.waitForSelector('#student-profile-body .profile-header');
    await page.click('button[data-action="edit-student"]');
    await page.waitForFunction(() => document.getElementById('sf-editing-id').value === 'BFA-2026-0006');
    await page.fill('#sf-middle-name', 'Kofi');
    await page.click('#student-submit-btn');
    const t = await toastText();
    await page.waitForSelector('#student-profile-body .profile-header');
    await page.click('button[data-action="profile-pdf"]');
    return t + ' | PDF ' + (await lastPdf());
  });

  await step('Attendance: mark, save, reload shows saved marks', async () => {
    await nav('attendance');
    await page.selectOption('#att-class', 'Primary 3');
    await page.waitForSelector('#attendance-student-list .attendance-row');
    const n = await rows('#attendance-student-list .attendance-row');
    await page.click('#attendance-student-list .attendance-row:first-child .status-btn.late');
    await page.click('#save-attendance-btn');
    const t = await toastText();
    if (!/saved/.test(t)) throw new Error(t);
    await page.selectOption('#att-class', 'JHS 1'); await settle();
    await page.selectOption('#att-class', 'Primary 3');
    await page.waitForSelector('#attendance-student-list .attendance-row:first-child .status-btn.late.selected');
    return n + ' students';
  });

  await step('Payments: record + receipt PDF', async () => {
    await nav('payments');
    await page.fill('#payment-student-search', 'Ama');
    await page.waitForSelector('#payment-student-results.open [data-action="pick-payment-student"]');
    await page.click('#payment-student-results [data-action="pick-payment-student"]');
    await page.fill('#pay-amount', '150');
    await page.click('#payment-submit-btn');
    const t = await toastText();
    if (!/recorded/.test(t)) throw new Error(t);
    await page.waitForSelector('#payments-table-body button[data-action="receipt"]');
    await page.click('#payments-table-body button[data-action="receipt"]');
    return 'receipt ' + (await lastPdf());
  });

  await step('Announcements: create, edit, unpublish, delete', async () => {
    await nav('announcements');
    await page.waitForSelector('#announcements-list .card');
    const n0 = await rows('#announcements-list .card');
    await page.click('#new-announcement-btn');
    await page.fill('#af-title', 'Sports Day'); await page.fill('#af-message', 'Friday at 9am');
    await page.click('#announcement-submit-btn'); await toastText();
    await page.waitForFunction(n => document.querySelectorAll('#announcements-list .card').length === n + 1, n0);
    const card = page.locator('#announcements-list .card', { hasText: 'Sports Day' });
    await card.locator('[data-action="ann-edit"]').click();
    await page.fill('#af-title', 'Sports Day (moved)'); await page.click('#announcement-submit-btn'); await toastText();
    const moved = page.locator('#announcements-list .card', { hasText: 'Sports Day (moved)' });
    await moved.locator('[data-action="ann-toggle"]').click(); await toastText();
    await page.locator('#announcements-list .card', { hasText: 'Sports Day (moved)' }).locator('[data-action="ann-delete"]').click(); await toastText();
    await page.waitForFunction(n => document.querySelectorAll('#announcements-list .card').length === n, n0);
  });

  for (const type of ['STUDENT_LIST', 'CLASS_LIST', 'ATTENDANCE', 'PAYMENTS', 'OUTSTANDING_FEES', 'REGISTRATION']) {
    await step('Report ' + type, async () => {
      await nav('reports');
      await page.selectOption('#report-type', type);
      await page.click('#report-generate-btn');
      await page.waitForFunction(() => !document.querySelector('#report-results .spinner'));
      const txt = await page.textContent('#report-results');
      if (/Could not/.test(txt)) throw new Error(txt.slice(0, 80));
      return (await rows('#report-results tbody tr')) + ' rows';
    });
  }

  await step('Report PDF export', async () => {
    await page.click('#report-export-btn');
    return await lastPdf();
  });

  await step('Settings: rebrand school', async () => {
    await nav('settings');
    await page.waitForFunction(() => document.getElementById('set-school-name').value !== '');
    await page.fill('#set-school-name', 'Example International School');
    await page.evaluate(() => { document.getElementById('set-primary-color').value = '#7a1f3d'; });
    await page.click('#settings-submit-btn');
    const t = await toastText();
    const side = await page.textContent('#school-name-side');
    const color = await page.evaluate(() => document.documentElement.style.getPropertyValue('--navy'));
    if (side !== 'Example International School' || color !== '#7a1f3d') throw new Error(side + ' ' + color);
    return t;
  });

  await step('Settings: add class appears in dropdowns', async () => {
    await page.click('[data-settings-tab="classes"]');
    await page.waitForSelector('#classes-table-body tr td');
    await page.fill('#cf-name', 'Basic 4'); await page.fill('#cf-fee', '650');
    await page.click('#class-submit-btn');
    const t = await toastText();
    await page.waitForFunction(() => document.getElementById('classes-table-body').textContent.includes('Basic 4'));
    await page.waitForFunction(() => [...document.getElementById('sf-class').options].some(o => o.value === 'Basic 4'));
    return t;
  });

  await step('Settings: give a teacher STAFF access', async () => {
    await page.click('[data-settings-tab="admins"]');
    await page.waitForSelector('#admins-table-body tr td');
    await page.fill('#adf-name', 'Ama Teacher'); await page.fill('#adf-email', 'teacher@example.com'); await page.selectOption('#adf-role', 'STAFF');
    await page.click('#admin-submit-btn');
    const t = await toastText();
    await page.waitForFunction(() => document.getElementById('admins-table-body').textContent.includes('teacher@example.com'));
    return t;
  });

  await step('Settings: turn off Payments hides it everywhere', async () => {
    await page.click('[data-settings-tab="general"]');
    await page.uncheck('.module-toggle[value="payments"]');
    await page.click('#settings-submit-btn'); await toastText();
    if (await page.isVisible('.nav-item[data-page="payments"]')) throw new Error('payments nav still visible');
    await page.check('.module-toggle[value="payments"]');
    await page.click('#settings-submit-btn'); await toastText();
    if (!(await page.isVisible('.nav-item[data-page="payments"]'))) throw new Error('payments nav did not come back');
  });

  await step('Sign out', async () => {
    await page.click('#logout-btn');
    await page.waitForSelector('#login-screen:not(.hidden)');
  });

  const teacher = await newPage(browser);
  await step('Teacher signs in with limited access', async () => {
    await teacher.goto(BASE + '/demo');
    await teacher.fill('#test-login-email', 'teacher@example.com');
    await teacher.click('#test-login-btn');
    await teacher.waitForSelector('#app-shell.visible');
    if (await teacher.isVisible('.nav-item[data-page="settings"]')) throw new Error('settings visible to staff');
    const status = await teacher.evaluate(() => fetch('/api/rpc', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Hastech-Request': '1' }, body: JSON.stringify({ school: 'demo', fn: 'saveSettings', args: [{ SCHOOL_NAME: 'Hacked' }] }) }).then(r => r.status));
    if (status !== 403) throw new Error('saveSettings returned ' + status);
    const name = await teacher.textContent('#school-name-side');
    if (name !== 'Example International School') throw new Error('branding not applied for staff: ' + name);
    return 'settings hidden, API refused (403)';
  });

  await step('Mobile layout: menu opens, no horizontal scroll', async () => {
    await teacher.setViewportSize({ width: 390, height: 844 });
    await teacher.click('#mobile-menu-btn');
    await teacher.waitForSelector('#sidebar.open');
    await teacher.click('#sidebar .nav-item[data-page="students"]');
    await teacher.waitForSelector('#students-table-body tr');
    const overflow = await teacher.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    if (overflow > 2) throw new Error('page scrolls sideways by ' + overflow + 'px');
  });
}

main().catch(e => { console.error('E2E crashed:', e); process.exit(1); });
