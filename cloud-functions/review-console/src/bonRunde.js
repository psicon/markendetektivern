'use strict';
/**
 * Morgenrunde für Bons in `review` — täglich 07:45 (Europe/Berlin), also vor
 * der Foto-Runde um 08:00, die das Ergebnis in ihren Tagesbericht übernimmt.
 * Regeln: src/bonRegeln.js. Entscheiden tut immer der SERVER-Resolver
 * (resolveCashbackReview) — er rechnet Deckel und Budget in der Ledger-
 * Transaktion und schreibt Spiegel, Positionen und Push.
 *
 * Schalter: `cashback_config/v1.bonWorker === true` → scharf, sonst Trockenlauf
 * (liest nach, entscheidet nichts, schreibt nur den Bericht).
 *
 * Berichte: `ops_bonrunden/{tag}` = letzter fertiger Lauf des Tages (liest die
 * Foto-Runde), `ops_bonrunden/{lauf}` = jeder Lauf einzeln, beim Start mit
 * `laeuft: true` angelegt — bricht ein Lauf ab, bleibt dieser Stand sichtbar.
 */
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');
const { GoogleGenAI, Type } = require('@google/genai');
const { bearbeitbar, konfliktLage, betragsGrenzen, zwillingsUrteil, entscheideBon, budgetUrteil, wirksameAktionId, beanstandungGilt, LIVE, MERKEN } = require('./bonRegeln');
const { mitWiederholung, arbeite } = require('./ki');
const { resolverAufruf } = require('./resolverAufruf');

const MODELL = 'gemini-3.5-flash';
const SAMMLUNG = 'ops_bonrunden';
// Zeitplan innerhalb der 900 s der Function (Prüfrunde 3: Wiederholungen mit
// Pausen machten die alte Rechnung „2 × 90 s" zu knapp):
//  - nach 7 min wird kein neuer Bon begonnen,
//  - Lesen muss nach 11 min fertig sein (jeder Versuch kappt sein Zeitlimit
//    auf die Restzeit, ohne Rest kein neuer Versuch),
//  - nach 12½ min wird der Resolver nicht mehr aufgerufen (nicht aufrufen
//    bucht nie etwas — sicher); danach bleiben 75 s Resolver + Bericht.
const FRIST_MS = 7 * 60 * 1000;
const LESEN_BIS_MS = 11 * 60 * 1000;
const RESOLVER_BIS_MS = 12.5 * 60 * 1000;
const LESE_TIMEOUT_MS = 90 * 1000;
const ms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : null);
const berlinTag = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const berlinZeit = (t) => new Date(t).toLocaleTimeString('sv-SE', { timeZone: 'Europe/Berlin' }).replace(/:/g, '');

// Zweitlesung — Wortlaut aus den Handrunden 19.–24.09. (.pruefe-bons-*-nach.js),
// mit den zwei Korrekturen, die dort nötig waren: eBon/Screenshot IST ein Bon,
// „manipuliert" nur bei sichtbaren Bearbeitungsspuren. Dazu das deutsche
// Datumsformat — die Tag/Jahr-Verwechslung (23.09.26 → 2023-09-26) an der Wurzel.
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
  'istKassenbon: ist das ein echter Kassenbon eines Einzelhändlers? Ein digitaler Bon (eBon) oder ein sauberer Screenshot der Bon-Ansicht einer Händler-App IST ein Kassenbon.',
  'markt: Name des Geschäfts laut Bonkopf.',
  'datum: Kaufdatum als YYYY-MM-DD. Deutsche Bons schreiben TT.MM.JJ oder TT.MM.JJJJ — 23.09.26 ist 2026-09-23.',
  'endsummeCent: die Endsumme in Cent (23,45 € = 2345).',
  'anzahlPositionen: Anzahl der gekauften Artikelzeilen.',
  'manipuliert: NUR true bei sichtbaren Spuren einer Bearbeitung (überklebte oder retuschierte Stellen, montierte Bildteile, widersprüchliche Schriftarten). Ein Foto vom Bildschirm oder ein eBon allein ist KEINE Manipulation.',
  'grund: max. 15 Wörter.',
  'Wenn ein Wert nicht sicher lesbar ist: leerer String bzw. 0.',
].join('\n');

