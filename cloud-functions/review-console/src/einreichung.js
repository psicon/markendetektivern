'use strict';
/**
 * Produktfoto-Einreichungen für die Prüfkonsole: Zeile, Vorprüfung, EAN-
 * Nachbarn und Warteschlange — ohne Firestore-Zugriff, damit es Tests gibt
 * (index.js ruft beim Laden initializeApp auf und ist deshalb nicht testbar).
 *
 * Alle Werte kommen aus src/werte.js, derselben Quelle wie die Morgenrunde.
 * Vorher las die Konsole nur Nutzer- und Namer-Felder: ein nachgelesener Name
 * stand als „(ohne Name) · Kein Name erkennbar" da, eine nachgelesene EAN als
 * „Barcode fehlt", und eine Einreichung mit nur nachgelesener EAN wurde nie
 * gegen Doppel geprüft.
 */
const { evaluateDuplicate, completenessCheck, ms } = require('./duplicatePolicy');
const { eanOf, nameOf, preisOf, policyOf, herstellerAnzeige, vollstaendigkeitOf, herkunftOf } = require('./werte');

const REQUIRED_STEPS = ['front', 'rueckseite', 'hersteller', 'ean', 'naehrwerte', 'zutaten', 'preis'];
const SLOTS = new Set(REQUIRED_STEPS);
// Werte, die in der Konsole in HTML-Attribute wandern, dürfen NUR aus einer
// bekannten Menge kommen. Seit 26.09.2026 sperren die Regeln fremde Status-
// Werte beim Anlegen — Altbestand kann sie trotzdem tragen.
const UPLOAD_STATUSES = new Set(['pending', 'approved', 'rejected']);
const safeStatus = (v) => (UPLOAD_STATUSES.has(v) ? v : 'unknown');

/**
 * Fotos, die der Namer als beim Hochladen beschädigt erkannt hat
 * (`productNameOcrBildDefekt`, abgeschnittene Dateien aus dem Android-Upload).
 * Nur bekannte Slots — der Wert landet in der Oberfläche.
 */
function bildDefektOf(x) {
  const liste = Array.isArray(x.productNameOcrBildDefekt) ? x.productNameOcrBildDefekt : [];
  const out = [];
  for (const e of liste) {
    const slot = typeof e === 'string' ? e : e && e.slot;
    if (!SLOTS.has(slot) || out.some((o) => o.slot === slot)) continue;
    out.push({ slot, grund: e && typeof e.grund === 'string' ? e.grund.slice(0, 80) : null });
  }
  return out;
}

