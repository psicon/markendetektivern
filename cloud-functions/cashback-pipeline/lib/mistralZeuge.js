'use strict';
/**
 * Mistral OCR 4 als unabhängiger Zeuge der Bon-Lesung — PARALLELBETRIEB (09.10.2026).
 *
 * Patrick 09.10.2026: „mach das für heute erstmal im Parallelbetrieb“. Hintergrund:
 * Lesetests 08./09.10. (309 bzw. 150 Bons) — EINE normale Gemini-Lesung plus Mistral
 * als Zeuge auf Summe/Datum/Uhrzeit bestätigte 61 % der Bons ohne einen einzigen
 * falschen Geldwert; das wäre ~8–9 ct statt ~13 ct je Bon. Ob das im Betrieb hält,
 * soll dieser Parallelbetrieb zeigen.
 *
 * Wirkung: KEINE. Der Zeuge läuft erst NACH der fertigen Entscheidung (Final-Write,
 * Buchung, Push), schreibt nur das eigene Feld `receipts/{id}.zeugeMistral` und
 * wirft nie. Schalter `cashback_config/v1.mistralZeuge === 'shadow'`, fehlt ⇒ aus.
 * Online-Bestellungen (Kundenanschrift im Bild) werden nicht verschickt.
 * Gespeichert werden nur Beträge, Datum, Uhrzeit und Händlername — keine Artikelnamen.
 */

const MISTRAL_URL = 'https://api.mistral.ai/v1/ocr';
const MODELL = 'mistral-ocr-latest';
const ZEITLIMIT_MS = 25000;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['haendler', 'datum', 'uhrzeit', 'endsumme_cent', 'positionen'],
  properties: {
    haendler: { type: 'string', description: 'Name der Handelskette bzw. des Ladens, wie auf dem Bon' },
    datum: { type: 'string', description: 'Kaufdatum JJJJ-MM-TT' },
    // 11.10.2026: bei App-Screenshots (Kaufland, Lidl Plus …) las Mistral die Uhrzeit der
    // Handy-Statusleiste oben links (gemessen: 10:06 statt Kassenzeit 10:54).
    uhrzeit: { type: 'string', description: 'Kassenzeit HH:MM, wie sie auf dem Kassenbon selbst steht (z. B. „Zeit: 10:54“ beim Datum). NICHT die TSE-Zeit und NIEMALS die Uhrzeit der Handy-Statusleiste oben in einem Bildschirmfoto' },
    endsumme_cent: { type: 'integer', description: 'Gedruckte Endsumme (SUMME) in Cent, vor Abzug eingelöster Punkte' },
    positionen: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'preis_cent'],
        properties: {
          name: { type: 'string' },
          preis_cent: { type: 'integer', description: 'Zeilenbetrag in Cent, negativ bei Rabatt/Leergut' },
        },
      },
    },
  },
};

function uhrzeit(t) {
  const m = /(\d{1,2}):(\d{2})/.exec(String(t || ''));
  return m ? `${String(m[1]).padStart(2, '0')}:${m[2]}` : null;
}

/** Antwort von Mistral auf unsere Vergleichsform bringen (ohne Artikelnamen). */
function normalisieren(anno) {
  const a = anno || {};
  const summe = Number.isInteger(a.endsumme_cent) ? a.endsumme_cent : null;
  const preise = (Array.isArray(a.positionen) ? a.positionen : [])
    .map((p) => p && p.preis_cent)
    .filter((p) => Number.isInteger(p) && (summe == null || (p !== summe && p <= summe)));
  return {
    markt: a.haendler == null ? null : String(a.haendler).slice(0, 80),
    datum: typeof a.datum === 'string' ? a.datum.slice(0, 10) : null,
    zeit: uhrzeit(a.uhrzeit),
    summe,
    preise: preise.slice(0, 200),
  };
}

/** Anteil der Preise von `a`, die sich als Multimenge in `b` wiederfinden. */
function preisAnteil(a, b) {
  const zaehl = new Map();
  for (const p of b || []) zaehl.set(p, (zaehl.get(p) || 0) + 1);
  let treffer = 0;
  for (const p of a || []) {
    const n = zaehl.get(p) || 0;
    if (n > 0) { treffer++; zaehl.set(p, n - 1); }
  }
  return (a && a.length) ? Math.round((treffer / a.length) * 1000) / 1000 : null;
}

