// options.js — settings page. Stores the Apps Script URL + secret in
// chrome.storage.sync (synced across your Chrome profiles, not visible to websites).

const $ = (id) => document.getElementById(id);

document.addEventListener('DOMContentLoaded', async () => {
  // Prefill with whatever was saved before.
  const saved = await chrome.storage.sync.get(['webAppUrl', 'secret']);
  $('webAppUrl').value = saved.webAppUrl || '';
  $('secret').value = saved.secret || '';

  $('save').addEventListener('click', onSave);
  $('test').addEventListener('click', onTest);
});

async function onSave() {
  const webAppUrl = $('webAppUrl').value.trim();
  const secret = $('secret').value.trim();

  if (!webAppUrl.endsWith('/exec')) {
    return showMessage('That URL doesn\'t end in /exec — copy the "Web app" URL from Deploy > Manage deployments.', 'error');
  }
  if (!secret) {
    return showMessage('Secret is required (the SECRET value from Code.gs).', 'error');
  }

  await chrome.storage.sync.set({ webAppUrl, secret });
  showMessage('Saved.', 'success');
}

// Hits the web app with a GET — doGet() in Code.gs answers if deployment works.
async function onTest() {
  const webAppUrl = $('webAppUrl').value.trim();
  if (!webAppUrl) return showMessage('Enter the URL first.', 'error');

  showMessage('Testing…', 'warn');
  try {
    const res = await fetch(webAppUrl);
    const data = await res.json();
    if (data.ok) {
      showMessage('Connected! Endpoint says: ' + data.message, 'success');
    } else {
      showMessage('Endpoint reached but returned: ' + JSON.stringify(data), 'error');
    }
  } catch (err) {
    showMessage('Could not reach endpoint: ' + err.message, 'error');
  }
}

function showMessage(text, kind) {
  const el = $('message');
  el.textContent = text;
  el.className = kind;
}
