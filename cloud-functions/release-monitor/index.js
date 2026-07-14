/**
 * Release-Monitor Aggregator — versorgt das Monitoring-Dashboard
 * (Firebase Hosting: /monitor-md2026.html) mit frischen Zahlen.
 *
 * Berechnet in EINEM Lauf:
 *   • Sessions/Tag (letzte 14 Tage, via journeys.startTime — braucht den
 *     COLLECTION_GROUP-Index auf startTime, angelegt 12.07.2026)
 *   • v6-Verhaltens-Metriken (rollierendes 72h-Fenster, gesamt/iOS/Android)
 *   • Vor-Release-Baseline (fixes Fenster 04.–06.07.2026, Public 5.x)
 *
 * Output: aggregates/releaseMonitor_v1 — die aggregates-Collection ist per
 * Firestore-Rules öffentlich lesbar (read: if true), die Dashboard-Seite
 * liest das Doc unauthentifiziert per REST. Es landen NUR aggregierte
 * Kennzahlen im Doc, keinerlei PII.
 *
 * WICHTIG (Datenlage, 12.07.2026): journeys.lastUpdated ist bei ~759k
 * Alt-Docs ein defekt serialisierter serverTimestamp-Sentinel (Map mit
 * _methodName) — Zeitfenster IMMER über startTime, nie über lastUpdated.
 *
 * Trigger:
 *   • Scheduled alle 6 Stunden.
 *   • HTTP (manuell / „Neu berechnen"-Button der Seite). Kein Key, aber
 *     Spam-Schutz: läuft nur, wenn das Aggregat älter als 10 Min ist
 *     (gleiches Keyless-Muster wie aggregateTopProductsHttp).
 *
 * Deploy: firebase deploy --only functions:release-monitor
 * Manuell: curl https://europe-west1-markendetektive-895f7.cloudfunctions.net/aggregateReleaseMonitorHttp
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const AGG_PATH = ['aggregates', 'releaseMonitor_v1'];
const MIN_RECOMPUTE_GAP_MS = 10 * 60 * 1000;

// Fixe Vor-Release-Baseline (Public 5.x, vor dem 6.0-Store-Release am 12.07).
const OLD_FROM = new Date('2026-07-04T00:00:00Z');
const OLD_TO = new Date('2026-07-06T00:00:00Z');
// v6-Fenster: rollierend 72 h.
const V6_WINDOW_MS = 72 * 60 * 60 * 1000;
// Store-Release 6.0 = 12.07.2026 (in den journeys-Daten belegt: 6.x-Session-
// Anteil 07-10/11 = 0 %, springt 07-12 auf 41 %). Trennt v5-Ära/v6-Ära beim Feedback.
const RELEASE_ISO = '2026-07-12';

const SELECT_FIELDS = [
  'journeyId', 'viewedProductsCount', 'convertedCount', 'status',
  'completionReason', 'filterMetrics', 'consumerProfile', 'app',
  'scannedcodes', 'searchedproducts', 'customItems',
  // screenName + startTime: für die „Wer landet in der App?"-Buckets
  // (erste Journey pro User → Onboarding-Screen vs. App-Screen).
  'screenName', 'startTime',
];

// App-interne Screens (= User ist am Onboarding vorbei in die App geroutet).
const APP_SCREEN_PREFIXES = [
  'home', 'explore', 'rewards', 'product-comparison', 'noname-detail',
  'external-product', 'achievements', 'profile', 'barcode', 'shopping',
  'favorites', 'cashback', 'purchase', 'history',
];
const isAppScreen = (name) => {
  const s = String(name || '');
  return APP_SCREEN_PREFIXES.some((p) => s.startsWith(p));
};

function ts(d) {
  return admin.firestore.Timestamp.fromDate(d);
}

// Neue User (Neu-Installs) im Zeitraum — via users.created_time (Registrierungs-
// Zeitpunkt). Single-Field-Range → automatischer Index, kein Composite nötig.
async function newUsersBetween(from, to) {
  const snap = await db
    .collection('users')
    .where('created_time', '>=', ts(from))
    .where('created_time', '<', ts(to))
    .count()
    .get();
  return snap.data().count;
}

async function sampleBetween(from, to, limit) {
  const snap = await db
    .collectionGroup('journeys')
    .where('startTime', '>=', ts(from))
    .where('startTime', '<', ts(to))
    .select(...SELECT_FIELDS)
    .limit(limit)
    .get();
  const rows = [];
  snap.forEach((d) => rows.push({
    ...(d.data() || {}),
    // users/{uid}/journeys/{id} → uid für die Pro-User-Metriken.
    _uid: d.ref.parent.parent ? d.ref.parent.parent.id : null,
  }));
  return rows;
}

/** Doppel-Docs pro journeyId (Alt-Bug) — vollstes Doc gewinnt. */
function dedupe(rows) {
  const best = new Map();
  for (const r of rows) {
    const k = r.journeyId || Math.random().toString(36);
    const prev = best.get(k);
    if (!prev || (r.viewedProductsCount || 0) > (prev.viewedProductsCount || 0)) {
      best.set(k, r);
    }
  }
  return [...best.values()];
}

