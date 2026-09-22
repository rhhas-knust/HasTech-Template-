/**
 * Documents.gs
 * PDF generation via Google Docs, for student profiles and payment receipts.
 * Generated files are saved into the Drive folder tree defined in Database.gs
 * and recorded in the DOCUMENTS sheet.
 */

/** Generates a professional student-profile PDF. Returns { success, url, message }. */
function generateStudentProfilePDF(studentId, user) {
  try {
    var profile = getStudentProfile(studentId);
    if (!profile.success) return { success: false, message: 'Student not found.' };
    var student = profile.student;
    var guardian = profile.guardians[0];

    var settings = getAllSettings();
    var fileName = 'Student Profile - ' + student.FIRST_NAME + ' ' + student.LAST_NAME + ' (' + student.STUDENT_ID + ')';

    var doc = DocumentApp.create(fileName);
    var body = doc.getBody();
    body.setMarginTop(36).setMarginBottom(36).setMarginLeft(54).setMarginRight(54);

    // Header: school identity
    var title = body.appendParagraph(settings.SCHOOL_NAME || DEFAULT_SETTINGS.SCHOOL_NAME);
    title.setHeading(DocumentApp.ParagraphHeading.TITLE);
    title.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    if (settings.SCHOOL_MOTTO) {
      var motto = body.appendParagraph(settings.SCHOOL_MOTTO);
      motto.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setItalic(true);
    }
    var contactLine = [settings.SCHOOL_ADDRESS, settings.SCHOOL_PHONE, settings.SCHOOL_EMAIL].filter(Boolean).join('  |  ');
    if (contactLine) {
      var contact = body.appendParagraph(contactLine);
      contact.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setFontSize(9);
    }
    body.appendHorizontalRule();

    var heading = body.appendParagraph('STUDENT PROFILE');
    heading.setHeading(DocumentApp.ParagraphHeading.HEADING1);

    if (student.PHOTO_URL) {
      try {
        var photoBlob = UrlFetchApp.fetch(student.PHOTO_URL).getBlob();
        var img = body.appendImage(photoBlob);
        img.setWidth(100);
        img.setHeight(100);
      } catch (imgErr) {
        console.error('Could not fetch student photo: ' + imgErr);
      }
    }

    appendFieldTable(body, 'Student Information', [
      ['Student ID', student.STUDENT_ID],
      ['Full Name', [student.FIRST_NAME, student.MIDDLE_NAME, student.LAST_NAME].filter(Boolean).join(' ')],
      ['Date of Birth', formatDateForDoc(student.DOB)],
      ['Gender', student.GENDER],
      ['Class', student.CLASS],
      ['Academic Year', student.ACADEMIC_YEAR],
      ['Admission Date', formatDateForDoc(student.ADMISSION_DATE)],
      ['Status', student.STATUS],
      ['Phone', student.PHONE || 'N/A'],
      ['Email', student.EMAIL || 'N/A'],
      ['Address', student.ADDRESS || 'N/A'],
      ['Previous School', student.PREVIOUS_SCHOOL || 'N/A']
    ]);

    if (guardian) {
      appendFieldTable(body, 'Guardian Information', [
        ['Name', guardian.NAME],
        ['Relationship', guardian.RELATIONSHIP],
        ['Phone', guardian.PHONE],
        ['Email', guardian.EMAIL || 'N/A'],
        ['Occupation', guardian.OCCUPATION || 'N/A'],
        ['Address', guardian.ADDRESS || 'N/A']
      ]);
    }

    var footer = body.appendParagraph('Generated on ' + formatDateForDoc(new Date()) + ' by HASTECH School Management System');
    footer.setFontSize(8).setForegroundColor('#888888').setSpacingBefore(24);

    doc.saveAndClose();

    var pdf = savePdfAndCleanup(doc.getId(), fileName, 'PROFILE');

    recordDocument('STUDENT_PROFILE', studentId, studentId, fileName, pdf.getUrl(), user);
    logActivity(user, 'PDF_GENERATED', 'Generated student profile PDF for ' + student.FIRST_NAME + ' ' + student.LAST_NAME, studentId);

    return { success: true, url: pdf.getUrl(), message: 'Student profile PDF generated.' };
  } catch (e) {
    console.error('generateStudentProfilePDF failed: ' + e);
    return { success: false, message: 'Something went wrong generating the PDF. Please try again.' };
  }
}

