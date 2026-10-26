// Dashboard, announcements, reports, settings, staff accounts and classes.
const { SHEETS, STATUS, ROLES, AUDIENCES, MODULES, DEFAULT_SETTINGS } = require('../schema');
const { str, required, oneOf, optionalDate, optionalEmail, nowIso, uuid, timeOf, dateKey, UserError } = require('../util');
const { getStudents } = require('./students');
const { todayAttendanceCount, attendanceReport } = require('./attendance');
const { getPayments, paymentsThisMonth, outstandingFeesReport } = require('./payments');

// ---------- Dashboard ----------

function getDashboardStats(ctx) {
  const students = ctx.rows(SHEETS.STUDENTS);
  const outstanding = outstandingFeesReport(ctx);
  return {
    totalStudents: students.length,
    activeStudents: students.filter(s => s.STATUS === STATUS.ACTIVE).length,
    totalClasses: ctx.rows(SHEETS.CLASSES).length,
    todayAttendance: todayAttendanceCount(ctx),
    outstandingFees: outstanding.reduce((sum, r) => sum + r.OUTSTANDING, 0),
    paymentsThisMonth: paymentsThisMonth(ctx),
    recentStudents: students.sort((a, b) => timeOf(b.CREATED_AT) - timeOf(a.CREATED_AT)).slice(0, 5),
    recentActivity: ctx.rows(SHEETS.ACTIVITY_LOG).sort((a, b) => timeOf(b.TIMESTAMP) - timeOf(a.TIMESTAMP)).slice(0, 8),
    announcements: getAnnouncements(ctx, { status: 'PUBLISHED' }).slice(0, 5),
    settings: ctx.settings()
  };
}

// ---------- Announcements ----------

function readAnnouncement(ctx, data) {
  data = data || {};
  const audience = oneOf(str(data.audience), AUDIENCES, 'Please select an audience.');
  return {
    TITLE: required(str(data.title, 200), 'Please enter a title.'),
    MESSAGE: required(str(data.message, 5000), 'Please enter a message.'),
    AUDIENCE: audience,
    CLASS_NAME: audience === 'Specific Class' ? str(data.className, 80) : '',
    DATE: optionalDate(data.date, 'Please enter a valid date.') || nowIso().slice(0, 10)
  };
}

function createAnnouncement(ctx, data) {
  const obj = Object.assign({ ANNOUNCEMENT_ID: uuid() }, readAnnouncement(ctx, data), {
    STATUS: 'PUBLISHED', CREATED_BY: ctx.userLabel(), CREATED_AT: nowIso()
  });
  ctx.append(SHEETS.ANNOUNCEMENTS, obj);
  ctx.log('ANNOUNCEMENT_CREATED', 'Created announcement "' + obj.TITLE + '"', obj.ANNOUNCEMENT_ID);
  return { success: true, announcement: obj, message: 'Announcement created.' };
}

function updateAnnouncement(ctx, data) {
  const id = required(str(data && data.announcementId, 60), 'Missing announcement ID.');
  if (!ctx.update(SHEETS.ANNOUNCEMENTS, 'ANNOUNCEMENT_ID', id, readAnnouncement(ctx, data))) {
    return { success: false, message: 'Announcement not found.' };
  }
  ctx.log('ANNOUNCEMENT_UPDATED', 'Updated announcement ' + id, id);
  return { success: true, message: 'Announcement updated.' };
}

async function deleteAnnouncement(ctx, announcementId) {
  const id = str(announcementId, 60);
  if (!(await ctx.remove(SHEETS.ANNOUNCEMENTS, 'ANNOUNCEMENT_ID', id))) {
    return { success: false, message: 'Announcement not found (it may have just been changed). Please refresh.' };
  }
  ctx.log('ANNOUNCEMENT_DELETED', 'Deleted announcement ' + id, id);
  return { success: true, message: 'Announcement deleted.' };
}

function setAnnouncementStatus(ctx, announcementId, status) {
  const id = str(announcementId, 60);
  const s = oneOf(str(status), ['PUBLISHED', 'UNPUBLISHED'], 'Invalid status.');
  if (!ctx.update(SHEETS.ANNOUNCEMENTS, 'ANNOUNCEMENT_ID', id, { STATUS: s })) {
    return { success: false, message: 'Announcement not found.' };
  }
  ctx.log(s === 'PUBLISHED' ? 'ANNOUNCEMENT_PUBLISHED' : 'ANNOUNCEMENT_UNPUBLISHED', 'Set announcement ' + id + ' to ' + s, id);
  return { success: true, message: 'Announcement ' + (s === 'PUBLISHED' ? 'published' : 'unpublished') + '.' };
}

