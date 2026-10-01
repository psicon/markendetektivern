// Vergleicht zwei Sicherungen (sicherung.js) Index fuer Index: Settings, Synonyme, Regeln, Datensaetze.
// Meldet fuer geaenderte Datensaetze, ob sich die FORM geaendert hat (Felder dazu/weg, Typwechsel).
// NUR LESEND (lokale Dateien). Aufruf: node diff-snapshots.js <sicherungA> <sicherungB>
// lastmodified zaehlt NICHT als Formwechsel: jeder normale Sync aendert es (FORCE_DATA_SYNC=yes
// entfernt es, =no setzt eine Zahl) — beim alten wie beim neuen Code. Alarm gibt es nur, wenn
// ein Datensatz NEU die Objektform {_operation,value} bekommt: die schreibt nur ein Vollindex.
const fs = require('fs'); const path = require('path');
const [, , A, B] = process.argv;
if (!A || !B) { console.error('Aufruf: node diff-snapshots.js <sicherungA> <sicherungB>'); process.exit(2); }
const lmTyp = (v) => v === undefined ? 'undefined' : (v && typeof v === 'object' && '_operation' in v) ? 'objekt' : typ(v);
const typ = (v) => v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v;
const stable = (v) => JSON.stringify(v, (k, x) => (x && typeof x === 'object' && !Array.isArray(x)) ? Object.keys(x).sort().reduce((a, kk) => (a[kk] = x[kk], a), {}) : x);
const lade = (d, idx) => { const m = new Map(); for (const l of fs.readFileSync(path.join(d, idx, 'records-all.jsonl'), 'utf8').split('\n')) if (l.trim()) { const r = JSON.parse(l); m.set(r.objectID, r); } return m; };
let alarm = false;
for (const idx of fs.readdirSync(A).filter(x => fs.existsSync(path.join(A, x, 'records-all.jsonl')))) {
  if (!fs.existsSync(path.join(B, idx, 'records-all.jsonl'))) { console.log(idx, 'FEHLT in', B); alarm = true; continue; }
  const s1 = fs.readFileSync(path.join(A, idx, 'settings.json'), 'utf8'), s2 = fs.readFileSync(path.join(B, idx, 'settings.json'), 'utf8');
  const sy1 = JSON.parse(fs.readFileSync(path.join(A, idx, 'synonyms.json'))), sy2 = JSON.parse(fs.readFileSync(path.join(B, idx, 'synonyms.json')));
  const ru1 = fs.readFileSync(path.join(A, idx, 'rules.json'), 'utf8'), ru2 = fs.readFileSync(path.join(B, idx, 'rules.json'), 'utf8');
  const a = lade(A, idx), b = lade(B, idx);
  let gleich = 0; const geaendert = []; const form = []; const lmWechsel = {}; let neuObjekt = 0; const neu = [...b.keys()].filter(k => !a.has(k)); const weg = [...a.keys()].filter(k => !b.has(k));
  for (const [id, ra] of a) {
    const rb = b.get(id); if (!rb) continue;
    if (stable(ra) === stable(rb)) { gleich++; continue; }
    const keys = [...new Set([...Object.keys(ra), ...Object.keys(rb)])];
    const diff = keys.filter(k => stable(ra[k]) !== stable(rb[k]));
    geaendert.push([id, diff]);
    const formDiff = keys.filter(k => k !== 'lastmodified' && (!(k in ra) || !(k in rb) || typ(ra[k]) !== typ(rb[k])));
    const la = lmTyp(ra.lastmodified), lb = lmTyp(rb.lastmodified);
    if (la !== lb) { lmWechsel[`${la}->${lb}`] = (lmWechsel[`${la}->${lb}`] || 0) + 1; if (lb === 'objekt') neuObjekt++; }
    if (formDiff.length) form.push([id, formDiff.map(k => `${k}:${k in ra ? typ(ra[k]) : '-'}->${k in rb ? typ(rb[k]) : '-'}`)]);
  }
  const settingsGleich = stable(JSON.parse(s1)) === stable(JSON.parse(s2));
  const synGleich = stable(sy1.map(s => ({ ...s, _highlightResult: undefined })).sort((x, y) => x.objectID < y.objectID ? -1 : 1)) === stable(sy2.map(s => ({ ...s, _highlightResult: undefined })).sort((x, y) => x.objectID < y.objectID ? -1 : 1));
  for (const id of neu) if (lmTyp(b.get(id).lastmodified) === 'objekt') neuObjekt++;
  if (!settingsGleich || !synGleich || ru1 !== ru2 || weg.length || form.length || neuObjekt) alarm = true;
  console.log(`${idx.padEnd(15)} records ${a.size}->${b.size} gleich ${gleich} geaendert ${geaendert.length} neu ${neu.length} weg ${weg.length} | FORMwechsel ${form.length} | settings ${settingsGleich ? 'gleich' : 'GEAENDERT'} | synonyme ${sy1.length}->${sy2.length} ${synGleich ? 'gleich' : 'GEAENDERT'} | regeln ${ru1 === ru2 ? 'gleich' : 'GEAENDERT'} | lastmodified ${JSON.stringify(lmWechsel)}${neuObjekt ? ` NEU OBJEKTFORM ${neuObjekt} (Vollindex?)` : ''}`);
  for (const [id, d] of geaendert.slice(0, 5)) console.log(`     geaendert ${id}: ${d.slice(0, 8).join(',')}`);
  for (const [id, d] of form.slice(0, 5)) console.log(`     FORM ${id}: ${d.join(', ')}`);
  for (const id of neu.slice(0, 5)) console.log(`     neu ${id}`);
  for (const id of weg.slice(0, 5)) console.log(`     WEG ${id}`);
}
console.log(alarm ? 'ERGEBNIS: AUFFAELLIG — Details oben pruefen' : 'ERGEBNIS: unauffaellig (nur Inhaltsaenderungen ohne Formwechsel)');
process.exit(alarm ? 1 : 0);
