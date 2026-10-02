'use strict';
/**
 * Entscheidungsregeln der Morgenrunde für Produktfotos — reine Funktionen,
 * ohne Firestore, damit jede Regel einen Test hat (__tests__/fotoRundeRegeln.test.js).
 *
 * Grundlage sind die Handrunden vom 09.–24.09.2026. Jede Regel steht mit dem
 * Vorfall, der sie gekostet hat, in WISSEN-FOTORUNDE.md.
 *
 * Seit 24.09.2026 (Entscheidung Patrick: „beides automatisch") entscheidet die
 * Runde Freigaben UND Ablehnungen selbst. Liegen bleibt nur, was an unserer
 * Technik hängt (Storage nicht lesbar, Bildprüfung gescheitert, Nachlesen
 * gescheitert) — ein Infrastrukturfehler ist nie ein Urteil über eine
 * Einreichung, weder in die eine noch in die andere Richtung.
 */

const { REASON } = require('./duplicatePolicy');

const PENDING_OLDER = REASON.PENDING_OLDER;
const KONTO_GESPERRT = 'konto_gesperrt';

/**
 * Ablehngründe, die besagen: dieses Produkt war für diese Person schon
 * bezahlt (Doppel, Wochen-Sperre, wiederverwendete Fotos). Fotos aus so einer
 * abgelehnten Einreichung zählen bei einer späteren Einreichung als
 * wiederverwendet (bildBefund) — sonst ließen sie sich eine Woche später
 * einfach noch einmal einreichen (Prüfrunde 02.10.2026). `doppelt_eingereicht`
 * steht seit 02.10.2026 auch für die Wochen-Sperre am Dokument (APP_GRUND).
 * Gründe, die man korrigieren kann (fehlende Ansicht, Barcode, Name, Preis),
 * gehören NICHT hierher: wer danach mit denselben Fotos nachreicht, wird normal
 * geprüft.
 */
const DOPPEL_GRUENDE = new Set([
  REASON.SAME_USER_WEEK, REASON.SAME_USER, REASON.PENDING_OLDER, 'bilder_wiederverwendet', 'produkt_bereits_verguetet',
]);

/** Ablehnungen, die allein auf dem Urteil der Bildprüfung beruhen. */
const BILD_GRUENDE = new Set(['fotos_unpassend', 'gleiche_ansicht_mehrfach']);

/**
 * Ablehngründe mit EIGENER Bremse (siehe notbremse). Sie zählen nicht in die
 * Gesamt-Quote — weder heute noch im 30-Tage-Schnitt (schnittQuote in
 * taeglicheRunde.js prüft `rejectReason` UND `review.reason`). Ein Grund, den
 * es vorher nicht oder seltener gab, verschöbe die Quote dauerhaft, und die
 * Gesamt-Bremse hielte dann jeden Tag alle Ablehnungen zurück (Gegenprüfung
 * 26.09.2026 am Preis). Die alte 24-h-Sperre steht mit drin, damit der
 * Schnitt dieselbe Gruppe weglässt wie der heutige Lauf.
 */
const EIGENE_BREMSEN = Object.freeze([
  // Preis ist Pflicht (Entscheidung Patrick 26.09.2026). Beruht auf der
  // Bildprüfung — normal gut 10 % der geprüften Fälle.
  { schalter: 'preis', gruende: ['preis_fehlt'], halten: 'notbremse_preis', basis: 'geprueft', min: 8, anteil: 0.3,
    text: (n, g, pz) => `Bei ${n} von ${g} Einreichungen fehlte angeblich der Preis (${pz} %) — diese Ablehnungen zurückgehalten.` },
  // Wochen-Sperre (Entscheidung Patrick 02.10.2026). Vorher gemessen: 3,3 %
  // der Freigaben der letzten 7 Tage. Deutlich mehr deutet eher auf einen
  // Fehler beim Gruppieren (EAN, Nutzer) als auf echte Doppel.
  { schalter: 'woche', gruende: [REASON.SAME_USER_WEEK], halten: 'notbremse_wochensperre', basis: 'alle', min: 10, anteil: 0.15,
    text: (n, g, pz) => `${n} von ${g} Einreichungen wären wegen der Wochen-Sperre abgelehnt worden (${pz} %) — diese Ablehnungen zurückgehalten.` },
]);
const AUSSER_GESAMTQUOTE = new Set([...EIGENE_BREMSEN.flatMap((b) => b.gruende), REASON.SAME_USER]);

