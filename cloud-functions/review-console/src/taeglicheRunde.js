'use strict';
/**
 * Morgenrunde Produktfotos — jeden Tag 08:00 (Europe/Berlin).
 *
 * Macht, was bis zum 24.09.2026 von Hand lief: fehlende Angaben aus den Fotos
 * nachlesen, die Regeln der Prüfkonsole anwenden, die Bilder ansehen,
 * entscheiden und einen Tagesbericht mit Warnungen schreiben. Die Nachricht an
 * die Nutzer verschickt der Sammler in crowd-upload-reward (eine pro Person,
 * gebündelt über alle Freigaben — auch die aus der Prüfkonsole). Das Wissen dahinter steht in
 * WISSEN-FOTORUNDE.md — wer hier etwas ändert, ändert zuerst dort.
 *
 * WARUM DAS IN DER PRÜFKONSOLE LIEGT und nicht in einer eigenen Codebase: die
 * Doppel-Regel (`duplicatePolicy.js`) wird hier gepflegt. Ein Worker mit
 * eigener Kopie hätte den Fehler vom 20.09. wiederholt — ein Skript entschied
 * nach einer Regelfassung, die Stunden zuvor überholt war (8 von 14
 * Ablehnungen wären falsch gewesen).
 *
 * WAS ER ENTSCHEIDET (Entscheidung Patrick 24.09.: „beides automatisch")
 *   Freigaben und Ablehnungen, nach `fotoRundeRegeln.entscheideFall`.
 * WAS ER LIEGEN LÄSST (`wartetAufDich` im Bericht)
 *   Alles, was an unserer Technik hängt: Storage nicht lesbar, Bildprüfung
 *   oder Nachlesen am Google-Limit gescheitert, beschädigte Datei — und alles,
 *   was die Notbremse zurückhält.
 * WAS ER NIE TUT
 *   Geld buchen. Eine Freigabe setzt nur den Status; buchen tut
 *   `crowd-upload-reward`, wie bei jeder anderen Freigabe.
 *
 * Schalter: `cashback_config/v1.fotoWorker === true` → scharf. Sonst
 * Trockenlauf: liest, prüft, schreibt nur den Bericht (plus nachgelesene
 * Angaben in die eigenen *RescueOcr-Felder, die nichts entscheiden).
 */
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');
const { GoogleGenAI } = require('@google/genai');
const { evaluateDuplicate, completenessCheck } = require('./duplicatePolicy');
const { entscheideFall, notbremse, nameAusLesungen, eanAusLesungen, BILD_GRUENDE } = require('./fotoRundeRegeln');
const { warnungen } = require('./warnungen');
const { mitWiederholung, arbeite, schlafe } = require('./ki');

const COL = 'crowd_uploads';
const BERICHTE = 'ops_tagesberichte';
const REQUIRED = ['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten', 'preis'];
// Bild-Wiederverwendung zählt nur für die produkt-identifizierenden Fotos:
// ein gemeinsames Regal-Preisschild zweier Sorten ist plausibel (Befund 13.09.).
const IDENTITY_SLOTS = new Set(['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten']);
const MODELL = 'gemini-3.5-flash';
// 4 parallel: mit 8 liefen am 24.09. zwei Durchgänge zu je ~8 % ins Google-Limit.
const PARALLEL_KI = 4;
const ENTSCHEIDER = 'worker-fotorunde';
// Nach dieser Zeit beginnt die Runde nichts Neues mehr; der Rest ist morgen dran.
// Die Function darf 30 Minuten laufen — Luft für Schreiben und Buchungs-Abwarten.
const ARBEITSZEIT_MS = 18 * 60 * 1000;
const BUCHUNG_WARTEN_MS = 5 * 60 * 1000;

