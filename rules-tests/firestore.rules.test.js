/**
 * Firestore-Rules-Tests — Stufe-0-Härtung (ClickUp 86cahgwmn).
 *
 * Beweist beide Richtungen:
 *   ANGRIFFE scheitern  — Guthaben-Fälschung, Umfrage-Mint, Rang-Forgery,
 *                         Katalog-Defacement, Cross-User-Reads, Backdoor.
 *   APP-FLOWS gehen     — jede im Census 2026-07-02 nachgewiesene
 *                         Client-Operation (Profil, Zettel, Favoriten,
 *                         Punkte-Ledger, Bon-Mirror, Ratings, Umfragen …).
 *
 * Ausführen (Emulator, demo-Projekt = nie Produktion):
 *   npx firebase-tools@15.15.0 emulators:exec --only firestore \
 *     --project demo-rules-test "npx jest -c rules-tests/jest.config.js"
 */

const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require('@firebase/rules-unit-testing');
const {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  query,
  where,
  serverTimestamp,
  arrayRemove,
} = require('firebase/firestore');
const fs = require('fs');
const path = require('path');

const ALICE = 'alice-uid';
const MALLORY = 'mallory-uid';
const BOB = 'bob-uid';

let env;

beforeAll(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-rules-test',
    firestore: {
      rules: fs.readFileSync(path.join(__dirname, '..', 'firestore.rules'), 'utf8'),
    },
  });

  // Seed-Daten (Rules umgangen — wie Admin-SDK/Cloud Functions).
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'produkte/p1'), { name: 'Testprodukt', preis: 1.99 });
    await setDoc(doc(db, 'scraped_products/s1'), { name: 'Scrape' });
    await setDoc(doc(db, 'polls/poll1'), { status: 'active', rewardCents: 10 });
    await setDoc(doc(db, 'poll_responses/resp-mallory'), { userId: MALLORY, pollId: 'poll1' });
    await setDoc(doc(db, 'receipts/r1'), { userId: ALICE, status: 'approved' });
    await setDoc(doc(db, 'cashback_payouts/pay1'), { userId: ALICE, amountCents: 100 });
    await setDoc(doc(db, `cashback_sperren/${MALLORY}`), { gesperrt: true, grund: 'test', quelle: 'test' });
    await setDoc(doc(db, '_meta/produktsuche'), { aktiv: true, tagesDeckel: 120 });
    await setDoc(doc(db, '_meta/produktsuche_tage/tage/2026-10-04'), { bearbeitet: 5 });
    await setDoc(doc(db, '_meta/openFoodRateLimit'), { rateLimitUntilMs: 0 });
    await setDoc(doc(db, 'gamification/actions'), { search_product: { points: 1 } });
    await setDoc(doc(db, 'aggregates/leaderboard_v1'), { top: [] });
    await setDoc(doc(db, 'leaderboards/' + ALICE), { displayName: 'Alice', stats: {} });
    await setDoc(doc(db, 'productRatings/r-alice'), { userID: ALICE, rating: 5 });
    await setDoc(doc(db, `users/${ALICE}/cashback_ledger/e1`), { type: 'earn', cents: 50 });
    await setDoc(doc(db, `users/${ALICE}/purchased_products/pp1`), { itemName: 'Milch' });
    await setDoc(doc(db, `users/${ALICE}/ledger/seeded`), {
      action: 'search_product', points: 1, timestamp: new Date(),
    });
    await setDoc(doc(db, `users/${ALICE}/journeys/j1`), { app: 'x' });
    await setDoc(doc(db, `users/${ALICE}/searchHistory/sh1`), { term: 'bier' });
    await setDoc(doc(db, `users/${ALICE}/einkaufswagen/cart1`), { name: 'Butter' });
    await setDoc(doc(db, `users/${ALICE}/someFutureSub/x1`), { any: 1 });

    // Stufe 5 — geteilte Listen. Getrennte Doc-IDs für mutierende Tests,
    // damit sie sich nicht gegenseitig beeinflussen. Owner = ALICE, Mitglied = BOB.
    await setDoc(doc(db, 'shared_lists/list1'), {
      ownerId: ALICE, memberIds: [ALICE, BOB], name: 'Familie', inviteCode: 'code1',
    });
    await setDoc(doc(db, 'shared_lists/list1/items/i1'), { name: 'Milch', addedBy: ALICE });
    await setDoc(doc(db, 'shared_lists/list_leave'), {
      ownerId: ALICE, memberIds: [ALICE, BOB], name: 'L',
    });
    await setDoc(doc(db, 'shared_lists/list_remove'), {
      ownerId: ALICE, memberIds: [ALICE, BOB], name: 'L',
    });
    await setDoc(doc(db, 'shared_lists/list_rename'), {
      ownerId: ALICE, memberIds: [ALICE, BOB], name: 'L',
    });
    await setDoc(doc(db, 'shared_lists/list_del'), {
      ownerId: ALICE, memberIds: [ALICE], name: 'L',
    });
    await setDoc(doc(db, 'shared_lists/list_expand'), {
      ownerId: ALICE, memberIds: [ALICE], name: 'L',
    });
    // arrayRemove (26.09.2026): MALLORY ist hier „inzwischen beigetreten".
    await setDoc(doc(db, 'shared_lists/list_leave_ar'), {
      ownerId: ALICE, memberIds: [ALICE, BOB, MALLORY], name: 'L',
    });
    await setDoc(doc(db, 'shared_lists/list_remove_ar'), {
      ownerId: ALICE, memberIds: [ALICE, BOB, MALLORY], name: 'L',
    });
    await setDoc(doc(db, 'shared_lists/list_remove_ar_bad'), {
      ownerId: ALICE, memberIds: [ALICE, BOB, MALLORY], name: 'L',
    });
  });
});

