/**
 * Database.gs
 * All direct Google Sheets access goes through the helpers in this file.
 * Other modules should not call SpreadsheetApp directly - this keeps the
 * "database layer" swappable and keeps performance patterns (batch reads/
 * writes) consistent across the app.
 */

/** Returns the spreadsheet this script is bound to. */
function getDb() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** Returns a sheet by name, creating it (with headers) if it doesn't exist. */
function getSheet(name) {
  var ss = getDb();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    var headers = HEADERS[name];
    if (headers) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#0F2A4A').setFontColor('#FFFFFF');
    }
  }
  return sheet;
}

/** Converts a sheet's rows into an array of plain objects keyed by header name. */
function sheetToObjects(sheetName) {
  var sheet = getSheet(sheetName);
  var range = sheet.getDataRange();
  var values = range.getValues();
  if (values.length < 2) return [];
  var headers = values[0];
  var out = [];
  for (var r = 1; r < values.length; r++) {
    var row = values[r];
    // Skip fully blank rows
    if (row.join('') === '') continue;
    var obj = {};
    for (var c = 0; c < headers.length; c++) {
      obj[headers[c]] = row[c];
    }
    obj._row = r + 1; // 1-based sheet row number, used for updates/deletes
    out.push(obj);
  }
  return out;
}

/** Appends a single object as a row, mapping fields to the sheet's header order. */
function appendRowFromObject(sheetName, obj) {
  var sheet = getSheet(sheetName);
  var headers = HEADERS[sheetName];
  var row = headers.map(function (h) { return obj[h] !== undefined ? obj[h] : ''; });
  sheet.appendRow(row);
  return obj;
}

/** Updates the row matching idColumnName === idValue with the given field values. */
function updateRowByIdColumn(sheetName, idColumnName, idValue, updates) {
  var sheet = getSheet(sheetName);
  var headers = HEADERS[sheetName];
  var idCol = headers.indexOf(idColumnName);
  if (idCol === -1) throw new Error('Unknown id column ' + idColumnName + ' for ' + sheetName);
  var data = sheet.getDataRange().getValues();
  for (var r = 1; r < data.length; r++) {
    if (data[r][idCol] === idValue) {
      var rowNum = r + 1;
      Object.keys(updates).forEach(function (key) {
        var col = headers.indexOf(key);
        if (col !== -1) {
          sheet.getRange(rowNum, col + 1).setValue(updates[key]);
        }
      });
      return true;
    }
  }
  return false;
}

/** Finds a single row object by id column, or null if not found. */
function findRowByIdColumn(sheetName, idColumnName, idValue) {
  var rows = sheetToObjects(sheetName);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i][idColumnName] === idValue) return rows[i];
  }
  return null;
}

/**
 * Generates a sequential, zero-padded code such as BFA-2026-0001 or PAY-000123.
 * Scans the given sheet/column for the highest existing sequence number that
 * matches the supplied prefix, so it stays correct even if rows are deleted.
 * Wrapped in a script lock by callers to avoid race conditions on rapid submits.
 */
function generateSequentialCode(sheetName, idColumnName, prefix, padLength) {
  var rows = sheetToObjects(sheetName);
  var maxSeq = 0;
  var escapedPrefix = prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  var pattern = new RegExp('^' + escapedPrefix + '(\\d+)$');
  rows.forEach(function (row) {
    var id = String(row[idColumnName] || '');
    var m = id.match(pattern);
    if (m) {
      var seq = parseInt(m[1], 10);
      if (seq > maxSeq) maxSeq = seq;
    }
  });
  var next = maxSeq + 1;
  var seqStr = String(next);
  while (seqStr.length < padLength) seqStr = '0' + seqStr;
  return prefix + seqStr;
}

/** Appends an entry to the ACTIVITY_LOG sheet. Never throws - logging must not break the app. */
function logActivity(user, action, description, relatedId) {
  try {
    var sheet = getSheet(SHEETS.ACTIVITY_LOG);
    sheet.appendRow([
      Utilities.getUuid(),
      new Date(),
      user || 'SYSTEM',
      action || '',
      description || '',
      relatedId || ''
    ]);
  } catch (e) {
    console.error('logActivity failed: ' + e);
  }
}

/** Returns the most recent N activity log entries, newest first. */
function getRecentActivity(limit) {
  var rows = sheetToObjects(SHEETS.ACTIVITY_LOG);
  rows.sort(function (a, b) { return new Date(b.TIMESTAMP) - new Date(a.TIMESTAMP); });
  return rows.slice(0, limit || 10);
}

/**
 * Full system initialisation. Safe to run multiple times - never creates
 * duplicate sheets, folders, settings, or demo records.
 */
