// Sorgfältige Prüfung aller offenen Produktfoto-Einreichungen (07.09.2026).
// Schreibt NICHTS — liefert nur ein Urteil je Fall als JSON. Entschieden wird
// danach in einem eigenen Schritt.
//
//   node .pruefe-offene.js            → alle pending
//   LIMIT=20 node .pruefe-offene.js   → Probelauf
//
// Geprüft wird (in dieser Reihenfolge, erster harter Fehler entscheidet):
//   1. Vollständigkeit  — alle 7 Fotos im Doc UND in Storage vorhanden/lesbar
//   2. EAN              — 8–14 Ziffern
//   3. Produktname      — vom Nutzer oder aus der Namens-OCR
//   4. Bild-Recycling   — md5 eines Fotos taucht in einer ANDEREN Einreichung auf
//   5. Doppel-Regel     — 30 Tage, außer andere Daten (dasselbe Modul wie die Konsole)
//   6. Ortsanforderung  — dasselbe Gate wie die Vergütung
//   7. Sichtprüfung     — Gemini sieht Front + EAN + Preis: gehört das zusammen,
//                         ist es ein echtes Produktfoto aus einem Laden?
'use strict';
const fs = require('fs');
const admin = require('firebase-admin');
const { GoogleGenAI, Type } = require('@google/genai');

admin.initializeApp({ projectId: 'markendetektive-895f7', storageBucket: 'markendetektive-895f7.appspot.com' });
const db = admin.firestore();
const bucket = admin.storage().bucket();
const ai = new GoogleGenAI({ vertexai: true, project: 'markendetektive-895f7', location: 'global' });

const { evaluateDuplicate } = require('../review-console/src/duplicatePolicy');
const { pruefeOrtsanforderung } = require('../crowd-upload-reward/src/locationGate');

const STEPS = ['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten', 'preis'];
const LIMIT = Number(process.env.LIMIT || 0);
const OUT = process.env.OUT || '.pruefe-offene.result.json';

const VISION_SCHEMA = {
  type: Type.OBJECT,
  properties: {
    echtesProdukt: { type: Type.BOOLEAN },
    gleichesProdukt: { type: Type.BOOLEAN },
    imLaden: { type: Type.BOOLEAN },
    produktname: { type: Type.STRING },
    grund: { type: Type.STRING },
  },
  required: ['echtesProdukt', 'gleichesProdukt', 'imLaden', 'produktname', 'grund'],
};
const VISION_PROMPT = [
  'Du prüfst eine Produkt-Einreichung. Du siehst nacheinander: die Produktvorderseite,',
  'das Barcode-Foto und das Preis-Bild derselben Einreichung.',
  'echtesProdukt: zeigen die Bilder ein echtes, gekauftes/im Regal stehendes Lebensmittel- oder',
  '  Drogerieprodukt (kein Bildschirmfoto, kein Katalogbild, kein Screenshot einer Webseite)?',
  'gleichesProdukt: gehören Vorderseite und Barcode-Foto zum SELBEN Artikel?',
  'imLaden: wirkt die Aufnahme wie im Geschäft oder zuhause am Produkt gemacht (nicht abfotografierter Bildschirm)?',
  'produktname: der Name laut Vorderseite, so wie ein Kunde ihn nennen würde.',
  'grund: max. 12 Wörter, warum du so urteilst.',
  'Im Zweifel für die Einreichung entscheiden — nur klare Verstöße als false markieren.',
].join('\n');

async function md5Of(path) {
  try {
    const [md] = await bucket.file(path).getMetadata();
    return { md5: md.md5Hash || null, size: Number(md.size) || 0, type: md.contentType || null };
  } catch (e) {
    return null;
  }
}
async function imagePart(path) {
  try {
    const [buf] = await bucket.file(path).download();
    if (!buf || buf.length < 2000) return null;
    return { inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } };
  } catch (e) {
    return null;
  }
}