const ms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : null);
const fmtDate = (m) => (m ? new Date(m).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Berlin' }) : null);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
const berlinTag = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const berlinZeit = (t) => new Date(t).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Berlin' }).replace(/:/g, '');

/** Geretteter Wert zählt wie ein gelesener — beim Preis ja, beim Hersteller für
 *  die Doppel-Regel NICHT: „Kaufland Stiftung & Co." (Markeninhaber) und „DMK"
 *  (Produzent) stehen auf derselben Packung (gemessen 20.09.). */
const eanOf = (x) => x.ean || x.eanRescueOcr || null;
const nameOf = (x) => x.productName || x.productNameOcr || x.productNameRescueOcr || null;
const preisOf = (x) => (x.priceOcr && Number.isFinite(x.priceOcr.priceCents) && x.priceOcr.priceCents > 0 ? x.priceOcr : x.priceRescueOcr || null);
const policyOf = (id, x) => ({
  id, userId: x.userId ?? null, ean: eanOf(x), marketId: x.marketId ?? null,
  status: x.status, createdAt: ms(x.createdAt), priceOcr: preisOf(x), manufacturerOcr: x.manufacturerOcr ?? null,
});

/** Interner Vermerk am Dokument. Was der NUTZER liest, steht in
 *  lib/utils/productSubmissionCopy.ts (REASON_COPY) — jeder Grund hier braucht dort einen Eintrag. */
function noteFor(reason, ctx = {}) {
  const until = fmtDate(ctx.lockUntil);
  switch (reason) {
    case 'sperre_30_tage_gleicher_nutzer': return `Dieses Produkt liegt uns von dir schon vor — die erste Einreichung zählt. Ab ${until || 'morgen'} zählt derselbe Artikel wieder, und mit neuem Preis, Hersteller oder Markt sofort.`;
    case 'unvollstaendig': return `Es fehlen Fotos (${(ctx.missing || []).join(', ') || 'siehe Liste'}). Mit allen sieben Ansichten klappt es beim nächsten Mal.`;
    case 'ean_fehlt': return 'Der Barcode (EAN, 8–14 Ziffern) ordnet das Produkt eindeutig zu — beim nächsten Mal bitte scannen oder eintippen.';
    case 'kein_produktname': return 'Der Produktname war nicht erkennbar — Vorderseite gut ausgeleuchtet und ohne Spiegelung, dann passt es.';
    case 'bilder_wiederverwendet': return 'Dieselben Fotos wurden schon für eine andere Einreichung verwendet — jedes Produkt braucht eigene Aufnahmen.';
    case 'fotos_unpassend': return 'Die Fotos zeigen nicht das erwartete Produkt oder nicht die verlangten Ansichten.';
    case 'gleiche_ansicht_mehrfach': return 'Fast alle Fotos zeigen dieselbe Ansicht — Zutaten, Nährwerte, Hersteller und Preis brauchen wir einzeln.';
    default: return 'Danke fürs Einreichen — beim nächsten Datensatz geht es weiter.';
  }
}

/* ─────────────────────────── Bilder lesen ─────────────────────────── */

const teil = (bucket, slot, pfad) => [{ text: `— Foto "${slot}":` }, { fileData: { fileUri: `gs://${bucket}/${pfad}`, mimeType: 'image/jpeg' } }];

async function frage(ai, bucket, images, slots, text) {
  const parts = [];
  for (const s of slots) if (images[s]) parts.push(...teil(bucket, s, images[s]));
  parts.push({ text });
  const r = await mitWiederholung(() => ai.models.generateContent({
    model: MODELL,
    contents: [{ role: 'user', parts }],
    // MIT Denken: der Namer liest mit thinkingBudget 0 und übersieht dabei
    // genau die Angaben, die hier fehlen.
    config: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 8000, thinkingConfig: { thinkingLevel: 'LOW' } },
  }));
  return JSON.parse(String(r.text ?? '').replace(/^```json\s*|```\s*$/g, ''));
}

/** GTIN-Prüfziffer (8/12/13/14 Stellen). */
function pruefzifferOk(code) {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(code)) return false;
  const z = code.split('').map(Number);
  const p = z.pop();
  let summe = 0;
  z.reverse().forEach((v, i) => { summe += v * (i % 2 === 0 ? 3 : 1); });
  return (10 - (summe % 10)) % 10 === p;
}

/**
 * Fehlende Angaben nachlesen. Übernommen wird nur, was ZWEI unabhängige
 * Lesungen gleich lesen; alles landet in EIGENEN Feldern, damit messbar
 * bleibt, wie gut die Ersterkennung liest. Gibt zurück, was übernommen wurde
 * und woran das Nachlesen technisch scheiterte (das ist kein Urteil).
 */
async function rettungFuer(ai, bucket, ref, x) {
  const patch = {};
  const fehler = {};
  const offenName = !nameOf(x);
  const offenEan = !eanOf(x) && !!x.images?.ean;
  const offenPreis = !preisOf(x);
  const offenHersteller = !(x.manufacturerOcr && String(x.manufacturerOcr.name || '').trim()) && !x.manufacturerRescueOcr;
  if (!offenName && !offenEan && !offenPreis && !offenHersteller) return { patch: null, fehler };

  if (offenName) {
    const p = 'Lies den PRODUKTNAMEN von der Verpackung. JSON: {"name":"…","sicher":true|false}. name = Marke + Bezeichnung + Sorte, ohne Menge und Preis. Nicht zweifelsfrei lesbar → name leer, sicher false.';
    try {
      const [a, b] = [await frage(ai, bucket, x.images, ['front', 'rueckseite'], p), await frage(ai, bucket, x.images, ['front', 'rueckseite'], p)];
      const r = nameAusLesungen(a, b);
      if (r.name) {
        patch.productNameRescueOcr = r.name;
        if (r.alternative) patch.productNameRescueAlternative = r.alternative;
      } else if (r.unsicher) fehler.name = 'lesungen_uneinig';
    } catch (e) { fehler.name = String(e.message).slice(0, 120); }
  }
  if (offenEan) {
    const p = 'Lies die EAN/GTIN unter dem Strichcode. JSON: {"ean":"nur Ziffern","sicher":true|false}. Vollständig und in gedruckter Reihenfolge. Nicht zweifelsfrei lesbar oder kein Strichcode → leer. Nichts raten.';
    try {
      const [a, b] = [await frage(ai, bucket, x.images, ['ean', 'rueckseite', 'front'], p), await frage(ai, bucket, x.images, ['ean', 'rueckseite', 'front'], p)];
      // Streng: unter den EAN-losen Einreichungen ist viel lose Ware, und ein
      // Modell, das nach einer Nummer gefragt wird, liefert dort gern die vom
      // Waage-Etikett (Befund 19.09.). Händlerinterne Codes (02, 20–29) bestehen
      // die Prüfziffer — deshalb die zweite Lesung.
      const r = eanAusLesungen(a, b, pruefzifferOk);
      if (r.ean) patch.eanRescueOcr = r.ean;
      else if (r.unsicher) fehler.ean = 'lesungen_uneinig';
    } catch (e) { fehler.ean = String(e.message).slice(0, 120); }
  }
  if (offenPreis || offenHersteller) {
    try {
      Object.assign(patch, await preisUndHersteller(ai, bucket, x, { preis: offenPreis, hersteller: offenHersteller }));
    } catch (e) { fehler.preis = String(e.message).slice(0, 120); }
  }
  if (!Object.keys(patch).length) return { patch: null, fehler };
  patch.rescueAt = FieldValue.serverTimestamp();
  patch.rescueQuelle = `${MODELL}/vertex mit Denken, zwei übereinstimmende Lesungen (Morgenrunde)`;
  await ref.set(patch, { merge: true });
  return { patch, fehler };
}

