'use strict';
/**
 * Guthaben & Auszahlungen fürs Dashboard (tagesbericht.html).
 *
 * Anlass (01.10.2026, Patrick): „mir fehlt im dashboard noch eine übersicht
 * wieviel noch zur auszahlung offen ist: user die 10 schon erreicht haben aber
 * nicht ausgezahlt haben und user die 10 noch nicht erreicht haben. also was
 * läuft alles an. wieviele sind nah dran".
 *
 * Quellen (das Laden macht auszahlungLaden.js, diese Datei ist rein):
 *  - `users/{uid}.cashback_balance_cents` = offenes Guthaben. Eine Auszahlungs-
 *    anfrage bucht es SOFORT ab (requestPayout); angefragte, noch nicht
 *    verschickte Auszahlungen stehen deshalb NICHT mehr im Guthaben, sondern in
 *    `cashback_payouts` mit status 'requested'.
 *  - Konto-Art aus Firebase Auth: Auszahlen darf nur, wer ein Konto MIT E-Mail
 *    hat (requestPayout → kontoPruefen, emailPflicht). Gäste sammeln, können
 *    aber nicht auszahlen (Entscheidung 25.09.2026, „erst einreichen, dann Konto").
 *  - Ledger `users/{uid}/cashback_ledger` nur für Personen ab der Hälfte der
 *    Schwelle und für Empfänger von Auszahlungen.
 *
 * Test-Daten werden getrennt ausgewiesen, nicht stillschweigend weggelassen
 * (Gegenprüfung 01.10.2026): Das einzige Konto über 10 € trug eine Testgutschrift
 * über 100 € vom Go-Live (Ledger-Grund `admin_test_credit_golive_v1`), und 12 der
 * 25 Auszahlungen liefen in der Testumgebung von Tremendous. Mitgezählt hätte die
 * Seite „1 Person auszahlungsreif" und „250,71 € ausgezahlt" gemeldet — echt waren
 * 0 Personen und 108,71 €. Das Guthaben eines Testkontos bleibt trotzdem echt
 * auszahlbar, deshalb steht es sichtbar daneben.
 *
 * Alle Grenzen hängen an der Schwelle aus `cashback_config/v1.payoutThresholdCents`.
 */

const TAG_MS = 24 * 60 * 60 * 1000;

/** Stufen als Anteil der Schwelle. Bei 10 €: 0–1, 1–2, 2–4, 4–6, 6–8, 8–10, ab 10 €. */
const STUFEN = [0, 0.1, 0.2, 0.4, 0.6, 0.8, 1];
/** „Nah dran" = ab 80 % der Schwelle. */
const NAH_AB = 0.8;
/** Einzeln aufgeführt wird ab der Hälfte der Schwelle. */
const LISTE_AB = 0.5;
const LISTE_MAX = 60;
/** Tempo: Zuwachs der letzten 30 Tage, bei jüngeren Konten über mindestens 7 Tage verteilt. */
const TEMPO_TAGE_MIN = 7;
const TEMPO_TAGE_MAX = 30;
/** Ledger-Grund einer manuellen Testgutschrift (Go-Live 28.06.2026). */
const TEST_GRUND = /^admin_test_credit/;

const KONTO_ARTEN = ['konto', 'ohne_email', 'gast', 'unbekannt'];
/** Eine angeforderte Auszahlung gilt erst nach 15 Minuten als hängend (processPayout läuft sofort). */
const HAENGT_AB_MS = 15 * 60 * 1000;

/**
 * Konto-Art aus einem Firebase-Auth-Datensatz (UserRecord-ähnlich), nach der
 * Regel von requestPayout (cashback-pipeline/lib/gastUebernahme.js).
 * @returns {'konto'|'ohne_email'|'gast'|'unbekannt'}
 */
function kontoArt(au) {
  if (!au || au.disabled) return 'unbekannt';
  const anbieter = Array.isArray(au.providerData) ? au.providerData : [];
  if (!anbieter.length) return 'gast';
  return au.email ? 'konto' : 'ohne_email';
}

/** Liegt der Einlöse-Link in der Testumgebung von Tremendous? */
function istTestLink(link) {
  try { return new URL(String(link)).hostname.startsWith('testflight.'); } catch { return false; }
}

const leer = () => ({ personen: 0, cents: 0 });
const add = (z, cents) => { z.personen += 1; z.cents += cents; };

/** Auszahlungen, die gescheitert und zurückgebucht sind (admin_adjust mit derselben payoutId). */
function zurueckgebucht(ledger) {
  return new Set(ledger.filter((e) => e.type === 'admin_adjust' && e.payoutId).map((e) => e.payoutId));
}

/**
 * Seit wann liegt das Guthaben ununterbrochen über der Schwelle? Geht das
 * Ledger vorwärts und merkt sich den letzten Übertritt von unter auf über die
 * Schwelle. Eine gescheiterte Auszahlung samt Rückbuchung zählt nicht als
 * Unterbrechung. Fehlt `balanceAfter` an einem Eintrag, ist die Aussage nicht
 * belegbar → null.
 */
