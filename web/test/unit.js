// Unit tests: node test/unit.js (no dependencies; uses the in-memory store and a fake fetch).
process.env.STORE = 'memory';
process.env.MEMORY_STORE_FILE = 'none';
process.env.SESSION_SECRET = 'x'.repeat(40);

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');

const { MemoryStore } = require('../lib/store/memory');
const { SheetsStore, columnLetter, firstRowOf } = require('../lib/store/sheets');
const { SchoolContext } = require('../lib/context');
const { setupSchool } = require('../lib/domain/setup');
const { SHEETS } = require('../lib/schema');
const students = require('../lib/domain/students');
const attendance = require('../lib/domain/attendance');
const payments = require('../lib/domain/payments');
const admin = require('../lib/domain/admin');
const { dateKey, UserError } = require('../lib/util');

const SCHOOL = { slug: 't', spreadsheetId: 'sheet-t' };
const ADMIN = { email: 'head@example.com', name: 'Head', role: 'SUPER_ADMIN' };

async function freshSchool() {
  const store = new MemoryStore(null);
  store.createSpreadsheet(SCHOOL.spreadsheetId);
  await setupSchool(store, SCHOOL, { schoolName: 'Bright Future Academy', adminEmail: ADMIN.email, demo: true });
  return store;
}

const open = (store, user) => SchoolContext.open(store, SCHOOL, user || ADMIN);

test('A1 helpers', () => {
  assert.equal(columnLetter(1), 'A');
  assert.equal(columnLetter(26), 'Z');
  assert.equal(columnLetter(27), 'AA');
  assert.equal(firstRowOf('STUDENTS!A7:S7'), 7);
  assert.equal(firstRowOf("'My Tab'!A12:C14"), 12);
});

test('setup is idempotent and seeds demo data', async () => {
  const store = await freshSchool();
  await setupSchool(store, SCHOOL, { schoolName: 'Bright Future Academy', adminEmail: ADMIN.email, demo: true });
  const ctx = await open(store);
  assert.equal(ctx.rows(SHEETS.STUDENTS).length, 5);
  assert.equal(ctx.rows(SHEETS.CLASSES).length, 8);
  assert.equal(ctx.rows(SHEETS.ADMINS).length, 1);
  assert.deepEqual(ctx.rows(SHEETS.STUDENTS).map(s => s.STUDENT_ID), ['BFA-2026-0001', 'BFA-2026-0002', 'BFA-2026-0003', 'BFA-2026-0004', 'BFA-2026-0005']);
});

test('two simultaneous registrations get different student IDs', async () => {
  const store = await freshSchool();
  // Both requests read the same snapshot before either writes.
  const [a, b] = await Promise.all([open(store), open(store)]);
  const form = n => ({ firstName: 'Kid' + n, lastName: 'Test', dob: '2016-01-01', gender: 'Male', className: 'Primary 1' });
  const [ra, rb] = await Promise.all([students.createStudent(a, form(1)), students.createStudent(b, form(2))]);
  await Promise.all([a.flush(), b.flush()]);
  assert.notEqual(ra.student.STUDENT_ID, rb.student.STUDENT_ID);
  const ids = (await open(store)).rows(SHEETS.STUDENTS).map(s => s.STUDENT_ID);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('BFA-2026-0006') && ids.includes('BFA-2026-0007'));
});

test('student validation rejects bad input', async () => {
  const ctx = await open(await freshSchool());
  await assert.rejects(students.createStudent(ctx, { firstName: '', lastName: 'X', dob: '2016-01-01', gender: 'Male', className: 'Primary 1' }), UserError);
  await assert.rejects(students.createStudent(ctx, { firstName: 'A', lastName: 'X', dob: '2016-01-01', gender: 'Male', className: 'No Such Class' }), /select a class/);
  await assert.rejects(students.createStudent(ctx, { firstName: 'A', lastName: 'X', dob: 'yesterday', gender: 'Male', className: 'Primary 1' }), /valid date/);
  await assert.rejects(students.createStudent(ctx, { firstName: 'A', lastName: 'X', dob: '2016-01-01', gender: 'Male', className: 'Primary 1', photoUrl: 'javascript:alert(1)' }), /https/);
});

