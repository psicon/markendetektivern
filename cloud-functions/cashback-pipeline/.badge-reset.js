'use strict';

/**
 * Die rote Eins von den Geräten holen — ohne App-Update (ClickUp 86cbfdq5j).
 *
 * ═══ Warum das nötig ist ═══
 *
 * Der Client-Fix (Badge räumen beim Start und bei jedem Wechsel in den
 * Vordergrund) wirkt erst mit dem nächsten Release, und dann auch nur bei
 * denen, die aktualisieren und die App danach öffnen. Dieses Skript räumt
 * die Zahl sofort, auch bei Leuten, die die App seit Wochen nicht angefasst
 * haben.
 *
 * ═══ Der Weg: eine Nachricht, die nur den Zähler trägt ═══
 *
 * `aps: { badge: 0 }` — sonst nichts. Kein `alert`, kein `sound`, kein
 * `content-available`. Es gibt damit nichts anzuzeigen und nichts zu hören;
 * in der Mitteilungszentrale erscheint kein Eintrag. iOS setzt den Zähler
 * selbst (SpringBoard), die App muss dafür nicht laufen — das wirkt also
 * auch auf Geräten, auf denen die App beendet wurde.
 *
 * Der Header lautet `apns-push-type: alert`, NICHT `background`. Das sieht
 * verkehrt aus und ist es nicht: Apple ordnet den Badge ausdrücklich diesem
 * Typ zu („notifications that trigger a user interaction — for example, an
 * alert, badge, or sound"). Der erste Entwurf dieses Skripts nahm
 * `background` + `content-available: 1` + `badge: 0` — das ist gleich
 * dreifach falsch:
 *
 *   1. Apple verbietet die Kombination wörtlich: „To perform a silent
 *      background update, specify the value 1 and don't include the alert,
 *      badge, or sound keys." Bei einem Widerspruch zwischen Header und
 *      Inhalt darf APNs die Nachricht verzögern oder verwerfen.
 *   2. Hintergrund-Zustellung setzt den Modus `remote-notification` voraus.
 *      Unsere App hat ihn nicht — weder `Info.plist` noch `app.json` führen
 *      `UIBackgroundModes`. Ihn einzubauen hieße: App-Update, und damit
 *      wäre der ganze Zweck dieses Skripts dahin.
 *   3. Apple sichert Hintergrund-Zustellungen ausdrücklich NICHT zu und
 *      verwirft sie, wenn die App beendet wurde — also genau bei der
 *      Zielgruppe.
 *
 * Android wird übersprungen: dort gibt es kein Badge dieser Art, die
 * Zustellung wäre reine Last.
 *
 * ═══ Ausführen ═══
 *
 *   cd cloud-functions/cashback-pipeline
 *
 *   # 1. Zählen, ohne FCM zu behelligen
 *   node .badge-reset.js
 *
 *   # 2. Echte Prüfung des Pakets durch FCM — berührt KEIN Gerät
 *   PRUEFEN=1 node .badge-reset.js
 *
 *   # 3. EIN Gerät, zum Anschauen (uid des eigenen Kontos)
 *   NUR_UID=<uid> ECHT=1 node .badge-reset.js
 *
 *   # 4. Alle (erst nach Schritt 3 mit eigenen Augen bestätigt)
 *   ECHT=1 node .badge-reset.js
 *
 * Schalter:
 *   PRUEFEN=1          Paket von FCM validieren lassen (validate_only),
 *                      ohne Zustellung. Beantwortet die Payload-Frage
 *                      kostenlos.
 *   ECHT=1             wirklich senden
 *   NUR_UID=<uid>      nur die Geräte EINES Kontos. Für den Einzeltest
 *                      immer diesen Schalter nehmen, nie eine Obergrenze:
 *                      die Reihenfolge des Scans ist der Dokumentpfad, ein
 *                      „nur die ersten paar" träfe fremde Menschen.
 *   AUCH_ABBESTELLTE=1 auch Konten mit `pushNotificationsEnabled: false`.
 *                      Standard ist AUS. Diese Zustellung zeigt zwar nichts
 *                      an und nimmt nur etwas weg, das wir selbst gesetzt
 *                      haben — aber derselbe Änderungssatz erklärt gerade
 *                      erst das ausdrückliche Nein zur Regel. Es geht um
 *                      6 Konten; die Ausnahme muss man bewusst wählen.
 *   AB_BLOCK=<n>       nach einem Abbruch bei Block n weitermachen.
 *
 * Der Fortschritt landet nach JEDEM Block in .badge-reset-ergebnis.json —
 * mit Blockzeiger zum Wiederaufsetzen, ohne Kennungen von Personen. Frühere
 * Läufe bleiben darin erhalten.
 */