/**
 * Ein Fall → Entscheidung.
 *
 * @param {object} f
 * @param {'gesperrt'|'unbekannt'|null} [f.kontoSperre]  src/kontoSperre.js
 * @param {{ok:boolean, problems:string[], missing:string[]}} f.comp   completenessCheck
 * @param {{verdict:string, reason:string|null, lockUntil:number|null}} f.dup  evaluateDuplicate
 * @param {string[]} f.leer         Slots mit 0-Byte-Datei (echter Mangel)
 * @param {string[]} f.unlesbar     Slots, deren Metadaten Storage nicht lieferte (unsere Technik)
 * @param {{art:'wiederverwendet'|'aeltere_offen'|'fremdes_konto', mit:string[]}|null} [f.bild]  bildBefund
 * @param {boolean} [f.fotoAbgleichFehlt]  Abgleich gegen frühere Einreichungen nicht möglich (Storage-Liste gescheitert)
 * @param {{art:string, gelesen:string|null, gespeichert:string|null, zweit?:string|null}|null} [f.eanFoto]  werte.eanFotoBefund / eanFotoBestaetigen
 * @param {string|null} [f.eanFotoHinweis]  Text für den Menschen (z. B. eigene Freigabe unter der Foto-Nummer)
 * @param {{echt:boolean, loseWare:boolean, traegtAngaben?:boolean, gleicheAnsicht:boolean, grund:string}|null} f.audit
 * @param {string|null} f.auditFehler   Fehlermeldung, wenn die Bildprüfung scheiterte
 * @param {{name?:string, ean?:string, preis?:string, alles?:string}} f.rettungFehler  Nachlesen ist an unserer Technik gescheitert
 * @param {boolean} [f.preisVorhanden]  Preis gelesen (Namer oder nachgelesen, werte.preisOf)
 * @param {string|null} [f.preisHinweis]  Anzeichen, dass doch ein Preis im Bild ist (Lesedienst sah Preisschild/Kassenbon)
 * @param {boolean} [f.preisBildDefekt]  Preisfoto kam beim Hochladen beschädigt an (unser Fehler, nicht der Einreichung)
 * @param {string|null} [f.ortAuffaellig]  Aufnahmeort passt nicht zum Markt (Ausland, anderes Land, Simulator)
 * @param {boolean} [f.namerLaeuft]  Der Lesedienst liest die Einreichung noch nach (namerNachlesenAb)
 * @returns {{entscheidung:'freigeben'|'ablehnen'|'offen', grund:string|null, ctx:object, loseWare?:boolean}}
 */
