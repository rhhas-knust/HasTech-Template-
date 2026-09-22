/**
 * Admin.gs
 * Authentication, dashboard stats, announcements, reports, admin/user
 * management, and settings endpoints called from the client.
 *
 * AUTHENTICATION NOTE: `checkCredentials()` is intentionally the only place
 * that knows about the demo username/password. To later swap in real
 * Google-account based auth (e.g. Session.getActiveUser() + a domain
 * allow-list), replace the body of `login()` - nothing else in the app
 * needs to change.
 */

// ---------- Authentication ----------

/** Validates demo credentials. Isolated so it can be replaced later without touching login(). */
function checkCredentials(username, password) {
  return username === DEMO_AUTH.USERNAME && password === DEMO_AUTH.PASSWORD;
}

/**
 * Logs an admin in. Returns { success, admin, message }.
 * On success, `admin` is safe to store client-side (no password field exists on it).
 */
function login(username, password) {
  try {
    if (!username || !password) {
      return { success: false, message: 'Please enter your username and password.' };
    }
    if (!checkCredentials(username, password)) {
      return { success: false, message: 'Invalid username or password.' };
    }

    var admin = findRowByIdColumn(SHEETS.ADMINS, 'USERNAME', username);
    if (!admin) {
      return { success: false, message: 'Admin account not found.' };
    }
    if (admin.STATUS !== STATUS.ACTIVE) {
      return { success: false, message: 'This account has been deactivated.' };
    }

    logActivity(admin.NAME, 'LOGIN', admin.NAME + ' logged in', admin.ID);

    return {
      success: true,
      admin: {
        id: admin.ID,
        name: admin.NAME,
        email: admin.EMAIL,
        username: admin.USERNAME,
        role: admin.ROLE
      }
    };
  } catch (e) {
    console.error('login failed: ' + e);
    return { success: false, message: 'Something went wrong. Please try again.' };
  }
}

// ---------- Dashboard ----------

/** Aggregates all stats/lists needed to render the dashboard in a single round trip. */
function getDashboardStats() {
  var students = sheetToObjects(SHEETS.STUDENTS);
  var activeStudents = students.filter(function (s) { return s.STATUS === STATUS.ACTIVE; });
  var classes = sheetToObjects(SHEETS.CLASSES);
  var todayAttendance = getTodayAttendanceCount();
  var paymentsThisMonth = getPaymentsThisMonth();
  var outstanding = getOutstandingFeesReport();
  var outstandingTotal = outstanding.reduce(function (sum, r) { return sum + r.OUTSTANDING; }, 0);

  var recentStudents = students
    .sort(function (a, b) { return new Date(b.CREATED_AT) - new Date(a.CREATED_AT); })
    .slice(0, 5);

  var recentActivity = getRecentActivity(8);
  var announcements = getAnnouncements({ status: 'PUBLISHED' }).slice(0, 5);

  return {
    totalStudents: students.length,
    activeStudents: activeStudents.length,
    totalClasses: classes.length,
    todayAttendance: todayAttendance,
    outstandingFees: outstandingTotal,
    paymentsThisMonth: paymentsThisMonth,
    recentStudents: recentStudents,
    recentActivity: recentActivity,
    announcements: announcements,
    settings: getAllSettings()
  };
}

// ---------- Announcements ----------

function createAnnouncement(data, user) {
  try {
    var missing = requiredFieldsPresent(data, ['title', 'message', 'audience']);
    if (missing) return { success: false, message: 'Please fill in the title, message, and audience.' };

    var obj = {
      ANNOUNCEMENT_ID: Utilities.getUuid(),
      TITLE: data.title.trim(),
      MESSAGE: data.message.trim(),
      AUDIENCE: data.audience,
      CLASS_NAME: data.audience === 'Specific Class' ? (data.className || '') : '',
      DATE: data.date || new Date(),
      STATUS: data.status || 'PUBLISHED',
      CREATED_BY: user || 'SYSTEM',
      CREATED_AT: new Date()
    };
    appendRowFromObject(SHEETS.ANNOUNCEMENTS, obj);
    logActivity(user, 'ANNOUNCEMENT_CREATED', 'Created announcement "' + obj.TITLE + '"', obj.ANNOUNCEMENT_ID);
    return { success: true, announcement: obj, message: 'Announcement created.' };
  } catch (e) {
    console.error('createAnnouncement failed: ' + e);
    return { success: false, message: 'Something went wrong. Please try again.' };
  }
}

function updateAnnouncement(data, user) {
  try {
    if (!data.announcementId) return { success: false, message: 'Missing announcement ID.' };
    var updates = {
      TITLE: data.title, MESSAGE: data.message, AUDIENCE: data.audience,
      CLASS_NAME: data.audience === 'Specific Class' ? (data.className || '') : '',
      DATE: data.date
    };
    Object.keys(updates).forEach(function (k) { if (updates[k] === undefined) delete updates[k]; });
    var ok = updateRowByIdColumn(SHEETS.ANNOUNCEMENTS, 'ANNOUNCEMENT_ID', data.announcementId, updates);
    if (!ok) return { success: false, message: 'Announcement not found.' };
    logActivity(user, 'ANNOUNCEMENT_UPDATED', 'Updated announcement ' + data.announcementId, data.announcementId);
    return { success: true, message: 'Announcement updated.' };
  } catch (e) {
    console.error('updateAnnouncement failed: ' + e);
    return { success: false, message: 'Something went wrong. Please try again.' };
  }
}

