// Guardian notification emails through Resend. Without RESEND_API_KEY/EMAIL_FROM nothing is sent.
// A failed email never breaks the action that triggered it.

async function sendEmail({ to, subject, text, replyTo }) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;
  if (!key || !from || !to) return false;
  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from, to: [to], subject, text, reply_to: replyTo || undefined })
    });
    if (!res.ok) {
      console.error('Email send failed:', res.status, (await res.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (e) {
    console.error('Email send failed:', e.message);
    return false;
  }
}

async function sendRegistrationEmail(settings, student, guardian) {
  const school = settings.SCHOOL_NAME;
  return sendEmail({
    to: guardian.EMAIL,
    replyTo: settings.SCHOOL_EMAIL,
    subject: 'Student Registration Confirmation - ' + school,
    text: [
      'Dear Parent/Guardian,',
      '',
      'Your child has successfully been registered at ' + school + '.',
      '',
      'Student Name: ' + student.FIRST_NAME + ' ' + student.LAST_NAME,
      'Student ID: ' + student.STUDENT_ID,
      'Class: ' + student.CLASS,
      'Academic Year: ' + student.ACADEMIC_YEAR,
      '',
      'Thank you.',
      '',
      school
    ].join('\n')
  });
}

module.exports = { sendEmail, sendRegistrationEmail };
