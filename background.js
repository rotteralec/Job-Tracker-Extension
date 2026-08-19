// background.js — MV3 service worker.
// Runs in the background only when needed (Chrome starts/stops it on demand).

// Clicking the toolbar icon opens the side panel (instead of a popup that
//   closes the moment you click elsewhere).
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === 'install') {
    // First install: open settings for user to paste their URL + secret.
    chrome.runtime.openOptionsPage();
  }
});
