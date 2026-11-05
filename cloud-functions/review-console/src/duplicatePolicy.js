'use strict';

/**
 * Doppel-Regel für Produkt-Einreichungen (Produktentscheidung 05.09.2026).
 *
 * Ein Produkt = EAN. Referenz („prior") ist eine FREIGEGEBENE Einreichung
 * desselben Produkts.
 *
 * GRÜNDERENTSCHEIDUNG 20.09.2026 — die Sperre gilt NUR GEGEN SICH SELBST:
 * Was ein ANDERER Nutzer eingereicht hat, sperrt niemanden. Wer im Laden
 * steht und fotografiert, kann nicht wissen, ob jemand anderes dasselbe Produkt
 * schon erfasst hat — die Ablehnung traf also immer die Falschen und hat aktive
 * Nutzer gekostet. Ziel ist mehr Scannen und mehr Fotografieren.
 *
 * ENTSCHEIDUNG PATRICK 02.10.2026 — „weder 24 Stunden noch 30 Tage, sondern
 * einmal pro Woche": Dieselbe Person bekommt dasselbe Produkt höchstens einmal
 * je rollierende 7 Tage (168 h, SAME_USER_LOCK_MS) vergütet, gemessen gegen
 * ihre FREIGEGEBENEN Einreichungen derselben EAN. Innerhalb des Fensters gibt
 * es KEINE Ausnahme mehr — weder ein anderer gelesener Preis noch ein anderer
 * Hersteller noch ein anderer Markt. Der Markt wird vom Nutzer frei gewählt
 * (Buschbohnen 02.10.: REWE und Netto binnen 10 Minuten, beide bezahlt), und
 * Preis/Hersteller liest die Texterkennung — keines davon belegt eine neue
 * Erfassung. Bis dahin: 24 h, und andere Daten hoben die Sperre auf.
 * Gemessen vor der Umstellung: in den letzten 7 Tagen hätte die neue Regel 20
 * von 614 Freigaben (3,3 %) gesperrt, seit Beginn 35 von 3.273 (3,28 €).
 * Bereits Bezahltes wird nicht zurückgefordert (Entscheidung Patrick 02.10.).
 *
 * Liegt eine ÄLTERE eigene Einreichung noch in `pending`, wird gehalten, bis
 * sie entschieden ist (sonst zahlt ein Doppel zweimal; und so bleibt immer
 * eine Kopie freigabefähig). Fremde Pendings halten nichts auf.
 *
 * Reine Funktionen, keine Firestore-Abhängigkeit — der Aufrufer liefert die
 * Kandidaten. Die Bewertung nutzt den EINREICH-Zeitpunkt (createdAt), nicht
 * „jetzt": ein Doppel, das 5 Tage nach der Referenz eingereicht wurde, wird
 * nicht dadurch freigabefähig, dass die Prüfung erst Wochen später stattfindet.
 */

// Rollierendes Fenster für dieselbe Person (Entscheidung Patrick 02.10.2026).
// Grenze exklusiv: genau 168 h später zählt derselbe Artikel wieder.
const SAME_USER_LOCK_MS = 7 * 24 * 60 * 60 * 1000;

// Haushalts-Regel (Entscheidung Patrick 17.10.2026, Fenster 18.10.2026 auf
// 24 h erweitert: „ja, erweitere auf 24 Stunden", „wenn du dir sicher bist, dass
// das bei anderen keine Nachteile hervorruft"): dasselbe Produkt vom selben Ort
// binnen 24 Stunden wird nur einmal bezahlt — auch über verschiedene Konten.
// Gemessen über den ganzen Bestand mit genauem Standort (11.08.–18.10.2026,
// 4.345 Einreichungen): Paare fremder Konten mit derselben EAN binnen 24 h lagen
// entweder ≤ 28 m auseinander oder gar nicht in der Nähe (0 Paare zwischen 50 und
// 200 m). Die nahen stammten von genau drei Konto-Paaren, alle Haushalte (zwei mit
// derselben angegebenen Adresse, eins ohne Adresse, aber stets ≤ 12 m): 138 Paare,
// 116 doppelt bezahlt. Mit 60 min wären es 87 gewesen. Fremde im selben Laden oder
// in der Nachbarschaft am selben Tag kamen nicht vor.
const HAUSHALT_FENSTER_MS = 24 * 60 * 60 * 1000;
const HAUSHALT_RADIUS_M = 50;
// Nur genaue Standorte: ein grober Fix (Funkzelle, „ungefährer Standort")
// liegt bei Fremden in derselben Stadt oft auf demselben Punkt.
const HAUSHALT_GENAUIGKEIT_MAX_M = 100;

