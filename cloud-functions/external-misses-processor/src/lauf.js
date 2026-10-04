/**
 * Ein Lauf des Prozessors — alles, was Firestore, scrapeEan und Serper
 * anfasst. Die Entscheidungen selbst stehen als reine Funktionen in
 * src/regeln.js und src/konfig.js; hier steht nur die Reihenfolge.
 *
 * Ablauf je Lauf (Zeitplan alle 10 Minuten oder Handaufruf, beide hierüber):
 *   1. Verlorene Ansprüche freigeben ('processing' älter als 30 min).
 *   2. Konfiguration lesen (_meta/produktsuche). Unlesbar → kein Lauf
 *      (ein Lesefehler darf einen bewusst gesetzten Halt nicht aufheben).
 *   3. Pause nach Dienstausfall (ZUSTAND_PFAD.pausiertBisMs) → kein Lauf.
 *   4. Kandidaten: offene Fälle nach `rang` absteigend, seitenweise; Fälle,
 *      die nach einem Fehler noch warten (naechsterVersuchAb), werden schon
 *      beim Sammeln übergangen (Prüfrunde 3). Fälle ohne `rang` danach
 *      (Abfrage nach hitCount) — nur, wenn die Abfrage nach rang scheitert
 *      oder nicht genug Kandidaten liefert.
 *   5. Je Kandidat, bevor Geld fließt:
 *        ungültige Nummer / Ladencode     → 'uebersprungen'
 *        Tagesdeckel schon erreicht       → Halt (einmal je Lauf geprüft)
 *        steht schon im Katalog           → 'uebersprungen' (im_katalog)
 *        gespeicherten Fund lesen (nutritionscrape/{ean}); unlesbar → Abbruch
 *        Fund seit abgebrochenem Versuch  → 'resolved' (ok_nach_zeitlimit)
 *      Übersprungene Fälle kosten nichts und zählen nicht gegen
 *      proLauf/tagesDeckel.
 *   6. Vor der ersten bezahlten Suche des Laufs EIN Abruf des
 *      Serper-Guthabens. Zu wenig/unbekannt → Halt.
 *   7. Beanspruchen in EINER Transaktion: Fall noch 'pending' und nicht
 *      wartend, aktiv, Tageszähler < tagesDeckel → 'processing' +
 *      lockAt/lockId, Zähler +1. Damit bezahlt kein zweiter Lauf
 *      (Handaufruf, Zeitplan) dieselbe EAN, und der Deckel hält auch bei
 *      parallelen Läufen.
 *   8. scrapeEan aufrufen, Ergebnis zuordnen (regeln.ordneErgebnisZu),
 *      in einer Transaktion zurückschreiben — nur, wenn der Anspruch noch
 *      diesem Lauf gehört; dazu den Zustand für die Pause (dienstweite
 *      Fehler in Folge).
 *   9. Nach einem dienstweiten Fehler (KI, Suche, Schlüssel, Ausrollen …)
 *      keinen weiteren Fall in diesem Lauf: jeder weitere Aufruf kostete
 *      trotzdem eine Serper-Suche.
 */

const crypto = require('crypto');
const regeln = require('./regeln');
const { KONFIG_PFAD, ZUSTAND_PFAD, KOSTEN_JE_SUCHE_USD, normalisiereKonfig, berlinTag, tagPfad } = require('./konfig');

const MISSES = 'external_lookup_misses';
const NUTRITIONSCRAPE = 'nutritionscrape';

const SCRAPE_EAN_URL = 'https://europe-west1-markendetektive-895f7.cloudfunctions.net/scrapeEan';
const SERPER_KONTO_URL = 'https://google.serper.dev/account';

// Der Aufruf von scrapeEan wird nach 240 s abgebrochen. Die Frist von
// scrapeEan (190 s) begrenzt nur den START eines weiteren Kandidaten, nicht
// dessen Dauer: eine Seite kann mit Apify-Rendern (bis 120 s) und hängender
// KI (3 × 45 s + Pausen ≈ 151 s) länger brauchen. Ein Abbruch zählt deshalb
// als dienstweit (src/regeln.js, Prüfrunde 2), und scrapeEan beginnt nach
// einem KI-Ausfall keinen weiteren Kandidaten. Nach 280 s Laufzeit beginnt
// der Lauf keine neue Suche mehr: 280 + 240 < 540 s Funktionszeitlimit, sonst
// bliebe ein Fall auf 'processing' hängen.
const SCRAPE_ZEITLIMIT_MS = 240_000;
const NEUE_SUCHE_BIS_MS = 280_000;
const SERPER_ZEITLIMIT_MS = 10_000;

