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
const { PREIS_BILDSCHIRM, preisBildschirmLage, preisBildschirmHinweis, preisBildschirmEintrag } = require('./preisBildschirm');

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
  // Bildschirmfoto als Preisbeleg (Patrick 04.10.2026). Beruht auf der
  // Bildprüfung. Gemessen: seit 26.09. 6 Fälle in 8,5 Tagen bei ~120
  // geprüften am Tag (~0,6 %). Gezählt werden PERSONEN, nicht Fälle
  // (`zaehle: 'personen'`, Prüfrunde 2, 04.10.2026): Bildschirmfotos kommen
  // gebündelt — am 02.10. vier von zwei Personen (drei von einer binnen
  // vier Minuten) bei 126 geprüften; als Fälle gezählt (4, 3,2 %) hätte die
  // Bremse genau dann gegriffen, wenn die Regel richtig lag. Eine
  // geänderte Lesart des Modells trifft dagegen viele Personen.
  // Übernommene Fälle (`vortageGetrennt`, Nachprüfung 06.10.2026, zweimal):
  // ein noch offener Fall, den diese Bremse schon in einem früheren ECHTEN
  // Lauf zurückgehalten hat (`review.rundeOffen.grund` = ihr Halte-Grund,
  // sonst der weitergetragene Merker `notbremseEcht` — von einem Trockenlauf
  // oder einem echten Lauf, in dem der Fall aus anderem Grund offen blieb),
  // zählt für die Frage, OB die Bremse greift, weiter mit — ob er heute
  // erneut „ablehnen" liest (preisBildschirmMitVorbefund), aus anderem Grund
  // offen ist oder gesperrt hält (Abschlussprüfung 06.10.2026: sonst gab eine
  // gescheiterte Bildprüfung bei EINEM Fall die übrigen zur Ablehnung frei).
  // Ohne das gab eine anhaltende Fehllesung mit wenigen neuen
  // Fällen (Tag 2: drei neue Personen) die gestern zurückgehaltenen zur
  // endgültigen Ablehnung frei, ohne jede Warnung. Ob ROT gewarnt wird,
  // entscheiden dagegen nur die frischen Fälle: greift die Bremse nur dank
  // der übernommenen, ist das kein neuer Befund, sondern ein offener —
  // gelbe Zeile „seit … zurückgehalten, in der Konsole entscheiden" statt
  // täglich desselben roten Alarms (der legte den Rückweg
  // `preisBildschirmRegel: 'shadow'` nahe, und der bezahlt alle
  // zurückgehaltenen am Morgen darauf). Greift die Bremse gar nicht mehr
  // (mehr geprüfte Fälle, oder ein Teil wurde in der Konsole entschieden),
  // lehnt die Runde die übernommenen, die heute wieder „ablehnen" lesen, ab,
  // wie in preisBildschirmMitVorbefund vorgesehen — das
  // zählt der Bericht eigens (`notbremse.ausVortagenAbgelehnt`) und meldet
  // es gelb. Ein Trockenlauf zählt nicht als „schon zurückgehalten": er hat
  // nichts zurückgehalten, sein Befund ist im ersten scharfen Lauf neu.
  // Seit 26.09. höchstens 2 Personen je Lauf. Schwelle: mindestens 4 Personen und mehr
  // als 2,5 % der geprüften (vorher 5 und 5 % auf Fälle — das ließ eine
  // Fehllesung im Umfang der e-Bon-Quote, ~4 %, an jedem normalen Tag
  // durch). Die Bremse hält nur zurück, ein Fehlgriff kostet einen Blick.
  // Den häufigsten Modellfehler (e-Bon als „Bildschirm") fängt schon die
  // Regel selbst ab (Lesedienst-Gegenzeichen, preisBildschirm.preisBildschirmBefund)
  // und meldet ihn als Warnung.
  { schalter: 'bildschirm', gruende: [PREIS_BILDSCHIRM], halten: 'notbremse_preis_bildschirm', basis: 'geprueft', min: 4, anteil: 0.025, zaehle: 'personen', vortageGetrennt: true,
    // Seit wann ein übernommener Fall liegt: Befund am Dokument (bleibt über die Tage gleich), sonst der letzte Lauf.
    seit: (ro) => (ro.preisBildschirm && typeof ro.preisBildschirm.seit === 'string' && ro.preisBildschirm.seit) || (typeof ro.lauf === 'string' && ro.lauf) || null,
    // Teilentscheidung (Abschlussprüfung 06.10.2026): wer in der Konsole nur
    // einzelne der zurückgehaltenen entscheidet, nimmt sie aus der Kohorte —
    // reichen die übrigen nicht mehr für die Schwelle, lehnt die Runde sie am
    // Morgen darauf ab, auch wenn die Entscheidung gerade eine Fehllesung
    // bestätigt hat. Ob die Kohorte stattdessen bis zur Konsole liegen bleibt,
    // ist Patricks offene Frage (WISSEN-FOTORUNDE.md, Notbremse) — bis dahin
    // sagen es beide Meldungen vorher.
    text: (n, g, pz, personen, ausVortagen = 0) => `Bei ${n} von ${g} Einreichungen (${personen} Personen, ${pz} %) hielt die Bildprüfung das Preisfoto für ein Bildschirmfoto — diese Ablehnungen zurückgehalten${ausVortagen ? `, dazu ${ausVortagen} schon an einem Vortag zurückgehaltene` : ''}. Sie bleiben liegen, solange die Bremse greift; greift sie an einem späteren Morgen nicht mehr, lehnt die Runde sie ab — vorher in der Konsole ansehen und alle auf einmal entscheiden: wer nur einzelne entscheidet, lässt die übrigen ablehnen, sobald die Bremse ohne die entschiedenen nicht mehr greift.`,
    textVortage: ({ alt, altPersonen, ohneBefund = 0, frisch, frischPersonen, seit }) => `${alt} Bildschirm-Ablehnung${alt === 1 ? '' : 'en'} (${altPersonen} ${altPersonen === 1 ? 'Person' : 'Personen'}) ${alt === 1 ? 'liegt' : 'liegen'} seit ${seit || 'einem früheren Lauf'} bei der Notbremse und ${alt === 1 ? 'ist' : 'sind'} noch nicht entschieden${ohneBefund ? ` — davon ${ohneBefund} heute aus anderem Grund offen (etwa Bildprüfung gescheitert oder anders gelesen), ${ohneBefund === 1 ? 'zählt' : 'zählen'} weiter mit` : ''}${frisch ? ` — heute ${frisch} neue (${frischPersonen} ${frischPersonen === 1 ? 'Person' : 'Personen'}) mitgehalten` : ''}. In der Konsole entscheiden, und zwar alle auf einmal (Grund „Notbremse (Bildschirmfoto als Preis)"): wer nur einzelne entscheidet, lässt die übrigen ablehnen, sobald die Bremse ohne die entschiedenen nicht mehr greift. Die Regel auf Beobachtung zu stellen, bezahlt sie am Morgen darauf.`,
    textAbgelehnt: (n, trocken) => `${n} Bildschirm-Ablehnung${n === 1 ? '' : 'en'}, die die Notbremse an einem Vortag zurückgehalten hatte, ${trocken ? 'würde ein scharfer Lauf heute ablehnen' : 'heute abgelehnt'} — die Bremse griff nicht mehr (mehr geprüfte Einreichungen als an dem Morgen, oder ein Teil wurde inzwischen in der Konsole entschieden). Falls das Modell falsch las: in der Konsole öffnen und zurückholen.` },
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
 * @param {{art:'wiederverwendet'|'aeltere_offen'|'fremdes_konto', mit:string[], seit?:string|null, vorbefund?:object, heute?:string|null}|null} [f.bild]  bildBefund / bildMitVorbefund
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
 * @param {{modus:false|'shadow'|true, belegModus:false|'shadow'|true, quelle:string|null, grund?:string|null, merkmal:boolean|null, lesedienstBon?:boolean, kopfGescheitert?:boolean, belegGrund?:string|null, befund:'ablehnen'|'halten'|null, vorbefund?:{befund:string, seit:string|null, regeln:string[]}, ablehnenGesperrt?:boolean}|null} [f.preisBildschirm]
 *   Bildschirmfoto bzw. Preisbeleg als Preisfoto (src/preisBildschirm.js), `modus` = Schalter der Bildschirm-Regel,
 *   `belegModus` = Schalter des Preisbelegs — null, wenn beide aus sind oder weder eine Bildprüfung noch ein scharfer Befund eines früheren Laufs vorliegt
 * @returns {{entscheidung:'freigeben'|'ablehnen'|'offen', grund:string|null, ctx:object, loseWare?:boolean, preisBildschirmFall?:{befund:string, ohneRegel:string, wirkt:boolean, regeln:string[], kopf?:boolean, vor?:string[], vorWirkt?:string[], vorbefund?:boolean}}}
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
  // `zweifelhaft` (falsche Prüfziffer, weit weg) kommt nach der zweiten Lesung
  // nicht mehr vor — falls doch, hält es wie `unsicher` (fail-closed).
  if (f.eanFoto && (f.eanFoto.art === 'unsicher' || f.eanFoto.art === 'zweifelhaft')) {
    return offen('ean_unsicher', { hinweis: f.eanFotoHinweis || `Barcode-Foto: erste Lesung ${f.eanFoto.gelesen || f.eanFoto.roh || 'ungültig'}, zweite ${f.eanFoto.zweit || 'nicht lesbar'}, gespeichert ist ${f.eanFoto.gespeichert}` });
  }

  // Doppel-Regel (Konsolen-Regel, gleiche Datei wie dort). Seit der
  // Wochen-Regel (02.10.2026) hängt die Sperre an nichts als Person, EAN und
  // Zeit — kein Preis, kein Hersteller, kein Markt. Ein gescheitertes
  // Nachlesen des Preises ändert an ihr deshalb nichts mehr.
  if (dup.verdict === 'locked') return ablehnen(dup.reason || REASON.SAME_USER_WEEK, { lockUntil: dup.lockUntil });
  if (dup.verdict === 'hold') return offen(PENDING_OLDER);

  // Identisches Identitätsfoto in einer FRÜHEREN Einreichung (Abgleich gegen
  // alle, Entscheidung Patrick 02.10.2026). Die älteste Einreichung einer
  // Gruppe trägt nie einen Befund (bildBefund). Ein aus einem früheren Lauf
  // übernommener Befund (bildMitVorbefund, `vorbefund`) hält nur an — er wird
  // nie zur Ablehnung, denn heute ließ er sich nicht nachprüfen.
  const bild = f.bild || null;
  if (bild && bild.vorbefund && BILD_CODE[bild.art]) return offen(BILD_CODE[bild.art], { hinweis: vorbefundHinweis(bild) });
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
  if (audit.gleicheAnsicht && audit.traegtAngaben !== false) {
    // Preisfoto beim Hochladen beschädigt (unser Fehler) und kein Preis: nicht
    // über „dieselbe Ansicht" ablehnen, sondern liegen lassen wie im
    // Preis-Pfad (Nachprüfung 06.10.2026 — ein unbrauchbares Preisfoto hieß
    // mit der Preisbeleg-Anweisung in 2 von 4 Lesungen „dieselbe Ansicht").
    // Sonst bleibt der Grund: die echten Fälle (3 von 3 seit 20.09.) hatten
    // alle keinen Preis, und ihr App-Text nennt alle fehlenden Ansichten.
    if (f.preisBildDefekt && !f.preisVorhanden && audit.preisSichtbar !== true) return offen('bild_defekt', { hinweis: 'Preisfoto beim Hochladen beschädigt' });
    return ablehnen('gleiche_ansicht_mehrfach', { hinweis: audit.grund });
  }
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
 *  - Eine als Doppel abgelehnte ältere zählt nur, wenn das Produkt für diese
 *    Person WIRKLICH bezahlt ist: `freigabeVon(uid, ean)` meldet eine
 *    freigegebene Einreichung derselben Person und EAN (Prüfrunde 2,
 *    02.10.2026). `doppelt_eingereicht` wurde auch schon vergeben, ohne dass
 *    je eine Kopie freigegeben war (Vorfall 10.09.: alle Kopien abgelehnt) —
 *    dann lehnte der Befund auch die nächste Einreichung mit diesen Fotos ab,
 *    und keine bliebe bezahlt. Ohne `freigabeVon` zählt keine (im Bestand
 *    02.10.: 0 von 21 Befunden stützten sich allein darauf).
 *
 * Der Status kommt vom Aufrufer und ist im Lauf nachgezogen (statusJetzt) —
 * eine im selben Lauf abgelehnte ältere Einreichung zählt also als abgelehnt
 * (Lehre vom 13.09.: sonst bleibt das jüngere Geschwister grundlos hängen).
 *
 * @param {string} id
 * @param {Iterable<string>} partner  IDs mit mindestens einem identischen Identitätsfoto (ohne id selbst)
 * @param {(id:string)=>{userId:string|null, createdAt:number|null, status:string, grund?:string|null, ean?:string|null}|null} info
 *   `grund`: Ablehngrund einer abgelehnten Einreichung (intern, sonst der Code am Dokument)
 * @param {(uid:string|null, ean:string|null)=>boolean} [freigabeVon]  gibt es eine freigegebene Einreichung dieser Person mit dieser EAN?
 * @returns {{art:'wiederverwendet'|'aeltere_offen'|'fremdes_konto', mit:string[]}|null}
 */