function metrics(rows) {
  const n = rows.length;
  const fm = (r) => r.filterMetrics || {};
  const cp = (r) => r.consumerProfile || {};
  const nonEmpty = (a) => Array.isArray(a) && a.length > 0;
  let bounce = 0, zero = 0, viewsSum = 0, filter = 0, demo = 0, markt = 0;
  let cart = 0, purch = 0, conv = 0, scan = 0, such = 0, cust = 0;
  for (const r of rows) {
    const v = r.viewedProductsCount || 0;
    viewsSum += v;
    const fchg = fm(r).filterChangesCount || 0;
    const factive = fm(r).totalActiveFilters || 0;
    if (v === 0) zero += 1;
    if (v === 0 && fchg === 0 && !nonEmpty(r.scannedcodes) && !nonEmpty(r.searchedproducts) && !nonEmpty(r.customItems)) bounce += 1;
    if (factive > 0 || fchg > 0) filter += 1;
    const hasAge = cp(r).age != null && cp(r).age !== '';
    const hasGender = cp(r).gender != null && cp(r).gender !== '';
    if (hasAge || hasGender) demo += 1;
    if (cp(r).favoriteMarket) markt += 1;
    if (['in_cart', 'purchased', 'inactive_with_cart'].includes(r.status)) cart += 1;
    if (r.status === 'purchased') purch += 1;
    if ((r.convertedCount || 0) > 0) conv += 1;
    if (nonEmpty(r.scannedcodes)) scan += 1;
    if (nonEmpty(r.searchedproducts)) such += 1;
    if (nonEmpty(r.customItems)) cust += 1;
  }
  return {
    n,
    bounce, zero,
    avgViews: n ? Math.round((viewsSum / n) * 100) / 100 : 0,
    filter, demo, markt, cart, purch, conv, scan, such, cust,
  };
}

// ─── Pro-User-Metriken (Audit 12.07.2026) ────────────────────────
// Der Journey-Schnappschuss (consumerProfile) wird beim Journey-START
// aus dem users-Doc gezogen — Neu-User setzen Markt/Demografie aber
// erst SPÄTER im Onboarding derselben Session, Resume-Journeys lesen
// nie neu. Die Session-Quote unterzählt daher strukturell (gemessen:
// nur ~54 % der Sessions von Markt-Usern trugen den Stempel). Für
// Demografie/Markt/Onboarding daher direkt das users-Doc der im
// Fenster aktiven User lesen — pro User, nicht pro Sitzung.

function distinctUids(rows) {
  return [...new Set(rows.map((r) => r._uid).filter(Boolean))];
}

async function loadUserFacts(uids) {
  const map = new Map();
  for (let i = 0; i < uids.length; i += 100) {
    const chunk = uids.slice(i, i + 100);
    // eslint-disable-next-line no-await-in-loop
    const snaps = await db.getAll(
      ...chunk.map((u) => db.doc(`users/${u}`)),
      { fieldMask: ['favoriteMarket', 'age', 'gender', 'onboardingCompletedAt', 'created_time', 'email'] },
    );
    for (const s of snaps) {
      if (!s.exists) continue;
      const d = s.data() || {};
      const email = String(d.email || '').trim();
      map.set(s.id, {
        markt: !!d.favoriteMarket,
        demo: (d.age != null && d.age !== '') || (d.gender != null && d.gender !== ''),
        onboarding: !!d.onboardingCompletedAt,
        createdAtMs: d.created_time && d.created_time.toMillis ? d.created_time.toMillis() : null,
        // Echtes Konto = nicht-leere, nicht-Platzhalter-Mail.
        registered: !!email && email !== 'anonymous@markendetektive.app',
      });
    }
  }
  return map;
}