test('re-saving attendance overwrites instead of duplicating', async () => {
  const store = await freshSchool();
  let ctx = await open(store);
  const kids = attendance.getStudentsForAttendance(ctx, 'Primary 3');
  assert.equal(kids.length, 2);
  attendance.recordAttendance(ctx, '2026-10-05', 'Primary 3', kids.map(k => ({ studentId: k.STUDENT_ID, status: 'Present' })));
  await ctx.flush();
  ctx = await open(store);
  attendance.recordAttendance(ctx, '2026-10-05', 'Primary 3', [{ studentId: kids[0].STUDENT_ID, status: 'Late' }, { studentId: kids[1].STUDENT_ID, status: 'Absent' }]);
  await ctx.flush();
  ctx = await open(store);
  assert.equal(ctx.rows(SHEETS.ATTENDANCE).length, 2);
  assert.deepEqual(attendance.getExistingAttendance(ctx, '2026-10-05', 'Primary 3'), { [kids[0].STUDENT_ID]: 'Late', [kids[1].STUDENT_ID]: 'Absent' });
  const summary = attendance.attendanceSummary(ctx, kids[1].STUDENT_ID);
  assert.equal(summary.absent, 1);
  assert.throws(() => attendance.recordAttendance(ctx, '2026-10-05', 'Primary 3', [{ studentId: kids[0].STUDENT_ID, status: 'Sleeping' }]), /Invalid attendance status/);
});

test('payments: sequential IDs, totals, outstanding, receipt number', async () => {
  const store = await freshSchool();
  let ctx = await open(store);
  const r1 = await payments.recordPayment(ctx, { studentId: 'BFA-2026-0001', paymentType: 'School Fees', amount: '150.555', paymentDate: '2026-10-02', paymentMethod: 'Cash' });
  const r2 = await payments.recordPayment(ctx, { studentId: 'BFA-2026-0001', paymentType: 'Books', amount: 50, paymentDate: '2026-10-03', paymentMethod: 'Mobile Money' });
  await ctx.flush();
  assert.equal(r1.payment.PAYMENT_ID, 'PAY-000001');
  assert.equal(r2.payment.PAYMENT_ID, 'PAY-000002');
  assert.equal(r1.payment.AMOUNT, 150.56);
  assert.equal(payments.receiptNumber('PAY-000002'), 'RCT-000002');
  ctx = await open(store);
  const out = payments.outstandingFeesReport(ctx).find(r => r.STUDENT_ID === 'BFA-2026-0001');
  assert.equal(out.PAID, 200.56);
  assert.equal(out.OUTSTANDING, 299.44);
  await assert.rejects(payments.recordPayment(ctx, { studentId: 'BFA-2026-0001', paymentType: 'Bribe', amount: 5, paymentDate: '2026-10-03', paymentMethod: 'Cash' }), /payment type/);
  await assert.rejects(payments.recordPayment(ctx, { studentId: 'BFA-2026-0001', paymentType: 'Books', amount: -5, paymentDate: '2026-10-03', paymentMethod: 'Cash' }), /valid payment amount/);
});

test('settings: branding validation and modules', async () => {
  const store = await freshSchool();
  let ctx = await open(store);
  assert.throws(() => admin.saveSettings(ctx, { PRIMARY_COLOR: 'red' }), /Colours/);
  assert.throws(() => admin.saveSettings(ctx, { SCHOOL_LOGO_URL: 'http://insecure.example/logo.png' }), /https/);
  assert.throws(() => admin.saveSettings(ctx, { TIMEZONE: 'Mars/Olympus' }), /timezone/);
  const res = admin.saveSettings(ctx, { SCHOOL_NAME: 'Example International School', PRIMARY_COLOR: '#123456', ENABLED_MODULES: 'payments,bogus,reports' });
  await ctx.flush();
  assert.equal(res.settings.ENABLED_MODULES, 'payments,reports');
  ctx = await open(store);
  assert.equal(ctx.setting('SCHOOL_NAME'), 'Example International School');
  assert.equal(ctx.setting('PRIMARY_COLOR'), '#123456');
  assert.equal(students.studentIdPrefix(ctx), 'EIS-2026-');
});

