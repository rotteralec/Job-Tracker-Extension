// sidepanel.js — the form's brain. Runs as a Chrome side panel (not a popup)
// so it stays open while you click around the page, copy text, etc.
//
// Flow: panel opens → inject scrapers.js into the active tab and run it →
// prefill the form → warn if this job was logged before → user edits →
// Save POSTs JSON to the Apps Script web app → duplicate memory updated.

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', init);

async function init() {
  const settings = await chrome.storage.sync.get(['webAppUrl', 'secret']);

  if (!settings.webAppUrl || !settings.secret) {
    $('setup-notice').classList.remove('hidden');
    $('open-options').addEventListener('click', () => chrome.runtime.openOptionsPage());
    return;
  }

  $('job-form').classList.remove('hidden');
  $('job-form').addEventListener('submit', onSave);

  // Default "Date applied" to today (local time); editable for backfills.
  const now = new Date();
  $('dateApplied').value = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0')
  ].join('-');
  $('rescrape').addEventListener('click', () => scrapeIntoForm({ overwrite: true }));

  await scrapeIntoForm({ overwrite: false });
}

// Asks the page for job data and fills the form.
// overwrite=false (panel open): fill everything.
// overwrite=true (Rescrape click): replace scraped fields but keep your Notes.
async function scrapeIntoForm({ overwrite }) {
  const tab = await activeTab();
  if (!tab) return;

  // Always have at least the URL, even if scraping fails.
  setField('url', tab.url || '', overwrite);

  const data = await scrapeTab(tab);
  if (!data) return; // scrapeTab already showed the error
  setField('url', data.url || '', overwrite);

  setField('title', data.title || '', overwrite);
  setField('company', data.company || '', overwrite);
  setField('location', data.location || '', overwrite);
  setField('salary', data.salary || '', overwrite);
  // The JD is the hardest field to recover — never replace a filled JD
  // with something shorter (e.g. a stray selection or a worse scrape).
  const newDesc = data.description || '';
  if (newDesc.length > $('description').value.length) {
    setField('description', newDesc, overwrite);
  }

  showSource(data.scrapedWith?.length
    ? 'Auto-filled via: ' + data.scrapedWith.join(' + ') + ' — double-check before saving.'
    : 'Nothing recognized on this page — fill manually or highlight the JD and Rescrape.');

  await warnIfDuplicate($('url').value, $('title').value, $('company').value);
}

// Inject the scraper into the page and run it, getting the data back as a
// return value. No persistent content script, no message passing — injected
// scripts share one isolated world, so scrapers.js defines window.JobScrapers
// and the second call reads it.
async function scrapeTab(tab) {
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ['scrapers.js']
    });
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => window.JobScrapers.scrapeAll()
    });
    return result.result;
  } catch (e) {
    // chrome:// pages, PDFs, web store, or a page without injection permission.
    showSource('Scrape failed: ' + e.message);
    return null;
  }
}

async function activeTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function setField(id, value, overwrite) {
  if (!value) return;
  if (overwrite || !$(id).value) $(id).value = value;
}

function showSource(text) {
  const el = $('scrape-source');
  el.textContent = text;
  el.classList.remove('hidden');
}

// ---- Saving ----------------------------------------------------------------

