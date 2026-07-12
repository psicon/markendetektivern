/**
 * Einmal-Backfill: User-Doc-Identität aus Firebase Auth reparieren
 * (ClickUp-Kontext: Platzhalter-/Race-Zustände, Audit 2026-07-12).
 *
 * WAS ES TUT (streng konservativ, fill-only):
 *   1. IDENTITÄT — iteriert ALLE Firebase-Auth-Konten (listUsers, kostenlos)
 *      und patcht users/{uid} NUR wenn dort Platzhalter/Lücken stehen:
 *        • email:        Doc fehlt/leer/Platzhalter  UND Auth hat echte Mail
 *        • display_name: Doc fehlt/leer/Platzhalter  UND Auth hat Namen
 *        • photo_url:    Doc leer                    UND Auth hat Foto
 *      „Auth hat X" = userRecord.X ODER providerData[].X (beim Anon-Link
 *      setzt Firebase displayName/photoURL NICHT auf den User — die Provider-
 *      Daten tragen sie aber).
 *      Zusätzlich: leaderboards/{uid}.displayName wird mitgezogen, wenn dort
 *      ein Platzhalter steht und wir einen echten Namen haben (sonst bliebe
 *      die Bestenliste bis zum nächsten Punkte-Event stale).
 *   2. ERSPARNIS — users mit stats.savingsTotal > 0, deren top-level
 *      totalSavings 0/fehlend ist (der signUp-Reset-Bug): totalSavings :=
 *      stats.savingsTotal. NIEMALS ein totalSavings > 0 anfassen (ambig).
 *
 * WAS ES NIE TUT: echte E-Mails/Namen überschreiben, Felder löschen,
 * anonyme User anfassen (die haben in Auth nichts → kein Patch).
 *
 * SICHERUNG: Jedes gepatchte Doc wird VOR dem Write mit seinen alten
 * Feldwerten in eine Backup-JSONL-Datei geschrieben (Rollback-fähig).
 *
 * AUSFÜHREN (aus diesem Ordner, Service-Account /tmp/sa.json):
 *   DRY_RUN=1 node backfill-user-identity.js   ← zählt + sampelt, schreibt NICHTS
 *   node backfill-user-identity.js             ← führt aus (nach Dry-Run-Review!)
 */

const fs = require('fs');
const admin = require('firebase-admin');

const DRY = !!process.env.DRY_RUN;
const PROJECT_ID = 'markendetektive-895f7';
const SA = '/tmp/sa.json';
if (fs.existsSync(SA)) {
  admin.initializeApp({ credential: admin.credential.cert(require(SA)) });
} else {
  // Fallback: Application Default Credentials (gcloud auth application-default
  // login) — verifiziert 2026-07-12: Firestore + Auth-Admin funktionieren.
  admin.initializeApp({ credential: admin.credential.applicationDefault(), projectId: PROJECT_ID });
}
const db = admin.firestore();
const authAdmin = admin.auth();