const REASON = Object.freeze({
  // Interner Grund der Wochen-Sperre (Bericht, `review.reason`, Prüfkonsole).
  // Am Dokument steht für die App bis auf Weiteres APP_GRUND[…], siehe dort.
  SAME_USER_WEEK: 'sperre_woche_gleicher_nutzer',
  // Altbestand: bis 02.10.2026 die 24-h-Sperre (vorher 30 Tage). Bleibt für
  // die Anzeige alter Entscheidungen und für Ablehnungen aus einer noch nicht
  // neu ausgerollten Prüfkonsole erhalten.
  SAME_USER: 'sperre_30_tage_gleicher_nutzer',
  // Altbestand bis 20.09.2026 (fremde Einreichungen sperrten).
  OTHER_USER: 'sperre_30_tage_anderer_nutzer',
  PENDING_OLDER: 'doppelt_eingereicht',
  // Haushalts-Regel (17.10.2026): Ablehngrund bzw. Halte-Grund (ältere
  // Einreichung eines anderen Kontos vom selben Ort noch offen).
  HAUSHALT: 'doppelt_haushalt',
  HAUSHALT_AELTER_OFFEN: 'haushalt_aelter_offen',
});

/**
 * Welcher Grund-Code am Dokument landet (`rejectReason`, `holdReasons`) — das
 * ist der Code, nach dem die APP ihren Text wählt (lib/utils/productSubmission-
 * Copy.ts, REASON_COPY). Die Texte sind im Binary fest.
 *
 * Wochen-Sperre → `doppelt_eingereicht` (Entscheidung Patrick 02.10.2026):
 *  - `sperre_30_tage_gleicher_nutzer` verspricht in allen ausgelieferten
 *    Versionen „Ab dem nächsten Tag zählt derselbe Artikel wieder — und sofort,
 *    wenn sich Preis, Hersteller oder Markt geändert haben". Beides ist mit der
 *    Wochen-Regel falsch.
 *  - `doppelt_eingereicht` („Dieses Produkt hattest du schon eingereicht — Wir
 *    zählen jedes Produkt einmal. Ein anderes Produkt bringt beim nächsten Mal
 *    wieder etwas.") steht seit dem ersten Stand der Anzeige (c89cfb0,
 *    05.09.2026) in jeder Version und verspricht nichts Falsches.
 *  - Der präzise Text („ab nächster Woche zählt derselbe Artikel wieder") liegt
 *    für die nächste App-Version unter `sperre_woche_gleicher_nutzer` bereit.
 *    Umstellen (Eintrag hier entfernen), sobald diese Version bei praktisch
 *    allen Nutzern läuft — alte Versionen zeigten sonst den Standardtext.
 *
 * Bildschirmfoto als Preisbeleg → `fotos_unpassend` (Patrick 04.10.2026:
 * „dann Ablehnung mit fotos_unpassend"). Dessen Text („Ein Foto passte nicht
 * zum Schritt — zum Beispiel das Regal statt des Preisschilds …") steht seit
 * 05.09.2026 in jeder Version. `preis_fehlt` wäre falsch: dessen Text sagt
 * „kein Preis zu sehen", und es gibt ihn erst ab 6.0.20. Ein eigener Text
 * liegt unter `preis_bildschirm` für eine spätere Version bereit (wie oben).
 * Literal statt Import aus src/preisBildschirm.js: keine Abhängigkeit der
 * Doppel-Regel von der Bildschirm-Regel.
 *
 * Haushalts-Regel → `produkt_bereits_verguetet` (17.10.2026). Dessen Text
 * („Dieses Produkt war schon im Katalog — Jedes Produkt zählt einmal …") steht
 * seit 05.09.2026 in jeder Version und stimmt: das Produkt ist gerade erfasst
 * und bezahlt worden, nur eben über das andere Konto. `doppelt_eingereicht`
 * wäre falsch („hattest DU schon eingereicht"). Ein eigener Text liegt unter
 * `doppelt_haushalt` für eine spätere Version bereit (wie oben).
 *
 * Der interne Grund bleibt in `review.reason` am Dokument, damit Bericht,
 * Notbremse und Auswertungen die Wochen-Sperre von anderen Doppeln trennen.
 */
