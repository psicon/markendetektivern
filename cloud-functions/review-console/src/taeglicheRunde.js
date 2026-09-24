'use strict';
/**
 * Tägliche Produktfoto-Runde (vorbereitet 20.09.2026, NOCH NICHT eingeplant).
 *
 * Macht einmal am Morgen das, was bisher von Hand lief: fehlende Angaben aus
 * den Fotos nachlesen, die Regeln der Prüfkonsole anwenden, die Bilder ansehen,
 * entscheiden — und eine Zusammenfassung hinterlassen.
 *
 * WARUM DAS HIER LIEGT und nicht als eigene Codebase: die Regeln
 * (`duplicatePolicy.js`) werden hier gepflegt. Ein Worker mit eigener Kopie
 * hätte genau den Fehler wiederholt, der am 20.09. fast passiert wäre — ein
 * Ops-Skript entschied nach einer Regelfassung, die Stunden zuvor überholt
 * worden war (8 von 14 Ablehnungen wären falsch gewesen).
 *
 * WAS ER ALLEIN ENTSCHEIDET
 *  • Freigeben: alles, was die Regeln sauber passiert UND im Bild-Audit echt ist.
 *    Das ist die harmlose Richtung — Geld fließt für Arbeit, die geleistet wurde.
 *  • Ablehnen NUR bei mechanisch eindeutigen Fällen (Entscheidung Patrick
 *    20.09.): ein Pflichtfoto fehlt oder ist leer, kein Barcode auffindbar,
 *    derselbe Artikel vom selben Nutzer binnen 24 h, identische Bilddatei aus
 *    einer früheren Einreichung.
 *
 * WAS ER LIEGEN LÄSST (Morgenliste, Patrick entscheidet)
 *  • Der Bild-Audit hält etwas für unecht — am 20.09. hat genau hier das
 *    Hinsehen den Unterschied gemacht: siebenmal dieselbe Ansicht war ein
 *    Mangel, dreimal dieselbe Datei auf einer Käse-Rückseite dagegen völlig
 *    in Ordnung (Zutaten, Nährwerte und Anschrift stehen dort zusammen).
 *  • Der Bild-Audit ist an einem Infrastrukturfehler gescheitert. Ein 429 ist
 *    kein Urteil über eine Einreichung — aber eben auch keine Freigabe.
 *
 * Der Lauf schreibt NIE Geld selbst: eine Freigabe setzt nur den Status, buchen
 * tut `crowd-upload-reward` (eine Quelle fürs Ledger, wie überall).
 */
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');
const { GoogleGenAI } = require('@google/genai');
const { evaluateDuplicate, completenessCheck, REASON } = require('./duplicatePolicy');

const COL = 'crowd_uploads';
const BERICHTE = 'ops_tagesberichte';
const REQUIRED = ['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten', 'preis'];
// Bild-Wiederverwendung zählt nur für die produkt-identifizierenden Fotos:
// ein gemeinsames Regal-Preisschild zweier Sorten ist plausibel (Befund 13.09.).
const IDENTITY_SLOTS = new Set(['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten']);
const MODELL = 'gemini-3.5-flash';
const PARALLEL = 8;
const ENTSCHEIDER = 'worker-fotorunde';

// Diese Gründe darf der Worker allein schreiben. Alles andere wartet auf einen
// Menschen. Die Liste ist bewusst kurz: jeder Eintrag muss ohne Ansehen der
// Bilder entscheidbar sein.
const EINDEUTIG = new Set(['unvollstaendig', 'ean_fehlt', 'ean_fehlt_lose_ware', 'bilder_wiederverwendet', REASON.SAME_USER]);

const ms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : null);
const fmtDate = (m) => (m ? new Date(m).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : null);
const norm = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Geretteter Wert zählt wie ein gelesener — aber NUR beim Preis, nie beim
 *  Hersteller: „Kaufland Stiftung & Co." (Markeninhaber) und „DMK Deutsches
 *  Milchkontor" (Produzent) stehen auf derselben Packung; als „andere Daten"
 *  gewertet gäbe das eine echte Dublette frei (gemessen 20.09.). */