afterAll(async () => {
  await env.cleanup();
});

const alice = () => env.authenticatedContext(ALICE).firestore();
const mallory = () => env.authenticatedContext(MALLORY).firestore();
const unauth = () => env.unauthenticatedContext().firestore();

// ─── 1. GELD-PFAD (die kritischen Löcher) ────────────────────────────

describe('Geld-Pfad: Guthaben & Ledger sind server-only', () => {
  test('User kann sein Profil anlegen/ändern (ohne Geld-Felder)', async () => {
    await assertSucceeds(setDoc(doc(alice(), `users/${ALICE}`), {
      name: 'Alice', stats: { pointsTotal: 0 },
    }));
    await assertSucceeds(updateDoc(doc(alice(), `users/${ALICE}`), {
      name: 'Alice 2', 'stats.pointsTotal': 5, cashback_consent: { accepted: true },
      pushToken: { token: 't' }, pushNotificationsEnabled: true,
    }));
  });

  test('ANGRIFF: eigenes Guthaben setzen scheitert (update)', async () => {
    await assertFails(updateDoc(doc(alice(), `users/${ALICE}`), {
      cashback_balance_cents: 999999,
    }));
    await assertFails(setDoc(doc(alice(), `users/${ALICE}`), {
      cashback_lifetime_cents: 999999,
    }, { merge: true }));
  });

  test('ANGRIFF: Guthaben beim create mitgeben scheitert', async () => {
    await assertFails(setDoc(doc(mallory(), `users/${MALLORY}`), {
      name: 'M', cashback_balance_cents: 999999,
    }));
  });

  test('ANGRIFF: Monats-/Kampagnen-Counter setzen scheitert', async () => {
    await assertFails(updateDoc(doc(alice(), `users/${ALICE}`), {
      cashback_monthly: { '2026-07': 0 },
    }));
    await assertFails(updateDoc(doc(alice(), `users/${ALICE}`), {
      cashback_last_bon_date: '2020-01-01',
    }));
  });

  test('ANGRIFF: cashback_ledger client-write scheitert; eigenes Lesen ok', async () => {
    await assertFails(setDoc(doc(alice(), `users/${ALICE}/cashback_ledger/hack`), {
      type: 'earn', cents: 100000,
    }));
    await assertFails(updateDoc(doc(alice(), `users/${ALICE}/cashback_ledger/e1`), { cents: 1 }));
    await assertSucceeds(getDoc(doc(alice(), `users/${ALICE}/cashback_ledger/e1`)));
    await assertFails(getDoc(doc(mallory(), `users/${ALICE}/cashback_ledger/e1`)));
  });

  test('receipts/payouts: eigene lesbar, fremde nicht, Writes nie', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'receipts/r1')));
    await assertFails(getDoc(doc(mallory(), 'receipts/r1')));
    await assertFails(setDoc(doc(alice(), 'receipts/neu'), { userId: ALICE }));
    await assertSucceeds(getDocs(query(
      collection(alice(), 'cashback_payouts'), where('userId', '==', ALICE))));
    await assertFails(getDoc(doc(mallory(), 'cashback_payouts/pay1')));
  });
});

// Kontosperre (Entscheidung Patrick 02.10.2026): cashback_sperren/{uid} ist
// server-only — kein Block in firestore.rules, das finale deny-all greift.
// Der Betroffene darf die eigene Sperre weder sehen (sonst weicht er auf ein
// neues Konto aus) noch löschen; niemand darf sich selbst oder andere sperren.
describe('Kontosperre: cashback_sperren ist server-only', () => {
  test('ANGRIFF: eigene Sperre lesen, löschen oder aufheben scheitert', async () => {
    await assertFails(getDoc(doc(mallory(), `cashback_sperren/${MALLORY}`)));
    await assertFails(deleteDoc(doc(mallory(), `cashback_sperren/${MALLORY}`)));
    await assertFails(setDoc(doc(mallory(), `cashback_sperren/${MALLORY}`), { gesperrt: false }));
    await assertFails(updateDoc(doc(mallory(), `cashback_sperren/${MALLORY}`), { gesperrt: false }));
  });
  test('ANGRIFF: fremde Sperren lesen/anlegen und die Sammlung abfragen scheitert', async () => {
    await assertFails(getDoc(doc(alice(), `cashback_sperren/${MALLORY}`)));
    await assertFails(setDoc(doc(mallory(), `cashback_sperren/${ALICE}`), { gesperrt: true }));
    await assertFails(getDocs(collection(alice(), 'cashback_sperren')));
    await assertFails(getDoc(doc(unauth(), `cashback_sperren/${MALLORY}`)));
  });
});