function rowOf(d) {
  const x = d.data() || {};
  // Angezeigt wird, was auch die Regeln sehen (src/werte.js): Nutzer → Namer →
  // nachgelesen. Top-Level-Felder wie `priceCents`/`manufacturer` zählen nie —
  // sie wären vom Client frei wählbar; die Namer- und Nachlese-Felder schreibt
  // nur der Server (firestore.rules sperrt sie beim Anlegen).
  const herkunft = herkunftOf(x);
  const preis = preisOf(x);
  const priceCents = preis && Number.isFinite(preis.priceCents) && preis.priceCents > 0 ? preis.priceCents : null;
  const bildArt = herkunft.preisNachgelesen ? x.priceRescueOcr.priceImageKind : x.priceImageKind;
  return {
    id: d.id,
    status: safeStatus(x.status),
    statusRaw: typeof x.status === 'string' ? x.status.slice(0, 40) : null,
    userId: x.userId ?? null,
    campaignId: x.campaignId ?? null,
    marketId: x.marketId ?? null,
    marketName: x.marketName ?? null,
    marketLand: x.marketLand ?? null,
    // Rohfelder bleiben (Suche, Nachvollziehbarkeit) …
    productName: x.productName ?? null,
    productNameOcr: x.productNameOcr ?? null,
    productNameRescueOcr: x.productNameRescueOcr ?? null,
    ean: x.ean ?? null,
    // … angezeigt und geprüft wird der effektive Wert.
    anzeigeName: nameOf(x),
    anzeigeEan: eanOf(x),
    herkunft,
    images: x.images ?? {},
    bildDefekt: bildDefektOf(x),
    stepCount: x.stepCount ?? Object.keys(x.images || {}).length,
    createdAt: ms(x.createdAt),
    updatedAt: ms(x.updatedAt),
    reviewedAt: ms(x.reviewedAt),
    reviewedBy: x.reviewedBy ?? null,
    holdReasons: Array.isArray(x.holdReasons) ? x.holdReasons : [],
    rejectReason: x.rejectReason ?? null,
    reviewNote: x.reviewNote ?? null,
    rewardCents: x.rewardCents ?? null,
    rewardResult: x.rewardResult ?? null,
    rewardNotCreditedReason: x.rewardNotCreditedReason ?? null,
    // Woher das Aktionskennzeichen stammt und worauf der Client es stützte
    // (86cbet2nw) — im Prüf-Werkzeug sichtbar, damit ein fehlender Betrag
    // beim Fall selbst auffällt statt erst bei einem Ledger-Abgleich.
    campaignQuelle: x.campaignQuelle ?? null,
    campaignResolve: x.campaignResolve ?? null,
    rewardSkipped: x.rewardSkipped ?? null,
    rewardSkippedReason: x.rewardSkippedReason ?? null,
    rewardLocationRule: x.rewardLocationRule ?? null,
    clientVersion: x.clientVersion ?? null,
    capture: x.capture
      ? { gpsStatus: x.capture.gpsStatus ?? null, confirmedPlace: x.capture.confirmedPlace ?? null, capturedAt: ms(x.capture.capturedAt), hasGps: !!x.capture.gps }
      : null,
    priceCents,
    // Hersteller zur ANZEIGE inklusive Nachlesung; die Doppel-Regel nimmt nur
    // den Namer-Wert (policyOf).
    manufacturer: herstellerAnzeige(x),
    // Was das „Preis"-Bild zeigt: bei nachgelesenem Preis die Art dieser Lesung.
    priceImageKind: typeof x.priceImageKind === 'string' ? x.priceImageKind : null,
    priceImageKindAnzeige: typeof bildArt === 'string' ? bildArt : null,
    priceReceipt: x.priceReceipt
      ? { merchant: x.priceReceipt.merchant ?? null, street: x.priceReceipt.street ?? null, zip: x.priceReceipt.zip ?? null, city: x.priceReceipt.city ?? null, bonDate: x.priceReceipt.bonDate ?? null, complete: !!x.priceReceipt.complete }
      : null,
    review: x.review ?? null,
    // Intern (vor der Auslieferung entfernt, stripPolicy): Eingaben der Regeln.
    _policy: policyOf(d.id, x),
    _komplett: vollstaendigkeitOf(x),
  };
}

/** Entfernt die internen Regel-Eingaben (`_policy`, `_komplett`) vor der Auslieferung. */
function stripPolicy(row) {
  const { _policy, _komplett, ...rest } = row;
  return rest;
}

const OHNE_DOPPEL = { verdict: 'ok', reason: null, priorId: null, priorUserId: null, sameUser: null, lockUntil: null, updatedFields: [], diff: null };

/** Vorprüfung eines Kandidaten gegen die Einreichungen derselben (effektiven) EAN — wie die Morgenrunde. */
function precheckOf(row, sameEanRows) {
  const completeness = completenessCheck(row._komplett, REQUIRED_STEPS);
  const others = (sameEanRows || []).filter((r) => r.id !== row.id).map((r) => r._policy);
  const dup = row._policy.ean ? evaluateDuplicate(row._policy, others) : OHNE_DOPPEL;
  const reasons = [...completeness.problems];
  if (dup.verdict === 'locked' || dup.verdict === 'hold') reasons.push(dup.reason);
  const verdict = !completeness.ok ? 'incomplete' : dup.verdict === 'ok' ? 'ok' : dup.verdict;
  return { verdict, reasons, missing: completeness.missing, dup };
}

/**
 * Urteil für die Fall-Ansicht. Ein entschiedener Fall zeigt das Urteil, das
 * bei der Entscheidung galt (`review.precheck`) — frisch gerechnet widersprach
 * die Direktansicht dem Tagesbericht („unvollständig" bei einem Fall, den die
 * Runde mit nachgelesenem Namen freigegeben hatte). `quelle` macht sichtbar,
 * welches der beiden Urteile dasteht.
 *
 * Fehlt im gespeicherten Urteil der Doppel-Befund (Morgenrunde bis 26.09.2026),
 * wird er heute berechnet und als solcher gekennzeichnet (`dupQuelle`) — sonst
 * fehlt genau bei den Sperr-Ablehnungen, die man zurückholen will, die Referenz.
 * Urteil und Gründe bleiben die gespeicherten.
 */
function precheckFuerFall(row, sameEanRows) {
  const gespeichert = row.review && row.review.precheck;
  if (row.status !== 'pending' && gespeichert && typeof gespeichert === 'object') {
    if (gespeichert.dup) return { ...gespeichert, dupQuelle: 'gespeichert', quelle: 'gespeichert' };
    return { ...gespeichert, dup: precheckOf(row, sameEanRows).dup, dupQuelle: 'heute', quelle: 'gespeichert' };
  }
  return { ...precheckOf(row, sameEanRows), quelle: row.status === 'pending' ? 'frisch' : 'nachtraeglich' };
}

