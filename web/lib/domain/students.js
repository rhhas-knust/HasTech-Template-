// Student registration, records, guardians and the searchable directory.
const { SHEETS, STATUS, GENDERS } = require('../schema');
const { str, required, oneOf, optionalDate, optionalEmail, nowIso, uuid, timeOf, UserError } = require('../util');
const { attendanceSummary } = require('./attendance');
const { paymentSummary } = require('./payments');
const { sendRegistrationEmail } = require('../email');

/** "BFA" from "Bright Future Academy", unless the school set STUDENT_ID_PREFIX. */
function schoolPrefix(ctx) {
  const custom = str(ctx.setting('STUDENT_ID_PREFIX'), 10).toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (custom) return custom;
  const words = String(ctx.setting('SCHOOL_NAME') || '').trim().split(/\s+/);
  return words.map(w => w.charAt(0).toUpperCase()).join('').replace(/[^A-Z0-9]/g, '').slice(0, 5) || 'SCH';
}

function studentIdPrefix(ctx) {
  const year = String(ctx.setting('ACADEMIC_YEAR') || '').split('/')[0].trim() || String(new Date().getFullYear());
  return schoolPrefix(ctx) + '-' + year + '-';
}

function classNames(ctx) {
  return ctx.rows(SHEETS.CLASSES).map(c => c.CLASS_NAME);
}