function ueberSchwelleSeit(ledger, schwelle) {
  const storniert = zurueckgebucht(ledger);
  const sortiert = ledger
    .filter((e) => e.at != null && !(e.payoutId && storniert.has(e.payoutId)))
    .sort((a, b) => a.at - b.at);
  let seit = null;
  for (const e of sortiert) {
    if (!Number.isFinite(e.balanceAfter)) return null;
    if (e.balanceAfter >= schwelle) { if (seit == null) seit = e.at; }
    else seit = null;
  }
  return seit;
}

/**
 * @param {object} e
 * @param {number} e.jetzt
 * @param {number} e.schwelleCents
 * @param {Array<{uid:string, cents:number, konto:string}>} e.nutzer  alle mit Guthaben > 0
 * @param {Map<string, Array<{type:string, cents:number, at:number|null, balanceAfter:number|null, payoutId?:string|null, reason?:string|null}>>} e.ledger
 * @param {Array<{uid:string|null, status:string, cents:number, at:number|null, testLink?:boolean}>} e.auszahlungen
 */
function baueAuszahlung({ jetzt, schwelleCents, nutzer, ledger = new Map(), auszahlungen = [] }) {
  const schwelle = schwelleCents;
  const testKonten = new Set([...ledger].filter(([, l]) => l.some((e) => TEST_GRUND.test(String(e.reason || '')))).map(([uid]) => uid));

  const gesamt = leer();
  const reif = leer();
  const nah = leer();
  const darunter = leer();
  const test = leer();
  const reifNachKonto = Object.fromEntries(KONTO_ARTEN.map((k) => [k, leer()]));
  const nachKonto = Object.fromEntries(KONTO_ARTEN.map((k) => [k, leer()]));
  const stufen = STUFEN.map((anteil, i) => ({
    vonCents: Math.round(anteil * schwelle),
    bisCents: i + 1 < STUFEN.length ? Math.round(STUFEN[i + 1] * schwelle) : null,
    ...leer(),
  }));
  const nahAb = Math.round(NAH_AB * schwelle);
  let unterVierzig = 0;

  for (const n of nutzer) {
    const cents = Number(n.cents) || 0;
    if (cents <= 0) continue;
    if (testKonten.has(n.uid)) { add(test, cents); continue; }
    const konto = KONTO_ARTEN.includes(n.konto) ? n.konto : 'unbekannt';
    add(gesamt, cents);
    add(nachKonto[konto], cents);
    // Gleiche gerundete Grenzen wie die Stufen — Kachel und Balken stimmen überein.
    if (cents >= schwelle) { add(reif, cents); add(reifNachKonto[konto], cents); }
    else if (cents >= nahAb) add(nah, cents);
    else add(darunter, cents);
    add(stufen.findLast((s) => cents >= s.vonCents), cents);
    if (cents < Math.round(0.4 * schwelle)) unterVierzig += cents;
  }

  const zeileVon = (n) => {
    const eintraege = ledger.get(n.uid) || [];
    const storniert = zurueckgebucht(eintraege);
    const ab30 = jetzt - TEMPO_TAGE_MAX * TAG_MS;
    // Verdient = Gutschriften minus Stornos. Auszahlungen, deren Rückbuchungen
    // und andere manuelle Buchungen (admin_adjust) sind kein Verdienst.
    const verdient30 = eintraege.reduce((s, e) => {
      if (e.at == null || e.at < ab30) return s;
      if (e.type === 'earn') return s + (Number(e.cents) || 0);
      if (e.type === 'reverse') return s - Math.abs(Number(e.cents) || 0);
      return s;
    }, 0);
    const ersteGutschrift = eintraege.filter((e) => e.type === 'earn' && e.at != null).reduce((m, e) => Math.min(m, e.at), Infinity);
    const tempoTage = Math.min(TEMPO_TAGE_MAX, Math.max(TEMPO_TAGE_MIN, Math.ceil((jetzt - ersteGutschrift) / TAG_MS)));
    const proTag = verdient30 > 0 && Number.isFinite(ersteGutschrift) ? verdient30 / tempoTage : 0;
    const auszahl = eintraege
      .filter((e) => e.type === 'payout' && e.at != null && !(e.payoutId && storniert.has(e.payoutId)))
      .sort((a, b) => b.at - a.at)[0];
    const fehlt = Math.max(0, schwelle - n.cents);
    const ueber = n.cents >= schwelle && eintraege.length ? ueberSchwelleSeit(eintraege, schwelle) : null;
    return {
      // Nur ein Kürzel, keine vollständige Kennung — die Seite braucht keine.
      kuerzel: String(n.uid).slice(0, 6),
      cents: n.cents,
      konto: KONTO_ARTEN.includes(n.konto) ? n.konto : 'unbekannt',
      test: testKonten.has(n.uid),
      verdient30,
      // Hochrechnung aus dem Tempo der letzten 30 Tage; ohne Zuwachs keine Prognose.
      tageBisSchwelle: fehlt === 0 ? 0 : proTag > 0 ? Math.ceil(fehlt / proTag) : null,
      // Wartet = über der Schwelle, und zwar seit dem Übertritt oder seit der
      // letzten (Teil-)Auszahlung, je nachdem, was später war.
      wartetSeit: ueber == null ? null : Math.max(ueber, auszahl ? auszahl.at : 0),
      letzteAuszahlung: auszahl ? auszahl.at : null,
    };
  };

  // Liste: alle ab der Hälfte der Schwelle UND alle, die schon einmal ausgezahlt
  // haben und wieder sammeln — genau die zahlen erfahrungsgemäß wieder aus
  // (Rückblick 01.10.: 5 von ihnen lagen unter 5 € und fehlten sonst).
  const hatAusgezahlt = (uid) => {
    const l = ledger.get(uid) || [];
    const storniert = zurueckgebucht(l);
    return l.some((e) => e.type === 'payout' && !(e.payoutId && storniert.has(e.payoutId)));
  };
  const kandidaten = nutzer.filter((n) => (Number(n.cents) || 0) >= LISTE_AB * schwelle || ((Number(n.cents) || 0) > 0 && hatAusgezahlt(n.uid)));
  // Reife zuerst, dann wer am schnellsten die Schwelle erreicht, „sammelt nicht" zuletzt.
  const rang = (z) => (z.tageBisSchwelle == null ? Infinity : z.tageBisSchwelle);
  const liste = kandidaten.map(zeileVon)
    .sort((a, b) => rang(a) - rang(b) || b.cents - a.cents)
    .slice(0, LISTE_MAX);

  // Vorschau: wer die Schwelle in den nächsten 30 Tagen voraussichtlich NEU erreicht
  // (ohne die schon Reifen — die stehen in eigener Kachel —, ohne Testkonten).
  // Grobe Schätzung: sie rechnet das Tempo weiter und kennt nur die Liste.
  const vorschau30 = { personen: 0, cents: 0 };
  for (const z of liste) {
    if (z.test || z.tageBisSchwelle == null || z.tageBisSchwelle === 0 || z.tageBisSchwelle > 30) continue;
    vorschau30.personen += 1;
    vorschau30.cents += schwelle;
  }

  // Auszahlungen. Zwei Arten „Test", weil nur eine davon Geld bewegt hat:
  //  - testumgebung: Link von testflight.tremendous.com — kein Geld geflossen,
  //  - anTestkonto: echte Auszahlung an ein Testkonto — Geld hat Tremendous verlassen.
  const posten = () => ({ anzahl: 0, cents: 0 });
  const dazu = (z, cents) => { z.anzahl += 1; z.cents += cents; };
  const az = { versandt: posten(), letzte30: posten(), testumgebung: posten(), anTestkonto: posten(), haengt: posten(), gescheitert30: posten() };
  const empfaenger = new Set();
  for (const p of auszahlungen) {
    const cents = Number(p.cents) || 0;
    if (p.testLink === true) { if (p.status === 'sent' || p.status === 'delivered') dazu(az.testumgebung, cents); continue; }
    const anTest = Boolean(p.uid && testKonten.has(p.uid));
    if (p.status === 'sent' || p.status === 'delivered') {
      if (anTest) { dazu(az.anTestkonto, cents); continue; }
      dazu(az.versandt, cents);
      if (p.uid) empfaenger.add(p.uid);
      if (p.at != null && p.at >= jetzt - 30 * TAG_MS) dazu(az.letzte30, cents);
    } else if (p.status === 'requested') {
      // Erst nach 15 Minuten ein Problem — sonst ist sie nur gerade unterwegs.
      if (p.at != null && p.at <= jetzt - HAENGT_AB_MS) dazu(az.haengt, cents);
    } else if (p.status === 'failed' && !anTest && p.at != null && p.at >= jetzt - 30 * TAG_MS) dazu(az.gescheitert30, cents);
  }

  return {
    schwelleCents: schwelle,
    nahAbCents: nahAb,
    listeAbCents: Math.round(LISTE_AB * schwelle),
    gesamt, reif, nah, darunter, test,
    reifNachKonto, nachKonto,
    anteilUnterVierzigProzent: gesamt.cents ? unterVierzig / gesamt.cents : 0,
    vierzigProzentCents: Math.round(0.4 * schwelle),
    stufen,
    liste,
    listeGekuerzt: kandidaten.length > LISTE_MAX,
    vorschau30,
    auszahlungen: { ...az, empfaenger: empfaenger.size },
  };
}

module.exports = { baueAuszahlung, kontoArt, istTestLink, ueberSchwelleSeit, STUFEN, NAH_AB, LISTE_AB };