// ─── Onboarding-Funnel (Audit 12.07.2026, User-Frage „70 %?") ────
// Quelle: onboardingResultsV5 — ein Doc pro Onboarding-Session.
// „Begonnen" = mind. eine bewusste Interaktion (Schritt-Submit oder
// „Später"-Tap); der Start-Screen schreibt NICHTS — das galt in v1
// (5.x-Store) exakt wie in v3 (6.0, Variante B), Messung ist also
// version-übergreifend identisch (git-verifiziert: `currentStep <= 1
// → return` in beiden Ständen).
//
// Fixe Alt-Baseline (Fenster 04.–06.07. ist abgeschlossen, live
// gemessen 12.07.2026): 1.599 Neu-User · 1.474 Sessions · 1.110
// abgeschlossen (75,3 % der Begonnenen — „die 70+ %").
// `aktiv` alt: Stichprobe n=500 der Kohorte (60,4 % ±4,3pp) hochgerechnet.
// 5.x hatte KEINE Re-Anon-Verzerrung (alle Neu-User echt) → corrected*
// = roh, reAnon = 0. `registered` alt: 97/1599 = 6,1 % (live gemessen
// 13.07., echte Mail im 04.–06.07.-Fenster).
const OLD_ONBOARDING = {
  installs: 1599, started: 1474, completed: 1110, aktiv: 966,
  sawOnb: 1474, completedUsers: 1110, reAnon: 0, bounced: 125,
  correctedDenom: 1599, correctedAktiv: 966, registered: 97,
};
// 5.x-Schritt-Funnel (fix, live gemessen 13.07. über 04.–06.07.-Fenster).
// Semantische Stufen, auf den 5.x-Flow gemappt (Märkte war dort Step 3,
// Budget Step 5, Prioritäten Step 6 — Land+Auth + Akquise lagen dazwischen).
const OLD_STEPFUNNEL = { hero: 1599, maerkte: 1138, budget: 1117, prioritaeten: 1108, done: 1104, skipMaerkte: 0 };

