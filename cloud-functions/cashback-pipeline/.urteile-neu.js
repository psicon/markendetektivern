// Rechnet die Urteile aus .pruefe-offene.result.json mit KORRIGIERTEN Regeln neu.
// Kein neuer Modell-Aufruf — die Befunde liegen vor.
//
// Korrektur 1: „zuhause fotografiert" ist KEIN Mangel. Die App verlangt nirgends
//   eine Aufnahme im Laden. Ablehnung nur, wenn das Bild kein echtes Produkt
//   zeigt (Screenshot, Katalogbild) oder Vorderseite und Barcode nicht
//   zusammengehören.
// Korrektur 2: Ein geteiltes PREIS-Bild ist normal — ein Kassenbon trägt
//   mehrere Produkte, und genau dafür darf er als Preisbeleg dienen. Verdächtig
//   ist nur ein geteiltes PRODUKT-Foto (Vorderseite, Rückseite, Hersteller,
//   Barcode, Nährwerte, Zutaten).
// Korrektur 3: Teilen sich zwei Einreichungen DESSELBEN Nutzers zur SELBEN EAN
//   die Fotos, ist das kein Recycling, sondern eine doppelt abgeschickte
//   Einreichung (gesehen: zwei Sendungen 8 Sekunden auseinander). Dann gilt die
//   Doppel-Regel: die frühere zählt, die spätere wird abgelehnt — nicht beide.
'use strict';
const fs = require('fs');
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
const r = JSON.parse(fs.readFileSync('.pruefe-offene.result.json', 'utf8'));
const PRODUKT_SCHRITTE = new Set(['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten']);

(async () => {
// Gegen-Einreichungen laden, um „andere EAN / anderer Nutzer" zu erkennen.
const fremdIds = [...new Set(r.flatMap((x) => (x.recycling || []).flatMap((e) => e.auchIn)))];
const fremd = new Map();
for (let i = 0; i < fremdIds.length; i += 30) {
  const snaps = await db.getAll(...fremdIds.slice(i, i + 30).map((id) => db.collection('crowd_uploads').doc(id)));
  snaps.forEach((s) => { if (s.exists) fremd.set(s.id, { userId: s.data().userId ?? null, ean: s.data().ean ?? null }); });
}

for (const x of r) {
  const g = new Set(x.gruende);
  const v = x.vision || {};

  g.delete('fotos_unpassend');
  if (v.echtesProdukt === false) g.add('fotos_unpassend');
  else if (v.gleichesProdukt === false) g.add('fotos_unpassend');

  const echt = (x.recycling || [])
    .filter((e) => PRODUKT_SCHRITTE.has(e.step))
    .map((e) => ({ ...e, fremdeQuelle: e.auchIn.filter((id) => {
      const f = fremd.get(id);
      return !f || f.userId !== x.userId || f.ean !== x.ean; // andere Person oder anderes Produkt
    }) }))
    .filter((e) => e.fremdeQuelle.length);
  g.delete('bilder_wiederverwendet');
  if (echt.length) { g.add('bilder_wiederverwendet'); x.recyclingProdukt = echt; }
  else if ((x.recycling || []).length) x.hinweise = [...new Set([...(x.hinweise || []), 'preisbeleg_mehrfach_genutzt'])];

  // Doppelt abgeschickt: die frühere Einreichung zählt.
  if (x.dup && x.dup.verdict === 'hold' && x.dup.reason) g.add(x.dup.reason);

  x.gruende = [...g];
  x.urteil = x.gruende.length ? 'ablehnen' : 'freigeben';
}
fs.writeFileSync('.urteile-fotos.json', JSON.stringify(r, null, 1));
const frei = r.filter((x) => x.urteil === 'freigeben');
const ab = r.filter((x) => x.urteil === 'ablehnen');
const zaehl = {};
ab.forEach((x) => x.gruende.forEach((k) => { zaehl[k] = (zaehl[k] || 0) + 1; }));
console.log(`${r.length} geprüft — freigeben ${frei.length}, ablehnen ${ab.length}`);
console.log('Ablehngründe:', JSON.stringify(zaehl));
console.log('Preisbeleg mehrfach (ok, nur Hinweis):', r.filter((x) => (x.hinweise || []).includes('preisbeleg_mehrfach_genutzt')).length);
console.log('\nAlle Ablehnungen:');
ab.forEach((x) => console.log(`  ${x.id} | ${String(x.name).slice(0, 32).padEnd(32)} | ${JSON.stringify(x.gruende)} | ${(x.vision || {}).grund || ''}`.slice(0, 190)));
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