function entscheideFall(f) {
  const comp = f.comp || { ok: true, problems: [], missing: [] };
  const dup = f.dup || { verdict: 'ok', reason: null, lockUntil: null };
  const rf = f.rettungFehler || {};

  // Gesperrtes Konto (Entscheidung Patrick 02.10.2026: offene Produktfotos
  // werden „nicht freigegeben") — hängt an nichts anderem, deshalb zuerst.
  // STUMM LIEGEN LASSEN, nicht ablehnen (Prüfrunde 02.10.2026): eine Ablehnung
  // ist endgültig und für den Nutzer sichtbar, und eine Sperre, die der
  // Betroffene sieht, lädt zum Ausweichen auf ein neues Konto ein (so hält es
  // auch die Gutschrift-Seite, cashback-pipeline/lib/kontoSperre.js). Ob er
  // sie doch sichtbar ablehnen will, entscheidet Patrick. Der Bericht zählt
  // diese Fälle getrennt, damit sie „wartet auf dich" nicht füllen.
  if (f.kontoSperre === 'gesperrt') return offen(KONTO_GESPERRT);

  // Unsere Technik zuerst: ohne lesbare Dateien gibt es kein Urteil.
  if ((f.unlesbar || []).length) return offen('bild_nicht_lesbar_infrastruktur');
  // Der Lesedienst versucht es nach einer Störung noch einmal — erst danach
  // stehen Name, Preis und Kassenbon-Adresse (Ortsquelle der Vergütung) fest.
  if (f.namerLaeuft) return offen('namer_laeuft_noch');

  // Fehlende oder leere Pflichtfotos — ohne Ansehen entscheidbar.
  if (comp.problems.includes('unvollstaendig')) return ablehnen('unvollstaendig', { missing: comp.missing });
  if ((f.leer || []).length) return ablehnen('unvollstaendig', { missing: f.leer });

  // Barcode-Foto zeigt eine andere Nummer als gespeichert, oder die zweite
  // Lesung bestätigt weder die eine noch die andere → ein Mensch entscheidet
  // (Entscheidung Patrick 02.10.2026). Weder freigeben noch ablehnen: welche
  // Nummer stimmt, weiß hier niemand. VOR der Doppel-Regel (Prüfrunde
  // 02.10.2026): die rechnet mit der gespeicherten EAN — ist die falsch und
  // gehört zufällig zu einem eigenen Produkt dieser Woche, lehnte die
  // Wochen-Sperre ein womöglich anderes Produkt ab.
  if (f.eanFoto && f.eanFoto.art === 'abweichend') {
    return offen('ean_abweichend', { hinweis: f.eanFotoHinweis || `Barcode-Foto zeigt ${f.eanFoto.gelesen}, gespeichert ist ${f.eanFoto.gespeichert}` });
  }
  if (f.eanFoto && f.eanFoto.art === 'unsicher') {
    return offen('ean_unsicher', { hinweis: f.eanFotoHinweis || `Barcode-Foto: erste Lesung ${f.eanFoto.gelesen}, zweite ${f.eanFoto.zweit || 'nicht lesbar'}, gespeichert ist ${f.eanFoto.gespeichert}` });
  }

  // Doppel-Regel (Konsolen-Regel, gleiche Datei wie dort). Seit der
  // Wochen-Regel (02.10.2026) hängt die Sperre an nichts als Person, EAN und
  // Zeit — kein Preis, kein Hersteller, kein Markt. Ein gescheitertes
  // Nachlesen des Preises ändert an ihr deshalb nichts mehr.
  if (dup.verdict === 'locked') return ablehnen(dup.reason || REASON.SAME_USER_WEEK, { lockUntil: dup.lockUntil });
  if (dup.verdict === 'hold') return offen(PENDING_OLDER);

  // Identisches Identitätsfoto in einer FRÜHEREN Einreichung (Abgleich gegen
  // alle, Entscheidung Patrick 02.10.2026). Die älteste Einreichung einer
  // Gruppe trägt nie einen Befund (bildBefund).
  const bild = f.bild || null;
  if (bild && bild.art === 'fremdes_konto') return offen('foto_fremdes_konto', { hinweis: `Gleiches Foto bei anderem Konto: ${(bild.mit || []).slice(0, 3).join(', ')}` });
  if (bild && bild.art === 'wiederverwendet') return ablehnen('bilder_wiederverwendet');
  if (bild && bild.art === 'aeltere_offen') return offen('foto_aeltere_offen', { hinweis: `Gleiches Foto in älterer, noch offener Einreichung: ${(bild.mit || []).slice(0, 3).join(', ')}` });

  // Ab hier braucht es die Bildprüfung.
  const audit = f.audit || null;

  if (comp.problems.includes('kein_produktname')) {
    // Scheiterte das Nachlesen (Limit ODER das Speichern des Ergebnisses), ist
    // das kein Beleg für „kein Name".
    if (rf.name === 'lesungen_uneinig') return offen('lesung_unsicher', { hinweis: 'Name nur einmal gelesen' });
    if (rf.name || rf.alles) return offen('nachlesen_gescheitert', { hinweis: rf.name || rf.alles });
    return ablehnen('kein_produktname');
  }

  if (comp.problems.includes('ean_fehlt')) {
    if (!audit) return offen(f.auditFehler ? 'bild_audit_gescheitert' : 'kein_bild_audit', { hinweis: f.auditFehler || null });
    // Lose Ware wird angenommen (Entscheidung Patrick 20.09.2026): Waage-Etiketten
    // tragen keinen Produkt-Barcode, das ist kein Fehler der Einreichung.
    // Waage-Etiketten wiederholen sich zwangsläufig auf allen Fotos — „dieselbe
    // Ansicht" ist bei loser Ware kein Mangel (Vergleich 24.09., Bergkäse).
    if (audit.loseWare && audit.echt) return freigabe(f, audit, { loseWare: true });
    if (rf.ean === 'lesungen_uneinig') return offen('lesung_unsicher', { hinweis: 'Barcode unsicher gelesen' });
    if (rf.ean || rf.alles) return offen('nachlesen_gescheitert', { hinweis: rf.ean || rf.alles });
    return ablehnen('ean_fehlt');
  }

  if (!audit) {
    const defekt = /decode|image data/i.test(String(f.auditFehler || ''));
    return offen(defekt ? 'bild_defekt' : f.auditFehler ? 'bild_audit_gescheitert' : 'kein_bild_audit', { hinweis: f.auditFehler || null });
  }
  // „Immer dieselbe Ansicht" ist nur ein Mangel, wenn das Produkt Angaben trägt,
  // die dadurch fehlen. Frischware ohne Zutaten/Nährwerte (Nektarinen im Netz)
  // hat nur ihr eines Etikett — ist es fotografiert, ist der Datensatz vollständig.
  // Vor „unecht" geprüft: der genauere Grund ergibt den passenderen App-Text.
  if (audit.gleicheAnsicht && audit.traegtAngaben !== false) return ablehnen('gleiche_ansicht_mehrfach', { hinweis: audit.grund });
  if (!audit.echt) return ablehnen('fotos_unpassend', { hinweis: audit.grund });
  return freigabe(f, audit, audit.traegtAngaben === false ? { ohneAngaben: true } : {});
}

