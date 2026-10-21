// Google sign-in with the GIS token client. The access token lives in memory only.
import { GOOGLE_CLIENT_ID } from './config.js';

const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const GIS_URL = 'https://accounts.google.com/gsi/client';

// code: 'load' (script unavailable), 'closed' (user closed the window), 'popup' (window blocked),
// 'denied' (Drive access not granted), 'failed'.
export class AuthError extends Error {
  constructor(code) { super(code); this.name = 'AuthError'; this.code = code; }
}

let gis = null;
let token = null; // { value, expiresAt }

export const isConfigured = () => !!GOOGLE_CLIENT_ID;

// Loading early keeps the sign-in window inside the tap that asked for it.
export function preload() {
  if (!gis && isConfigured()) {
    gis = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_URL;
      s.async = true;
      s.onload = () => (window.google?.accounts?.oauth2 ? resolve(window.google.accounts.oauth2) : reject(new AuthError('load')));
      s.onerror = () => { s.remove(); reject(new AuthError('load')); };
      document.head.append(s);
    });
    gis.catch(() => { gis = null; });
  }
  return gis;
}

// Must be called from a tap: Google shows a window (it closes by itself once access was given).
// hint: the account's email, so Google does not ask which account to use.
export async function requestToken(hint = '') {
  if (!isConfigured()) throw new AuthError('failed');
  const oauth2 = await preload();
  return new Promise((resolve, reject) => {
    const client = oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: SCOPE,
      login_hint: hint,
      callback: (resp) => {
        if (resp.error) return reject(new AuthError(resp.error === 'access_denied' ? 'denied' : 'failed'));
        if (!oauth2.hasGrantedAllScopes(resp, SCOPE)) return reject(new AuthError('denied'));
        token = { value: resp.access_token, expiresAt: Date.now() + (Number(resp.expires_in) || 3600) * 1000 };
        resolve(token.value);
      },
      error_callback: (err) => reject(new AuthError(err?.type === 'popup_closed' ? 'closed' : 'popup'))
    });
    client.requestAccessToken({ prompt: '' });
  });
}

// A token that is still good for at least a minute, or null.
export function currentToken() {
  return token && Date.now() < token.expiresAt - 60_000 ? token.value : null;
}

export function dropToken() {
  token = null;
}

// Withdraws the app's access to Drive (when there is a token to do it with).
export async function revoke() {
  const value = token?.value;
  token = null;
  const oauth2 = window.google?.accounts?.oauth2;
  if (value && oauth2) await new Promise((resolve) => oauth2.revoke(value, resolve));
}