function deleteAnnouncement(announcementId, user) {
  try {
    var sheet = getSheet(SHEETS.ANNOUNCEMENTS);
    var data = sheet.getDataRange().getValues();
    var idCol = HEADERS.ANNOUNCEMENTS.indexOf('ANNOUNCEMENT_ID');
    for (var r = 1; r < data.length; r++) {
      if (data[r][idCol] === announcementId) {
        sheet.deleteRow(r + 1);
        logActivity(user, 'ANNOUNCEMENT_DELETED', 'Deleted announcement ' + announcementId, announcementId);
        return { success: true, message: 'Announcement deleted.' };
      }
    }
    return { success: false, message: 'Announcement not found.' };
  } catch (e) {
    console.error('deleteAnnouncement failed: ' + e);
    return { success: false, message: 'Something went wrong. Please try again.' };
  }
}

function setAnnouncementStatus(announcementId, status, user) {
  var ok = updateRowByIdColumn(SHEETS.ANNOUNCEMENTS, 'ANNOUNCEMENT_ID', announcementId, { STATUS: status });
  if (!ok) return { success: false, message: 'Announcement not found.' };
  logActivity(user, status === 'PUBLISHED' ? 'ANNOUNCEMENT_PUBLISHED' : 'ANNOUNCEMENT_UNPUBLISHED', 'Set announcement ' + announcementId + ' to ' + status, announcementId);
  return { success: true, message: 'Announcement ' + (status === 'PUBLISHED' ? 'published' : 'unpublished') + '.' };
}

function getAnnouncements(filters) {
  filters = filters || {};
  var rows = sheetToObjects(SHEETS.ANNOUNCEMENTS);
  if (filters.status) rows = rows.filter(function (a) { return a.STATUS === filters.status; });
  if (filters.audience) rows = rows.filter(function (a) { return a.AUDIENCE === filters.audience; });
  rows.sort(function (a, b) { return new Date(b.DATE) - new Date(a.DATE); });
  return rows;
}

// ---------- Reports ----------

/**
 * Generates report data for the Reports page.
 * type: 'STUDENT_LIST' | 'CLASS_LIST' | 'ATTENDANCE' | 'PAYMENTS' | 'OUTSTANDING_FEES' | 'REGISTRATION'
 */
function generateReport(type, filters) {
  filters = filters || {};
  switch (type) {
    case 'STUDENT_LIST':
      return { success: true, title: 'Student List', rows: getStudents(filters) };
    case 'CLASS_LIST':
      var students = getStudents(filters.className ? { className: filters.className } : {});
      return { success: true, title: 'Class List', rows: students };
    case 'ATTENDANCE':
      return { success: true, title: 'Attendance Report', rows: getAttendanceReport(filters) };
    case 'PAYMENTS':
      return { success: true, title: 'Payment Report', rows: getPayments(filters) };
    case 'OUTSTANDING_FEES':
      return { success: true, title: 'Outstanding Fees Report', rows: getOutstandingFeesReport() };
    case 'REGISTRATION':
      var rows = getStudents(filters);
      if (filters.startDate) {
        var start = new Date(filters.startDate);
        rows = rows.filter(function (s) { return new Date(s.CREATED_AT) >= start; });
      }
      if (filters.endDate) {
        var end = new Date(filters.endDate);
        end.setHours(23, 59, 59, 999);
        rows = rows.filter(function (s) { return new Date(s.CREATED_AT) <= end; });
      }
      return { success: true, title: 'Registration Report', rows: rows };
    default:
      return { success: false, message: 'Unknown report type.' };
  }
}

