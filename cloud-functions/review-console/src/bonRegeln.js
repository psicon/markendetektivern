'use strict';
/**
 * Regeln der Bon-Runde (Morgenrunde für Bons in `review`) — reine Funktionen,
 * getestet in __tests__/bonRegeln.test.js.
 *
 * Anlass (24.09.2026, Patrick: „Dann laufen die ja wieder auf"): Die Bon-
 * Pipeline entscheidet fast alles selbst; übrig bleiben ~5 Bons am Tag in der
 * Prüfung (60 Tage: 296 von 299 wegen niedriger Lese-Sicherheit). Die Runde
 * macht, was die Handrunden 02.–24.09. taten: unabhängig nachlesen, mit dem
 * Gespeicherten abgleichen, dann über den SERVER-Resolver entscheiden.
 *
 * Grundsätze (zwei Prüfrunden 24.09., drei Rollen):
 *  - Geld rechnet NIE die Runde: Tages-/Wochen-/Pro-Kopf-Deckel und Budget
 *    rechnet resolveCashbackReview in der Ledger-Transaktion.
 *  - Freigegeben wird nur, was die Zweitlesung SELBST bestätigt: Datum und
 *    Endsumme gelesen und passend. „Nichts gelesen" ist keine Bestätigung —
 *    sonst gäbe eine leere Lesung jeden Bon frei.
 *  - Automatisch abgelehnt wird nur ein Doppel gegen eine schon ENTSCHIEDENE
 *    Kopie. Eine noch offene Kopie sperrt nie (CLAUDE.md „Eine Doppel-Regel
 *    MUSS eine Kopie übrig lassen").
 *  - Alles, wofür man hinsehen müsste, bleibt für Patrick liegen. „Ohne
 *    Prämie" entscheidet die Runde nie: die Pipeline hält wegen niedriger
 *    Lese-Sicherheit nur Bons, die sonst einen Betrag hätten.
 */

// Status, in denen ein anderer Bon als Kopie zählt (wie die Pipeline).
const LIVE = new Set(['approved', 'paid', 'no_reward', 'review', 'matched', 'ocr_pending']);
// Davon die entschiedenen — nur gegen die wird automatisch abgelehnt.
const ENDZUSTAND = new Set(['approved', 'paid', 'no_reward', 'matched']);
// Beanstandungen, die am Bon vermerkt werden (`bonRundeBeanstandet`): ein Fall,
// den die Zweitlesung einmal nicht bestätigen konnte, wird nicht an einem
// späteren Morgen so lange nachgelesen, bis eine Lesung zufällig passt. Dazu
// gehören auch „nicht lesbar" und ein defektes Bild (bon_mu3v9…: Endsumme gar
// nicht im Bild; bon_mu1m6…: bei 512 KiB abgeschnittenes JPEG). NICHT dazu
// gehören Gründe, die nichts über das Bild sagen (Technik, Grenzlage, Budget).
const MERKEN = new Set([
  'kein_kassenbon', 'manipulationsverdacht', 'datum_widerspricht', 'summe_widerspricht', 'markt_widerspricht',
  'jahr_unsicher', 'artikelzahl_widerspricht', 'datum_nicht_gelesen', 'summe_nicht_gelesen', 'bild_defekt',
]);

const ALLE_FELDER = ['markt', 'bonDate', 'totalCents', 'bonTime'];
const msOf = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : typeof v === 'number' ? v : null);

/**
 * Was hat das Feld-Gate der Pipeline über die Lesungen dieses Bons gesagt?
 * `schwach` = es gab keine zwei stimmigen Lesungen (kein Vermerk, < 2 Zeugen,
 * oder Bewertung `none`). Dann hat die Pipeline NICHTS bestätigt — und genau
 * diese Bons dürfen nicht den nachsichtigsten Abgleich bekommen (zweite
 * Prüfrunde 24.09.: 10 von 20 gehaltenen Bons seit 19.09.). Alle Felder gelten
 * dann als uneinig.
 */
