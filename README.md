# Job Application Tracker

A Chrome extension that logs every job application to a Google Sheet in one click — including the full job description, saved as its own Google Doc before the posting gets taken down.

Built with vanilla JavaScript (Manifest V3) and a Google Apps Script backend. No frameworks, no build step, no hosting costs.

![Architecture diagram](docs/architecture.svg)

## Features

- **One-click logging** from a docked Chrome side panel that stays open while you browse
- **Auto-scrapes** title, company, location, salary, and full JD from LinkedIn, Indeed, and Workday, with a structured-data (JSON-LD) layer that covers most other job boards automatically
- **Full JD preserved** as a Google Doc per application (postings die; your copy doesn't), linked from the sheet
- **Duplicate detection** — warns on the exact posting (normalized URL/job ID) *and* on the same company + title seen via a different site; each warning has a "Forget this entry" link to clear stale memory. Warnings never block saving.
- **Editable before save** — every scraped field can be corrected, plus status and notes
- **Editable "Date applied"** (defaults to today) so you can backfill past applications with their real dates
- **Smart highlight routing** — highlighted text becomes the JD if it's long, the salary if it looks like money, and is ignored otherwise
- Settings (endpoint URL + secret) synced via `chrome.storage.sync`

## How it works

1. Click the toolbar icon on a job posting → side panel opens
2. The panel injects `scrapers.js` into the page and runs it, trying three strategies in order — site-specific CSS selectors, JSON-LD `JobPosting` data, then generic fallbacks (page heading / highlighted text). Later layers only fill fields earlier ones missed.
3. You review the pre-filled form and hit **Save**
4. The panel POSTs JSON to a Google Apps Script web app
5. `doPost()` writes the JD to a new Google Doc in a "Job Descriptions" Drive folder, then appends a row to the sheet with an "Open JD" link

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the full breakdown.

## Setup

1. **Google side** (~10 min, once): follow [docs/SETUP_GOOGLE.md](docs/SETUP_GOOGLE.md) — create a sheet, paste in `google-side/Code.gs`, set your secret, deploy as a web app.
2. **Extension**: `chrome://extensions` → enable Developer mode → **Load unpacked** → select this folder.
3. The settings page opens automatically: paste your web app URL and secret, hit **Test connection**.

## Usage tips

- On a page where the JD doesn't auto-fill: highlight the description text on the page, then hit **Rescrape** (selections under 200 characters aren't treated as a JD; money-like selections fill Salary instead).
- A filled JD field is never overwritten by shorter text, so highlighting a salary after a JD won't clobber it.
- Rescrape refills scraped fields but never touches your Notes.
- Backfilling old applications: log them through the extension (so duplicate detection knows about them) and set the real date in the "Date applied" field.
- LinkedIn's `/jobs/view/...` pages (the newer layout) don't include the JD in the page, so only title/company/location auto-fill there — log from the jobs board/search view to capture the full JD, or highlight what you see.
- Duplicate memory lives in `chrome.storage.local` (this browser only). It records extension saves — rows added or deleted by hand in the sheet are invisible to it; use "Forget this entry" if a warning goes stale.

## Project structure

```
manifest.json        Extension config & permissions (MV3)
sidepanel.html/js    Form UI + scraper injection + save/dedupe logic (Chrome Side Panel API)
scrapers.js          Scraping strategies, injected on demand
options.html/js      Settings page with connection test
background.js        Service worker (opens panel on icon click)
popup.css            Shared styles (side panel + options page)
google-side/Code.gs  Apps Script backend (deployed in Google)
docs/                Architecture diagram + setup guides
```

## Troubleshooting

- **"Bad secret"** — the secret in extension settings must exactly match `SECRET` in Code.gs.
- **Permission error mentioning DocumentApp/DriveApp** — re-run authorization: in the Apps Script editor run any function, approve the prompt, then redeploy (Manage deployments → New version).
- **Edited Code.gs but nothing changed** — Apps Script serves the deployed snapshot, not the editor contents. Deploy → Manage deployments → New version.
- **Scrape fails or comes back empty** — read the gray hint line under the panel title; it names the scrape layers that worked or shows the actual error. Some pages (chrome://, PDFs, the Web Store) can't be scraped at all.
- **Duplicate warning for a row you deleted** — the warning comes from browser-side memory, not the sheet. Click "Forget this entry" in the warning.
