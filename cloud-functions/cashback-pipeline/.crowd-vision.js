'use strict';
/** Vision-Audit der freigabe-kandidierten crowd_uploads (86ca33pum-Runde).
 *  Pro Doc EIN Gemini-Call (Vertex, gs://-URIs, kein Download): eindeutig
 *  unechte Einreichungen aussortieren. Konservativ: nur klarer Ausschluss
 *  zählt; Infrastrukturfehler = "ungeprüft", NIE ein Inhaltsurteil. */
const fs = require('fs');
const { GoogleGenAI } = require('@google/genai');

const IN = process.env.ROWS_JSON;
const OUT = process.env.VERDICTS_JSON;
const BUCKET = 'markendetektive-895f7.appspot.com';
const ai = new GoogleGenAI({ vertexai: true, project: 'markendetektive-895f7', location: 'global' });

const SLOTS = ['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten', 'preis'];

async function checkDoc(r, imagesByKey) {
  const parts = [];
  for (const k of SLOTS) {
    const p = imagesByKey[k];
    if (!p) continue;
    parts.push({ text: `— Slot "${k}":` });
    parts.push({ fileData: { fileUri: `gs://${BUCKET}/${p}`, mimeType: 'image/jpeg' } });
  }
  parts.push({
    text:
      `Du prüfst eine Crowd-Produkt-Einreichung (7 Fotos, Slots oben benannt) auf Echtheit.\n` +
      `Erwartet: echtes Einzelhandels-Produkt "${r.name}" (EAN ${r.ean}).\n` +
      `Slot-Erwartungen: front=Produktvorderseite, rueckseite=Verpackungsrückseite, ` +
      `hersteller=Hersteller-/Adressangabe, ean=Barcode, naehrwerte=Nährwerttabelle, ` +
      `zutaten=Zutatenliste, preis=Preisschild/Regal.\n` +
      `Antworte NUR mit JSON: {"echt": true|false, "grund": "kurz"}.\n` +
      `echt=false NUR bei EINDEUTIGEM Ausschluss: kein reales Produkt zu sehen, ` +
      `abfotografierter Bildschirm, offensichtlich unsinnige/fremde Motive, oder ` +
      `Slots grob falsch belegt. Unscharf/suboptimal/teilweise abgeschnitten = trotzdem echt=true. ` +
      `Leichte Slot-Vertauschungen (z.B. zutaten und naehrwerte getauscht) = echt=true.`,
  });
  const resp = await ai.models.generateContent({
    model: 'gemini-3.5-flash',
    contents: [{ role: 'user', parts }],
    config: { responseMimeType: 'application/json', temperature: 0 },
  });
  const raw = resp.text ?? resp.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') ?? '';
  const parsed = JSON.parse(String(raw).replace(/^```json\s*|```\s*$/g, ''));
  return { echt: parsed.echt !== false, grund: String(parsed.grund || '').slice(0, 140) };
}

async function lauf() {
  const { rows } = JSON.parse(fs.readFileSync(IN, 'utf8'));
  // Kandidaten = Signal-Checks bestanden (gleiche Logik wie Analyse-Skript)
  const kandidaten = rows.filter(
    (r) => !r.missing.length && !r.broken.length && r.eanOk && r.name && !r.dupApproved && !r.dupPending && !r.md5dup,
  );
  console.log(`Vision-Audit über ${kandidaten.length} Kandidaten`);
  const verdicts = {};
  let done = 0, unecht = 0, fehler = 0;
  const queue = [...kandidaten];
  async function worker() {
    for (;;) {
      const r = queue.shift();
      if (!r) return;
      const imagesByKey = {};
      // rows tragen md5s mit Pfaden? Nein — Pfade neu aus Firestore? Wir haben
      // sie nicht im JSON → aus dem Doc lesen wäre ein Read/Doc. Stattdessen:
      // die Analyse legte md5s als {k} ab; Pfade fehlen → per Firestore holen.
      const admin = require('firebase-admin');
      if (!admin.apps.length) admin.initializeApp({ projectId: 'markendetektive-895f7' });
      const snap = await admin.firestore().doc(`crowd_uploads/${r.id}`).get();
      const images = snap.data()?.images || {};
      Object.entries(images).forEach(([k, p]) => { imagesByKey[k] = String(p); });
      let v;
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          v = await checkDoc(r, imagesByKey);
          break;
        } catch (e) {
          if (attempt === 1) v = { echt: null, grund: `pruefung_fehlgeschlagen: ${String(e.message).slice(0, 80)}` };
          else await new Promise((res) => setTimeout(res, 2000));
        }
      }
      verdicts[r.id] = v;
      if (v.echt === false) { unecht++; console.log(`  UNECHT ${r.id} | ${r.name.slice(0, 30)} | ${v.grund}`); }
      if (v.echt === null) fehler++;
      done++;
      if (done % 50 === 0) console.log(`  … ${done}/${kandidaten.length} (unecht: ${unecht}, fehler: ${fehler})`);
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker));
  fs.writeFileSync(OUT, JSON.stringify(verdicts));
  console.log(`\nFertig: ${done} geprüft | echt=false: ${unecht} | ungeprüft (Fehler): ${fehler}`);
  process.exit(0);
}
lauf().catch((e) => { console.error('ABBRUCH', e); process.exit(1); });