const APP_GRUND = Object.freeze({
  [REASON.SAME_USER_WEEK]: REASON.PENDING_OLDER,
  [REASON.SAME_USER]: REASON.PENDING_OLDER,
  preis_bildschirm: 'fotos_unpassend',
  [REASON.HAUSHALT]: 'produkt_bereits_verguetet',
});
const appGrund = (code) => APP_GRUND[code] || code;

function ms(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return v.getTime();
  if (typeof v.toMillis === 'function') return v.toMillis();
  if (typeof v.seconds === 'number') return v.seconds * 1000;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  return null;
}

function normText(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/\b(gmbh|ag|se|kg|ohg|co|mbh|e\.?k\.?|&)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function levenshtein(a, b) {
  if (a === b) return 0;
  const m = a.length, n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
    }
    prev = curr;
  }
  return prev[n];
}

/** Hersteller gleich? Leichte OCR-Abweichungen (≤2 Edits) oder Enthaltensein zählen als gleich. */
function manufacturerEqual(a, b) {
  const x = normText(a), y = normText(b);
  if (!x || !y) return true; // fehlend = gleich (fail-closed)
  if (x === y || x.includes(y) || y.includes(x)) return true;
  return levenshtein(x, y) <= 2;
}

// Vergleichswerte NUR zur Anzeige („Anders" in der Prüfkonsole) — seit der
// Wochen-Regel (02.10.2026) hebt keiner davon eine Sperre auf. Weiterhin NUR
// server-geschriebene Felder (src/werte.js policyOf: Preis vom Namer oder
// nachgelesen, Hersteller nur vom Namer); Top-Level `priceCents`/`manufacturer`
// wären vom Client frei wählbar.
function priceOf(u) {
  const p = u && u.priceOcr && u.priceOcr.priceCents;
  return Number.isFinite(p) && p > 0 ? Math.round(p) : null;
}
function manufacturerOf(u) {
  const m = u && u.manufacturerOcr;
  const name = m && typeof m === 'object' ? m.name : null;
  return (typeof name === 'string' && name.trim()) || null;
}

/**
 * Welche Daten unterscheiden sich zwischen Kandidat und Referenz? Nur noch
 * Information für den Menschen, keine Ausnahme von der Sperre.
 * @returns {{price:boolean, manufacturer:boolean, market:boolean, any:boolean, details:object}}
 */
function dataDiffers(candidate, prior) {
  const pc = priceOf(candidate), pp = priceOf(prior);
  const price = pc != null && pp != null && pc !== pp;
  const mc = manufacturerOf(candidate), mp = manufacturerOf(prior);
  const manufacturer = !!(mc && mp) && !manufacturerEqual(mc, mp);
  const market = !!(candidate?.marketId && prior?.marketId) && candidate.marketId !== prior.marketId;
  return {
    price, manufacturer, market, any: price || manufacturer || market,
    details: { price: [pp, pc], manufacturer: [mp, mc], market: [prior?.marketId ?? null, candidate?.marketId ?? null] },
  };
}

