/**
 * Payments.gs
 * Fee/payment recording, history, and outstanding-fees calculations.
 */

var PAYMENT_METHODS = ['Cash', 'Mobile Money', 'Bank Transfer', 'Other'];
var PAYMENT_TYPES = ['School Fees', 'Registration', 'Examination', 'Books', 'Uniform', 'Other'];

/** Generates the next Payment ID, e.g. PAY-000123. Lock-protected. */
function generatePaymentId() {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    return generateSequentialCode(SHEETS.PAYMENTS, 'PAYMENT_ID', 'PAY-', 6);
  } finally {
    lock.releaseLock();
  }
}

/** Records a payment. `data` is the raw form payload from the client. */
function recordPayment(data, user) {
  try {
    var missing = requiredFieldsPresent(data, ['studentId', 'paymentType', 'amount', 'paymentDate', 'paymentMethod']);
    if (missing) {
      return { success: false, message: 'Please fill in all required payment fields.' };
    }
    var amount = parseFloat(data.amount);
    if (isNaN(amount) || amount <= 0) {
      return { success: false, message: 'Please enter a valid payment amount.' };
    }

    var student = getStudentById(data.studentId);
    if (!student) {
      return { success: false, message: 'Student not found.' };
    }

    var paymentId = generatePaymentId();
    var now = new Date();
    var paymentObj = {
      PAYMENT_ID: paymentId,
      STUDENT_ID: student.STUDENT_ID,
      STUDENT_NAME: (student.FIRST_NAME + ' ' + student.LAST_NAME).trim(),
      CLASS: student.CLASS,
      PAYMENT_TYPE: data.paymentType,
      AMOUNT: amount,
      ACADEMIC_YEAR: data.academicYear || student.ACADEMIC_YEAR,
      PAYMENT_DATE: data.paymentDate,
      PAYMENT_METHOD: data.paymentMethod,
      REFERENCE: data.reference || '',
      RECORDED_BY: user || 'SYSTEM',
      TIMESTAMP: now
    };
    appendRowFromObject(SHEETS.PAYMENTS, paymentObj);

    logActivity(user, 'PAYMENT_RECORDED', formatCurrencyServer(amount) + ' ' + data.paymentType + ' from ' + paymentObj.STUDENT_NAME, paymentId);

    return { success: true, payment: paymentObj, message: 'Payment recorded successfully.' };
  } catch (e) {
    console.error('recordPayment failed: ' + e);
    return { success: false, message: 'Something went wrong. Please try again.' };
  }
}

/** Returns payments, optionally filtered. filters: {studentId, className, paymentType, startDate, endDate} */
function getPayments(filters) {
  filters = filters || {};
  var rows = sheetToObjects(SHEETS.PAYMENTS);
  if (filters.studentId) rows = rows.filter(function (p) { return p.STUDENT_ID === filters.studentId; });
  if (filters.className) rows = rows.filter(function (p) { return p.CLASS === filters.className; });
  if (filters.paymentType) rows = rows.filter(function (p) { return p.PAYMENT_TYPE === filters.paymentType; });
  if (filters.startDate) {
    var start = new Date(filters.startDate);
    rows = rows.filter(function (p) { return new Date(p.PAYMENT_DATE) >= start; });
  }
  if (filters.endDate) {
    var end = new Date(filters.endDate);
    end.setHours(23, 59, 59, 999);
    rows = rows.filter(function (p) { return new Date(p.PAYMENT_DATE) <= end; });
  }
  rows.sort(function (a, b) { return new Date(b.PAYMENT_DATE) - new Date(a.PAYMENT_DATE); });
  return rows;
}

function getPaymentById(paymentId) {
  return findRowByIdColumn(SHEETS.PAYMENTS, 'PAYMENT_ID', paymentId);
}

/** Returns total paid, expected fee, and outstanding balance for one student. */
function getPaymentSummaryForStudent(studentId) {
  var payments = sheetToObjects(SHEETS.PAYMENTS).filter(function (p) { return p.STUDENT_ID === studentId; });
  var totalPaid = payments.reduce(function (sum, p) { return sum + (parseFloat(p.AMOUNT) || 0); }, 0);

  var student = getStudentById(studentId);
  var expectedFee = 0;
  if (student) {
    var classRow = sheetToObjects(SHEETS.CLASSES).filter(function (c) { return c.CLASS_NAME === student.CLASS; })[0];
    expectedFee = classRow ? (parseFloat(classRow.EXPECTED_FEE) || 0) : 0;
  }

  return {
    totalPaid: totalPaid,
    expectedFee: expectedFee,
    outstanding: Math.max(expectedFee - totalPaid, 0),
    payments: payments.sort(function (a, b) { return new Date(b.PAYMENT_DATE) - new Date(a.PAYMENT_DATE); })
  };
}

/** Returns total payments recorded so far in the current calendar month. */
function getPaymentsThisMonth() {
  var now = new Date();
  var payments = sheetToObjects(SHEETS.PAYMENTS).filter(function (p) {
    var d = new Date(p.PAYMENT_DATE);
    return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
  });
  var total = payments.reduce(function (sum, p) { return sum + (parseFloat(p.AMOUNT) || 0); }, 0);
  return { count: payments.length, total: total };
}

/** Returns an outstanding-fees report: one row per active student with a balance > 0. */
function getOutstandingFeesReport() {
  var students = sheetToObjects(SHEETS.STUDENTS).filter(function (s) { return s.STATUS === STATUS.ACTIVE; });
  var classes = sheetToObjects(SHEETS.CLASSES);
  var classFeeByName = {};
  classes.forEach(function (c) { classFeeByName[c.CLASS_NAME] = parseFloat(c.EXPECTED_FEE) || 0; });

  var payments = sheetToObjects(SHEETS.PAYMENTS);
  var paidByStudent = {};
  payments.forEach(function (p) {
    paidByStudent[p.STUDENT_ID] = (paidByStudent[p.STUDENT_ID] || 0) + (parseFloat(p.AMOUNT) || 0);
  });

  var report = students.map(function (s) {
    var expected = classFeeByName[s.CLASS] || 0;
    var paid = paidByStudent[s.STUDENT_ID] || 0;
    var outstanding = Math.max(expected - paid, 0);
    return {
      STUDENT_ID: s.STUDENT_ID,
      STUDENT_NAME: (s.FIRST_NAME + ' ' + s.LAST_NAME).trim(),
      CLASS: s.CLASS,
      EXPECTED_FEE: expected,
      PAID: paid,
      OUTSTANDING: outstanding
    };
  }).filter(function (row) { return row.OUTSTANDING > 0; });

  report.sort(function (a, b) { return b.OUTSTANDING - a.OUTSTANDING; });
  return report;
}

function formatCurrencyServer(amount) {
  var currency = getSetting('CURRENCY', DEFAULT_SETTINGS.CURRENCY);
  return currency + ' ' + Number(amount).toFixed(2);
}