// Produktsuche (04.10.2026): _meta/produktsuche steuert, wie viele bezahlte
// Suchen (Serper, KI, Apify) am Tag laufen; _meta/produktsuche_tage/tage/*
// zählt sie. Server-only — kein Block in firestore.rules, das finale deny-all
// greift. Wer den Schalter schreiben könnte, könnte Geld ausgeben lassen.
describe('Produktsuche: _meta ist server-only', () => {
  test('ANGRIFF: Schalter hochdrehen oder lesen scheitert, auch angemeldet', async () => {
    await assertFails(setDoc(doc(mallory(), '_meta/produktsuche'), { aktiv: true, tagesDeckel: 5000, proLauf: 20 }));
    await assertFails(updateDoc(doc(mallory(), '_meta/produktsuche'), { serperMindestGuthaben: 0 }));
    await assertFails(getDoc(doc(alice(), '_meta/produktsuche')));
    await assertFails(getDoc(doc(unauth(), '_meta/produktsuche')));
  });
  test('ANGRIFF: Tageszähler lesen/fälschen scheitert', async () => {
    await assertFails(setDoc(doc(mallory(), '_meta/produktsuche_tage/tage/2026-10-04'), { bearbeitet: 0 }));
    await assertFails(getDocs(collection(alice(), '_meta/produktsuche_tage/tage')));
    await assertFails(getDoc(doc(alice(), '_meta/openFoodRateLimit')));
  });
});

// ─── 2. UMFRAGEN (zweiter Geld-Mint-Pfad) ────────────────────────────

describe('Umfragen: polls read-only, Antworten nur als man selbst', () => {
  test('polls lesbar (auch pre-auth), aber nie schreibbar', async () => {
    await assertSucceeds(getDoc(doc(unauth(), 'polls/poll1')));
    await assertFails(setDoc(doc(unauth(), 'polls/evil'), { rewardCents: 100000 }));
    await assertFails(setDoc(doc(alice(), 'polls/evil'), { rewardCents: 100000 }));
    await assertFails(updateDoc(doc(alice(), 'polls/poll1'), { rewardCents: 100000 }));
  });

  test('poll_responses: eigene anlegen ok, fremde userId scheitert', async () => {
    await assertSucceeds(addDoc(collection(alice(), 'poll_responses'), {
      userId: ALICE, pollId: 'poll1', answers: [],
    }));
    await assertFails(addDoc(collection(alice(), 'poll_responses'), {
      userId: MALLORY, pollId: 'poll1',
    }));
    await assertFails(addDoc(collection(unauth(), 'poll_responses'), {
      userId: 'x', pollId: 'poll1',
    }));
  });

  test('poll_responses: nur eigene lesbar (answered-Check-Query)', async () => {
    await assertSucceeds(getDocs(query(
      collection(alice(), 'poll_responses'), where('userId', '==', ALICE))));
    await assertFails(getDoc(doc(alice(), 'poll_responses/resp-mallory')));
  });
});

// ─── 3. BESTENLISTE ──────────────────────────────────────────────────

describe('Bestenliste: nur eigenes Doc schreiben, Lesen nur eingeloggt', () => {
  test('eigenes Doc schreiben ok (leaderboardService.updateUserStats)', async () => {
    await assertSucceeds(setDoc(doc(alice(), `leaderboards/${ALICE}`), {
      displayName: 'Alice', stats: { points: { weekly: 10 } },
    }, { merge: true }));
  });
  test('ANGRIFF: fremdes Doc schreiben scheitert', async () => {
    await assertFails(setDoc(doc(mallory(), `leaderboards/${ALICE}`), {
      stats: { points: { weekly: 99999 } },
    }, { merge: true }));
  });
  test('Lesen: eingeloggt ok (Woche/Monat-Query), ohne Login nicht', async () => {
    await assertSucceeds(getDoc(doc(mallory(), `leaderboards/${ALICE}`)));
    await assertFails(getDoc(doc(unauth(), `leaderboards/${ALICE}`)));
  });
});

// ─── 4. KATALOG ──────────────────────────────────────────────────────

describe('Katalog: öffentlich lesbar, nie client-schreibbar', () => {
  test('übriger Katalog lesbar ohne Auth (Boot-Race-sicher)', async () => {
    await assertSucceeds(getDoc(doc(unauth(), 'scraped_products/s1')));
    await assertSucceeds(getDoc(doc(unauth(), 'aggregates/leaderboard_v1')));
  });
  // Live seit 01.09.2026 (Schutz gegen das Abgreifen der Datenbank), am 26.09.
  // ins Repo übernommen: diese vier nur mit Anmeldung, anonym genügt.
  test('produkte, markenProdukte, hersteller, hersteller_new: nur angemeldet lesbar', async () => {
    for (const pfad of ['produkte/p1', 'markenProdukte/m1', 'hersteller/h1', 'hersteller_new/h1']) {
      await assertSucceeds(getDoc(doc(alice(), pfad)));
      await assertFails(getDoc(doc(unauth(), pfad)));
    }
  });
  test('ANGRIFF: Katalog-Defacement scheitert (vorher update: if true!)', async () => {
    await assertFails(updateDoc(doc(unauth(), 'produkte/p1'), { preis: 0 }));
    await assertFails(updateDoc(doc(alice(), 'produkte/p1'), { name: 'HACKED' }));
    await assertFails(setDoc(doc(alice(), 'markenProdukte/neu'), { name: 'x' }));
    await assertFails(setDoc(doc(unauth(), 'hersteller_new/evil'), { name: 'x' }));
  });
  test('gamification: nur eingeloggt lesbar, nie schreibbar', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'gamification/actions')));
    await assertFails(getDoc(doc(unauth(), 'gamification/actions')));
    await assertFails(updateDoc(doc(alice(), 'gamification/actions'), { x: 1 }));
  });
});

// ─── 5. USER-DATEN: Owner-only ───────────────────────────────────────