/**
 * Preis und/oder Hersteller nachlesen — zwei Lesungen, übernommen nur bei
 * Übereinstimmung. Wirft bei technischen Fehlern (der Aufrufer entscheidet).
 */
async function preisUndHersteller(ai, bucket, x, { preis, hersteller }) {
  const patch = {};
  const p = [
    'Lies zwei Angaben, sonst nichts. JSON: {"priceCents":0,"priceImageKind":"","manufacturer":""}.',
    'priceCents: Verkaufspreis DIESES Produkts in Cent (1,99 € → 199), vom Regal-Preisschild oder der Bon-Zeile.',
    'NICHT den Grundpreis (€/kg), NICHT den durchgestrichenen Preis, NICHT die Bon-Endsumme. Kein Preis sichtbar → 0.',
    'priceImageKind: "preisschild" | "kassenbon" | "beides" | "produktfoto" | "sonstiges".',
    'manufacturer: Inverkehrbringer laut Verpackung als Firmenname ohne Adresse. Nicht lesbar → leer.',
    'Nichts raten — ein erfundener Wert ist schlechter als ein leeres Feld.',
  ].join('\n');
  const slots = ['preis', 'hersteller', 'rueckseite', 'front'];
  const [a, b] = [await frage(ai, bucket, x.images || {}, slots, p), await frage(ai, bucket, x.images || {}, slots, p)];
  const ca = Number.isFinite(a.priceCents) && a.priceCents > 0 ? Math.round(a.priceCents) : null;
  const cb = Number.isFinite(b.priceCents) && b.priceCents > 0 ? Math.round(b.priceCents) : null;
  // Bei ~40 % der Einreichungen zeigt das „Preis"-Foto nur nochmal das Produkt.
  if (preis && ca && ca === cb && ca <= 20000 && ['preisschild', 'kassenbon', 'beides'].includes(String(a.priceImageKind || '').toLowerCase())) {
    patch.priceRescueOcr = { priceCents: ca, currency: 'EUR', priceImageKind: String(a.priceImageKind).toLowerCase() };
  }
  if (hersteller && a.manufacturer && norm(a.manufacturer) === norm(b.manufacturer)) {
    patch.manufacturerRescueOcr = { name: String(a.manufacturer).slice(0, 140) };
  }
  return patch;
}

