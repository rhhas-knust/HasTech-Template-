/**
 * Code.gs
 * Web app entry point. Serves the single-page application shell and
 * provides the include() helper used to assemble HTML partials.
 */

function doGet(e) {
  var template = HtmlService.createTemplateFromFile('Index');
  var settings = {};
  try {
    settings = getAllSettings();
  } catch (err) {
    // Sheet not yet initialised - the UI will prompt for setup.
    settings = {};
  }
  template.schoolName = settings.SCHOOL_NAME || DEFAULT_SETTINGS.SCHOOL_NAME;

  return template.evaluate()
    .setTitle((settings.SCHOOL_NAME || DEFAULT_SETTINGS.SCHOOL_NAME) + ' | HASTECH School Management System')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Includes another HTML file's content inline. Used inside Index.html templates. */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * Called from the client on first load to make sure the database/Drive
 * structure exists. Safe to call repeatedly - setupSystem() is idempotent.
 */
function ensureSystemReady() {
  try {
    setupSystem();
    return { success: true };
  } catch (e) {
    console.error('ensureSystemReady failed: ' + e);
    return { success: false, message: 'Could not initialise the system. Please check the Apps Script logs.' };
  }
}