describe('User-Subcollections: Owner ja, Fremde/Unauth nie', () => {
  test('Einkaufszettel: Owner-CRUD ok', async () => {
    const ref = doc(alice(), `users/${ALICE}/einkaufswagen/neu`);
    await assertSucceeds(setDoc(ref, { name: 'Milch', anzahl: 1 }));
    await assertSucceeds(updateDoc(ref, { anzahl: 2 }));
    await assertSucceeds(deleteDoc(ref));
  });
  test('ANGRIFF: fremder Einkaufszettel (vorher KOMPLETT offen!)', async () => {
    await assertFails(getDoc(doc(unauth(), `users/${ALICE}/einkaufswagen/cart1`)));
    await assertFails(getDoc(doc(mallory(), `users/${ALICE}/einkaufswagen/cart1`)));
    await assertFails(deleteDoc(doc(mallory(), `users/${ALICE}/einkaufswagen/cart1`)));
  });
  test('ANGRIFF: fremde Favoriten/Verläufe/Journeys lesen scheitert', async () => {
    await assertFails(setDoc(doc(mallory(), `users/${ALICE}/favorites/f1`), { x: 1 }));
    await assertFails(getDoc(doc(mallory(), `users/${ALICE}/searchHistory/sh1`)));
    await assertFails(getDoc(doc(mallory(), `users/${ALICE}/journeys/j1`)));
    await assertFails(getDoc(doc(mallory(), `users/${ALICE}`)));
  });
  test('Journeys: Owner create/update ok, delete server-only', async () => {
    await assertSucceeds(setDoc(doc(alice(), `users/${ALICE}/journeys/j2`), { app: 'y' }));
    await assertSucceeds(updateDoc(doc(alice(), `users/${ALICE}/journeys/j2`), { app: 'z' }));
    await assertFails(deleteDoc(doc(alice(), `users/${ALICE}/journeys/j1`)));
  });
  test('Bon-Mirror (cashback_status): Owner create/update ok, delete nie', async () => {
    const ref = doc(alice(), `users/${ALICE}/cashback_status/local1`);
    await assertSucceeds(setDoc(ref, { status: 'uploading' }));
    await assertSucceeds(setDoc(ref, { status: 'ocr_pending' }, { merge: true }));
    await assertFails(deleteDoc(ref));
    await assertFails(setDoc(doc(mallory(), `users/${ALICE}/cashback_status/x`), { status: 'u' }));
  });
  test('purchased_products: Owner liest, niemand schreibt client-seitig', async () => {
    await assertSucceeds(getDoc(doc(alice(), `users/${ALICE}/purchased_products/pp1`)));
    await assertFails(setDoc(doc(alice(), `users/${ALICE}/purchased_products/hack`), { x: 1 }));
  });
  test('Catch-all: künftige Subcollection = Owner-read, kein Client-Write', async () => {
    await assertSucceeds(getDoc(doc(alice(), `users/${ALICE}/someFutureSub/x1`)));
    await assertFails(getDoc(doc(mallory(), `users/${ALICE}/someFutureSub/x1`)));
    await assertFails(setDoc(doc(alice(), `users/${ALICE}/someFutureSub/x2`), { a: 1 }));
  });
  test('push_events (86cb22c0m): Owner create-only mit Shape, ID = pushId', async () => {
    // Legitimer Open-Event (exakt die Client-Shape aus fcmDeepLinks.ts)
    await assertSucceeds(setDoc(doc(alice(), `users/${ALICE}/push_events/p_abc123`), {
      pushId: 'p_abc123', kind: 'cashback_ready', deepLink: 'markendetektivern://x',
      openedAt: serverTimestamp(),
    }));
    // ANGRIFF/Drift: falsche Shape, ID ≠ pushId, fremder User, mutieren
    await assertFails(setDoc(doc(alice(), `users/${ALICE}/push_events/p_noshape`), { foo: 1 }));
    await assertFails(setDoc(doc(alice(), `users/${ALICE}/push_events/p_other`), {
      pushId: 'p_MISMATCH', openedAt: serverTimestamp(),
    }));
    await assertFails(setDoc(doc(mallory(), `users/${ALICE}/push_events/p_evil`), {
      pushId: 'p_evil', openedAt: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(alice(), `users/${ALICE}/push_events/p_abc123`), { kind: 'x' }));
    await assertFails(deleteDoc(doc(alice(), `users/${ALICE}/push_events/p_abc123`)));
  });
});

// ─── 6. PUNKTE-LEDGER (append-only + Shape) ──────────────────────────

describe('Punkte-Ledger: Owner append-only mit Shape-Validierung', () => {
  test('legitimer Eintrag (alle 3 Callsite-Shapes) ok', async () => {
    await assertSucceeds(addDoc(collection(alice(), `users/${ALICE}/ledger`), {
      action: 'daily_streak', points: 3, timestamp: serverTimestamp(),
      metadata: { streakDay: 4 },
    }));
    await assertSucceeds(addDoc(collection(alice(), `users/${ALICE}/ledger`), {
      action: 'first_action_any', points: 10, timestamp: serverTimestamp(),
    }));
  });
  test('ANGRIFF: absurde Punkte / kaputte Shape / fremd / mutieren', async () => {
    const col = collection(alice(), `users/${ALICE}/ledger`);
    await assertFails(addDoc(col, { action: 'x', points: 99999, timestamp: serverTimestamp() }));
    await assertFails(addDoc(col, { action: 'x', points: -5, timestamp: serverTimestamp() }));
    await assertFails(addDoc(col, { points: 5, timestamp: serverTimestamp() }));
    await assertFails(addDoc(collection(mallory(), `users/${ALICE}/ledger`), {
      action: 'x', points: 5, timestamp: serverTimestamp(),
    }));
    await assertFails(updateDoc(doc(alice(), `users/${ALICE}/ledger/seeded`), { points: 999 }));
    await assertFails(deleteDoc(doc(alice(), `users/${ALICE}/ledger/seeded`)));
  });
});

// ─── 7. RATINGS / FEEDBACK / TELEMETRIE / TOKENS ─────────────────────

describe('Ratings, Feedback, Telemetrie, Push-Tokens', () => {
  test('productRatings: eigene anlegen/ändern ok, fremde nie', async () => {
    await assertSucceeds(addDoc(collection(alice(), 'productRatings'), {
      userID: ALICE, rating: 4,
    }));
    await assertFails(addDoc(collection(alice(), 'productRatings'), {
      userID: MALLORY, rating: 1,
    }));
    await assertSucceeds(updateDoc(doc(alice(), 'productRatings/r-alice'), { rating: 3 }));
    await assertFails(updateDoc(doc(mallory(), 'productRatings/r-alice'), { rating: 1 }));
  });
  test('userfeedback: eigenes ok, fremde userId scheitert', async () => {
    await assertSucceeds(setDoc(doc(alice(), `userfeedback/${ALICE}_1`), {
      userId: ALICE, feedback: 'top',
    }));
    await assertFails(setDoc(doc(alice(), 'userfeedback/spoof'), {
      userId: MALLORY, feedback: 'x',
    }));
  });
  test('onboardingResultsV5: eingeloggt schreiben ok, lesen nie', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'onboardingResultsV5/sess1'), { step: 1 }));
    await assertFails(setDoc(doc(unauth(), 'onboardingResultsV5/sess2'), { step: 1 }));
    await assertFails(getDoc(doc(alice(), 'onboardingResultsV5/sess1')));
  });
  test('pushTokens: eigener Token ok, Spoof/Read nie', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'pushTokens/tok1'), {
      token: 'tok1', userId: ALICE, platform: 'ios',
    }));
    await assertFails(setDoc(doc(alice(), 'pushTokens/tok2'), {
      token: 'tok2', userId: MALLORY,
    }));
    await assertFails(getDoc(doc(alice(), 'pushTokens/tok1')));
  });
  test('crowd_uploads: eigenes create+read ok, update nie', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'crowd_uploads/cu1'), { userId: ALICE }));
    await assertFails(updateDoc(doc(alice(), 'crowd_uploads/cu1'), { status: 'approved' }));
  });
  test('crowd_uploads: der deterministische Slot-Schlüssel lässt nur den ERSTEN durch', async () => {
    // Trägt die Idempotenz von `submitProduct` (lib/services/productSubmit.ts,
    // productSubmissionDocId): ein Produkt-Slot einer Wizard-Sitzung ist EIN
    // Dokument. Der zweite Schreibvorgang auf denselben Pfad ist ein `update`
    // und muss scheitern — sonst hängt „der erste gewinnt" allein an der
    // Disziplin des Clients, und genau die hat am 10.09.2026 gefehlt
    // (3 Nutzer, 7 byteidentische Einreichungen, jede davon abgelehnt).
    const slot = `crowd_uploads/${ALICE}_94ea55c3fd9caddfbce6bd1c_3`;
    await assertSucceeds(setDoc(doc(alice(), slot), { userId: ALICE }));
    await assertFails(setDoc(doc(alice(), slot), { userId: ALICE }));
    // Ein anderer Slot derselben Sitzung bleibt frei — echte zweite Produkte
    // dürfen nicht mitgesperrt werden.
    await assertSucceeds(setDoc(doc(alice(), `crowd_uploads/${ALICE}_94ea55c3fd9caddfbce6bd1c_4`), { userId: ALICE }));
    // Fremdes Konto kann den Slot weder besetzen noch lesen.
    await assertFails(setDoc(doc(mallory(), slot), { userId: MALLORY }));
    await assertFails(getDoc(doc(mallory(), slot)));
  });

  // Genau die Nutzlast von `submitProduct` (lib/services/productSubmit.ts)
  // inklusive `collectContext` — mit ALLEN optionalen Teilen, damit eine
  // Sperrliste, die versehentlich ein App-Feld trifft, hier auffällt.
  const appAnlage = () => ({
    userId: ALICE,
    sessionId: '94ea55c3fd9caddfbce6bd1c',
    productIndex: 1,
    marketId: 'm1',
    marketName: 'Aldi Süd',
    marketLand: 'DE',
    productName: null,
    ean: '4061458000000',
    campaignId: 'produkt-fotos-oktober-2026',
    campaignResolve: 'live',
    images: { front: 'crowduploads/a/front_x.jpg', ean: 'crowduploads/a/ean_x.jpg' },
    stepCount: 2,
    status: 'pending',
    clientVersion: { app: '6.0.20', build: '1247', platform: 'android' },
    favoriteMarket: { id: 'm1', name: 'Aldi Süd' },
    userLocation: { address: null, city: 'Köln', bundesland: 'NRW' },
    journeyLocation: { lat: 50.95, lon: 6.95, city: 'Köln', geohash5: '50.95_6.95', source: 'ip' },
    journeyId: 'j1',
    capture: {
      capturedAt: new Date(),
      gpsStatus: 'ok',
      gps: { lat: 50.9412, lon: 6.9583, accuracyM: 12, fixAt: new Date() },
      confirmedPlace: { city: 'Köln' },
    },
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  });

  test('crowd_uploads: die echte App-Anlage geht durch (alle optionalen Felder)', async () => {
    await assertSucceeds(setDoc(doc(alice(), 'crowd_uploads/app_voll'), appAnlage()));
    // Altbestand/Tests ohne status bleiben erlaubt — ohne status greift
    // weder Runde noch Vergütung.
    await assertSucceeds(setDoc(doc(alice(), 'crowd_uploads/app_ohne_status'), { userId: ALICE }));
  });

  test('ANGRIFF: Server-Felder beim Anlegen mitschicken scheitert', async () => {
    const faelle = {
      priceRescueOcr: { priceCents: 229, currency: 'EUR', priceImageKind: 'preisschild' },
      eanRescueOcr: '4061458000001',
      productNameRescueOcr: 'Erfundener Name',
      manufacturerRescueOcr: { name: 'DMK' },
      rescueQuelle: 'erfunden',
      productNameOcr: 'Erfundener Name',
      productNameOcrAt: new Date(),
      priceOcr: { priceCents: 229, source: 'preisschild' },
      manufacturerOcr: { name: 'DMK', source: 'hersteller' },
      priceReceipt: { zip: '50667', complete: true },
      productNameOcrBildDefekt: [],
      namerNachlesenAb: new Date(),
      namerLauf: { eventId: 'x' },
      review: { precheck: { verdict: 'ok' } },
      reviewedBy: 'admin',
      rewardResult: 'credited',
      rewardCents: 500,
      rewardPushSentAt: new Date(),
      probableLocation: { source: 'gps' },
      exifGps: { lat: 1, lon: 2 },
      // 02.10.2026: wer „Foto-Nummer stimmt" vorgibt, umginge die Prüfung der Konsole.
      eanFotoOcr: { ean: '4061458000001', befund: 'gleich' },
    };
    for (const [feld, wert] of Object.entries(faelle)) {
      await assertFails(setDoc(doc(alice(), `crowd_uploads/angriff_${feld}`), { ...appAnlage(), [feld]: wert }));
    }
  });

  // Die VOLLSTÄNDIGE Sperrliste, unabhängig von der Regel abgeschrieben (gleiche
  // Reihenfolge wie crowdUploadServerFelder()). Fällt dort ein Name heraus,
  // scheitert dieser Test — die Regel prüft nur Schlüssel, der Wert ist egal.
  // Darunter die Felder, die den Nachlauf des Namers steuern
  // (namerNachlesenVersuch, productNameOcrFehlerErst).
  const SERVER_FELDER = [
    'productNameOcr', 'productNameOcrAt', 'productNameOcrFehler',
    'productNameOcrConfidence', 'priceOcr', 'manufacturerOcr',
    'priceImageKind', 'priceReceipt',
    'productNameOcrBildDefekt', 'productNameOcrFehlerErst',
    'productNameOcrNachgelesenAt', 'namerNachlesenAb',
    'namerNachlesenVersuch', 'namerLauf',
    'productNameRescueOcr', 'productNameRescueAlternative', 'eanRescueOcr',
    'priceRescueOcr', 'manufacturerRescueOcr', 'rescueAt', 'rescueQuelle',
    'productNameRescueAt', 'productNameRescueQuelle',
    'eanRescueAt', 'eanRescueQuelle',
    'eanFotoOcr',
    'review', 'reviewedBy', 'reviewedAt', 'reviewNote', 'holdReasons',
    'rejectReason', 'loseWare', 'frischwareOhneAngaben',
    'rewardResult', 'rewardCents', 'rewardNotCreditedReason',
    'rewardCheckedAt', 'rewardSkipped', 'rewardSkippedReason',
    'rewardRegion', 'rewardLocationRule', 'rewardPushSentAt',
    'probableLocation', 'probableLocationAt', 'exifGps',
    'journeyLocationMatch', 'userLocationBackfilled',
  ];

  test('ANGRIFF: JEDES Feld der Sperrliste beim Anlegen scheitert (48 Felder)', async () => {
    expect(SERVER_FELDER).toHaveLength(48);
    expect(new Set(SERVER_FELDER).size).toBe(SERVER_FELDER.length);
    for (const feld of SERVER_FELDER) {
      await assertFails(setDoc(doc(alice(), `crowd_uploads/liste_${feld}`), { ...appAnlage(), [feld]: 'x' }));
    }
  });

  test('ANGRIFF: Halte-Grund der Morgenrunde (review.rundeOffen) beim Anlegen vorbelegen scheitert — auch ohne andere review-Felder', async () => {
    // Prüfrunde 2 (02.10.2026): die Prüfkonsole hält Fälle mit sperrenden
    // Befunden in review.rundeOffen an; wer ihn leer vorbelegt, gäbe vor, es
    // gebe nichts zu beanstanden. Ändern kann der Client das Dokument nie.
    await assertFails(setDoc(doc(alice(), 'crowd_uploads/angriff_rundeOffen'), {
      ...appAnlage(), review: { rundeOffen: { grund: null, sperrend: [], lauf: '2099-01-01_000000' } },
    }));
    await assertSucceeds(setDoc(doc(alice(), 'crowd_uploads/ohne_rundeOffen'), appAnlage()));
    await assertFails(updateDoc(doc(alice(), 'crowd_uploads/ohne_rundeOffen'), { 'review.rundeOffen': { sperrend: [] } }));
  });

  test('Gegenprobe: die App-Anlage trägt keines der gesperrten Felder', () => {
    const app = Object.keys(appAnlage());
    expect(app.filter((k) => SERVER_FELDER.includes(k))).toEqual([]);
  });

  test('ANGRIFF: Anlage mit einem anderen status als pending scheitert', async () => {
    for (const status of ['approved', 'rejected', 'Pending', null]) {
      await assertFails(setDoc(doc(alice(), `crowd_uploads/status_${String(status)}`), { ...appAnlage(), status }));
    }
  });
  test('ratingFunnelEvents: eigenes schreiben ok, Spoof/Unauth/Read/Delete nie', async () => {
    const own = `ratingFunnelEvents/${ALICE}_6.0.12_requested`;
    const gut = {
      userId: ALICE, stage: 'requested', platform: 'ios', appVersion: '6.0.12',
    };
    await assertSucceeds(setDoc(doc(alice(), own), gut));
    // Idempotenter Re-Write derselben Doc-ID (Duplikat überschreibt sich).
    await assertSucceeds(setDoc(doc(alice(), own), gut));
    // Fremde userId im eigenen Doc: der klassische Zähler-Fälschungsversuch.
    await assertFails(setDoc(doc(alice(), `ratingFunnelEvents/${ALICE}_spoof`), {
      userId: MALLORY, stage: 'requested',
    }));
    // Fremdes Doc überschreiben.
    await assertFails(setDoc(doc(mallory(), own), {
      userId: MALLORY, stage: 'blocked',
    }));
    await assertFails(setDoc(doc(unauth(), `ratingFunnelEvents/${ALICE}_anon`), gut));
    // Write-only: der Client darf den Trichter nie auslesen oder aufräumen.
    await assertFails(getDoc(doc(alice(), own)));
    await assertFails(deleteDoc(doc(alice(), own)));
  });
  test('ratingFunnelEvents: Doc-ID muss die eigene uid tragen', async () => {
    // Ohne diese Bindung könnte jeder beliebig viele Dokumente unter
    // freien IDs anlegen — die Collection ist die einzige Quelle, auf der
    // künftige Prompt-Entscheidungen beruhen.
    await assertFails(setDoc(doc(alice(), 'ratingFunnelEvents/frei-gewaehlt'), {
      userId: ALICE, stage: 'requested',
    }));
    await assertFails(setDoc(doc(alice(), `ratingFunnelEvents/${MALLORY}_x`), {
      userId: ALICE, stage: 'requested',
    }));
  });
  test('ratingFunnelEvents: Fremdfelder und unbekannte Stufen scheitern', async () => {
    const id = `ratingFunnelEvents/${ALICE}_6.0.12_celebrated`;
    await assertFails(setDoc(doc(alice(), id), {
      userId: ALICE, stage: 'celebrated', payload: 'x'.repeat(1000),
    }));
    await assertFails(setDoc(doc(alice(), id), {
      userId: ALICE, stage: 'ausgedacht',
    }));
    await assertSucceeds(setDoc(doc(alice(), id), {
      userId: ALICE, stage: 'celebrated',
    }));
  });
  test('app_config: öffentlich lesbar (Kill-Switch beim Boot), nie client-schreibbar', async () => {
    await assertSucceeds(getDoc(doc(unauth(), 'app_config/rating')));
    await assertFails(setDoc(doc(alice(), 'app_config/rating'), { enabled: false }));
  });
});

