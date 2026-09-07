// Führt die geprüften Urteile aus — über die Konsolen-Callables (Emulator gegen
// Prod-Firestore), damit exakt dieselbe Logik greift wie beim Klick im Werkzeug:
// Doppel-Regel, Notiz-Texte, Transaktion je Dokument, und für Bons der
// bestehende Resolver mit allen Caps.
//
//   DRY_RUN=1 node .entscheide.js fotos      → zeigt nur, was passieren würde
//   node .entscheide.js fotos                → führt aus
//   node .entscheide.js bons
'use strict';
const fs = require('fs');
const WAS = process.argv[2];
const DRY = process.env.DRY_RUN === '1';
const BASE = 'http://127.0.0.1:5001/markendetektive-895f7/europe-west1';
const TOKEN = fs.readFileSync('/tmp/adm.jwt', 'utf8').trim();
const OUT = `.entscheide-${WAS}.result.json`;

const post = async (fn, data) => {
  const res = await fetch(`${BASE}/${fn}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ data }),
  });
  const txt = await res.text();
  if (!res.ok) throw new Error(`${fn} HTTP ${res.status}: ${txt.slice(0, 200)}`);
  return JSON.parse(txt).result;
};

(async () => {
  const erledigt = fs.existsSync(OUT) ? JSON.parse(fs.readFileSync(OUT, 'utf8')) : [];
  const fertig = new Set(erledigt.map((x) => x.id));

  if (WAS === 'fotos') {
    const r = JSON.parse(fs.readFileSync('.urteile-fotos.json', 'utf8')).filter((x) => !fertig.has(x.id));
    const frei = r.filter((x) => x.urteil === 'freigeben');
    const ab = r.filter((x) => x.urteil === 'ablehnen');
    console.log(`Offen: ${frei.length} Freigaben, ${ab.length} Ablehnungen${DRY ? '  (TROCKENLAUF)' : ''}`);
    if (DRY) {
      ab.forEach((x) => console.log(`  ablehnen  ${x.id} ${x.gruende[0]}`));
      return;
    }
    // Ablehnungen zuerst: sie nehmen den Doppel-Sperren die Grundlage nicht weg,
    // aber eine Freigabe kann eine spätere Ablehnung überflüssig machen.
    for (const x of ab) {
      const res = await post('reviewDecideUploads', { ids: [x.id], decision: 'reject', reason: x.gruende[0] });
      const o = (res.results || [])[0] || {};
      erledigt.push({ id: x.id, aktion: 'reject', grund: x.gruende[0], ergebnis: o.outcome, hinweis: o.reason ?? null });
      fs.writeFileSync(OUT, JSON.stringify(erledigt, null, 1));
      console.log(`  ablehnen  ${x.id} ${x.gruende[0]} → ${o.outcome}`);
    }
    // Freigaben in Häppchen von 20 — je Dokument eigene Transaktion im Server.
    for (let i = 0; i < frei.length; i += 20) {
      const teil = frei.slice(i, i + 20);
      const res = await post('reviewDecideUploads', { ids: teil.map((x) => x.id), decision: 'approve' });
      (res.results || []).forEach((o) => {
        erledigt.push({ id: o.id, aktion: 'approve', ergebnis: o.outcome, hinweis: o.reason ?? null });
        if (o.outcome !== 'approved') console.log(`  ! ${o.id} → ${o.outcome} ${o.reason ?? ''}`);
      });
      fs.writeFileSync(OUT, JSON.stringify(erledigt, null, 1));
      console.log(`  freigegeben ${Math.min(i + 20, frei.length)}/${frei.length}`);
    }
  } else if (WAS === 'bons') {
    // 'offen_lassen' = Ermessensfall, bleibt bewusst in der Warteschlange.
    const r = JSON.parse(fs.readFileSync('.pruefe-bons.result.json', 'utf8'))
      .filter((x) => !fertig.has(x.id) && x.urteil !== 'offen_lassen');
    console.log(`Offen: ${r.filter((x) => x.urteil === 'freigeben').length} Freigaben, ${r.filter((x) => x.urteil === 'ablehnen').length} Ablehnungen${DRY ? '  (TROCKENLAUF)' : ''}`);
    if (DRY) { r.forEach((x) => console.log(`  ${x.urteil.padEnd(12)} ${x.id} ${JSON.stringify(x.gruende)}`)); return; }
    // Bons SEQUENZIELL: der Tageszähler pro Nutzer und Bon-Datum entscheidet
    // mit, ein paralleler Lauf würde ihn umgehen.
    for (const x of r) {
      const data = x.urteil === 'freigeben'
        ? { receiptId: x.id, decision: 'approve' }
        : { receiptId: x.id, decision: 'reject', reason: 'manual_review_rejected' };
      const res = await post('reviewDecideReceipt', data);
      erledigt.push({ id: x.id, aktion: data.decision, grund: x.gruende, ergebnis: res });
      fs.writeFileSync(OUT, JSON.stringify(erledigt, null, 1));
      console.log(`  ${data.decision.padEnd(8)} ${x.id} → ${JSON.stringify(res).slice(0, 120)}`);
    }
  } else {
    throw new Error('erstes Argument: fotos | bons');
  }
  console.log('fertig.');
})().catch((e) => { console.error('ABBRUCH:', e.message); process.exit(1); });
