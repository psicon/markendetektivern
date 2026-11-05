// Sicherung der Algolia-Indizes (NUR LESEND): Settings (+Replikas), Synonyme,
// Regeln, alle Datensaetze (browse), 3 Stichproben-Datensaetze, Koeder-Pruefung.
// Aufruf: node sicherung.js <zielordner>      (~3 min, ~65 MB; legt <ziel>/<index>/... an)
// Liest die Keys der Extension-Instanzen aus dem Secret Manager, gibt sie nie aus.
const fs = require('fs'); const path = require('path');
const { extKey, alg, REPO } = require('./keys');
const OUT = process.argv[2];
if (!OUT) { console.error('Aufruf: node sicherung.js <zielordner>'); process.exit(2); }
if (fs.existsSync(path.join(OUT, 'zusammenfassung.json'))) { console.error(`ABBRUCH: ${OUT} enthaelt schon eine Sicherung — neuen Ordner angeben`); process.exit(2); }
const INSTANZEN = [
  ['firestore-algolia-search-vatb', 'produkte', 'firestore-algolia-search-vatb-ALGOLIA_API_KEY', ['l3WOEeZL9n7aG0WV3TNY', 'l3VeLV7S5C976o0zXCT6', 'OKIT2Id6HVUUfuwwwNmG']],
  ['firestore-algolia-search-v50j', 'markenProdukte', 'firestore-algolia-search-v50j-ALGOLIA_API_KEY', ['Q4MBgzSnWGpeKS8ZzWQJ', 'CpEJ4cSJ8l6pvwE9WNx1', 'htGxbxkNw0LjdsoUZywf']],
  ['firestore-algolia-search', 'vetnummern', 'firestore-algolia-search-ALGOLIA_API_KEY', null],
  ['firestore-algolia-search-trzv', 'vetnummernat', 'firestore-algolia-search-trzv-ALGOLIA_API_KEY', null],
  ['firestore-algolia-search-fll2', 'discounter', 'firestore-algolia-search-fll2-ALGOLIA_API_KEY', null],
  ['firestore-algolia-search-iyqn', 'hersteller', 'firestore-algolia-search-iyqn-ALGOLIA_API_KEY', null],
  ['firestore-algolia-search-ly0q', 'hersteller_new', 'firestore-algolia-search-ly0q-ALGOLIA_API_KEY', ['zwrhHw2g0i2KbxX7l8ah', 'zucUBplWVpV7mhARLWiV', 'zpP4t9PnYhnWZMzyQVv6']],
  ['firestore-algolia-search-oaz3', 'kategorien', 'firestore-algolia-search-oaz3-ALGOLIA_API_KEY', null],
  ['firestore-algolia-search-t542', 'handelsmarken', 'firestore-algolia-search-ahyv-ALGOLIA_API_KEY', null],
];
const ok = (r, what) => { if (r.status !== 200) throw new Error(`${what}: HTTP ${r.status} ${JSON.stringify(r.json).slice(0, 200)}`); return r.json; };
async function alle(key, idx, kind) {
  const out = []; let page = 0;
  for (;;) {
    const j = ok(await alg(key, 'POST', `/1/indexes/${encodeURIComponent(idx)}/${kind}/search`, { query: '', page, hitsPerPage: 1000 }), `${kind} ${idx}`);
    out.push(...j.hits); page++;
    if (j.hits.length < 1000 || page >= (j.nbPages ?? 999)) break;
  }
  return out;
}
async function browse(key, idx) {
  const out = []; let cursor;
  for (;;) {
    const body = cursor ? { cursor } : { hitsPerPage: 1000, attributesToRetrieve: ['*'] };
    const j = ok(await alg(key, 'POST', `/1/indexes/${encodeURIComponent(idx)}/browse`, body), `browse ${idx}`);
    out.push(...j.hits); cursor = j.cursor; if (!cursor) break;
  }
  return out;
}
(async () => {
  const zusammenfassung = {};
  for (const [inst, idx, secret, sample] of INSTANZEN) {
    const key = extKey(secret);
    const dir = path.join(OUT, idx); fs.mkdirSync(dir, { recursive: true });
    const settings = ok(await alg(key, 'GET', `/1/indexes/${idx}/settings?getVersion=2`), `settings ${idx}`);
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 2));
    for (const rep of settings.replicas || []) {
      // Replika-Settings mit dem iyqn-Key lesen (darf alle Indizes lesen; der Key der Instanz evtl. nicht)
      const rs = ok(await alg(extKey('firestore-algolia-search-iyqn-ALGOLIA_API_KEY'), 'GET', `/1/indexes/${rep}/settings?getVersion=2`), `settings ${rep}`);
      fs.writeFileSync(path.join(dir, `settings-replica-${rep}.json`), JSON.stringify(rs, null, 2));
    }
    const syn = await alle(key, idx, 'synonyms'); fs.writeFileSync(path.join(dir, 'synonyms.json'), JSON.stringify(syn));
    const rules = await alle(key, idx, 'rules'); fs.writeFileSync(path.join(dir, 'rules.json'), JSON.stringify(rules));
    const recs = await browse(key, idx);
    fs.writeFileSync(path.join(dir, 'records-all.jsonl'), recs.map(r => JSON.stringify(r)).join('\n') + '\n');
    let ids = sample;
    if (!ids) ids = recs.slice(0, 3).map(r => r.objectID);
    const stichprobe = {};
    for (const id of ids) {
      const r = await alg(key, 'GET', `/1/indexes/${idx}/${encodeURIComponent(id)}`);
      stichprobe[id] = { status: r.status, record: r.status === 200 ? r.json : null };
    }
    fs.writeFileSync(path.join(dir, 'stichprobe-3.json'), JSON.stringify(stichprobe, null, 2));
    const mitLm = recs.filter(r => r.lastmodified !== undefined);
    const lmTypen = {}; for (const r of mitLm) { const t = typeof r.lastmodified === 'object' ? 'object:' + Object.keys(r.lastmodified).sort().join(',') : typeof r.lastmodified; lmTypen[t] = (lmTypen[t] || 0) + 1; }
    zusammenfassung[idx] = { instanz: inst, records: recs.length, synonyms: syn.length, rules: rules.length, replicas: settings.replicas || [], stichprobe: Object.fromEntries(Object.entries(stichprobe).map(([k, v]) => [k, v.status])), lastmodified: { mit: mitLm.length, typen: lmTypen }, ohnePath: recs.filter(r => !r.path).length, groesstesByte: Math.max(...recs.map(r => Buffer.byteLength(JSON.stringify(r)))) };
    console.log(idx, JSON.stringify(zusammenfassung[idx]));
  }
  // Koeder: liegen sie im produkte-Index?
  const reg = JSON.parse(fs.readFileSync(path.join(REPO, 'scripts', 'canary', 'canary_registry.json'), 'utf8'));
  const k = extKey('firestore-algolia-search-vatb-ALGOLIA_API_KEY');
  const koeder = {};
  for (const e of reg.eintraege) { const r = await alg(k, 'GET', `/1/indexes/produkte/${e.doc_id}`); koeder[e.doc_id] = r.status; }
  zusammenfassung.koederImProdukteIndex = koeder;
  console.log('koeder getObject status', JSON.stringify(koeder));
  fs.writeFileSync(path.join(OUT, 'zusammenfassung.json'), JSON.stringify(zusammenfassung, null, 2));
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
