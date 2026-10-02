'use strict';

/**
 * Kontosperre setzen (Entscheidung Patrick 02.10.2026, „Ja, dann sperr die
 * Konten"). Legt cashback_sperren/{uid} an — Regel und Leser: lib/kontoSperre.js.
 *
 * STANDARD IST DER TROCKENLAUF: liest nur und zeigt, was geschrieben würde.
 * Geschrieben wird ausschließlich mit SCHREIBEN=1.
 *
 *   cd cloud-functions/cashback-pipeline
 *   node .konto-sperre-0210.js              # Trockenlauf
 *   SCHREIBEN=1 node .konto-sperre-0210.js  # Sperren anlegen
 *
 * Anmeldung über die ADC des Nutzerkontos (siehe CLAUDE.md, „Admin-SDK lokal"),
 * für die Leser-Prüfung zusätzlich `gcloud` (nur lesend).
 *
 * - Legt nur an, überschreibt nie (`create`): eine vorhandene Sperre — auch
 *   eine aufgehobene mit `gesperrt: false` — bleibt, wie sie ist.
 * - Bucht nichts zurück, storniert nichts, ändert kein Guthaben.
 * - Aufheben: `gesperrt: false` setzen (Historie bleibt) oder Dokument löschen.
 *
 * ═══ Erst die Leser, dann die Sperre (Prüfrunde 02.10.2026) ═══
 *
 * Eine Sperre ohne Leser ist ein Versprechen, das niemand einlöst. Das Skript
 * holt deshalb den AUSGEROLLTEN Quelltext jedes Lesers (gcloud functions
 * describe → Quell-Zip) und sucht dort `cashback_sperren`:
 *  - Geld-Leser (Bons, Auszahlung, Produktfoto-Gutschrift) fehlen → es wird
 *    NICHT geschrieben. Die Sperre wäre wirkungslos und sähe trotzdem aus,
 *    als gälte sie.
 *  - Freigabe-Leser (Morgenrunde, Prüfkonsole) fehlen → es wird nicht
 *    geschrieben, außer mit OHNE_FREIGABE_LESER=1. Ohne sie gibt die
 *    Morgenrunde Fotos gesperrter Konten frei; gebucht wird nichts, die App
 *    meldet aber „die Vergütung liegt in deinem Cashback-Guthaben".
 *  - Umfrage-Leser fehlt → nur Hinweis: Umfrage-Taler eines gesperrten Kontos
 *    lassen sich nicht auszahlen.
 * Gelingt die Prüfung selbst nicht (gcloud fehlt, keine Rechte), wird nicht
 * geschrieben.
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const admin = require('firebase-admin');
const { sperreRef, istGesperrt, SPERREN_SAMMLUNG } = require('./lib/kontoSperre');

const PROJEKT = 'markendetektive-895f7';
admin.initializeApp({ projectId: PROJEKT });
const db = admin.firestore();

const QUELLE = 'Entscheidung Patrick 02.10.2026';
const KONTEN = [
  {
    uid: '7onx0TmhFzYG4EttySlO14F73ZB3',
    grund: 'Produktfotos zu Hause, ein Produkt für alle Märkte, falsche EANs; vermutlich dieselbe Person wie tU89tZHxvcOOPLHvOFXna0sZREv1',
  },
  {
    uid: 'tU89tZHxvcOOPLHvOFXna0sZREv1',
    grund: 'Produktfotos zu Hause, ein Produkt für alle Märkte, falsche EANs; vermutlich dieselbe Person wie 7onx0TmhFzYG4EttySlO14F73ZB3',
  },
];

/** art: 'geld' = Pflicht; 'freigabe' = Pflicht außer OHNE_FREIGABE_LESER=1; 'hinweis' = nur Hinweis. */
const LESER = [
  { fn: 'processCashback', region: 'europe-west3', codebase: 'cashback-pipeline', wozu: 'Bon-Gutschrift', art: 'geld' },
  { fn: 'resolveCashbackReview', region: 'europe-west3', codebase: 'cashback-pipeline', wozu: 'Bon-Freigabe (Konsole, Bon-Runde)', art: 'geld' },
  { fn: 'requestPayout', region: 'europe-west3', codebase: 'cashback-pipeline', wozu: 'Auszahlung anfragen', art: 'geld' },
  { fn: 'processPayout', region: 'europe-west3', codebase: 'cashback-pipeline', wozu: 'Auszahlung ausführen', art: 'geld' },
  { fn: 'onCrowdUploadApproved', region: 'europe-west1', codebase: 'crowd-upload-reward', wozu: 'Produktfoto-Gutschrift', art: 'geld' },
  { fn: 'fotoRundeTaeglich', region: 'europe-west1', codebase: 'review-console', wozu: 'Morgenrunde (Freigabe)', art: 'freigabe' },
  { fn: 'reviewDecideUploads', region: 'europe-west1', codebase: 'review-console', wozu: 'Prüfkonsole (Freigabe)', art: 'freigabe' },
  { fn: 'onPollResponseCreated', region: 'europe-west3', codebase: 'survey-reward', wozu: 'Umfrage-Gutschrift', art: 'hinweis' },
];