function bildBefund(id, partner, info, freigabeVon = null) {
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
  const bezahlt = (a) => !!(freigabeVon && a.ean && freigabeVon(a.userId, a.ean));
  const frei = aeltere.filter((a) => a.status === 'approved' || (a.status === 'rejected' && DOPPEL_GRUENDE.has(a.grund) && bezahlt(a)));
  if (frei.length) return { art: 'wiederverwendet', mit: frei.map((a) => a.id) };
  const offenAelter = aeltere.filter((a) => a.status === 'pending');
  if (offenAelter.length) return { art: 'aeltere_offen', mit: offenAelter.map((a) => a.id) };
  return null;
}

/** Rangfolge der Foto-Befunde — wie in bildBefund: fremdes Konto vor eigener bezahlter vor eigener offener. */
const BILD_RANG = Object.freeze(['fremdes_konto', 'wiederverwendet', 'aeltere_offen']);
const bildRang = (art) => { const i = BILD_RANG.indexOf(art); return i < 0 ? BILD_RANG.length : i; };

/**
 * Foto-Befund eines FRÜHEREN Laufs aus `review.rundeOffen.sperrend`
 * (Schlussprüfung 03.10.2026) — der stärkste nach BILD_RANG. `seit`: Lauf, in
 * dem der Befund zuerst stand (`fotoSeit`, sonst der Lauf des Eintrags).
 * @returns {{art:string, seit:string|null}|null}
 */