async function onboardingFunnel(v6rows, facts, fromDate) {
  // Neu-Installs = im Fenster angelegte User mit 6.0-Session (jeder
  // App-Open erzeugt eine Journey → Bounce-Installs sind enthalten).
  // ACHTUNG (Befund 12.07.2026): enthält auch re-anonymisierte
  // Bestands-User — das 5.x→6.0-Update verliert die Auth-Session
  // (Web-SDK AsyncStorage ≠ RNFirebase-Keychain), Anon-Veteranen
  // bekommen eine frische UID und zählen hier als "neu". Sie landen
  // direkt in der App (lokales Onboarding-Flag überlebt das Update)
  // → drückt die Start-Quote, hebt die Aktiv-Quote. Bis zur
  // Identitäts-Rettung als Caveat im Dashboard vermerkt.
  const fromMs = fromDate.getTime();
  const nonEmpty = (a) => Array.isArray(a) && a.length > 0;
  const sessionActive = (r) => (r.viewedProductsCount || 0) > 0
    || nonEmpty(r.scannedcodes) || nonEmpty(r.searchedproducts) || nonEmpty(r.customItems)
    || ['in_cart', 'purchased', 'inactive_with_cart'].includes(r.status)
    || (r.convertedCount || 0) > 0;
  const activeUids = new Set(v6rows.filter(sessionActive).map((r) => r._uid).filter(Boolean));

  // Erste Journey pro uid (früheste startTime) → für die „Wer landet in der
  // App?"-Buckets: startet der User auf einem App-Screen (home/explore/…),
  // wurde er am Onboarding vorbei in die App geroutet (Veteran/Bypass);
  // startet er auf app_start/onboarding, ist er ein echter Onboarding-/
  // Boot-Abbrecher.
  const firstScreenByUid = new Map();
  // App-Version pro uid (der jüngsten Session) → für die reAnon-Segmentierung
  // nach Version. Die Sessions tragen app.version bereits; damit lässt sich die
  // Re-Anon-Rate 6.0.5 vs. 6.0.3/6.0.2 isolieren (ohne Client-Änderung).
  const versionByUid = new Map();
  for (const r of v6rows) {
    const u = r._uid;
    if (!u) continue;
    const t = r.startTime && r.startTime.toMillis ? r.startTime.toMillis() : 0;
    const prev = firstScreenByUid.get(u);
    if (!prev || t < prev.t) firstScreenByUid.set(u, { t, screen: r.screenName });
    const ver = String((r.app || {}).version || '');
    const os = String((r.app || {}).os || '');
    const vprev = versionByUid.get(u);
    if (ver && (!vprev || t >= vprev.t)) versionByUid.set(u, { t, ver, os });
  }

  // v3-Onboarding-Sessions im Fenster → distinct uids die das Onboarding
  // begonnen bzw. abgeschlossen haben. userId mitselektieren, damit wir
  // pro Neu-Install klassifizieren können. (5.x-Rest schreibt v1-Docs in
  // dieselbe Collection → Version-Filter in-memory, kein Composite-Index.)
  const sawUids = new Set();
  const completedUids = new Set();
  const skippedUids = new Set(); // hat ein abandoned-Doc (Onboarding übersprungen)
  // Weitester erreichter Schritt pro uid (für den Schritt-Funnel).
  // completed → 99; sonst abandonedAtStep bzw. currentStep.
  const reachedByUid = new Map();
  // Nur Docs MIT funnelStage-Stempeln (6.0.4+): der echte aktuelle Funnel über
  // die Onboarding-STARTS, frei vom alten Skip-am-Markt-Artefakt der Alt-Docs.
  const stampedByUid = new Map();
  let started = 0;
  let completed = 0;
  let last = null;
  for (;;) {
    let q = db.collection('onboardingResultsV5')
      .where('lastUpdateTime', '>=', ts(fromDate))
      .orderBy('lastUpdateTime', 'asc')
      .select('lastUpdateTime', 'status', 'version', 'userId', 'currentStep', 'abandonedAtStep',
        'stage_step_2_passed_at', 'stage_step_3_passed_at', 'stage_step_4_passed_at', 'funnelStage', 'heroTapped')
      .limit(1000);
    if (last) q = q.startAfter(last);
    // eslint-disable-next-line no-await-in-loop
    const snap = await q.get();
    if (snap.empty) break;
    snap.forEach((d) => {
      const x = d.data() || {};
      if ((x.version || 'v1') !== 'v3') return;
      started += 1;
      const uid = x.userId;
      const isDone = x.status === 'completed';
      if (uid && uid !== 'anonymous') {
        sawUids.add(uid);
        // rank = weitester BESTANDENER Schritt (Weiter getippt), NICHT nur
        // erreicht. completed=4 · in_progress currentStep=N bedeutet Schritt N
        // bestanden · abandoned (Skip) bei Schritt N bedeutet nur die Schritte
        // VOR N bestanden (N selbst wurde übersprungen, nicht bestanden).
        // rank: 1=Märkte, 2=Budget, 3=Prioritäten, 4=abgeschlossen, 0=nichts.
        let rank = 0;
        let skipAtMaerkte = false;
        // Bevorzugt die funnelStage-Stempel (ab 6.0.4): stage_step_2/3/4_passed_at
        // sind gesetzt, sobald der jeweilige Schritt WIRKLICH bestanden wurde —
        // unabhängig davon, ob der User danach skippt (der alte abandonedAtStep-
        // Pfad zählte einen getippten Markt+Skip fälschlich als „nicht bestanden"
        // → das war die 44%-Artefakt-Zahl). Alt-Docs ohne Stempel (6.0.3-) fallen
        // auf die bisherige status/currentStep-Logik zurück.
        const hasStamps = !!(x.stage_step_2_passed_at || x.stage_step_3_passed_at ||
          x.stage_step_4_passed_at || x.funnelStage);
        if (isDone) {
          rank = 4;
        } else if (hasStamps) {
          if (x.stage_step_4_passed_at) rank = 3;      // Prioritäten bestanden
          else if (x.stage_step_3_passed_at) rank = 2; // Budget bestanden
          else if (x.stage_step_2_passed_at) rank = 1; // Märkte bestanden
          else rank = 0;                               // nur Hero (gesehen/getippt)
          // Skip am Märkte-Schritt = abgebrochen, ohne step_2 je zu bestehen.
          if (x.status === 'abandoned' && !x.stage_step_2_passed_at) skipAtMaerkte = true;
        } else if (x.status === 'abandoned') {
          const s = typeof x.abandonedAtStep === 'number' ? x.abandonedAtStep : 0;
          rank = s > 4 ? 3 : s > 3 ? 2 : s > 2 ? 1 : 0; // Skip bei ≤2 = Märkte NICHT bestanden
          if (s <= 2) skipAtMaerkte = true;
        } else { // in_progress: currentStep = zuletzt bestandener Schritt
          const c = x.currentStep || 0;
          rank = c >= 4 ? 3 : c >= 3 ? 2 : c >= 2 ? 1 : 0;
        }
        const prev = reachedByUid.get(uid);
        if (!prev || rank > prev.rank) reachedByUid.set(uid, { rank, skipAtMaerkte });
        else if (rank === prev.rank && skipAtMaerkte) reachedByUid.set(uid, { rank, skipAtMaerkte: true });
        // Stempel-Kohorte separat (nur Docs mit funnelStage) → sauberer 6.0.x-Funnel.
        if (hasStamps) {
          const prevS = stampedByUid.get(uid);
          if (!prevS || rank > prevS.rank) stampedByUid.set(uid, { rank });
        }
      }
      if (isDone) {
        completed += 1;
        if (uid && uid !== 'anonymous') completedUids.add(uid);
      } else if (x.status === 'abandoned' && uid && uid !== 'anonymous') {
        skippedUids.add(uid);
      }
    });
    last = snap.docs[snap.docs.length - 1];
    if (snap.size < 1000) break;
  }

  // Jeden Neu-Install (created_time im Fenster) in einen Bucket einsortieren:
  //  • sawOnb   = hat eine v3-Onboarding-Session → ECHTER Neu-Install, der
  //               das Onboarding gesehen hat.
  //  • reAnon   = aktiv in der App, aber KEINE Onboarding-Session → mit hoher
  //               Wahrscheinlichkeit ein re-anonymisierter Bestands-User
  //               (landet dank überlebendem lokalen Flag direkt in der App;
  //               enthält auch die wenigen Deep-Link-Installs).
  //  • bounced  = weder Onboarding-Session noch aktiv → echter Neu-Install,
  //               der am ersten Screen abgesprungen ist.
  // Der EHRLICHE Nenner für die Onboarding-Quoten ist installs − reAnon
  // (= sawOnb + bounced): nur echte Neu-Installs, die überhaupt die Chance
  // hatten, das Onboarding zu starten.
  let installs = 0;
  let aktiv = 0;
  let sawOnb = 0;
  let completedUsers = 0;
  let reAnon = 0;
  let bounced = 0;
  let registered = 0;
  // Schritt-Funnel v6 (rank: 1=Märkte bestanden, 2=Budget, 3=Prioritäten,
  // 4=abgeschlossen). stSkipMaerkte = auf dem Märkte-Screen „übersprungen".
  let stMaerkte = 0;
  let stBudget = 0;
  let stPrio = 0;
  let stSkipMaerkte = 0;
  // „Wer landet in der App?"-Buckets (exklusiv, priorisiert) über ALLE
  // Neu-Installs — beantwortet „egal ob geskippt oder durchlaufen".
  let lAktiv = 0;
  let lCompleted = 0;
  let lSkipped = 0;
  let lBypass = 0;
  let lHero = 0;
  // Pro-Version-Segmentierung der Kern-Buckets → Re-Anon-Rate je App-Version
  // (6.0.5 vs. 6.0.3/6.0.2) im Dashboard sichtbar machen. Rein aus der
  // Session-app.version, kein Client-Write nötig.
  const perV = {};
  const bumpV = (u, key) => {
    const info = versionByUid.get(u) || {};
    const ver = info.ver || 'unknown';
    const os = info.os === 'ios' ? 'ios' : info.os === 'android' ? 'android' : 'other';
    if (!perV[ver]) {
      perV[ver] = {
        installs: 0, reAnon: 0, sawOnb: 0, bounced: 0, aktiv: 0, registered: 0,
        ios: { installs: 0, reAnon: 0, bounced: 0, sawOnb: 0 },
        android: { installs: 0, reAnon: 0, bounced: 0, sawOnb: 0 },
      };
    }
    perV[ver][key] += 1;
    if ((os === 'ios' || os === 'android') && perV[ver][os][key] != null) perV[ver][os][key] += 1;
  };
  for (const u of distinctUids(v6rows)) {
    const f = facts.get(u);
    if (!(f && f.createdAtMs != null && f.createdAtMs >= fromMs)) continue;
    installs += 1;
    bumpV(u, 'installs');
    const isActive = activeUids.has(u);
    if (isActive) { aktiv += 1; bumpV(u, 'aktiv'); }
    if (f.registered) { registered += 1; bumpV(u, 'registered'); }
    // Landed-Bucket: aktiv > Onboarding fertig > übersprungen >
    // am Onboarding vorbei in App (Veteran/Bypass) > nur Hero/Boot gesehen.
    if (isActive) lAktiv += 1;
    else if (completedUids.has(u)) lCompleted += 1;
    else if (skippedUids.has(u)) lSkipped += 1;
    else if (isAppScreen((firstScreenByUid.get(u) || {}).screen)) lBypass += 1;
    else lHero += 1;
    if (sawUids.has(u)) {
      sawOnb += 1;
      bumpV(u, 'sawOnb');
      if (completedUids.has(u)) completedUsers += 1;
      const o = reachedByUid.get(u) || { rank: 0, skipAtMaerkte: false };
      if (o.rank >= 1) stMaerkte += 1; // Markt gewählt + Weiter (nicht Skip)
      if (o.rank >= 2) stBudget += 1;
      if (o.rank >= 3) stPrio += 1;
      if (o.rank === 0 && o.skipAtMaerkte) stSkipMaerkte += 1;
    } else if (isActive) {
      reAnon += 1;
      bumpV(u, 'reAnon');
    } else {
      bounced += 1;
      bumpV(u, 'bounced');
    }
  }
  const correctedDenom = installs - reAnon; // echte Neu-Installs
  const correctedAktiv = aktiv - reAnon; // aktive echte Neu-Installs (alle reAnon sind aktiv)
  // Stempel-basierter Funnel: über die gestempelten Onboarding-STARTS (Basis =
  // gestartete Onboardings, NICHT Installs). Das ist der echte aktuelle Funnel
  // ohne Alt-Artefakt — hero=100% → markt/budget/prio/done als Anteil davon.
  let fsStarts = 0; let fsMarkt = 0; let fsBudget = 0; let fsPrio = 0; let fsDone = 0;
  for (const [, o] of stampedByUid) {
    fsStarts += 1;
    if (o.rank >= 1) fsMarkt += 1;
    if (o.rank >= 2) fsBudget += 1;
    if (o.rank >= 3) fsPrio += 1;
    if (o.rank >= 4) fsDone += 1;
  }

  return {
    v6: {
      installs, started, completed, aktiv,
      sawOnb, completedUsers, reAnon, bounced, correctedDenom, correctedAktiv, registered,
      // Schritt-Funnel gegen echte Neu-Installs (correctedDenom):
      // maerkte = Markt gewählt + Weiter (echt bestanden); skipMaerkte =
      // auf dem Märkte-Screen „Onboarding überspringen" getippt.
      stepFunnel: { hero: correctedDenom, maerkte: stMaerkte, budget: stBudget, prioritaeten: stPrio, done: completedUsers, skipMaerkte: stSkipMaerkte },
      // Echter aktueller Onboarding-Funnel (nur funnelStage-Docs, Basis = Starts):
      stageFunnel: { hero: fsStarts, maerkte: fsMarkt, budget: fsBudget, prioritaeten: fsPrio, done: fsDone },
      // „Wer landet in der App?" über ALLE Neu-Installs (nicht correctedDenom):
      landed: { installs, aktiv: lAktiv, completed: lCompleted, skipped: lSkipped, bypass: lBypass, heroBounce: lHero },
      // Re-Anon pro App-Version (installs/reAnon je 6.0.x) → zeigt, ob 6.0.3+
      // die Re-Anon-Rate gesenkt hat oder ob es laufend passiert.
      byVersion: perV,
    },
    old: { ...OLD_ONBOARDING, stepFunnel: OLD_STEPFUNNEL },
  };
}

