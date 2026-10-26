// Minimal Google API access with a service account: signs a JWT, exchanges it for an
// access token, and calls REST endpoints with retry on rate limits. No SDK needed.
const crypto = require('crypto');

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
let cachedToken = null;

function loadServiceAccount() {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT_JSON;
  if (!raw) throw new Error('GOOGLE_SERVICE_ACCOUNT_JSON is not set');
  const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  const key = JSON.parse(text);
  if (!key.client_email || !key.private_key) throw new Error('Service account JSON is missing client_email/private_key');
  return key;
}

function base64url(input) {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt - 60000 > Date.now()) return cachedToken.token;
  const key = loadServiceAccount();
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: key.client_email, scope: SCOPES, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600
  }));
  const signature = crypto.createSign('RSA-SHA256').update(header + '.' + claims).sign(key.private_key);
  const assertion = header + '.' + claims + '.' + base64url(signature);

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  if (!res.ok) throw new Error('Service account token request failed: ' + res.status + ' ' + (await res.text()));
  const data = await res.json();
  cachedToken = { token: data.access_token, expiresAt: Date.now() + data.expires_in * 1000 };
  return cachedToken.token;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Calls a Google REST API, retrying 429/5xx with exponential backoff (quota bursts are common on Sheets). */
async function googleFetch(url, options = {}) {
  const token = await getAccessToken();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, {
      ...options,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= 4) {
      const body = await res.text();
      const err = new Error('Google API ' + res.status + ': ' + body.slice(0, 300));
      err.status = res.status;
      throw err;
    }
    await sleep(Math.min(8000, 500 * 2 ** attempt) + Math.random() * 250);
  }
}

function serviceAccountEmail() {
  try { return loadServiceAccount().client_email; } catch (e) { return null; }
}

module.exports = { googleFetch, serviceAccountEmail };