function getAnnouncements(ctx, filters) {
  filters = filters || {};
  let rows = ctx.rows(SHEETS.ANNOUNCEMENTS);
  if (filters.status) rows = rows.filter(a => a.STATUS === filters.status);
  if (filters.audience) rows = rows.filter(a => a.AUDIENCE === filters.audience);
  return rows.sort((a, b) => timeOf(b.DATE) - timeOf(a.DATE) || timeOf(b.CREATED_AT) - timeOf(a.CREATED_AT));
}

// ---------- Reports ----------

const REPORT_TITLES = {
  STUDENT_LIST: 'Student List',
  CLASS_LIST: 'Class List',
  ATTENDANCE: 'Attendance Report',
  PAYMENTS: 'Payment Report',
  OUTSTANDING_FEES: 'Outstanding Fees Report',
  REGISTRATION: 'Registration Report'
};

function cleanReportFilters(filters) {
  filters = filters || {};
  return {
    className: str(filters.className, 80),
    startDate: optionalDate(filters.startDate, 'Please enter a valid start date.'),
    endDate: optionalDate(filters.endDate, 'Please enter a valid end date.')
  };
}

function generateReport(ctx, type, filters) {
  const f = cleanReportFilters(filters);
  if (!Object.prototype.hasOwnProperty.call(REPORT_TITLES, type)) return { success: false, message: 'Unknown report type.' };
  const title = REPORT_TITLES[type];
  let rows;
  switch (type) {
    case 'STUDENT_LIST':
    case 'CLASS_LIST':
      rows = getStudents(ctx, { className: f.className });
      if (type === 'CLASS_LIST') rows.sort((a, b) => String(a.CLASS).localeCompare(String(b.CLASS)) || String(a.LAST_NAME).localeCompare(String(b.LAST_NAME)));
      break;
    case 'ATTENDANCE': rows = attendanceReport(ctx, f); break;
    case 'PAYMENTS': rows = getPayments(ctx, f); break;
    case 'OUTSTANDING_FEES': rows = outstandingFeesReport(ctx); break;
    case 'REGISTRATION': {
      const tz = ctx.timezone();
      rows = getStudents(ctx, { className: f.className }).filter(s => {
        const k = dateKey(s.CREATED_AT, tz);
        return (!f.startDate || k >= f.startDate) && (!f.endDate || k <= f.endDate);
      });
      break;
    }
  }
  return { success: true, title, rows };
}

// ---------- Settings ----------

const EDITABLE_SETTINGS = Object.keys(DEFAULT_SETTINGS);

function getSettingsForClient(ctx) {
  return ctx.settings();
}

function saveSettings(ctx, data) {
  data = data || {};
  const clean = {};
  EDITABLE_SETTINGS.forEach(key => {
    if (data[key] === undefined) return;
    clean[key] = str(data[key], key === 'SCHOOL_ADDRESS' ? 500 : 200);
  });
  if (!Object.keys(clean).length) return { success: false, message: 'No settings to save.' };
  if (clean.SCHOOL_NAME === '') throw new UserError('Please enter the school name.');
  ['PRIMARY_COLOR', 'ACCENT_COLOR'].forEach(k => {
    if (clean[k] && !/^#[0-9a-fA-F]{6}$/.test(clean[k])) throw new UserError('Colours must look like #0F2A4A.');
  });
  if (clean.SCHOOL_LOGO_URL && !/^https:\/\//i.test(clean.SCHOOL_LOGO_URL)) throw new UserError('The logo link must start with https://');
  if (clean.TIMEZONE) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: clean.TIMEZONE }); } catch (e) { throw new UserError('Unknown timezone, e.g. Africa/Accra.'); }
  }
  if (clean.ENABLED_MODULES !== undefined) {
    clean.ENABLED_MODULES = clean.ENABLED_MODULES.split(',').map(s => s.trim()).filter(m => MODULES.indexOf(m) !== -1).join(',');
  }
  ['SCHOOL_EMAIL', 'ADMIN_EMAIL'].forEach(k => { if (clean[k] !== undefined) clean[k] = optionalEmail(clean[k], 'Please enter a valid email address.'); });

  const existing = new Set(ctx.rows(SHEETS.SETTINGS).map(r => r.SETTING));
  Object.keys(clean).forEach(key => {
    if (existing.has(key)) ctx.update(SHEETS.SETTINGS, 'SETTING', key, { VALUE: clean[key] });
    else ctx.append(SHEETS.SETTINGS, { SETTING: key, VALUE: clean[key] });
  });
  ctx._settings = null;
  ctx.log('SETTINGS_UPDATED', 'Updated settings: ' + Object.keys(clean).join(', '), '');
  return { success: true, settings: ctx.settings(), message: 'Settings saved successfully.' };
}

