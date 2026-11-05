// App-Sicht (NUR LESEND): sucht mit dem oeffentlichen Such-Key der App im Index produkte und
// zeigt Trefferzahl und die Positionen der Koeder-Datensaetze (scripts/canary) in den ersten 50.
// Aufruf: node koeder-suche.js   — belegt nach dem Update, dass die App-Suche weiter antwortet.
const path = require('path');
const { searchKey, alg, REPO } = require('./keys');
const reg = require(path.join(REPO, 'scripts', 'canary', 'canary_registry.json'));
const ids = new Set(reg.eintraege.map(e => e.doc_id));
(async () => {
  const k = searchKey();
  let fehler = 0;
  for (const q of ['Molkereiprodukte', 'Waschmittel Drogerie', '2911000000017', 'Hartkaese', 'Milch']) {
    const r = await alg(k, 'POST', '/1/indexes/produkte/query', { query: q, hitsPerPage: 50, attributesToRetrieve: ['objectID', 'name'] });
    if (r.status !== 200) { fehler++; console.log(JSON.stringify(q), 'HTTP', r.status); continue; }
    const hits = r.json.hits || [];
    const kHits = hits.filter(h => ids.has(h.objectID));
    console.log(JSON.stringify(q), 'nbHits', r.json.nbHits, '| Koeder in ersten 50:', kHits.length, kHits.map(h => hits.indexOf(h) + 1).join(','));
  }
  process.exit(fehler ? 1 : 0);
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