/** Bildprüfung: sieht alle sieben Fotos an. */
async function bildAudit(ai, bucket, x) {
  const parts = [];
  for (const s of REQUIRED) if (x.images?.[s]) parts.push(...teil(bucket, s, x.images[s]));
  parts.push({
    text: [
      'Du prüfst eine Produkt-Einreichung (die Fotos sind oben je Schritt benannt).',
      `Erwartet: echtes Einzelhandels-Produkt "${nameOf(x) || 'unbekannt'}" (EAN ${eanOf(x) || 'unbekannt'}).`,
      'Erwartung je Schritt: front=Vorderseite, rueckseite=Rückseite, hersteller=Hersteller-/Adressangabe, ean=Barcode, naehrwerte=Nährwerttabelle, zutaten=Zutatenliste, preis=Preisschild oder Bon.',
      'JSON: {"echt":true|false,"loseWare":true|false,"traegtAngaben":true|false,"gleicheAnsicht":true|false,"grund":"kurz"}.',
      'echt=false NUR bei eindeutigem Ausschluss: kein reales Produkt, abfotografierter Bildschirm, fremde Motive, Schritte grob falsch belegt.',
      'Unscharf, angeschnitten oder zwei vertauschte Schritte = trotzdem echt=true.',
      // 24.09.2026: Das Preisfoto zeigte eine Tischdecke, alles andere war
      // vollständig — die alte Prüfung hielt das für „unecht". Ein fehlender
      // Preis ist seit den Runden im September kein Ablehngrund.
      'Das Preis-Foto darf ohne Preis sein (z. B. nochmal das Produkt, der Tisch, der Einkaufswagen) — das allein ist KEIN Ausschluss.',
      'Ein und dasselbe Foto darf mehrere Schritte abdecken, wenn dort wirklich mehrere Angaben stehen — auf vielen Rückseiten stehen Zutaten, Nährwerte und Anschrift zusammen. Das ist KEIN Mangel.',
      // 24.09.2026: fünf von sieben Fotos zeigten nur den Barcode am Becherboden.
      // Vergleich am selben Tag: Nektarinen im Netz und Bergkäse von der Theke
      // wurden fälschlich als „dieselbe Ansicht" gewertet — beide tragen gar
      // keine Zutaten-/Nährwertangaben, ihr einziges Etikett war vollständig
      // fotografiert (vier unabhängige Gutachten). Deshalb die Frage getrennt:
      'traegtAngaben: trägt DIESES Produkt von Natur aus eine Zutatenliste oder Nährwerttabelle? false bei unverarbeitetem frischem Obst und Gemüse (auch im Netz, in der Schale, mit Banderole und echtem Barcode), frischen Kräutern, Eiern und Ware von der Frischetheke. true bei verarbeiteten, verpackten Lebensmitteln und bei Drogerieartikeln mit Inhaltsstoffliste.',
      'gleicheAnsicht=true NUR, wenn mindestens fünf Fotos dasselbe Motiv zeigen UND dadurch Angaben fehlen, die dieses Produkt tatsächlich trägt (z. B. Zutaten und Nährwerte stehen auf der Packung, fotografiert wurde aber immer nur Vorderseite oder Barcode). Trägt das Produkt keine weiteren Angaben und ist sein Etikett lesbar fotografiert, ist gleicheAnsicht=false.',
      'loseWare=true bei unverpackter Ware ohne Produkt-Barcode (Kräuterbund, Obst, Frischetheke mit Waage-Etikett).',
    ].join('\n'),
  });
  const r = await mitWiederholung(() => ai.models.generateContent({
    model: MODELL, contents: [{ role: 'user', parts }],
    config: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 8000, thinkingConfig: { thinkingLevel: 'LOW' } },
  }));
  const p = JSON.parse(String(r.text ?? '').replace(/^```json\s*|```\s*$/g, ''));
  if (typeof p.echt !== 'boolean') throw new Error('Bildprüfung ohne verwertbare Antwort');
  return { echt: p.echt !== false, loseWare: p.loseWare === true, traegtAngaben: p.traegtAngaben !== false, gleicheAnsicht: p.gleicheAnsicht === true, grund: String(p.grund || '').slice(0, 140) };
}

/* ─────────────────────────── Hilfen ─────────────────────────── */

function regelVersion() {
  const h = crypto.createHash('sha1');
  for (const f of ['duplicatePolicy.js', 'fotoRundeRegeln.js']) h.update(fs.readFileSync(path.join(__dirname, f)));
  return h.digest('hex').slice(0, 10);
}

/** Ablehnungsquote der letzten 30 Tage (nach Entscheidungszeit). */
function schnittQuote(alle, jetzt) {
  const ab = jetzt - 30 * 24 * 60 * 60 * 1000;
  let fr = 0; let ab2 = 0;
  for (const d of alle) {
    const t = ms(d.x.reviewedAt);
    if (!t || t < ab) continue;
    if (d.x.status === 'approved') fr++;
    else if (d.x.status === 'rejected') ab2++;
  }
  return fr + ab2 >= 30 ? ab2 / (fr + ab2) : null;
}

async function bonLage(db, jetzt) {
  const [review, letzte, cfg] = await Promise.all([
    db.collection('receipts').where('status', '==', 'review').select('createdAt').get(),
    db.collection('receipts').where('createdAt', '>=', admin.firestore.Timestamp.fromMillis(jetzt - 24 * 60 * 60 * 1000)).select('status', 'rejectReason', 'noRewardReason').get(),
    db.doc('cashback_config/v1').get(),
  ]);
  const aeltester = review.docs.map((d) => ms(d.get('createdAt'))).filter(Boolean).sort((a, b) => a - b)[0];
  const status = {}; const gruende = {}; let ohneAktion = 0;
  letzte.docs.forEach((d) => {
    const s = d.get('status') || '?'; status[s] = (status[s] || 0) + 1;
    const g = d.get('rejectReason') || d.get('noRewardReason');
    if (g) gruende[g] = (gruende[g] || 0) + 1;
    if (g === 'no_active_campaign') ohneAktion++;
  });
  // Zweitprüfung: die Bon-Pipeline zählt je BERLINER Tag
  // (cashback_referee_usage/{todayBerlin()}). Drei Tage lesen, damit das
  // Fenster wirklich mindestens 48 h abdeckt (um 08:00 wären zwei Tage nur ~32 h).
  const tage = [0, 1, 2].map((i) => berlinTag(jetzt - i * 24 * 60 * 60 * 1000));
  const nutzung = await Promise.all(tage.map((t) => db.doc(`cashback_referee_usage/${t}`).get()));
  const schalter = cfg.get('ocrReferee');
  return {
    bons: {
      inPruefung: review.size,
      aeltesteTage: aeltester ? Math.floor((jetzt - aeltester) / (24 * 60 * 60 * 1000)) : null,
      letzte24h: { gesamt: letzte.size, status, gruende, ohneAktion },
    },
    zweitpruefung: {
      eingeschaltet: schalter === true || schalter === 'shadow',
      modus: schalter ?? null,
      laeufeLetzte48h: nutzung.reduce((s, d) => s + (Number(d.get('runs')) || 0), 0),
    },
    fotoWorkerScharf: cfg.get('fotoWorker') === true,
    bonWorkerScharf: cfg.get('bonWorker') === true,
  };
}

