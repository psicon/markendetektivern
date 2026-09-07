// Gezielte Nachprüfung der 6 verdächtigen Bons. Der erste Durchgang scheiterte
// systematisch am Jahr: das Modell hält 2026 für die Zukunft und ersetzt es
// (2020/2023) oder meldet deshalb „manipuliert". Darum hier: heutiges Datum im
// Prompt nennen, Tag/Monat getrennt abfragen, und explizit nach dem BELEGTYP
// fragen. Schreibt nichts.
'use strict';
const fs = require('fs');
const admin = require('firebase-admin');
const { GoogleGenAI, Type } = require('@google/genai');
admin.initializeApp({ projectId: 'markendetektive-895f7', storageBucket: 'markendetektive-895f7.appspot.com' });
const db = admin.firestore();
const bucket = admin.storage().bucket();
const ai = new GoogleGenAI({ vertexai: true, project: 'markendetektive-895f7', location: 'global' });

const IDS = process.argv.slice(2);
const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    belegtyp: { type: Type.STRING },   // papierbon | digitaler_beleg_screenshot | rechnung | kein_beleg
    tag: { type: Type.INTEGER },
    monat: { type: Type.INTEGER },
    jahrText: { type: Type.STRING },   // wörtlich abgetippt, nicht interpretiert
    endsummeCent: { type: Type.INTEGER },
    bearbeitungsspuren: { type: Type.BOOLEAN },
    spurenBeschreibung: { type: Type.STRING },
  },
  required: ['belegtyp', 'tag', 'monat', 'jahrText', 'endsummeCent', 'bearbeitungsspuren', 'spurenBeschreibung'],
};
const PROMPT = [
  'Heute ist der 07.09.2026. Belege aus dem September 2026 sind also aktuell und völlig normal.',
  'Tippe ab, was auf diesem Beleg steht — interpretiere nichts, korrigiere nichts.',
  'belegtyp: „papierbon" (abfotografierter Kassenzettel), „digitaler_beleg_screenshot"',
  '  (Bildschirmfoto eines digitalen Kassenbelegs aus einer Händler-App),',
  '  „rechnung" (Rechnung/Lieferschein) oder „kein_beleg".',
  'tag / monat: Kaufdatum als Zahlen. jahrText: die Jahreszahl WÖRTLICH wie gedruckt.',
  'endsummeCent: die gedruckte Endsumme in Cent. Rechne nichts nach.',
  'bearbeitungsspuren: NUR echte Bildbearbeitung (retuschierte Stellen, montierte Teile,',
  '  inkonsistente Schrift). Ein Datum in der Zukunft ist KEINE Bearbeitungsspur.',
  'spurenBeschreibung: max. 15 Wörter.',
].join('\n');

(async () => {
  const out = [];
  for (const id of IDS) {
    const d = await db.collection('receipts').doc(id).get();
    const x = d.data();
    const [buf] = await bucket.file(x.storage.path).download();
    const res = await ai.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: [{ role: 'user', parts: [{ text: PROMPT }, { inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } }] }],
      config: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0, maxOutputTokens: 4000 },
    });
    const v = JSON.parse(res.text || '{}');
    const gespeichert = { datum: x.bonDate, total: x.totalCents ?? x.ocr?.parsed?.totalCents ?? null, recon: x.ocr?.reconciliation?.ok };
    const [jj, mm, tt] = String(gespeichert.datum || '--').split('-').map(Number);
    const r = {
      id, markt: x.merchant?.name ?? null, gespeichert, gelesen: v,
      tagMonatGleich: v.tag === tt && v.monat === mm,
      summeGleich: v.endsummeCent === gespeichert.total,
    };
    out.push(r);
    console.log(`${id} ${r.markt}`);
    console.log(`   Typ ${v.belegtyp} | gelesen ${String(v.tag).padStart(2, '0')}.${String(v.monat).padStart(2, '0')}.${v.jahrText} vs gespeichert ${gespeichert.datum} → Tag/Monat ${r.tagMonatGleich ? 'gleich' : 'ABWEICHEND'}`);
    console.log(`   Summe ${(v.endsummeCent / 100).toFixed(2)}€ vs ${(gespeichert.total / 100).toFixed(2)}€ (Positionssumme geprüft: ${gespeichert.recon}) → ${r.summeGleich ? 'gleich' : 'ABWEICHEND'}`);
    console.log(`   Bearbeitungsspuren: ${v.bearbeitungsspuren} — „${v.spurenBeschreibung}"\n`);
  }
  fs.writeFileSync('.bons-nachpruefung.json', JSON.stringify(out, null, 1));
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