test('staff: add, duplicates, cannot deactivate self, admins cannot mint super admins', async () => {
  const store = await freshSchool();
  let ctx = await open(store);
  assert.equal(admin.addAdmin(ctx, { name: 'Ama Teacher', email: 'Ama.Teacher@Gmail.com', role: 'STAFF' }).success, true);
  await ctx.flush();
  ctx = await open(store);
  assert.equal(admin.addAdmin(ctx, { name: 'Dup', email: 'ama.teacher@gmail.com', role: 'STAFF' }).success, false);
  const me = ctx.rows(SHEETS.ADMINS).find(a => a.EMAIL === ADMIN.email);
  assert.equal(admin.setAdminStatus(ctx, me.ID, 'INACTIVE').success, false);
  const plainAdmin = await open(store, { email: 'x@example.com', name: 'X', role: 'ADMIN' });
  assert.throws(() => admin.addAdmin(plainAdmin, { name: 'Boss', email: 'boss@example.com', role: 'SUPER_ADMIN' }), /super admin/);
});

test('announcements: create, update, delete', async () => {
  const store = await freshSchool();
  let ctx = await open(store);
  const created = admin.createAnnouncement(ctx, { title: 'Sports Day', message: 'Friday', audience: 'All Students' });
  await ctx.flush();
  ctx = await open(store);
  assert.equal(admin.updateAnnouncement(ctx, { announcementId: created.announcement.ANNOUNCEMENT_ID, title: 'Sports Day!', message: 'Saturday', audience: 'Teachers' }).success, true);
  await ctx.flush();
  ctx = await open(store);
  assert.equal(admin.getAnnouncements(ctx).find(a => a.ANNOUNCEMENT_ID === created.announcement.ANNOUNCEMENT_ID).AUDIENCE, 'Teachers');
  assert.equal((await admin.deleteAnnouncement(ctx, created.announcement.ANNOUNCEMENT_ID)).success, true);
  ctx = await open(store);
  assert.equal(admin.getAnnouncements(ctx).length, 2);
});

test('dates are bucketed in the school timezone', () => {
  // 23:30 UTC on Oct 5 is already Oct 6 in Auckland and still Oct 5 in Accra.
  assert.equal(dateKey('2026-10-05T23:30:00.000Z', 'Africa/Accra'), '2026-10-05');
  assert.equal(dateKey('2026-10-05T23:30:00.000Z', 'Pacific/Auckland'), '2026-10-06');
  assert.equal(dateKey('2026-10-05', 'Pacific/Auckland'), '2026-10-05');
  assert.equal(dateKey(46300, 'Africa/Accra'), '2026-10-05');
});

test('SheetsStore builds the right API calls', async () => {
  process.env.GOOGLE_SERVICE_ACCOUNT_JSON = JSON.stringify({
    client_email: 'sa@test.iam.gserviceaccount.com',
    private_key: crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs8', format: 'pem' })
  });
  const calls = [];
  const realFetch = global.fetch;
  global.fetch = async (url, opts = {}) => {
    calls.push({ url: String(url), method: opts.method || 'GET', body: opts.body });
    const json = body => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body), headers: new Map() });
    if (String(url).includes('oauth2.googleapis.com/token')) return json({ access_token: 'tok', expires_in: 3600 });
    if (String(url).includes(':append')) return json({ updates: { updatedRange: 'STUDENTS!A9:S9' } });
    if (String(url).includes('values:batchGet')) return json({ valueRanges: [{ values: [['SETTING', 'VALUE'], ['SCHOOL_NAME', 'X']] }, {}] });
    return json({});
  };
  try {
    const store = new SheetsStore();
    const tables = await store.loadTables('abc', ['SETTINGS', 'ADMINS']);
    assert.deepEqual(tables.SETTINGS[1], ['SCHOOL_NAME', 'X']);
    assert.deepEqual(tables.ADMINS, []);
    assert.equal(await store.appendRows('abc', 'STUDENTS', [['', 'Ama']]), 9);
    await store.updateCells('abc', [{ sheet: 'STUDENTS', row: 9, col: 1, value: 'BFA-2026-0008' }]);
    const batchGet = calls.find(c => c.url.includes('batchGet'));
    assert.match(batchGet.url, /ranges=SETTINGS&ranges=ADMINS/);
    assert.match(batchGet.url, /valueRenderOption=UNFORMATTED_VALUE/);
    const append = calls.find(c => c.url.includes(':append'));
    assert.match(append.url, /valueInputOption=RAW/);
    const update = calls.find(c => c.url.includes('values:batchUpdate'));
    assert.deepEqual(JSON.parse(update.body).data, [{ range: 'STUDENTS!A9', values: [['BFA-2026-0008']] }]);
    assert.equal(calls.filter(c => c.url.includes('oauth2')).length, 1, 'token is cached');
  } finally {
    global.fetch = realFetch;
  }
});