(async () => {
  const alle = (await db.collection('crowd_uploads').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  const pol = (r) => ({
    id: r.id, userId: r.userId ?? null, ean: r.ean ?? null, marketId: r.marketId ?? null,
    status: r.status ?? null, createdAt: r.createdAt, priceOcr: r.priceOcr ?? null, manufacturerOcr: r.manufacturerOcr ?? null,
  });
  const byEan = new Map();
  alle.forEach((r) => { if (r.ean) { if (!byEan.has(r.ean)) byEan.set(r.ean, []); byEan.get(r.ean).push(pol(r)); } });

  let offen = alle.filter((r) => r.status === 'pending').sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
  if (LIMIT) offen = offen.slice(0, LIMIT);
  console.log(`Zu prüfen: ${offen.length} offene Einreichungen (von ${alle.length} gesamt)`);

  // md5-Index über ALLE Einreichungen aufbauen, damit Bild-Recycling auch gegen
  // bereits entschiedene Fälle auffällt. Nur die Fotos der offenen Fälle + der
  // Fälle desselben Nutzers werden gelesen (sonst zu teuer).
  const relevanteUser = new Set(offen.map((r) => r.userId));
  const md5Index = new Map(); // md5 → [uploadId]
  const md5Von = new Map(); // uploadId → [{step, md5}]
  const kandidaten = alle.filter((r) => relevanteUser.has(r.userId));
  console.log(`md5-Index über ${kandidaten.length} Einreichungen derselben Nutzer …`);
  let n = 0;
  for (const r of kandidaten) {
    const list = [];
    for (const s of STEPS) {
      const p = r.images && r.images[s];
      if (!p) continue;
      const m = await md5Of(p);
      if (m && m.md5) {
        list.push({ step: s, md5: m.md5, size: m.size });
        if (!md5Index.has(m.md5)) md5Index.set(m.md5, []);
        md5Index.get(m.md5).push(r.id);
      }
    }
    md5Von.set(r.id, list);
    if (++n % 50 === 0) console.log(`  … ${n}/${kandidaten.length}`);
  }

  const results = [];
  let i = 0;
  for (const r of offen) {
    const befund = { id: r.id, userId: r.userId, ean: r.ean ?? null, name: r.productName || r.productNameOcr || null, markt: r.marketName || r.marketId || null, createdAt: r.createdAt?.toMillis?.() ?? null, campaignId: r.campaignId ?? null, gruende: [], hinweise: [] };

    // 1) Vollständigkeit
    const fehlend = STEPS.filter((s) => !(r.images && r.images[s]));
    const meine = md5Von.get(r.id) || [];
    const kaputt = STEPS.filter((s) => r.images && r.images[s] && !meine.find((m) => m.step === s));
    if (fehlend.length) befund.gruende.push('unvollstaendig');
    if (kaputt.length) befund.gruende.push('bild_defekt');
    befund.fehlend = fehlend; befund.kaputt = kaputt;

    // 2) EAN, 3) Name
    const ean = String(r.ean || '').replace(/\D/g, '');
    if (!(ean.length >= 8 && ean.length <= 14)) befund.gruende.push('ean_fehlt');
    if (!String(r.productName || r.productNameOcr || '').trim()) befund.gruende.push('kein_produktname');

    // 4) Bild-Recycling
    const fremd = meine.filter((m) => (md5Index.get(m.md5) || []).some((id) => id !== r.id));
    if (fremd.length) {
      befund.gruende.push('bilder_wiederverwendet');
      befund.recycling = fremd.map((m) => ({ step: m.step, auchIn: (md5Index.get(m.md5) || []).filter((id) => id !== r.id).slice(0, 3) }));
    }

    // 5) Doppel-Regel
    const dup = r.ean ? evaluateDuplicate(pol(r), (byEan.get(r.ean) || []).filter((x) => x.id !== r.id)) : { verdict: 'ok' };
    befund.dup = { verdict: dup.verdict, reason: dup.reason ?? null, priorId: dup.priorId ?? null, sameUser: dup.sameUser ?? null, updatedFields: dup.updatedFields ?? [] };
    if (dup.verdict === 'locked') befund.gruende.push(dup.reason);
    if (dup.verdict === 'hold') befund.hinweise.push('aeltere_offene_einreichung');

    // 6) Ortsanforderung (entscheidet über Geld, nicht über Annahme)
    const ort = pruefeOrtsanforderung(r);
    befund.ort = { ok: ort.ok, grund: ort.grund ?? null };
    if (!ort.ok) befund.hinweise.push('ohne_ort_keine_verguetung');

    // 7) Sichtprüfung — nur wenn die harten Kriterien halten (spart Aufrufe)
    if (!befund.gruende.length) {
      const parts = [{ text: VISION_PROMPT }];
      for (const s of ['front', 'ean', 'preis']) {
        const p = r.images && r.images[s];
        if (!p) continue;
        const part = await imagePart(p);
        if (part) parts.push({ text: `Bild „${s}":` }, part);
      }
      if (parts.length > 1) {
        try {
          const res = await ai.models.generateContent({
            model: 'gemini-3.5-flash',
            contents: [{ role: 'user', parts }],
            config: { responseMimeType: 'application/json', responseSchema: VISION_SCHEMA, temperature: 0.1, thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 300 },
          });
          const v = JSON.parse(res.text);
          befund.vision = v;
          if (v.echtesProdukt === false || v.imLaden === false) befund.gruende.push('fotos_unpassend');
          else if (v.gleichesProdukt === false) befund.gruende.push('fotos_unpassend');
        } catch (e) {
          befund.vision = { fehler: String(e.message).slice(0, 120) };
          befund.hinweise.push('sichtpruefung_fehlgeschlagen');
        }
      }
    }

    befund.urteil = befund.gruende.length ? 'ablehnen' : 'freigeben';
    results.push(befund);
    if (++i % 20 === 0) {
      fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
      const f = results.filter((x) => x.urteil === 'freigeben').length;
      console.log(`  ${i}/${offen.length} — freigeben ${f}, ablehnen ${i - f}`);
    }
  }
  fs.writeFileSync(OUT, JSON.stringify(results, null, 1));
  const frei = results.filter((x) => x.urteil === 'freigeben');
  const ab = results.filter((x) => x.urteil === 'ablehnen');
  const gr = {};
  ab.forEach((x) => x.gruende.forEach((g) => { gr[g] = (gr[g] || 0) + 1; }));
  console.log(`\nFERTIG: ${results.length} geprüft — freigeben ${frei.length}, ablehnen ${ab.length}`);
  console.log('Ablehngründe:', JSON.stringify(gr, null, 0));
  console.log('Ohne Ortsangabe (Annahme ja, Vergütung nein):', results.filter((x) => !x.ort.ok).length);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