/** Validates the registration/edit form. Returns cleaned student + guardian fields. */
function readStudentForm(ctx, data, isEdit) {
  data = data || {};
  const f = {
    firstName: required(str(data.firstName, 80), 'Please enter the student’s first name.'),
    middleName: str(data.middleName, 80),
    lastName: required(str(data.lastName, 80), 'Please enter the student’s last name.'),
    dob: required(optionalDate(data.dob, 'Please enter a valid date of birth.'), 'Please enter the student’s date of birth.'),
    gender: oneOf(str(data.gender), GENDERS, 'Please select the student’s gender.'),
    className: oneOf(str(data.className, 80), classNames(ctx), 'Please select a class.'),
    academicYear: str(data.academicYear, 20) || String(ctx.setting('ACADEMIC_YEAR')),
    admissionDate: optionalDate(data.admissionDate, 'Please enter a valid admission date.'),
    phone: str(data.phone, 40),
    email: optionalEmail(data.email, 'Please enter a valid student email.'),
    address: str(data.address, 500),
    previousSchool: str(data.previousSchool, 200),
    photoUrl: str(data.photoUrl, 500),
    status: oneOf(str(data.status) || STATUS.ACTIVE, Object.values(STATUS), 'Please select a valid status.'),
    guardianName: str(data.guardianName, 120),
    guardianRelationship: str(data.guardianRelationship, 40),
    guardianPhone: str(data.guardianPhone, 40),
    guardianEmail: optionalEmail(data.guardianEmail, 'Please enter a valid guardian email.'),
    guardianOccupation: str(data.guardianOccupation, 120),
    guardianAddress: str(data.guardianAddress, 500)
  };
  if (f.photoUrl && !/^https:\/\//i.test(f.photoUrl)) throw new UserError('The photo link must start with https://');
  if (isEdit) f.studentId = required(str(data.studentId, 40), 'Missing student ID.');
  return f;
}

function guardianFields(f) {
  return {
    NAME: f.guardianName,
    RELATIONSHIP: f.guardianRelationship,
    PHONE: f.guardianPhone,
    EMAIL: f.guardianEmail,
    OCCUPATION: f.guardianOccupation,
    ADDRESS: f.guardianAddress
  };
}

async function createStudent(ctx, data) {
  const f = readStudentForm(ctx, data, false);
  const now = nowIso();
  const student = {
    FIRST_NAME: f.firstName,
    MIDDLE_NAME: f.middleName,
    LAST_NAME: f.lastName,
    DOB: f.dob,
    GENDER: f.gender,
    CLASS: f.className,
    ACADEMIC_YEAR: f.academicYear,
    ADMISSION_DATE: f.admissionDate || now.slice(0, 10),
    PHONE: f.phone,
    EMAIL: f.email,
    ADDRESS: f.address,
    PREVIOUS_SCHOOL: f.previousSchool,
    PHOTO_URL: f.photoUrl,
    STATUS: f.status,
    IS_DEMO: false,
    REGISTERED_BY: ctx.userLabel(),
    CREATED_AT: now,
    UPDATED_AT: now
  };
  await ctx.appendWithSequence(SHEETS.STUDENTS, student, { field: 'STUDENT_ID', prefix: studentIdPrefix(ctx), pad: 4 });

  let guardian = null;
  if (f.guardianName) {
    guardian = Object.assign({ GUARDIAN_ID: uuid(), STUDENT_ID: student.STUDENT_ID, CREATED_AT: now }, guardianFields(f));
    ctx.append(SHEETS.GUARDIANS, guardian);
  }
  ctx.log('STUDENT_CREATED', 'Registered student ' + student.FIRST_NAME + ' ' + student.LAST_NAME + ' (' + student.STUDENT_ID + ')', student.STUDENT_ID);

  if (guardian && guardian.EMAIL) {
    const sent = await sendRegistrationEmail(ctx.settings(), student, guardian);
    if (sent) ctx.log('EMAIL_SENT', 'Registration confirmation sent to ' + guardian.EMAIL, student.STUDENT_ID);
  }
  return { success: true, student, message: 'Student registered successfully.' };
}

function updateStudent(ctx, data) {
  const f = readStudentForm(ctx, data, true);
  const ok = ctx.update(SHEETS.STUDENTS, 'STUDENT_ID', f.studentId, {
    FIRST_NAME: f.firstName,
    MIDDLE_NAME: f.middleName,
    LAST_NAME: f.lastName,
    DOB: f.dob,
    GENDER: f.gender,
    CLASS: f.className,
    ACADEMIC_YEAR: f.academicYear,
    ADMISSION_DATE: f.admissionDate || undefined,
    PHONE: f.phone,
    EMAIL: f.email,
    ADDRESS: f.address,
    PREVIOUS_SCHOOL: f.previousSchool,
    PHOTO_URL: f.photoUrl,
    STATUS: f.status,
    UPDATED_AT: nowIso()
  });
  if (!ok) return { success: false, message: 'Student not found.' };

  if (f.guardianName) {
    const existing = ctx.rows(SHEETS.GUARDIANS).find(g => g.STUDENT_ID === f.studentId);
    if (existing) {
      ctx.update(SHEETS.GUARDIANS, 'GUARDIAN_ID', existing.GUARDIAN_ID, guardianFields(f));
    } else {
      ctx.append(SHEETS.GUARDIANS, Object.assign({ GUARDIAN_ID: uuid(), STUDENT_ID: f.studentId, CREATED_AT: nowIso() }, guardianFields(f)));
    }
  }
  ctx.log('STUDENT_UPDATED', 'Updated student ' + f.studentId, f.studentId);
  return { success: true, message: 'Student updated successfully.' };
}

/** filters: { search, className, gender, status } */
function getStudents(ctx, filters) {
  filters = filters || {};
  let students = ctx.rows(SHEETS.STUDENTS);
  const term = str(filters.search, 100).toLowerCase();
  if (term) {
    students = students.filter(s => {
      const fullName = [s.FIRST_NAME, s.MIDDLE_NAME, s.LAST_NAME].join(' ').toLowerCase();
      return fullName.indexOf(term) !== -1 || String(s.STUDENT_ID).toLowerCase().indexOf(term) !== -1;
    });
  }
  if (filters.className) students = students.filter(s => s.CLASS === filters.className);
  if (filters.gender) students = students.filter(s => s.GENDER === filters.gender);
  if (filters.status) students = students.filter(s => s.STATUS === filters.status);
  return students.sort((a, b) => timeOf(b.CREATED_AT) - timeOf(a.CREATED_AT));
}

function getStudentProfile(ctx, studentId) {
  const student = ctx.find(SHEETS.STUDENTS, 'STUDENT_ID', str(studentId, 40));
  if (!student) return { success: false, message: 'Student not found.' };
  return {
    success: true,
    student,
    guardians: ctx.rows(SHEETS.GUARDIANS).filter(g => g.STUDENT_ID === student.STUDENT_ID),
    attendanceSummary: attendanceSummary(ctx, student.STUDENT_ID),
    paymentSummary: paymentSummary(ctx, student)
  };
}

function getClasses(ctx) {
  return ctx.rows(SHEETS.CLASSES).sort((a, b) => String(a.CLASS_NAME).localeCompare(String(b.CLASS_NAME)));
}

module.exports = { createStudent, updateStudent, getStudents, getStudentProfile, getClasses, studentIdPrefix, schoolPrefix };