const ANDERS = ['price', 'manufacturer', 'market'];

/**
 * @param {object} candidate  die zu prüfende Einreichung (mit id, userId, ean, marketId, createdAt, status)
 * @param {object[]} others   alle anderen Einreichungen mit derselben EAN (beliebiger Status)
 * @returns {{verdict:'ok'|'locked'|'hold', reason:string|null, priorId:string|null, priorIds?:string[], priorUserId:string|null,
 *            sameUser:boolean|null, lockUntil:number|null, updatedFields:string[], diff:object|null}}
 *
 * Das Fenster ist SYMMETRISCH (|Kandidat − Referenz| < 7 Tage): wird ein
 * älterer Fall erst nach einem jüngeren entschieden (Backlog), ist der jüngere
 * trotzdem Referenz — sonst rutschte ein Doppel durch, nur weil es zuerst
 * eingereicht wurde. Abgelehnte Einreichungen sind nie Referenz: eine
 * Ablehnung verlängert keine Sperre, und wer nach einer Ablehnung neu
 * einreicht, wird normal geprüft.
 *
 * `updatedFields`/`diff` beschreiben weiter, worin sich Kandidat und Referenz
 * unterscheiden — nur zur Anzeige.
 */
function evaluateDuplicate(candidate, others) {
  const cid = candidate?.id ?? null;
  const cAt = ms(candidate?.createdAt) ?? Date.now();
  const list = (others || []).filter((o) => o && o.id !== cid);

  // Ältere, noch offene Einreichung desselben Produkts → erst die entscheiden.
  const pendingOlder = list
    .filter((o) => o.status === 'pending' && o.userId === candidate.userId && (ms(o.createdAt) ?? Infinity) < cAt)
    .sort((a, b) => (ms(a.createdAt) ?? 0) - (ms(b.createdAt) ?? 0));
  if (pendingOlder.length) {
    const p = pendingOlder[0];
    return { verdict: 'hold', reason: REASON.PENDING_OLDER, priorId: p.id, priorUserId: p.userId ?? null, sameUser: p.userId === candidate.userId, lockUntil: null, updatedFields: [], diff: null };
  }

  // Eigene Freigaben derselben EAN binnen 7 Tagen um den Kandidaten, jüngste zuerst.
  const inWindow = list
    .filter(
      (o) =>
        o.status === 'approved'
        && o.userId === candidate.userId
        && Math.abs((ms(o.createdAt) ?? 0) - cAt) < SAME_USER_LOCK_MS,
    )
    .sort((a, b) => (ms(b.createdAt) ?? 0) - (ms(a.createdAt) ?? 0));
  if (!inWindow.length) {
    // Referenz außerhalb des Fensters (oder fremd) nur zur Information, nie sperrend.
    const older = list
      .filter((o) => o.status === 'approved')
      .sort((a, b) => (ms(b.createdAt) ?? 0) - (ms(a.createdAt) ?? 0))[0];
    const eigen = older ? older.userId === candidate.userId : null;
    return {
      verdict: 'ok', reason: null,
      priorId: older ? older.id : null, priorUserId: older ? older.userId ?? null : null,
      sameUser: eigen,
      lockUntil: eigen ? (ms(older.createdAt) ?? 0) + SAME_USER_LOCK_MS : null,
      updatedFields: older ? ANDERS.filter((k) => dataDiffers(candidate, older)[k]) : [],
      diff: older ? dataDiffers(candidate, older).details : null,
    };
  }

  // Jede eigene Freigabe im Fenster sperrt — ohne Ausnahme (Entscheidung
  // Patrick 02.10.2026). Frist: die jüngste Freigabe + 7 Tage.
  // `priorIds`: ALLE sperrenden Freigaben. Die Morgenrunde schreibt eine
  // Sperr-Ablehnung nur, wenn mindestens eine davon tatsächlich feststeht
  // (vorher entschieden oder im selben Lauf wirklich geschrieben).
  const ref = inWindow[0];
  const diff = dataDiffers(candidate, ref);
  return {
    verdict: 'locked', reason: REASON.SAME_USER_WEEK,
    priorId: ref.id, priorIds: inWindow.map((o) => o.id), priorUserId: ref.userId ?? null, sameUser: true,
    lockUntil: (ms(ref.createdAt) ?? 0) + SAME_USER_LOCK_MS,
    updatedFields: ANDERS.filter((k) => diff[k]), diff: diff.details,
  };
}