/** Generates a professional payment-receipt PDF. Returns { success, url, message }. */
function generatePaymentReceiptPDF(paymentId, user) {
  try {
    var payment = getPaymentById(paymentId);
    if (!payment) return { success: false, message: 'Payment not found.' };

    var settings = getAllSettings();

    // Reserve the receipt number atomically by appending a placeholder row
    // immediately, before the (slower) PDF generation below, so two
    // concurrent requests can never receive the same receipt number.
    var lock = LockService.getScriptLock();
    lock.waitLock(10000);
    var receiptNumber;
    try {
      receiptNumber = generateSequentialCode(SHEETS.DOCUMENTS, 'DOCUMENT_ID', 'RCT-', 6);
      recordDocument('RECEIPT', paymentId, payment.STUDENT_ID, 'Generating...', '', user, receiptNumber);
    } finally {
      lock.releaseLock();
    }
    var fileName = 'Receipt ' + receiptNumber + ' - ' + payment.STUDENT_NAME;

    var doc = DocumentApp.create(fileName);
    var body = doc.getBody();
    body.setMarginTop(36).setMarginBottom(36).setMarginLeft(54).setMarginRight(54);

    var title = body.appendParagraph(settings.SCHOOL_NAME || DEFAULT_SETTINGS.SCHOOL_NAME);
    title.setHeading(DocumentApp.ParagraphHeading.TITLE);
    title.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    var contactLine = [settings.SCHOOL_ADDRESS, settings.SCHOOL_PHONE, settings.SCHOOL_EMAIL].filter(Boolean).join('  |  ');
    if (contactLine) {
      var contact = body.appendParagraph(contactLine);
      contact.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setFontSize(9);
    }
    body.appendHorizontalRule();

    var heading = body.appendParagraph('PAYMENT RECEIPT');
    heading.setHeading(DocumentApp.ParagraphHeading.HEADING1);
    heading.setAlignment(DocumentApp.HorizontalAlignment.CENTER);

    var receiptNoPara = body.appendParagraph('Receipt No: ' + receiptNumber);
    receiptNoPara.setAlignment(DocumentApp.HorizontalAlignment.CENTER).setBold(true);

    appendFieldTable(body, '', [
      ['Student Name', payment.STUDENT_NAME],
      ['Student ID', payment.STUDENT_ID],
      ['Class', payment.CLASS],
      ['Payment Type', payment.PAYMENT_TYPE],
      ['Amount', formatCurrencyServer(payment.AMOUNT)],
      ['Payment Method', payment.PAYMENT_METHOD],
      ['Reference', payment.REFERENCE || 'N/A'],
      ['Payment Date', formatDateForDoc(payment.PAYMENT_DATE)],
      ['Recorded By', payment.RECORDED_BY]
    ]);

    var thanks = body.appendParagraph('Thank you for your payment.');
    thanks.setSpacingBefore(24).setBold(true);

    var footer = body.appendParagraph('Generated on ' + formatDateForDoc(new Date()) + ' by HASTECH School Management System');
    footer.setFontSize(8).setForegroundColor('#888888').setSpacingBefore(24);

    doc.saveAndClose();

    var pdf = savePdfAndCleanup(doc.getId(), fileName, 'RECEIPT');

    updateRowByIdColumn(SHEETS.DOCUMENTS, 'DOCUMENT_ID', receiptNumber, { FILE_NAME: fileName, URL: pdf.getUrl() });
    logActivity(user, 'RECEIPT_GENERATED', 'Generated receipt ' + receiptNumber + ' for ' + payment.STUDENT_NAME, paymentId);

    return { success: true, url: pdf.getUrl(), message: 'Receipt generated.' };
  } catch (e) {
    console.error('generatePaymentReceiptPDF failed: ' + e);
    return { success: false, message: 'Something went wrong generating the receipt. Please try again.' };
  }
}

/** Converts a temporary Google Doc into a PDF saved in the right Drive folder, then trashes the Doc. */
function savePdfAndCleanup(docId, fileName, folderType) {
  var docFile = DriveApp.getFileById(docId);
  var pdfBlob = docFile.getAs('application/pdf').setName(fileName + '.pdf');
  var folder = getDocumentsFolder(folderType);
  var pdfFile = folder.createFile(pdfBlob);
  docFile.setTrashed(true);
  return pdfFile;
}

function appendFieldTable(body, sectionTitle, rows) {
  if (sectionTitle) {
    var h = body.appendParagraph(sectionTitle);
    h.setHeading(DocumentApp.ParagraphHeading.HEADING2);
  }
  var table = body.appendTable(rows);
  for (var i = 0; i < table.getNumRows(); i++) {
    var row = table.getRow(i);
    row.getCell(0).setWidth(150);
    row.getCell(0).editAsText().setBold(true);
  }
}

function formatDateForDoc(date) {
  if (!date) return 'N/A';
  var d = (date instanceof Date) ? date : new Date(date);
  if (isNaN(d.getTime())) return String(date);
  return Utilities.formatDate(d, Session.getScriptTimeZone() || 'UTC', 'MMMM d, yyyy');
}

function recordDocument(type, relatedId, studentId, fileName, url, user, documentId) {
  appendRowFromObject(SHEETS.DOCUMENTS, {
    DOCUMENT_ID: documentId || Utilities.getUuid(),
    TYPE: type,
    RELATED_ID: relatedId,
    STUDENT_ID: studentId,
    FILE_NAME: fileName,
    URL: url,
    GENERATED_BY: user || 'SYSTEM',
    TIMESTAMP: new Date()
  });
}