function perUserMetrics(rows, facts) {
  const uids = distinctUids(rows);
  let markt = 0;
  let demo = 0;
  let onboarding = 0;
  for (const u of uids) {
    const f = facts.get(u);
    if (!f) continue;
    if (f.markt) markt += 1;
    if (f.demo) demo += 1;
    if (f.onboarding) onboarding += 1;
  }
  return { usersN: uids.length, userMarkt: markt, userDemo: demo, userOnboarding: onboarding };
}

// Userfeedback (In-App-Rating-Prompt) aggregieren. `userfeedback` ist per Rules
// owner-only lesbar → nur das Admin-SDK (hier) kommt dran; das öffentliche
// Dashboard sieht ausschließlich diese anonymisierte Zusammenfassung.
// Felder: rating ('positive'|'negative'), feedbackText (oft null), triggerLevel,
// timestamp. Kommentare werden OHNE userId übernommen (anonymisiert), gekürzt.
async function feedbackSummary() {
  const LIMIT = 600;
  let snap;
  try {
    snap = await db.collection('userfeedback')
      .orderBy('timestamp', 'desc')
      .limit(LIMIT)
      .select('rating', 'feedbackText', 'timestamp', 'triggerLevel')
      .get();
  } catch (e) {
    console.warn('feedbackSummary failed:', e.message);
    return null;
  }
  let positive = 0;
  let negative = 0;
  let withText = 0;
  let v5t = 0; let v5p = 0; let v5n = 0; // Feedback der v5-Ära (vor Release)
  let v6t = 0; let v6p = 0; let v6n = 0; // Feedback der v6-Ära (ab Release)
  let minDay = null;
  let maxDay = null;
  const comments = [];
  snap.forEach((docSnap) => {
    const f = docSnap.data();
    const rating = f.rating === 'negative' ? 'negative' : 'positive';
    if (rating === 'negative') negative += 1; else positive += 1;
    const day = f.timestamp && f.timestamp.toDate ? f.timestamp.toDate().toISOString().slice(0, 10) : null;
    if (day) {
      if (!minDay || day < minDay) minDay = day;
      if (!maxDay || day > maxDay) maxDay = day;
      if (day >= RELEASE_ISO) { v6t += 1; if (rating === 'negative') v6n += 1; else v6p += 1; }
      else { v5t += 1; if (rating === 'negative') v5n += 1; else v5p += 1; }
    }
    const txt = typeof f.feedbackText === 'string' ? f.feedbackText.trim() : '';
    if (txt) {
      withText += 1;
      if (comments.length < 20) {
        comments.push({ rating, day, text: txt.slice(0, 240), level: f.triggerLevel || null });
      }
    }
  });
  const total = positive + negative;
  return {
    window: minDay && maxDay ? `${minDay} … ${maxDay}` : `letzte ${LIMIT}`,
    scanned: total,
    total,
    positive,
    negative,
    positivePct: total ? Math.round((100 * positive) / total) : 0,
    withText,
    releaseDate: RELEASE_ISO,
    eraV5: { total: v5t, positive: v5p, negative: v5n, positivePct: v5t ? Math.round((100 * v5p) / v5t) : 0 },
    eraV6: { total: v6t, positive: v6p, negative: v6n, positivePct: v6t ? Math.round((100 * v6p) / v6t) : 0 },
    comments, // newest-first (Query desc), nur Text-Kommentare, anonymisiert
  };
}

