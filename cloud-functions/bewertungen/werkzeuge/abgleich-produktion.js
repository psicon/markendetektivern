'use strict';

/**
 * NUR LESEN. Rechnet aus allen heutigen productRatings nach, welche Zähler
 * auf den Produkten stehen müssten, und vergleicht mit dem gespeicherten
 * Stand. Gedacht für die Kontrolle nach einem Deploy von
 * aggregateRatingsByPath: neue Abweichungen = die Funktion rechnet anders.
 *
 *   cd cloud-functions/bewertungen && node werkzeuge/abgleich-produktion.js
 *
 * Braucht ADC des Nutzerkontos (gcloud auth application-default login).
 * Kosten: ein Lesevorgang je Bewertung und je bewertetem Produkt
 * (01.10.2026: 3.375 + 2.508).
 *
 * Exit 0: nur die bekannten Altfälle weichen ab. Exit 1: etwas Neues weicht
 * ab — dann zuerst prüfen, ob gerade eine Bewertung geschrieben wurde
 * (Momentaufnahme zwischen Bewertung und Produkt), und erneut laufen lassen.
 */

if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('FIRESTORE_EMULATOR_HOST ist gesetzt — dieses Werkzeug liest die Produktion. Abbruch.');
  process.exit(2);
}

const admin = require('firebase-admin');

const app = admin.initializeApp({ projectId: 'markendetektive-895f7' }, 'abgleich-nur-lesen');
const db = app.firestore();

const KRITERIEN = ['Overall', 'PriceValue', 'TasteFunction', 'Similarity', 'Content'];
const gueltig = (v) => typeof v === 'number' && v >= 1 && v <= 5;

/**
 * Altfälle, Stand 01.10.2026 (alle vom 10./11.09.2025 oder gelöschte
 * Produkte, keiner durch die Laufzeit verursacht):
 *   abweichend: namenlose produkte-Dokumente mit negativen Zählern
 *   fehlt:      Produkt gelöscht, Bewertungen stehen noch
 *   ohneZiel:   productID zeigt auf markenProdukte (App-Fehler 2025)
 */
const BEKANNT = new Set([
  'abweichend:produkte/AddYjypI4hIghIzS2BHF',
  'abweichend:produkte/1rA8gGsd7m0bmpztuyzj',
  'abweichend:produkte/AUTx75t8RFBVZ9QpBM0b',
  'fehlt:produkte/i1ee1URo3kpj5xsuDIf6',
  'fehlt:produkte/UGMHySSy0LJXZ528KsJU',
  'ohneZiel:osUp0OivfBdZUBLudjiu',
]);

/** Zielauflösung wie im Trigger: productID vor brandProductID. */
function zielVon(r) {
  if (r.productID && r.productID.path) {
    const t = r.productID.path.split('/');
    return t.length >= 2 && t[0] === 'produkte' ? `produkte/${t[1]}` : null;
  }
  if (r.brandProductID && r.brandProductID.path) {
    const t = r.brandProductID.path.split('/');
    return t.length >= 2 && t[0] === 'markenProdukte' ? `markenProdukte/${t[1]}` : null;
  }
  return null;
}

async function main() {
  const bewertungen = await db.collection('productRatings').get();
  const soll = new Map();
  const ohneZiel = [];
  bewertungen.forEach((d) => {
    const r = d.data();
    const ziel = zielVon(r);
    if (!ziel) { ohneZiel.push(d.id); return; }
    if (!soll.has(ziel)) soll.set(ziel, Object.fromEntries(KRITERIEN.map((k) => [k, { n: 0, summe: 0 }])));
    const s = soll.get(ziel);
    for (const k of KRITERIEN) {
      const v = r[`rating${k}`];
      if (gueltig(v)) { s[k].n += 1; s[k].summe += v; }
    }
  });

  const pfade = [...soll.keys()];
  const ist = new Map();
  for (let i = 0; i < pfade.length; i += 300) {
    const docs = await db.getAll(...pfade.slice(i, i + 300).map((p) => db.doc(p)));
    docs.forEach((d) => ist.set(d.ref.path, d.exists ? d.data() : null));
  }

  const funde = [];
  let gleich = 0;
  for (const [pfad, s] of soll) {
    const p = ist.get(pfad);
    if (!p) { funde.push({ art: 'fehlt', schluessel: pfad }); continue; }
    const diffs = [];
    for (const k of KRITERIEN) {
      const avg = s[k].n > 0 ? Math.round((s[k].summe / s[k].n) * 10) / 10 : 0;
      const n = p[`ratingCount${k}`] ?? 0;
      const summe = p[`ratingSum${k}`] ?? 0;
      const schnitt = p[`averageRating${k}`] ?? 0;
      if (n !== s[k].n || Math.abs(summe - s[k].summe) > 1e-9 || Math.abs(schnitt - avg) > 1e-9) {
        diffs.push(`${k}: soll ${s[k].n}/${s[k].summe}/${avg}, ist ${n}/${summe}/${schnitt}`);
      }
    }
    if ((p.ratingCount ?? 0) !== s.Overall.n) diffs.push(`ratingCount: soll ${s.Overall.n}, ist ${p.ratingCount}`);
    if (diffs.length) funde.push({ art: 'abweichend', schluessel: pfad, diffs });
    else gleich += 1;
  }
  ohneZiel.forEach((id) => funde.push({ art: 'ohneZiel', schluessel: id }));

  const neu = funde.filter((f) => !BEKANNT.has(`${f.art}:${f.schluessel}`));
  console.log(`Bewertungen ${bewertungen.size} · bewertete Produkte ${soll.size} · übereinstimmend ${gleich}`);
  console.log(`Abweichungen gesamt ${funde.length}, davon bekannte Altfälle ${funde.length - neu.length}, NEU ${neu.length}`);
  for (const f of neu) console.log('NEU', f.art, f.schluessel, (f.diffs || []).join(' | '));
  await app.delete();
  process.exit(neu.length ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(2); });