async function onSave(event) {
  event.preventDefault();
  const btn = $('save-btn');
  btn.disabled = true;
  showMessage('Saving…', 'warn');

  try {
    const { webAppUrl, secret } = await chrome.storage.sync.get(['webAppUrl', 'secret']);

    const payload = {
      secret,
      title: $('title').value.trim(),
      company: $('company').value.trim(),
      location: $('location').value.trim(),
      salary: $('salary').value.trim(),
      url: $('url').value.trim(),
      status: $('status').value,
      dateApplied: $('dateApplied').value,
      description: $('description').value.trim(),
      notes: $('notes').value.trim()
    };

    // NOTE: no Content-Type header on purpose. A "application/json" header
    // triggers a CORS preflight (OPTIONS) that Apps Script can't answer.
    // As a plain-text POST it sails through, and Code.gs just JSON.parses it.
    const res = await fetch(webAppUrl, {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    const data = await res.json();

    if (data.ok) {
      showMessage('Saved to sheet ✓ (row ' + data.row + ')', 'success', data.jdDoc);
      await rememberSaved(payload);
    } else {
      showMessage('Sheet said no: ' + (data.error || JSON.stringify(data)), 'error');
    }
  } catch (err) {
    showMessage('Save failed: ' + err.message, 'error');
  } finally {
    btn.disabled = false;
  }
}

// ---- Duplicate detection ---------------------------------------------------
// Job URLs are messy (tracking params, LinkedIn's ?currentJobId=...), so
// each URL is normalized to a stable key before comparing.

function jobKey(url) {
  try {
    const u = new URL(url);
    if (u.hostname.includes('linkedin.com')) {
      const id = u.searchParams.get('currentJobId') ||
                 (u.pathname.match(/\/jobs\/view\/(\d+)/) || [])[1];
      if (id) return 'linkedin:' + id;
    }
    return u.origin + u.pathname; // generic: drop query string + hash
  } catch (e) {
    return url;
  }
}

// Fuzzy key: same role spotted across different sites/URLs.
// "Sr. Cloud Architect – Azure" @ "Williams Int'l" → "williams intl|sr cloud architect azure"
// Location is deliberately excluded — the same job often lists as
// "Detroit, MI" / "Oakland County, MI" / "Remote".
function fuzzyKey(company, title) {
  const norm = (s) => s.toLowerCase()
    .replace(/['’]/g, '')             // Int'l → intl (don't split on apostrophes)
    .replace(/[^a-z0-9 ]+/g, ' ')     // other punctuation → space
    .replace(/\s+/g, ' ').trim();
  return norm(company) + '|' + norm(title);
}

async function rememberSaved(payload) {
  const { savedJobs = {}, savedRoles = {} } = await chrome.storage.local.get(['savedJobs', 'savedRoles']);
  const record = {
    date: new Date().toLocaleDateString(),
    title: payload.title,
    company: payload.company,
    location: payload.location
  };
  savedJobs[jobKey(payload.url)] = record;
  if (payload.company && payload.title) {
    savedRoles[fuzzyKey(payload.company, payload.title)] = record;
  }
  await chrome.storage.local.set({ savedJobs, savedRoles });
}

async function warnIfDuplicate(url, title, company) {
  const { savedJobs = {}, savedRoles = {} } = await chrome.storage.local.get(['savedJobs', 'savedRoles']);

  // Exact: same posting (same URL / LinkedIn job ID).
  const exact = url && savedJobs[jobKey(url)];
  if (exact) {
    showMessage(`Heads up: you logged this exact posting — "${exact.title}" at ${exact.company} on ${exact.date}.`, 'warn');
    return addForgetLink(url, exact);
  }

  // Fuzzy: same company + title seen via a different URL or site.
  const fuzzy = title && company && savedRoles[fuzzyKey(company, title)];
  if (fuzzy) {
    showMessage(`Possibly the same role: you logged "${fuzzy.title}" at ${fuzzy.company}` +
      (fuzzy.location ? ` (${fuzzy.location})` : '') + ` on ${fuzzy.date}.`, 'warn');
    addForgetLink(url, fuzzy);
  }
}

// "Forget this entry" — erases the browser-side duplicate memory for this
// job (both its URL record and its company+title record). Touches nothing
// in the sheet or Drive. Saving again later re-records it.
function addForgetLink(url, matchedRecord) {
  const el = $('message');
  el.append(' ');
  const a = document.createElement('a');
  a.href = '#';
  a.textContent = 'Forget this entry';
  a.addEventListener('click', async (e) => {
    e.preventDefault();
    const { savedJobs = {}, savedRoles = {} } = await chrome.storage.local.get(['savedJobs', 'savedRoles']);
    if (url) delete savedJobs[jobKey(url)];
    if (matchedRecord.company && matchedRecord.title) {
      delete savedRoles[fuzzyKey(matchedRecord.company, matchedRecord.title)];
    }
    await chrome.storage.local.set({ savedJobs, savedRoles });
    showMessage('Forgotten — this job won\'t trigger duplicate warnings anymore.', 'success');
  });
  el.append(a);
}

function showMessage(text, kind, docUrl) {
  const el = $('message');
  el.textContent = text;
  el.className = kind; // success | error | warn
  if (docUrl) {
    el.append(' ');
    const a = document.createElement('a');
    a.href = docUrl;
    a.target = '_blank';
    a.textContent = 'Open JD doc';
    el.append(a);
  }
}