/** Gerätestandort für die Haushalts-Regel — nur ein genauer Fix zählt, sonst null. */
function haushaltOrt(gps) {
  if (!gps || !Number.isFinite(gps.lat) || !Number.isFinite(gps.lon)) return null;
  if (gps.lat === 0 && gps.lon === 0) return null;
  if (!Number.isFinite(gps.genauigkeitM) || gps.genauigkeitM > HAUSHALT_GENAUIGKEIT_MAX_M) return null;
  return gps;
}

/** Abstand zweier Punkte in Metern (Haversine). */
function abstandM(a, b) {
  const R = 6371e3, r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r, dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Haushalts-Regel (Entscheidung Patrick 17.10.2026, 24 h seit 18.10.): dasselbe
 * Produkt vom selben Ort binnen 24 Stunden wird nur einmal bezahlt — auch über
 * verschiedene Konten. Ergänzt die Wochen-Sperre (dieselbe Person), ersetzt sie
 * nicht; die Gründerentscheidung vom 20.09.2026 („fremde Einreichungen sperren
 * niemanden") gilt weiter für alles, was nicht am selben Ort zur selben Zeit
 * entstand. Anlass: zwei Konten eines Haushalts fotografierten dieselben
 * Produkte am selben Tisch, im Schnitt 3 Minuten nacheinander, und bekamen
 * beide Geld.
 *
 * „Selber Ort" = Gerätestandort (`capture.gps`) beider Einreichungen
 * ≤ HAUSHALT_RADIUS_M auseinander, beide genauer als
 * HAUSHALT_GENAUIGKEIT_MAX_M. Ohne genauen Standort auf einer Seite greift die
 * Regel nicht (sie schränkt ein — im Zweifel zahlen wie bisher).
 * „Binnen 24 Stunden" = Einreich-Zeitpunkte (Server, werte.einreichZeit)
 * weniger als HAUSHALT_FENSTER_MS auseinander, symmetrisch wie die
 * Wochen-Sperre: wird ein älterer Fall erst nach einem jüngeren entschieden,
 * sperrt der jüngere trotzdem.
 *
 * Wie bei der Wochen-Sperre bleibt immer eine Kopie freigabefähig: eine
 * FREIGEGEBENE Einreichung eines anderen Kontos sperrt (`locked`), eine ÄLTERE
 * noch offene hält an (`hold`), bis sie entschieden ist; eine abgelehnte zählt
 * nie. Die Standortangabe schreibt der Client — ein veränderter Client könnte
 * sie verfälschen und so der Regel entgehen; mehr als eine Hürde ist sie nicht.
 *
 * @param {object} candidate  policyOf-Objekt (id, userId, createdAt, gps {lat, lon, genauigkeitM})
 * @param {object[]} others   andere Einreichungen derselben EAN (policyOf, beliebiger Status)
 * @returns {{verdict:'ok'|'locked'|'hold', reason:string|null, priorId:string|null, priorIds:string[], abstandM:number|null, minuten:number|null}}
 */
function evaluateHaushalt(candidate, others) {
  const ok = { verdict: 'ok', reason: null, priorId: null, priorIds: [], abstandM: null, minuten: null };
  const ort = haushaltOrt(candidate && candidate.gps);
  const cAt = ms(candidate && candidate.createdAt);
  if (!ort || cAt == null || !candidate.userId) return ok;
  const nah = [];
  for (const o of others || []) {
    if (!o || o.id === candidate.id || !o.userId || o.userId === candidate.userId) continue;
    const oOrt = haushaltOrt(o.gps);
    const t = ms(o.createdAt);
    if (!oOrt || t == null) continue;
    const dt = Math.abs(t - cAt);
    if (dt >= HAUSHALT_FENSTER_MS) continue;
    const d = abstandM(ort, oOrt);
    if (d > HAUSHALT_RADIUS_M) continue;
    nah.push({ o, t, d, dt });
  }
  const befund = (verdict, reason, liste) => ({
    verdict, reason, priorId: liste[0].o.id, priorIds: liste.map((n) => n.o.id),
    abstandM: Math.round(liste[0].d), minuten: Math.round(liste[0].dt / 60000),
  });
  const frei = nah.filter((n) => n.o.status === 'approved').sort((a, b) => b.t - a.t);
  if (frei.length) return befund('locked', REASON.HAUSHALT, frei);
  const aelter = nah.filter((n) => n.o.status === 'pending' && n.t < cAt).sort((a, b) => a.t - b.t);
  if (aelter.length) return befund('hold', REASON.HAUSHALT_AELTER_OFFEN, aelter);
  return ok;
}

/**
 * Doppel-Befund zum Speichern am Dokument (`review.precheck.dup`) — dieselbe
 * Form für Morgenrunde und Prüfkonsole. Ohne ihn fehlt beim Zurückholen einer
 * Sperr-Ablehnung die Referenz („Früher/Anders").
 *
 * Bewusst OHNE `priorUserId` und `diff`: der Einreicher darf sein Dokument
 * lesen (firestore.rules), und die Referenz kann einem anderen Nutzer gehören —
 * dessen uid, Preis und Markt gehören nicht in fremde Dokumente.
 * `priorId` deshalb NUR bei einer eigenen Referenz (`sameUser === true`,
 * Schlussprüfung 03.10.2026): die Doc-IDs beginnen mit der uid des
 * Einreichers — eine fremde Referenz-ID verriet genau die uid, die oben
 * weggelassen wird (gemessen 03.10.: 237 Dokumente). Der Bestand wird nicht
 * bereinigt.
 */
function dupZumSpeichern(dup) {
  if (!dup) return null;
  return {
    verdict: dup.verdict ?? 'ok', reason: dup.reason ?? null, priorId: dup.sameUser === true ? dup.priorId ?? null : null,
    sameUser: dup.sameUser ?? null, lockUntil: dup.lockUntil ?? null,
    updatedFields: Array.isArray(dup.updatedFields) ? dup.updatedFields : [],
  };
}

/** Vollständigkeits-Vorprüfung (dieselben Regeln wie die manuellen Freigabe-Runden 08/2026). */
function completenessCheck(u, requiredSteps) {
  const problems = [];
  const images = (u && u.images) || {};
  const missing = (requiredSteps || []).filter((s) => !images[s]);
  if (missing.length) problems.push('unvollstaendig');
  const ean = String((u && u.ean) || '').replace(/\D/g, '');
  if (!(ean.length >= 8 && ean.length <= 14)) problems.push('ean_fehlt');
  if (!String((u && (u.productName || u.productNameOcr)) || '').trim()) problems.push('kein_produktname');
  return { ok: problems.length === 0, problems, missing };
}

module.exports = {
  SAME_USER_LOCK_MS, HAUSHALT_FENSTER_MS, HAUSHALT_RADIUS_M, HAUSHALT_GENAUIGKEIT_MAX_M, REASON, APP_GRUND, appGrund,
  evaluateDuplicate, evaluateHaushalt, dataDiffers, manufacturerEqual, completenessCheck, dupZumSpeichern, normText, ms,
};