async function zweitlesung(ai, storage, pfad, bis = Infinity) {
  const datei = storage.file(pfad);
  const [meta] = await datei.getMetadata();
  const [buf] = await datei.download();
  const rest = () => bis - Date.now();
  const lesen = () => mitWiederholung(() => {
    if (rest() < 15000) throw new Error('Zeitbudget der Runde aufgebraucht');
    return ai.models.generateContent({
    model: MODELL,
    contents: [{ role: 'user', parts: [{ text: PROMPT }, { inlineData: { mimeType: meta.contentType || 'image/jpeg', data: buf.toString('base64') } }] }],
    config: {
      responseMimeType: 'application/json', responseSchema: SCHEMA, temperature: 0.1, maxOutputTokens: 16000,
      thinkingConfig: { thinkingLevel: 'LOW' },
      // Ohne eigenes Zeitlimit kann ein hängender Aufruf die ganze Runde ins
      // Funktions-Timeout ziehen — dann fehlt der Bericht.
      abortSignal: AbortSignal.timeout(Math.min(LESE_TIMEOUT_MS, rest())),
    },
    });
  });
  // Ein Abbruch nach 90 s ist eine hängende Verbindung, kein Urteil über den
  // Bon — einmal neu versuchen (Vergleichslauf 24.09.: 1 von 16), wenn Zeit ist.
  let res;
  try { res = await lesen(); } catch (e) {
    if (!/abort/i.test(`${e && e.name} ${e && e.message}`) || rest() < 60000) throw e;
    res = await lesen();
  }
  const v = res.text ? JSON.parse(res.text) : {};
  // Ein leeres Ergebnis darf nie als „geprüft" durchgehen (19.09.: das Denken
  // verbrauchte das Budget, `text` kam leer — ohne Fehler).
  if (typeof v.istKassenbon !== 'boolean') throw new Error('Zweitlesung ohne Inhalt');
  return v;
}

/** Andere Bons mit gleichem Fingerabdruck (frisch gelesen, sieht die Entscheidungen dieses Laufs). */
async function zwillinge(db, bon) {
  const out = new Map();
  for (const f of ['contentHash', 'transactionHash', 'itemsHash']) {
    if (!bon[f]) continue;
    const q = await db.collection('receipts').where(f, '==', bon[f]).limit(25).get();
    q.docs.forEach((o) => {
      if (o.id === bon.id) return;
      const d = o.data();
      if (!LIVE.has(d.status)) return;
      const t = out.get(o.id) || { id: o.id, userId: d.userId, status: d.status, bonTime: d.bonTime || null, createdMs: ms(d.createdAt) || 0, fields: [] };
      t.fields.push(f);
      out.set(o.id, t);
    });
  }
  return [...out.values()];
}

/**
 * @param {object} o
 * @param {boolean} o.dryRun
 * @param {string} o.projekt
 * @param {string} [o.schluessel]  Admin-Schlüssel für den Resolver (nur scharf nötig)
 * @param {string[]} [o.vergleich]  schon entschiedene Bons als „review" durchrechnen, nichts schreiben
 */
