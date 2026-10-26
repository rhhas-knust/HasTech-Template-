// POST /api/rpc  { school, fn, args }  ->  result of an allow-listed function for that school.
// Every call checks the signed-in user's membership, role and the school's enabled modules.
const { sendJson, readJson, checkCsrf, openSchoolForRequest, handleError } = require('../lib/http');
const { hasRole } = require('../lib/auth');
const { ROLES } = require('../lib/schema');
const students = require('../lib/domain/students');
const attendance = require('../lib/domain/attendance');
const payments = require('../lib/domain/payments');
const admin = require('../lib/domain/admin');

const STAFF = ROLES.STAFF;
const ADMIN = ROLES.ADMIN;

// fn name -> { run, role (minimum), module (must be enabled), writes (needs flush) }
const FUNCTIONS = {
  getDashboardStats: { run: admin.getDashboardStats, role: STAFF },
  getClasses: { run: students.getClasses, role: STAFF },
  getStudents: { run: students.getStudents, role: STAFF },
  getStudentProfile: { run: students.getStudentProfile, role: STAFF },
  createStudent: { run: students.createStudent, role: STAFF, writes: true },
  updateStudent: { run: students.updateStudent, role: STAFF, writes: true },

  getStudentsForAttendance: { run: attendance.getStudentsForAttendance, role: STAFF, module: 'attendance' },
  getExistingAttendance: { run: attendance.getExistingAttendance, role: STAFF, module: 'attendance' },
  recordAttendance: { run: attendance.recordAttendance, role: STAFF, module: 'attendance', writes: true },

  getPayments: { run: payments.getPayments, role: STAFF, module: 'payments' },
  recordPayment: { run: payments.recordPayment, role: STAFF, module: 'payments', writes: true },

  getAnnouncements: { run: admin.getAnnouncements, role: STAFF, module: 'announcements' },
  createAnnouncement: { run: admin.createAnnouncement, role: STAFF, module: 'announcements', writes: true },
  updateAnnouncement: { run: admin.updateAnnouncement, role: STAFF, module: 'announcements', writes: true },
  deleteAnnouncement: { run: admin.deleteAnnouncement, role: ADMIN, module: 'announcements', writes: true },
  setAnnouncementStatus: { run: admin.setAnnouncementStatus, role: STAFF, module: 'announcements', writes: true },

  generateReport: { run: admin.generateReport, role: STAFF, module: 'reports' },

  getSettingsForClient: { run: admin.getSettingsForClient, role: ADMIN },
  saveSettings: { run: admin.saveSettings, role: ADMIN, writes: true },
  getAdmins: { run: admin.getAdmins, role: ADMIN },
  addAdmin: { run: admin.addAdmin, role: ADMIN, writes: true },
  setAdminStatus: { run: admin.setAdminStatus, role: ADMIN, writes: true },
  addClass: { run: admin.addClass, role: ADMIN, writes: true }
};

function enabledModules(ctx) {
  return String(ctx.setting('ENABLED_MODULES') || '').split(',').map(s => s.trim()).filter(Boolean);
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed.' });
    if (!checkCsrf(req)) return sendJson(res, 403, { error: 'Invalid request.' });
    const body = await readJson(req);
    const spec = Object.prototype.hasOwnProperty.call(FUNCTIONS, body.fn) ? FUNCTIONS[body.fn] : null;
    if (!spec) return sendJson(res, 404, { error: 'Unknown action.' });

    const opened = await openSchoolForRequest(req, res, body.school);
    if (!opened) return;
    const { ctx, member } = opened;

    if (!hasRole(member, spec.role)) return sendJson(res, 403, { error: 'Your role does not allow this action.' });
    if (spec.module && enabledModules(ctx).indexOf(spec.module) === -1) {
      return sendJson(res, 403, { error: 'This feature is turned off for your school.' });
    }

    const args = Array.isArray(body.args) ? body.args.slice(0, 5) : [];
    const result = await spec.run(ctx, ...args);
    if (spec.writes) await ctx.flush();
    return sendJson(res, 200, { result: result === undefined ? null : result });
  } catch (err) {
    return handleError(res, err, 'rpc');
  }
};

module.exports.FUNCTIONS = FUNCTIONS;
