// NUR LESEND: listet alle Algolia-Indizes (Eintraege, Groesse, updatedAt, Replikas).
// Aufruf: node listidx.js <ausgabe.json>
const fs = require('fs');
const { extKey, alg } = require('./keys');
(async () => {
  const k = extKey('firestore-algolia-search-iyqn-ALGOLIA_API_KEY');
  const r = await alg(k, 'GET', '/1/indexes');
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify(r.json, null, 2));
  for (const i of r.json.items || []) console.log(i.name.padEnd(28), 'entries', String(i.entries).padStart(7), 'dataSize', String(i.dataSize).padStart(10), 'updatedAt', i.updatedAt, i.primary ? 'replicaOf=' + i.primary : '', i.replicas ? 'replicas=' + i.replicas : '');
})().catch(e => { console.error('ERR', e.message); process.exit(1); });