const fs = require('fs');
const admin = require('firebase-admin');

const ECHT = process.env.ECHT === '1';
const PRUEFEN = process.env.PRUEFEN === '1';
const AUCH_ABBESTELLTE = process.env.AUCH_ABBESTELLTE === '1';
const NUR_UID = process.env.NUR_UID || null;
const AB_BLOCK = Number(process.env.AB_BLOCK || 0) || 0;
const ERGEBNIS = '.badge-reset-ergebnis.json';
// Klein gewählt: sendEachForMulticast ist kein Sammelaufruf mehr, sondern
// ein Aufruf JE Nachricht, alle gleichzeitig und ohne Bremse. 500 auf einmal
// wären 500 parallele Verbindungen.
const BLOCK = 50;
// Reißt die Fehlerquote diese Marke, stimmt etwas Grundsätzliches nicht
// (Zugangsdaten, Paketform) — dann abbrechen statt 23 Blöcke ins Leere zu
// schicken und am Ende „Fertig" zu melden.
const ABBRUCH_AB = 0.5;

/**
 * Fehlercodes, die ein erloschenes Token anzeigen.
 *
 * ACHTUNG: Diese Liste dient hier NUR der Zählung. Die Ergebnisdatei taugt
 * ausdrücklich NICHT als Grundlage zum Aufräumen von Token — ein
 * `invalid-argument` kann ebenso gut am Paket liegen wie am Token, und wer
 * daraufhin Dokumente löscht, meldet funktionierende Geräte ab. Das
 * Aufräumen erledigt lib/push.js beim nächsten echten Versand von selbst,
 * dort ist die Zuordnung eindeutig.
 */
const ERLOSCHEN = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();

async function abbestellteKonten() {
  if (AUCH_ABBESTELLTE) return new Set();
  const snap = await db.collection('users').where('pushNotificationsEnabled', '==', false).get();
  return new Set(snap.docs.map((d) => d.id));
}

async function sammleTokens() {
  console.log('Sammle iOS-Token …');
  const raus = await abbestellteKonten();
  const snap = NUR_UID
    ? await db.collection(`users/${NUR_UID}/fcmTokens`).select('token', 'platform').get()
    : await db.collectionGroup('fcmTokens').select('token', 'platform').get();

  const treffer = [];
  const zaehler = { gelesen: snap.size, ios: 0, android: 0, ohne_plattform: 0, leer: 0, abbestellt: 0 };

  for (const d of snap.docs) {
    const token = String(d.get('token') || '');
    if (!token) {
      zaehler.leer++;
      continue;
    }
    const plattform = String(d.get('platform') || '').toLowerCase();
    if (plattform === 'android') {
      zaehler.android++;
      continue;
    }
    if (plattform !== 'ios') {
      // Ohne Plattformangabe lässt sich nicht sagen, ob ein Badge existiert.
      zaehler.ohne_plattform++;
      continue;
    }
    zaehler.ios++;

    // users/{uid}/fcmTokens/{id} → uid ist das Großelternteil
    const uid = NUR_UID || d.ref.parent.parent?.id;
    if (uid && raus.has(uid)) {
      zaehler.abbestellt++;
      continue;
    }
    treffer.push(token);
  }

  // Die Zahl der ausgelassenen Konten IMMER nennen, auch wenn niemand
  // ausgelassen wurde — sonst entscheidet man über eine Größe, die man
  // nicht sieht.
  console.log('  ' + JSON.stringify(zaehler));
  if (AUCH_ABBESTELLTE) {
    const n = (await db.collection('users').where('pushNotificationsEnabled', '==', false).get()).size;
    console.log(`  ACHTUNG: ${n} Konten haben abbestellt und werden TROTZDEM angeschrieben`);
  } else {
    console.log(`  ${raus.size} Konten haben abbestellt und bleiben außen vor`);
  }
  return treffer;
}

/**
 * Die Nachricht: nur der Zähler, sonst nichts.
 */
function nachricht(tokens) {
  return {
    tokens,
    apns: {
      // Muss zum Inhalt passen — der Badge zählt bei Apple zu 'alert'.
      headers: { 'apns-push-type': 'alert' },
      payload: { aps: { badge: 0 } },
    },
  };
}

function standLaden() {
  try {
    return JSON.parse(fs.readFileSync(ERGEBNIS, 'utf8'));
  } catch {
    return { laeufe: [] };
  }
}