/** Dokumente → Zeilen, doppelte (über beide EAN-Felder gefunden) nur einmal. */
function eindeutigeZeilen(docs) {
  const byId = new Map();
  for (const d of docs) if (!byId.has(d.id)) byId.set(d.id, rowOf(d));
  return [...byId.values()];
}

/**
 * Nachbarn einer EAN aus den Treffern beider Abfragen (`ean` und `eanRescueOcr`).
 * Gezählt wird nur, wessen EFFEKTIVE EAN passt — genau wie die Runde gruppiert
 * (eanOf): eine Einreichung mit gescannter EAN A und nachgelesener B gehört zu A.
 */
function nachbarnAus(docs, ean, ohneId) {
  return eindeutigeZeilen(docs).filter((r) => r.id !== ohneId && r.anzeigeEan === ean);
}

/** Treffer beider Abfragen → Zeilen je effektiver EAN. */
function gruppiereNachEan(docs) {
  const out = new Map();
  for (const r of eindeutigeZeilen(docs)) {
    if (!r.anzeigeEan) continue;
    if (!out.has(r.anzeigeEan)) out.set(r.anzeigeEan, []);
    out.get(r.anzeigeEan).push(r);
  }
  return out;
}

/** Felder, die der EAN-Index der Warteschlange aus dem Bestand liest (select). */
const INDEX_FELDER = ['userId', 'ean', 'eanRescueOcr', 'marketId', 'status', 'createdAt', 'priceOcr', 'priceRescueOcr', 'manufacturerOcr'];

/**
 * EAN-Nachbarschafts-Index der Warteschlange aus dem schlanken Bestand.
 *
 * WICHTIG: dieselbe Form wie `rowOf` sie liefert, also mit `_policy`. Früher
 * standen hier flache Objekte ohne dieses Feld — `precheckOf` liest aber genau
 * `_policy`, bekam eine Liste aus lauter `undefined` und meldete jede
 * Einreichung als unauffällig (83 gesperrte Fälle erschienen grün).
 */
function eanIndex(docs) {
  const index = new Map();
  for (const d of docs) {
    const policy = policyOf(d.id, d.data() || {});
    if (!policy.ean) continue;
    if (!index.has(policy.ean)) index.set(policy.ean, []);
    index.get(policy.ean).push({ ...policy, _policy: policy });
  }
  return index;
}

/** Die Warteschlange der Produktfotos aus den offenen Dokumenten und dem Index. */
function baueFotoListe(openDocs, byEan, p, q) {
  let rows = openDocs.map((d) => {
    const r = rowOf(d);
    const pre = precheckOf(r, byEan.get(r.anzeigeEan) || []);
    return {
      id: r.id, userId: r.userId, productName: r.anzeigeName, ean: r.anzeigeEan,
      nameNachgelesen: r.herkunft.nameQuelle === 'nachgelesen', eanNachgelesen: r.herkunft.eanNachgelesen,
      marketName: r.marketName || r.marketId, createdAt: r.createdAt, campaignId: r.campaignId,
      priceCents: r.priceCents, manufacturer: r.manufacturer, priceImageKind: r.priceImageKindAnzeige,
      stepCount: r.stepCount, verdict: pre.verdict, reasons: pre.reasons,
      // Nur für die Suche, wird unten entfernt.
      _suche: [r.id, r.userId, r.anzeigeName, r.productName, r.productNameOcr, r.productNameRescueOcr, r.anzeigeEan, r.ean, r.marketName, r.manufacturer],
    };
  });
  if (q) rows = rows.filter((r) => r._suche.some((v) => v && String(v).toLowerCase().includes(q)));
  rows = rows.map(({ _suche, ...r }) => r);
  if (p.verdict && p.verdict !== 'all') rows = rows.filter((r) => r.verdict === p.verdict);
  rows.sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const counts = rows.reduce((acc, r) => ((acc[r.verdict] = (acc[r.verdict] || 0) + 1), acc), {});
  return { type: 'photos', rows, total: rows.length, counts };
}

module.exports = {
  REQUIRED_STEPS, INDEX_FELDER, safeStatus, rowOf, stripPolicy, precheckOf, precheckFuerFall,
  nachbarnAus, gruppiereNachEan, eanIndex, baueFotoListe, bildDefektOf,
};