/**
 * Bild-Befund einer Einreichung gegen ALLE früheren (Entscheidung Patrick
 * 02.10.2026). Bis dahin verglich die Runde byteidentische Fotos nur unter den
 * im selben Lauf offenen Einreichungen; eine Wiederverwendung aus einer schon
 * entschiedenen fiel nur auf, wenn derselbe Speicherpfad benutzt wurde.
 *
 * Regeln — „eine Kopie muss übrig bleiben" (10.09.2026):
 *  - Die ÄLTESTE Einreichung einer Gruppe bekommt nie einen Befund; „älter"
 *    heißt früher eingereicht (createdAt, bei Gleichstand die ID).
 *  - Ein früheres Foto eines ANDEREN Kontos → halten (`fremdes_konto`), der
 *    Mensch entscheidet; das kann Weitergabe sein oder Zufall.
 *  - Sonst (nur eigene ältere): eine davon freigegeben ODER als Doppel
 *    abgelehnt (DOPPEL_GRUENDE — das Produkt war für diese Person schon
 *    bezahlt) → `wiederverwendet` (ablehnen); eine davon noch offen →
 *    `aeltere_offen` (halten, bis sie entschieden ist); nur aus anderen
 *    Gründen abgelehnt → kein Befund. Wer nach einer Ablehnung wegen eines
 *    behebbaren Mangels dieselben Fotos erneut einreicht, korrigiert womöglich
 *    nur (z. B. EAN nachgetragen) und wird normal geprüft. Fotos einer als
 *    Doppel abgelehnten Einreichung eine Woche später noch einmal einzureichen
 *    ist dagegen kein neuer Einkauf (Prüfrunde 02.10.2026).
 *
 * Der Status kommt vom Aufrufer und ist im Lauf nachgezogen (statusJetzt) —
 * eine im selben Lauf abgelehnte ältere Einreichung zählt also als abgelehnt
 * (Lehre vom 13.09.: sonst bleibt das jüngere Geschwister grundlos hängen).
 *
 * @param {string} id
 * @param {Iterable<string>} partner  IDs mit mindestens einem identischen Identitätsfoto (ohne id selbst)
 * @param {(id:string)=>{userId:string|null, createdAt:number|null, status:string, grund?:string|null}|null} info
 *   `grund`: Ablehngrund einer abgelehnten Einreichung (intern, sonst der Code am Dokument)
 * @returns {{art:'wiederverwendet'|'aeltere_offen'|'fremdes_konto', mit:string[]}|null}
 */
function bildBefund(id, partner, info) {
  const ich = info(id);
  if (!ich) return null;
  const frueher = (a, b) => ((a.createdAt ?? 0) - (b.createdAt ?? 0)) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
  const selbst = { id, createdAt: ich.createdAt };
  const aeltere = [];
  for (const p of partner || []) {
    if (p === id) continue;
    const x = info(p);
    if (x && frueher({ id: p, createdAt: x.createdAt }, selbst) < 0) aeltere.push({ id: p, ...x });
  }
  if (!aeltere.length) return null;
  const fremd = aeltere.filter((a) => a.userId !== ich.userId);
  if (fremd.length) return { art: 'fremdes_konto', mit: fremd.map((a) => a.id) };
  const frei = aeltere.filter((a) => a.status === 'approved' || (a.status === 'rejected' && DOPPEL_GRUENDE.has(a.grund)));
  if (frei.length) return { art: 'wiederverwendet', mit: frei.map((a) => a.id) };
  const offenAelter = aeltere.filter((a) => a.status === 'pending');
  if (offenAelter.length) return { art: 'aeltere_offen', mit: offenAelter.map((a) => a.id) };
  return null;
}