function fotoVorbefund(x) {
  const ro = x && x.review && typeof x.review === 'object' && x.review.rundeOffen && typeof x.review.rundeOffen === 'object' ? x.review.rundeOffen : null;
  if (!ro || !Array.isArray(ro.sperrend)) return null;
  const art = BILD_RANG.find((a) => ro.sperrend.includes(BILD_CODE[a]));
  if (!art) return null;
  const lauf = (v) => (typeof v === 'string' && v ? v.slice(0, 40) : null);
  return { art, seit: lauf(ro.fotoSeit) || lauf(ro.lauf) };
}

/**
 * Heutiger Foto-Befund (bildBefund) mit dem eines früheren Laufs
 * (fotoVorbefund) verbinden — Schlussprüfung 03.10.2026, analog
 * werte.eanFotoMitVorbefund.
 *
 *  - Heute KEIN vollständiger Abgleich möglich (Storage-Liste gescheitert, ein
 *    Identitätsfoto nicht abrufbar oder ohne md5): der frühere Befund gilt
 *    weiter. Bis dahin verschwand ein Halt dann aus `review.rundeOffen`, die
 *    Konsole zeigte den Fall als „ok", und F gab ihn ohne Notiz frei — ein
 *    Technikausfall hob den Halt auf.
 *  - `fremdes_konto` gilt IMMER weiter, bis ein Mensch in der Konsole
 *    entscheidet (jede Entscheidung dort ersetzt `review` und nimmt den
 *    Eintrag mit). Die md5-Grundlage kann sich ändern: der Eigentümer darf
 *    seine Dateien in `crowduploads/` überschreiben (storage.rules) — wer zwei
 *    Konten hat, überschriebe das Original im anderen Konto, und der Halt wäre
 *    am nächsten Morgen weg.
 *  - Sonst (vollständig berechnet) gilt der heutige Befund: `aeltere_offen`
 *    löst sich auf, sobald die ältere Einreichung entschieden ist.
 * Ist der heutige Befund mindestens so stark (BILD_RANG), gilt er — mit `seit`
 * des früheren, wenn es derselbe ist. Übernommen → `vorbefund`; `heute` nennt,
 * was heute (ggf. unvollständig) gefunden wurde. `mit` bleibt leer: die IDs
 * stehen nur im Tagesbericht des Laufs `seit` (Datenschutz, siehe rundeOffenEintrag).
 *
 * @param {object|null} heute  bildBefund
 * @param {{art:string, seit:string|null}|null} vorher  fotoVorbefund
 * @param {{vollstaendig:boolean}} opts
 */