function setupSystem() {
  // 1. Create all sheets with headers
  Object.keys(SHEETS).forEach(function (key) {
    getSheet(SHEETS[key]);
  });

  // Remove the default "Sheet1" if Apps Script created it and it's empty/unused
  try {
    var defaultSheet = getDb().getSheetByName('Sheet1');
    if (defaultSheet && getDb().getSheets().length > 1) {
      var lastRow = defaultSheet.getLastRow();
      var lastCol = defaultSheet.getLastColumn();
      if (lastRow === 0 && lastCol === 0) {
        getDb().deleteSheet(defaultSheet);
      }
    }
  } catch (e) { /* ignore */ }

  // 2. Default settings (only fill in keys that don't already exist)
  var existing = getAllSettings();
  var toSet = {};
  Object.keys(DEFAULT_SETTINGS).forEach(function (key) {
    if (existing[key] === undefined || existing[key] === '') {
      toSet[key] = DEFAULT_SETTINGS[key];
    }
  });
  if (Object.keys(toSet).length > 0) {
    var settingsSheet = getSheet(SHEETS.SETTINGS);
    var existingKeys = sheetToObjects(SHEETS.SETTINGS).map(function (r) { return r.SETTING; });
    Object.keys(toSet).forEach(function (key) {
      if (existingKeys.indexOf(key) === -1) {
        settingsSheet.appendRow([key, toSet[key]]);
      }
    });
    _settingsCache = null;
  }

  // 3. Default admin
  var admins = sheetToObjects(SHEETS.ADMINS);
  if (admins.length === 0) {
    appendRowFromObject(SHEETS.ADMINS, {
      ID: Utilities.getUuid(),
      NAME: 'System Administrator',
      EMAIL: getSetting('ADMIN_EMAIL', 'admin@brightfutureacademy.edu'),
      USERNAME: DEMO_AUTH.USERNAME,
      ROLE: ADMIN_ROLES.SUPER_ADMIN,
      STATUS: STATUS.ACTIVE,
      CREATED_AT: new Date()
    });
  }

  // 4. Drive folders
  setupDriveFolders();

  // 5. Sample classes
  var classes = sheetToObjects(SHEETS.CLASSES);
  if (classes.length === 0) {
    var sampleClasses = ['Nursery 1', 'Nursery 2', 'Primary 1', 'Primary 2', 'Primary 3', 'JHS 1', 'JHS 2', 'JHS 3'];
    var academicYear = getSetting('ACADEMIC_YEAR', DEFAULT_SETTINGS.ACADEMIC_YEAR);
    sampleClasses.forEach(function (className) {
      appendRowFromObject(SHEETS.CLASSES, {
        CLASS_ID: Utilities.getUuid(),
        CLASS_NAME: className,
        ACADEMIC_YEAR: academicYear,
        EXPECTED_FEE: 500,
        IS_DEMO: true,
        CREATED_AT: new Date()
      });
    });
  }

  // 6. Demo students (only if STUDENTS sheet is empty)
  var students = sheetToObjects(SHEETS.STUDENTS);
  if (students.length === 0) {
    seedDemoStudents();
  }

  // 7. Sample announcements
  var announcements = sheetToObjects(SHEETS.ANNOUNCEMENTS);
  if (announcements.length === 0) {
    appendRowFromObject(SHEETS.ANNOUNCEMENTS, {
      ANNOUNCEMENT_ID: Utilities.getUuid(),
      TITLE: 'Welcome to the New Academic Year',
      MESSAGE: 'We are excited to welcome all students and parents to the ' + getSetting('ACADEMIC_YEAR', DEFAULT_SETTINGS.ACADEMIC_YEAR) + ' academic year. Classes begin as scheduled.',
      AUDIENCE: 'All Students',
      CLASS_NAME: '',
      DATE: new Date(),
      STATUS: 'PUBLISHED',
      CREATED_BY: 'SYSTEM',
      CREATED_AT: new Date()
    });
    appendRowFromObject(SHEETS.ANNOUNCEMENTS, {
      ANNOUNCEMENT_ID: Utilities.getUuid(),
      TITLE: 'Term Fees Due',
      MESSAGE: 'Kindly note that term fees are due by the end of the month. Contact the school office for payment plans.',
      AUDIENCE: 'Parents/Guardians',
      CLASS_NAME: '',
      DATE: new Date(),
      STATUS: 'PUBLISHED',
      CREATED_BY: 'SYSTEM',
      CREATED_AT: new Date()
    });
  }

  logActivity('SYSTEM', 'SYSTEM_SETUP', 'HASTECH School Management System initialised', '');

  return { success: true, message: 'System setup complete.' };
}

/** Creates the Drive folder tree used for generated documents, if missing. */
function setupDriveFolders() {
  var root = getOrCreateFolder(DriveApp.getRootFolder(), DRIVE_ROOT_FOLDER);
  var documents = getOrCreateFolder(root, DRIVE_DOCUMENTS_FOLDER);
  getOrCreateFolder(documents, DRIVE_STUDENT_PROFILES_FOLDER);
  getOrCreateFolder(documents, DRIVE_RECEIPTS_FOLDER);
}

/** Gets a subfolder by name under parent, creating it if it doesn't exist. */
function getOrCreateFolder(parent, name) {
  var folders = parent.getFoldersByName(name);
  if (folders.hasNext()) return folders.next();
  return parent.createFolder(name);
}

/** Returns the (creating-if-needed) target folder for a given document type: 'PROFILE' or 'RECEIPT'. */
function getDocumentsFolder(type) {
  var root = getOrCreateFolder(DriveApp.getRootFolder(), DRIVE_ROOT_FOLDER);
  var documents = getOrCreateFolder(root, DRIVE_DOCUMENTS_FOLDER);
  if (type === 'RECEIPT') return getOrCreateFolder(documents, DRIVE_RECEIPTS_FOLDER);
  return getOrCreateFolder(documents, DRIVE_STUDENT_PROFILES_FOLDER);
}
