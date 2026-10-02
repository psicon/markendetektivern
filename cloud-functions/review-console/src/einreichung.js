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
const { eanOf, nameOf, preisOf, policyOf, herstellerAnzeige, vollstaendigkeitOf, herkunftOf, eanFotoBefund, eanSchluessel, EAN_HALTEN } = require('./werte');
const { RUNDE_SPERREND, DOPPEL_GRUENDE } = require('./fotoRundeRegeln');

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

/**
 * Nummer vom Barcode-Foto (Morgenrunde, `eanFotoOcr`) gegen die gespeicherte —
 * dieselbe Rechnung wie in der Runde (werte.eanFotoBefund), dazu der
 * gespeicherte Befund, wo er strenger ist. `eanFotoOcr` schreibt nur der
 * Server (firestore.rules).
 *
 *  - Gespeichert `abweichend`/`unsicher` → hält, egal was die Neuberechnung
 *    ergibt (Prüfrunde 2, 02.10.2026): der Befund gilt, bis ein Mensch
 *    entscheidet — `unsicher` steht als solcher da (aus der ersten Lesung
 *    allein sähe er wie eine bestätigte Abweichung aus), eine gespeicherte
 *    Abweichung, die sich heute nicht mehr nachrechnen lässt, als `unsicher`.
 *  - Ergibt die Neuberechnung `zweifelhaft` (falsche Prüfziffer, weit weg von
 *    der gespeicherten Nummer), kann die Konsole keine zweite Lesung machen →
 *    `unsicher` (fail-closed).
 */
function eanFotoZeile(x) {
  const o = x.eanFotoOcr;
  if (!o || typeof o !== 'object') return null;
  const b = eanFotoBefund(x.ean, o.ean);
  let art = b.art;
  if (EAN_HALTEN.has(o.befund)) art = o.befund === 'abweichend' && b.art === 'abweichend' ? 'abweichend' : 'unsicher';
  else if (b.art === 'zweifelhaft') art = 'unsicher';
  const zweit = typeof o.zweit === 'string' ? o.zweit.replace(/\D/g, '').slice(0, 14) || null : null;
  return {
    ...b, art,
    ...(art === 'unsicher' ? { gelesen: b.gelesen, roh: String(o.ean ?? '').replace(/\D/g, '').slice(0, 14) || null, zweit } : {}),
    ...(typeof o.bestaetigt === 'boolean' ? { bestaetigt: o.bestaetigt } : {}),
    at: ms(o.at),
  };
}

const SPERREND = new Set(RUNDE_SPERREND);
const kurz = (v, n) => (typeof v === 'string' && v ? v.slice(0, n) : null);

/**
 * Was die Morgenrunde an einer offenen Einreichung hinterlassen hat
 * (`review.rundeOffen`, fotoRundeRegeln.rundeOffenEintrag) — bereinigt, denn
 * die Werte landen in der Oberfläche. `sperrend` nur aus der bekannten Menge.
 */
function rundeOffenOf(x) {
  const r = x.review && typeof x.review === 'object' ? x.review.rundeOffen : null;
  if (!r || typeof r !== 'object') return null;
  return {
    grund: kurz(r.grund, 60),
    geplant: r.geplant === 'freigeben' || r.geplant === 'ablehnen' ? r.geplant : null,
    hinweis: kurz(r.hinweis, 300),
    zurueckgehalten: kurz(r.zurueckgehalten, 60),
    sperrend: Array.isArray(r.sperrend) ? [...new Set(r.sperrend.filter((c) => SPERREND.has(c)))] : [],
    lauf: kurz(r.lauf, 40),
    trocken: r.trocken === true,
    at: ms(r.at),
  };
}

/**
 * Woraus eine Einreichung zurückgeholt wurde (`review.wiedereroeffnet`, gesetzt
 * von „Zurückholen" in der Prüfkonsole, Schlussprüfung 03.10.2026) —
 * bereinigt, die Werte landen in der Oberfläche.
 */