const PLACEHOLDER_EMAIL = 'anonymous@markendetektive.app';
const PLACEHOLDER_NAMES = new Set(['Anonymer Nutzer', 'Anonymer Detektiv']);
const BACKUP = `/tmp/backfill-backup-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;

const isPlaceholderName = (n) => {
  const t = String(n || '').trim();
  return !t || PLACEHOLDER_NAMES.has(t);
};
const isPlaceholderEmail = (e) => {
  const t = String(e || '').trim();
  return !t || t === PLACEHOLDER_EMAIL;
};

/** Beste Identität aus Auth: User-Record zuerst, sonst providerData. */
function bestFromAuth(u) {
  const prov = (u.providerData || []).filter((p) => p && p.providerId !== 'firebase');
  const email = u.email || (prov.find((p) => p.email) || {}).email || '';
  const name = (u.displayName || (prov.find((p) => p.displayName) || {}).displayName || '').trim();
  const photo = u.photoURL || (prov.find((p) => p.photoURL) || {}).photoURL || '';
  return { email: email.trim(), name, photo, hasProvider: prov.length > 0 };
}

let backupStream = null;
function backup(kind, uid, oldFields, newFields) {
  if (DRY) return;
  if (!backupStream) backupStream = fs.createWriteStream(BACKUP, { flags: 'a' });
  backupStream.write(JSON.stringify({ kind, uid, old: oldFields, new: newFields }) + '\n');
}

async function identityPass() {
  console.log(`\n── Pass 1: Identität aus Auth ${DRY ? '(DRY-RUN)' : '(LIVE)'} ──`);
  let scanned = 0;
  let withIdentity = 0;
  let patched = 0;
  let lbPatched = 0;
  let missingDoc = 0;
  const samples = [];
  let pageToken;
  // BulkWriter drosselt selbst (500/s-Rampe) und retried transient errors.
  const writer = DRY ? null : db.bulkWriter();

  do {
    // eslint-disable-next-line no-await-in-loop
    const page = await authAdmin.listUsers(1000, pageToken);
    pageToken = page.pageToken;
    const candidates = [];
    for (const u of page.users) {
      scanned += 1;
      const best = bestFromAuth(u);
      // Anonyme (kein Provider, keine Mail, kein Name) → nichts zu holen.
      if (!best.email && !best.name && !best.photo) continue;
      withIdentity += 1;
      candidates.push({ uid: u.uid, best });
    }
    if (candidates.length === 0) continue;

    // Docs der Kandidaten in 100er-Chunks holen (getAll).
    for (let i = 0; i < candidates.length; i += 100) {
      const chunk = candidates.slice(i, i + 100);
      // eslint-disable-next-line no-await-in-loop
      const snaps = await db.getAll(...chunk.map((c) => db.doc(`users/${c.uid}`)));
      for (let j = 0; j < snaps.length; j += 1) {
        const snap = snaps[j];
        const { uid, best } = chunk[j];
        if (!snap.exists) { missingDoc += 1; continue; } // kein Doc = nichts kaputt zu machen
        const d = snap.data() || {};
        const patch = {};
        if (best.email && isPlaceholderEmail(d.email)) patch.email = best.email;
        if (best.name && isPlaceholderName(d.display_name)) patch.display_name = best.name;
        if (best.photo && !String(d.photo_url || '').trim()) patch.photo_url = best.photo;
        if (Object.keys(patch).length === 0) continue;
        patched += 1;
        if (samples.length < 12) {
          samples.push({ uid, old: { email: d.email ?? null, display_name: d.display_name ?? null, photo_url: d.photo_url ?? null }, patch });
        }
        if (!DRY) {
          backup('users', uid, { email: d.email ?? null, display_name: d.display_name ?? null, photo_url: d.photo_url ?? null }, patch);
          writer.update(snap.ref, patch).catch((e) => console.error('users-patch failed', uid, e.message));
        }
        // Bestenliste nachziehen (nur wenn Name repariert wurde).
        if (patch.display_name) {
          // eslint-disable-next-line no-await-in-loop
          const lb = await db.doc(`leaderboards/${uid}`).get();
          if (lb.exists && isPlaceholderName((lb.data() || {}).displayName)) {
            lbPatched += 1;
            if (!DRY) {
              backup('leaderboards', uid, { displayName: (lb.data() || {}).displayName ?? null }, { displayName: patch.display_name });
              writer.update(lb.ref, { displayName: patch.display_name }).catch((e) => console.error('lb-patch failed', uid, e.message));
            }
          }
        }
      }
    }
    if (scanned % 20000 < 1000) console.log(`  … ${scanned} Auth-Konten gesichtet, bisher ${patched} Doc-Patches`);
  } while (pageToken);

  if (writer) await writer.close();
  console.log(`Pass 1 fertig: ${scanned} Auth-Konten · ${withIdentity} mit Identität · ${patched} users-Docs ${DRY ? 'WÜRDEN gepatcht' : 'gepatcht'} · ${lbPatched} Bestenlisten-Namen · ${missingDoc} ohne Doc (übersprungen)`);
  console.log('Beispiele:', JSON.stringify(samples, null, 2));
  return { scanned, withIdentity, patched, lbPatched };
}

async function savingsPass() {
  console.log(`\n── Pass 2: totalSavings-Reparatur ${DRY ? '(DRY-RUN)' : '(LIVE)'} ──`);
  // Feld-Semantik (dokumentiert in journeyTrackingService:569 + empirisch
  // verifiziert am Testuser): top-level `totalSavings` = gepflegtes Anzeige-
  // Feld (increment, firestore.ts:5042); `stats.totalSavings` hält parallel
  // denselben Wert und wird von signUp NICHT angefasst → Referenz.
  // `stats.savingsTotal` ist bug-historisch immer 0 (ungenutzt).
  // Reparatur-Regel (nur ERHÖHEN, nie senken): top < stats.totalSavings
  // (über Rundungs-Epsilon hinaus) → top := stats.totalSavings. Das deckt
  // sowohl komplett Genullte (0 < X) als auch Opfer ab, die nach dem Reset
  // weiter gesammelt haben (teilverlust: 0+neu < alt+neu). FF-Ära-User
  // (top > stats, weil stats erst später existierte) werden NIE angefasst.
  const EPS = 0.005;
  const SANITY_MAX = 100000; // kein absurder Referenzwert
  let checked = 0;
  let repaired = 0;
  const samples = [];
  const writer = DRY ? null : db.bulkWriter();
  let last = null;
  for (;;) {
    let q = db.collection('users')
      .where('stats.totalSavings', '>', 0)
      .orderBy('stats.totalSavings', 'asc')
      .select('totalSavings', 'stats')
      .limit(1000);
    if (last) q = q.startAfter(last);
    // eslint-disable-next-line no-await-in-loop
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      checked += 1;
      const d = doc.data() || {};
      const top = Number(d.totalSavings ?? 0);
      const real = Number((d.stats || {}).totalSavings || 0);
      if (real > SANITY_MAX) continue; // Anomalie — lieber nicht anfassen
      if (real - top > EPS) {
        repaired += 1;
        if (samples.length < 12) samples.push({ uid: doc.id, topLevel: top, statsTotalSavings: real });
        if (!DRY) {
          backup('users-savings', doc.id, { totalSavings: d.totalSavings ?? null }, { totalSavings: real });
          writer.update(doc.ref, { totalSavings: real }).catch((e) => console.error('savings-patch failed', doc.id, e.message));
        }
      }
    }
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 1000) break;
  }
  if (writer) await writer.close();
  console.log(`Pass 2 fertig: ${checked} User mit Ersparnis geprüft · ${repaired} ${DRY ? 'WÜRDEN repariert' : 'repariert'} (totalSavings < stats.totalSavings → angleichen)`);
  console.log('Beispiele:', JSON.stringify(samples, null, 2));
  return { checked, repaired };
}

(async () => {
  console.log(`Backfill ${DRY ? '=== DRY-RUN (schreibt NICHTS) ===' : '=== LIVE ==='} — Projekt: ${PROJECT_ID}`);
  // PASS=1|2 für gezielte Läufe (Default: beide).
  const which = process.env.PASS || 'all';
  const p1 = which === '2' ? {} : await identityPass();
  const p2 = which === '1' ? {} : await savingsPass();
  if (!DRY && backupStream) {
    backupStream.end();
    console.log(`\nBackup der Alt-Werte: ${BACKUP}`);
  }
  console.log('\nGESAMT:', JSON.stringify({ ...p1, ...p2 }));
  process.exit(0);
})().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
