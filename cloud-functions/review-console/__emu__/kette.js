'use strict';
/**
 * Ende-zu-Ende im Emulator (Firestore + Auth + Functions + Tasks): Trigger
 * `fotoSchattenAusloeser` → Cloud-Tasks-Auftrag → Arbeiter `fotoSchattenPruefen`
 * → `crowd_live_schatten/{id}`. Das Konto ist frisch angelegt (Betrugsschutz
 * „neues Konto“), damit KEIN Modellaufruf stattfindet — geprüft wird die
 * Verdrahtung, nicht die Regeln (die prüfen __tests__ und liveSchatten.emu.test.js).
 *
 *   cd cloud-functions/review-console/__emu__ && \
 *   PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH" npx firebase-tools@15.15.0 \
 *     emulators:exec --only firestore,auth,functions,tasks --project demo-schatten \
 *     --config firebase.kette.json "node kette.js"
 */
if (!process.env.FIRESTORE_EMULATOR_HOST || !String(process.env.GCLOUD_PROJECT || '').startsWith('demo-')) throw new Error('Nur im Emulator mit demo-Projekt');
const admin = require('firebase-admin');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');
admin.initializeApp({ projectId: process.env.GCLOUD_PROJECT });
const db = admin.firestore();
const schlafe = (t) => new Promise((r) => setTimeout(r, t));

async function warteAuf(pfad, bedingung, ms = 60000) {
  const bis = Date.now() + ms;
  while (Date.now() < bis) {
    const s = await db.doc(pfad).get();
    if (s.exists && bedingung(s.data())) return s.data();
    await schlafe(500);
  }
  return null;
}

(async () => {
  await db.doc('cashback_config/v1').set({ fotoLive: 'shadow', fotoLiveAnteil: 1, fotoWorker: false });
  await admin.auth().createUser({ uid: 'u1' });
  const ref = db.doc('crowd_uploads/a');
  await ref.set({ userId: 'u1', ean: '4061464833821', status: 'pending', images: {}, createdAt: FieldValue.serverTimestamp() });
  // Namer: Anspruch, dann Ergebnis (crowd-upload-namer src/ablauf.js).
  await ref.update({ namerNachlesenAb: Timestamp.fromMillis(Date.now() + 20 * 60 * 1000) });
  await schlafe(1500);
  const vorFertig = await db.doc('crowd_live_schatten/a').get();
  await ref.update({ productNameOcr: 'Produkt a', productNameOcrAt: FieldValue.serverTimestamp(), namerNachlesenAb: FieldValue.delete() });
  const vorher = await ref.get();
  const s = await warteAuf('crowd_live_schatten/a', (d) => d.status === 'fertig');
  await schlafe(1500);
  const nachher = await ref.get();
  // Ein späteres Update löst nichts mehr aus.
  await ref.update({ probableLocation: { quelle: 'test' } });
  await schlafe(3000);
  const s2 = (await db.doc('crowd_live_schatten/a').get()).data();
  const ergebnis = {
    vorNamerFertig: vorFertig.exists,
    schatten: s && { status: s.status, ergebnis: s.ergebnis, grund: s.grund, wuerdeMorgenrunde: s.wuerdeMorgenrunde, versuch: s.versuch, auftrag: !!s.auftrag, gesamtMs: s.gesamtMs },
    einreichungUnveraendert: nachher.updateTime.isEqual(vorher.updateTime) && nachher.get('status') === 'pending',
    keinZweiterLauf: !!s2 && s2.lauf === (s && s.lauf),
  };
  console.log('ERGEBNIS', JSON.stringify(ergebnis));
  const ok = !ergebnis.vorNamerFertig && s && s.status === 'fertig' && s.ergebnis === 'betrugsschutz' && s.grund === 'neues_konto' && ergebnis.einreichungUnveraendert && ergebnis.keinZweiterLauf;
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
