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
  test('produkte lesbar ohne Auth (Boot-Race-sicher)', async () => {
    await assertSucceeds(getDoc(doc(unauth(), 'produkte/p1')));
    await assertSucceeds(getDoc(doc(unauth(), 'scraped_products/s1')));
    await assertSucceeds(getDoc(doc(unauth(), 'aggregates/leaderboard_v1')));
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

  test('Nur der Owner darf die Liste löschen', async () => {
    await assertFails(deleteDoc(doc(mallory(), 'shared_lists/list_del')));
    await assertSucceeds(deleteDoc(doc(alice(), 'shared_lists/list_del')));
  });
});
