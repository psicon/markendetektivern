/**
 * Gemeinsame Basis der Admin-Seiten (md-receipt-admin): Firebase-Init,
 * Admin-Login-Gate (Custom-Claim admin:true), Callable-Helper, Storage-URLs,
 * Toast, kleine Formatierer. ES-Modul ohne Build-Schritt — wie index.html.
 */
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
import { getFunctions, httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-functions.js';
import { getStorage, ref as storageRef, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.0/firebase-storage.js';

export const app = initializeApp({
  apiKey: 'AIzaSyCVQ-Y71TNexRKSWrVtu1HTP9uk_dSfUP0',
  authDomain: 'markendetektive-895f7.firebaseapp.com',
  projectId: 'markendetektive-895f7',
  storageBucket: 'markendetektive-895f7.appspot.com',
  messagingSenderId: '139509881339',
  appId: '1:139509881339:web:d5d1f2b75d2b0258d6135e',
});
export const auth = getAuth(app);
export const fns = getFunctions(app, 'europe-west1');
export const storage = getStorage(app);
export const call = (name, opts) => httpsCallable(fns, name, opts);

export const $ = (id) => document.getElementById(id);
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const euro = (cents) => (cents != null && Number.isFinite(cents) ? (cents / 100).toFixed(2).replace('.', ',') + ' €' : '—');
export const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' }) : '—');
export const fmtDateTime = (ms) => (ms ? new Date(ms).toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—');
export const ago = (ms) => {
  if (!ms) return '—';
  const d = Math.floor((Date.now() - ms) / 86400000);
  if (d <= 0) return 'heute';
  if (d === 1) return 'gestern';
  return `vor ${d} Tagen`;
};
export const short = (s, n = 8) => (s ? String(s).slice(0, n) : '—');

let toastTimer = null;
export function toast(msg, kind = '') {
  let t = $('toast');
  if (!t) {
    t = document.createElement('div');
    t.id = 'toast';
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.className = 'toast show' + (kind ? ' ' + kind : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}

// Storage-Pfad → Download-URL (Storage-Rules erlauben admin:true), gecacht.
const urlCache = new Map();
export async function imgUrl(path) {
  if (!path) return null;
  if (urlCache.has(path)) return urlCache.get(path);
  // Fehlschläge NICHT dauerhaft merken: sonst bleibt der Platzhalter bis F5
  // stehen, auch nach „Neu laden".
  const p = getDownloadURL(storageRef(storage, path)).catch(() => null);
  urlCache.set(path, p);
  p.then((u) => { if (!u) urlCache.delete(path); });
  return p;
}

/**
 * Login-Gate: zeigt #login bis ein Admin angemeldet ist, ruft dann onReady(user).
 * Erwartet die Elemente #login, #app, #loginEmail, #loginPw, #loginBtn, #loginMsg, #logoutBtn.
 */
export function initAdmin(onReady) {
  const loginBtn = $('loginBtn');
  if (loginBtn) {
    loginBtn.onclick = async () => {
      $('loginMsg').textContent = '';
      try {
        await signInWithEmailAndPassword(auth, $('loginEmail').value.trim(), $('loginPw').value);
      } catch (e) {
        $('loginMsg').textContent = e.code === 'auth/invalid-credential' ? 'E-Mail oder Passwort falsch.' : e.message;
      }
    };
    $('loginPw').onkeydown = (e) => { if (e.key === 'Enter') loginBtn.click(); };
  }
  const logoutBtn = $('logoutBtn');
  if (logoutBtn) logoutBtn.onclick = () => signOut(auth);

  onAuthStateChanged(auth, async (user) => {
    if (!user) { $('login').classList.remove('hidden'); $('app').classList.add('hidden'); return; }
    const tok = await user.getIdTokenResult(true);
    if (tok.claims.admin !== true) {
      $('loginMsg').textContent = `${user.email} ist kein Admin. (Custom-Claim admin:true fehlt)`;
      $('login').classList.remove('hidden'); $('app').classList.add('hidden');
      await signOut(auth);
      return;
    }
    $('login').classList.add('hidden'); $('app').classList.remove('hidden');
    onReady(user);
  });
}

/** Hover-Zoom für Thumbnails mit data-full (wie in index.html). */
export function installZoom() {
  let zoom = $('zoom');
  if (!zoom) {
    zoom = document.createElement('div');
    zoom.id = 'zoom';
    zoom.innerHTML = '<img alt=""><div class="zname"></div>';
    document.body.appendChild(zoom);
  }
  const zoomImg = zoom.querySelector('img'), zoomName = zoom.querySelector('.zname');
  const place = (e) => {
    const w = 420, h = 420;
    let x = e.clientX + 26, y = e.clientY - h / 2;
    if (x + w > innerWidth) x = e.clientX - w - 26;
    if (x < 8) x = 8;
    if (y < 8) y = 8;
    if (y + h > innerHeight) y = innerHeight - h - 8;
    zoom.style.left = x + 'px'; zoom.style.top = y + 'px';
  };
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest && e.target.closest('.thumb[data-full]');
    if (!t) return;
    zoomImg.src = t.getAttribute('data-full');
    zoomName.textContent = t.getAttribute('data-label') || '';
    zoom.style.display = 'block';
    place(e);
  });
  document.addEventListener('mousemove', (e) => { if (zoom.style.display === 'block') place(e); });
  document.addEventListener('mouseout', (e) => {
    const t = e.target.closest && e.target.closest('.thumb[data-full]');
    if (t && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.thumb[data-full]'))) zoom.style.display = 'none';
  });
}