/**
 * Letzte Hürden vor jeder Freigabe.
 *  - Preis ist Pflicht (Entscheidung Patrick 26.09.2026). Bis dahin ließ die
 *    Bildprüfung ein Preisfoto ohne Preis ausdrücklich durch — eine Regel, die
 *    ich (Claude) am 24.09. aus den Handrunden übernommen hatte, obwohl Patrick
 *    am 20.09. „preis?" als Prüfpunkt genannt hatte. Gemessen: 30 von 284
 *    Freigaben der Runde hatten keinen Preis im Foto.
 *    Genügt: Preis gelesen ODER auf dem Preisfoto sichtbar (dann fehlt nur die
 *    Lesung, der Datensatz ist vollständig). Scheiterte das Nachlesen an unserer
 *    Technik oder hat die Bildprüfung den Preis nicht beurteilt → offen.
 *    Abgelehnt wird NUR ohne jedes Gegenzeichen: widerspricht eine andere Quelle
 *    der Bildprüfung (der Lesedienst sah ein Preisschild oder einen Kassenbon,
 *    oder eine Nachlesung fand einen Preis, die zweite aber nicht), bleibt der
 *    Fall für einen Menschen liegen. Eine Ablehnung ist endgültig, das Liegen-
 *    lassen kostet nur einen Blick (Gegenprüfung 26.09.).
 *  - Aufnahmeort passt nicht zum Markt → Mensch (kann harmlos sein, etwa Aldi
 *    Süd statt Hofer in Österreich; 3 von 1.973 Freigaben seit 01.09.).
 */
function freigabe(f, audit, extra = {}) {
  if (!f.preisVorhanden && !(audit && audit.preisSichtbar === true)) {
    const rf = f.rettungFehler || {};
    if (rf.preis === 'lesungen_uneinig') return offen('preis_unsicher', { hinweis: 'Nur eine von zwei Nachlesungen fand einen Preis' });
    if (rf.preis || rf.alles) return offen('nachlesen_gescheitert', { hinweis: rf.preis || rf.alles });
    if (!audit || typeof audit.preisSichtbar !== 'boolean') return offen('preis_unbeurteilt');
    if (f.preisHinweis) return offen('preis_unsicher', { hinweis: f.preisHinweis });
    // Abgeschnittene Datei aus dem Android-Upload (26.09.): ist nur der untere
    // Teil weg, sieht jede Lesung „kein Preis" — die Ursache wäre unsere.
    if (f.preisBildDefekt) return offen('bild_defekt', { hinweis: 'Preisfoto beim Hochladen beschädigt' });
    return ablehnen('preis_fehlt');
  }
  // Keine Freigabe ohne die beiden Abgleiche, die sie verhindern könnten
  // (fail-closed für die Freigabe, Entscheidung Patrick 02.10.2026): ob das
  // Konto gesperrt ist, und ob ein Foto schon in einer früheren Einreichung
  // steckt. Scheiterte das Lesen, ist das kein Urteil — der Fall bleibt liegen.
  if (f.kontoSperre === 'unbekannt') return offen('kontosperre_unbekannt');
  if (f.fotoAbgleichFehlt) return offen('foto_abgleich_gescheitert');
  if (f.ortAuffaellig) return offen('ort_auffaellig', { hinweis: f.ortAuffaellig });
  return { entscheidung: 'freigeben', grund: null, ctx: {}, ...extra };
}

/**
 * Name aus zwei Nachlesungen (24.09.2026, Hinweis APP_ORIGINAL). Verlangt
 * wird, dass ein Name LESBAR ist — nicht, dass zwei Lesungen wortgleich sind.
 *  - beide lesen einen Namen → übernehmen (bei Abweichung die kürzere Fassung,
 *    die längere als Alternative merken),
 *  - nur eine liest einen Namen → unsicher → der Fall bleibt offen (kein Urteil),
 *  - keine liest einen Namen → kein Name (darf abgelehnt werden).
 */
