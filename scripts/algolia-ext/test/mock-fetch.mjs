// Ersetzt fetch fuer test/run-tests.sh: KEIN echter Netzwerkzugriff. Antworten aus der Fixture.
// Steuerung per Umgebung:
//   MOCK_INSTANCES        Fixture (instances-Liste wie GET .../instances)
//   MOCK_LOG              jede Anfrage als JSON-Zeile
//   MOCK_SZENARIO         ok | opfehler | falscheLaufzeit
//   MOCK_START_VERSION    setzt extensionVersion aller Algolia-Instanzen
//   MOCK_START_STATE      setzt state aller Algolia-Instanzen (z. B. ERRORED, DEPLOYING)
//   MOCK_START_DFI        setzt DO_FULL_INDEXING aller Algolia-Instanzen
//   MOCK_FEHLER_KONFIG    bei opfehler: "neu" = Zielkonfiguration steht danach in config, sonst alte
import fs from 'node:fs';
const RAW = JSON.parse(fs.readFileSync(process.env.MOCK_INSTANCES, 'utf8'));
const LOG = process.env.MOCK_LOG;
const SZENARIO = process.env.MOCK_SZENARIO || 'ok';
const zustand = {};
for (const i of RAW.instances) zustand[i.name.split('/').pop()] = JSON.parse(JSON.stringify(i));
for (const k of Object.keys(zustand)) {
  const inst = zustand[k];
  if (inst.config.extensionRef !== 'algolia/firestore-algolia-search') continue;
  if (process.env.MOCK_START_VERSION) inst.config.extensionVersion = process.env.MOCK_START_VERSION;
  if (process.env.MOCK_START_DFI) inst.config.params.DO_FULL_INDEXING = process.env.MOCK_START_DFI;
  if (process.env.MOCK_START_STATE) {
    inst.state = process.env.MOCK_START_STATE;
    if (inst.state === 'ERRORED') inst.errorStatus = { code: 13, message: 'simuliert: UpdateFunction failed' };
  }
}
let pending = null;
const log = (o) => fs.appendFileSync(LOG, JSON.stringify(o) + '\n');
const resp = (status, json) => new Response(JSON.stringify(json), { status, headers: { 'content-type': 'application/json' } });
globalThis.fetch = async (url, opts = {}) => {
  const u = new URL(url); const m = opts.method || 'GET';
  log({ m, url: u.pathname + u.search, body: opts.body ? JSON.parse(opts.body) : undefined });
  let mm;
  if (u.host === 'firebaseextensions.googleapis.com' && (mm = u.pathname.match(/^\/v1beta\/projects\/markendetektive-895f7\/instances\/([^/]+)$/))) {
    const id = mm[1]; const inst = zustand[id];
    if (!inst) return resp(404, { error: 'not found' });
    if (m === 'GET') return resp(200, inst);
    if (m === 'PATCH') {
      if (u.searchParams.get('validateOnly') === 'true') return resp(200, {});
      pending = { id, body: JSON.parse(opts.body) };
      return resp(200, { name: `projects/markendetektive-895f7/operations/op-${id}` });
    }
  }
  if (u.host === 'firebaseextensions.googleapis.com' && u.pathname.includes('/operations/')) {
    if (SZENARIO === 'opfehler') {
      if (pending) {
        const inst = zustand[pending.id];
        inst.state = 'ERRORED';
        inst.errorStatus = { code: 13, message: 'simuliert: is in region eur3-europe-west1 which is not supported' };
        if (process.env.MOCK_FEHLER_KONFIG === 'neu') { inst.config.extensionVersion = pending.body.config.extensionVersion; inst.config.params = pending.body.config.params; }
        inst.etag = 'fehler';
        pending = null;
      }
      return resp(200, { done: true, error: { code: 13, message: 'simulierter Update-Fehler' } });
    }
    if (pending) {
      const inst = zustand[pending.id];
      inst.config.extensionVersion = pending.body.config.extensionVersion;
      inst.config.params = pending.body.config.params;
      inst.config.systemParams = pending.body.config.systemParams;
      inst.state = 'ACTIVE'; delete inst.errorStatus;
      inst.etag = 'neu';
      inst.runtimeData = { processingState: { state: 'PROCESSING_COMPLETE', detailMessage: 'Existing documents were not indexed because "Indexing existing documents?" is configured to false.' } };
      pending = null;
    }
    return resp(200, { done: true, response: {} });
  }
  if (u.host === 'cloudfunctions.googleapis.com') {
    const id = u.pathname.split('/').pop().replace(/^ext-/, '').replace(/-execute(Full)?IndexOperation$/, '');
    const v = zustand[id]?.config.extensionVersion;
    const rt = { '1.3.0': 'nodejs22', '1.2.10': 'nodejs20', '1.2.0': 'nodejs18' }[v];
    return resp(200, { runtime: SZENARIO === 'falscheLaufzeit' ? 'nodejs20' : rt, status: 'ACTIVE', updateTime: 'x', versionId: '1' });
  }
  throw new Error('MOCK: unerwarteter Netzwerkaufruf ' + url);
};
// Wartepausen im Test abkuerzen
const st = globalThis.setTimeout; globalThis.setTimeout = (fn, ms, ...a) => st(fn, Math.min(ms, 5), ...a);