// ---------- Staff accounts ----------

function getAdmins(ctx) {
  return ctx.rows(SHEETS.ADMINS);
}

function addAdmin(ctx, data) {
  data = data || {};
  const email = required(optionalEmail(data.email, 'Please enter a valid Google account email.'), 'Please enter their Google account email.');
  const name = required(str(data.name, 120), 'Please enter their full name.');
  const role = oneOf(str(data.role), Object.values(ROLES), 'Please select a role.');
  if (role === ROLES.SUPER_ADMIN && ctx.user.role !== ROLES.SUPER_ADMIN) {
    throw new UserError('Only a super admin can create another super admin.');
  }
  if (ctx.rows(SHEETS.ADMINS).some(a => String(a.EMAIL).toLowerCase() === email)) {
    return { success: false, message: 'This email already has access.' };
  }
  const obj = {
    ID: uuid(), NAME: name, EMAIL: email, USERNAME: str(data.username, 60) || email.split('@')[0],
    ROLE: role, STATUS: STATUS.ACTIVE, CREATED_AT: nowIso()
  };
  ctx.append(SHEETS.ADMINS, obj);
  ctx.log('ADMIN_CREATED', 'Gave ' + email + ' ' + role + ' access', obj.ID);
  return { success: true, admin: obj, message: 'Staff member added. They can now sign in with ' + email + '.' };
}

function setAdminStatus(ctx, adminId, status) {
  const id = str(adminId, 60);
  const s = oneOf(str(status), [STATUS.ACTIVE, STATUS.INACTIVE], 'Invalid status.');
  const target = ctx.find(SHEETS.ADMINS, 'ID', id);
  if (!target) return { success: false, message: 'Staff member not found.' };
  if (String(target.EMAIL).toLowerCase() === ctx.user.email && s === STATUS.INACTIVE) {
    return { success: false, message: 'You cannot deactivate your own account.' };
  }
  if (target.ROLE === ROLES.SUPER_ADMIN && ctx.user.role !== ROLES.SUPER_ADMIN) {
    return { success: false, message: 'Only a super admin can change a super admin.' };
  }
  ctx.update(SHEETS.ADMINS, 'ID', id, { STATUS: s });
  ctx.log('ADMIN_UPDATED', 'Set ' + target.EMAIL + ' to ' + s, id);
  return { success: true, message: 'Staff status updated.' };
}

// ---------- Classes ----------

function addClass(ctx, data) {
  data = data || {};
  const name = required(str(data.className, 80), 'Please enter a class name.');
  if (ctx.rows(SHEETS.CLASSES).some(c => String(c.CLASS_NAME).toLowerCase() === name.toLowerCase())) {
    return { success: false, message: 'This class already exists.' };
  }
  const fee = data.expectedFee === '' || data.expectedFee === undefined ? 0 : parseFloat(data.expectedFee);
  if (!isFinite(fee) || fee < 0) throw new UserError('Please enter a valid expected fee.');
  const obj = {
    CLASS_ID: uuid(), CLASS_NAME: name,
    ACADEMIC_YEAR: str(data.academicYear, 20) || String(ctx.setting('ACADEMIC_YEAR')),
    EXPECTED_FEE: Math.round(fee * 100) / 100, IS_DEMO: false, CREATED_AT: nowIso()
  };
  ctx.append(SHEETS.CLASSES, obj);
  ctx.log('CLASS_CREATED', 'Added class ' + name, obj.CLASS_ID);
  return { success: true, classObj: obj, message: 'Class added successfully.' };
}

module.exports = {
  getDashboardStats, createAnnouncement, updateAnnouncement, deleteAnnouncement, setAnnouncementStatus, getAnnouncements,
  generateReport, REPORT_TITLES, getSettingsForClient, saveSettings, getAdmins, addAdmin, setAdminStatus, addClass
};