async function bonRunde({ dryRun = false, projekt, bucketName, schluessel = null, ausloeser = 'zeitplan', vergleich = null } = {}) {
  if (vergleich) dryRun = true;
  const db = admin.firestore();
  const storage = admin.storage().bucket(bucketName || `${projekt}.appspot.com`);
  const ai = new GoogleGenAI({ vertexai: true, project: projekt, location: 'global' });
  const start = Date.now();
  const tag = berlinTag(start);
  const lauf = `${tag}_${berlinZeit(start)}`;
  const frist = start + FRIST_MS;

  if (!vergleich) await db.collection(SAMMLUNG).doc(lauf).set({ tag, lauf, ausloeser, dryRun, laeuft: true, laufAt: FieldValue.serverTimestamp() });
  const cfg = (await db.doc('cashback_config/v1').get()).data() || {};

  let bons;
  if (vergleich) {
    const snaps = await db.getAll(...[...new Set(vergleich)].map((id) => db.doc(`receipts/${id}`)));
    bons = snaps.filter((s) => s.exists).map((s) => ({ id: s.id, ...s.data(), vorher: s.get('status'), status: 'review' }));
  } else {
    bons = (await db.collection('receipts').where('status', '==', 'review').get()).docs.map((d) => ({ id: d.id, ...d.data() }));
  }
  bons.forEach((b) => { b.createdMs = ms(b.createdAt) || 0; });
  bons.sort((a, b) => a.createdMs - b.createdMs);

  // Pro Person nacheinander (älteste zuerst — das Original wird vor seiner
  // Kopie entschieden, Deckel sehen denselben Stand), Personen parallel.
  const jePerson = new Map();
  bons.forEach((b) => { const u = b.userId || '?'; if (!jePerson.has(u)) jePerson.set(u, []); jePerson.get(u).push(b); });
  const plan = [];
  // Budget je Aktion: Stand beim ersten Lesen im Lauf, davon alles abgezogen,
  // was dieser Lauf freigibt (Personen laufen parallel). Die Reservierung bleibt
  // nach einer Buchung stehen und fällt nur weg, wenn sicher nicht gebucht
  // wurde. Geprüft wird gegen min(frisch gelesen, Startstand − reserviert):
  // „frisch" sieht Buchungen der Pipeline, „Start − reserviert" die eigenen,
  // auch solange der Resolver noch antwortet (Prüfrunde 4: sonst doppelt gezählt).
  const reserviert = new Map();
  const budgetStart = new Map();
  const liegen = await arbeite([...jePerson.values()], async (liste) => {
    for (const b of liste) {
      const eintrag = { id: b.id, userId: b.userId || null, markt: b.merchant?.name || null, datum: b.bonDate || null, cents: Number(b.cashbackCents) || 0, vorher: b.vorher || null };
      // Frist auch innerhalb einer Person: sonst kann ein großer Rückstau die
      // Funktion ins Timeout ziehen, nachdem schon gebucht wurde.
      if (Date.now() > frist) { Object.assign(eintrag, { entscheidung: 'offen', grund: 'zeit_abgelaufen' }); plan.push(eintrag); continue; }
      try {
        let zw = null; let zweit = null; let zweitFehler = null; let aktion = null;
        const cid = wirksameAktionId(b);
        if (bearbeitbar(b)) {
          const { konflikte } = konfliktLage(b);
          zw = zwillingsUrteil(b, await zwillinge(db, b), { zeitUnsicher: konflikte.includes('bonTime') });
          if (!zw && !beanstandungGilt(b)) {
            const pfad = b.storage?.path || b.storagePath || b.capture?.storagePath;
            if (!pfad) zweitFehler = 'kein Bildpfad';
            else { try { zweit = await zweitlesung(ai, storage, pfad, start + LESEN_BIS_MS); } catch (e) { zweitFehler = String(e.message || e); } }
          }
          // Aktion frisch lesen: für die Betragsgrenzen und direkt danach fürs Budget.
          aktion = cid ? (await db.doc(`cashback_campaigns/${cid}`).get()).data() || null : null;
        }
        let e = entscheideBon({ bon: b, zwilling: zw, zweit, zweitFehler, grenzen: betragsGrenzen(aktion, cfg) });
        if (aktion && cid && !budgetStart.has(cid)) budgetStart.set(cid, Number.isFinite(aktion.budgetRemainingCents) ? aktion.budgetRemainingCents : 0);
        if (e.entscheidung === 'freigeben') {
          const frisch = Number.isFinite(aktion?.budgetRemainingCents) ? aktion.budgetRemainingCents : 0;
          const rest = Math.min(frisch, (budgetStart.get(cid) ?? frisch) - (reserviert.get(cid) || 0));
          e = budgetUrteil(b, aktion ? { ...aktion, budgetRemainingCents: rest } : aktion) || e;
        }
        // Reservieren SOFORT nach der Prüfung, vor dem nächsten await — sonst
        // besteht die parallel laufende Person dieselbe Prüfung mit demselben Rest.
        const reservierung = e.entscheidung === 'freigeben' ? Number(b.cashbackCents) || 0 : 0;
        if (reservierung) reserviert.set(cid, (reserviert.get(cid) || 0) + reservierung);
        // Gebucht (oder unklar, ob gebucht) → Reservierung bleibt. Sicher nicht
        // gebucht → zurückgeben. Im Trockenlauf bleibt sie immer stehen.
        let vielleichtGebucht = false;
        const freigeben = () => { if (reservierung && !dryRun && !vielleichtGebucht) reserviert.set(cid, (reserviert.get(cid) || 0) - reservierung); };
        Object.assign(eintrag, e, { zweit: zweit ? { datum: zweit.datum, endsummeCent: zweit.endsummeCent, markt: zweit.markt, anzahlPositionen: zweit.anzahlPositionen } : null });

        // Scharf wird die Reservierung in jedem Fall wieder frei, auch bei Fehlern.
        try {
          const merken = (e.gruende || []).filter((g) => MERKEN.has(g));
          if (!dryRun && merken.length) {
            // Merken: ein Fall, den die Zweitlesung einmal nicht bestätigen konnte,
            // wird nicht an einem späteren Morgen so lange nachgelesen, bis eine
            // Lesung zufällig passt. updatedAtMs: wird der Bon neu verarbeitet,
            // gilt die Beanstandung nicht mehr.
            await db.doc(`receipts/${b.id}`).set({ bonRundeBeanstandet: { tag, gruende: merken, zweit: eintrag.zweit, grundText: (zweit && zweit.grund) || null, updatedAtMs: ms(b.updatedAt) } }, { merge: true });
          }

          if (!dryRun && e.entscheidung !== 'offen') {
            // Unmittelbar vor der Entscheidung frisch lesen: wurde der Bon seit dem
            // Laden neu verarbeitet, hat niemand die neuen Werte verglichen.
            const frisch = (await db.doc(`receipts/${b.id}`).get()).data() || {};
            if (Date.now() > start + RESOLVER_BIS_MS) {
              Object.assign(eintrag, { entscheidung: 'offen', grund: 'zeit_abgelaufen' });
            } else if (frisch.status !== 'review' || ms(frisch.updatedAt) !== ms(b.updatedAt)) {
              Object.assign(eintrag, { entscheidung: 'offen', grund: 'veraendert', hinweis: `Status jetzt ${frisch.status}` });
            } else {
              const aufruf = e.entscheidung === 'freigeben' ? { decision: 'approve' }
                : { decision: 'reject', reason: e.grund, duplicateOf: e.duplicateOf, priorStatus: e.priorStatus };
              const r = await resolverAufruf({ receiptId: b.id, schluessel, ...aufruf });
              vielleichtGebucht = aufruf.decision === 'approve' && (r.ok ? r.status === 'approved' : (r.code === 'netzwerk' || r.http >= 500));
              if (r.ok) {
                let grund = r.capReason || null;
                if (r.status === 'no_reward' && !grund) grund = (await db.doc(`receipts/${b.id}`).get()).get('rejectReason') || null;
                eintrag.ergebnis = { http: r.http, status: r.status || null, grund, gebuchtCents: Number(r.creditedCents) || 0 };
                await db.doc(`receipts/${b.id}`).set({ reviewConsole: { decidedBy: 'worker-bonrunde', decision: aufruf.decision, reason: aufruf.reason || null, at: FieldValue.serverTimestamp() } }, { merge: true }).catch(() => {});
              } else if (r.code === 'netzwerk' || r.http >= 500) {
                // Zeitüberschreitung (bei uns oder als 504 von Cloud Run nach den
                // 60 s des Resolvers): er kann trotzdem gebucht haben. Nachlesen
                // statt „offen, 0 gebucht" melden.
                const nach = (await db.doc(`receipts/${b.id}`).get()).data() || {};
                // Nur ein Endstatus, der zu UNSERER Entscheidung passt, gilt als
                // Ergebnis — alles andere (neu verarbeitet, von Hand abgelehnt) ist
                // ein veränderter Fall, kein Erfolg.
                // Hat inzwischen ein Mensch in der Konsole entschieden, ist es nicht
                // unser Ergebnis — nicht mitzählen, seinen Vermerk nicht überschreiben.
                const fremd = nach.reviewConsole && nach.reviewConsole.decidedBy && nach.reviewConsole.decidedBy !== 'worker-bonrunde';
                const passt = !fremd && (aufruf.decision === 'approve' ? ['approved', 'no_reward'].includes(nach.status) : nach.status === 'rejected');
                if (passt) {
                  eintrag.ergebnis = { http: 0, status: nach.status, grund: nach.rejectReason || null, gebuchtCents: nach.status === 'approved' ? Number(nach.cashbackCents) || 0 : 0, nachgelesen: true };
                  await db.doc(`receipts/${b.id}`).set({ reviewConsole: { decidedBy: 'worker-bonrunde', decision: aufruf.decision, reason: aufruf.reason || null, nachgelesen: true, at: FieldValue.serverTimestamp() } }, { merge: true }).catch(() => {});
                } else if (nach.status && nach.status !== 'review') {
                  Object.assign(eintrag, { entscheidung: 'offen', grund: 'veraendert_nach_aufruf', technik: true, hinweis: `Status jetzt ${nach.status}` });
                } else {
                  Object.assign(eintrag, { entscheidung: 'offen', grund: `resolver_${r.code || r.http}`, technik: true });
                }
              } else {
                // 409 = jemand anders entscheidet gerade / schon entschieden — kein
                // Urteil, der Bon ist morgen wieder dran. Alles andere ist Technik.
                Object.assign(eintrag, { entscheidung: 'offen', grund: `resolver_${r.code || r.http}`, technik: r.http !== 409 });
              }
            }
          }
        } finally { freigeben(); }
      } catch (err) {
        Object.assign(eintrag, { entscheidung: 'offen', grund: 'technik', technik: true, hinweis: String(err.message || err).slice(0, 140) });
      }
      plan.push(eintrag);
    }
  }, 3, frist);
  liegen.flat().forEach((b) => plan.push({ id: b.id, userId: b.userId || null, markt: b.merchant?.name || null, datum: b.bonDate || null, entscheidung: 'offen', grund: 'zeit_abgelaufen' }));

  // Mehr Freigaben einer Person für denselben Bon-Tag als das Tageslimit: welcher
  // Bon bezahlt wurde, entschied die Reihenfolge (CLAUDE.md 19.09.: ausweisen).
  const tageslimit = Number.isFinite(cfg.dailyCap) ? cfg.dailyCap : 1;
  const proTag = new Map();
  plan.filter((p) => p.entscheidung === 'freigeben').forEach((p) => {
    const k = `${p.userId}|${p.datum}`; proTag.set(k, (proTag.get(k) || 0) + 1);
  });
  plan.forEach((p) => { if (p.entscheidung === 'freigeben' && proTag.get(`${p.userId}|${p.datum}`) > tageslimit) p.hinweis = [p.hinweis, 'mehr Bons desselben Tages als das Tageslimit'].filter(Boolean).join(' · '); });

  const freigabe = plan.filter((p) => p.entscheidung === 'freigeben');
  const zaehle = (k) => plan.filter((p) => p.entscheidung === k).length;
  const offenGruende = {};
  plan.filter((p) => p.entscheidung === 'offen').forEach((p) => { offenGruende[p.grund] = (offenGruende[p.grund] || 0) + 1; });
  const bericht = {
    tag, lauf, ausloeser, dryRun, laeuft: false,
    laufAt: FieldValue.serverTimestamp(),
    dauerSekunden: Math.round((Date.now() - start) / 1000),
    geprueft: plan.length,
    // Scharf zählt, was der Server wirklich gebucht hat; im Trockenlauf die Absicht.
    freigegeben: dryRun ? freigabe.length : freigabe.filter((p) => p.ergebnis?.status === 'approved').length,
    // Freigaben, die der Server ohne Prämie abschloss (Tages-/Wochen-/Kopf-Deckel, Budget):
    gedeckelt: freigabe.filter((p) => p.ergebnis?.status === 'no_reward').length,
    budgetEnde: freigabe.filter((p) => p.ergebnis?.grund === 'campaign_budget_exhausted').length,
    abgelehnt: zaehle('ablehnen'),
    offen: zaehle('offen'),
    offenGruende,
    technikFehler: plan.filter((p) => p.technik).length,
    tagesKollisionen: [...proTag.values()].filter((n) => n > tageslimit).length,
    gebuchtCents: plan.reduce((s, p) => s + (p.ergebnis?.gebuchtCents || 0), 0),
    faelle: plan.slice(0, 100).map((p) => ({ id: p.id, markt: p.markt || null, datum: p.datum || null, entscheidung: p.entscheidung, grund: p.grund || null, hinweis: p.hinweis || null, ergebnis: p.ergebnis || null })),
  };
  if (vergleich) return { ...bericht, plan };
  await Promise.all([db.collection(SAMMLUNG).doc(lauf).set(bericht), db.collection(SAMMLUNG).doc(tag).set(bericht)]);
  logger.info('Bon-Runde fertig', { lauf, dryRun, geprueft: bericht.geprueft, freigegeben: bericht.freigegeben, offen: bericht.offen, technikFehler: bericht.technikFehler });
  return { ...bericht, laufAt: new Date().toISOString() };
}

module.exports = { bonRunde, SAMMLUNG };