const eanOf = (x) => x.ean || x.eanRescueOcr || null;
const nameOf = (x) => x.productName || x.productNameOcr || x.productNameRescueOcr || null;
const preisOf = (x) => (x.priceOcr && Number.isFinite(x.priceOcr.priceCents) && x.priceOcr.priceCents > 0 ? x.priceOcr : x.priceRescueOcr || null);
const policyOf = (id, x) => ({
  id, userId: x.userId ?? null, ean: eanOf(x), marketId: x.marketId ?? null,
  status: x.status, createdAt: ms(x.createdAt), priceOcr: preisOf(x), manufacturerOcr: x.manufacturerOcr ?? null,
});

function noteFor(reason, ctx = {}) {
  const until = fmtDate(ctx.lockUntil);
  switch (reason) {
    case REASON.SAME_USER: return `Dieses Produkt liegt uns von dir schon vor — die erste Einreichung zählt. Ab ${until || 'morgen'} zählt derselbe Artikel wieder, und mit neuem Preis, Hersteller oder Markt sofort.`;
    case REASON.PENDING_OLDER: return 'Doppelt eingereicht — die frühere Einreichung zählt.';
    case 'unvollstaendig': return `Es fehlen Fotos (${(ctx.missing || []).join(', ') || 'siehe Liste'}). Mit allen sieben Ansichten klappt es beim nächsten Mal.`;
    case 'ean_fehlt': return 'Der Barcode (EAN, 8–14 Ziffern) ordnet das Produkt eindeutig zu — beim nächsten Mal bitte scannen oder eintippen.';
    case 'ean_fehlt_lose_ware': return 'Lose Ware wie Kräuterbunde oder Frischetheken-Artikel hat keinen Produkt-Barcode — die Waage-Etiketten sind händlerintern. Mit verpackten Artikeln mit Barcode zählt deine Einreichung sofort.';
    case 'kein_produktname': return 'Der Produktname war nicht erkennbar — Vorderseite gut ausgeleuchtet und ohne Spiegelung, dann passt es.';
    case 'bilder_wiederverwendet': return 'Dieselben Fotos wurden schon für eine andere Einreichung verwendet — jedes Produkt braucht eigene Aufnahmen.';
    default: return 'Danke fürs Einreichen — beim nächsten Datensatz geht es weiter.';
  }
}

/* ─────────────────────────── Bilder lesen ─────────────────────────── */

function ki(projekt) {
  return new GoogleGenAI({ vertexai: true, project: projekt, location: 'global' });
}
const teil = (bucket, slot, pfad) => [{ text: `— Foto "${slot}":` }, { fileData: { fileUri: `gs://${bucket}/${pfad}`, mimeType: 'image/jpeg' } }];