function bildMitVorbefund(heute, vorher, { vollstaendig } = {}) {
  if (!vorher) return heute;
  const uebernehmen = vorher.art === 'fremdes_konto' || !vollstaendig;
  if (heute && (!uebernehmen || bildRang(heute.art) <= bildRang(vorher.art))) {
    return heute.art === vorher.art ? { ...heute, seit: vorher.seit } : heute;
  }
  if (!uebernehmen) return heute;
  return {
    art: vorher.art, mit: [], seit: vorher.seit,
    vorbefund: { grund: vorher.art === 'fremdes_konto' ? 'bis_zur_entscheidung' : 'heute_nicht_pruefbar' },
    heute: heute ? heute.art : null,
  };
}

const BILD_TEXT = {
  fremdes_konto: 'Gleiches Foto bei einem anderen Konto (welche Einreichung, steht im Tagesbericht dieses Laufs)',
  wiederverwendet: 'Gleiches Foto in einer bezahlten eigenen Einreichung',
  aeltere_offen: 'Gleiches Foto in einer älteren, noch offenen eigenen Einreichung',
};
/** Hinweis zu einem übernommenen Foto-Befund — OHNE IDs (er landet auch am Dokument, rundeOffenEintrag). */
function vorbefundHinweis(bild) {
  const warum = bild.vorbefund.grund === 'bis_zur_entscheidung' ? 'gilt bis zur Entscheidung in der Konsole' : 'heute nicht nachprüfbar (Foto-Abgleich unvollständig)';
  const heute = bild.heute && bild.heute !== bild.art ? `; heute: ${BILD_CODE[bild.heute]}` : '';
  return `${BILD_TEXT[bild.art]} — Befund vom ${bild.seit || 'früheren Lauf'}, ${warum}${heute}`;
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
 *  - Bildschirmfoto als Preisbeleg (04.10.2026) — über dem Ergebnis der
 *    übrigen Hürden, siehe unten und src/preisBildschirm.js. Dieselbe
 *    Mechanik trägt den Preisbeleg „Kassenbon" (ohne Kassenbon-Merkmale,
 *    fremder Händler; Entscheidung Claude im Auftrag Patricks 04.10.2026):
 *    nur „halten", Grund `preis_beleg_unsicher`. Jede der beiden Regeln wirkt
 *    nur unter IHREM Schalter (`preisBildschirmRegel` bzw. `preisBelegRegel`,
 *    preisBildschirm.preisBildschirmLage — Nachprüfung 05.10.2026).
 */
function freigabe(f, audit, extra = {}) {
  const e = freigabeOhneBildschirm(f, audit, extra);
  // Bildschirmfoto als Preisbeleg (Patrick 04.10.2026: „ja, bau das" — erst
  // eine Woche beobachten, dann ablehnen). Bewusst HIER und nach der
  // Preis-Prüfung ausgewertet: bei 36 von 37 Bildschirmfotos der Vor-Analyse
  // hatte der Lesedienst einen Preis gelesen, die Preis-Pflicht war also
  // erfüllt — die Regel muss greifen, BEVOR dieser Preis zur Freigabe führt.
  //  - Beobachtung ('shadow'): Entscheidung unverändert, der Befund reist mit
  //    (`preisBildschirmFall`) — für den Bericht (am Dokument nur, wenn der
  //    Fall aus anderem Grund offen bleibt: review.rundeOffen).
  //  - Scharf (true): `ablehnen` → Ablehnung (am Dokument `fotos_unpassend`,
  //    duplicatePolicy.APP_GRUND), auch statt „Preis fehlt" und statt eines
  //    sonst offenen Falls (Ort auffällig, Preis unsicher …) — der genauere
  //    Grund, und er hängt an keinem dieser Abgleiche. Sah der Lesedienst
  //    einen Kassenbon — auch nur in einer ungeeinten Nachlesung dieses
  //    Laufs — oder hat er das Preisfoto gar nicht gelesen (Erst- und
  //    Nachlesung gescheitert), kommt es gar nicht erst zu `ablehnen`
  //    (preisBildschirmBefund, Prüfrunde 3): ein `nachlesen_gescheitert`
  //    wird so nie durch eine Ablehnung ersetzt, die an EINER Modellantwort
  //    hängt. `halten` → nur eine sonst fällige FREIGABE wird
  //    zum offenen Fall; eine Ablehnung (Preis fehlt) oder ein schon offener
  //    Fall bleibt, wie er ist — der Befund steht trotzdem in review.rundeOffen.
  // Zwei Regeln, zwei Schalter (Nachprüfung 05.10.2026): beobachtet wird jede
  // Regel, deren Schalter nicht aus ist; WIRKEN darf nur eine Regel mit
  // scharfem Schalter — auch ein Befund eines früheren Laufs hält nur unter
  // dem Schalter seiner eigenen Regel (preisBildschirmLage). `wirkt` sagt dem
  // Bericht, ob der Befund heute etwas geändert hat.
  // Für den Bericht je Regel (preisBildschirm.preisBildschirmZaehlart,
  // Nachprüfung 05.10.2026): `regeln`/`kopf` = was beobachtet den Fall trägt,
  // `vor` = davon aus einem früheren scharfen Lauf, `vorWirkt` = Regeln, deren
  // früherer Befund heute WIRKT; `vorbefund` auch bei einer von der Notbremse
  // zurückgehaltenen Ablehnung, die heute erneut „ablehnen" liest.
  const pb = f.preisBildschirm || null;
  const beob = preisBildschirmLage(pb);
  if (!beob.befund) return e;
  const wirkt = preisBildschirmLage(pb, { scharf: true });
  const fallDazu = (x) => ({
    ...x,
    preisBildschirmFall: {
      befund: beob.befund, ohneRegel: e.entscheidung, wirkt: !!wirkt.befund,
      regeln: beob.regeln, ...(beob.kopf ? { kopf: true } : {}),
      ...(beob.vorRegeln.length ? { vor: beob.vorRegeln } : {}),
      ...(wirkt.vorRegeln.length ? { vorWirkt: wirkt.vorRegeln } : {}),
      ...(pb.vorbefund || pb.vorbefundSeit ? { vorbefund: true } : {}),
    },
  });
  if (!wirkt.befund) return fallDazu(e);
  const hinweis = preisBildschirmHinweis(pb);
  if (wirkt.befund === 'ablehnen') return fallDazu(ablehnen(PREIS_BILDSCHIRM, { hinweis }));
  return fallDazu(e.entscheidung === 'freigeben' ? offen(wirkt.grund, { hinweis }) : e);
}

