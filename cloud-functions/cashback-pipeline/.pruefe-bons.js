// Sorgfältige Prüfung der offenen Bons (Status 'review'). Schreibt NICHTS.
// Je Bon: unabhängige Zweitlesung des Bildes + Abgleich mit dem Gespeicherten
// + Doppel-Prüfung + Policy-Gates. Urteil nur als JSON.
'use strict';
const fs = require('fs');
const admin = require('firebase-admin');
const { GoogleGenAI, Type } = require('@google/genai');

admin.initializeApp({ projectId: 'markendetektive-895f7', storageBucket: 'markendetektive-895f7.appspot.com' });
const db = admin.firestore();
const bucket = admin.storage().bucket();
const ai = new GoogleGenAI({ vertexai: true, project: 'markendetektive-895f7', location: 'global' });

const SCHEMA = {
  type: Type.OBJECT,
  properties: {
    istKassenbon: { type: Type.BOOLEAN },
    markt: { type: Type.STRING },
    datum: { type: Type.STRING },
    endsummeCent: { type: Type.INTEGER },
    anzahlPositionen: { type: Type.INTEGER },
    manipuliert: { type: Type.BOOLEAN },
    grund: { type: Type.STRING },
  },
  required: ['istKassenbon', 'markt', 'datum', 'endsummeCent', 'anzahlPositionen', 'manipuliert', 'grund'],
};
const PROMPT = [
  'Lies diesen Kassenbon unabhängig und nenne nur, was klar zu sehen ist.',
  'istKassenbon: ist das ein echter Kassenbon eines Einzelhändlers (kein Screenshot, kein Lieferschein, keine Rechnung)?',
  'markt: Name des Geschäfts laut Bonkopf.',
  'datum: Kaufdatum als YYYY-MM-DD.',
  'endsummeCent: die Endsumme/der Gesamtbetrag in Cent (z. B. 23,45 € = 2345).',
  'anzahlPositionen: Anzahl der gekauften Artikelzeilen (ohne Summenzeilen, ohne Zahlungsarten).',
  'manipuliert: gibt es sichtbare Hinweise auf Bearbeitung (überklebte Stellen, montierte Bildteile, Bildschirmfoto eines Bons)?',
  'grund: max. 15 Wörter zu deinem Urteil.',
  'Wenn ein Wert nicht sicher lesbar ist: leerer String bzw. 0.',
].join('\n');

