// Rückwirkend: Was zeigt das „Preis"-Foto einer Produkt-Einreichung, und ist es
// ein Kassenbon mit Filialadresse? (Entscheidung 06.09.2026)
//
//   node .backfill-price-image.js              → DRY_RUN (zählt Kandidaten, liest NICHTS bei Gemini)
//   RUN=1 node .backfill-price-image.js        → liest die Bilder und schreibt priceImageKind/priceReceipt
//   RUN=1 LIMIT=50 node .backfill-price-image.js   → nur die ersten 50 (Probelauf)
//
// Kosten: 1 Flash-Call je Bild (nur das Preis-Bild, thinkingBudget 0) —
// an 40 echten Bildern gemessen: 0,00063 $ je Bild, also ~1 $ für den Bestand.
// Idempotent über das Feld `priceImageAt`: ein zweiter Lauf überspringt alles
// Fertige. Der laufende Betrieb macht dasselbe ohne Zusatzkosten im
// crowd-upload-namer (dort steckt es im ohnehin stattfindenden Aufruf).
//
// Schreibt NUR die neuen Felder — productName, productNameOcr, Status und alles
// Geld-Relevante bleiben unangetastet.
'use strict';
const fs = require('fs');
const admin = require('firebase-admin');
const { GoogleGenAI, Type } = require('@google/genai');

admin.initializeApp({ projectId: 'markendetektive-895f7', storageBucket: 'markendetektive-895f7.appspot.com' });
const db = admin.firestore();
const ai = new GoogleGenAI({ vertexai: true, project: 'markendetektive-895f7', location: 'global' });

const RUN = process.env.RUN === '1';
const LIMIT = Number(process.env.LIMIT || 0);
const OUT = process.env.OUT || '.backfill-price-image.result.json';
const KINDS = ['preisschild', 'kassenbon', 'beides', 'produktfoto', 'sonstiges', 'fehlt'];

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    priceImageKind: { type: Type.STRING },
    priceCents: { type: Type.INTEGER },
    receiptMerchant: { type: Type.STRING },
    receiptStreet: { type: Type.STRING },
    receiptZip: { type: Type.STRING },
    receiptCity: { type: Type.STRING },
    receiptDate: { type: Type.STRING },
  },
  required: ['priceImageKind', 'priceCents', 'receiptMerchant', 'receiptStreet', 'receiptZip', 'receiptCity', 'receiptDate'],
};
const PROMPT = [
  'Du siehst das Foto, das ein Nutzer als „Preis" zu einem Supermarkt-Produkt eingereicht hat.',
  'priceImageKind — wähle immer die beste Kategorie: "preisschild" (Regal-Etikett),',
  '"kassenbon" (Kassenzettel, auch schräg oder teilweise), "beides", "produktfoto" (nur',
  'Verpackung, kein Preis), "sonstiges".',
  'priceCents: Produktpreis in Cent (1,99 € → 199) vom Preisschild oder aus der Bon-Zeile;',
  'Grundpreise (€/kg, €/l) NICHT verwenden; nicht lesbar → 0.',
  'Ist es ein KASSENBON (oder "beides"), lies aus dem Bon-KOPF: receiptMerchant (Filialname),',
  'receiptStreet (Straße + Hausnummer), receiptZip (PLZ), receiptCity (Ort), receiptDate',
  '(Kaufdatum ISO YYYY-MM-DD). Nimm die Filialadresse aus dem Kopf, nicht den Firmensitz',
  'aus dem Fußbereich. Nicht lesbar oder kein Bon → leerer String.',
  'Nichts erfinden. Antworte nur mit dem JSON.',
].join('\n');