// ─── 8. LEGACY-LÖCHER & BACKDOOR ─────────────────────────────────────

describe('Legacy-Collections + FlutterFlow-Backdoor sind dicht', () => {
  test('MDM-/Scraper-/Altlast-Collections: kein Zugriff mehr', async () => {
    await assertFails(setDoc(doc(alice(), 'master_manufacturers/x'), { a: 1 }));
    await assertFails(getDoc(doc(unauth(), 'mdm_analytics/x')));
    await assertFails(setDoc(doc(unauth(), 'aldiscrapedproducts/x'), { a: 1 }));
    await assertFails(setDoc(doc(alice(), 'custom-regions/x'), { a: 1 }));
    await assertFails(setDoc(doc(alice(), 'paywallCounter/x'), { a: 1 }));
    await assertFails(setDoc(doc(unauth(), 'fehler/x'), { a: 1 }));
  });
  test('ANGRIFF: FlutterFlow-E-Mail-Backdoor existiert nicht mehr', async () => {
    const ff = env.authenticatedContext('ff-uid', {
      email: 'firebase@flutterflow.io',
    }).firestore();
    await assertFails(setDoc(doc(ff, 'users/opfer'), { pwned: true }));
    await assertFails(getDoc(doc(ff, `users/${ALICE}`)));
    await assertFails(setDoc(doc(ff, 'irgendwas/x'), { a: 1 }));
  });
});