function konfliktLage(bon) {
  const fa = bon && bon.ocrFieldAgreement;
  const liste = fa && Array.isArray(fa.konflikte) ? fa.konflikte : [];
  const schwach = !fa || !Array.isArray(fa.konflikte) || !(Number(fa.zeugen) >= 2) || (bon && bon.reviewReason === 'ocr_confidence_none');
  return { schwach, konflikte: schwach ? [...new Set([...liste, ...ALLE_FELDER])] : liste };
}

/**
 * Artikelzahlen, an denen sich der Betrag ändert: Mindestzahl und jede Stufe —
 * derselbe Rechenweg wie `campaignRewardCents` in der Pipeline (Aktion zuerst,
 * sonst Konfiguration).
 */
function betragsGrenzen(aktion, cfg) {
  const a = aktion || {};
  const c = cfg || {};
  const min = Number.isFinite(a.minItems) ? a.minItems : (Number.isFinite(c.minItemsForPayout) ? c.minItemsForPayout : 4);
  const stufen = Array.isArray(a.tiers) && a.tiers.length ? a.tiers : (a.cashbackPerBonCents ? [] : (Array.isArray(c.tiers) ? c.tiers : []));
  return [...new Set([min, ...stufen.map((t) => Number(t && t.minItems)).filter(Number.isFinite)])].sort((x, y) => x - y);
}

/** Nur Konfidenz-Fälle; bon_date_future, ocr_unavailable, forensics_software → Mensch. */
function bearbeitbar(bon) {
  return /^ocr_confidence_(low|medium|none)$/.test(String(bon && bon.reviewReason || ''));
}