/**
 * Zeuge gegen eine Lesung vergleichen. `lesung` = { summe, datum, zeit, preise? }.
 * einigGeld: Summe und Datum gleich, Uhrzeit gleich sofern beide eine haben.
 */
function vergleich(zeuge, lesung) {
  if (!zeuge || !lesung) return null;
  const summe = zeuge.summe != null && zeuge.summe === lesung.summe;
  const datum = !!zeuge.datum && zeuge.datum === lesung.datum;
  const za = zeuge.zeit; const zb = uhrzeit(lesung.zeit);
  const zeit = za && zb ? za === zb : null;
  return {
    summe,
    datum,
    zeit,
    einigGeld: summe && datum && zeit !== false,
    ...(Array.isArray(lesung.preise) ? { preisAnteil: preisAnteil(lesung.preise, zeuge.preise) } : {}),
  };
}

async function lesen(bytes, mimeType, { key, fetchImpl = fetch, zeitlimitMs = ZEITLIMIT_MS } = {}) {
  const abbruch = new AbortController();
  const uhr = setTimeout(() => abbruch.abort(), zeitlimitMs);
  try {
    const r = await fetchImpl(MISTRAL_URL, {
      method: 'POST',
      signal: abbruch.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODELL,
        document: { type: 'image_url', image_url: `data:${mimeType || 'image/jpeg'};base64,${Buffer.from(bytes).toString('base64')}` },
        document_annotation_format: { type: 'json_schema', json_schema: { name: 'kassenbon', schema: SCHEMA, strict: true } },
      }),
    });
    const text = await r.text();
    if (!r.ok) throw new Error(`mistral_http_${r.status}: ${text.slice(0, 120)}`);
    const j = JSON.parse(text);
    const anno = typeof j.document_annotation === 'string' ? JSON.parse(j.document_annotation) : j.document_annotation;
    return { modell: j.model || MODELL, seiten: j.usage_info?.pages_processed ?? null, ergebnis: normalisieren(anno) };
  } finally {
    clearTimeout(uhr);
  }
}

/**
 * Parallelbetrieb ausführen. Wirft nie; gibt das Feld für `receipts.zeugeMistral`
 * zurück oder null, wenn nichts zu tun ist.
 * @param {object} a
 * @param {Buffer} a.bytes  Bonbild
 * @param {string} a.mimeType
 * @param {object} a.ocr    endgültige Lesung (ocr.parsed, ocr.robust.reads)
 * @param {string} a.key    Mistral-API-Schlüssel
 * @param {Function} [a.istOnline]  (parsed) => boolean
 */
async function zeugeAusfuehren({ bytes, mimeType, ocr, key, istOnline = () => false, fetchImpl, jetzt = () => Date.now() }) {
  const p = (ocr && ocr.parsed) || {};
  if (!key) return { status: 'kein_schluessel', at: new Date(jetzt()).toISOString() };
  if (istOnline(p)) return { status: 'online_ausgelassen', at: new Date(jetzt()).toISOString() };
  const t0 = jetzt();
  try {
    const { modell, seiten, ergebnis } = await lesen(bytes, mimeType, { key, fetchImpl });
    const final = { summe: p.totalCents ?? null, datum: p.bonDate ?? null, zeit: p.bonTime ?? null,
      preise: (Array.isArray(p.items) ? p.items : []).map((i) => i && i.priceCents).filter(Number.isInteger) };
    const erste = Array.isArray(ocr?.robust?.reads) && ocr.robust.reads[0]
      ? { summe: ocr.robust.reads[0].totalCents ?? null, datum: ocr.robust.reads[0].bonDate ?? null, zeit: ocr.robust.reads[0].bonTime ?? null }
      : null;
    return {
      status: 'ok', at: new Date(jetzt()).toISOString(), ms: jetzt() - t0, modell, seiten, ergebnis,
      gegenFinal: vergleich(ergebnis, final),
      ...(erste ? { gegenErsteLesung: vergleich(ergebnis, erste) } : {}),
    };
  } catch (e) {
    return { status: 'fehler', at: new Date(jetzt()).toISOString(), ms: jetzt() - t0, fehler: String(e && e.message || e).slice(0, 200) };
  }
}