function wiedereroeffnetOf(x) {
  const w = x.review && typeof x.review === 'object' ? x.review.wiedereroeffnet : null;
  if (!w || typeof w !== 'object') return null;
  return { vorherGrund: kurz(w.vorherGrund, 60), vorherIntern: kurz(w.vorherIntern, 60), vorherVon: kurz(w.vorherVon, 60) };
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
    eanFoto: eanFotoZeile(x),
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
    // Warum die Morgenrunde den Fall liegen ließ (Prüfrunde 2, 02.10.2026).
    rundeOffen: rundeOffenOf(x),
    // Woraus der Fall zurückgeholt wurde (Schlussprüfung 03.10.2026).
    wiedereroeffnet: wiedereroeffnetOf(x),
    // Intern (vor der Auslieferung entfernt, stripPolicy): Eingaben der Regeln —
    // mit dem Server-Zeitpunkt des Dokuments (werte.einreichZeit).
    _policy: policyOf(d.id, x, d.createTime),
    _komplett: vollstaendigkeitOf(x),
  };
}

/** Entfernt die internen Regel-Eingaben (`_policy`, `_komplett`) vor der Auslieferung. */
function stripPolicy(row) {
  const { _policy, _komplett, ...rest } = row;
  return rest;
}

const OHNE_DOPPEL = { verdict: 'ok', reason: null, priorId: null, priorUserId: null, sameUser: null, lockUntil: null, updatedFields: [], diff: null };

/**
 * Vorprüfung eines Kandidaten gegen die Einreichungen derselben (effektiven) EAN — wie die Morgenrunde.
 *
 * `hinweise` blockieren nichts, sie sagen dem Menschen, wo er hinsehen muss.
 * `preis_nicht_gelesen` (Preis-Pflicht 26.09.2026): vorher stand bei einer
 * Einreichung ohne Preis „Vorprüfung ok · Vollständig, kein Doppel" — ob der
 * Preis im Foto steht, sieht aber nur, wer hinschaut. Deshalb Hinweis statt
 * Sperre: ein sichtbarer, nur nicht gelesener Preis ist freigabefähig.
 *
 * Seit 02.10.2026 (Entscheidungen Patrick):
 *  - `kontoSperre` 'gesperrt' → Urteil `locked` (`konto_gesperrt`); die
 *    Freigabe verweigert der Server dann auch mit force. 'unbekannt' (Sperrliste
 *    nicht lesbar oder Eintrag unklar) → `hold`.
 *  - Zeigt das Barcode-Foto eine andere Nummer (`ean_abweichend`) → `hold`;
 *    mit `fotoEanRows` (Einreichungen unter der Foto-Nummer) wird die
 *    Doppel-Regel auch dort gerechnet (`dupFoto`) — eine falsch getippte EAN
 *    soll die Wochen-Sperre nicht umgehen. Bestätigte die zweite Lesung der
 *    Runde weder die eine noch die andere Nummer → `ean_unsicher`, ebenfalls `hold`.
 *  - Was die Morgenrunde bei einer OFFENEN Einreichung gefunden hat und die
 *    Konsole selbst nicht prüfen kann (`row.rundeOffen.sperrend`: gleiches
 *    Foto bei einem anderen Konto oder in einer älteren offenen/bezahlten
 *    Einreichung, abweichende oder unsichere Barcode-Nummer) → `hold`
 *    (Prüfrunde 2, 02.10.2026). Freigabe dann nur mit force + Notiz. Der
 *    nächste Lauf aktualisiert oder entfernt den Eintrag; jede Entscheidung
 *    ersetzt `review` und nimmt ihn mit.
 *  - Zurückgeholte Ablehnung als Doppel bzw. mit wiederverwendeten Fotos
 *    (`row.wiedereroeffnet`, DOPPEL_GRUENDE) → `hold` mit
 *    `zurueckgeholt_doppel` (Schlussprüfung 03.10.2026). Das Zurückholen
 *    ersetzt `review` und löscht `rejectReason` — ohne diesen Vermerk stand
 *    eine Runden-Ablehnung wegen wiederverwendeter Fotos danach als „ok" da
 *    (den md5-Abgleich kann die Konsole nicht selbst), F gab ohne Notiz frei.
 */
