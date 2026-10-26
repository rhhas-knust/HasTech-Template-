// GET /api/pdf?school=slug&type=profile&id=BFA-2026-0001
//     /api/pdf?school=slug&type=receipt&id=PAY-000001
//     /api/pdf?school=slug&type=report&report=STUDENT_LIST&className=&startDate=&endDate=
// Streams the PDF and records it in the DOCUMENTS tab.
const { sendJson, query, openSchoolForRequest, handleError } = require('../lib/http');
const { SHEETS } = require('../lib/schema');
const { uuid, nowIso } = require('../lib/util');
const pdf = require('../lib/pdf');

function enabled(ctx, module) {
  return String(ctx.setting('ENABLED_MODULES') || '').split(',').map(s => s.trim()).indexOf(module) !== -1;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method !== 'GET') return sendJson(res, 405, { error: 'Method not allowed.' });
    const q = query(req);
    const opened = await openSchoolForRequest(req, res, q.school);
    if (!opened) return;
    const { ctx } = opened;

    let out = null;
    if (q.type === 'profile') out = await pdf.profilePdf(ctx, q.id);
    else if (q.type === 'receipt' && enabled(ctx, 'payments')) out = await pdf.receiptPdf(ctx, q.id);
    else if (q.type === 'report' && enabled(ctx, 'reports')) out = await pdf.reportPdf(ctx, q.report, q);
    if (!out) return sendJson(res, 404, { error: 'Nothing found to generate.' });

    ctx.append(SHEETS.DOCUMENTS, {
      DOCUMENT_ID: out.documentId || uuid(), TYPE: out.type, RELATED_ID: out.relatedId, STUDENT_ID: out.studentId,
      FILE_NAME: out.fileName, URL: '', GENERATED_BY: ctx.userLabel(), TIMESTAMP: nowIso()
    });
    ctx.log(out.type === 'RECEIPT' ? 'RECEIPT_GENERATED' : 'PDF_GENERATED', 'Generated ' + out.fileName, out.relatedId);
    await ctx.flush();

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Disposition', 'inline; filename="' + out.fileName.replace(/[^\w .()-]/g, '_') + '"');
    res.end(out.buffer);
  } catch (err) {
    return handleError(res, err, 'pdf');
  }
};
