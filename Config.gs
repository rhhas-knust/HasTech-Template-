/**
 * Config.gs
 * Central configuration for the HASTECH School Management System.
 * Sheet names, folder names, and default values live here so the rest
 * of the app never hardcodes strings that might need to change per client.
 */

// ---- Sheet names (the "database tables") ----
var SHEETS = {
  SETTINGS: 'SETTINGS',
  ADMINS: 'ADMINS',
  STUDENTS: 'STUDENTS',
  GUARDIANS: 'GUARDIANS',
  CLASSES: 'CLASSES',
  ATTENDANCE: 'ATTENDANCE',
  PAYMENTS: 'PAYMENTS',
  ANNOUNCEMENTS: 'ANNOUNCEMENTS',
  DOCUMENTS: 'DOCUMENTS',
  ACTIVITY_LOG: 'ACTIVITY_LOG'
};

// ---- Column headers for each sheet, in order ----
var HEADERS = {
  SETTINGS: ['SETTING', 'VALUE'],
  ADMINS: ['ID', 'NAME', 'EMAIL', 'USERNAME', 'ROLE', 'STATUS', 'CREATED_AT'],
  STUDENTS: ['STUDENT_ID', 'FIRST_NAME', 'MIDDLE_NAME', 'LAST_NAME', 'DOB', 'GENDER',
    'CLASS', 'ACADEMIC_YEAR', 'ADMISSION_DATE', 'PHONE', 'EMAIL', 'ADDRESS',
    'PREVIOUS_SCHOOL', 'PHOTO_URL', 'STATUS', 'IS_DEMO', 'REGISTERED_BY', 'CREATED_AT', 'UPDATED_AT'],
  GUARDIANS: ['GUARDIAN_ID', 'STUDENT_ID', 'NAME', 'RELATIONSHIP', 'PHONE', 'EMAIL',
    'OCCUPATION', 'ADDRESS', 'CREATED_AT'],
  CLASSES: ['CLASS_ID', 'CLASS_NAME', 'ACADEMIC_YEAR', 'EXPECTED_FEE', 'IS_DEMO', 'CREATED_AT'],
  ATTENDANCE: ['ATTENDANCE_ID', 'DATE', 'STUDENT_ID', 'STUDENT_NAME', 'CLASS', 'STATUS',
    'RECORDED_BY', 'TIMESTAMP'],
  PAYMENTS: ['PAYMENT_ID', 'STUDENT_ID', 'STUDENT_NAME', 'CLASS', 'PAYMENT_TYPE', 'AMOUNT',
    'ACADEMIC_YEAR', 'PAYMENT_DATE', 'PAYMENT_METHOD', 'REFERENCE', 'RECORDED_BY', 'TIMESTAMP'],
  ANNOUNCEMENTS: ['ANNOUNCEMENT_ID', 'TITLE', 'MESSAGE', 'AUDIENCE', 'CLASS_NAME', 'DATE',
    'STATUS', 'CREATED_BY', 'CREATED_AT'],
  DOCUMENTS: ['DOCUMENT_ID', 'TYPE', 'RELATED_ID', 'STUDENT_ID', 'FILE_NAME', 'URL',
    'GENERATED_BY', 'TIMESTAMP'],
  ACTIVITY_LOG: ['LOG_ID', 'TIMESTAMP', 'USER', 'ACTION', 'DESCRIPTION', 'RELATED_ID']
};

// ---- Drive folder structure ----
var DRIVE_ROOT_FOLDER = 'HASTECH SCHOOL SYSTEM';
var DRIVE_DOCUMENTS_FOLDER = 'Documents';
var DRIVE_STUDENT_PROFILES_FOLDER = 'Student Profiles';
var DRIVE_RECEIPTS_FOLDER = 'Receipts';

// ---- Default settings applied on first setup ----
var DEFAULT_SETTINGS = {
  SCHOOL_NAME: 'Bright Future Academy',
  SCHOOL_MOTTO: 'Knowledge, Character, Excellence',
  SCHOOL_EMAIL: 'info@brightfutureacademy.edu',
  SCHOOL_PHONE: '+233 000 000 000',
  SCHOOL_ADDRESS: '123 Academy Road, Accra, Ghana',
  SCHOOL_LOGO_URL: '',
  ACADEMIC_YEAR: '2026/2027',
  CURRENCY: 'GHS',
  ADMIN_EMAIL: 'admin@brightfutureacademy.edu'
};

// ---- Demo authentication (Phase 1: replace with proper auth later) ----
// Kept isolated here so swapping to Google-account based auth only touches Admin.gs.
var DEMO_AUTH = {
  USERNAME: 'admin',
  PASSWORD: 'admin123'
};

var STATUS = {
  ACTIVE: 'ACTIVE',
  INACTIVE: 'INACTIVE',
  GRADUATED: 'GRADUATED',
  TRANSFERRED: 'TRANSFERRED'
};

var ADMIN_ROLES = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  STAFF: 'STAFF'
};

/**
 * Returns all settings as a plain object, e.g. { SCHOOL_NAME: 'Bright Future Academy', ... }.
 * Cached for the duration of the script execution to avoid repeated sheet reads.
 */
var _settingsCache = null;
function getAllSettings() {
  if (_settingsCache) return _settingsCache;
  var sheet = getSheet(SHEETS.SETTINGS);
  var data = sheet.getDataRange().getValues();
  var settings = {};
  for (var i = 1; i < data.length; i++) {
    var key = data[i][0];
    if (key) settings[key] = data[i][1];
  }
  _settingsCache = settings;
  return settings;
}

/** Returns a single setting value, or a fallback if not set. */
function getSetting(key, fallback) {
  var settings = getAllSettings();
  return (settings[key] !== undefined && settings[key] !== '') ? settings[key] : (fallback !== undefined ? fallback : '');
}

/**
 * Updates one or more settings. Accepts an object of key/value pairs.
 * Invalidates the in-memory cache.
 */
function updateSettings(newSettings, user) {
  var sheet = getSheet(SHEETS.SETTINGS);
  var data = sheet.getDataRange().getValues();
  var rowIndexByKey = {};
  for (var i = 1; i < data.length; i++) {
    rowIndexByKey[data[i][0]] = i + 1; // 1-based sheet row
  }
  Object.keys(newSettings).forEach(function (key) {
    var value = newSettings[key];
    if (rowIndexByKey[key]) {
      sheet.getRange(rowIndexByKey[key], 2).setValue(value);
    } else {
      sheet.appendRow([key, value]);
    }
  });
  _settingsCache = null;
  logActivity(user || 'SYSTEM', 'SETTINGS_UPDATED', 'Updated settings: ' + Object.keys(newSettings).join(', '), '');
  return getAllSettings();
}
