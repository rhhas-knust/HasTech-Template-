// Fee/payment recording, history and outstanding-fee calculations.
const { SHEETS, STATUS, PAYMENT_METHODS, PAYMENT_TYPES } = require('../schema');
const { str, required, oneOf, optionalDate, dateKey, todayKey, timeOf, nowIso, formatMoney, UserError } = require('../util');

async function recordPayment(ctx, data) {
  data = data || {};
  const studentId = required(str(data.studentId, 40), 'Please select a student.');
  const type = oneOf(str(data.paymentType), PAYMENT_TYPES, 'Please select a payment type.');
  const method = oneOf(str(data.paymentMethod), PAYMENT_METHODS, 'Please select a payment method.');
  const date = required(optionalDate(data.paymentDate, 'Please enter a valid payment date.'), 'Please enter the payment date.');
  const amount = Math.round(parseFloat(data.amount) * 100) / 100;
  if (!isFinite(amount) || amount <= 0) throw new UserError('Please enter a valid payment amount.');
  if (amount > 1e9) throw new UserError('That amount looks too large.');

  const student = ctx.find(SHEETS.STUDENTS, 'STUDENT_ID', studentId);
  if (!student) return { success: false, message: 'Student not found.' };

  const payment = {
    STUDENT_ID: student.STUDENT_ID,
    STUDENT_NAME: (student.FIRST_NAME + ' ' + student.LAST_NAME).trim(),
    CLASS: student.CLASS,
    PAYMENT_TYPE: type,
    AMOUNT: amount,
    ACADEMIC_YEAR: str(data.academicYear, 20) || student.ACADEMIC_YEAR,
    PAYMENT_DATE: date,
    PAYMENT_METHOD: method,
    REFERENCE: str(data.reference, 120),
    RECORDED_BY: ctx.userLabel(),
    TIMESTAMP: nowIso()
  };
  await ctx.appendWithSequence(SHEETS.PAYMENTS, payment, { field: 'PAYMENT_ID', prefix: 'PAY-', pad: 6 });
  ctx.log('PAYMENT_RECORDED', formatMoney(amount, ctx.setting('CURRENCY')) + ' ' + type + ' from ' + payment.STUDENT_NAME, payment.PAYMENT_ID);
  return { success: true, payment, message: 'Payment recorded successfully.' };
}

/** filters: { studentId, className, paymentType, startDate, endDate } */
function getPayments(ctx, filters) {
  filters = filters || {};
  const tz = ctx.timezone();
  let rows = ctx.rows(SHEETS.PAYMENTS);
  if (filters.studentId) rows = rows.filter(p => p.STUDENT_ID === filters.studentId);
  if (filters.className) rows = rows.filter(p => p.CLASS === filters.className);
  if (filters.paymentType) rows = rows.filter(p => p.PAYMENT_TYPE === filters.paymentType);
  if (filters.startDate) rows = rows.filter(p => dateKey(p.PAYMENT_DATE, tz) >= filters.startDate);
  if (filters.endDate) rows = rows.filter(p => dateKey(p.PAYMENT_DATE, tz) <= filters.endDate);
  return rows.sort((a, b) => timeOf(b.PAYMENT_DATE) - timeOf(a.PAYMENT_DATE) || timeOf(b.TIMESTAMP) - timeOf(a.TIMESTAMP));
}

function expectedFeeByClass(ctx) {
  const fees = {};
  ctx.rows(SHEETS.CLASSES).forEach(c => { fees[c.CLASS_NAME] = parseFloat(c.EXPECTED_FEE) || 0; });
  return fees;
}

function paymentSummary(ctx, student) {
  const payments = getPayments(ctx, { studentId: student.STUDENT_ID });
  const totalPaid = payments.reduce((sum, p) => sum + (parseFloat(p.AMOUNT) || 0), 0);
  const expectedFee = expectedFeeByClass(ctx)[student.CLASS] || 0;
  return { totalPaid, expectedFee, outstanding: Math.max(expectedFee - totalPaid, 0), payments };
}

function paymentsThisMonth(ctx) {
  const tz = ctx.timezone();
  const month = todayKey(tz).slice(0, 7);
  const rows = ctx.rows(SHEETS.PAYMENTS).filter(p => dateKey(p.PAYMENT_DATE, tz).slice(0, 7) === month);
  return { count: rows.length, total: rows.reduce((sum, p) => sum + (parseFloat(p.AMOUNT) || 0), 0) };
}

/** One row per active student who still owes part of their class fee. */
function outstandingFeesReport(ctx) {
  const fees = expectedFeeByClass(ctx);
  const paid = {};
  ctx.rows(SHEETS.PAYMENTS).forEach(p => { paid[p.STUDENT_ID] = (paid[p.STUDENT_ID] || 0) + (parseFloat(p.AMOUNT) || 0); });
  return ctx.rows(SHEETS.STUDENTS)
    .filter(s => s.STATUS === STATUS.ACTIVE)
    .map(s => {
      const expected = fees[s.CLASS] || 0;
      const p = paid[s.STUDENT_ID] || 0;
      return {
        STUDENT_ID: s.STUDENT_ID,
        STUDENT_NAME: (s.FIRST_NAME + ' ' + s.LAST_NAME).trim(),
        CLASS: s.CLASS,
        EXPECTED_FEE: expected,
        PAID: p,
        OUTSTANDING: Math.max(expected - p, 0)
      };
    })
    .filter(r => r.OUTSTANDING > 0)
    .sort((a, b) => b.OUTSTANDING - a.OUTSTANDING);
}

/** Receipt numbers mirror the payment number: PAY-000123 -> RCT-000123. */
function receiptNumber(paymentId) {
  return String(paymentId).replace(/^PAY-/, 'RCT-');
}

module.exports = { recordPayment, getPayments, paymentSummary, paymentsThisMonth, outstandingFeesReport, receiptNumber };
