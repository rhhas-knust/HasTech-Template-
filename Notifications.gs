/**
 * Notifications.gs
 * Outbound email notifications via GmailApp/MailApp. Every function here is
 * defensive - a failed email must never break the calling workflow.
 */

/** Sends a registration confirmation email to a student's guardian, if an email address exists. */
function sendRegistrationEmail(student, guardian) {
  if (!guardian || !guardian.EMAIL) return; // No email available - skip silently, as required.
  try {
    var settings = getAllSettings();
    var schoolName = settings.SCHOOL_NAME || DEFAULT_SETTINGS.SCHOOL_NAME;
    var subject = 'Student Registration Confirmation - ' + schoolName;
    var body = 'Dear Parent/Guardian,\n\n' +
      'Your child has successfully been registered at ' + schoolName + '.\n\n' +
      'Student Name: ' + student.FIRST_NAME + ' ' + student.LAST_NAME + '\n' +
      'Student ID: ' + student.STUDENT_ID + '\n' +
      'Class: ' + student.CLASS + '\n' +
      'Academic Year: ' + student.ACADEMIC_YEAR + '\n\n' +
      'Thank you.\n\n' +
      schoolName;
    sendEmail(guardian.EMAIL, subject, body);
  } catch (e) {
    console.error('sendRegistrationEmail failed: ' + e);
  }
}

/** Generic, defensive email sender. Logs failures instead of throwing. */
function sendEmail(to, subject, body) {
  if (!to || String(to).trim() === '') return false;
  try {
    MailApp.sendEmail(to, subject, body);
    return true;
  } catch (e) {
    console.error('sendEmail failed for ' + to + ': ' + e);
    return false;
  }
}