function parseReceipt(p, kind) {
  if (kind !== 'kassenbon' && kind !== 'beides') return null;
  const zip = String(p.receiptZip || '').replace(/\D/g, '');
  const city = String(p.receiptCity || '').trim().slice(0, 80);
  const street = String(p.receiptStreet || '').trim().slice(0, 120);
  const merchant = String(p.receiptMerchant || '').trim().slice(0, 80);
  const date = /^\d{4}-\d{2}-\d{2}$/.test(String(p.receiptDate || '')) ? p.receiptDate : null;
  if (!(zip || city || street || merchant)) return null;
  const out = {
    merchant: merchant || null,
    street: street || null,
    zip: /^\d{4,5}$/.test(zip) ? zip : null,
    city: city || null,
    bonDate: date,
    source: 'preis-foto',
  };
  out.complete = Boolean(out.zip && out.city);
  return out;
}

(async () => {
  const snap = await db.collection('crowd_uploads')
    .select('images', 'priceImageAt', 'priceImageKind', 'capture', 'status', 'marketName', 'marketId', 'createdAt')
    .get();
  const all = snap.docs.map((d) => ({ id: d.id, ref: d.ref, ...d.data() }));
  const todo = all.filter((r) => r.images && r.images.preis && !r.priceImageAt);
  const st = {
    gesamt: all.length,
    mitPreisbild: all.filter((r) => r.images && r.images.preis).length,
    bereitsGeprueft: all.length - todo.length,
    offen: todo.length,
    gelesen: 0, kassenbon: 0, mitAdresse: 0, ohneOrtsangabe_mitBonAdresse: 0, fehler: 0,
    kinds: {},
  };
  console.log(JSON.stringify({ mode: RUN ? 'RUN' : 'DRY_RUN', ...st }));
  if (!RUN) {
    console.log(`Geschätzte Kosten: $${(todo.length * 0.00063).toFixed(2)} (0,00063 $/Bild, an 40 Bildern gemessen)`);
    process.exit(0);
  }

  const list = LIMIT ? todo.slice(0, LIMIT) : todo;
  const results = [];
  for (const r of list) {
    try {
      const [buf] = await admin.storage().bucket().file(r.images.preis).download();
      const res = await ai.models.generateContent({
        model: 'gemini-3.5-flash',
        contents: [{ role: 'user', parts: [{ text: PROMPT }, { inlineData: { data: buf.toString('base64'), mimeType: 'image/jpeg' } }] }],
        config: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.1, thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 320 },
      });
      const p = JSON.parse(res.text);
      const kind = KINDS.includes(String(p.priceImageKind || '').toLowerCase()) ? String(p.priceImageKind).toLowerCase() : 'unklar';
      const receipt = parseReceipt(p, kind);
      const pc = Number(p.priceCents);
      const price = Number.isFinite(pc) && pc > 0 && pc < 100000 ? Math.round(pc) : null;

      const patch = {
        priceImageKind: kind,
        priceImageAt: admin.firestore.FieldValue.serverTimestamp(),
        priceReceipt: receipt,
      };
      // Preis nur ergänzen, nie überschreiben: der laufende Namer hat Vorrang.
      if (price != null && !r.priceOcr) {
        patch.priceOcr = { priceCents: price, source: kind === 'kassenbon' || kind === 'beides' ? 'bon' : 'preisschild' };
      }
      await r.ref.set(patch, { merge: true });

      st.gelesen++;
      st.kinds[kind] = (st.kinds[kind] || 0) + 1;
      if (receipt) {
        st.kassenbon++;
        if (receipt.complete) st.mitAdresse++;
        const hatOrt = !!(r.capture && (r.capture.confirmedPlace || r.capture.gps));
        if (!hatOrt && receipt.complete) st.ohneOrtsangabe_mitBonAdresse++;
      }
      results.push({ id: r.id, kind, receipt, price });
    } catch (e) {
      st.fehler++;
      results.push({ id: r.id, error: String(e.message).slice(0, 160) });
      console.error('Fehler', r.id, String(e.message).slice(0, 120));
    }
    if (results.length % 25 === 0) {
      fs.writeFileSync(OUT, JSON.stringify({ st, results }, null, 1));
      console.log('progress', JSON.stringify(st));
    }
  }
  fs.writeFileSync(OUT, JSON.stringify({ st, results }, null, 1));
  console.log(JSON.stringify({ mode: 'RUN', ...st }, null, 1));
  process.exit(st.fehler > list.length * 0.2 ? 1 : 0);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