/** Generates a simple PDF export of a report's rows via Google Docs. */
function exportReportPDF(type, filters, user) {
  try {
    var report = generateReport(type, filters);
    if (!report.success) return report;

    var settings = getAllSettings();
    var fileName = report.title + ' - ' + formatDateForDoc(new Date());
    var doc = DocumentApp.create(fileName);
    var body = doc.getBody();
    body.setMarginTop(36).setMarginBottom(36).setMarginLeft(36).setMarginRight(36);

    var title = body.appendParagraph(settings.SCHOOL_NAME || DEFAULT_SETTINGS.SCHOOL_NAME);
    title.setHeading(DocumentApp.ParagraphHeading.TITLE).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    var heading = body.appendParagraph(report.title);
    heading.setHeading(DocumentApp.ParagraphHeading.HEADING1).setAlignment(DocumentApp.HorizontalAlignment.CENTER);
    body.appendHorizontalRule();

    var rows = report.rows || [];
    if (rows.length === 0) {
      body.appendParagraph('No data found for the selected filters.');
    } else {
      var hiddenColumns = ['_row', 'IS_DEMO', 'PHOTO_URL', 'MIDDLE_NAME'];
      var headers = Object.keys(rows[0]).filter(function (k) { return hiddenColumns.indexOf(k) === -1; });
      var tableData = [headers];
      rows.forEach(function (row) {
        tableData.push(headers.map(function (h) {
          var val = row[h];
          if (val instanceof Date) return formatDateForDoc(val);
          return val === undefined || val === null ? '' : String(val);
        }));
      });
      var table = body.appendTable(tableData);
      var headerRow = table.getRow(0);
      for (var c = 0; c < headerRow.getNumCells(); c++) {
        headerRow.getCell(c).editAsText().setBold(true);
      }
    }

    doc.saveAndClose();
    var docFile = DriveApp.getFileById(doc.getId());
    var pdfBlob = docFile.getAs('application/pdf').setName(fileName + '.pdf');
    var folder = getDocumentsFolder('PROFILE');
    var reportsFolder = getOrCreateFolder(folder.getParents().hasNext() ? folder.getParents().next() : folder, 'Reports');
    var pdfFile = reportsFolder.createFile(pdfBlob);
    docFile.setTrashed(true);

    recordDocument('REPORT', type, '', fileName, pdfFile.getUrl(), user);
    logActivity(user, 'PDF_GENERATED', 'Exported report: ' + report.title, type);

    return { success: true, url: pdfFile.getUrl(), message: 'Report exported.' };
  } catch (e) {
    console.error('exportReportPDF failed: ' + e);
    return { success: false, message: 'Something went wrong generating the report. Please try again.' };
  }
}

// ---------- Settings ----------

function getSettingsForClient() {
  return getAllSettings();
}

function saveSettings(data, user) {
  try {
    if (!data || Object.keys(data).length === 0) {
      return { success: false, message: 'No settings to save.' };
    }
    var updated = updateSettings(data, user);
    return { success: true, settings: updated, message: 'Settings saved successfully.' };
  } catch (e) {
    console.error('saveSettings failed: ' + e);
    return { success: false, message: 'Something went wrong. Please try again.' };
  }
}

// ---------- Admin / user management ----------

function getAdmins() {
  return sheetToObjects(SHEETS.ADMINS);
}

function addAdmin(data, user) {
  try {
    var missing = requiredFieldsPresent(data, ['name', 'email', 'username', 'role']);
    if (missing) return { success: false, message: 'Please fill in all admin fields.' };

    var existing = findRowByIdColumn(SHEETS.ADMINS, 'USERNAME', data.username);
    if (existing) return { success: false, message: 'This username is already in use.' };

    var obj = {
      ID: Utilities.getUuid(),
      NAME: data.name.trim(),
      EMAIL: data.email.trim(),
      USERNAME: data.username.trim(),
      ROLE: data.role,
      STATUS: STATUS.ACTIVE,
      CREATED_AT: new Date()
    };
    appendRowFromObject(SHEETS.ADMINS, obj);
    logActivity(user, 'ADMIN_CREATED', 'Added admin user ' + obj.NAME, obj.ID);
    return { success: true, admin: obj, message: 'Admin added successfully.' };
  } catch (e) {
    console.error('addAdmin failed: ' + e);
    return { success: false, message: 'Something went wrong. Please try again.' };
  }
}

function setAdminStatus(adminId, status, user) {
  var ok = updateRowByIdColumn(SHEETS.ADMINS, 'ID', adminId, { STATUS: status });
  if (!ok) return { success: false, message: 'Admin not found.' };
  logActivity(user, 'ADMIN_UPDATED', 'Set admin ' + adminId + ' status to ' + status, adminId);
  return { success: true, message: 'Admin status updated.' };
}

// ---------- Classes ----------

function addClass(data, user) {
  try {
    var missing = requiredFieldsPresent(data, ['className']);
    if (missing) return { success: false, message: 'Please enter a class name.' };
    var existing = sheetToObjects(SHEETS.CLASSES).filter(function (c) { return c.CLASS_NAME === data.className; })[0];
    if (existing) return { success: false, message: 'This class already exists.' };
    var obj = {
      CLASS_ID: Utilities.getUuid(),
      CLASS_NAME: data.className.trim(),
      ACADEMIC_YEAR: data.academicYear || getSetting('ACADEMIC_YEAR', DEFAULT_SETTINGS.ACADEMIC_YEAR),
      EXPECTED_FEE: parseFloat(data.expectedFee) || 0,
      IS_DEMO: false,
      CREATED_AT: new Date()
    };
    appendRowFromObject(SHEETS.CLASSES, obj);
    logActivity(user, 'CLASS_CREATED', 'Added class ' + obj.CLASS_NAME, obj.CLASS_ID);
    return { success: true, classObj: obj, message: 'Class added successfully.' };
  } catch (e) {
    console.error('addClass failed: ' + e);
    return { success: false, message: 'Something went wrong. Please try again.' };
  }
}