// Ein 'processing'-Anspruch, der älter ist, gehört zu einem abgebrochenen
// Lauf (Absturz, Plattform-Zeitlimit). Ein Lauf lebt höchstens 540 s.
const ANSPRUCH_VERFALL_MS = 30 * 60 * 1000;

// Kandidaten über proLauf hinaus: übersprungene Fälle (ungültig, Ladencode,
// im Katalog) verbrauchen keinen Platz, der Lauf soll trotzdem voll werden
// (Lesevorgänge, kein Geld).
const KANDIDATEN_PUFFER = 25;

// Nach einem Fehler wartende Fälle (naechsterVersuchAb, nach gesperrten
// Shopseiten mindestens 6 h) behalten ihren rang und sammeln sich oben in der
// Reihenfolge. Bis zur Prüfrunde 3 las ein Lauf nur die obersten
// proLauf + 25 Fälle: hochgedreht (proLauf 10, 20 % gesperrt) war das Fenster
// nach wenigen Stunden voll mit Wartenden, der Prozessor bezahlte stundenlang
// nichts (nachgestellt: 528 statt 1.080 Suchen in 18 h). Jetzt liest er
// seitenweise weiter, bis genug beanspruchbare Fälle beisammen sind — höchstens
// KANDIDATEN_MAX_SEITEN Folgeseiten (≈ 500 Lesevorgänge); mehr als die erste
// Seite nur, wenn oben viel wartet. Reicht auch das nicht, steht `kandidatenKnapp` am Tageszähler
// (Tagesbericht, review-console).
const KANDIDATEN_SEITE = 50;
const KANDIDATEN_MAX_SEITEN = 10;

/** Millisekunden aus Timestamp | Zahl, sonst null. */
function alsMs(v) {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v && typeof v.toMillis === 'function') return v.toMillis();
  return null;
}

/**
 * @param {object} abh
 * @param {FirebaseFirestore.Firestore} abh.db
 * @param {typeof FirebaseFirestore.FieldValue} abh.FieldValue
 * @param {typeof FirebaseFirestore.Timestamp} abh.Timestamp
 * @param {typeof fetch} [abh.fetchFn]
 * @param {() => number} [abh.jetzt]
 * @param {Console} [abh.log]
 * @param {() => string} [abh.neueId]
 */