function hhmm(t) {
  const m = /^(\d{1,2}):(\d{2})/.exec(String(t || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/**
 * Doppel-Urteil aus den Zwillingen (Dokumente mit gleichem contentHash/
 * transactionHash/itemsHash).
 *  - Reiner itemsHash-Treffer zählt nur bei ≤ 5 min Bon-Uhrzeit-Abstand (wie
 *    Pipeline und Handrunde). Ist die Uhrzeit dieses Bons unsicher gelesen
 *    (`zeitUnsicher`), ist der Abstand nichts wert → Mensch.
 *  - Entschiedene Kopie derselben Person → Doppel derselben Person.
 *  - Entschiedene fremde Kopie mit gleicher Transaktion → Doppel über Konten.
 *  - Entschiedene fremde Kopie nur mit gleichem Inhalt → Mensch. `contentHash`
 *    ist Markt|Datum|Endsumme — das deckt auch die Kopie über zwei Konten ab,
 *    deren Uhrzeit verschieden gelesen wurde (CLAUDE.md 02.09.: „bei Freigaben
 *    skippen und manuell sichten").
 *  - Ältere, noch unentschiedene Kopie (review/ocr_pending) → Mensch bzw. der
 *    nächste Morgen: sie ist das Original und wird zuerst entschieden. Eine
 *    JÜNGERE unentschiedene Kopie zählt nicht — dieser Bon ist das Original.
 *
 * @param {{id:string, userId:string, bonTime?:string, createdMs:number}} bon
 * @param {Array<{id:string, userId:string, status:string, bonTime?:string, createdMs:number, fields:string[]}>} zwillinge
 * @param {{zeitUnsicher?:boolean}} [o]
 */
function zwillingsUrteil(bon, zwillinge, { zeitUnsicher = false } = {}) {
  const echt = [];
  let unsicher = null;
  for (const t of zwillinge || []) {
    if (!t || t.id === bon.id || !LIVE.has(t.status)) continue;
    if (t.fields.length === 1 && t.fields[0] === 'itemsHash') {
      const a = hhmm(bon.bonTime); const b = hhmm(t.bonTime);
      const nah = a == null || b == null || Math.abs(a - b) <= 5;
      if (!nah) { if (zeitUnsicher && !unsicher) unsicher = t; continue; }
    }
    echt.push(t);
  }
  const entschieden = echt.filter((t) => ENDZUSTAND.has(t.status));
  const selbst = entschieden.find((t) => t.userId === bon.userId);
  if (selbst) return { entscheidung: 'ablehnen', grund: 'duplicate_content_self', duplicateOf: selbst.id, priorStatus: selbst.status };
  const fremdTx = entschieden.find((t) => t.userId !== bon.userId && t.fields.includes('transactionHash'));
  if (fremdTx) return { entscheidung: 'ablehnen', grund: 'duplicate_content_cross_user', duplicateOf: fremdTx.id, priorStatus: fremdTx.status };
  const fremdInhalt = entschieden.find((t) => t.userId !== bon.userId);
  if (fremdInhalt) return { entscheidung: 'offen', grund: 'inhalt_wie_bon_anderer_person', hinweis: fremdInhalt.id };
  const aelterOffen = echt.find((t) => !ENDZUSTAND.has(t.status) && t.createdMs < bon.createdMs);
  if (aelterOffen) return { entscheidung: 'offen', grund: 'zwilling_unentschieden', hinweis: aelterOffen.id };
  if (unsicher) return { entscheidung: 'offen', grund: 'zwilling_unsicher', hinweis: unsicher.id };
  return null;
}

/**
 * Das Schema erzwingt kein Format: „2026-9-23" oder „23.09.26" sind lesbare
 * Daten, kein „nicht gelesen" (Prüfrunde 4). Alles andere bleibt, wie es ist.
 */
function datumNormal(s) {
  const t = String(s || '').trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(t);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(t);
  if (m) return `${m[3].length === 2 ? `20${m[3]}` : m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return t;
}

/**
 * Datum der Zweitlesung gegen das gespeicherte.
 * @returns {'gleich'|'nur_jahr'|'vertauscht'|'anders'|'unlesbar'}
 *  - nur_jahr: Tag+Monat gleich, Jahr anders (2020/2023/2028 statt 2026 —
 *    am 19. und 24.09. jedes Mal eine Fehllesung der ZWEITLESUNG)
 *  - vertauscht: Tag und zweistelliges Jahr vertauscht (23.09.26 → 2023-09-26)
 *  - unlesbar: kein YYYY-MM-DD — das ist KEINE Bestätigung
 */
function datumVergleich(gespeichert, gelesen) {
  const g = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(gespeichert || ''));
  const z = /^(\d{4})-(\d{2})-(\d{2})$/.exec(datumNormal(gelesen));
  if (!g || !z) return 'unlesbar';
  if (g[0] === z[0]) return 'gleich';
  if (g[2] !== z[2]) return 'anders';
  if (g[3] === z[3]) return 'nur_jahr';
  if (g[3] === z[1].slice(2) && g[1].slice(2) === z[3]) return 'vertauscht';
  return 'anders';
}

const erstJahre = (bon) => ((bon.ocr && bon.ocr.robust && Array.isArray(bon.ocr.robust.reads)) ? bon.ocr.robust.reads : [])
  .map((r) => r && r.bonDate).filter((d) => typeof d === 'string' && d.length >= 4).map((d) => d.slice(0, 4));

/**
 * Stützt auch nur EINE Erstlesung das Jahr der Zweitlesung? Dann ist die
 * Abweichung vielleicht keine Fehllesung, sondern ein Bon aus einem anderen
 * Jahr, den die Pipeline aufs Upload-Jahr korrigiert hat (bon_mtsimmybac4knh:
 * 6 von 7 Erstlesungen 2025, gespeichert 2026).
 */
function jahrGestuetzt(bon, gelesen) {
  return erstJahre(bon).includes(String(gelesen || '').slice(0, 4));
}

/**
 * Ist das Jahr des Bons zweifelhaft, wenn die Zweitlesung nur im Jahr abweicht?
 *  - Die Pipeline hat das Datum korrigiert → ja.
 *  - Es gibt Erstlesungen → ja nur, wenn eine davon das gelesene Jahr hat. Ein
 *    Datums-Konflikt über den TAG (bon_mu362…: 15. gegen 19., alle 2026) sagt
 *    über das Jahr nichts.
 *  - Keine Erstlesungen → der Datums-Konflikt entscheidet (vorsichtig).
 */
function jahrZweifel(bon, gelesen, konflikte) {
  const k = bon.bonDateCorrection;
  // Eine alte Korrektur (2020 → 2026) erklärt genau diese Fehllesung; liest die
  // Zweitlesung ein DRITTES Jahr, bleibt der Zweifel (Prüfrunde 5).
  if (k) return String(k.from || '').slice(0, 4) !== String(gelesen || '').slice(0, 4);
  if (erstJahre(bon).length) return jahrGestuetzt(bon, gelesen);
  return konflikte.includes('bonDate');
}

/**
 * Hat die Pipeline ein VORJAHRES-Datum aufs Upload-Jahr korrigiert
 * (2025-09-24 → 2026-09-24)? Genau das ist die Klasse „echter Vorjahres-Bon am
 * Jahrestag" — sie bleibt immer beim Menschen, egal was die Zweitlesung liest
 * (Prüfrunde 4; im Bestand 6 Fälle 2025 → 2026).
 */
function vorjahresKorrektur(bon) {
  const k = bon.bonDateCorrection;
  const up = msOf(bon.createdAt) ?? bon.createdMs;
  if (!k || !up) return false;
  const von = Number(String(k.from || '').slice(0, 4));
  const upJahr = Number(new Date(up).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 4));
  return Boolean(von) && von === upJahr - 1;
}

/**
 * Liegt das gelesene Jahr NACH dem Jahr des Uploads, kann es nicht stimmen —
 * eine Fehllesung der Zweitlesung, kein Hinweis auf einen alten Bon
 * (bon_mu362rvkp5k0ag: 2028 statt 2026, Tag und Monat bestätigt).
 */
function jahrUnmoeglich(bon, gelesen) {
  const up = msOf(bon.createdAt) ?? bon.createdMs;
  const jahr = Number(String(gelesen || '').slice(0, 4));
  if (!up || !jahr) return false;
  return jahr > Number(new Date(up).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }).slice(0, 4));
}

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]/g, '');

// Gattungs- und Rechtsformwörter tragen keine Identität: „REWE Markt GmbH" und
// „TEDi GmbH & Co. KG" sind nicht derselbe Markt (Prüfrunde 4: ohne diese Liste
// galten 946 von 27.280 Paaren verschiedener Ketten als passend).
const STOPP = new Set([
  'gmbh', 'mbh', 'co', 'kg', 'ohg', 'ek', 'ag', 'se', 'ug', 'gbr', 'und', 'der', 'die', 'das', 'fuer', 'fur',
  'markt', 'maerkte', 'markte', 'supermarkt', 'center', 'drogerie', 'discount', 'marken', 'filiale', 'tankstelle',
  'apotheke', 'handel', 'handelshof', 'handelsgesellschaft', 'gesellschaft', 'stiftung', 'shop', 'store', 'e', 'k',
]);
// Himmelsrichtungen/Länder tragen bei Kettennamen keine Identität („Aldi Nord"
// ↔ „Netto Nord", Prüfrunde 5).
const KETTE_STOPP = new Set(['nord', 'sud', 'sued', 'suisse', 'deutschland', 'austria', 'osterreich']);
// Wörter bekannter Ketten: taucht eines davon in der Lesung auf, das nicht zur
// eigenen Kette gehört, ist es ein anderer Markt — egal was sonst passt.
// (Nicht „muller": auch ein Nachname in Inhabernamen.)
const KETTEN = new Set(['rewe', 'edeka', 'lidl', 'aldi', 'netto', 'penny', 'kaufland', 'norma', 'dm', 'rossmann',
  'globus', 'tegut', 'marktkauf', 'real', 'famila', 'nahkauf', 'hofer', 'spar', 'billa', 'merkur', 'denns', 'alnatura',
  'tedi', 'kik', 'aral', 'shell', 'esso', 'jet', 'rusta', 'action', 'woolworth', 'budni', 'mpreis']);
const woerter = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  // „R E W E CENTER" → „rewe center" (einzelne Buchstaben zusammenziehen) …
  .replace(/(?<![a-z0-9'’])(?:[a-z][\s.]){2,}[a-z]\b/g, (m) => m.replace(/[\s.]/g, ''))
  // … und „E center"/„E-Center" ist EDEKA (sonst bestünde er nur aus Stoppwörtern).
  .replace(/(^|[^a-z0-9])e[\s-]?center\b/g, '$1edeka')
  .split(/[^a-z0-9]+/).filter((w) => w && !STOPP.has(w));

/**
 * Markt der Zweitlesung passt zum aufgelösten Markt? Verglichen werden nur
 * ganze Wörter ohne Gattungs-/Rechtsformwörter:
 *  - ein Wort der Kette (id, Katalogname) steht in der Lesung („dm", „netto"),
 *  - oder die Mehrheit der Wörter des ROHNAMENS vom Bonkopf (`merchant.raw`)
 *    steht darin — inhabergeführte Märkte heißen dort anders als im Katalog
 *    (EDEKA ↔ „FFFrische-Center Hochner"). Ein einzelner gemeinsamer Vorname
 *    („Edeka Michael Müller" ↔ „REWE Michael Schmidt") reicht dafür nicht.
 */
function marktPasst(bon, gelesen) {
  const z = new Set(woerter(gelesen));
  if (!z.size) return false;
  const m = bon.merchant || {};
  const kette = new Set([...woerter(String(m.id || '').replace(/-/g, ' ')), ...woerter(m.name)].filter((w) => !KETTE_STOPP.has(w)));
  const roh = [...new Set(woerter(m.raw))];
  // Eine ANDERE bekannte Kette in der Lesung als die zugeordnete → anderer
  // Markt (auch wenn der Rohname sie nennt: dann hat die Pipeline falsch
  // zugeordnet, „Joh's R E W E CENTER" als EDEKA — Mensch).
  if ([...z].some((w) => KETTEN.has(w) && !kette.has(w))) return false;
  if ([...kette].some((w) => z.has(w))) return true;
  // Rohname: echte Mehrheit seiner Wörter, und bei mehreren Wörtern mindestens
  // zwei („Michael Seidl" ↔ „Michael Brücken" ist kein Treffer).
  const treffer = roh.filter((w) => z.has(w)).length;
  return roh.length > 0 && treffer * 2 >= roh.length && (roh.length === 1 || treffer >= 2) && roh.some((w) => w.length >= 4 && z.has(w));
}

/**
 * Hat ein ZWEITES Modell die Artikelzahl genauso gezählt? Haiku liest in der
 * Pipeline jeden Bon zuerst; seine Geldfelder stehen ohne Artikelnamen in
 * `ocr.robust.zeuge.ersteLesung` (über mehrere Läufe hinweg erst seit
 * 15.10.2026 — vorher fehlten sie an allen Prüffällen). Die Zählung gilt nur,
 * wenn Haikus Lesung in sich aufging (Summenprobe) und dieselbe Endsumme las —
 * sonst zählte es womöglich einen halben oder anderen Bon. Und nur dieselbe
 * ZAHL, nicht bloß dieselbe Stufe: dieselbe Regel wie in der Pipeline an der
 * Prämiengrenze (index.js zeugePruefen). Ist die gespeicherte Lesung selbst
 * Haikus (`robust.ersterLeser`), wäre es keine zweite Zählung.
 * Gemessen 11.–15.10.2026 an 71 Bons der vollen Leiter mit aufgegangener
 * Haiku-Lesung: 70-mal dieselbe Zahl.
 */
function haikuZaehltGleich(bon) {
  const rob = bon && bon.ocr && bon.ocr.robust;
  const h = rob && rob.zeuge && rob.zeuge.ersteLesung;
  if (!h || h.summenprobe !== true || rob.ersterLeser) return false;
  const n = Number(bon.eligibleItemCount);
  return Number.isInteger(n) && h.artikel === n && Number.isInteger(h.summe) && h.summe === Number(bon.bonTotalCents);
}

/**
 * Abgleich der unabhängigen Zweitlesung mit dem Gespeicherten. Geld hängt an
 * Markt, Datum, Endsumme, Artikelzahl und daran, dass es ein echter Bon ist.
 * Wo das Feld-Gate der Pipeline Uneinigkeit vermerkt hat
 * (`ocrFieldAgreement.konflikte`), wird genau dieses Feld strenger geprüft —
 * dort hielt die Pipeline den Bon fest.
 */
function abgleich(bon, zweit, { grenzen = [] } = {}) {
  const gruende = [];
  if (!zweit || typeof zweit.istKassenbon !== 'boolean') return { ok: false, gruende: ['zweitlesung_leer'] };
  if (zweit.istKassenbon === false) gruende.push('kein_kassenbon');
  if (zweit.manipuliert === true) gruende.push('manipulationsverdacht');
  const { schwach, konflikte } = konfliktLage(bon);

  const zd = datumNormal(zweit.datum);
  const dv = datumVergleich(bon.bonDate, zd);
  if (vorjahresKorrektur(bon)) gruende.push('jahr_unsicher');
  else if (dv === 'unlesbar') gruende.push('datum_nicht_gelesen');
  else if (dv === 'anders') gruende.push('datum_widerspricht');
  else if (dv !== 'gleich' && !jahrUnmoeglich(bon, zd) && jahrZweifel(bon, zd, konflikte)) gruende.push('jahr_unsicher');

  const gesp = Number(bon.bonTotalCents);
  const gel = Number(zweit.endsummeCent);
  if (!(gel > 0) || !(gesp > 0)) gruende.push('summe_nicht_gelesen');
  else if (Math.abs(gesp - gel) > (konflikte.includes('totalCents') ? 2 : 100)) gruende.push('summe_widerspricht');

  if (konflikte.includes('markt') && !marktPasst(bon, zweit.markt)) gruende.push('markt_widerspricht');
  // Uneinige Artikelzahl über eine Stufengrenze: der gespeicherte Betrag könnte
  // der höhere sein. Das nachzurechnen kann die Runde nicht — Mensch.
  if (konflikte.includes('betrag')) gruende.push('betrag_uneinig');
  let artikelzahlHaiku = null;
  if (schwach) {
    // Ohne zwei stimmige Lesungen ist auch die Artikelzahl unbestätigt. Liegt
    // sie knapp über einer Betragsgrenze, kippt eine einzige Fehllesung (eine
    // Pfandzeile) den Betrag — bon_mufb80qgcrfg8k: 6 Artikel bei Mindestzahl 6.
    // Es sei denn, ein zweites Modell hat genauso gezählt (15.10.2026).
    const n = Number(bon.eligibleItemCount);
    if (!Number.isFinite(n)) gruende.push('artikelzahl_knapp');
    else if (grenzen.some((g) => n >= g && n < g + 2)) {
      if (haikuZaehltGleich(bon)) artikelzahlHaiku = n;
      else gruende.push('artikelzahl_knapp');
    }
    // Die Zweitlesung zählt ALLE Zeilen (mit Pfand). Widerspruch nur, wenn sie
    // unter eine Grenze fällt, die die gespeicherte Zahl erreicht — sonst ändert
    // die Abweichung am Betrag nichts (Prüfrunde 3: 59 vs. 57 bei Grenze 6).
    const z = Number(zweit.anzahlPositionen);
    if (!(z > 0)) gruende.push('artikelzahl_nicht_gelesen');
    else if (Number.isFinite(n) && grenzen.some((g) => n >= g && z < g)) gruende.push('artikelzahl_widerspricht');
  }
  return { ok: gruende.length === 0, gruende, ...(artikelzahlHaiku != null ? { artikelzahlHaiku } : {}) };
}

/** Wirksame Aktion eines Bons — Kopie von cashback-pipeline/lib/campaignZeit.js (Codebases teilen keinen Code). */
function wirksameAktionId(bon) {
  if (!bon) return null;
  if (Object.prototype.hasOwnProperty.call(bon, 'campaignIdAngewandt')) return bon.campaignIdAngewandt || null;
  return bon.campaignId || null;
}

/**
 * Reicht das Budget der wirksamen Aktion für den Betrag? Sonst schlösse der
 * Resolver die Freigabe ENDGÜLTIG mit `campaign_budget_exhausted` ab (Vorfälle
 * 03.09. und 10.09.: Budget „in einen Topf" übertragen). Dann bleibt der Bon
 * liegen, bis das Budget stimmt.
 * @returns {null|{entscheidung:'offen', grund:string, hinweis?:string}}
 */
function budgetUrteil(bon, aktion) {
  const cid = wirksameAktionId(bon);
  if (!cid) return { entscheidung: 'offen', grund: 'keine_aktion' };
  if (!aktion) return { entscheidung: 'offen', grund: 'keine_aktion', hinweis: cid };
  // Wie der Resolver: ein fehlendes/ungültiges Feld zählt als 0 (dort
  // `Number.isFinite(...) ? … : 0`) — also nicht als „unbegrenzt".
  // Was dieser Lauf schon für andere Bons reserviert hat, zieht bonRunde.js
  // vorher ab (Startstand/Frischstand, siehe dort).
  const rest = Number.isFinite(aktion.budgetRemainingCents) ? aktion.budgetRemainingCents : 0;
  if (rest < (Number(bon.cashbackCents) || 0)) {
    return { entscheidung: 'offen', grund: 'budget_leer', hinweis: `${cid}: ${rest} ct übrig` };
  }
  return null;
}

/**
 * Gilt die Beanstandung einer früheren Runde noch? Bis Patrick entscheidet —
 * oder bis die Pipeline den Bon neu verarbeitet (neue Lesung = neuer Fall).
 */
function beanstandungGilt(bon) {
  const w = bon && bon.bonRundeBeanstandet;
  if (!w || !Array.isArray(w.gruende) || !w.gruende.length) return false;
  return w.updatedAtMs == null || w.updatedAtMs === msOf(bon.updatedAt);
}

/**
 * Ein Bon → Entscheidung (vor dem Budget-Check, den bonRunde.js mit frisch
 * gelesener Aktion macht).
 * @param {object} e
 * @param {object} e.bon
 * @param {object|null} [e.zwilling]  Ergebnis von zwillingsUrteil
 * @param {object|null} [e.zweit]     Zweitlesung
 * @param {string|null} [e.zweitFehler]
 * @param {number[]} [e.grenzen]  Artikelzahlen, an denen sich der Betrag ändert (betragsGrenzen)
 * @returns {{entscheidung:'freigeben'|'ablehnen'|'offen', grund:string|null, gruende?:string[], duplicateOf?:string, priorStatus?:string, hinweis?:string}}
 */
function entscheideBon({ bon, zwilling = null, zweit = null, zweitFehler = null, grenzen = [] }) {
  if (!bearbeitbar(bon)) return { entscheidung: 'offen', grund: `pruefgrund_${bon.reviewReason || 'unbekannt'}` };
  if (zwilling) return zwilling;
  if (beanstandungGilt(bon)) {
    const w = bon.bonRundeBeanstandet;
    return { entscheidung: 'offen', grund: 'frueher_beanstandet', hinweis: `${w.tag || ''}: ${w.gruende.join(', ')}` };
  }
  if (zweitFehler) {
    // Ein Bild, das Gemini nicht dekodieren kann, wird morgen nicht besser —
    // eigener Grund mit Merker, kein Technikfehler (bon_mu1m6…: 512 KiB abgeschnitten).
    // Nur bildspezifische Texte — ein 400 wegen einer Modell-Änderung bei Google
    // („Thinking budget is not supported", 22.09.) ist Technik, kein Bildurteil.
    if (/decode|image data|Unable to process input image/i.test(String(zweitFehler))) return { entscheidung: 'offen', grund: 'bild_defekt', gruende: ['bild_defekt'], hinweis: String(zweitFehler).slice(0, 120) };
    return { entscheidung: 'offen', grund: 'zweitlesung_gescheitert', technik: !/kein Bildpfad/.test(String(zweitFehler)), hinweis: String(zweitFehler).slice(0, 120) };
  }
  const a = abgleich(bon, zweit, { grenzen });
  if (!a.ok) return { entscheidung: 'offen', grund: a.gruende[0], gruende: a.gruende, hinweis: [a.gruende.join(', '), zweit && zweit.grund].filter(Boolean).join(' · ') };
  if (!(Number(bon.cashbackCents) > 0)) return { entscheidung: 'offen', grund: 'kein_betrag' };
  if (a.artikelzahlHaiku != null) return { entscheidung: 'freigeben', grund: null, hinweis: `Artikelzahl ${a.artikelzahlHaiku}: Haiku zählte gleich` };
  return { entscheidung: 'freigeben', grund: null };
}

module.exports = {
  bearbeitbar, konfliktLage, betragsGrenzen, zwillingsUrteil, datumVergleich, jahrGestuetzt, jahrUnmoeglich, marktPasst, abgleich,
  wirksameAktionId, budgetUrteil, beanstandungGilt, entscheideBon, LIVE, ENDZUSTAND, MERKEN,
};
