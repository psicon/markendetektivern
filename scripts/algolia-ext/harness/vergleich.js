// NUR LESEND. Rechnet fuer jedes Firestore-Dokument einer Collection den Algolia-Datensatz
// mit dem ECHTEN Extension-Code (alte Version + 1.3.0) aus und vergleicht
//  (a) alt vs. 1.3.0  -> muss identisch sein
//  (b) 1.3.0 vs. aktueller Algolia-Datensatz (Vorher-Sicherung, ohne lastmodified)
// Aufruf: node vergleich.js <instanz> <collection> <index> <altVersion> <transform|-> <outdir> [limit]
// Umgebung: ALGOLIA_EXT_ARBEIT (Ordner mit ext-<version>/functions aus baue-ext.sh),
//           ALGOLIA_EXT_VORHER (Sicherung aus sicherung.js, liefert den Live-Datensatz)
// Firestore wird nur gelesen (Admin-SDK mit den lokalen gcloud-Anmeldedaten).
const fs = require('fs'); const path = require('path');
const [, , INST, COLL, IDX, ALT, TRANSFORM, OUTDIR, LIMIT] = process.argv;
const ARBEIT = process.env.ALGOLIA_EXT_ARBEIT; const VORHER = process.env.ALGOLIA_EXT_VORHER;
if (!INST || !COLL || !IDX || !ALT || !OUTDIR || !ARBEIT || !VORHER) { process.stdout.write('Aufruf siehe Kopf der Datei; ALGOLIA_EXT_ARBEIT und ALGOLIA_EXT_VORHER setzen\n'); process.exit(2); }
for (const m of ['log', 'info', 'debug', 'warn', 'error']) console[m] = () => {};
const say = (s) => process.stdout.write(s + '\n');
const ENV = { PROJECT_ID: 'markendetektive-895f7', LOCATION: 'us-central1', COLLECTION_PATH: COLL, ALGOLIA_INDEX_NAME: IDX,
  ALGOLIA_APP_ID: 'Y0KKZHT49Q', ALGOLIA_API_KEY: 'unused-local', DATABASE_ID: '(default)', EXT_INSTANCE_ID: INST,
  DO_FULL_INDEXING: 'true', FORCE_DATA_SYNC: 'yes', GCLOUD_PROJECT: 'markendetektive-895f7' };
Object.assign(process.env, ENV);
if (TRANSFORM && TRANSFORM !== '-') process.env.TRANSFORM_FUNCTION = TRANSFORM; else delete process.env.TRANSFORM_FUNCTION;
function load(ver) {
  const base = path.join(ARBEIT, `ext-${ver}`, 'functions');
  const admin = require(path.join(base, 'node_modules', 'firebase-admin'));
  const app = admin.initializeApp({ projectId: 'markendetektive-895f7' }, 'v' + ver);
  const db = app.firestore();
  const extract = require(path.join(base, 'lib', 'extract.js')).default;
  return { db, extract };
}
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.keys(x).sort().reduce((a, kk) => (a[kk] = x[kk], a), {}) : x);
async function alleDocs(db) {
  const out = []; let last = null; const lim = LIMIT ? Number(LIMIT) : Infinity;
  for (;;) {
    let q = db.collection(COLL).orderBy('__name__').limit(500);
    if (last) q = q.startAfter(last);
    const s = await q.get(); out.push(...s.docs); if (s.size < 500 || out.length >= lim) break; last = s.docs[s.docs.length - 1];
  }
  return out.slice(0, lim);
}
(async () => {
  const alt = load(ALT), neu = load('1.3.0');
  const algolia = new Map();
  for (const line of fs.readFileSync(path.join(VORHER, IDX, 'records-all.jsonl'), 'utf8').split('\n')) if (line.trim()) { const r = JSON.parse(line); algolia.set(r.objectID, r); }
  const docsAlt = await alleDocs(alt.db); const docsNeu = await alleDocs(neu.db);
  const byIdAlt = new Map(docsAlt.map(d => [d.id, d]));
  const res = { instanz: INST, index: IDX, altVersion: ALT, transform: TRANSFORM, firestoreDocs: docsNeu.length, algoliaRecords: algolia.size,
    altGleichNeu: 0, altUngleichNeu: [], neuFehler: [], altFehler: [], gleichAlgolia: 0, ungleichAlgolia: [], fehltInAlgolia: [], nurInAlgolia: 0, groesster: 0, ueber10k: 0 };
  for (const dN of docsNeu) {
    const dA = byIdAlt.get(dN.id);
    let pN, pA;
    try { pN = await neu.extract(dN, 0); } catch (e) { res.neuFehler.push([dN.id, e.message]); continue; }
    try { pA = dA ? await alt.extract(dA, 0) : undefined; } catch (e) { res.altFehler.push([dN.id, e.message]); }
    if (pA !== undefined) { if (stable(pA) === stable(pN)) res.altGleichNeu++; else res.altUngleichNeu.push(dN.id); }
    const size = Buffer.byteLength(JSON.stringify(pN)); res.groesster = Math.max(res.groesster, size); if (size > 10240) res.ueber10k++;
    const rec = algolia.get(dN.id);
    if (!rec) { res.fehltInAlgolia.push(dN.id); continue; }
    const recOhne = { ...rec }; delete recOhne.lastmodified;
    const pOhne = { ...pN }; delete pOhne.lastmodified;
    if (stable(recOhne) === stable(pOhne)) res.gleichAlgolia++;
    else {
      const keys = new Set([...Object.keys(recOhne), ...Object.keys(pOhne)]);
      const diff = [...keys].filter(k => stable(recOhne[k]) !== stable(pOhne[k]));
      res.ungleichAlgolia.push([dN.id, diff.slice(0, 8)]);
    }
  }
  const fsIds = new Set(docsNeu.map(d => d.id));
  res.nurInAlgolia = [...algolia.keys()].filter(k => !fsIds.has(k)).length;
  if (!LIMIT) res.nurInAlgoliaIds = [...algolia.keys()].filter(k => !fsIds.has(k)).slice(0, 20);
  fs.mkdirSync(OUTDIR, { recursive: true });
  fs.writeFileSync(path.join(OUTDIR, `vergleich-${IDX}${TRANSFORM && TRANSFORM !== '-' ? '-mitTransform' : ''}.json`), JSON.stringify(res, null, 2));
  const kurz = { ...res, altUngleichNeu: res.altUngleichNeu.length, ungleichAlgolia: res.ungleichAlgolia.length, fehltInAlgolia: res.fehltInAlgolia.length, neuFehler: res.neuFehler.length, altFehler: res.altFehler.length };
  delete kurz.nurInAlgoliaIds;
  say(JSON.stringify(kurz));
  process.exit(0);
})().catch(e => { process.stdout.write('ERR ' + e.stack + '\n'); process.exit(1); });