async function aktionsLage(db) {
  const s = await db.collection('cashback_campaigns').get();
  return s.docs.map((d) => ({
    id: d.id, kind: d.get('kind') || null, active: d.get('active') === true,
    startAt: ms(d.get('startAt')) || 0, endAt: ms(d.get('endAt')) || 0,
    budgetRemainingCents: d.get('budgetRemainingCents') ?? null, budgetTotalCents: d.get('budgetTotalCents') ?? null,
    cashbackPerBonCents: d.get('cashbackPerBonCents') ?? null,
  }));
}

/* ─────────────────────────── Der Lauf ─────────────────────────── */

/**
 * @param {object} opts
 * @param {string[]} [opts.vergleich]  REIN RECHNEN über schon entschiedene Fälle:
 *   diese IDs gelten als offen (nur im Speicher), es wird nichts nachgelesen,
 *   nichts geschrieben und kein Bericht angelegt; zurück kommt der Plan.
 *   Zweck: eine Regel- oder Prompt-Änderung gegen echte Entscheidungen prüfen
 *   (erstmals 24.09.2026: Runde gegen die Handrunde desselben Tages).
 */
async function taeglicheRunde({ dryRun = false, projekt, bucketName, ausloeser = 'zeitplan', vergleich = null } = {}) {
  if (vergleich) dryRun = true;
  const db = admin.firestore();
  const bucket = bucketName || `${projekt}.appspot.com`;
  const ai = new GoogleGenAI({ vertexai: true, project: projekt, location: 'global' });
  const start = Date.now();
  const frist = start + ARBEITSZEIT_MS;
  const tag = berlinTag(start);
  const lauf = `${tag}_${berlinZeit(start)}${dryRun ? '_trocken' : ''}`;

  const alle = (await db.collection(COL).get()).docs.map((d) => ({ id: d.id, ref: d.ref, x: d.data() }));
  if (vergleich) {
    const ids = new Set(vergleich);
    // Die Entscheidung von damals ausblenden: Status wieder offen, Entscheidungs-
    // felder weg — nur im Speicher. Nachgelesene Angaben (*RescueOcr) bleiben,
    // die hätte die Runde genauso erzeugt.
    alle.forEach((d) => {
      if (!ids.has(d.id)) return;
      d.vorher = { status: d.x.status, rejectReason: d.x.rejectReason || null };
      d.x = { ...d.x, status: 'pending' };
      delete d.x.rejectReason; delete d.x.reviewedAt; delete d.x.review;
    });
  }
  const pending = alle
    .filter((d) => d.x.status === 'pending' && (!vergleich || d.vorher))
    .sort((a, b) => (ms(a.x.createdAt) ?? 0) - (ms(b.x.createdAt) ?? 0));

  // 1) Fehlende Angaben nachlesen
  const nachgelesen = { name: 0, ean: 0, preis: 0, hersteller: 0 };
  const rettungFehler = new Map();
  const nichtNachgelesen = vergleich ? [] : await arbeite(pending, async (d) => {
    try {
      const { patch, fehler } = await rettungFuer(ai, bucket, d.ref, d.x);
      if (Object.keys(fehler).length) rettungFehler.set(d.id, fehler);
      if (patch) {
        Object.assign(d.x, patch);
        if (patch.productNameRescueOcr) nachgelesen.name++;
        if (patch.eanRescueOcr) nachgelesen.ean++;
        if (patch.priceRescueOcr) nachgelesen.preis++;
        if (patch.manufacturerRescueOcr) nachgelesen.hersteller++;
      }
    } catch (e) {
      rettungFehler.set(d.id, { alles: String(e.message).slice(0, 120) });
    }
  }, PARALLEL_KI, frist);
  nichtNachgelesen.forEach((d) => rettungFehler.set(d.id, { name: 'zeit_abgelaufen', ean: 'zeit_abgelaufen' }));

  // 2) Bilddateien: leer, unlesbar, oder aus einer früheren Einreichung bekannt
  const storage = admin.storage().bucket(bucket);
  const metaVon = new Map();
  await arbeite(pending, async (d) => {
    const metas = await Promise.all(Object.entries(d.x.images || {}).map(async ([k, p]) => {
      try { const [m] = await storage.file(String(p)).getMetadata(); return { k, p, md5: m.md5Hash || null, size: Number(m.size) || 0 }; }
      catch { return { k, p, md5: null, size: -1 }; }
    }));
    metaVon.set(d.id, metas);
  }, 20, null);
  const alterVon = new Map(alle.map((d) => [d.id, ms(d.x.createdAt) ?? 0]));
  const gruppen = new Map();
  const merke = (key, id) => { if (!gruppen.has(key)) gruppen.set(key, new Set()); gruppen.get(key).add(id); };
  alle.forEach((d) => Object.entries(d.x.images || {}).forEach(([k, p]) => { if (IDENTITY_SLOTS.has(k)) merke(`p:${p}`, d.id); }));
  for (const [id, metas] of metaVon) for (const m of metas) if (m.md5 && IDENTITY_SLOTS.has(m.k)) merke(`m:${m.md5}`, id);
  const wiederverwendet = new Set();
  for (const ids of gruppen.values()) {
    if (ids.size < 2) continue;
    // Die ÄLTESTE Einreichung ist die Erstnutzung und behält ihre Chance —
    // bestraft wird die Wiederverwendung, nie das Original (Regel 10.09.).
    [...ids].sort((a, b) => (alterVon.get(a) ?? 0) - (alterVon.get(b) ?? 0)).slice(1).forEach((i) => wiederverwendet.add(i));
  }

  // 3) Vorprüfung, die ohne Reihenfolge auskommt
  const vor = new Map();
  for (const d of pending) {
    const x = d.x;
    const comp = completenessCheck({ images: x.images, ean: eanOf(x), productName: x.productName, productNameOcr: x.productNameOcr || x.productNameRescueOcr }, REQUIRED);
    const metas = metaVon.get(d.id) || [];
    vor.set(d.id, { comp, leer: metas.filter((m) => m.size === 0).map((m) => m.k), unlesbar: metas.filter((m) => m.size < 0).map((m) => m.k) });
  }

  // 4) Bildprüfung für alles, dem nicht schon ein Foto fehlt
  const zuPruefen = pending.filter((d) => { const v = vor.get(d.id); return !v.comp.problems.includes('unvollstaendig') && !v.leer.length && !v.unlesbar.length; });
  const audit = new Map(); const auditFehler = new Map();
  const nichtGeprueft = await arbeite(zuPruefen, async (d) => {
    try { audit.set(d.id, await bildAudit(ai, bucket, d.x)); }
    catch (e) { auditFehler.set(d.id, String(e.message).slice(0, 140)); }
  }, PARALLEL_KI, frist);
  nichtGeprueft.forEach((d) => auditFehler.set(d.id, 'zeit_abgelaufen'));

  // 5) Chronologisch entscheiden — eine im selben Lauf entschiedene Einreichung
  //    ist für die nächste derselben EAN Referenz bzw. kein offener Vorgänger mehr.
  const byEan = new Map();
  alle.forEach((d) => { const e = eanOf(d.x); if (!e) return; if (!byEan.has(e)) byEan.set(e, []); byEan.get(e).push(policyOf(d.id, d.x)); });
  const statusJetzt = new Map(alle.map((d) => [d.id, d.x.status]));
  const plan = [];
  for (const d of pending) {
    const v = vor.get(d.id);
    const andere = (byEan.get(eanOf(d.x)) || []).filter((o) => o.id !== d.id).map((o) => ({ ...o, status: statusJetzt.get(o.id) || o.status }));
    const dup = eanOf(d.x) ? evaluateDuplicate(policyOf(d.id, d.x), andere) : { verdict: 'ok', reason: null, lockUntil: null };
    const refDoc = dup.priorId ? alle.find((a) => a.id === dup.priorId) : null;
    const preisFehlt = !preisOf(d.x) || (refDoc ? !preisOf(refDoc.x) : false);
    // Die Referenz (binnen 24 h freigegeben) lief selbst schon durch dieses
    // Nachlesen, als sie offen war — deshalb hier nur der Fehler des Kandidaten.
    const rf = { ...(rettungFehler.get(d.id) || {}) };
    const e = entscheideFall({
      comp: v.comp, dup, leer: v.leer, unlesbar: v.unlesbar, wiederverwendet: wiederverwendet.has(d.id),
      audit: audit.get(d.id) || null, auditFehler: auditFehler.get(d.id) || null, rettungFehler: rf, preisFehlt,
    });
    plan.push({ ...d, ...e, comp: v.comp, dup, audit: audit.get(d.id) || null });
    if (e.entscheidung === 'freigeben') statusJetzt.set(d.id, 'approved');
    else if (e.entscheidung === 'ablehnen') statusJetzt.set(d.id, 'rejected');
  }

  // 6) Notbremse
  const bremse = notbremse(plan, { schnittQuote: schnittQuote(alle, start) });

  if (vergleich) {
    return {
      notbremse: bremse,
      plan: plan.map((p) => ({
        id: p.id, name: String(nameOf(p.x) || '?').slice(0, 60), markt: p.x.marketName || null,
        entscheidung: p.entscheidung, grund: p.grund, loseWare: !!p.loseWare, zurueckgehalten: p.zurueckgehaltenGrund || null,
        audit: p.audit || null, auditFehler: auditFehler.get(p.id) || null,
        vorher: p.vorher,
      })),
    };
  }

  // 7) Schreiben
  if (!dryRun) {
    for (const p of plan) {
      if (p.entscheidung === 'offen') continue;
      const precheck = { verdict: p.comp.ok ? (p.dup.verdict === 'ok' ? 'ok' : p.dup.verdict) : 'incomplete', reasons: [...p.comp.problems, ...(p.dup.reason ? [p.dup.reason] : [])] };
      const bild = p.audit ? { echt: p.audit.echt, loseWare: p.audit.loseWare, traegtAngaben: p.audit.traegtAngaben, gleicheAnsicht: p.audit.gleicheAnsicht, grund: p.audit.grund } : null;
      try {
      await db.runTransaction(async (tx) => {
        const s = await tx.get(p.ref);
        if (!s.exists || s.data().status !== 'pending') { p.uebersprungen = true; return; }
        if (p.entscheidung === 'freigeben') {
          tx.update(p.ref, {
            status: 'approved', reviewedAt: FieldValue.serverTimestamp(), reviewedBy: ENTSCHEIDER, updatedAt: FieldValue.serverTimestamp(),
            review: { precheck, decidedBy: ENTSCHEIDER, forced: false, bildAudit: bild, lauf },
            holdReasons: FieldValue.delete(), rejectReason: FieldValue.delete(),
            // KEINE Push-Merker setzen: die Nachricht schickt der Sammler in
            // crowd-upload-reward. Ein hier gesetztes `rewardPushSentAt` hielte
            // er für „schon verschickt" — die Person bekäme gar nichts.
            ...(p.loseWare ? { loseWare: { art: 'vom_bildaudit_erkannt', markiertAm: FieldValue.serverTimestamp() } } : {}),
            ...(p.ohneAngaben ? { frischwareOhneAngaben: true } : {}),
          });
        } else {
          tx.update(p.ref, {
            status: 'rejected', rejectReason: p.grund, holdReasons: [...new Set([...(s.data().holdReasons || []), p.grund])],
            reviewNote: noteFor(p.grund, p.ctx), reviewedAt: FieldValue.serverTimestamp(), reviewedBy: ENTSCHEIDER, updatedAt: FieldValue.serverTimestamp(),
            review: { precheck, decidedBy: ENTSCHEIDER, reason: p.grund, lockUntil: p.ctx.lockUntil || null, bildAudit: bild, lauf },
          });
        }
      });
      } catch (e) {
        // Ein einzelner Schreibfehler darf die Runde nicht abbrechen (kein
        // Bericht, restliche Fälle unentschieden, retryCount 0). Der Fall
        // bleibt pending und ist morgen wieder dran; der Bericht warnt rot.
        logger.warn('Entscheidung nicht geschrieben', { id: p.id, fehler: String(e.message).slice(0, 160) });
        p.zurueckgehaltenGrund = p.grund;
        p.entscheidung = 'offen';
        p.grund = 'schreib_fehler';
        p.ctx = { ...(p.ctx || {}), hinweis: String(e.message).slice(0, 120) };
      }
    }
  }

  // 8) Auf die Buchungen warten — nur für die Zahlen im Bericht (gebucht,
  //    Personen). Die Nachricht an die Nutzer verschickt der Sammler selbst.
  const freigegeben = plan.filter((p) => p.entscheidung === 'freigeben' && !p.uebersprungen);
  let gebucht = [];
  let buchungAusstehend = 0;
  if (!dryRun && freigegeben.length) {
    const bis = Date.now() + BUCHUNG_WARTEN_MS;
    let stand = [];
    for (;;) {
      stand = [];
      for (let i = 0; i < freigegeben.length; i += 100) {
        const snaps = await db.getAll(...freigegeben.slice(i, i + 100).map((p) => p.ref));
        snaps.forEach((s) => stand.push({ id: s.id, uid: s.get('userId'), rewardResult: s.get('rewardResult'), rewardCents: s.get('rewardCents'), grund: s.get('rewardNotCreditedReason') || null }));
      }
      if (stand.every((s) => s.rewardResult) || Date.now() > bis) break;
      await schlafe(15000);
    }
    gebucht = stand;
    buchungAusstehend = stand.filter((s) => !s.rewardResult).length;
  }

  // 9) Lage bei Bons und Aktionen, Warnungen
  const [lage, aktionen, vorher, bonSnap] = await Promise.all([bonLage(db, start), aktionsLage(db), db.doc(`${BERICHTE}/aktuell`).get(), db.doc(`ops_bonrunden/${tag}`).get()]);
  // Ergebnis der Bon-Runde von 07:45 (src/bonRunde.js) in denselben Bericht.
  const bonRundeRoh = (d) => (({ laufAt, ...rest }) => ({ ...rest, laufAt: laufAt && laufAt.toMillis ? laufAt.toMillis() : null }))(d);
  let bonRundeHeute = bonSnap.exists ? bonRundeRoh(bonSnap.data()) : null;
  // Kein fertiger Bericht: läuft sie noch, oder ist sie abgebrochen? Nach
  // 15 min (Laufzeitgrenze der Function) steht ein Lauf-Dokument auf `laeuft`
  // nur noch, wenn die Function beendet wurde, ohne den Bericht zu schreiben.
  let bonAbgebrochen = false; let bonLaeuftNoch = false; let bonNachgereicht = null;
  if (!bonSnap.exists) {
    const laeufe = (await db.collection('ops_bonrunden').where('tag', '==', tag).limit(10).get()).docs;
    // Zwischen den beiden Lesevorgängen fertig geworden? Dann diesen Bericht nehmen.
    const fertig = laeufe.filter((d) => d.get('laeuft') === false)
      .sort((a, b) => ((b.get('laufAt')?.toMillis?.() || 0) - (a.get('laufAt')?.toMillis?.() || 0)))[0];
    if (fertig) bonNachgereicht = fertig.data();
    else laeufe.filter((d) => d.get('laeuft') === true).forEach((d) => {
      const at = d.get('laufAt'); const alt = at && at.toMillis ? Date.now() - at.toMillis() : Infinity;
      if (alt > 15 * 60 * 1000) bonAbgebrochen = true; else bonLaeuftNoch = true;
    });
  }
  if (bonNachgereicht) bonRundeHeute = bonRundeRoh(bonNachgereicht);
  const version = regelVersion();
  const zaehle = (liste, feld) => liste.reduce((a, p) => { const k = p[feld] || '?'; a[k] = (a[k] || 0) + 1; return a; }, {});
  const abgelehnt = plan.filter((p) => p.entscheidung === 'ablehnen' && !p.uebersprungen);
  const offen = plan.filter((p) => p.entscheidung === 'offen');
  const runde = {
    geprueft: pending.length, offen: offen.length,
    auditVersucht: zuPruefen.length - nichtGeprueft.length, auditFehler: [...auditFehler.values()].filter((f) => f !== 'zeit_abgelaufen').length,
    nichtGeschafft: new Set([...nichtNachgelesen, ...nichtGeprueft].map((d) => d.id)).size,
    schreibFehler: plan.filter((p) => p.grund === 'schreib_fehler').length,
  };
  const warn = warnungen({
    jetzt: start, aktionen, zweitpruefung: lage.zweitpruefung, bons: lage.bons, runde, notbremse: bremse,
    regelVersion: { alt: vorher.exists ? vorher.get('regelVersion') || null : null, neu: version },
    bonRunde: { scharf: lage.bonWorkerScharf, bericht: bonRundeHeute, abgebrochen: bonAbgebrochen, laeuftNoch: bonLaeuftNoch },
  });
  const gebuchtCents = gebucht.filter((s) => s.rewardResult === 'credited').reduce((s, g) => s + (Number(g.rewardCents) || 0), 0);
  const fall = (p) => ({ id: p.id, name: String(nameOf(p.x) || '?').slice(0, 60), markt: p.x.marketName || null, grund: p.grund, hinweis: p.ctx?.hinweis || null, zurueckgehalten: p.zurueckgehaltenGrund || null });

  const bericht = {
    lauf, tag, ausloeser, dryRun,
    laufAt: FieldValue.serverTimestamp(),
    dauerSekunden: Math.round((Date.now() - start) / 1000),
    regelVersion: version, modell: MODELL,
    geprueft: pending.length,
    freigegeben: dryRun ? plan.filter((p) => p.entscheidung === 'freigeben').length : freigegeben.length,
    abgelehnt: abgelehnt.length,
    offen: offen.length,
    loseWare: plan.filter((p) => p.loseWare).length,
    gebuchtCents, buchungAusstehend,
    personenBezahlt: new Set(gebucht.filter((s) => s.rewardResult === 'credited').map((s) => s.uid)).size,
    // Freigegeben, aber nicht gebucht (Pro-Kopf-Deckel, Budget leer …) — der
    // Grund steht am Dokument; hier nur gezählt, damit es im Bericht auffällt.
    nichtGebucht: zaehle(gebucht.filter((s) => s.rewardResult && s.rewardResult !== 'credited'), 'grund'),
    nachgelesen,
    ablehnGruende: zaehle(abgelehnt, 'grund'),
    offenGruende: zaehle(offen, 'grund'),
    bildpruefung: { versucht: runde.auditVersucht, gescheitert: runde.auditFehler, unpassend: plan.filter((p) => BILD_GRUENDE.has(p.grund) || BILD_GRUENDE.has(p.zurueckgehaltenGrund)).length },
    nichtGeschafft: runde.nichtGeschafft,
    schreibFehler: runde.schreibFehler,
    notbremse: { bild: bremse.bild, gesamt: bremse.gesamt },
    wartetAufDich: offen.slice(0, 100).map(fall),
    abgelehntListe: abgelehnt.slice(0, 100).map(fall),
    bons: lage.bons,
    zweitpruefung: lage.zweitpruefung,
    bonRunde: bonRundeHeute,
    aktionen: aktionen.filter((a) => a.active && a.endAt > start - 7 * 24 * 60 * 60 * 1000).map(({ id, kind, startAt, endAt, budgetRemainingCents, budgetTotalCents, cashbackPerBonCents }) => ({ id, kind, startAt, endAt, budgetRemainingCents, budgetTotalCents, cashbackPerBonCents })),
    warnungen: warn,
  };
  await db.collection(BERICHTE).doc(lauf).set(bericht);
  // `aktuell` liest der Morgen-Chat. Geschrieben von jedem ZEITPLAN-Lauf, auch
  // als Trockenlauf (mit dryRun:true) — sonst meldete der Chat bei
  // ausgeschaltetem Schalter jeden Morgen „nicht gelaufen" und die Warnungen des
  // Laufs kämen nie an (Gegenprüfung 24.09.). Manuelle Läufe schreiben es nie.
  if (ausloeser === 'zeitplan') await db.collection(BERICHTE).doc('aktuell').set(bericht);
  logger.info('Morgenrunde fertig', { lauf, geprueft: bericht.geprueft, freigegeben: bericht.freigegeben, abgelehnt: bericht.abgelehnt, offen: bericht.offen, warnungen: warn.length });
  return { ...bericht, laufAt: new Date().toISOString() };
}

module.exports = { taeglicheRunde, noteFor, pruefzifferOk };