test('Google sign-in tokens are verified properly', async () => {
  const auth = require('../lib/auth');
  process.env.GOOGLE_CLIENT_ID = 'client-123.apps.googleusercontent.com';
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const jwk = Object.assign(publicKey.export({ format: 'jwk' }), { kid: 'k1', alg: 'RS256' });
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => ({ keys: [jwk] }), headers: { get: () => 'max-age=3600' } });
  const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
  const make = (claims, kid = 'k1') => {
    const h = b64({ alg: 'RS256', kid }), p = b64(claims);
    return h + '.' + p + '.' + crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), privateKey).toString('base64url');
  };
  const now = Math.floor(Date.now() / 1000);
  const good = { iss: 'https://accounts.google.com', aud: process.env.GOOGLE_CLIENT_ID, exp: now + 600, email: 'Head@Example.com', email_verified: true, name: 'Head' };
  try {
    assert.equal((await auth.verifyGoogleIdToken(make(good))).email, 'head@example.com');
    await assert.rejects(auth.verifyGoogleIdToken(make(Object.assign({}, good, { aud: 'someone-else' }))), /different app/);
    await assert.rejects(auth.verifyGoogleIdToken(make(Object.assign({}, good, { exp: now - 3600 }))), /expired/);
    await assert.rejects(auth.verifyGoogleIdToken(make(Object.assign({}, good, { email_verified: false }))), /not verified/);
    await assert.rejects(auth.verifyGoogleIdToken(make(Object.assign({}, good, { iss: 'evil.com' }))), /issuer/);
    const forged = make(good).split('.');
    forged[1] = b64(Object.assign({}, good, { email: 'attacker@example.com' }));
    await assert.rejects(auth.verifyGoogleIdToken(forged.join('.')), /signature/);
  } finally {
    global.fetch = realFetch;
  }

  const cookie = auth.createSessionCookie({ email: 'head@example.com', name: 'Head' }, true).split(';')[0];
  assert.equal(auth.readSession({ headers: { cookie } }).email, 'head@example.com');
  const [name, value] = cookie.split('=');
  const tampered = name + '=' + Buffer.from(JSON.stringify({ email: 'attacker@example.com', exp: Date.now() + 1e6 })).toString('base64url') + '.' + value.split('.')[1];
  assert.equal(auth.readSession({ headers: { cookie: tampered } }), null);
});

test('membership, roles and modules are enforced by /api/rpc', async () => {
  const { setStore } = require('../lib/store');
  const { registerSchool } = require('../lib/tenants');
  const auth = require('../lib/auth');
  const rpc = require('../api/rpc');
  const store = await freshSchool();
  store.createSpreadsheet('registry');
  setStore(store);
  await registerSchool(store, { slug: 't', name: 'T', spreadsheetId: SCHOOL.spreadsheetId });
  let ctx = await open(store);
  admin.addAdmin(ctx, { name: 'Staff One', email: 'staff@example.com', role: 'STAFF' });
  await ctx.flush();

  const invoke = async (email, fn, args) => {
    const headers = { 'x-hastech-request': '1', host: 'localhost' };
    if (email) headers.cookie = auth.createSessionCookie({ email, name: email }, false).split(';')[0];
    const res = { statusCode: 0, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = JSON.parse(b); } };
    await rpc({ method: 'POST', url: '/api/rpc', headers, body: { school: 't', fn, args: args || [] } }, res);
    return res;
  };
  assert.equal((await invoke(null, 'getStudents', [{}])).statusCode, 401);
  assert.equal((await invoke('stranger@example.com', 'getStudents', [{}])).statusCode, 403);
  assert.equal((await invoke('staff@example.com', 'getStudents', [{}])).statusCode, 200);
  assert.equal((await invoke('staff@example.com', 'saveSettings', [{ SCHOOL_NAME: 'Hacked' }])).statusCode, 403);
  assert.equal((await invoke('staff@example.com', 'eval', ['1'])).statusCode, 404);
  assert.equal((await invoke('head@example.com', 'saveSettings', [{ ENABLED_MODULES: 'reports' }])).statusCode, 200);
  assert.equal((await invoke('staff@example.com', 'getPayments', [{}])).statusCode, 403);
  const bad = await invoke('head@example.com', 'createStudent', [{ firstName: '' }]);
  assert.equal(bad.statusCode, 200);
  assert.equal(bad.body.success, false);
});