function freigabeOhneBildschirm(f, audit, extra = {}) {
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

/**
 * Befunde der Runde, die die Prüfkonsole ohne Übersteuerung (force + Notiz)
 * NICHT freigeben lässt (Prüfrunde 2, 02.10.2026). Die Konsole selbst kennt
 * weder den Foto-Abgleich (md5 gegen alle früheren Einreichungen) noch die
 * zweite Barcode-Lesung — ohne diesen Weg stand ein Fall, den die Runde wegen
 * eines Fotos eines ANDEREN Kontos liegen ließ, in der Konsole als „ok" mit
 * Freigabe-Taste da.
 */
const RUNDE_SPERREND = Object.freeze(['foto_fremdes_konto', 'foto_aeltere_offen', 'bilder_wiederverwendet', 'ean_abweichend', 'ean_unsicher']);
const BILD_CODE = { fremdes_konto: 'foto_fremdes_konto', aeltere_offen: 'foto_aeltere_offen', wiederverwendet: 'bilder_wiederverwendet' };

/**
 * Sperrende Befunde aus den Eingaben eines Falls — aus den TATSACHEN, nicht
 * aus dem gewählten Grund: entscheideFall nennt nur den ersten Grund (eine
 * Barcode-Abweichung geht dem Foto-Befund vor, eine ältere offene Einreichung
 * derselben EAN beiden), die Konsole soll aber jeden sehen.
 */
function rundeBefunde(eingabe) {
  const e = eingabe || {};
  const out = [];
  if (e.bild && BILD_CODE[e.bild.art]) out.push(BILD_CODE[e.bild.art]);
  // Übernommener Befund (bildMitVorbefund): auch, was heute gefunden wurde.
  if (e.bild && e.bild.heute && BILD_CODE[e.bild.heute] && !out.includes(BILD_CODE[e.bild.heute])) out.push(BILD_CODE[e.bild.heute]);
  const ef = e.eanFoto;
  if (ef && ef.art === 'abweichend') out.push('ean_abweichend');
  else if (ef && (ef.art === 'unsicher' || ef.art === 'zweifelhaft')) out.push('ean_unsicher');
  return out;
}

/**
 * Was die Runde an einer Einreichung hinterlässt, die NACH dem Lauf offen ist
 * (`review.rundeOffen`, nur vom Server geschrieben — `review` steht in der
 * Sperrliste von firestore.rules; die App liest das Feld nicht). Bewusst NICHT
 * `holdReasons`: die zeigt die App bei offenen Fällen als „Zurückgestellt".
 *
 *  - `grund`/`hinweis`/`zurueckgehalten`: warum die Runde nicht entschieden
 *    hat — Anzeige in der Konsole.
 *  - `sperrend`: Befunde aus RUNDE_SPERREND — daraus leitet die Konsole das
 *    Urteil `hold` ab (Freigabe nur mit force + Notiz). Die Foto-Befunde
 *    darunter übernimmt der nächste Lauf, wo er sie nicht vollständig
 *    nachrechnen kann, `foto_fremdes_konto` immer (fotoVorbefund/bildMitVorbefund).
 *  - `fotoSeit`: Lauf, seit dem der Foto-Befund steht (nur mit Foto-Befund).
 *  - `eanFoto`: Halte-Befund der Barcode-Nummer als Rückfall für die nächste
 *    Runde, falls `eanFotoOcr` nicht gespeichert werden konnte (eanFotoVorbefund).
 *  - `preisBildschirm`: Befund der Bildschirm-Regel bzw. des Preisbelegs
 *    `{modus, befund, seit, regeln?, art?, ablehnenGesperrt?, gesperrtSeit?}`
 *    (src/preisBildschirm.js) — Hinweis in der Konsole, und ein scharfer
 *    Befund gilt im nächsten Lauf weiter, je Regel unter deren Schalter
 *    (preisBildschirmVorbefund). Hat eine scharfe Regel den Fall einmal
 *    angehalten, steht dazu die Sperre gegen eine automatische Ablehnung —
 *    auch allein, ohne Befund (Nachprüfung 06.10.2026). Keine Sperre für die
 *    Konsole: sie gibt ohne Notiz frei, wer hinsieht, entscheidet.
 *  - `notbremseEcht`: Halte-Grund einer Notbremse mit `vortageGetrennt`, die
 *    den Fall in einem früheren ECHTEN Lauf zurückgehalten hatte — solange
 *    der Fall offen bleibt, in jedem Lauf, dessen `grund` ihn nicht selbst
 *    trägt: im Trockenlauf immer, im echten Lauf, wenn der Fall heute aus
 *    anderem Grund offen ist (Bildprüfung gescheitert, Zeitgrenze, gesperrt
 *    gehalten). Ohne den Merker gälte der Fall im nächsten scharfen Lauf als
 *    frisch (rote statt gelber Warnung; notbremse, Nachprüfung 06.10.2026) —
 *    bzw. zählte gar nicht mehr für die Kohorte der Bremse, und ein
 *    Technikfehler gab die übrigen zur Ablehnung frei (Abschlussprüfung
 *    06.10.2026). Ein Halt nur im Trockenlauf setzt ihn nie.
 *  - `preisBildschirmGemeldet` (nur im Trockenlauf): Lauf, in dem ein echter
 *    Lauf den Preis-Befund dieses Falls schon gemeldet hat
 *    (preisBildschirmGemeldet) — damit ein Trockenlauf nach einem echten
 *    Lauf keine Wiederholung der Warnungen auslöst, ein Trockenlauf vor der
 *    Morgenrunde sie aber auch nicht verschluckt.
 *  - Im Trockenlauf (`trocken`) bleibt auch ein geplanter Entscheid offen —
 *    `geplant` sagt, was die Runde getan hätte. Eine geplante Freigabe ohne
 *    sperrenden Befund hinterlässt nichts — außer der Fall trägt die Sperre
 *    gegen eine Ablehnung: scharf wäre er jetzt bezahlt, als Trockenlauf
 *    bleibt er liegen, und ohne die Sperre könnte ihn der nächste scharfe
 *    Lauf auf eine einzige „bildschirm"-Lesung hin ablehnen.
 * Gesperrte Konten bekommen nichts (sie liegen stumm, die Konsole liest die
 * Sperre selbst). null = nichts zu hinterlassen (ein alter Eintrag wird entfernt).
 *
 * DATENSCHUTZ: das Dokument darf der Einreicher selbst lesen (firestore.rules,
 * `crowd_uploads` read für den Eigentümer). Die IDs der Einreichungen eines
 * ANDEREN Kontos (sie beginnen mit dessen uid) stehen deshalb NICHT hier,
 * sondern nur im Tagesbericht (`wartetAufDich`, nur für Admins) — sonst
 * erführe jemand die Kennung eines fremden Kontos und zugleich, dass wir
 * Fotos kontenübergreifend vergleichen (vgl. kontoSperre: eine Sperre, die der
 * Betroffene sieht, lädt zum Ausweichen ein).
 */
function rundeOffenEintrag(p, { lauf, trocken = false } = {}) {
  if (!p || p.grund === KONTO_GESPERRT) return null;
  const sperrend = rundeBefunde(p.eingabe);
  const pbEintrag = p.eingabe ? preisBildschirmEintrag(p.eingabe.preisBildschirm, { lauf }) : null;
  const pbSperre = !!(trocken && pbEintrag && pbEintrag.ablehnenGesperrt === true);
  if (p.entscheidung === 'freigeben' && !sperrend.length && !pbSperre) return null;
  const ef = p.eingabe && p.eingabe.eanFoto;
  const eanHalt = ef && (ef.art === 'abweichend' || ef.art === 'unsicher' || ef.art === 'zweifelhaft');
  const bild = p.eingabe && p.eingabe.bild;
  const fremd = p.grund === 'foto_fremdes_konto' ? ((bild && bild.mit) || []).length : 0;
  // Ein übernommener Befund trägt keine IDs; sein Hinweis darf ans Dokument.
  const hinweis = p.grund === 'foto_fremdes_konto' && !(bild && bild.vorbefund)
    ? `Gleiches Foto bei ${fremd || 'einer'} Einreichung${fremd === 1 || !fremd ? '' : 'en'} eines anderen Kontos — welche, steht im Tagesbericht`
    : (p.ctx && p.ctx.hinweis) ? String(p.ctx.hinweis).slice(0, 300) : null;
  // Merker eines echten Notbremse-Halts weitertragen, solange der Fall offen
  // bleibt — außer ein echter Lauf hält ihn heute selbst mit demselben Grund
  // (dann ist der Grund der Merker). Siehe echtVonBremse.
  const vorher = rundeOffenVon(p);
  const echt = echtVonBremse(vorher);
  const merker = echt && (trocken || p.grund !== echt) ? echt : null;
  // Schon in einem echten Lauf gemeldeter Preis-Befund: nur ein Trockenlauf
  // trägt das weiter (ein echter Eintrag mit Befund ist selbst der Beleg).
  const gemeldet = trocken ? preisBildschirmGemeldet(vorher) : null;
  return {
    grund: p.grund || null,
    ...(p.entscheidung !== 'offen' ? { geplant: p.entscheidung } : {}),
    hinweis,
    zurueckgehalten: p.zurueckgehaltenGrund || null,
    sperrend,
    // Seit welchem Lauf der Foto-Befund steht — der nächste Lauf übernimmt ihn
    // damit (fotoVorbefund), auch wenn der Eintrag täglich neu geschrieben wird.
    ...(bild && BILD_CODE[bild.art] ? { fotoSeit: bild.seit || lauf || null } : {}),
    eanFoto: eanHalt ? {
      befund: ef.art === 'abweichend' ? 'abweichend' : 'unsicher', ean: ef.gelesen || ef.roh || null,
      ...(ef.art === 'abweichend' ? { bestaetigt: ef.bestaetigt === true } : { zweit: ef.zweit || null }),
    } : null,
    // Bildschirmfoto als Preisbeleg (04.10.2026) — nur mit Befund oder
    // Sperre, und nur Modus, Befund, `seit`, die tragenden Regeln und die
    // Sperre gegen eine Ablehnung (preisBildschirm.preisBildschirmEintrag:
    // was das Urteil trägt, steht nur im Tagesbericht). Die Konsole zeigt aus
    // einem Befund einen Hinweis (einreichung.precheckOf), der nächste Lauf
    // übernimmt einen scharfen Befund je Regel und die Sperre
    // (preisBildschirmVorbefund).
    ...(pbEintrag ? { preisBildschirm: pbEintrag } : {}),
    ...(merker ? { notbremseEcht: merker } : {}),
    ...(gemeldet ? { preisBildschirmGemeldet: gemeldet } : {}),
    lauf: lauf || null,
    trocken: !!trocken,
  };
}

function ablehnen(grund, ctx = {}) { return { entscheidung: 'ablehnen', grund, ctx }; }
function offen(grund, ctx = {}) { return { entscheidung: 'offen', grund, ctx }; }

/** Halte-Gründe der Bremsen, deren übernommene Fälle getrennt zählen (`vortageGetrennt`). */
const VORTAGE_HALTEGRUENDE = new Set(EIGENE_BREMSEN.filter((b) => b.vortageGetrennt).map((b) => b.halten));
/**
 * Halte-Grund einer solchen Bremse, die den Fall in einem ECHTEN Lauf
 * zurückgehalten hat — aus einem echten Eintrag (`grund`) oder aus dem
 * weitergetragenen Merker (`notbremseEcht`, rundeOffenEintrag): von einem
 * Trockenlauf, oder von einem echten Lauf, in dem der Fall aus ANDEREM Grund
 * offen blieb (Bildprüfung gescheitert, gesperrt gehalten — Abschlussprüfung
 * 06.10.2026: vorher ging der Merker an so einem Morgen verloren).
 */
function echtVonBremse(r) {
  if (!r) return null;
  const ok = (g) => (typeof g === 'string' && VORTAGE_HALTEGRUENDE.has(g) ? g : null);
  return (r.trocken !== true && ok(r.grund)) || ok(r.notbremseEcht);
}

/**
 * Lauf, in dem ein ECHTER Lauf den Befund der Bildschirm-Regel bzw. des
 * Preisbelegs an diesem Fall schon gemeldet hat (`review.rundeOffen`) — sonst
 * null. Ein echter Eintrag mit Befund zählt selbst; ein Trockenlauf nur über
 * den weitergetragenen Merker `preisBildschirmGemeldet` (rundeOffenEintrag).
 *
 * Abschlussprüfung 06.10.2026: ein manueller Trockenlauf schreibt den Eintrag
 * am Dokument, aber nie `ops_tagesberichte/aktuell` (den Morgen-Chat). Galt
 * sein Eintrag als „schon gemeldet", zählte die Morgenrunde danach dieselben
 * Fälle nur „aus Vortagen" — und die Widerspruchs-Warnungen (e-Bon als
 * „Bildschirm", „Kassenbon" ohne Lesedienst-Bon) sowie „hält viele" fehlten
 * im Morgen-Chat, ausgerechnet nach einem Kontroll-Trockenlauf nach einem
 * Deploy. Nur für den Bericht — entschieden wird mit dem Befund wie bisher.
 */
function preisBildschirmGemeldet(r) {
  if (!r || typeof r !== 'object') return null;
  const s = (v) => (typeof v === 'string' && v ? v.slice(0, 40) : null);
  if (r.trocken !== true) return r.preisBildschirm && typeof r.preisBildschirm === 'object' && r.preisBildschirm.befund ? (s(r.lauf) || 'frueherer_lauf') : null;
  return s(r.preisBildschirmGemeldet);
}
/** Hat diese Bremse den Fall schon in einem früheren ECHTEN Lauf zurückgehalten? (`review.rundeOffen`, rundeOffenEintrag) */
function schonZurueckgehalten(p, b) {
  return echtVonBremse(rundeOffenVon(p)) === b.halten;
}
function rundeOffenVon(p) {
  const r = p && p.x && p.x.review && typeof p.x.review === 'object' ? p.x.review.rundeOffen : null;
  return r && typeof r === 'object' ? r : null;
}

/**
 * Notbremse: kippt das Urteil in einem Lauf ungewöhnlich stark Richtung
 * „ablehnen", werden die betroffenen Ablehnungen NICHT geschrieben, sondern
 * bleiben offen — und der Bericht warnt rot. Freigaben laufen immer weiter:
 * sie sind die harmlose Richtung.
 *
 *  A) Eigene Bremsen (EIGENE_BREMSEN): Preis fehlt, Wochen-Sperre,
 *     Bildschirmfoto als Preisbeleg — jede mit eigener Schwelle, bezogen auf
 *     die geprüften Fälle (Preis und Bildschirm beruhen auf der Bildprüfung)
 *     bzw. auf alle Fälle des Laufs. Gesperrte Konten brauchen
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
 *  Übernommene Fälle (`vortageGetrennt`, nur Bildschirm-Bremse, Nachprüfung
 *  06.10.2026): ob die Bremse greift, zählen frische Ablehnungen UND alle
 *  noch offenen Fälle, die sie an einem Vortag zurückgehalten hat (die
 *  Kohorte — auch die, die heute aus anderem Grund offen sind oder gesperrt
 *  halten, Abschlussprüfung 06.10.2026); rot gewarnt wird nur, wenn die
 *  frischen allein greifen würden — sonst eine gelbe Zeile (`gelb`). Greift
 *  sie nicht, bleiben die übernommenen Ablehnungen stehen und werden gezählt
 *  (`ausVortagenAbgelehnt`, Fall-Merker `ausVortagAbgelehnt`). Das geht nur
 *  noch über mehr geprüfte Fälle oder eine Teilentscheidung in der Konsole
 *  (offene Frage an Patrick, WISSEN-FOTORUNDE.md).
 *
 * @param {Array<{entscheidung:string, grund:string|null, audit?:object|null}>} plan (wird verändert)
 * @param {{schnittQuote:number|null, bildMaxAnteil?:number, bildMin?:number, gesamtMin?:number}} opts
 * @returns {{bild:boolean, gesamt:boolean, preis:boolean, woche:boolean, bildschirm:boolean, text:string[], gelb:Array<{code:string, text:string}>, ausVortagen?:Object<string,number>, ausVortagenAbgelehnt?:Object<string,number>}}
 *   `bildschirm` usw.: die Bremse greift (rot ODER gelb gemeldet) — bei der
 *   Bildschirm-Bremse auch, wenn heute nur die Kohorte aus Vortagen offen ist
 *   und nichts Neues zurückzuhalten war;
 *   `text`: rote Warnungen; `gelb`: gelbe (Bremse greift nur dank übernommener Fälle);
 *   `ausVortagen`: je Bremse mit `vortageGetrennt` die noch offenen Fälle aus Vortagen
 *   (Kohorte, auch die heute aus anderem Grund offenen), wenn die Bremse greift;
 *   `ausVortagenAbgelehnt`: dieselben, wenn die Bremse nicht mehr greift und sie
 *   nach diesem Schritt noch abgelehnt werden (geplant — geschrieben zählt die Runde)
 */
function notbremse(plan, { schnittQuote = null, bildMaxAnteil = 0.1, bildMin = 5, gesamtMin = 10 } = {}) {
  const ergebnis = { bild: false, gesamt: false, preis: false, woche: false, bildschirm: false, text: [], gelb: [] };
  const geprueft = plan.filter((p) => p.audit).length;
  const halten = (liste, grund) => liste.forEach((p) => { p.zurueckgehaltenGrund = p.grund; p.entscheidung = 'offen'; p.grund = grund; });
  const pz = (n, g) => Math.round((100 * n) / g);
  // `zaehle: 'personen'`: verschiedene Konten statt Fälle. Ohne Konto zählt
  // ein Fall als eigene Person (die strengere Richtung).
  const personenVon = (liste) => new Set(liste.map((p) => (p.x && p.x.userId) || `ohne_konto_${p.id || plan.indexOf(p)}`)).size;
  for (const b of EIGENE_BREMSEN) {
    const betroffen = plan.filter((p) => p.entscheidung === 'ablehnen' && b.gruende.includes(p.grund));
    // `vortageGetrennt`: die Kohorte = alle noch offenen Fälle, die diese
    // Bremse in einem früheren echten Lauf zurückgehalten hat (Eintrag am
    // Dokument) — ob sie heute wieder „ablehnen" lesen, aus anderem Grund
    // offen sind (Bildprüfung gescheitert, Zeitgrenze) oder gesperrt halten
    // (heute anders gelesen). Zählt mit für das Ob, nicht für die Farbe der
    // Warnung (siehe EIGENE_BREMSEN). Zurückgehalten werden nur die heutigen
    // Ablehnungen. Abschlussprüfung 06.10.2026: zählten nur die, die heute
    // „ablehnen" lasen, fiel ein Fall mit gescheiterter Bildprüfung aus der
    // Zählung — und ein Technikfehler gab die übrigen zur endgültigen
    // Ablehnung frei; ebenso eine schwankende Lesung, also gerade das Zeichen,
    // dass dem Modell nicht zu trauen ist. Gesperrte Konten liegen stumm und
    // warten auf keine Entscheidung — sie zählen nicht.
    const kohorte = b.vortageGetrennt
      ? plan.filter((p) => schonZurueckgehalten(p, b) && p.grund !== KONTO_GESPERRT && (p.entscheidung === 'offen' || betroffen.includes(p)))
      : [];
    const alt = betroffen.filter((p) => kohorte.includes(p));
    const frisch = betroffen.filter((p) => !kohorte.includes(p));
    const basis = b.basis === 'geprueft' ? geprueft : plan.length;
    const zahl = (liste) => (b.zaehle === 'personen' ? personenVon(liste) : liste.length);
    const greift = (n) => n >= b.min && basis > 0 && n / basis > b.anteil;
    if (greift(zahl([...frisch, ...kohorte]))) {
      ergebnis[b.schalter] = true;
      const nFrisch = zahl(frisch);
      if (!kohorte.length || greift(nFrisch)) {
        ergebnis.text.push(b.text(frisch.length, basis, pz(nFrisch, basis), personenVon(frisch), kohorte.length));
      } else {
        const seit = kohorte.map((p) => b.seit(rundeOffenVon(p))).filter(Boolean).sort()[0] || null;
        ergebnis.gelb.push({ code: `notbremse_vortage_${b.schalter}`, text: b.textVortage({ alt: kohorte.length, altPersonen: personenVon(kohorte), ohneBefund: kohorte.length - alt.length, frisch: frisch.length, frischPersonen: personenVon(frisch), seit }) });
      }
      if (kohorte.length) ergebnis.ausVortagen = { ...(ergebnis.ausVortagen || {}), [b.schalter]: kohorte.length };
      halten(betroffen, b.halten);
    } else {
      // Greift nicht mehr: die übernommenen bleiben Ablehnungen — gemerkt, damit
      // der Bericht sie eigens zählt (auch wenn später eine andere Bremse sie hält).
      alt.forEach((p) => { p.ausVortagAbgelehnt = b.schalter; });
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
  // Nach ALLEN Bremsen gezählt: hält die Bild- oder Gesamt-Bremse einen
  // übernommenen Fall doch noch, wird er nicht abgelehnt.
  for (const p of plan) {
    if (!p.ausVortagAbgelehnt || p.entscheidung !== 'ablehnen') continue;
    ergebnis.ausVortagenAbgelehnt = { ...(ergebnis.ausVortagenAbgelehnt || {}), [p.ausVortagAbgelehnt]: ((ergebnis.ausVortagenAbgelehnt || {})[p.ausVortagAbgelehnt] || 0) + 1 };
  }
  return ergebnis;
}

module.exports = {
  entscheideFall, bildBefund, fotoVorbefund, bildMitVorbefund, belegeVon, notbremse, nameAusLesungen, eanAusLesungen, rettungNichtGeschafft,
  rundeBefunde, rundeOffenEintrag, preisBildschirmGemeldet,
  BILD_GRUENDE, EIGENE_BREMSEN, AUSSER_GESAMTQUOTE, KONTO_GESPERRT, DOPPEL_GRUENDE, RUNDE_SPERREND,
};