function erstelleProzessor({
  db,
  FieldValue,
  Timestamp,
  fetchFn = fetch,
  jetzt = () => Date.now(),
  log = console,
  neueId = () => crypto.randomUUID(),
}) {
  const misses = db.collection(MISSES);
  const konfigRef = db.doc(KONFIG_PFAD);
  const tagRef = (tag) => db.doc(tagPfad(tag));
  const zeit = () => FieldValue.serverTimestamp();

  function logZeile(evt, felder) {
    log.log(JSON.stringify({ evt, ...felder }));
  }

  async function ladeKonfig() {
    const snap = await konfigRef.get();
    const { konfig, warnungen } = normalisiereKonfig(snap.exists ? snap.data() : undefined);
    if (warnungen.length > 0) log.warn(`[produktsuche] Konfiguration: ${warnungen.join('; ')}`);
    return konfig;
  }

  /** Hält den Grund eines Halts am Tageszähler fest — nur, wenn er sich ändert. */
  async function vermerkeHalt(grund, extra = {}) {
    const tag = berlinTag(jetzt());
    const ref = tagRef(tag);
    try {
      const snap = await ref.get();
      const d = snap.exists ? snap.data() : {};
      const geaendert = d.angehalten !== grund || Object.entries(extra).some(([k, v]) => d[k] !== v);
      if (!geaendert) return;
      await ref.set({ tag, angehalten: grund, ...extra, aktualisiertAm: zeit() }, { merge: true });
    } catch (e) {
      log.warn(`[produktsuche] Halt (${grund}) nicht vermerkt: ${e && e.message}`);
    }
  }

  /** Setzt verlorene Ansprüche zurück; zählt das als Fehler der EAN. */
  async function verloreneAnspruecheFreigeben() {
    try {
      const grenze = Timestamp.fromMillis(jetzt() - ANSPRUCH_VERFALL_MS);
      const snap = await misses
        .where('status', '==', 'processing')
        .where('lockAt', '<', grenze)
        .limit(20)
        .get();
      if (snap.empty) return 0;
      const tag = berlinTag(jetzt());
      const batch = db.batch();
      snap.docs.forEach((d) => {
        // Auch ein Fall, an dem jeder Lauf abstürzt, erreicht so 'error'
        // statt endlos beansprucht zu werden.
        const f = regeln.fehlerFolgen({ code: 'anspruch_verloren', vorher: d.data() || {} });
        batch.update(d.ref, {
          status: f.status,
          ...(f.errorGrund ? { errorGrund: f.errorGrund } : {}),
          lockAt: FieldValue.delete(),
          lockId: FieldValue.delete(),
          processedAt: zeit(),
          processingError: 'lock-recovery: vorheriger Lauf abgebrochen (Zeitlimit/Absturz)',
          letzterFehlerCode: 'anspruch_verloren',
          errorCount: FieldValue.increment(1), // anspruch_verloren liegt am Barcode
          fehlerInFolge: f.fehlerInFolge,
          abrufGesperrtInFolge: FieldValue.delete(),
          naechsterVersuchAb: Timestamp.fromMillis(jetzt() + f.wartenMs),
        });
      });
      batch.set(tagRef(tag), { tag, fehler: FieldValue.increment(snap.size), aktualisiertAm: zeit() }, { merge: true });
      await batch.commit();
      log.warn(`[produktsuche] ${snap.size} verlorene Ansprüche freigegeben`);
      return snap.size;
    } catch (e) {
      // Fehlt der Index (status + lockAt), scheitert das hier — kein Grund,
      // den Lauf abzubrechen; der nächste Lauf versucht es erneut.
      log.warn(`[produktsuche] verlorene Ansprüche nicht freigegeben: ${e && e.message}`);
      return 0;
    }
  }

  /**
   * Offene Fälle nach rang, seitenweise, ohne die gerade wartenden (siehe
   * KANDIDATEN_SEITE). `knapp`: auch nach der letzten erlaubten Seite weniger
   * als `mindestens` beanspruchbare Fälle, obwohl es weitere gibt — dann
   * staut es sich oben.
   */
  async function holeKandidaten(grenze, mindestens) {
    const offen = misses.where('status', '==', 'pending');
    const alsListe = (snap) => snap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));
    const jetztMs = jetzt();
    const wartetNoch = (k) => regeln.wartet(alsMs(k.data.naechsterVersuchAb), jetztMs);
    let nachRang = [];
    let wartend = 0;
    let knapp = false;
    try {
      let letztes = null;
      for (let seite = 0; ; seite += 1) {
        // Erste Seite so groß wie gebraucht (Normalfall: eine Abfrage).
        let q = offen.orderBy('rang', 'desc').limit(seite === 0 ? grenze : KANDIDATEN_SEITE);
        if (letztes) q = q.startAfter(letztes);
        const snap = await q.get();
        for (const k of alsListe(snap)) {
          if (wartetNoch(k)) wartend += 1;
          else nachRang.push(k);
        }
        const amEnde = snap.docs.length < (seite === 0 ? grenze : KANDIDATEN_SEITE);
        if (nachRang.length >= grenze || amEnde) break;
        if (seite >= KANDIDATEN_MAX_SEITEN) {
          knapp = nachRang.length < mindestens;
          break;
        }
        letztes = snap.docs[snap.docs.length - 1];
      }
    } catch (e) {
      log.error(`[produktsuche] Abfrage nach rang gescheitert (Index status+rang angelegt?): ${e && e.message}`);
      nachRang = null;
    }
    let nachHitCount = null;
    if (!nachRang || nachRang.length < grenze) {
      try {
        nachHitCount = alsListe(await offen.orderBy('hitCount', 'desc').limit(grenze).get());
      } catch (e) {
        log.error(`[produktsuche] Abfrage nach hitCount gescheitert: ${e && e.message}`);
      }
    }
    const liste = regeln.waehleKandidaten({ nachRang, nachHitCount, grenze });
    const ohneRang = liste.filter((k) => typeof k.data.rang !== 'number').length;
    return { liste, ohneRang, wartend, knapp, rangAbfrageGescheitert: nachRang === null };
  }

  /** Stau oben in der Reihenfolge am Tageszähler vermerken (Tagesbericht). */
  async function vermerkeKandidatenKnapp() {
    const tag = berlinTag(jetzt());
    try {
      await tagRef(tag).set({ tag, kandidatenKnapp: FieldValue.increment(1), aktualisiertAm: zeit() }, { merge: true });
    } catch (e) {
      log.warn(`[produktsuche] kandidatenKnapp nicht vermerkt: ${e && e.message}`);
    }
  }

  /** Pfad des ersten Katalogprodukts mit dieser EAN (jede Schreibweise) oder null.
   *  Wirft bei Lesefehlern — der Aufrufer bricht dann ab, statt zu bezahlen. */
  async function katalogTreffer(ean) {
    const werte = regeln.katalogVarianten(ean);
    if (werte.length === 0) return null;
    const abfragen = [];
    for (const sammlung of regeln.KATALOG_SAMMLUNGEN) {
      const s = db.collection(sammlung);
      for (const feld of regeln.KATALOG_LISTENFELDER) {
        abfragen.push(s.where(feld, 'array-contains-any', werte).limit(1).select().get());
      }
      for (const feld of regeln.KATALOG_EINZELFELDER) {
        abfragen.push(s.where(feld, 'in', werte).limit(1).select().get());
      }
    }
    const ergebnisse = await Promise.all(abfragen);
    const treffer = ergebnisse.find((snap) => !snap.empty);
    return treffer ? treffer.docs[0].ref.path : null;
  }

  /** Schließt einen offenen Fall ohne bezahlte Suche ab. */
  async function ueberspringen(ean, grund) {
    const ref = misses.doc(ean);
    const tag = berlinTag(jetzt());
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || (snap.data() || {}).status !== 'pending') return false;
      tx.update(ref, {
        status: 'uebersprungen',
        uebersprungenGrund: grund,
        processedResult: 'uebersprungen',
        processedAt: zeit(),
        processingError: FieldValue.delete(),
        errorCount: FieldValue.delete(),
        lockAt: FieldValue.delete(),
        lockId: FieldValue.delete(),
      });
      tx.set(tagRef(tag), { tag, uebersprungen: FieldValue.increment(1), aktualisiertAm: zeit() }, { merge: true });
      return true;
    });
  }

  async function tagesDeckelErreicht(konfig) {
    const snap = await tagRef(berlinTag(jetzt())).get();
    const bearbeitet = snap.exists ? Number((snap.data() || {}).bearbeitet) || 0 : 0;
    return bearbeitet >= konfig.tagesDeckel;
  }

  /** Serper-Guthaben (Anzahl Suchen) oder null, wenn es nicht lesbar ist.
   *  Der Schlüssel bleibt im Speicher und wird nie geloggt. */
  async function leseSerperGuthaben(serperKey) {
    if (!serperKey) return null;
    try {
      const resp = await fetchFn(SERPER_KONTO_URL, {
        method: 'GET',
        headers: { 'X-API-KEY': serperKey },
        signal: AbortSignal.timeout(SERPER_ZEITLIMIT_MS),
      });
      if (!resp.ok) {
        log.warn(`[produktsuche] Serper-Konto HTTP ${resp.status}`);
        return null;
      }
      const j = await resp.json();
      return j && typeof j.balance === 'number' && Number.isFinite(j.balance) ? j.balance : null;
    } catch (e) {
      log.warn(`[produktsuche] Serper-Konto nicht lesbar: ${e && e.message}`);
      return null;
    }
  }

  /**
   * Beansprucht einen Fall — die einzige Stelle, an der eine bezahlte Suche
   * beginnt. Liest Fall, Tageszähler und Konfiguration in derselben
   * Transaktion: `aktiv: false` und ein erreichter Deckel wirken sofort, auch
   * mitten in einem Lauf.
   */
  async function beanspruchen(ean, lockId, serperRest) {
    const ref = misses.doc(ean);
    const tag = berlinTag(jetzt());
    const tRef = tagRef(tag);
    return db.runTransaction(async (tx) => {
      const [fall, tagSnap, konfigSnap] = await tx.getAll(ref, tRef, konfigRef);
      const { konfig } = normalisiereKonfig(konfigSnap.exists ? konfigSnap.data() : undefined);
      const tagDaten = tagSnap.exists ? tagSnap.data() || {} : {};
      const vorher = fall.exists ? fall.data() || {} : {};
      const urteil = regeln.beanspruchenUrteil({
        status: fall.exists ? vorher.status : undefined,
        konfig,
        tagBearbeitet: tagDaten.bearbeitet,
        naechsterVersuchAbMs: alsMs(vorher.naechsterVersuchAb),
        jetztMs: jetzt(),
      });
      if (!urteil.ok) return { ...urteil, tag };
      tx.update(ref, { status: 'processing', lockAt: zeit(), lockId });
      const zaehler = { tag, bearbeitet: FieldValue.increment(1), aktualisiertAm: zeit() };
      if (typeof serperRest === 'number') zaehler.serperRest = serperRest;
      if (tagDaten.angehalten != null) zaehler.angehalten = FieldValue.delete();
      tx.set(tRef, zaehler, { merge: true });
      return { ok: true, tag, vorher };
    });
  }

  /** Gespeicherter Fund aus nutritionscrape — gelesen VOR dem Beanspruchen:
   *  Quellseite für `bevorzugteUrl` (Auffrischung), ob dort Daten liegen
   *  (dann wird ein Lauf ohne neuen Fund nie 'no-data',
   *  regeln.hatFruehererFund) und der Stand (Fund nach abgebrochenem
   *  Versuch, regeln.fundNachAbbruch).
   *  Lesefehler → { fehler: true }: der Aufrufer bezahlt dann nichts. Bis zur
   *  Prüfrunde 04.10.2026 hieß ein Lesefehler „kein Fund", und eine
   *  Auffrischung ohne Treffer endete als 'no-data' — eine inhaltliche
   *  Aussage aus einem Infrastrukturfehler. */
  async function gespeicherterFund(ean) {
    try {
      const snap = await db.collection(NUTRITIONSCRAPE).doc(ean).get();
      if (!snap.exists) return { bevorzugteUrl: null, rohdatenVorhanden: false, fetchedAtMs: null, sourceShop: null };
      const d = snap.data() || {};
      return {
        bevorzugteUrl: regeln.waehleBevorzugteUrl(d),
        rohdatenVorhanden: regeln.rohdatenVorhanden(d),
        fetchedAtMs: alsMs(d.fetchedAt),
        sourceShop: typeof d.sourceShop === 'string' && d.sourceShop ? d.sourceShop : null,
      };
    } catch (e) {
      log.warn(`[produktsuche] gespeicherter Fund für ${ean} nicht lesbar: ${e && e.message}`);
      return { fehler: true };
    }
  }

  /** Fund nach abgebrochenem Versuch: Fall ohne neue Suche abschließen. */
  async function nachtragen(ean, fund) {
    const ref = misses.doc(ean);
    return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists || (snap.data() || {}).status !== 'pending') return false;
      tx.update(ref, {
        status: 'resolved',
        processedResult: 'ok_nach_zeitlimit',
        processedSource: fund.sourceShop || 'scraper',
        processedAt: zeit(),
        ...zyklusLoeschen(),
      });
      return true;
    });
  }

  /** Felder eines Versuchszyklus — weg nach einem inhaltlichen Ergebnis. */
  function zyklusLoeschen() {
    return {
      processingError: FieldValue.delete(),
      errorCount: FieldValue.delete(),
      fehlerInFolge: FieldValue.delete(),
      abrufGesperrtInFolge: FieldValue.delete(),
      naechsterVersuchAb: FieldValue.delete(),
      letzterFehlerCode: FieldValue.delete(),
      errorGrund: FieldValue.delete(),
    };
  }

  /** POST an scrapeEan; der Schlüssel geht im Body, nie in der Adresse
   *  (Adressen landen im Klartext in den Zugriffsprotokollen). */
  async function rufeScrapeEan(anfrage, triggerKey) {
    try {
      const resp = await fetchFn(SCRAPE_EAN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...anfrage, key: triggerKey }),
        signal: AbortSignal.timeout(SCRAPE_ZEITLIMIT_MS),
      });
      const text = await resp.text().catch(() => '');
      let body = null;
      try {
        body = JSON.parse(text);
      } catch {
        body = null;
      }
      return body ? { httpStatus: resp.status, body } : { httpStatus: resp.status, text: text.slice(0, 200) };
    } catch (e) {
      const zeitlimit = !!e && (e.name === 'TimeoutError' || e.name === 'AbortError');
      return { netzFehler: String((e && e.message) || e).slice(0, 300), zeitlimit };
    }
  }

  function fallFelderNachErgebnis(erg, grund) {
    const felder = {
      status: erg.status,
      processedAt: zeit(),
      lockAt: FieldValue.delete(),
      lockId: FieldValue.delete(),
    };
    if (erg.art === 'fehler') {
      // processedResult/processedSource bleiben: sie halten das letzte
      // inhaltliche Ergebnis fest (früherer Fund ⇒ nie 'no-data').
      felder.processingError = erg.fehlerText;
      felder.letzterFehlerCode = erg.fehlerCode;
      // Dienstweite Fehler zählen nicht gegen den Barcode (regeln.js).
      if (erg.errorCountPlus > 0) felder.errorCount = FieldValue.increment(erg.errorCountPlus);
      felder.fehlerInFolge = erg.fehlerInFolge;
      felder.abrufGesperrtInFolge = erg.abrufGesperrtInFolge > 0 ? erg.abrufGesperrtInFolge : FieldValue.delete();
      if (erg.errorGrund) felder.errorGrund = erg.errorGrund;
      felder.naechsterVersuchAb = Timestamp.fromMillis(jetzt() + erg.wartenMs);
      return felder;
    }
    felder.processedResult = erg.processedResult;
    if (erg.processedSource) felder.processedSource = erg.processedSource;
    else if (erg.processedSourceLoeschen) felder.processedSource = FieldValue.delete();
    Object.assign(felder, zyklusLoeschen());
    if (grund === 'auffrischen') felder.refreshVersuchtAm = zeit();
    return felder;
  }

  /**
   * Schreibt das Ergebnis zurück. Den Fall nur, wenn der Anspruch noch
   * diesem Lauf gehört; die Tageszähler immer (die Suche hat stattgefunden);
   * den Pausen-Zustand: dienstweiter Fehler → Zähler +1 und ab dem zweiten in
   * Folge eine Pause; inhaltliches Ergebnis → Zähler und Pause weg.
   * @returns {Promise<{eigenerAnspruch:boolean, pausiertBisMs:number|null}>}
   */
  async function ergebnisSchreiben({ ean, lockId, tag, grund, erg }) {
    const ref = misses.doc(ean);
    const zRef = db.doc(ZUSTAND_PFAD);
    const zaehler = { tag, [erg.zaehler]: FieldValue.increment(1), aktualisiertAm: zeit() };
    if (erg.kostenAngefallen) zaehler.kostenSchaetzungUsd = FieldValue.increment(KOSTEN_JE_SUCHE_USD);
    return db.runTransaction(async (tx) => {
      const [snap, zSnap] = await tx.getAll(ref, zRef);
      const d = snap.exists ? snap.data() || {} : {};
      const z = zSnap.exists ? zSnap.data() || {} : {};
      const eigenerAnspruch = snap.exists && d.status === 'processing' && d.lockId === lockId;
      if (eigenerAnspruch) tx.update(ref, fallFelderNachErgebnis(erg, grund));
      tx.set(tagRef(tag), zaehler, { merge: true });

      let pausiertBisMs = null;
      if (erg.art === 'fehler' && erg.dienstweit) {
        const inFolge = (Number(z.dienstAusfallInFolge) || 0) + 1;
        const pause = regeln.pauseNachDienstAusfall(inFolge);
        pausiertBisMs = pause > 0 ? jetzt() + pause : null;
        tx.set(zRef, {
          dienstAusfallInFolge: inFolge,
          letzterDienstFehler: erg.fehlerCode,
          pausiertBisMs: pausiertBisMs === null ? FieldValue.delete() : pausiertBisMs,
          aktualisiertAm: zeit(),
        }, { merge: true });
      } else if (erg.art !== 'fehler' && (z.dienstAusfallInFolge || z.pausiertBisMs)) {
        tx.set(zRef, { dienstAusfallInFolge: 0, pausiertBisMs: FieldValue.delete(), aktualisiertAm: zeit() }, { merge: true });
      }
      return { eigenerAnspruch, pausiertBisMs };
    });
  }

  /** Pause nach Dienstausfall aktiv? → bis wann (ms), sonst null. Ein
   *  Lesefehler zählt als „keine Pause": die Pause ist eine Sparmaßnahme,
   *  kein Geld-Halt — der wirkt über Serper-Grenze, Deckel und Schalter. */
  async function pauseBis() {
    try {
      const snap = await db.doc(ZUSTAND_PFAD).get();
      const bis = snap.exists ? Number((snap.data() || {}).pausiertBisMs) : NaN;
      return Number.isFinite(bis) && bis > jetzt() ? bis : null;
    } catch (e) {
      log.warn(`[produktsuche] Pausen-Zustand nicht lesbar: ${e && e.message}`);
      return null;
    }
  }

  /**
   * Arbeitet die Kandidaten ab, bis proLauf Suchen beansprucht sind, das
   * Zeitbudget erschöpft ist oder ein Halt/Fehler eintritt. Schreibt in
   * `bericht`; wirft nur bei unerwarteten Firestore-Fehlern.
   */
  async function kandidatenBearbeiten({ liste, konfig, bericht, start, triggerKey, serperKey }) {
    let deckelGeprueft = false;
    let serperGeprueft = false;
    let serperRest = null;
    for (const { id: ean, data: fallDaten } of liste) {
      if (bericht.beansprucht >= konfig.proLauf) return;
      if (jetzt() - start > NEUE_SUCHE_BIS_MS) {
        bericht.zeitbudgetErreicht = true;
        return;
      }
      if (regeln.wartet(alsMs(fallDaten.naechsterVersuchAb), jetzt())) {
        bericht.wartend += 1;
        continue;
      }

      const vorab = regeln.vorabEntscheidung(ean);
      if (vorab.art === 'ueberspringen') {
        if (await ueberspringen(ean, vorab.grund)) bericht.uebersprungen += 1;
        continue;
      }

      // Ab hier würde es (nach der Katalogprüfung) Geld kosten: erst der
      // kostenlose Tagesdeckel, damit ein gedeckelter Lauf keine Abfragen
      // mehr verbraucht.
      if (!deckelGeprueft) {
        if (await tagesDeckelErreicht(konfig)) {
          bericht.angehalten = 'tagesdeckel';
          await vermerkeHalt('tagesdeckel');
          return;
        }
        deckelGeprueft = true;
      }

      let katalogPfad;
      try {
        katalogPfad = await katalogTreffer(ean);
      } catch (e) {
        log.error(`[produktsuche] Katalogprüfung für ${ean} gescheitert — keine Suche: ${e && e.message}`);
        bericht.abbruch = 'katalog_unlesbar';
        return;
      }
      if (katalogPfad) {
        if (await ueberspringen(ean, 'im_katalog')) {
          bericht.uebersprungen += 1;
          logZeile('produktsuche_im_katalog', { ean, pfad: katalogPfad });
        }
        continue;
      }

      // Gespeicherten Fund VOR dem Bezahlen lesen (regeln.fundNachAbbruch,
      // bevorzugteUrl, früherer Fund). Unlesbar → nichts bezahlen.
      const fund = await gespeicherterFund(ean);
      if (fund.fehler) {
        bericht.abbruch = 'fund_unlesbar';
        return;
      }
      if (regeln.fundNachAbbruch(
        { letzterFehlerCode: fallDaten.letzterFehlerCode, processedAtMs: alsMs(fallDaten.processedAt) },
        fund.fetchedAtMs,
      )) {
        if (await nachtragen(ean, fund)) {
          bericht.nachgetragen += 1;
          logZeile('produktsuche_ean', { ean, ergebnis: 'fund', status: 'resolved', code: 'ok_nach_zeitlimit', quelle: fund.sourceShop });
        }
        continue;
      }

      if (!serperGeprueft) {
        // Genau ein Abruf des Guthabens je Lauf, erst vor der ersten Suche.
        serperRest = await leseSerperGuthaben(serperKey);
        bericht.serperRest = serperRest;
        const su = regeln.serperUrteil(serperRest, konfig.serperMindestGuthaben);
        if (!su.ok) {
          log.warn(`[produktsuche] angehalten: ${su.grund} (Guthaben ${serperRest}, Mindestwert ${konfig.serperMindestGuthaben})`);
          bericht.angehalten = su.grund;
          await vermerkeHalt(su.grund, { serperRest });
          return;
        }
        serperGeprueft = true;
      }

      const lockId = neueId();
      const anspruch = await beanspruchen(ean, lockId, serperRest);
      if (!anspruch.ok) {
        if (anspruch.halt) {
          bericht.angehalten = anspruch.grund;
          await vermerkeHalt(anspruch.grund);
          return;
        }
        continue; // inzwischen von einem anderen Lauf übernommen
      }
      bericht.beansprucht += 1;

      const grund = anspruch.vorher.grund;
      const anfrage = regeln.scrapeAnfrage({ ean, vorab, grund, bevorzugteUrl: fund.bevorzugteUrl });
      const t0 = jetzt();
      const antwort = await rufeScrapeEan(anfrage, triggerKey);
      const erg = regeln.ordneErgebnisZu({
        antwort,
        // Früherer Fund zählt nur für Auffrischungen (wie bisher): ein neuer
        // Fall ohne Fund bleibt 'no-data', auch wenn nutritionscrape nur
        // Nicht-Anzeigbares (etwa einen Preis) trägt.
        vorher: { ...anspruch.vorher, rohdatenVorhanden: grund === 'auffrischen' && fund.rohdatenVorhanden },
      });
      bericht[erg.zaehler] += 1;

      let eigenerAnspruch = null;
      try {
        const geschrieben = await ergebnisSchreiben({ ean, lockId, tag: anspruch.tag, grund, erg });
        eigenerAnspruch = geschrieben.eigenerAnspruch;
        if (geschrieben.pausiertBisMs !== null) {
          bericht.angehalten = 'dienst_ausfall';
          await vermerkeHalt('dienst_ausfall', { pausiertBisMs: geschrieben.pausiertBisMs });
        }
      } catch (e) {
        // Der Fall bleibt 'processing'; nach 30 min gibt ihn ein späterer
        // Lauf frei (zählt dann als Fehler, nie als 'no-data').
        log.error(`[produktsuche] Ergebnis für ${ean} nicht gespeichert: ${e && e.message}`);
        bericht.abbruch = 'ergebnis_nicht_gespeichert';
      }
      logZeile('produktsuche_ean', {
        ean,
        grund: grund || null,
        ergebnis: erg.art,
        status: erg.status,
        code: erg.fehlerCode || erg.processedResult,
        dienstweit: erg.art === 'fehler' ? erg.dienstweit : undefined,
        quelle: erg.processedSource || null,
        nurDomains: Boolean(anfrage.nurDomains),
        bevorzugteUrl: Boolean(anfrage.bevorzugteUrl),
        dauerMs: jetzt() - t0,
        anspruchVerloren: eigenerAnspruch === false,
      });
      if (bericht.abbruch) return;
      if (erg.laufAbbrechen) {
        bericht.abbruch = erg.fehlerCode;
        return;
      }
    }
  }

  /**
   * Ein Lauf. Wirft nicht; Halt- und Abbruchgründe stehen im Bericht.
   * @param {{ triggerKey: string, serperKey: string, quelle?: string }} p
   */
  async function lauf({ triggerKey, serperKey, quelle = 'zeitplan' }) {
    const start = jetzt();
    const bericht = {
      quelle,
      kandidaten: 0,
      ohneRang: 0,
      beansprucht: 0,
      gefunden: 0,
      keineDaten: 0,
      fehler: 0,
      uebersprungen: 0,
      freigegebeneAnsprueche: 0,
      serperRest: null,
      angehalten: null,
      abbruch: null,
      zeitbudgetErreicht: false,
      wartend: 0,
      nachgetragen: 0,
    };
    // Eigener evt-Name: scrapeEan schreibt je Barcode 'produktsuche_lauf'
    // (Verbrauch); eine Summe über evt würde sonst beides mischen.
    const abschluss = () => {
      bericht.dauerMs = jetzt() - start;
      logZeile('produktsuche_prozessor_lauf', bericht);
      return bericht;
    };

    bericht.freigegebeneAnsprueche = await verloreneAnspruecheFreigeben();

    let konfig;
    try {
      konfig = await ladeKonfig();
    } catch (e) {
      log.error(`[produktsuche] Konfiguration nicht lesbar — kein Lauf: ${e && e.message}`);
      bericht.abbruch = 'konfig_unlesbar';
      return abschluss();
    }
    if (konfig.ungueltig.length > 0) {
      // Ungültiger Eintrag an einer Geld-Grenze (src/konfig.js): anhalten
      // und laut melden, statt still mit dem Standard weiterzubezahlen.
      bericht.angehalten = 'konfig_ungueltig';
      await vermerkeHalt('konfig_ungueltig', { ungueltigeFelder: konfig.ungueltig.join(',') });
      return abschluss();
    }
    if (!konfig.aktiv) {
      // Codes für `angehalten` liest der Tagesbericht (review-console,
      // src/produktsuche.js ANGEHALTEN_TEXT): aus, tagesdeckel,
      // serper_guthaben, serper_guthaben_unbekannt, dienst_ausfall,
      // konfig_ungueltig.
      bericht.angehalten = 'aus';
      await vermerkeHalt('aus');
      return abschluss();
    }
    if (konfig.proLauf === 0) {
      // Bewusste Pause: steht in der Konfiguration, der Tagesbericht leitet
      // „pausiert" von dort ab — kein Halt am Tageszähler.
      bericht.angehalten = 'pausiert';
      return abschluss();
    }
    const pausiertBisMs = await pauseBis();
    if (pausiertBisMs !== null) {
      // Dienstausfall: zwei dienstweite Fehler in Folge (regeln.js). Kein
      // Serper-Abruf, keine Suche bis zum Ende der Pause.
      bericht.angehalten = 'dienst_ausfall';
      bericht.pausiertBis = new Date(pausiertBisMs).toISOString();
      await vermerkeHalt('dienst_ausfall', { pausiertBisMs });
      return abschluss();
    }

    try {
      const { liste, ohneRang, wartend, knapp, rangAbfrageGescheitert } = await holeKandidaten(
        konfig.proLauf + KANDIDATEN_PUFFER,
        konfig.proLauf,
      );
      bericht.kandidaten = liste.length;
      bericht.ohneRang = ohneRang;
      bericht.wartend += wartend;
      if (rangAbfrageGescheitert) bericht.rangAbfrageGescheitert = true;
      if (knapp) {
        bericht.kandidatenKnapp = true;
        await vermerkeKandidatenKnapp();
      }
      await kandidatenBearbeiten({ liste, konfig, bericht, start, triggerKey, serperKey });
    } catch (e) {
      // Unerwarteter Firestore-Fehler (Überspringen, Deckel, Beanspruchen):
      // Lauf endet. Ein schon beanspruchter Fall wird nach 30 min frei.
      log.error(`[produktsuche] Lauf abgebrochen: ${e && e.message}`);
      bericht.abbruch = 'unerwarteter_fehler';
    }
    return abschluss();
  }

  return { lauf };
}

module.exports = { erstelleProzessor, SCRAPE_EAN_URL, SERPER_KONTO_URL };