/**
 * Liest den ausgerollten Quelltext einer Funktion und sucht die Sammlung.
 * @returns {{ liest: boolean|null, fehler?: string }} null = nicht prüfbar
 */
function leserLive({ fn, region }) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sperre-leser-'));
  try {
    const ort = execFileSync('gcloud', [
      'functions', 'describe', fn, `--region=${region}`, '--gen2', `--project=${PROJEKT}`,
      '--format=value(buildConfig.source.storageSource.bucket,buildConfig.source.storageSource.object)',
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const [bucket, objekt] = ort.split(/\s+/);
    if (!bucket || !objekt) return { liest: null, fehler: 'kein Quellort' };
    const zip = path.join(tmp, 'quelle.zip');
    execFileSync('gcloud', ['storage', 'cp', `gs://${bucket}/${objekt}`, zip, '--quiet'], { stdio: 'ignore' });
    const js = execFileSync('unzip', ['-p', zip, '*.js', '-x', 'node_modules/*'], {
      encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'],
    });
    return { liest: js.includes(SPERREN_SAMMLUNG) };
  } catch (e) {
    return { liest: null, fehler: String(e.message).split('\n')[0].slice(0, 160) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

function leserPruefen() {
  console.log('Leser der Sperre im ausgerollten Code:');
  const ergebnis = LESER.map((l) => ({ ...l, ...leserLive(l) }));
  for (const l of ergebnis) {
    const zustand = l.liest === true ? 'liest' : l.liest === false ? 'LIEST NICHT' : `NICHT PRÜFBAR (${l.fehler})`;
    console.log(`  ${l.codebase.padEnd(20)} ${l.fn.padEnd(22)} ${zustand.padEnd(12)} ${l.wozu}`);
  }
  const fehlt = (art) => ergebnis.filter((l) => l.art === art && l.liest !== true);
  const geld = fehlt('geld');
  const freigabe = fehlt('freigabe');
  const hinweis = fehlt('hinweis');
  const gruende = [];
  if (geld.length) {
    gruende.push(`Geld-Leser fehlen (${geld.map((l) => l.fn).join(', ')}) — die Sperre wäre wirkungslos. Erst ${[...new Set(geld.map((l) => l.codebase))].join(' + ')} ausrollen.`);
  }
  if (freigabe.length && process.env.OHNE_FREIGABE_LESER !== '1') {
    gruende.push(`Freigabe-Leser fehlen (${freigabe.map((l) => l.fn).join(', ')}) — die Morgenrunde gäbe Fotos gesperrter Konten frei und die App meldete eine Vergütung, die nicht kommt. Erst review-console (Teil A) ausrollen oder bewusst OHNE_FREIGABE_LESER=1 setzen.`);
  }
  if (hinweis.length) {
    console.log('  Hinweis: survey-reward liest die Sperre noch nicht — Umfrage-Taler eines gesperrten Kontos bleiben über die Auszahlungssperre eingefroren.');
  }
  return gruende;
}

(async () => {
  const schreiben = process.env.SCHREIBEN === '1';
  console.log(schreiben ? 'SCHREIBEN — Sperren werden angelegt' : 'TROCKENLAUF — es wird nichts geschrieben');
  const hindernisse = leserPruefen();
  if (hindernisse.length) {
    console.log('\nSo darf die Sperre NICHT angelegt werden:');
    for (const h of hindernisse) console.log(`  - ${h}`);
  }
  let fehler = 0;
  for (const { uid, grund } of KONTEN) {
    const ref = sperreRef(db, uid);
    const [sperre, nutzer, offeneAuszahlungen] = await Promise.all([
      ref.get(),
      db.doc(`users/${uid}`).get(),
      db.collection('cashback_payouts').where('userId', '==', uid).where('status', '==', 'requested').get(),
    ]);
    const u = nutzer.data() || {};
    console.log(`\n${uid}`);
    console.log(`  Guthaben ${u.cashback_balance_cents ?? 0} ct (bleibt stehen, wird eingefroren), Lebenszeit ${u.cashback_lifetime_cents ?? 0} ct`);
    console.log(`  offene Auszahlungsanfragen: ${offeneAuszahlungen.size}${offeneAuszahlungen.size ? ' → processPayout hält sie an und bucht zurück, sofern noch nicht bestellt' : ''}`);
    if (sperre.exists) {
      console.log(`  Sperre vorhanden (wirksam: ${istGesperrt(sperre)}) — wird NICHT überschrieben`);
      continue;
    }
    const daten = { gesperrt: true, seit: admin.firestore.FieldValue.serverTimestamp(), grund, quelle: QUELLE };
    if (!schreiben || hindernisse.length) {
      console.log(`  ${hindernisse.length ? 'würde — sobald die Leser live sind — anlegen' : 'würde anlegen'}:`, { ...daten, seit: '<Serverzeit>' });
      continue;
    }
    try {
      await ref.create(daten);
      console.log('  angelegt');
    } catch (e) {
      fehler += 1;
      console.error('  FEHLER:', e.message);
    }
  }
  if (schreiben && hindernisse.length) {
    console.error('\nNICHTS geschrieben (siehe oben).');
    process.exit(2);
  }
  process.exit(fehler ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
