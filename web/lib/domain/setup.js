// Prepares a school's spreadsheet: tabs, headers, default settings, first admin, optional demo data.
// Safe to run more than once - it only adds what is missing.
const { SHEETS, HEADERS, DEFAULT_SETTINGS, STATUS, ROLES } = require('../schema');
const { SchoolContext } = require('../context');
const { nowIso, uuid } = require('../util');
const { studentIdPrefix } = require('./students');

const DEMO_CLASSES = ['Nursery 1', 'Nursery 2', 'Primary 1', 'Primary 2', 'Primary 3', 'JHS 1', 'JHS 2', 'JHS 3'];
const DEMO_STUDENTS = [
  ['Ama', '', 'Owusu', '2015-03-12', 'Female', 'Primary 3', 'Kwabena Owusu', 'Father', '0244000001'],
  ['Kwame', 'Yaw', 'Mensah', '2014-07-22', 'Male', 'Primary 3', 'Efua Mensah', 'Mother', '0244000002'],
  ['Esi', '', 'Boateng', '2012-01-05', 'Female', 'JHS 1', 'Yaw Boateng', 'Father', '0244000003'],
  ['Kofi', '', 'Asante', '2011-11-30', 'Male', 'JHS 2', 'Abena Asante', 'Mother', '0244000004'],
  ['Adjoa', '', 'Darko', '2017-05-18', 'Female', 'Nursery 2', 'Kojo Darko', 'Father', '0244000005']
];

/**
 * options: { schoolName, adminEmail, adminName, classes (array), demo (bool) }
 * Returns a summary of what was created.
 */
async function setupSchool(store, school, options) {
  const created = await store.ensureSheets(school.spreadsheetId, HEADERS);
  const ctx = await SchoolContext.open(store, school, { email: 'system', name: 'SYSTEM', role: ROLES.SUPER_ADMIN });
  const now = nowIso();
  const summary = { tabsCreated: created, settings: 0, admin: false, classes: 0, students: 0, announcements: 0 };

  const existingSettings = new Set(ctx.rows(SHEETS.SETTINGS).map(r => r.SETTING));
  const initial = Object.assign({}, DEFAULT_SETTINGS, options.schoolName ? { SCHOOL_NAME: options.schoolName } : {},
    options.adminEmail ? { ADMIN_EMAIL: options.adminEmail } : {});
  Object.keys(initial).forEach(key => {
    if (!existingSettings.has(key)) { ctx.append(SHEETS.SETTINGS, { SETTING: key, VALUE: initial[key] }); summary.settings++; }
  });
  ctx._settings = null;

  if (options.adminEmail) {
    const email = options.adminEmail.toLowerCase();
    if (!ctx.rows(SHEETS.ADMINS).some(a => String(a.EMAIL).toLowerCase() === email)) {
      ctx.append(SHEETS.ADMINS, {
        ID: uuid(), NAME: options.adminName || 'School Administrator', EMAIL: email, USERNAME: email.split('@')[0],
        ROLE: ROLES.SUPER_ADMIN, STATUS: STATUS.ACTIVE, CREATED_AT: now
      });
      summary.admin = true;
    }
  }

  const classes = options.classes && options.classes.length ? options.classes : (options.demo ? DEMO_CLASSES : []);
  if (!ctx.rows(SHEETS.CLASSES).length) {
    classes.forEach(name => {
      ctx.append(SHEETS.CLASSES, {
        CLASS_ID: uuid(), CLASS_NAME: name, ACADEMIC_YEAR: ctx.setting('ACADEMIC_YEAR'), EXPECTED_FEE: 500,
        IS_DEMO: !!options.demo, CREATED_AT: now
      });
      summary.classes++;
    });
  }
  await ctx.flush();

  if (options.demo && !ctx.rows(SHEETS.STUDENTS).length) {
    for (const d of DEMO_STUDENTS) {
      const student = {
        FIRST_NAME: d[0], MIDDLE_NAME: d[1], LAST_NAME: d[2], DOB: d[3], GENDER: d[4], CLASS: d[5],
        ACADEMIC_YEAR: ctx.setting('ACADEMIC_YEAR'), ADMISSION_DATE: now.slice(0, 10), PHONE: '', EMAIL: '',
        ADDRESS: 'Accra, Ghana', PREVIOUS_SCHOOL: '', PHOTO_URL: '', STATUS: STATUS.ACTIVE, IS_DEMO: true,
        REGISTERED_BY: 'SYSTEM', CREATED_AT: now, UPDATED_AT: now
      };
      await ctx.appendWithSequence(SHEETS.STUDENTS, student, { field: 'STUDENT_ID', prefix: studentIdPrefix(ctx), pad: 4 });
      ctx.append(SHEETS.GUARDIANS, {
        GUARDIAN_ID: uuid(), STUDENT_ID: student.STUDENT_ID, NAME: d[6], RELATIONSHIP: d[7], PHONE: d[8],
        EMAIL: '', OCCUPATION: '', ADDRESS: 'Accra, Ghana', CREATED_AT: now
      });
      summary.students++;
    }
  }

  if (options.demo && !ctx.rows(SHEETS.ANNOUNCEMENTS).length) {
    [
      ['Welcome to the New Academic Year', 'We are excited to welcome all students and parents to the ' + ctx.setting('ACADEMIC_YEAR') + ' academic year.', 'All Students'],
      ['Term Fees Due', 'Kindly note that term fees are due by the end of the month. Contact the school office for payment plans.', 'Parents/Guardians']
    ].forEach(a => {
      ctx.append(SHEETS.ANNOUNCEMENTS, {
        ANNOUNCEMENT_ID: uuid(), TITLE: a[0], MESSAGE: a[1], AUDIENCE: a[2], CLASS_NAME: '', DATE: now.slice(0, 10),
        STATUS: 'PUBLISHED', CREATED_BY: 'SYSTEM', CREATED_AT: now
      });
      summary.announcements++;
    });
  }
  ctx.log('SYSTEM_SETUP', 'School set up', '');
  await ctx.flush();
  return summary;
}

module.exports = { setupSchool, DEMO_CLASSES };