// Primäre-Markt-Verteilung aus users.favoriteMarketName (String). Bounded Scan
// der zuletzt aktiven User → repräsentativ + günstig. KEIN v5/v6-Split (Markt ist
// Profil-Attribut, nicht versioniert) — bewusst „aktueller Stand".
async function marketsSummary() {
  const LIMIT = 15000;
  let snap;
  try {
    snap = await db.collection('users')
      .orderBy('lastActivityAt', 'desc')
      .limit(LIMIT)
      .select('favoriteMarketName')
      .get();
  } catch (e) {
    console.warn('marketsSummary failed:', e.message);
    return null;
  }
  const counts = new Map();
  let withMarket = 0;
  snap.forEach((d) => {
    const name = String(d.data().favoriteMarketName || '').trim();
    if (!name) return;
    withMarket += 1;
    counts.set(name, (counts.get(name) || 0) + 1);
  });
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const TOP = 12;
  return {
    scanned: snap.size,
    withMarket,
    coveragePct: snap.size ? Math.round((100 * withMarket) / snap.size) : 0,
    distinct: counts.size,
    top: sorted.slice(0, TOP).map(([name, count]) => ({ name, count })),
    other: sorted.slice(TOP).reduce((s, [, c]) => s + c, 0),
    otherMarkets: Math.max(sorted.length - TOP, 0),
  };
}