function nameAusLesungen(a, b) {
  const lies = (x) => (x && x.sicher !== false ? String(x.name || '').trim() : '');
  const na = lies(a);
  const nb = lies(b);
  if (na && nb) {
    const gleich = normName(na) === normName(nb);
    const kurz = na.length <= nb.length ? na : nb;
    return { name: kurz.slice(0, 120), alternative: gleich ? null : (kurz === na ? nb : na).slice(0, 120) };
  }
  if (na || nb) return { unsicher: true };
  return {};
}

/**
 * Barcode aus zwei Nachlesungen. Hier bleibt es STRENG, weil eine falsche EAN
 * das Produkt falsch zuordnet: übernommen nur bei zweimal gleich + Prüfziffer.
 * Lesen die beiden aber Ziffern, ohne sich zu einigen, ist ein Barcode da und
 * nur schwer lesbar — dann offen statt „kein Barcode" (kein Urteil).
 */
function eanAusLesungen(a, b, pruefzifferOk) {
  const lies = (x) => (x && x.sicher !== false ? String(x.ean || '').replace(/\D/g, '') : '');
  const ea = lies(a);
  const eb = lies(b);
  if (ea && ea === eb && pruefzifferOk(ea)) return { ean: ea };
  if (ea || eb) return { unsicher: true };
  return {};
}

const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9äöüß]/g, '');

/**
 * Nachlese-Fehler eines Falls, den die Runde in ihrer Arbeitszeit nicht mehr
 * erreicht hat. Gilt für ALLE Angaben: nicht nachgelesen ist kein „fehlt"
 * (Name, Barcode) und kein „kein Preis" (Preis-Pflicht) — ein Werkzeugfehler
 * ist nie ein Urteil (gefunden 26.09.2026, greift ab etwa doppeltem
 * Tagesvolumen).
 */
const rettungNichtGeschafft = () => ({ name: 'zeit_abgelaufen', ean: 'zeit_abgelaufen', preis: 'zeit_abgelaufen' });

/**
 * Worauf sich eine Ablehnung stützt, die eine ANDERE Einreichung als Beleg
 * nimmt: die Wochen-Sperre (eigene Freigaben im Fenster) und „Fotos
 * wiederverwendet" (ältere Einreichungen mit demselben Foto). Die Morgenrunde
 * schreibt so eine Ablehnung nur, wenn mindestens einer dieser Belege
 * feststeht — vorher entschieden oder im selben Lauf tatsächlich geschrieben
 * (Prüfrunde 02.10.2026). Sonst: Referenz-Freigabe im Lauf übersprungen,
 * gescheitert oder von der Notbremse zurückgehalten → am Ende wäre keine der
 * Kopien bezahlt.
 * @returns {string[]|null}  IDs der Belege, oder null, wenn die Entscheidung an keinem hängt
 */
function belegeVon(fall) {
  if (!fall || fall.entscheidung !== 'ablehnen') return null;
  if (fall.grund === REASON.SAME_USER_WEEK && fall.dup) return fall.dup.priorIds || (fall.dup.priorId ? [fall.dup.priorId] : []);
  if (fall.grund === 'bilder_wiederverwendet') return (fall.eingabe && fall.eingabe.bild && fall.eingabe.bild.mit) || [];
  return null;
}

function ablehnen(grund, ctx = {}) { return { entscheidung: 'ablehnen', grund, ctx }; }
function offen(grund, ctx = {}) { return { entscheidung: 'offen', grund, ctx }; }