function precheckOf(row, sameEanRows, { kontoSperre = null, fotoEanRows = null } = {}) {
  const completeness = completenessCheck(row._komplett, REQUIRED_STEPS);
  const others = (sameEanRows || []).filter((r) => r.id !== row.id).map((r) => r._policy);
  const dup = row._policy.ean ? evaluateDuplicate(row._policy, others) : OHNE_DOPPEL;
  const reasons = [...completeness.problems];
  if (dup.verdict === 'locked' || dup.verdict === 'hold') reasons.push(dup.reason);
  let verdict = !completeness.ok ? 'incomplete' : dup.verdict === 'ok' ? 'ok' : dup.verdict;

  const ef = row.eanFoto && row.eanFoto.art === 'abweichend' ? row.eanFoto : null;
  let dupFoto = null;
  if (row.eanFoto && row.eanFoto.art === 'unsicher') {
    reasons.push('ean_unsicher');
    if (verdict === 'ok') verdict = 'hold';
  }
  if (ef) {
    reasons.push('ean_abweichend');
    if (fotoEanRows) {
      dupFoto = evaluateDuplicate({ ...row._policy, ean: ef.gelesen }, fotoEanRows.filter((r) => r.id !== row.id).map((r) => r._policy));
      if (dupFoto.verdict === 'locked') reasons.push('foto_nummer_doppelt');
    }
    if (verdict === 'ok') verdict = 'hold';
  }
  const runde = row.status === 'pending' && row.rundeOffen ? row.rundeOffen : null;
  for (const code of (runde ? runde.sperrend : [])) {
    if (!reasons.includes(code)) reasons.push(code);
    if (verdict === 'ok') verdict = 'hold';
  }
  const zurueck = row.status === 'pending' && row.wiedereroeffnet ? row.wiedereroeffnet : null;
  if (zurueck && (DOPPEL_GRUENDE.has(zurueck.vorherGrund) || DOPPEL_GRUENDE.has(zurueck.vorherIntern))) {
    reasons.push('zurueckgeholt_doppel');
    if (verdict === 'ok') verdict = 'hold';
  }
  if (kontoSperre === 'gesperrt') { reasons.unshift('konto_gesperrt'); verdict = 'locked'; }
  else if (kontoSperre === 'unbekannt') { reasons.unshift('kontosperre_unbekannt'); if (verdict === 'ok') verdict = 'hold'; }

  const hinweise = row.priceCents ? [] : ['preis_nicht_gelesen'];
  return { verdict, reasons, missing: completeness.missing, dup, hinweise, ...(dupFoto ? { dupFoto } : {}), ...(kontoSperre ? { kontoSperre } : {}) };
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
function precheckFuerFall(row, sameEanRows, opts = {}) {
  const gespeichert = row.review && row.review.precheck;
  if (row.status !== 'pending' && gespeichert && typeof gespeichert === 'object') {
    if (gespeichert.dup) return { ...gespeichert, dupQuelle: 'gespeichert', quelle: 'gespeichert' };
    return { ...gespeichert, dup: precheckOf(row, sameEanRows, opts).dup, dupQuelle: 'heute', quelle: 'gespeichert' };
  }
  return { ...precheckOf(row, sameEanRows, opts), quelle: row.status === 'pending' ? 'frisch' : 'nachtraeglich' };
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
 * „Passt" heißt: dieselbe GTIN in jeder Schreibweise (werte.eanSchluessel) —
 * „0" + EAN-13 ist derselbe Artikel (Prüfrunde 02.10.2026). Die Abfragen
 * dafür laufen über alle Schreibweisen (werte.eanVarianten).
 */
function nachbarnAus(docs, ean, ohneId) {
  const key = eanSchluessel(ean);
  return eindeutigeZeilen(docs).filter((r) => r.id !== ohneId && eanSchluessel(r.anzeigeEan) === key);
}

/** Treffer beider Abfragen → Zeilen je GTIN (Schlüssel: werte.eanSchluessel). Nachschlagen mit nachbarnVon. */
function gruppiereNachEan(docs) {
  const out = new Map();
  for (const r of eindeutigeZeilen(docs)) {
    const key = eanSchluessel(r.anzeigeEan);
    if (!key) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(r);
  }
  return out;
}

/** Einträge einer EAN aus gruppiereNachEan/eanIndex — in jeder Schreibweise. */
function nachbarnVon(byEan, ean) {
  const key = eanSchluessel(ean);
  return (key && byEan.get(key)) || [];
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
    const policy = policyOf(d.id, d.data() || {}, d.createTime);
    const key = eanSchluessel(policy.ean);
    if (!key) continue;
    if (!index.has(key)) index.set(key, []);
    index.get(key).push({ ...policy, _policy: policy });
  }
  return index;
}

/**
 * Die Warteschlange der Produktfotos aus den offenen Dokumenten und dem Index.
 * `kontoSperre(uid)` liefert 'gesperrt' | 'unbekannt' | null (src/kontoSperre.js).
 *
 * Einreichungen gesperrter Konten stehen am ENDE (`gesperrt: true`, Zähler
 * `counts.gesperrt`): sie bleiben stumm liegen (Entscheidung Patrick
 * 02.10.2026, „nicht freigeben"), warten also auf niemanden — vorne würden sie
 * die Fälle verdrängen, die auf eine Entscheidung warten.
 */
function baueFotoListe(openDocs, byEan, p, q, kontoSperre = () => null) {
  let rows = openDocs.map((d) => {
    const r = rowOf(d);
    const sperre = kontoSperre(r.userId);
    const pre = precheckOf(r, nachbarnVon(byEan, r.anzeigeEan), {
      kontoSperre: sperre,
      fotoEanRows: r.eanFoto && r.eanFoto.art === 'abweichend' ? nachbarnVon(byEan, r.eanFoto.gelesen) : null,
    });
    return {
      id: r.id, userId: r.userId, productName: r.anzeigeName, ean: r.anzeigeEan,
      nameNachgelesen: r.herkunft.nameQuelle === 'nachgelesen', eanNachgelesen: r.herkunft.eanNachgelesen,
      marketName: r.marketName || r.marketId, createdAt: r.createdAt, campaignId: r.campaignId,
      priceCents: r.priceCents, manufacturer: r.manufacturer, priceImageKind: r.priceImageKindAnzeige,
      stepCount: r.stepCount, verdict: pre.verdict, reasons: pre.reasons, hinweise: pre.hinweise,
      ...(sperre === 'gesperrt' ? { gesperrt: true } : {}),
      // Nur für die Suche, wird unten entfernt.
      _suche: [r.id, r.userId, r.anzeigeName, r.productName, r.productNameOcr, r.productNameRescueOcr, r.anzeigeEan, r.ean, r.marketName, r.manufacturer],
    };
  });
  if (q) rows = rows.filter((r) => r._suche.some((v) => v && String(v).toLowerCase().includes(q)));
  rows = rows.map(({ _suche, ...r }) => r);
  if (p.verdict && p.verdict !== 'all') rows = rows.filter((r) => r.verdict === p.verdict);
  rows.sort((a, b) => (a.gesperrt ? 1 : 0) - (b.gesperrt ? 1 : 0) || (a.createdAt ?? 0) - (b.createdAt ?? 0));
  const counts = rows.reduce((acc, r) => ((acc[r.verdict] = (acc[r.verdict] || 0) + 1), acc), {});
  const gesperrt = rows.filter((r) => r.gesperrt).length;
  if (gesperrt) counts.gesperrt = gesperrt;
  return { type: 'photos', rows, total: rows.length, counts };
}

module.exports = {
  REQUIRED_STEPS, INDEX_FELDER, safeStatus, rowOf, stripPolicy, precheckOf, precheckFuerFall,
  nachbarnAus, nachbarnVon, gruppiereNachEan, eanIndex, baueFotoListe, bildDefektOf, eanFotoZeile, rundeOffenOf, wiedereroeffnetOf,
};
