// PDF student profiles, payment receipts and report exports, generated on the server with pdfkit
// and streamed straight to the browser (no Google Drive storage needed).
const PDFDocument = require('pdfkit');
const { SHEETS } = require('./schema');
const { formatLongDate, formatMoney, dateKey } = require('./util');

/** "12 Mar 2015" - compact enough for report tables. */
function formatShortDate(value, tz) {
  const key = dateKey(value, tz);
  if (!key) return String(value);
  const [y, m, d] = key.split('-');
  return parseInt(d, 10) + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][parseInt(m, 10) - 1] + ' ' + y;
}
const { getStudentProfile } = require('./domain/students');
const { receiptNumber } = require('./domain/payments');
const { generateReport } = require('./domain/admin');

const HIDDEN_REPORT_COLUMNS = ['_row', 'IS_DEMO', 'PHOTO_URL', 'MIDDLE_NAME', 'ATTENDANCE_ID', 'LOG_ID', 'UPDATED_AT', 'ACADEMIC_YEAR',
  'PREVIOUS_SCHOOL', 'REGISTERED_BY', 'ADDRESS', 'EMAIL', 'TIMESTAMP'];
const DATE_COLUMNS = /DATE|^DOB$|CREATED_AT|TIMESTAMP/;
const MONEY_COLUMNS = ['AMOUNT', 'EXPECTED_FEE', 'PAID', 'OUTSTANDING'];

async function fetchImage(url) {
  if (!url || !/^https:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!/image\/(png|jpe?g)/.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length < 5 * 1024 * 1024 ? buf : null;
  } catch (e) {
    return null;
  }
}

function render(build, options) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument(Object.assign({ size: 'A4', margin: 50 }, options || {}));
    const chunks = [];
    doc.on('data', c => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    Promise.resolve(build(doc)).then(() => doc.end(), reject);
  });
}

async function header(doc, settings, title) {
  const color = /^#[0-9a-fA-F]{6}$/.test(settings.PRIMARY_COLOR) ? settings.PRIMARY_COLOR : '#0F2A4A';
  const logo = await fetchImage(settings.SCHOOL_LOGO_URL);
  const top = doc.y;
  if (logo) {
    try { doc.image(logo, doc.page.margins.left, top, { fit: [56, 56] }); } catch (e) { /* unsupported image */ }
  }
  doc.fillColor(color).font('Helvetica-Bold').fontSize(20).text(settings.SCHOOL_NAME || '', { align: 'center' });
  if (settings.SCHOOL_MOTTO) doc.fillColor('#555555').font('Helvetica-Oblique').fontSize(10).text(settings.SCHOOL_MOTTO, { align: 'center' });
  const contact = [settings.SCHOOL_ADDRESS, settings.SCHOOL_PHONE, settings.SCHOOL_EMAIL].filter(Boolean).join('   |   ');
  if (contact) doc.fillColor('#555555').font('Helvetica').fontSize(9).text(contact, { align: 'center' });
  doc.y = Math.max(doc.y, top + 60);
  doc.moveDown(0.5);
  const w = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.rect(doc.page.margins.left, doc.y, w, 2).fill(color);
  doc.moveDown(1);
  doc.fillColor('#111111').font('Helvetica-Bold').fontSize(14).text(title, { align: 'center' });
  doc.moveDown(0.8);
}