async function frage(ai, bucket, images, slots, text, mitDenken = true) {
  const parts = [];
  for (const s of slots) if (images[s]) parts.push(...teil(bucket, s, images[s]));
  parts.push({ text });
  const r = await ai.models.generateContent({
    model: MODELL,
    contents: [{ role: 'user', parts }],
    config: {
      responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 8000,
      // MIT Denken. Der Namer liest mit thinkingBudget 0 und übersieht dabei
      // genau die Angaben, die hier fehlen (ClickUp 12487v2akpm).
      ...(mitDenken ? { thinkingConfig: { thinkingLevel: 'LOW' } } : {}),
    },
  });
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
 * Fehlende Angaben aus den Fotos nachlesen. Übernommen wird nur, was ZWEI
 * unabhängige Lesungen gleich lesen; alles landet in EIGENEN Feldern, damit
 * messbar bleibt, wie gut der Namer selbst liest.
 */
async function rettungFuer(ai, bucket, ref, x) {
  const patch = {};
  const offenName = !nameOf(x);
  const offenEan = !eanOf(x) && !!x.images?.ean;
  const offenPreis = !preisOf(x);
  const offenHersteller = !(x.manufacturerOcr && String(x.manufacturerOcr.name || '').trim()) && !x.manufacturerRescueOcr;
  if (!offenName && !offenEan && !offenPreis && !offenHersteller) return null;

  if (offenName) {
    const [a, b] = [
      await frage(ai, bucket, x.images, ['front', 'rueckseite'], 'Lies den PRODUKTNAMEN von der Verpackung. JSON: {"name":"…","sicher":true|false}. name = Marke + Bezeichnung + Sorte, ohne Menge und Preis. Nicht zweifelsfrei lesbar → name leer, sicher false.'),
      await frage(ai, bucket, x.images, ['front', 'rueckseite'], 'Lies den PRODUKTNAMEN von der Verpackung. JSON: {"name":"…","sicher":true|false}. name = Marke + Bezeichnung + Sorte, ohne Menge und Preis. Nicht zweifelsfrei lesbar → name leer, sicher false.'),
    ];
    if (a.name && a.sicher !== false && norm(a.name) === norm(b.name)) patch.productNameRescueOcr = String(a.name).slice(0, 120);
  }
  if (offenEan) {
    const p = 'Lies die EAN/GTIN unter dem Strichcode. JSON: {"ean":"nur Ziffern","sicher":true|false}. Vollständig und in gedruckter Reihenfolge. Nicht zweifelsfrei lesbar oder kein Strichcode → leer. Nichts raten.';
    const [a, b] = [await frage(ai, bucket, x.images, ['ean', 'rueckseite', 'front'], p), await frage(ai, bucket, x.images, ['ean', 'rueckseite', 'front'], p)];
    const ea = String(a.ean || '').replace(/\D/g, '');
    // Streng, weil unter den EAN-losen Einreichungen viel lose Ware ist: ein
    // Modell, das nach einer Nummer gefragt wird, liefert dort gern die vom
    // Waage-Etikett (Befund 19.09.).
    if (ea && ea === String(b.ean || '').replace(/\D/g, '') && a.sicher !== false && b.sicher !== false && pruefzifferOk(ea)) patch.eanRescueOcr = ea;
  }
  if (offenPreis || offenHersteller) {
    const p = [
      'Lies zwei Angaben, sonst nichts. JSON: {"priceCents":0,"priceImageKind":"","manufacturer":""}.',
      'priceCents: Verkaufspreis DIESES Produkts in Cent (1,99 € → 199), vom Regal-Preisschild oder der Bon-Zeile.',
      'NICHT den Grundpreis (€/kg), NICHT den durchgestrichenen Preis, NICHT die Bon-Endsumme. Kein Preis sichtbar → 0.',
      'priceImageKind: "preisschild" | "kassenbon" | "beides" | "produktfoto" | "sonstiges".',
      'manufacturer: Inverkehrbringer laut Verpackung als Firmenname ohne Adresse. Nicht lesbar → leer.',
      'Nichts raten — ein erfundener Wert ist schlechter als ein leeres Feld.',
    ].join('\n');
    const slots = ['preis', 'hersteller', 'rueckseite', 'front'];
    const [a, b] = [await frage(ai, bucket, x.images, slots, p), await frage(ai, bucket, x.images, slots, p)];
    const ca = Number.isFinite(a.priceCents) && a.priceCents > 0 ? Math.round(a.priceCents) : null;
    const cb = Number.isFinite(b.priceCents) && b.priceCents > 0 ? Math.round(b.priceCents) : null;
    // Preis nur aus einer Quelle, die überhaupt einen Preis zeigt. Bei 40 % der
    // Einreichungen ist das „Preis"-Foto nur nochmal das Produkt (ClickUp 12487v2akq0).
    if (offenPreis && ca && ca === cb && ca <= 20000 && ['preisschild', 'kassenbon', 'beides'].includes(String(a.priceImageKind || '').toLowerCase())) {
      patch.priceRescueOcr = { priceCents: ca, currency: 'EUR', priceImageKind: String(a.priceImageKind).toLowerCase() };
    }
    if (offenHersteller && a.manufacturer && norm(a.manufacturer) === norm(b.manufacturer)) {
      patch.manufacturerRescueOcr = { name: String(a.manufacturer).slice(0, 140) };
    }
  }
  if (!Object.keys(patch).length) return null;
  patch.rescueAt = FieldValue.serverTimestamp();
  patch.rescueQuelle = `${MODELL}/vertex mit Denken, zwei übereinstimmende Lesungen`;
  await ref.set(patch, { merge: true });
  return patch;
}

/** Bild-Audit: sieht alle sieben Fotos an. Zusätzlich die Frage nach loser Ware,
 *  damit ein fehlender Barcode den richtigen Text bekommt. */
async function bildAudit(ai, bucket, x) {
  const parts = [];
  for (const s of REQUIRED) if (x.images?.[s]) parts.push(...teil(bucket, s, x.images[s]));
  parts.push({
    text: [
      `Du prüfst eine Produkt-Einreichung (die Fotos sind oben je Schritt benannt).`,
      `Erwartet: echtes Einzelhandels-Produkt "${nameOf(x) || 'unbekannt'}" (EAN ${eanOf(x) || 'unbekannt'}).`,
      `Erwartung je Schritt: front=Vorderseite, rueckseite=Rückseite, hersteller=Hersteller-/Adressangabe, ean=Barcode, naehrwerte=Nährwerttabelle, zutaten=Zutatenliste, preis=Preisschild oder Bon.`,
      `JSON: {"echt":true|false,"loseWare":true|false,"gleicheAnsicht":true|false,"grund":"kurz"}.`,
      `echt=false NUR bei eindeutigem Ausschluss: kein reales Produkt, abfotografierter Bildschirm, fremde Motive, Schritte grob falsch belegt.`,
      `Unscharf, angeschnitten oder zwei vertauschte Schritte = trotzdem echt=true.`,
      `WICHTIG: Ein und dasselbe Foto darf mehrere Schritte abdecken, wenn dort wirklich mehrere Angaben stehen — auf vielen Rückseiten stehen Zutaten, Nährwerte und Anschrift zusammen. Das ist KEIN Mangel.`,
      `gleicheAnsicht=true nur, wenn ALLE Fotos dieselbe Ansicht zeigen und die verlangten Angaben dadurch fehlen.`,
      `loseWare=true bei unverpackter Ware ohne Produkt-Barcode (Kräuterbund, Obst, Frischetheke mit Waage-Etikett).`,
    ].join('\n'),
  });
  const r = await ai.models.generateContent({
    model: MODELL, contents: [{ role: 'user', parts }],
    config: { responseMimeType: 'application/json', temperature: 0, maxOutputTokens: 8000, thinkingConfig: { thinkingLevel: 'LOW' } },
  });
  const p = JSON.parse(String(r.text ?? '').replace(/^```json\s*|```\s*$/g, ''));
  return { echt: p.echt !== false, loseWare: p.loseWare === true, gleicheAnsicht: p.gleicheAnsicht === true, grund: String(p.grund || '').slice(0, 140) };
}

/* ─────────────────────────── Der Lauf ─────────────────────────── */

async function arbeite(liste, arbeiter, gleichzeitig = PARALLEL) {
  const queue = [...liste];
  await Promise.all(Array.from({ length: Math.min(gleichzeitig, queue.length || 1) }, async () => {
    for (;;) {
      const e = queue.shift();
      if (!e) return;
      await arbeiter(e);
    }
  }));
}

async function taeglicheRunde({ dryRun = false, projekt, bucketName } = {}) {
  const db = admin.firestore();
  const bucket = bucketName || `${projekt}.appspot.com`;
  const ai = ki(projekt);
  const start = Date.now();

  const alle = (await db.collection(COL).get()).docs.map((d) => ({ id: d.id, ref: d.ref, x: d.data() }));
  const pending = alle.filter((d) => d.x.status === 'pending').sort((a, b) => (ms(a.x.createdAt) ?? 0) - (ms(b.x.createdAt) ?? 0));
  if (!pending.length) return { geprueft: 0, freigegeben: 0, abgelehnt: 0, offen: 0, hinweise: ['nichts zu tun'] };

  // 1) Fehlende Angaben nachlesen
  let gerettet = 0;
  await arbeite(pending, async (d) => {
    try { if (await rettungFuer(ai, bucket, d.ref, d.x)) { gerettet++; Object.assign(d.x, (await d.ref.get()).data()); } }
    catch (e) { logger.warn('Rettung gescheitert', { id: d.id, fehler: String(e.message).slice(0, 120) }); }
  });

  // 2) Bilddateien: leer, unlesbar, oder aus einer früheren Einreichung bekannt
  const storage = admin.storage().bucket(bucket);
  const metaVon = new Map();
  await arbeite(pending, async (d) => {
    const metas = await Promise.all(Object.entries(d.x.images || {}).map(async ([k, p]) => {
      try { const [m] = await storage.file(String(p)).getMetadata(); return { k, p, md5: m.md5Hash || null, size: Number(m.size) || 0 }; }
      catch { return { k, p, md5: null, size: -1 }; }
    }));
    metaVon.set(d.id, metas);
  });
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

  // 3) Regeln anwenden
  const byEan = new Map();
  alle.forEach((d) => { const e = eanOf(d.x); if (!e) return; if (!byEan.has(e)) byEan.set(e, []); byEan.get(e).push(policyOf(d.id, d.x)); });
  const statusJetzt = new Map(alle.map((d) => [d.id, d.x.status]));
  const plan = [];
  for (const d of pending) {
    const x = d.x;
    const comp = completenessCheck({ images: x.images, ean: eanOf(x), productName: x.productName, productNameOcr: x.productNameOcr || x.productNameRescueOcr }, REQUIRED);
    const andere = (byEan.get(eanOf(x)) || []).filter((o) => o.id !== d.id).map((o) => ({ ...o, status: statusJetzt.get(o.id) || o.status }));
    const dup = eanOf(x) ? evaluateDuplicate(policyOf(d.id, x), andere) : { verdict: 'ok', reason: null, lockUntil: null };
    const metas = metaVon.get(d.id) || [];
    const leer = metas.filter((m) => m.size === 0).map((m) => m.k);
    // Ein Storage-Lesefehler ist eine Aussage über UNSERE Technik, nie über die
    // Einreichung — der darf nicht zur Ablehnung führen.
    const unlesbar = metas.filter((m) => m.size < 0).map((m) => m.k);

    let entscheidung = 'freigeben'; let grund = null; let ctx = {};
    if (!comp.ok) { entscheidung = 'ablehnen'; grund = comp.problems[0]; ctx = { missing: comp.missing }; }
    else if (leer.length) { entscheidung = 'ablehnen'; grund = 'unvollstaendig'; ctx = { missing: leer }; }
    else if (unlesbar.length) { entscheidung = 'offen'; grund = 'bild_nicht_lesbar_infrastruktur'; }
    else if (dup.verdict === 'locked') { entscheidung = 'ablehnen'; grund = dup.reason; ctx = { lockUntil: dup.lockUntil }; }
    else if (dup.verdict === 'hold') { entscheidung = 'offen'; grund = REASON.PENDING_OLDER; }
    else if (wiederverwendet.has(d.id)) { entscheidung = 'ablehnen'; grund = 'bilder_wiederverwendet'; }
    plan.push({ ...d, entscheidung, grund, ctx, comp, dup });
    if (entscheidung === 'ablehnen') statusJetzt.set(d.id, 'rejected');
  }

  // 4) Bild-Audit für alles, was freigegeben würde
  const kandidaten = plan.filter((p) => p.entscheidung === 'freigeben');
  await arbeite(kandidaten, async (p) => {
    try {
      p.audit = await bildAudit(ai, bucket, p.x);
    } catch (e) {
      // Ein gescheiterter Audit ist kein Urteil — aber auch keine Freigabe.
      p.audit = null;
      p.auditFehler = String(e.message).slice(0, 120);
    }
  });
  for (const p of kandidaten) {
    if (!p.audit) { p.entscheidung = 'offen'; p.grund = 'bild_audit_gescheitert'; continue; }
    if (!p.audit.echt || p.audit.gleicheAnsicht) { p.entscheidung = 'offen'; p.grund = p.audit.gleicheAnsicht ? 'gleiche_ansicht_mehrfach' : 'fotos_unpassend'; p.auditGrund = p.audit.grund; }
  }
  // Fehlender Barcode bei loser Ware bekommt den passenden Text.
  for (const p of plan) {
    if (p.grund !== 'ean_fehlt') continue;
    try {
      const a = p.audit || await bildAudit(ai, bucket, p.x);
      if (a && a.loseWare) { p.grund = 'ean_fehlt_lose_ware'; p.audit = a; }
    } catch { /* Text bleibt der allgemeine */ }
  }

  // 5) Nur Eindeutiges ablehnen, alles andere in die Morgenliste
  for (const p of plan) {
    if (p.entscheidung === 'ablehnen' && !EINDEUTIG.has(p.grund)) p.entscheidung = 'offen';
  }

  // 6) Schreiben
  const zahl = { freigegeben: 0, abgelehnt: 0, offen: 0 };
  const offenListe = [];
  if (!dryRun) {
    for (const p of plan) {
      if (p.entscheidung === 'offen') continue;
      await db.runTransaction(async (tx) => {
        const s = await tx.get(p.ref);
        if (!s.exists || s.data().status !== 'pending') return;
        const precheck = { verdict: p.comp.ok ? (p.dup.verdict === 'ok' ? 'ok' : p.dup.verdict) : 'incomplete', reasons: [...p.comp.problems, ...(p.dup.reason ? [p.dup.reason] : [])] };
        if (p.entscheidung === 'freigeben') {
          tx.update(p.ref, { status: 'approved', reviewedAt: FieldValue.serverTimestamp(), reviewedBy: ENTSCHEIDER, updatedAt: FieldValue.serverTimestamp(), review: { precheck, decidedBy: ENTSCHEIDER, forced: false, bildAudit: true }, holdReasons: FieldValue.delete(), rejectReason: FieldValue.delete() });
        } else {
          tx.update(p.ref, { status: 'rejected', rejectReason: p.grund, holdReasons: [...new Set([...(s.data().holdReasons || []), p.grund])], reviewNote: noteFor(p.grund, p.ctx), reviewedAt: FieldValue.serverTimestamp(), reviewedBy: ENTSCHEIDER, updatedAt: FieldValue.serverTimestamp(), review: { precheck, decidedBy: ENTSCHEIDER, reason: p.grund, lockUntil: p.ctx.lockUntil || null } });
        }
      });
    }
  }
  for (const p of plan) {
    if (p.entscheidung === 'freigeben') zahl.freigegeben++;
    else if (p.entscheidung === 'ablehnen') zahl.abgelehnt++;
    else {
      zahl.offen++;
      offenListe.push({ id: p.id, name: String(nameOf(p.x) || '?').slice(0, 60), markt: p.x.marketName || null, grund: p.grund, hinweis: p.auditGrund || p.auditFehler || null });
    }
  }

  const bericht = {
    tag: new Date(start).toISOString().slice(0, 10),
    laufAt: FieldValue.serverTimestamp(),
    dauerSekunden: Math.round((Date.now() - start) / 1000),
    geprueft: pending.length,
    ...zahl,
    nachgelesen: gerettet,
    wartetAufDich: offenListe,
    dryRun,
  };
  if (!dryRun) await db.collection(BERICHTE).doc(bericht.tag).set(bericht, { merge: true });
  logger.info('Fotorunde fertig', { ...zahl, geprueft: pending.length, nachgelesen: gerettet });
  return bericht;
}

module.exports = { taeglicheRunde, EINDEUTIG, noteFor };