(async () => {
  const snap = await db.collection('receipts').where('status', '==', 'review').get();
  const bons = snap.docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => (a.createdAt?.toMillis?.() ?? 0) - (b.createdAt?.toMillis?.() ?? 0));
  console.log(`Zu prüfen: ${bons.length} Bons in Review`);

  // MAX_BON_AGE_DAYS = 7 (index.js, Produktentscheidung 05.09.2026).
  // Zu wenige Artikel ist KEIN Ablehngrund — der Bon ist echt und zählt in die
  // Ausgabenübersicht, nur die Prämie ist dann 0 (minItemsForPayout).
  const maxAge = 7;
  const minItemsForPayout = 4;

  const out = [];
  for (const b of bons) {
    const r = {
      id: b.id, uid: b.userId, markt: b.merchant?.name ?? null, bonDate: b.bonDate ?? null,
      total: b.totalCents ?? b.ocr?.parsed?.totalCents ?? null,
      items: Array.isArray(b.items) ? b.items.length : 0, eligible: b.eligibleItemCount ?? null,
      conf: b.ocr?.robust?.confidence ?? null, attempts: b.ocr?.robust?.attempts ?? null,
      reconOk: b.ocr?.reconciliation?.ok ?? null, campaign: b.campaignId ?? null,
      gruende: [], hinweise: [],
    };

    // Policy-Gates aus den gespeicherten Tatsachen
    const alter = b.bonDate ? Math.round((Date.now() - new Date(b.bonDate + 'T12:00:00Z').getTime()) / 86400000) : null;
    r.alterTage = alter;
    if (alter == null) r.gruende.push('kein_bon_datum');
    else if (alter > maxAge) r.gruende.push('bon_zu_alt');
    if (!r.markt) r.gruende.push('markt_unbekannt');
    if (r.eligible != null && r.eligible < minItemsForPayout) r.hinweise.push('unter_praemien_schwelle');

    // Doppel: gleicher Inhalt woanders?
    for (const feld of ['contentHash', 'transactionHash', 'itemsHash']) {
      const h = b[feld] ?? b.capture?.[feld];
      if (!h) continue;
      const dup = await db.collection('receipts').where(feld, '==', h).select('userId', 'status').get();
      const andere = dup.docs.filter((d) => d.id !== b.id);
      if (andere.length) {
        r.gruende.push(andere.some((d) => d.data().userId === b.userId) ? 'duplicate_content_self' : 'duplicate_content_cross_user');
        r.doppelt = { feld, ids: andere.map((d) => d.id).slice(0, 3) };
        break;
      }
    }

    // Zweitlesung des Bildes
    const pfad = b.storage?.path || b.storagePath || b.capture?.storagePath;
    if (pfad) {
      try {
        const [buf] = await bucket.file(pfad).download();
        const res = await ai.models.generateContent({
          model: 'gemini-3.5-flash',
          contents: [{ role: 'user', parts: [{ text: PROMPT }, { inlineData: { mimeType: 'image/jpeg', data: buf.toString('base64') } }] }],
          // Kein thinkingBudget-Deckel und reichlich Tokens: mit 400 Tokens
          // verbrauchte das Denken das gesamte Budget und `text` kam LEER
          // zurück — ohne Fehler. Ein leeres Ergebnis darf nie als „geprüft"
          // durchgehen, darum unten die harte Prüfung auf Pflichtfelder.
          config: { responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.1, maxOutputTokens: 4000 },
        });
        const v = res.text ? JSON.parse(res.text) : {};
        if (typeof v.istKassenbon !== 'boolean') {
          throw new Error(`Zweitlesung ohne Inhalt (finish=${res.candidates?.[0]?.finishReason ?? '?'})`);
        }
        r.zweit = v;
        if (v.istKassenbon === false) r.gruende.push('kein_kassenbon');
        if (v.manipuliert === true) r.gruende.push('manipulationsverdacht');
        // Abgleich: was für Geld zählt, ist Markt + Datum + Summe
        const gleichDatum = v.datum && r.bonDate ? v.datum === r.bonDate : null;
        const deltaSumme = v.endsummeCent > 0 && r.total ? Math.abs(v.endsummeCent - r.total) : null;
        if (v.endsummeCent > 0 && !r.total) r.hinweise.push('gespeicherte_summe_fehlt');
        r.abgleich = { datumGleich: gleichDatum, deltaSummeCent: deltaSumme,
          marktAehnlich: v.markt && r.markt ? v.markt.toLowerCase().replace(/[^a-z]/g, '').includes(r.markt.toLowerCase().replace(/[^a-z]/g, '').slice(0, 4)) || r.markt.toLowerCase().replace(/[^a-z]/g, '').includes(v.markt.toLowerCase().replace(/[^a-z]/g, '').slice(0, 4)) : null };
        if (gleichDatum === false) r.gruende.push('datum_widerspricht');
        if (deltaSumme != null && deltaSumme > 100) r.gruende.push('summe_widerspricht');
        if (r.abgleich.marktAehnlich === false) r.hinweise.push('markt_schreibweise_abweichend');
      } catch (e) {
        r.zweit = { fehler: String(e.message).slice(0, 140) };
        // Eine gescheiterte Zweitlesung ist KEIN Freibrief: ohne sie fehlt die
        // Sichtprüfung, der Fall geht zur Hand-Entscheidung, nicht in die Freigabe.
        r.gruende.push('nicht_geprueft');
      }
    } else {
      // Ohne Bild keine Sichtprüfung — dann wird auch nicht freigegeben.
      r.gruende.push('kein_bild');
    }

    r.urteil = r.gruende.length ? 'ablehnen' : 'freigeben';
    out.push(r);
    fs.writeFileSync('.pruefe-bons.result.json', JSON.stringify(out, null, 1));
    console.log(`${r.urteil.toUpperCase().padEnd(9)} ${r.id} | ${String(r.markt).slice(0, 14).padEnd(14)} | ${r.bonDate} | ${(r.total ?? 0) / 100}€ vs ${(r.zweit?.endsummeCent ?? 0) / 100}€ | ${JSON.stringify(r.gruende)}`);
  }
  const f = out.filter((x) => x.urteil === 'freigeben').length;
  console.log(`\nFERTIG: ${out.length} — freigeben ${f}, ablehnen ${out.length - f}`);
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
