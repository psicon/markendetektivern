'use strict';

/**
 * Signierte Vorschaukacheln der Prüfkonsole (01.10.2026).
 *
 * Ersetzt die Firebase-Extension `image-processing-api` (us-central1,
 * Node 14 — Laufzeit seit 30.01.2025 abgekündigt). Die Extension nahm jeden
 * beliebigen Bucket-Pfad (und sogar fremde URLs) ohne Anmeldung entgegen.
 * Dieser Endpunkt liefert dagegen NUR Pfade aus, für die der Server selbst
 * eine Signatur ausgestellt hat — und die stellt er nur in `reviewCases`
 * aus, also nach der Admin-Prüfung.
 *
 * Ein <img>-Tag kann keinen Authorization-Header mitschicken; deshalb trägt
 * die URL ihre Berechtigung selbst: HMAC-SHA256 über Version, Breite,
 * Ablaufzeit und Pfad, Schlüssel aus Secret Manager.
 *
 * Diese Datei ist rein (kein Netz, kein sharp) — die Bildverarbeitung steht
 * in `kachelBild.js`, der Endpunkt in index.js (`reviewKachel`).
 */

const crypto = require('crypto');

/** Teil der signierten Nachricht — ein Formatwechsel macht alte URLs ungültig. */
const VERSION = 'k1';

/** Die zwei Größen, die die Konsole anzeigt (Foto-Kachel, Bon). Sonst nichts. */
const BREITEN = Object.freeze([520, 1100]);

/**
 * Nur Nutzer-Uploads, die die Konsole zeigt. Selbst mit gültiger Signatur (oder
 * einem abgeflossenen Schlüssel) kommt man damit nicht an andere Bucket-Inhalte.
 * Stand 01.10.2026 gemessen: 25.893 Foto- und alle Bon-Pfade liegen hier.
 */
const PRAEFIXE = Object.freeze(['crowduploads/', 'cashback-uploads/']);

const MAX_PFAD = 512;          // längster echter Pfad am 01.10.2026: 123 Zeichen
const MIN_SCHLUESSEL = 32;     // Zeichen; das Deploy-Rezept erzeugt 64 Hex-Zeichen

/**
 * Ablauf im 6-Stunden-Raster: innerhalb eines Fensters ist die URL für
 * denselben Pfad identisch, der Browser-Cache trifft also beim erneuten
 * Öffnen eines Falls. Gültig ist eine URL mindestens 6 und höchstens 12
 * Stunden — lang genug für eine offene Prüfsitzung, kurz genug, dass eine
 * kopierte URL nicht dauerhaft taugt.
 */
const RASTER_S = 6 * 3600;
const GUELTIG_MIN_S = 6 * 3600;
/** Was weiter in der Zukunft liegt, hat dieser Server nie ausgestellt. */
const MAX_HORIZONT_S = GUELTIG_MIN_S + RASTER_S + 300;

/** Darf dieser Pfad überhaupt als Kachel ausgeliefert werden? */
function pfadZulaessig(pfad) {
  if (typeof pfad !== 'string' || !pfad || pfad.length > MAX_PFAD) return false;
  if (!PRAEFIXE.some((p) => pfad.startsWith(p))) return false;
  // Steuerzeichen und Backslash haben in einem Storage-Pfad nichts verloren.
  if (/[\u0000-\u001f\u007f\\]/.test(pfad)) return false;
  // Leere Segmente (//, Schrägstrich am Ende), „." und „.." ausschließen.
  return !pfad.split('/').some((t) => t === '' || t === '.' || t === '..');
}

function schluesselOk(schluessel) {
  return typeof schluessel === 'string' && schluessel.length >= MIN_SCHLUESSEL;
}

function signatur(pfad, breite, ablauf, schluessel) {
  // Breite und Ablauf sind reine Ziffern, der Pfad steht am Ende — dadurch
  // ist die Nachricht ohne Mehrdeutigkeit zerlegbar.
  return crypto
    .createHmac('sha256', schluessel)
    .update(`${VERSION}\n${breite}\n${ablauf}\n${pfad}`)
    .digest('base64url');
}