async function main() {
  const modus = ECHT ? 'ECHTLAUF — geht an echte Geräte' : PRUEFEN ? 'PRÜFUNG — FCM validiert, kein Gerät' : 'ZÄHLEN — FCM wird nicht aufgerufen';
  console.log(`### ${modus}`);
  if (NUR_UID) console.log(`### eingeschränkt auf Konto ${NUR_UID}`);

  const tokens = await sammleTokens();
  const bloecke = Math.ceil(tokens.length / BLOCK);
  console.log(`${tokens.length} iOS-Token in ${bloecke} Blöcken à ${BLOCK}`);

  if (!ECHT && !PRUEFEN) {
    console.log('\nNächster Schritt: PRUEFEN=1 — lässt FCM das Paket prüfen, ohne ein Gerät zu berühren.');
    return;
  }

  const datei = standLaden();
  const lauf = {
    modus: ECHT ? 'echt' : 'pruefung',
    gestartet: new Date().toISOString(),
    nurUid: NUR_UID || null,
    abBlock: AB_BLOCK,
    tokens: tokens.length,
    gesendet: 0,
    erfolg: 0,
    fehler: 0,
    letzterBlock: AB_BLOCK,
    fehlercodes: {},
    erloschen: 0,
    abgebrochen: null,
  };
  datei.laeufe.push(lauf);
  const sichern = () => fs.writeFileSync(ERGEBNIS, JSON.stringify(datei, null, 2));

  for (let b = AB_BLOCK; b < bloecke; b++) {
    const teil = tokens.slice(b * BLOCK, (b + 1) * BLOCK);
    let antwort;
    try {
      // Zweiter Parameter = validate_only: FCM prüft das Paket vollständig,
      // stellt aber nichts zu.
      antwort = await admin.messaging().sendEachForMulticast(nachricht(teil), !ECHT);
    } catch (e) {
      lauf.abgebrochen = `Block ${b}: ${e.message}`;
      lauf.letzterBlock = b;
      sichern();
      console.error(`\nABBRUCH bei Block ${b}: ${e.message}`);
      console.error(`Weitermachen mit: AB_BLOCK=${b} …`);
      process.exit(1);
    }
    lauf.gesendet += teil.length;
    lauf.erfolg += antwort.successCount;
    lauf.fehler += antwort.failureCount;
    lauf.letzterBlock = b + 1;
    for (const r of antwort.responses) {
      if (r.success) continue;
      const code = r.error?.code || 'unbekannt';
      lauf.fehlercodes[code] = (lauf.fehlercodes[code] || 0) + 1;
      if (ERLOSCHEN.has(code)) lauf.erloschen++;
    }
    sichern();

    const quote = lauf.fehler / Math.max(1, lauf.gesendet);
    if (quote > ABBRUCH_AB) {
      lauf.abgebrochen = `Fehlerquote ${(quote * 100).toFixed(0)} % nach Block ${b}`;
      sichern();
      console.error(`\nABBRUCH: ${lauf.abgebrochen}`);
      console.error('Fehlercodes:', JSON.stringify(lauf.fehlercodes));
      console.error(`Nach der Ursache schauen, dann AB_BLOCK=${b + 1} …`);
      process.exit(1);
    }
    if (b % 10 === 0 || b === bloecke - 1) {
      console.log(`  Block ${b + 1}/${bloecke}: ${lauf.erfolg} angenommen, ${lauf.fehler} nicht`);
    }
  }

  console.log('\nFertig:', JSON.stringify({ ...lauf, fehlercodes: undefined }));
  if (Object.keys(lauf.fehlercodes).length) {
    console.log('Fehlercodes:', JSON.stringify(lauf.fehlercodes));
  }
  console.log(
    `\n${lauf.erloschen} Token sind erloschen. Diese Datei ist KEINE Grundlage zum ` +
      'Aufräumen — das erledigt lib/push.js beim nächsten echten Versand.',
  );
  if (ECHT) {
    console.log(
      '\nWICHTIG: „angenommen" heißt von FCM angenommen, nicht auf dem Gerät angekommen. ' +
        'Ob die Zahl wirklich verschwunden ist, sagt nur ein Blick aufs Gerät.',
    );
  }
}

// Nur bei direktem Aufruf loslaufen — ein versehentliches require darf
// keinen Lauf starten.
if (require.main === module) {
  main().catch((e) => {
    console.error('Abbruch:', e);
    process.exit(1);
  });
}
