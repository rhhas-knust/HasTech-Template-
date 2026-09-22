/**
 * Students.gs
 * Student registration, records, guardians, and the searchable directory.
 */

/** Derives a short school prefix (e.g. "Bright Future Academy" -> "BFA") for student IDs. */
function getSchoolPrefix() {
  var name = getSetting('SCHOOL_NAME', DEFAULT_SETTINGS.SCHOOL_NAME);
  var words = String(name).trim().split(/\s+/);
  var prefix = words.map(function (w) { return w.charAt(0).toUpperCase(); }).join('');
  return prefix.substring(0, 5) || 'SCH';
}

/** Generates the next Student ID, e.g. BFA-2026-0001. Lock-protected against concurrent submits. */
function generateStudentId() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var year = String(getSetting('ACADEMIC_YEAR', DEFAULT_SETTINGS.ACADEMIC_YEAR)).split('/')[0];
    var prefix = getSchoolPrefix() + '-' + year + '-';
    return generateSequentialCode(SHEETS.STUDENTS, 'STUDENT_ID', prefix, 4);
  } finally {
    lock.releaseLock();
  }
}

function requiredFieldsPresent(data, fields) {
  for (var i = 0; i < fields.length; i++) {
    if (!data[fields[i]] || String(data[fields[i]]).trim() === '') {
      return fields[i];
    }
  }
  return null;
}

/**
 * Registers a new student (and optional guardian). Returns { success, student, message }.
 * `data` is the raw form payload from the client.
 */