// ─── STUFE 5: Geteilte Einkaufszettel ────────────────────────────────
// Kern: memberIds ist client-seitig NICHT erweiterbar (Beitritt nur via CF);
// Items nur für Mitglieder; Verlassen/Entfernen sauber getrennt (Owner vs Member).
describe('Stufe 5: shared_lists — Mitgliederschutz + Item-Zugriff', () => {
  const bob = () => env.authenticatedContext(BOB).firestore();

  test('Mitglied liest die Liste', async () => {
    await assertSucceeds(getDoc(doc(alice(), 'shared_lists/list1')));
    await assertSucceeds(getDoc(doc(bob(), 'shared_lists/list1')));
  });
  test('Nicht-Mitglied kann die Liste NICHT lesen', async () => {
    await assertFails(getDoc(doc(mallory(), 'shared_lists/list1')));
    await assertFails(getDoc(doc(unauth(), 'shared_lists/list1')));
  });

  test('Owner legt Liste mit genau sich selbst an', async () => {
    await assertSucceeds(setDoc(doc(mallory(), 'shared_lists/new-m'), {
      ownerId: MALLORY, memberIds: [MALLORY], name: 'M',
    }));
  });
  test('Anlegen mit Fremden in memberIds scheitert', async () => {
    await assertFails(setDoc(doc(mallory(), 'shared_lists/new-bad'), {
      ownerId: MALLORY, memberIds: [MALLORY, ALICE], name: 'M',
    }));
  });
  test('Anlegen mit fremder ownerId scheitert', async () => {
    await assertFails(setDoc(doc(mallory(), 'shared_lists/new-bad2'), {
      ownerId: ALICE, memberIds: [MALLORY], name: 'M',
    }));
  });

  test('Mitglied liest + schreibt Items', async () => {
    await assertSucceeds(getDoc(doc(bob(), 'shared_lists/list1/items/i1')));
    await assertSucceeds(
      setDoc(doc(bob(), 'shared_lists/list1/items/i2'), { name: 'Brot', addedBy: BOB }),
    );
  });
  test('Nicht-Mitglied kann KEINE Items lesen/schreiben', async () => {
    await assertFails(getDoc(doc(mallory(), 'shared_lists/list1/items/i1')));
    await assertFails(
      setDoc(doc(mallory(), 'shared_lists/list1/items/hack'), { name: 'x', addedBy: MALLORY }),
    );
  });

  test('Fremder kann sich NICHT selbst zur Liste hinzufügen', async () => {
    await assertFails(
      updateDoc(doc(mallory(), 'shared_lists/list_expand'), { memberIds: [ALICE, MALLORY] }),
    );
  });
  test('Owner kann memberIds NICHT erweitern (nur die CF darf das)', async () => {
    await assertFails(
      updateDoc(doc(alice(), 'shared_lists/list_expand'), { memberIds: [ALICE, MALLORY] }),
    );
  });

  test('Mitglied darf sich selbst entfernen (Liste verlassen)', async () => {
    await assertSucceeds(
      updateDoc(doc(bob(), 'shared_lists/list_leave'), { memberIds: [ALICE] }),
    );
  });
  test('Nicht-Owner darf KEIN anderes Mitglied entfernen', async () => {
    await assertFails(
      updateDoc(doc(bob(), 'shared_lists/list_remove'), { memberIds: [BOB] }),
    );
  });
  test('Owner darf ein Mitglied entfernen', async () => {
    await assertSucceeds(
      updateDoc(doc(alice(), 'shared_lists/list_remove'), { memberIds: [ALICE] }),
    );
  });
  test('Nicht-Owner darf NICHT umbenennen', async () => {
    await assertFails(
      updateDoc(doc(bob(), 'shared_lists/list_rename'), { name: 'Bobs Liste' }),
    );
  });
  test('Owner darf umbenennen', async () => {
    await assertSucceeds(
      updateDoc(doc(alice(), 'shared_lists/list_rename'), { name: 'Neuer Name' }),
    );
  });

  // leaveList/removeMember schreiben seit 26.09.2026 arrayRemove statt eines
  // gelesenen, evtl. veralteten Arrays — sonst verschwanden Neu-Beigetretene.
  const mitglieder = async (id) => {
    let ids;
    await env.withSecurityRulesDisabled(async (ctx) => {
      ids = (await getDoc(doc(ctx.firestore(), `shared_lists/${id}`))).data().memberIds;
    });
    return ids;
  };
  test('Mitglied verlässt per arrayRemove — Neu-Beigetretene bleiben', async () => {
    await assertSucceeds(
      updateDoc(doc(bob(), 'shared_lists/list_leave_ar'), {
        memberIds: arrayRemove(BOB),
        updatedAt: serverTimestamp(),
      }),
    );
    expect(await mitglieder('list_leave_ar')).toEqual([ALICE, MALLORY]);
  });
  test('Owner entfernt per arrayRemove genau dieses Mitglied', async () => {
    await assertSucceeds(
      updateDoc(doc(alice(), 'shared_lists/list_remove_ar'), {
        memberIds: arrayRemove(BOB),
        updatedAt: serverTimestamp(),
      }),
    );
    expect(await mitglieder('list_remove_ar')).toEqual([ALICE, MALLORY]);
  });
  test('Nicht-Owner darf per arrayRemove KEIN anderes Mitglied entfernen', async () => {
    await assertFails(
      updateDoc(doc(bob(), 'shared_lists/list_remove_ar_bad'), {
        memberIds: arrayRemove(MALLORY),
        updatedAt: serverTimestamp(),
      }),
    );
  });

  test('Nur der Owner darf die Liste löschen', async () => {
    await assertFails(deleteDoc(doc(mallory(), 'shared_lists/list_del')));
    await assertSucceeds(deleteDoc(doc(alice(), 'shared_lists/list_del')));
  });
});