function fieldTable(doc, heading, rows) {
  if (heading) {
    doc.moveDown(0.4).fillColor('#0F2A4A').font('Helvetica-Bold').fontSize(12).text(heading);
    doc.moveDown(0.3);
  }
  const left = doc.page.margins.left;
  const labelW = 150;
  const valueW = doc.page.width - doc.page.margins.right - left - labelW;
  rows.forEach(([label, value]) => {
    const text = value === undefined || value === null || value === '' ? 'N/A' : String(value);
    const h = Math.max(doc.font('Helvetica').fontSize(10).heightOfString(text, { width: valueW - 10 }), 12) + 8;
    if (doc.y + h > doc.page.height - doc.page.margins.bottom) doc.addPage();
    const y = doc.y;
    doc.rect(left, y, labelW, h).fill('#F2F4F8');
    doc.fillColor('#333333').font('Helvetica-Bold').fontSize(10).text(label, left + 6, y + 4, { width: labelW - 12 });
    doc.fillColor('#111111').font('Helvetica').fontSize(10).text(text, left + labelW + 6, y + 4, { width: valueW - 10 });
    doc.moveTo(left, y + h).lineTo(left + labelW + valueW, y + h).strokeColor('#E2E6EE').lineWidth(0.5).stroke();
    doc.y = y + h;
  });
  doc.x = left;
}

function footer(doc, tz) {
  doc.moveDown(2).fillColor('#888888').font('Helvetica').fontSize(8)
    .text('Generated on ' + formatLongDate(new Date().toISOString(), tz) + ' by HASTECH School Management System', doc.page.margins.left, doc.y, { align: 'left' });
}

async function profilePdf(ctx, studentId) {
  const profile = getStudentProfile(ctx, studentId);
  if (!profile.success) return null;
  const s = profile.student;
  const g = profile.guardians[0];
  const settings = ctx.settings();
  const tz = ctx.timezone();
  const att = profile.attendanceSummary;
  const pay = profile.paymentSummary;
  const buffer = await render(async doc => {
    await header(doc, settings, 'STUDENT PROFILE');
    const photo = await fetchImage(s.PHOTO_URL);
    if (photo) {
      try { doc.image(photo, doc.page.width - doc.page.margins.right - 90, doc.y, { fit: [90, 90] }); doc.moveDown(0.2); } catch (e) { /* skip */ }
    }
    fieldTable(doc, 'Student Information', [
      ['Student ID', s.STUDENT_ID],
      ['Full Name', [s.FIRST_NAME, s.MIDDLE_NAME, s.LAST_NAME].filter(Boolean).join(' ')],
      ['Date of Birth', formatLongDate(s.DOB, tz)],
      ['Gender', s.GENDER],
      ['Class', s.CLASS],
      ['Academic Year', s.ACADEMIC_YEAR],
      ['Admission Date', formatLongDate(s.ADMISSION_DATE, tz)],
      ['Registered', formatLongDate(s.CREATED_AT, tz)],
      ['Status', s.STATUS],
      ['Phone', s.PHONE],
      ['Email', s.EMAIL],
      ['Address', s.ADDRESS],
      ['Previous School', s.PREVIOUS_SCHOOL]
    ]);
    if (g) {
      fieldTable(doc, 'Guardian Information', [
        ['Name', g.NAME], ['Relationship', g.RELATIONSHIP], ['Phone', g.PHONE],
        ['Email', g.EMAIL], ['Occupation', g.OCCUPATION], ['Address', g.ADDRESS]
      ]);
    }
    fieldTable(doc, 'Summary', [
      ['Attendance', att.totalDays ? att.percentage + '% (' + att.present + ' present, ' + att.late + ' late, ' + att.absent + ' absent)' : 'No records yet'],
      ['Fees Paid', formatMoney(pay.totalPaid, settings.CURRENCY)],
      ['Outstanding', formatMoney(pay.outstanding, settings.CURRENCY)]
    ]);
    footer(doc, tz);
  });
  return { buffer, fileName: 'Student Profile - ' + s.FIRST_NAME + ' ' + s.LAST_NAME + ' (' + s.STUDENT_ID + ').pdf', relatedId: s.STUDENT_ID, studentId: s.STUDENT_ID, type: 'STUDENT_PROFILE' };
}