/** Ablaufzeit (Unix-Sekunden) für eine jetzt ausgestellte URL. */
function ablaufFuer(jetztMs) {
  const s = Math.floor(jetztMs / 1000);
  return Math.ceil((s + GUELTIG_MIN_S) / RASTER_S) * RASTER_S;
}

/**
 * Signierte Kachel-URL — oder null, wenn Pfad, Breite oder Schlüssel nicht
 * taugen. Der Aufrufer entscheidet, was dann angezeigt wird.
 */
function kachelUrl(basis, pfad, breite, schluessel, jetztMs = Date.now()) {
  if (!pfadZulaessig(pfad) || !BREITEN.includes(breite) || !schluesselOk(schluessel)) return null;
  const ablauf = ablaufFuer(jetztMs);
  const s = signatur(pfad, breite, ablauf, schluessel);
  return `${basis}?p=${encodeURIComponent(pfad)}&w=${breite}&e=${ablauf}&s=${s}`;
}

/** Query-Wert nur als einzelner String — `?p=a&p=b` oder `p[x]=` sind kein Pfad. */
function einzeln(v) {
  return typeof v === 'string' && v.length ? v : null;
}

const GANZZAHL = /^[1-9][0-9]{0,11}$/; // kanonisch: keine führende Null, kein Vorzeichen
const SIGNATUR_FORM = /^[A-Za-z0-9_-]{43}$/; // 32 Byte base64url ohne Auffüllung

/**
 * Prüft eine eingehende Kachel-Anfrage. Ergebnis:
 *   { ok: true, pfad, breite }  oder  { ok: false, grund }
 * `grund === 'schluessel_fehlt'` ist ein Serverfehler, alles andere ist ein
 * Verbot (403) — bewusst ohne Unterscheidung nach außen.
 */
function pruefeKachelAnfrage(query, schluessel, jetztMs = Date.now()) {
  if (!schluesselOk(schluessel)) return { ok: false, grund: 'schluessel_fehlt' };
  const q = query || {};
  const pfad = einzeln(q.p);
  const w = einzeln(q.w);
  const e = einzeln(q.e);
  const s = einzeln(q.s);
  if (!pfad || !w || !e || !s) return { ok: false, grund: 'parameter_fehlen' };
  if (!GANZZAHL.test(w) || !GANZZAHL.test(e) || !SIGNATUR_FORM.test(s)) {
    return { ok: false, grund: 'parameter_ungueltig' };
  }
  const breite = Number(w);
  const ablauf = Number(e);

  const soll = Buffer.from(signatur(pfad, breite, ablauf, schluessel), 'utf8');
  const ist = Buffer.from(s, 'utf8');
  if (soll.length !== ist.length || !crypto.timingSafeEqual(soll, ist)) {
    return { ok: false, grund: 'signatur_falsch' };
  }
  // Ab hier hat DIESER Schlüssel die URL ausgestellt. Die folgenden Prüfungen
  // greifen erst, wenn der Schlüssel abgeflossen ist oder ein Fehler beim
  // Ausstellen etwas Unerwartetes signiert hat.
  const jetztS = Math.floor(jetztMs / 1000);
  if (ablauf <= jetztS) return { ok: false, grund: 'abgelaufen' };
  if (ablauf > jetztS + MAX_HORIZONT_S) return { ok: false, grund: 'ablauf_zu_fern' };
  if (!BREITEN.includes(breite)) return { ok: false, grund: 'breite_nicht_erlaubt' };
  if (!pfadZulaessig(pfad)) return { ok: false, grund: 'pfad_nicht_erlaubt' };
  return { ok: true, pfad, breite };
}

module.exports = {
  BREITEN, PRAEFIXE, RASTER_S, GUELTIG_MIN_S, MAX_HORIZONT_S, MIN_SCHLUESSEL,
  pfadZulaessig, kachelUrl, pruefeKachelAnfrage, ablaufFuer,
  // nur für Tests:
  _signatur: signatur,
};
