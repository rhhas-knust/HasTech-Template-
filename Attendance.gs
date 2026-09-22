/**
 * Attendance.gs
 * Daily attendance recording and per-student attendance statistics.
 */

var ATTENDANCE_STATUS = {
  PRESENT: 'Present',
  ABSENT: 'Absent',
  LATE: 'Late'
};

/** Returns active students in a class, for the attendance-taking screen. */
function getStudentsForAttendance(className) {
  var students = sheetToObjects(SHEETS.STUDENTS).filter(function (s) {
    return s.CLASS === className && s.STATUS === STATUS.ACTIVE;
  });
  students.sort(function (a, b) {
    return String(a.FIRST_NAME).localeCompare(String(b.FIRST_NAME));
  });
  return students;
}

/**
 * Returns existing attendance records for a class/date, keyed by STUDENT_ID,
 * so the UI can pre-fill statuses if attendance was already partially taken.
 */
function getExistingAttendance(date, className) {
  var dateKey = normalizeDateKey(date);
  var records = sheetToObjects(SHEETS.ATTENDANCE).filter(function (r) {
    return normalizeDateKey(r.DATE) === dateKey && r.CLASS === className;
  });
  var byStudent = {};
  records.forEach(function (r) { byStudent[r.STUDENT_ID] = r.STATUS; });
  return byStudent;
}

function normalizeDateKey(date) {
  if (!date) return '';
  // Plain "yyyy-MM-dd" strings (e.g. from an HTML date input) are used as-is,
  // avoiding a Date round-trip that could shift the day across timezones.
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}/.test(date)) {
    return date.substring(0, 10);
  }
  var d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'UTC', 'yyyy-MM-dd');
}

/**
 * Saves attendance for a class/date. `records` is an array of
 * { studentId, studentName, status }. Existing records for the same
 * student/date are overwritten rather than duplicated.
 */
function recordAttendance(date, className, records, user) {
  try {
    if (!date || !className || !records || records.length === 0) {
      return { success: false, message: 'Please select a date, class, and mark at least one student.' };
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    try {
      var sheet = getSheet(SHEETS.ATTENDANCE);
      var dateKey = normalizeDateKey(date);
      var existingData = sheet.getDataRange().getValues();
      var headers = existingData[0];
      var dateCol = headers.indexOf('DATE');
      var studentCol = headers.indexOf('STUDENT_ID');
      var classCol = headers.indexOf('CLASS');

      // Map studentId -> existing sheet row number (1-based), for this date/class
      var existingRowByStudent = {};
      for (var r = 1; r < existingData.length; r++) {
        if (normalizeDateKey(existingData[r][dateCol]) === dateKey && existingData[r][classCol] === className) {
          existingRowByStudent[existingData[r][studentCol]] = r + 1;
        }
      }

      var now = new Date();
      var newRows = [];
      records.forEach(function (rec) {
        var rowValues = [
          Utilities.getUuid(), date, rec.studentId, rec.studentName, className, rec.status, user || 'SYSTEM', now
        ];
        var existingRow = existingRowByStudent[rec.studentId];
        if (existingRow) {
          // Overwrite in place to prevent duplicate records for the same student/date
          sheet.getRange(existingRow, 1, 1, rowValues.length).setValues([rowValues]);
        } else {
          newRows.push(rowValues);
        }
      });
      if (newRows.length > 0) {
        sheet.getRange(sheet.getLastRow() + 1, 1, newRows.length, newRows[0].length).setValues(newRows);
      }

      logActivity(user, 'ATTENDANCE_RECORDED', 'Recorded attendance for ' + className + ' on ' + dateKey + ' (' + records.length + ' students)', className);
      return { success: true, message: 'Attendance saved successfully.' };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    console.error('recordAttendance failed: ' + e);
    return { success: false, message: 'Something went wrong. Please try again.' };
  }
}

/** Computes attendance totals/percentage for one student. */
function getAttendanceSummaryForStudent(studentId) {
  var records = sheetToObjects(SHEETS.ATTENDANCE).filter(function (r) { return r.STUDENT_ID === studentId; });
  var present = records.filter(function (r) { return r.STATUS === ATTENDANCE_STATUS.PRESENT; }).length;
  var absent = records.filter(function (r) { return r.STATUS === ATTENDANCE_STATUS.ABSENT; }).length;
  var late = records.filter(function (r) { return r.STATUS === ATTENDANCE_STATUS.LATE; }).length;
  var total = records.length;
  var percentage = total > 0 ? Math.round(((present + late) / total) * 100) : 0;
  return {
    totalDays: total,
    present: present,
    absent: absent,
    late: late,
    percentage: percentage,
    records: records.sort(function (a, b) { return new Date(b.DATE) - new Date(a.DATE); }).slice(0, 30)
  };
}

/** Returns today's attendance count across all classes, for the dashboard. */
function getTodayAttendanceCount() {
  var todayKey = normalizeDateKey(new Date());
  var records = sheetToObjects(SHEETS.ATTENDANCE).filter(function (r) { return normalizeDateKey(r.DATE) === todayKey; });
  var present = records.filter(function (r) { return r.STATUS === ATTENDANCE_STATUS.PRESENT || r.STATUS === ATTENDANCE_STATUS.LATE; }).length;
  return { total: records.length, present: present };
}

/** Returns attendance rows for reporting, optionally filtered by class/date range. */
function getAttendanceReport(filters) {
  filters = filters || {};
  var rows = sheetToObjects(SHEETS.ATTENDANCE);
  if (filters.className) rows = rows.filter(function (r) { return r.CLASS === filters.className; });
  if (filters.startDate) {
    var start = new Date(filters.startDate);
    rows = rows.filter(function (r) { return new Date(r.DATE) >= start; });
  }
  if (filters.endDate) {
    var end = new Date(filters.endDate);
    end.setHours(23, 59, 59, 999);
    rows = rows.filter(function (r) { return new Date(r.DATE) <= end; });
  }
  rows.sort(function (a, b) { return new Date(b.DATE) - new Date(a.DATE); });
  return rows;
}
