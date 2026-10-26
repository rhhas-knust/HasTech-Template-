// Daily attendance recording and per-student attendance statistics.
const { SHEETS, STATUS, ATTENDANCE_STATUS } = require('../schema');
const { str, required, oneOf, optionalDate, dateKey, todayKey, timeOf, uuid, nowIso, UserError } = require('../util');

const VALID = Object.values(ATTENDANCE_STATUS);

function getStudentsForAttendance(ctx, className) {
  const cls = str(className, 80);
  return ctx.rows(SHEETS.STUDENTS)
    .filter(s => s.CLASS === cls && s.STATUS === STATUS.ACTIVE)
    .sort((a, b) => String(a.FIRST_NAME).localeCompare(String(b.FIRST_NAME)));
}

/** { STUDENT_ID: status } for a class on a date, so the screen can show what was already saved. */
function getExistingAttendance(ctx, date, className) {
  const key = dateKey(str(date, 40), ctx.timezone());
  const cls = str(className, 80);
  const byStudent = {};
  ctx.rows(SHEETS.ATTENDANCE)
    .filter(r => dateKey(r.DATE, ctx.timezone()) === key && r.CLASS === cls)
    .forEach(r => { byStudent[r.STUDENT_ID] = r.STATUS; });
  return byStudent;
}

/**
 * records: [{ studentId, status }]. Re-saving the same class/date overwrites the earlier
 * marks instead of adding duplicate rows.
 */
function recordAttendance(ctx, date, className, records) {
  const day = required(optionalDate(date, 'Please pick a valid date.'), 'Please select a date.');
  const cls = str(className, 80);
  if (!cls || !Array.isArray(records) || !records.length) {
    throw new UserError('Please select a date, class, and mark at least one student.');
  }
  if (records.length > 500) throw new UserError('Too many students in one save.');

  const students = {};
  getStudentsForAttendance(ctx, cls).forEach(s => { students[s.STUDENT_ID] = s; });
  const existing = {};
  ctx.rows(SHEETS.ATTENDANCE)
    .filter(r => dateKey(r.DATE, ctx.timezone()) === day && r.CLASS === cls)
    .forEach(r => { existing[r.STUDENT_ID] = r; });

  const now = nowIso();
  let saved = 0;
  records.forEach(rec => {
    const id = str(rec && rec.studentId, 40);
    const student = students[id];
    if (!student) return;
    const status = oneOf(str(rec.status), VALID, 'Invalid attendance status.');
    const fields = {
      DATE: day,
      STUDENT_NAME: student.FIRST_NAME + ' ' + student.LAST_NAME,
      CLASS: cls,
      STATUS: status,
      RECORDED_BY: ctx.userLabel(),
      TIMESTAMP: now
    };
    if (existing[id]) {
      ctx.update(SHEETS.ATTENDANCE, 'ATTENDANCE_ID', existing[id].ATTENDANCE_ID, fields);
    } else {
      ctx.append(SHEETS.ATTENDANCE, Object.assign({ ATTENDANCE_ID: uuid(), STUDENT_ID: id }, fields));
    }
    saved++;
  });
  if (!saved) throw new UserError('None of those students are active in ' + cls + '.');
  ctx.log('ATTENDANCE_RECORDED', 'Recorded attendance for ' + cls + ' on ' + day + ' (' + saved + ' students)', cls);
  return { success: true, message: 'Attendance saved successfully.' };
}

function attendanceSummary(ctx, studentId) {
  const records = ctx.rows(SHEETS.ATTENDANCE).filter(r => r.STUDENT_ID === studentId);
  const count = s => records.filter(r => r.STATUS === s).length;
  const present = count(ATTENDANCE_STATUS.PRESENT);
  const absent = count(ATTENDANCE_STATUS.ABSENT);
  const late = count(ATTENDANCE_STATUS.LATE);
  const total = records.length;
  return {
    totalDays: total,
    present,
    absent,
    late,
    percentage: total ? Math.round(((present + late) / total) * 100) : 0,
    records: records.sort((a, b) => timeOf(b.DATE) - timeOf(a.DATE)).slice(0, 30)
  };
}

function todayAttendanceCount(ctx) {
  const today = todayKey(ctx.timezone());
  const records = ctx.rows(SHEETS.ATTENDANCE).filter(r => dateKey(r.DATE, ctx.timezone()) === today);
  const present = records.filter(r => r.STATUS === ATTENDANCE_STATUS.PRESENT || r.STATUS === ATTENDANCE_STATUS.LATE).length;
  return { total: records.length, present };
}

function attendanceReport(ctx, filters) {
  filters = filters || {};
  const tz = ctx.timezone();
  let rows = ctx.rows(SHEETS.ATTENDANCE);
  if (filters.className) rows = rows.filter(r => r.CLASS === filters.className);
  if (filters.startDate) rows = rows.filter(r => dateKey(r.DATE, tz) >= filters.startDate);
  if (filters.endDate) rows = rows.filter(r => dateKey(r.DATE, tz) <= filters.endDate);
  return rows.sort((a, b) => timeOf(b.DATE) - timeOf(a.DATE));
}

module.exports = { getStudentsForAttendance, getExistingAttendance, recordAttendance, attendanceSummary, todayAttendanceCount, attendanceReport };