// ─── Scharfer Betrieb (Patrick 10.10.2026: „sofort scharf schalten“) ─────────
//
// Schalter `cashback_config/v1.mistralZeuge === true`: nach EINER Gemini-Lesung
// fragt die Lese-Leiter Mistral (lib/ocr_robust.js `opts.zeuge`). Bestätigt der
// Zeuge Summe, Tag/Monat und Uhrzeit — und index.js zusätzlich den Markt und den
// Betrag —, gilt die eine Lesung; sonst läuft die Leiter wie bisher weiter.
// Rückweg ohne Deploy: Schalter auf 'shadow' (Parallelbetrieb) oder entfernen.
//
// Vergleichsregel, gemessen am Parallelbetrieb 09./10.10.2026 (445 Bons):
//   • Summe exakt gleich und > 0.
//   • Tag und Monat gleich, das JAHR zählt nicht: Mistral liest die zweistellige
//     Jahreszahl oft als 2020/2023; die Pipeline plausibilisiert das Jahr ohnehin
//     (plausibilizeBonDate) — es gilt das Jahr der Gemini-Lesung.
//   • Uhrzeit höchstens 2 Minuten auseinander, sofern beide eine lesen
//     (gedruckte Kassenzeit vs. TSE-Zeit liegen oft 1 Minute auseinander).
// Damit 383 von 445 bestätigt, darunter 0 mit anderem Geldergebnis.
const ZEIT_TOLERANZ_MIN = 2;

function minuten(t) {
  const m = /(\d{1,2}):(\d{2})/.exec(String(t || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Bestätigt der Zeuge die Gemini-Lesung auf den Geldfeldern?
 * @param {object} ergebnis normalisierte Mistral-Antwort ({summe, datum, zeit})
 * @param {object} parsed   Gemini-Lesung (parsed: totalCents, bonDate, bonTime)
 */
function bestaetigung(ergebnis, parsed, { jetzt = Date.now() } = {}) {
  const e = ergebnis || {};
  const p = parsed || {};
  const summe = Number.isInteger(e.summe) && e.summe > 0 && e.summe === p.totalCents;
  const tagMonat = (d) => (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d) ? d.slice(5, 10) : null);
  const jahr = (d) => (typeof d === 'string' && /^\d{4}/.test(d) ? d.slice(0, 4) : null);
  // Das Jahr zählt nur, wenn die Lesungen sich darin unterscheiden: dann muss
  // das Jahr der Gemini-Lesung das laufende sein (Mistral hat sich verlesen).
  // Vorfall 11.10.2026 (bon_mv3g41ngk06agr): Gemini las „2020-10-09“, Mistral
  // „2026-10-09“ — ohne diese Bedingung bestätigt, als zu alt abgelehnt.
  const aktuell = String(new Date(jetzt).getUTCFullYear());
  const jahrOk = jahr(e.datum) === jahr(p.bonDate) || jahr(p.bonDate) === aktuell;
  const datum = tagMonat(e.datum) != null && tagMonat(e.datum) === tagMonat(p.bonDate) && jahrOk;
  const a = minuten(e.zeit);
  const b = minuten(p.bonTime);
  const zeit = a == null || b == null ? null : Math.abs(a - b) <= ZEIT_TOLERANZ_MIN;
  return { summe, datum, zeit, ok: summe && datum && zeit !== false };
}

/**
 * Zeugen zu EINER Gemini-Lesung befragen. Wirft nie. Liefert den Bericht, der an
 * `ocr.robust.zeuge` landet (ohne Artikelnamen). `bestaetigt` setzt erst der
 * Aufrufer, nachdem er Markt und Betrag geprüft hat.
 */
async function zeugeFragen({ bytes, mimeType, parsed, key, istOnline = () => false, fetchImpl, jetzt = () => Date.now(), zeitlimitMs = ZEITLIMIT_MS }) {
  const at = new Date(jetzt()).toISOString();
  if (!key) return { status: 'kein_schluessel', at };
  if (istOnline(parsed || {})) return { status: 'online_ausgelassen', at };
  const t0 = jetzt();
  try {
    const { modell, seiten, ergebnis } = await lesen(bytes, mimeType, { key, fetchImpl, zeitlimitMs });
    return { status: 'ok', at, ms: jetzt() - t0, modell, seiten, ergebnis, vergleich: bestaetigung(ergebnis, parsed) };
  } catch (e) {
    return { status: 'fehler', at, ms: jetzt() - t0, fehler: String(e && e.message || e).slice(0, 200) };
  }
}

module.exports = { zeugeAusfuehren, zeugeFragen, bestaetigung, vergleich, normalisieren, preisAnteil, lesen, SCHEMA, ZEITLIMIT_MS, ZEIT_TOLERANZ_MIN };