// User-Basis-Totals über Aggregations-Queries (count/sum/avg) — server-seitig,
// KEIN Full-Scan (≈ wenige Reads statt 236k). Felder liegen top-level auf users/*.
// „aktueller Stand" der Voll-DB, kein v5/v6-Split.
async function userBaseSummary() {
  try {
    const { AggregateField } = admin.firestore;
    const usersCol = db.collection('users');
    const sevenDaysAgo = new Date(Date.now() - 7 * 86400000);
    // WICHTIG: Einzelfeld-Aggregationen (NICHT kombiniert) — eine kombinierte
    // aggregate({avg,sum,sum}) über mehrere Felder verlangt einen Composite-Index
    // (FAILED_PRECONDITION). Einzeln nutzen sie den automatischen Single-Field-
    // Index → kein Index-Management nötig. Kosten bleiben minimal (Aggregations-
    // Reads, kein Doc-Scan).
    const [totalAgg, avgLvlAgg, sumSavAgg, sumSavedAgg, activeAgg] = await Promise.all([
      usersCol.count().get(),
      usersCol.aggregate({ v: AggregateField.average('level') }).get(),
      usersCol.aggregate({ v: AggregateField.sum('totalSavings') }).get(),
      usersCol.aggregate({ v: AggregateField.sum('productsSaved') }).get(),
      usersCol.where('lastActivityAt', '>=', ts(sevenDaysAgo)).count().get(),
    ]);
    const total = totalAgg.data().count || 0;
    const avgLevel = avgLvlAgg.data().v || 0;
    const sumSavings = sumSavAgg.data().v || 0;
    const sumSaved = sumSavedAgg.data().v || 0;
    const active7d = activeAgg.data().count || 0;
    return {
      totalUsers: total,
      active7d,
      active7dPct: total ? Math.round((1000 * active7d) / total) / 10 : 0,
      avgLevel: Math.round(avgLevel * 100) / 100,
      totalSavings: Math.round(sumSavings * 100) / 100,
      productsSaved: sumSaved,
      avgSavings: total ? Math.round((100 * sumSavings) / total) / 100 : 0,
    };
  } catch (e) {
    console.warn('userBaseSummary failed:', e.message);
    return null;
  }
}

