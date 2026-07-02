/**
 * joinSharedList — Callable Cloud Function (Stufe 5, geteilte Einkaufszettel).
 *
 * Warum eine CF: In den Firestore-Rules darf `shared_lists/{id}.memberIds`
 * client-seitig NIE ERWEITERT werden (sonst lädt sich jeder in fremde Listen —
 * die Lektion aus Stufe 0). Der Beitritt läuft deshalb ausschließlich hier über
 * das Admin-SDK, das die Rules umgeht.
 *
 * Ablauf: Auth prüfen → Konto-Pflicht (kein anonymer Beitritt) → Liste per
 * inviteCode finden → in einer Transaktion Ablauf/Kapazität/Doppelbeitritt
 * prüfen → uid zu memberIds hinzufügen.
 *
 * Region: europe-west3 (v2, wie die übrigen neueren Functions der App).
 * Deploy: `firebase deploy --only functions:shared-lists` (Node 22).
 */

const admin = require('firebase-admin');
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { logger } = require('firebase-functions');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west3';
const MAX_MEMBERS = 6;

exports.joinSharedList = onCall({ region: REGION }, async (request) => {
  const auth = request.auth;
  if (!auth) {
    throw new HttpsError('unauthenticated', 'Bitte zuerst anmelden.');
  }
  const uid = auth.uid;

  // Konto-Pflicht: anonyme User dürfen nicht beitreten — Missbrauchsschutz UND
  // natürlicher Registrierungs-Treiber (konsistent mit der Cashback-Logik).
  const provider =
    auth.token && auth.token.firebase && auth.token.firebase.sign_in_provider;
  if (provider === 'anonymous') {
    throw new HttpsError(
      'permission-denied',
      'Zum Beitreten brauchst du ein kostenloses Konto.',
    );
  }

  const code = String((request.data && request.data.inviteCode) || '').trim();
  if (!code) {
    throw new HttpsError('invalid-argument', 'Kein Einladungs-Code angegeben.');
  }

  // Liste per inviteCode finden (Single-Field-Index auf inviteCode reicht).
  const snap = await db
    .collection('shared_lists')
    .where('inviteCode', '==', code)
    .limit(1)
    .get();
  if (snap.empty) {
    throw new HttpsError('not-found', 'Diese Einladung gibt es nicht (mehr).');
  }
  const listRef = snap.docs[0].ref;

  return db.runTransaction(async (tx) => {
    const doc = await tx.get(listRef);
    if (!doc.exists) {
      throw new HttpsError('not-found', 'Diese Einladung gibt es nicht (mehr).');
    }
    const d = doc.data() || {};

    // Ablauf: der Client setzt beim Erstellen/Rotieren ein 48h-Fenster.
    const expMs =
      d.inviteExpiresAt && typeof d.inviteExpiresAt.toMillis === 'function'
        ? d.inviteExpiresAt.toMillis()
        : 0;
    if (expMs && expMs < Date.now()) {
      throw new HttpsError(
        'deadline-exceeded',
        'Diese Einladung ist abgelaufen — bitte den Ersteller um einen frischen Link.',
      );
    }

    const members = Array.isArray(d.memberIds) ? d.memberIds : [];
    if (members.indexOf(uid) !== -1) {
      // Idempotent: schon Mitglied → einfach die listId zurückgeben.
      return { listId: doc.id, name: d.name || '', alreadyMember: true };
    }
    if (members.length >= MAX_MEMBERS) {
      throw new HttpsError(
        'resource-exhausted',
        `Diese Liste ist schon voll (max. ${MAX_MEMBERS} Mitglieder).`,
      );
    }

    // Anzeigename des Beitretenden (untrusted → coercen + kürzen). Wird in
    // memberNames gespiegelt, weil Clients fremde users/*-Profile per Rules
    // NICHT lesen dürfen — die Mitglieder-UI braucht den Namen aber.
    const displayName = String((request.data && request.data.displayName) || '')
      .trim()
      .slice(0, 40);
    const memberNames = d.memberNames && typeof d.memberNames === 'object' ? d.memberNames : {};
    memberNames[uid] = displayName || 'Mitglied';

    tx.update(listRef, {
      memberIds: members.concat([uid]),
      memberNames,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    logger.info('joinSharedList', { listId: doc.id, uid, newSize: members.length + 1 });
    return { listId: doc.id, name: d.name || '', joined: true };
  });
});