/**
 * Notbremse: kippt das Urteil in einem Lauf ungewöhnlich stark Richtung
 * „ablehnen", werden die betroffenen Ablehnungen NICHT geschrieben, sondern
 * bleiben offen — und der Bericht warnt rot. Freigaben laufen immer weiter:
 * sie sind die harmlose Richtung.
 *
 *  A) Eigene Bremsen (EIGENE_BREMSEN): Preis fehlt, Wochen-Sperre — jede mit
 *     eigener Schwelle, bezogen auf die geprüften Fälle (Preis, beruht auf der
 *     Bildprüfung) bzw. auf alle Fälle des Laufs. Gesperrte Konten brauchen
 *     keine: sie werden nicht abgelehnt, sondern liegen gelassen.
 *  B) Bildprüfung: mehr als `bildMaxAnteil` der geprüften Fälle als unecht
 *     bzw. „dieselbe Ansicht" — dann liegt es eher am Modell als an den
 *     Einreichungen (Handrunden 09.–24.09.: 0–2 %).
 *  C) Gesamt: Ablehnungsquote über dem Doppelten des 30-Tage-Schnitts
 *     (mindestens `gesamtMin` Ablehnungen, damit ein kleiner Tag nicht auslöst).
 *     OHNE die Gründe mit eigener Bremse (AUSSER_GESAMTQUOTE): neue oder
 *     verschärfte Gründe hätten die Quote gegenüber dem alten Schnitt dauerhaft
 *     verschoben und die Bremse jeden Tag ausgelöst (Gegenprüfung 26.09.).
 *     schnittQuote lässt dieselben Gründe weg. Kippt die Gesamtquote, werden
 *     ALLE Ablehnungen des Laufs gehalten, auch die mit eigener Bremse.
 *
 * @param {Array<{entscheidung:string, grund:string|null, audit?:object|null}>} plan (wird verändert)
 * @param {{schnittQuote:number|null, bildMaxAnteil?:number, bildMin?:number, gesamtMin?:number}} opts
 * @returns {{bild:boolean, gesamt:boolean, preis:boolean, woche:boolean, text:string[]}}
 */
function notbremse(plan, { schnittQuote = null, bildMaxAnteil = 0.1, bildMin = 5, gesamtMin = 10 } = {}) {
  const ergebnis = { bild: false, gesamt: false, preis: false, woche: false, text: [] };
  const geprueft = plan.filter((p) => p.audit).length;
  const halten = (liste, grund) => liste.forEach((p) => { p.zurueckgehaltenGrund = p.grund; p.entscheidung = 'offen'; p.grund = grund; });
  const pz = (n, g) => Math.round((100 * n) / g);
  for (const b of EIGENE_BREMSEN) {
    const betroffen = plan.filter((p) => p.entscheidung === 'ablehnen' && b.gruende.includes(p.grund));
    const basis = b.basis === 'geprueft' ? geprueft : plan.length;
    if (betroffen.length >= b.min && basis && betroffen.length / basis > b.anteil) {
      ergebnis[b.schalter] = true;
      ergebnis.text.push(b.text(betroffen.length, basis, pz(betroffen.length, basis)));
      halten(betroffen, b.halten);
    }
  }
  const bildAbgelehnt = plan.filter((p) => p.entscheidung === 'ablehnen' && BILD_GRUENDE.has(p.grund));
  if (bildAbgelehnt.length >= bildMin && geprueft && bildAbgelehnt.length / geprueft > bildMaxAnteil) {
    ergebnis.bild = true;
    ergebnis.text.push(`Bildprüfung hielt ${bildAbgelehnt.length} von ${geprueft} Einreichungen für unpassend (${pz(bildAbgelehnt.length, geprueft)} %) — Ablehnungen aus der Bildprüfung zurückgehalten.`);
    halten(bildAbgelehnt, 'notbremse_bildpruefung');
  }
  const entschieden = plan.filter((p) => (p.entscheidung === 'freigeben' || p.entscheidung === 'ablehnen') && !AUSSER_GESAMTQUOTE.has(p.grund));
  const abgelehnt = entschieden.filter((p) => p.entscheidung === 'ablehnen');
  const quote = entschieden.length ? abgelehnt.length / entschieden.length : 0;
  if (schnittQuote != null && abgelehnt.length >= gesamtMin && quote > 2 * Math.max(schnittQuote, 0.02)) {
    ergebnis.gesamt = true;
    ergebnis.text.push(`Ablehnungsquote ${Math.round(quote * 100)} % statt üblich ${Math.round(schnittQuote * 100)} % — alle Ablehnungen dieses Laufs zurückgehalten.`);
    halten(plan.filter((p) => p.entscheidung === 'ablehnen'), 'notbremse_quote');
  }
  return ergebnis;
}

module.exports = {
  entscheideFall, bildBefund, belegeVon, notbremse, nameAusLesungen, eanAusLesungen, rettungNichtGeschafft,
  BILD_GRUENDE, EIGENE_BREMSEN, AUSSER_GESAMTQUOTE, KONTO_GESPERRT, DOPPEL_GRUENDE,
};