async function aggregate() {
  const startedAt = Date.now();

  // 1) Neue User/Tag (Neu-Installs) — letzte 14 Kalendertage (UTC-Tagesgrenzen).
  const daily = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = 13; i >= 0; i -= 1) {
    const from = new Date(today.getTime() - i * 86400000);
    const to = new Date(from.getTime() + 86400000);
    // eslint-disable-next-line no-await-in-loop
    const n = await newUsersBetween(from, to);
    daily.push({ day: from.toISOString().slice(0, 10), n });
  }

  // 2) v6-Sample (rollierend 72 h) — nach Version 6.x gefiltert.
  const now = new Date();
  const v6raw = dedupe(await sampleBetween(new Date(now.getTime() - V6_WINDOW_MS), now, 5000));
  const isV6 = (r) => String((r.app || {}).version || '').startsWith('6.');
  const v6 = v6raw.filter(isV6);
  const v6ios = v6.filter((r) => (r.app || {}).os === 'ios');
  const v6android = v6.filter((r) => (r.app || {}).os === 'android');

  // 2b) Pro-User-Fakten für die im v6-Fenster aktiven User (ein
  // getAll-Read pro 100 User; bei ~500 Usern ≈ 500 Reads pro Lauf).
  const facts = await loadUserFacts(distinctUids(v6));

  // 2c) Onboarding-Funnel (Begonnen/Abgeschlossen vs. Neu-Installs).
  const onboarding = await onboardingFunnel(v6, facts, new Date(now.getTime() - V6_WINDOW_MS));

  // 2d) Userfeedback (In-App-Rating-Prompt) — anonymisierte Zusammenfassung.
  const feedback = await feedbackSummary();

  // 2e) Primäre Märkte + User-Basis-Totals (aktueller Stand, kein v5/v6-Split).
  const markets = await marketsSummary();
  const userBase = await userBaseSummary();

  // 3) Vor-Release-Baseline (fix) — alles außer 6.x-TestFlight.
  const oldRows = dedupe(await sampleBetween(OLD_FROM, OLD_TO, 3000)).filter((r) => !isV6(r));

  const doc = {
    version: 'releaseMonitor_v1',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    computeMs: 0, // wird unten gesetzt
    windows: {
      v6: 'rolling-72h',
      old: `${OLD_FROM.toISOString().slice(0, 10)}..${OLD_TO.toISOString().slice(0, 10)} (Public 5.x, fix)`,
    },
    daily,
    v6: {
      all: { ...metrics(v6), ...perUserMetrics(v6, facts) },
      ios: { ...metrics(v6ios), ...perUserMetrics(v6ios, facts) },
      android: { ...metrics(v6android), ...perUserMetrics(v6android, facts) },
    },
    old: metrics(oldRows),
    onboarding,
    feedback,
    markets,
    userBase,
  };
  doc.computeMs = Date.now() - startedAt;

  await db.doc(AGG_PATH.join('/')).set(doc);
  console.log(
    `release-monitor: OK — daily[${daily.length}], v6 n=${doc.v6.all.n} (ios ${doc.v6.ios.n}/android ${doc.v6.android.n}), old n=${doc.old.n}, ${doc.computeMs} ms`,
  );
  return doc;
}

// ─── Trigger 1: scheduled (alle 6 h) ─────────────────────────────
exports.aggregateReleaseMonitor = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .pubsub.schedule('every 6 hours')
  .timeZone('Europe/Berlin')
  .onRun(async () => {
    await aggregate();
    return null;
  });

// ─── Trigger 2: HTTP (Seite/„Neu berechnen" + manuell) ───────────
exports.aggregateReleaseMonitorHttp = functions
  .region('europe-west1')
  .runWith({ timeoutSeconds: 300, memory: '512MB' })
  .https.onRequest(async (req, res) => {
    // CORS für den Button auf der Hosting-Seite.
    res.set('Access-Control-Allow-Origin', '*');
    if (req.method === 'OPTIONS') {
      res.set('Access-Control-Allow-Methods', 'GET, POST');
      res.status(204).send('');
      return;
    }
    try {
      // Spam-Schutz statt Key: nicht öfter als alle 10 Minuten rechnen.
      const cur = await db.doc(AGG_PATH.join('/')).get();
      const last = cur.exists && cur.data().updatedAt && cur.data().updatedAt.toMillis
        ? cur.data().updatedAt.toMillis()
        : 0;
      if (Date.now() - last < MIN_RECOMPUTE_GAP_MS) {
        res.status(200).json({ ok: true, skipped: 'fresh', ageMs: Date.now() - last });
        return;
      }
      const doc = await aggregate();
      res.status(200).json({ ok: true, v6n: doc.v6.all.n, oldn: doc.old.n, computeMs: doc.computeMs });
    } catch (e) {
      console.error('release-monitor http failed', e);
      res.status(500).json({ ok: false, error: String((e && e.message) || e) });
    }
  });
