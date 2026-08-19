/**
 * Job Tracker — Google Apps Script backend.
 *
 * Receives a JSON POST from the Chrome extension, saves the job description
 * as its own Google Doc in a "Job Descriptions" Drive folder, and appends
 * one row (with a link to that Doc) to the "Applications" sheet.
 *
 * Deploy: Extensions > Apps Script > Deploy > New deployment > Web app
 *   - Execute as: Me
 *   - Who has access: Anyone
 * Copy the web app URL into the extension's options page.
 *
 * NOTE: after editing this file you must re-deploy (Deploy > Manage
 * deployments > pencil > New version) and re-authorize, since creating
 * Docs/folders needs extra Drive permissions.
 */

// Simple shared secret so random people can't write to your sheet
// if the URL ever leaks. Set the same value in the extension options.
const SECRET = 'change-me-to-something-random';

const SHEET_NAME = 'Applications';
const JD_FOLDER_NAME = 'Job Descriptions';

const HEADERS = [
  'Date applied', 'Job title', 'Company', 'Location', 'Salary',
  'Source URL', 'Status', 'JD doc', 'Notes'
];

/** Health check: open the web app URL in a browser to verify it's deployed. */
function doGet() {
  return jsonResponse({ ok: true, message: 'Job tracker endpoint is live' });
}

/** Called by the extension. Expects a JSON body matching the fields below. */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    if (data.secret !== SECRET) {
      return jsonResponse({ ok: false, error: 'Bad secret' });
    }

    // Save the JD as its own Google Doc (skipped if no description sent).
    const jdDocUrl = data.description
      ? saveJdAsDoc(data)
      : '';

    const sheet = getOrCreateSheet();
    sheet.appendRow([
      parseDateApplied(data.dateApplied),  // user-set date, or today
      data.title    || '',
      data.company  || '',
      data.location || '',
      data.salary   || '',
      data.url      || '',
      data.status   || 'Applied',
      '',                          // JD doc link set as formula below
      data.notes    || ''
    ]);

    // Make the JD column a clean clickable "Open JD" link.
    if (jdDocUrl) {
      const row = sheet.getLastRow();
      sheet.getRange(row, 8).setFormula(
        '=HYPERLINK("' + jdDocUrl + '", "Open JD")'
      );
    }

    return jsonResponse({ ok: true, row: sheet.getLastRow(), jdDoc: jdDocUrl });
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err) });
  }
}

/**
 * Creates a Google Doc containing the job description inside the
 * "Job Descriptions" folder and returns its URL.
 * Doc name: "Company — Title — YYYY-MM-DD"
 */
function saveJdAsDoc(data) {
  const dateStr = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const name = [data.company || 'Unknown company',
                data.title   || 'Unknown title',
                dateStr].join(' — ');

  const doc = DocumentApp.create(name);
  const body = doc.getBody();

  // Header info at the top of the doc, then the JD text.
  body.appendParagraph(name).setHeading(DocumentApp.ParagraphHeading.HEADING1);
  if (data.url) body.appendParagraph('Source: ' + data.url);
  body.appendParagraph('').appendHorizontalRule();
  body.appendParagraph(data.description);
  doc.saveAndClose();

  // Move it from the Drive root into the Job Descriptions folder.
  const file = DriveApp.getFileById(doc.getId());
  file.moveTo(getOrCreateFolder());

  return doc.getUrl();
}

/**
 * Parses the extension's "YYYY-MM-DD" date as a local date (parsing the
 * string directly would treat it as UTC midnight and could shift a day).
 * Falls back to now if missing/invalid.
 */
function parseDateApplied(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date();
}

/** Returns the Job Descriptions folder, creating it on first run. */
function getOrCreateFolder() {
  const it = DriveApp.getFoldersByName(JD_FOLDER_NAME);
  return it.hasNext() ? it.next() : DriveApp.createFolder(JD_FOLDER_NAME);
}

/** Returns the Applications sheet, creating it with headers on first run. */
function getOrCreateSheet() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