async function receiptPdf(ctx, paymentId) {
  const p = ctx.find(SHEETS.PAYMENTS, 'PAYMENT_ID', String(paymentId || ''));
  if (!p) return null;
  const settings = ctx.settings();
  const tz = ctx.timezone();
  const number = receiptNumber(p.PAYMENT_ID);
  const buffer = await render(async doc => {
    await header(doc, settings, 'PAYMENT RECEIPT');
    doc.font('Helvetica-Bold').fontSize(11).fillColor('#111111').text('Receipt No: ' + number, { align: 'center' });
    doc.moveDown(0.6);
    fieldTable(doc, '', [
      ['Student Name', p.STUDENT_NAME],
      ['Student ID', p.STUDENT_ID],
      ['Class', p.CLASS],
      ['Payment Type', p.PAYMENT_TYPE],
      ['Amount', formatMoney(p.AMOUNT, settings.CURRENCY)],
      ['Payment Method', p.PAYMENT_METHOD],
      ['Reference', p.REFERENCE],
      ['Payment Date', formatLongDate(p.PAYMENT_DATE, tz)],
      ['Recorded By', p.RECORDED_BY]
    ]);
    doc.moveDown(1.2).font('Helvetica-Bold').fontSize(11).fillColor('#111111').text('Thank you for your payment.', doc.page.margins.left);
    footer(doc, tz);
  }, { size: 'A5', margin: 36 });
  return { buffer, fileName: 'Receipt ' + number + ' - ' + p.STUDENT_NAME + '.pdf', relatedId: p.PAYMENT_ID, studentId: p.STUDENT_ID, type: 'RECEIPT', documentId: number };
}

function cellText(key, value, settings, tz) {
  if (value === '' || value === undefined || value === null) return '';
  if (MONEY_COLUMNS.indexOf(key) !== -1) return formatMoney(value, settings.CURRENCY);
  if (DATE_COLUMNS.test(key)) return formatShortDate(value, tz);
  return String(value);
}

async function reportPdf(ctx, type, filters) {
  const report = generateReport(ctx, type, filters);
  if (!report.success) return null;
  const settings = ctx.settings();
  const tz = ctx.timezone();
  const rows = report.rows;
  const buffer = await render(async doc => {
    await header(doc, settings, report.title + ' (' + rows.length + ')');
    if (!rows.length) { doc.font('Helvetica').fontSize(11).text('No data found for the selected filters.'); footer(doc, tz); return; }
    const cols = Object.keys(rows[0]).filter(k => HIDDEN_REPORT_COLUMNS.indexOf(k) === -1);
    const left = doc.page.margins.left;
    const width = doc.page.width - left - doc.page.margins.right;
    const colW = width / cols.length;
    const drawHeader = () => {
      const y = doc.y;
      doc.rect(left, y, width, 18).fill('#0F2A4A');
      cols.forEach((c, i) => doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.5).text(c.replace(/_/g, ' '), left + i * colW + 3, y + 5, { width: colW - 6, lineBreak: false, ellipsis: true }));
      doc.y = y + 18;
    };
    drawHeader();
    rows.forEach((row, idx) => {
      const texts = cols.map(c => cellText(c, row[c], settings, tz));
      const h = Math.max.apply(null, texts.map(t => doc.font('Helvetica').fontSize(8).heightOfString(t || ' ', { width: colW - 6 }))) + 6;
      if (doc.y + h > doc.page.height - doc.page.margins.bottom) { doc.addPage(); drawHeader(); }
      const y = doc.y;
      if (idx % 2) doc.rect(left, y, width, h).fill('#F5F7FA');
      texts.forEach((t, i) => doc.fillColor('#111111').font('Helvetica').fontSize(8).text(t, left + i * colW + 3, y + 3, { width: colW - 6 }));
      doc.y = y + h;
    });
    footer(doc, tz);
  }, { size: 'A4', layout: 'landscape', margin: 36 });
  return { buffer, fileName: report.title + ' - ' + new Date().toISOString().slice(0, 10) + '.pdf', relatedId: type, studentId: '', type: 'REPORT' };
}

module.exports = { profilePdf, receiptPdf, reportPdf };