function createStudent(data, user) {
  try {
    var missing = requiredFieldsPresent(data, ['firstName', 'lastName', 'dob', 'gender', 'className']);
    if (missing) {
      return { success: false, message: 'Please enter the student’s ' + humanizeField(missing) + '.' };
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    var studentId;
    try {
      studentId = data.studentId && String(data.studentId).trim() !== ''
        ? String(data.studentId).trim()
        : generateStudentId();

      var existing = findRowByIdColumn(SHEETS.STUDENTS, 'STUDENT_ID', studentId);
      if (existing) {
        return { success: false, message: 'This student already exists.' };
      }

      var now = new Date();
      var studentObj = {
        STUDENT_ID: studentId,
        FIRST_NAME: data.firstName.trim(),
        MIDDLE_NAME: (data.middleName || '').trim(),
        LAST_NAME: data.lastName.trim(),
        DOB: data.dob,
        GENDER: data.gender,
        CLASS: data.className,
        ACADEMIC_YEAR: data.academicYear || getSetting('ACADEMIC_YEAR', DEFAULT_SETTINGS.ACADEMIC_YEAR),
        ADMISSION_DATE: data.admissionDate || now,
        PHONE: data.phone || '',
        EMAIL: data.email || '',
        ADDRESS: data.address || '',
        PREVIOUS_SCHOOL: data.previousSchool || '',
        PHOTO_URL: data.photoUrl || '',
        STATUS: data.status || STATUS.ACTIVE,
        IS_DEMO: false,
        REGISTERED_BY: user || 'SYSTEM',
        CREATED_AT: now,
        UPDATED_AT: now
      };
      appendRowFromObject(SHEETS.STUDENTS, studentObj);

      var guardianObj = null;
      if (data.guardianName && String(data.guardianName).trim() !== '') {
        guardianObj = {
          GUARDIAN_ID: Utilities.getUuid(),
          STUDENT_ID: studentId,
          NAME: data.guardianName.trim(),
          RELATIONSHIP: data.guardianRelationship || '',
          PHONE: data.guardianPhone || '',
          EMAIL: data.guardianEmail || '',
          OCCUPATION: data.guardianOccupation || '',
          ADDRESS: data.guardianAddress || '',
          CREATED_AT: now
        };
        appendRowFromObject(SHEETS.GUARDIANS, guardianObj);
      }

      logActivity(user, 'STUDENT_CREATED', 'Registered student ' + studentObj.FIRST_NAME + ' ' + studentObj.LAST_NAME + ' (' + studentId + ')', studentId);

      if (guardianObj && guardianObj.EMAIL) {
        sendRegistrationEmail(studentObj, guardianObj);
      }

      return { success: true, student: studentObj, message: 'Student registered successfully.' };
    } finally {
      lock.releaseLock();
    }
  } catch (e) {
    console.error('createStudent failed: ' + e);
    return { success: false, message: 'Something went wrong. Please try again.' };
  }
}

function humanizeField(field) {
  var map = {
    firstName: 'first name', lastName: 'last name', dob: 'date of birth',
    gender: 'gender', className: 'class'
  };
  return map[field] || field;
}

/** Updates an existing student's editable fields. */
function updateStudent(data, user) {
  try {
    if (!data.studentId) return { success: false, message: 'Missing student ID.' };
    var existing = findRowByIdColumn(SHEETS.STUDENTS, 'STUDENT_ID', data.studentId);
    if (!existing) return { success: false, message: 'Student not found.' };

    var updates = {
      FIRST_NAME: data.firstName != null ? data.firstName.trim() : existing.FIRST_NAME,
      MIDDLE_NAME: data.middleName != null ? data.middleName.trim() : existing.MIDDLE_NAME,
      LAST_NAME: data.lastName != null ? data.lastName.trim() : existing.LAST_NAME,
      DOB: data.dob || existing.DOB,
      GENDER: data.gender || existing.GENDER,
      CLASS: data.className || existing.CLASS,
      ACADEMIC_YEAR: data.academicYear || existing.ACADEMIC_YEAR,
      PHONE: data.phone != null ? data.phone : existing.PHONE,
      EMAIL: data.email != null ? data.email : existing.EMAIL,
      ADDRESS: data.address != null ? data.address : existing.ADDRESS,
      PREVIOUS_SCHOOL: data.previousSchool != null ? data.previousSchool : existing.PREVIOUS_SCHOOL,
      PHOTO_URL: data.photoUrl != null ? data.photoUrl : existing.PHOTO_URL,
      STATUS: data.status || existing.STATUS,
      UPDATED_AT: new Date()
    };
    updateRowByIdColumn(SHEETS.STUDENTS, 'STUDENT_ID', data.studentId, updates);

    if (data.guardianName && String(data.guardianName).trim() !== '') {
      var guardians = sheetToObjects(SHEETS.GUARDIANS).filter(function (g) { return g.STUDENT_ID === data.studentId; });
      var guardianUpdates = {
        NAME: data.guardianName.trim(),
        RELATIONSHIP: data.guardianRelationship || '',
        PHONE: data.guardianPhone || '',
        EMAIL: data.guardianEmail || '',
        OCCUPATION: data.guardianOccupation || '',
        ADDRESS: data.guardianAddress || ''
      };
      if (guardians.length > 0) {
        updateRowByIdColumn(SHEETS.GUARDIANS, 'GUARDIAN_ID', guardians[0].GUARDIAN_ID, guardianUpdates);
      } else {
        guardianUpdates.GUARDIAN_ID = Utilities.getUuid();
        guardianUpdates.STUDENT_ID = data.studentId;
        guardianUpdates.CREATED_AT = new Date();
        appendRowFromObject(SHEETS.GUARDIANS, guardianUpdates);
      }
    }

    logActivity(user, 'STUDENT_UPDATED', 'Updated student ' + data.studentId, data.studentId);
    return { success: true, message: 'Student updated successfully.' };
  } catch (e) {
    console.error('updateStudent failed: ' + e);
    return { success: false, message: 'Something went wrong. Please try again.' };
  }
}

/** Returns the student directory, optionally filtered. filters: {search, className, gender, status} */
function getStudents(filters) {
  filters = filters || {};
  var students = sheetToObjects(SHEETS.STUDENTS);

  if (filters.search) {
    var term = String(filters.search).toLowerCase();
    students = students.filter(function (s) {
      var fullName = (s.FIRST_NAME + ' ' + s.MIDDLE_NAME + ' ' + s.LAST_NAME).toLowerCase();
      return fullName.indexOf(term) !== -1 || String(s.STUDENT_ID).toLowerCase().indexOf(term) !== -1;
    });
  }
  if (filters.className) {
    students = students.filter(function (s) { return s.CLASS === filters.className; });
  }
  if (filters.gender) {
    students = students.filter(function (s) { return s.GENDER === filters.gender; });
  }
  if (filters.status) {
    students = students.filter(function (s) { return s.STATUS === filters.status; });
  }

  students.sort(function (a, b) { return new Date(b.CREATED_AT) - new Date(a.CREATED_AT); });
  return students;
}

function getStudentById(studentId) {
  return findRowByIdColumn(SHEETS.STUDENTS, 'STUDENT_ID', studentId);
}

/** Returns full profile data: student, guardians, attendance summary, payment summary. */
function getStudentProfile(studentId) {
  var student = getStudentById(studentId);
  if (!student) return { success: false, message: 'Student not found.' };

  var guardians = sheetToObjects(SHEETS.GUARDIANS).filter(function (g) { return g.STUDENT_ID === studentId; });
  var attendanceSummary = getAttendanceSummaryForStudent(studentId);
  var paymentSummary = getPaymentSummaryForStudent(studentId);

  return {
    success: true,
    student: student,
    guardians: guardians,
    attendanceSummary: attendanceSummary,
    paymentSummary: paymentSummary
  };
}

/** Returns distinct class names from the CLASSES sheet. */
function getClasses() {
  return sheetToObjects(SHEETS.CLASSES).sort(function (a, b) {
    return String(a.CLASS_NAME).localeCompare(String(b.CLASS_NAME));
  });
}

/** Seeds a handful of realistic demo students (called once by setupSystem). */
function seedDemoStudents() {
  var academicYear = getSetting('ACADEMIC_YEAR', DEFAULT_SETTINGS.ACADEMIC_YEAR);
  var demo = [
    { firstName: 'Ama', lastName: 'Owusu', dob: '2015-03-12', gender: 'Female', className: 'Primary 3', phone: '', email: '', guardianName: 'Kwabena Owusu', guardianRelationship: 'Father', guardianPhone: '0244000001', guardianEmail: '' },
    { firstName: 'Kwame', middleName: 'Yaw', lastName: 'Mensah', dob: '2014-07-22', gender: 'Male', className: 'Primary 3', guardianName: 'Efua Mensah', guardianRelationship: 'Mother', guardianPhone: '0244000002', guardianEmail: '' },
    { firstName: 'Esi', lastName: 'Boateng', dob: '2012-01-05', gender: 'Female', className: 'JHS 1', guardianName: 'Yaw Boateng', guardianRelationship: 'Father', guardianPhone: '0244000003', guardianEmail: '' },
    { firstName: 'Kofi', lastName: 'Asante', dob: '2011-11-30', gender: 'Male', className: 'JHS 2', guardianName: 'Abena Asante', guardianRelationship: 'Mother', guardianPhone: '0244000004', guardianEmail: '' },
    { firstName: 'Adjoa', lastName: 'Darko', dob: '2017-05-18', gender: 'Female', className: 'Nursery 2', guardianName: 'Kojo Darko', guardianRelationship: 'Father', guardianPhone: '0244000005', guardianEmail: '' }
  ];

  demo.forEach(function (d) {
    var studentId = generateStudentId();
    var now = new Date();
    appendRowFromObject(SHEETS.STUDENTS, {
      STUDENT_ID: studentId,
      FIRST_NAME: d.firstName,
      MIDDLE_NAME: d.middleName || '',
      LAST_NAME: d.lastName,
      DOB: d.dob,
      GENDER: d.gender,
      CLASS: d.className,
      ACADEMIC_YEAR: academicYear,
      ADMISSION_DATE: now,
      PHONE: '',
      EMAIL: '',
      ADDRESS: 'Accra, Ghana',
      PREVIOUS_SCHOOL: '',
      PHOTO_URL: '',
      STATUS: STATUS.ACTIVE,
      IS_DEMO: true,
      REGISTERED_BY: 'SYSTEM',
      CREATED_AT: now,
      UPDATED_AT: now
    });
    appendRowFromObject(SHEETS.GUARDIANS, {
      GUARDIAN_ID: Utilities.getUuid(),
      STUDENT_ID: studentId,
      NAME: d.guardianName,
      RELATIONSHIP: d.guardianRelationship,
      PHONE: d.guardianPhone,
      EMAIL: d.guardianEmail || '',
      OCCUPATION: '',
      ADDRESS: 'Accra, Ghana',
      CREATED_AT: now
    });
  });
}
