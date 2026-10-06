'use strict';
/**
 * Warnungen des Tagesberichts — reine Funktion, getestet in
 * __tests__/warnungen.test.js. Jede Warnung steht für einen Ausfall, der
 * schon einmal passiert ist und damals niemandem auffiel:
 *
 *  • Aktion läuft aus ohne Nachfolger — 01.09.2026: zwei Tage lang 119 Bons
 *    ohne Prämie, 33 Foto-Uploads ohne Aktion.
 *  • Zweitprüfung eingeschaltet, aber nicht gelaufen — 23.09.2026: ein
 *    Ausrollen von einem Zweig ohne diesen Code nahm sie still wieder raus.
 *  • Bons hängen in der Prüfung / ohne Aktion — der Stau vom 02.09. (163 Bons
 *    seit Juli).
 *  • Morgenrunde nicht fertig geworden / Bildprüfung scheitert reihenweise.
 *  • Produktsuche angehalten, findet nichts oder läuft nicht — 18.08.–01.10.2026:
 *    sechs Wochen mit leerem KI-Guthaben, 5.301 Barcodes fälschlich „ohne
 *    Daten", Serper und Apify weiter bezahlt.
 *
 * Stufen: 'rot' = heute handeln, 'gelb' = im Blick behalten.
 */

const { ANGEHALTEN_TEXT, HALT_OHNE_WARNUNG, SERPER_KNAPP_FAKTOR, bezahltVon } = require('./produktsuche');

const TAG_MS = 24 * 60 * 60 * 1000;
const zahlDe = (n) => Number(n).toLocaleString('de-DE');

/**
 * @param {object} k
 * @param {number} k.jetzt                      ms
 * @param {Array<{id:string, kind:string, active:boolean, startAt:number, endAt:number, budgetRemainingCents?:number, budgetTotalCents?:number}>} k.aktionen
 * @param {{eingeschaltet:boolean, laeufeLetzte48h:number}} k.zweitpruefung
 * @param {{inPruefung:number, aeltesteTage:number|null, letzte24h:{gesamt:number, ohneAktion:number}}} k.bons
 * @param {{geprueft:number, offen:number, auditFehler:number, auditVersucht:number, nichtGeschafft:number, schreibFehler?:number, aeltesteOffenTage?:number|null, fotoAbgleichGescheitert?:boolean, kontoSperrenUnlesbar?:boolean, eanHaltenNeu?:number, haltBefundNichtGespeichert?:number, eanFotoNichtGespeichert?:number, preisQuelleBefragt?:number, preisQuelleOhneAntwort?:number, preisBildschirmHalten?:number, preisBildschirmTrotzBon?:number, preisBildschirmBonWiderspruch?:number, preisBildschirmSchalterUnbekannt?:string|null, preisBelegSchalterUnbekannt?:string|null, preisKopfNichtAbrufbar?:number, preisBildschirmScharf?:boolean, preisBelegHalten?:number, preisBelegKassenbon?:number, preisBelegOhneAntwort?:number, preisBelegMaerkteUnlesbar?:boolean, korrekturGebremst?:{anzahl:number, geprueft:number, alle?:number, vermerkt?:boolean}|null, korrekturNichtGespeichert?:number, korrekturGebremstWartet?:number, korrekturAufgeschoben?:number, korrekturSchalterUnbekannt?:string|null, korrekturAltcodeWartet?:number, korrekturLeserFehler?:number}} k.runde
 * @param {{bild:boolean, gesamt:boolean, text:string[], gelb?:Array<{code:string, text:string}>}} k.notbremse
 * @param {{alt:string|null, neu:string}} k.regelVersion
 * @param {{scharf:boolean, bericht:object|null, abgebrochen?:boolean, laeuftNoch?:boolean, unbekannt?:boolean}} [k.bonRunde]
 * @param {object} [k.produktsuche]  Ergebnis von produktsuche.ladeProduktsuche
 * @returns {Array<{stufe:'rot'|'gelb', code:string, text:string}>}
 */
function warnungen(k) {
  const w = [];
  const rot = (code, text) => w.push({ stufe: 'rot', code, text });
  const gelb = (code, text) => w.push({ stufe: 'gelb', code, text });

  // ── Aktionen ──────────────────────────────────────────────────────────
  const aktionen = k.aktionen || [];
  const laufend = aktionen.filter((a) => a.active && a.startAt <= k.jetzt && k.jetzt <= a.endAt);
  for (const kind of ['receipt', 'product_photos']) {
    const name = kind === 'receipt' ? 'Bons' : 'Produktfotos';
    const jetztAktiv = laufend.filter((a) => a.kind === kind);
    if (!jetztAktiv.length) {
      rot(`aktion_fehlt_${kind}`, `Für ${name} läuft gerade KEINE Aktion — neue Einreichungen bekommen nichts.`);
      continue;
    }
    // Endet die späteste laufende Aktion bald, und beginnt danach keine neue?
    const spaetestesEnde = Math.max(...jetztAktiv.map((a) => a.endAt));
    const tage = Math.ceil((spaetestesEnde - k.jetzt) / TAG_MS);
    const nachfolger = aktionen.some((a) => a.kind === kind && a.active && a.startAt <= spaetestesEnde + 60_000 && a.endAt > spaetestesEnde);
    if (!nachfolger && tage <= 7) {
      (tage <= 2 ? rot : gelb)(`aktion_endet_${kind}`, `Die ${name}-Aktion endet in ${tage} ${tage === 1 ? 'Tag' : 'Tagen'} und es gibt keinen Nachfolger.`);
    }
    for (const a of jetztAktiv) {
      const total = Number(a.budgetTotalCents) || 0;
      const rest = Number(a.budgetRemainingCents);
      if (!total || !Number.isFinite(rest)) continue;
      if (rest <= 0) rot(`budget_leer_${a.id}`, `Budget von „${a.id}" ist aufgebraucht — dort wird nichts mehr gebucht.`);
      else if (rest / total < 0.1) gelb(`budget_knapp_${a.id}`, `Budget von „${a.id}" ist fast leer (${Math.round((100 * rest) / total)} % übrig).`);
    }
  }

  // ── Zweitprüfung unsicherer Bons ─────────────────────────────────────
  if (k.zweitpruefung && k.zweitpruefung.eingeschaltet && k.zweitpruefung.laeufeLetzte48h === 0) {
    rot('zweitpruefung_still', 'Die Zweitprüfung für unsichere Bons ist eingeschaltet, ist aber seit zwei Tagen nicht gelaufen. Vermutlich wurde die Bon-Verarbeitung von einem Stand ohne diesen Code ausgerollt.');
  }

  // ── Bons ─────────────────────────────────────────────────────────────
  const b = k.bons;
  if (b) {
    if (b.aeltesteTage != null && b.aeltesteTage >= 3) gelb('bons_warten', `${b.inPruefung} Bons warten auf eine Entscheidung, der älteste seit ${b.aeltesteTage} Tagen.`);
    const n = b.letzte24h?.gesamt || 0;
    const ohne = b.letzte24h?.ohneAktion || 0;
    if (n >= 20 && ohne / n > 0.05) rot('bons_ohne_aktion', `${ohne} von ${n} Bons der letzten 24 Stunden liefen ohne Aktion — Aktion ausgelaufen oder falsch eingestellt?`);
  }

  // ── Die Runde selbst ─────────────────────────────────────────────────
  const r = k.runde;
  if (r) {
    // Ohne diese Abgleiche gibt die Runde nichts frei (Entscheidungen Patrick
    // 02.10.2026, fail-closed) — still wäre das ein Tag ohne jede Freigabe.
    if (r.kontoSperrenUnlesbar) rot('kontosperren_unlesbar', 'Die Liste gesperrter Konten (cashback_sperren) war nicht lesbar — heute wurde nichts freigegeben. Die Fälle sind morgen wieder dran.');
    // Foto-Befunde früherer Läufe gelten weiter (fotoRundeRegeln.bildMitVorbefund);
    // wer heute zum ersten Mal geprüft wurde, hat aber keinen — die Konsole
    // rechnet den Foto-Abgleich nicht selbst (Schlussprüfung 03.10.2026).
    if (r.fotoAbgleichGescheitert) rot('foto_abgleich_gescheitert', 'Der Abgleich der Fotos mit früheren Einreichungen ist gescheitert (Storage-Liste) — heute wurde nichts freigegeben. Foto-Befunde früherer Läufe gelten weiter; Einreichungen, die heute zum ersten Mal geprüft wurden, zeigt die Prüfkonsole ohne Foto-Befund — dort vor einer Freigabe die Fotos selbst ansehen. Die Fälle sind morgen wieder dran.');
    if (r.schreibFehler > 0) rot('schreibfehler', `${r.schreibFehler} Entscheidungen konnten nicht gespeichert werden — die Fälle sind offen geblieben und morgen wieder dran.`);
    if (r.nichtGeschafft > 0) gelb('runde_unvollstaendig', `${r.nichtGeschafft} Einreichungen hat die Runde in der Zeit nicht mehr geschafft — sie sind morgen dran.`);
    // Seit der Preis-Pflicht (26.09.) bleibt bei Zweifel mehr liegen als vorher.
    // Liegen heißt: die Person wartet auf ihr Geld — das darf nicht still wachsen.
    if (r.aeltesteOffenTage != null && r.aeltesteOffenTage >= 3) {
      gelb('fotos_warten', `${r.offen} Produktfotos warten auf deine Entscheidung, die älteste seit ${r.aeltesteOffenTage} Tagen.`);
    }
    if (r.auditVersucht >= 8 && r.auditFehler / r.auditVersucht > 0.25) {
      rot('bildpruefung_gestoert', `Die Bildprüfung ist bei ${r.auditFehler} von ${r.auditVersucht} Einreichungen gescheitert (meist Google-Limit). Diese Fälle bleiben offen.`);
    }
    // Barcode-Nummer (Prüfrunde 2, 02.10.2026): normal ~3 % der geprüften
    // Fälle. Ändert sich das Modell (wie beim thinkingBudget am 22.09.),
    // blieben sonst massenhaft Fälle still liegen — aufgefallen wäre es erst
    // nach drei Tagen über „Produktfotos warten".
    const eanNeu = Number(r.eanHaltenNeu) || 0;
    if (r.auditVersucht > 0 && eanNeu >= 8 && eanNeu / r.auditVersucht > 0.1) {
      (eanNeu / r.auditVersucht > 0.25 ? rot : gelb)('barcode_haelt_viele', `${eanNeu} von ${r.auditVersucht} geprüften Einreichungen hält die Runde wegen der Barcode-Nummer an (normal etwa 3 %) — Lesung des Modells prüfen.`);
    }
    // Ohne diese Einträge sieht die Prüfkonsole nicht, warum die Runde einen
    // Fall liegen ließ, und gibt ihn ohne Warnung frei (Prüfrunde 2) — und der
    // nächste Lauf kennt einen scharfen Halt der Bildschirm-Regel nicht mehr
    // (Prüfrunde 2 Bildschirmfoto, 04.10.2026).
    if (r.haltBefundNichtGespeichert > 0) {
      rot('befund_nicht_gespeichert', `Bei ${r.haltBefundNichtGespeichert} offenen Fällen konnte der Halte-Grund (gleiches Foto, Barcode-Nummer, Bildschirmfoto als Preis) nicht gespeichert werden — die Prüfkonsole zeigt sie als unauffällig, und der nächste Lauf kennt den Halt nicht. Vor einer Freigabe die Fälle im Bericht ansehen.`);
    }
    if (r.eanFotoNichtGespeichert > 0) {
      gelb('barcode_befund_nicht_gespeichert', `Bei ${r.eanFotoNichtGespeichert} Fällen konnte der Barcode-Befund (eanFotoOcr) nicht gespeichert werden; er steht ersatzweise am Halte-Grund der Runde.`);
    }
    // Bildschirmfoto als Preisbeleg (04.10.2026). Beantwortet die Bildprüfung
    // die Frage nach der Preisquelle nicht mehr (wie beim thinkingBudget am
    // 22.09.: Google ändert das Modell), erkennt die Regel still nichts mehr —
    // Bildschirmfotos würden wieder bezahlt. Gemessen: 0 von 448 ohne Antwort.
    const befragt = Number(r.preisQuelleBefragt) || 0;
    const ohne = Number(r.preisQuelleOhneAntwort) || 0;
    if (befragt >= 8 && ohne / befragt > 0.25) {
      gelb('preisquelle_ohne_antwort', `Bei ${ohne} von ${befragt} geprüften Einreichungen hat die Bildprüfung nicht gesagt, woher der Preis stammt — Bildschirmfotos als Preisbeleg werden so nicht erkannt. Modell bzw. Anweisung prüfen.`);
    }
    // Normal etwa 1 pro Woche (zugeschnittene Regalfotos). Viele auf einmal
    // deuten auf eine geänderte Lesart des Modells.
    const pbHalten = Number(r.preisBildschirmHalten) || 0;
    if (r.auditVersucht > 0 && pbHalten >= 5 && pbHalten / r.auditVersucht > 0.05) {
      gelb('preisquelle_haelt_viele', `${pbHalten} von ${r.auditVersucht} geprüften Einreichungen hält die Runde wegen einer unsicheren Preisquelle (Bildschirmfoto?) an — normal etwa einer pro Woche. Lesung des Modells prüfen.`);
    }
    // Fingerabdruck des wahrscheinlichsten Modellfehlers (Gegenprüfung
    // 04.10.2026): die Bildprüfung nennt Kassenbons „Bildschirm", die der
    // Lesedienst als Kassenbon erkannt hat. Gemessen 0 von 167 Kassenbons.
    // Die Regel lehnt diese Fälle nicht ab, sie hält sie an — die Warnung
    // sagt, warum plötzlich e-Bons liegen bleiben.
    const trotzBon = Number(r.preisBildschirmTrotzBon) || 0;
    if (trotzBon >= 2) {
      gelb('preisquelle_bon_als_bildschirm', `Bei ${trotzBon} Einreichungen nannte die Bildprüfung das Preisfoto „Bildschirm", obwohl der Lesedienst einen Kassenbon erkannte (normal nie) — abgelehnt wird so ein Fall nie, mit scharfer Regel bleibt er liegen. Lesung des Modells prüfen; Kassenbons, auch e-Bons, zählen immer.`);
    }
    // Gegenrichtung (Prüfrunde 2, 04.10.2026): die Bildprüfung nennt das
    // Preisfoto „Kassenbon", der Lesedienst las es und sah keinen — dort
    // würde bezahlt. Gemessen 0 von 126. Liegen bleiben die Fälle nur mit
    // scharfer Regel (`…Liegt`); in der Beobachtung werden sie bezahlt — der
    // Text sagt das, sonst sähe niemand sie sich an (Nachprüfung 06.10.2026).
    // Ein Preisbeleg-Halt mit Lesedienst-Bon zählt hier nicht (taeglicheRunde,
    // kassenbonOhneLesedienstBon — Nachprüfung 05.10.2026).
    const bonWiderspruch = Number(r.preisBildschirmBonWiderspruch) || 0;
    if (bonWiderspruch >= 2) {
      const liegt = Math.min(Number(r.preisBildschirmBonWiderspruchLiegt) || 0, bonWiderspruch);
      const folge = liegt === bonWiderspruch ? 'die Fälle bleiben liegen'
        : liegt === 0 ? 'in der Beobachtung hält die Runde sie nicht an (bezahlt, sofern nichts anderes fehlt), mit scharfer Regel blieben sie liegen'
          : `${liegt} davon ${liegt === 1 ? 'bleibt' : 'bleiben'} liegen, die übrigen hält die Runde in der Beobachtung nicht an`;
      gelb('preisquelle_bon_widerspruch', `Bei ${bonWiderspruch} Einreichungen nannte die Bildprüfung das Preisfoto „Kassenbon", der Lesedienst sah dort keinen (normal nie) — ${folge}. Preisfotos im Tagesbericht ansehen: Warenkorb oder Bestellübersicht statt Bon? Sonst Lesung des Modells prüfen.`);
    }
    // Unbekannter Schalterwert (etwa "true" als Text): gilt als Beobachtung —
    // Bildschirmfotos werden weiter bezahlt, wer „scharf" erwartet, merkt es
    // sonst nicht (Prüfrunde 2, 04.10.2026).
    if (r.preisBildschirmSchalterUnbekannt) {
      gelb('preisbildschirm_schalter_unbekannt', `Schalter preisBildschirmRegel hat den Wert ${r.preisBildschirmSchalterUnbekannt} — gilt als Beobachtung. Scharf nur mit true (Typ boolean), aus mit false.`);
    }
    // Ebenso der eigene Schalter des Preisbelegs (Nachprüfung 05.10.2026).
    if (r.preisBelegSchalterUnbekannt) {
      gelb('preisbeleg_schalter_unbekannt', `Schalter preisBelegRegel hat den Wert ${r.preisBelegSchalterUnbekannt} — gilt als Beobachtung. Scharf nur mit true (Typ boolean), aus mit false.`);
    }
    // Preisbeleg „Kassenbon" (Entscheidung Claude im Auftrag Patricks,
    // 04.10.2026): ein „Kassenbon" ohne Kassenbon-Merkmal oder von einem
    // fremden Händler bleibt liegen. Gemessen 05.10.: ~4–8 pro Woche. Viele
    // auf einmal deuten auf eine geänderte Lesart des Modells — dann lägen
    // echte Bons bei Patrick.
    const belegHalten = Number(r.preisBelegHalten) || 0;
    if (r.auditVersucht > 0 && belegHalten >= 5 && belegHalten / r.auditVersucht > 0.05) {
      gelb('preisbeleg_haelt_viele', `${belegHalten} von ${r.auditVersucht} geprüften Einreichungen hält die Runde wegen eines unsicheren Preisbelegs an (Kassenbon ohne Kassenbon-Merkmale oder von einem fremden Händler) — normal etwa vier bis acht pro Woche. Preisfotos und Lesung des Modells prüfen.`);
    }
    // Beantwortet die Bildprüfung die Merkmal-Frage nicht mehr, bleibt jeder
    // „Kassenbon" ohne gelesenen Händlerkopf liegen (gemessen 0 von 189).
    const kbBefragt = Number(r.preisBelegKassenbon) || 0;
    const kbOhne = Number(r.preisBelegOhneAntwort) || 0;
    if (kbBefragt >= 8 && kbOhne / kbBefragt > 0.25) {
      gelb('preisbeleg_ohne_antwort', `Bei ${kbOhne} von ${kbBefragt} Kassenbon-Preisfotos hat die Bildprüfung nicht gesagt, welche Kassenbon-Merkmale zu sehen sind — mit scharfer Regel bleiben sie liegen, wenn der Lesedienst keinen Bon-Kopf las. Modell bzw. Anweisung prüfen.`);
    }
    if (r.preisBelegMaerkteUnlesbar) {
      gelb('preisbeleg_maerkte_unlesbar', 'Die Liste unserer Märkte (discounter) war nicht lesbar — der Händler-Abgleich der Preisbelege lief nur gegen die Ketten im Code. Ein neu aufgenommener Markt gilt heute als fremd.');
    }
    // Kopf des Preisfotos nicht abrufbar (Storage): ohne ihn gibt die Regel
    // keine Freigabe — mehrere auf einmal deuten auf eine Störung bei uns.
    // Scharf und bei mehr als einem Viertel der befragten Fälle ist das ein
    // Tag (fast) ohne Freigaben → rot wie kontosperren_unlesbar und
    // bildpruefung_gestoert (Prüfrunde 3, 04.10.2026). In der Beobachtung
    // ändert der Kopf keine Entscheidung → gelb.
    const ohneKopf = Number(r.preisKopfNichtAbrufbar) || 0;
    if (r.preisBildschirmScharf && befragt >= 8 && ohneKopf / befragt > 0.25) {
      rot('preisfoto_kopf_nicht_abrufbar', `Bei ${ohneKopf} von ${befragt} geprüften Einreichungen war der Anfang des Preisfotos nicht abrufbar (Storage/Zeitgrenze) — mit scharfer Regel gibt die Runde sie nicht frei, heute also kaum Freigaben. Storage prüfen; die Fälle sind morgen wieder dran.`);
    } else if (ohneKopf >= 3) {
      gelb('preisfoto_kopf_nicht_abrufbar', `Bei ${ohneKopf} Einreichungen war der Anfang des Preisfotos nicht abrufbar (Storage/Zeitgrenze) — mit scharfer Regel bleiben sie liegen (Kassenbon nur, wenn der Lesedienst dort keinen Bon sah), bis die Runde ihn lesen kann.`);
    }
    // Barcode-Korrektur (Entscheidung Patrick 06.10.2026). Korrigiert die Runde
    // auffällig viel, liegt es eher am Modell — dann korrigiert sie heute gar
    // nichts (fotoRundeRegeln.korrekturBremse), die Fälle liegen wie früher.
    // Gerechnet nur über die heute NEU geprüften Fälle (Prüfrunde 06.10.2026):
    // der liegende Bestand besteht fast nur aus Abweichungen und verzerrte den Anteil.
    if (r.korrekturGebremst) {
      const { anzahl, geprueft, vermerkt } = r.korrekturGebremst;
      const anteil = `${anzahl} von ${geprueft} neu geprüften Barcode-Nummern korrigiert (${geprueft ? Math.round((100 * anzahl) / geprueft) : 0} %, normal unter 5 %)`;
      rot('barcode_korrektur_gebremst', vermerkt === false
        ? `Die Runde hätte heute ${anteil} — eher ein Lesefehler des Modells. Keine davon korrigiert. Trockenlauf bzw. Schalter aus: nichts dauerhaft vermerkt, eine spätere Korrektur dieser Fälle braucht eine neue doppelte Lesung.`
        : `Die Runde hätte heute ${anteil} — eher ein Lesefehler des Modells. Keine davon wurde korrigiert, auch später nicht automatisch: die Fälle warten auf dich.`);
    }
    // Von einer FRÜHEREN Notbremse angehaltene Fälle liegen noch (sie werden
    // nie automatisch korrigiert, Prüfrunde 06.10.2026) — erinnern, bis entschieden.
    if (r.korrekturGebremstWartet > 0) {
      gelb('barcode_korrektur_gebremst_wartet', `${r.korrekturGebremstWartet} Fälle hat eine frühere Notbremse der Barcode-Korrektur angehalten — die Runde korrigiert sie nicht mehr selbst, sie warten auf dich.`);
    }
    // Befunde des ALTEN Codes ohne Vermerk (werte.eanFotoHalteQuellen,
    // Prüfrunde 06.10.2026): er lief nach dem 06.10. noch einmal. Diese Fälle
    // korrigiert die Runde nie selbst — ob ein früheres `unsicher` überschrieben
    // wurde, ist nicht mehr zu sehen.
    if (r.korrekturAltcodeWartet > 0) {
      gelb('barcode_altcode_wartet', `${r.korrekturAltcodeWartet} Fälle tragen einen Barcode-Befund des alten Codes ohne Vermerk (er lief nach dem 06.10. noch einmal) — die Runde korrigiert sie nicht selbst, sie warten auf dich.`);
    }
    // Strichcode-Leser (Pflicht-Zeuge der Korrektur) gescheitert: Download,
    // Laden der WASM-Datei oder Zeit. Dort keine Korrektur — fällt er ganz
    // aus, korrigiert die Runde still gar nichts mehr.
    if (r.korrekturLeserFehler > 0) {
      gelb('barcode_leser_fehler', `Der Strichcode-Leser ist bei ${r.korrekturLeserFehler} Korrektur-Kandidaten gescheitert — dort keine Barcode-Korrektur, die Fälle liegen wie vorher. Häuft sich das: Logs von fotoRundeTaeglich ansehen.`);
    }
    if (r.korrekturNichtGespeichert > 0) {
      gelb('barcode_korrektur_nicht_gespeichert', `${r.korrekturNichtGespeichert} Barcode-Korrekturen konnten nicht gespeichert werden — diese Fälle bleiben wie vor der Korrektur liegen und sind morgen wieder dran.`);
    }
    // Mehr Korrekturen aus früheren Läufen als die Tagesgrenze (fotoRundeRegeln.KORREKTUR_ALT_MAX).
    if (r.korrekturAufgeschoben > 0) {
      gelb('barcode_korrektur_aufgeschoben', `${r.korrekturAufgeschoben} Barcode-Korrekturen aus früheren Läufen liegen über der Tagesgrenze — sie folgen in den nächsten Läufen. Ungewöhnlich viele: lief die Korrektur einige Tage nicht?`);
    }
    // Schalter `barcodeKorrektur`: nur true wendet an (Prüfrunde 06.10.2026).
    if (r.korrekturSchalterUnbekannt) {
      gelb('barcode_korrektur_schalter_unbekannt', r.korrekturSchalterUnbekannt === 'nicht lesbar'
        ? 'Der Schalter barcodeKorrektur war nicht lesbar — heute keine Barcode-Korrektur, die Fälle liegen wie vorher.'
        : `Schalter barcodeKorrektur hat den Wert ${r.korrekturSchalterUnbekannt} — gilt als aus. An nur mit true (Typ boolean), aus mit false.`);
    }
  }
  for (const t of (k.notbremse?.text || [])) rot('notbremse', `Notbremse: ${t}`);
  // Gelb: die Bremse hält nur dank Fällen, die sie schon an einem Vortag
  // zurückgehalten hat, bzw. solche Fälle wurden heute doch abgelehnt
  // (fotoRundeRegeln.notbremse, Nachprüfung 06.10.2026) — kein neuer Befund,
  // aber offen bzw. nachzusehen.
  for (const g of (k.notbremse?.gelb || [])) gelb(g.code || 'notbremse_vortage', `Notbremse: ${g.text}`);

  // ── Bon-Runde (07:45) ────────────────────────────────────────────────
  const br = k.bonRunde;
  if (br && !br.bericht) {
    if (br.unbekannt) gelb('bonrunde_unbekannt', 'Der Bericht der Bon-Runde von 7:45 Uhr konnte nicht gelesen werden — offene Bons in der Prüfkonsole ansehen.');
    else if (br.laeuftNoch && !br.abgebrochen) gelb('bonrunde_laeuft', 'Die Bon-Runde von 7:45 Uhr lief beim Schreiben dieses Berichts noch — ihr Ergebnis fehlt hier. Offene Bons in der Prüfkonsole ansehen.');
    else if (br.abgebrochen) {
      if (br.scharf) rot('bonrunde_abgebrochen', 'Die Bon-Runde von 7:45 Uhr ist nicht fertig geworden. Einzelne Bons können schon entschieden sein — Stand in der Prüfkonsole ansehen.');
      else gelb('bonrunde_abgebrochen', 'Der Trockenlauf der Bon-Runde von 7:45 Uhr ist nicht fertig geworden.');
    }
    else if (br.scharf) rot('bonrunde_fehlt', 'Die Bon-Runde von 7:45 Uhr ist heute nicht gelaufen — Bons in der Prüfung warten weiter.');
    else gelb('bonrunde_fehlt', 'Der Trockenlauf der Bon-Runde von 7:45 Uhr ist heute nicht gelaufen.');
  }
  const bb = br && br.bericht;
  if (bb) {
    if (bb.technikFehler > 0) rot('bonrunde_technik', `Bei ${bb.technikFehler} Bons ist die Bon-Runde an einem technischen Fehler gescheitert — sie bleiben offen und sind morgen wieder dran.`);
    const budget = (bb.budgetEnde || 0) + ((bb.offenGruende && bb.offenGruende.budget_leer) || 0);
    if (budget > 0) (bb.dryRun ? gelb : rot)('bonrunde_budget', bb.dryRun
      ? `${budget} Bons könnten nicht bezahlt werden, weil das Budget ihrer Aktion nicht reicht.`
      : `${budget} Bons konnten nicht bezahlt werden, weil das Budget ihrer Aktion leer ist.`);
    if (bb.offen >= 5) gelb('bonrunde_offen', `${bb.offen} Bons konnte die Bon-Runde nicht entscheiden — bitte in der Prüfkonsole ansehen.`);
    if (bb.tagesKollisionen > 0) gelb('bonrunde_kollision', `Bei ${bb.tagesKollisionen} Personen lagen mehr Bons desselben Tages als das Tageslimit — welcher bezahlt wurde, entschied die Reihenfolge.`);
  }

  // ── Produktsuche (unbekannte Barcodes, src/produktsuche.js) ──────────
  const p = k.produktsuche;
  if (p && p.unlesbar) {
    gelb('produktsuche_unbekannt', 'Die Zahlen der Produktsuche (unbekannte Barcodes) waren nicht lesbar — ob sie läuft, ist heute offen.');
  } else if (p) {
    const mindest = p.serperMindestGuthaben;
    // Tagesdeckel und „aus" sind gewollt — keine Warnung.
    if (p.angehalten && !HALT_OHNE_WARNUNG.has(p.angehalten)) {
      if (p.angehalten === 'serper_guthaben') {
        rot('produktsuche_angehalten', `Die Produktsuche ist angehalten: Serper-Guthaben ${p.serperRest == null ? 'unbekannt' : zahlDe(p.serperRest)}, Grenze ${zahlDe(mindest)}. Bitte bei Serper nachkaufen — bis dahin werden unbekannte Barcodes nicht gesucht.`);
      } else if (p.angehalten === 'serper_guthaben_unbekannt') {
        // Ohne Kontostand wird nichts bezahlt (fail-closed) — auch das hält an.
        rot('produktsuche_angehalten', 'Die Produktsuche ist angehalten: das Serper-Guthaben ließ sich nicht abfragen (Schlüssel oder Serper-Konto prüfen). Bis dahin werden unbekannte Barcodes nicht gesucht.');
      } else if (p.angehalten === 'konfig_ungueltig') {
        const felder = (p.ungueltigeFelder || []).join(', ') || 'unbekannt';
        rot('produktsuche_angehalten', `Die Produktsuche ist angehalten: in _meta/produktsuche steht ein ungültiger Wert (${felder}). Zahlen als ganze Zahl eintragen, aktiv als true/false — bis dahin wird nichts gesucht.`);
      } else if (p.angehalten === 'dienst_ausfall') {
        rot('produktsuche_angehalten', 'Die Produktsuche pausiert: zweimal hintereinander ist ein Dienst ausgefallen (KI, Suche, Schlüssel oder ein Ausrollen von scrapeEan). Sie versucht es mit wachsender Pause selbst wieder — bleibt das so, die Logs von scrapeEan prüfen.');
      } else {
        rot('produktsuche_angehalten', `Die Produktsuche ist angehalten (${ANGEHALTEN_TEXT[p.angehalten] || p.angehalten}).`);
      }
    } else if (p.aktiv && p.serperRest != null && p.serperRest < SERPER_KNAPP_FAKTOR * mindest) {
      gelb('serper_knapp', `Serper-Guthaben wird knapp: noch ${zahlDe(p.serperRest)} Suchen, bei ${zahlDe(mindest)} hält die Produktsuche an.`);
    }
    const g = p.gestern;
    const bezahlt = bezahltVon(g);
    // Ein Fremddienst-Fehler ist kein „nichts gefunden" (scrapeEan → 503): die
    // Barcodes bleiben offen. Viele davon heißen aber, dass etwas ausgefallen ist.
    if (g && g.fehler >= 5 && g.fehler / bezahlt > 0.2) {
      (g.fehler / bezahlt > 0.5 ? rot : gelb)('produktsuche_fehler', `Bei ${zahlDe(g.fehler)} von ${zahlDe(bezahlt)} Suchen gestern ist ein Fremddienst gescheitert (Shopseiten, KI oder Suche). Die Barcodes bleiben offen und werden mit wachsendem Abstand wiederholt; sind alle Shopseiten eines Barcodes zweimal hintereinander gesperrt (mindestens 6 Stunden auseinander), ruht er bis zur normalen Auffrischfrist — bezahlt wurde trotzdem.`);
    }
    // Die Handschrift des Vorfalls vom August: alles „ohne Daten", kein Treffer.
    // Normal ist etwa jeder zweite Barcode ein Treffer (gemessen 02.–04.10.2026).
    if (g && g.gefunden === 0 && g.keineDaten >= 20) {
      rot('produktsuche_findet_nichts', `Die Produktsuche hat gestern ${zahlDe(g.keineDaten)} Barcodes ohne einen einzigen Treffer abgeschlossen — sonst ist etwa jeder zweite ein Treffer. Erst prüfen, ob ein Fremddienst (KI, Serper, Apify) ausgefallen ist; im August wurden so 5.301 Barcodes fälschlich als „ohne Daten" abgeschlossen.`);
    }
    // Stau oben in der Reihenfolge (Prüfrunde 3): Läufe fanden nur Fälle, die
    // nach gesperrten Shopseiten noch warten, und bezahlten nichts. Ab einer
    // Stunde (sechs Läufe im 10-Minuten-Takt) eine Meldung wert.
    if (g && g.kandidatenKnapp >= 6) {
      gelb('produktsuche_stau', `Die Produktsuche hat gestern in ${zahlDe(g.kandidatenKnapp)} Läufen nur Barcodes gefunden, die nach gesperrten Shopseiten noch warten, und deshalb nichts gesucht. Bleibt das so, sind mehr Barcodes gesperrt als sonst (Shopseiten oder Apify prüfen).`);
    }
    // Eingeschaltet, Barcodes warten, aber weder gestern noch heute ein Lauf.
    const getan = (z) => (z ? z.bearbeitet + z.uebersprungen : 0);
    if (p.aktiv && !p.pausiert && !p.angehalten && (p.wartend || 0) > 0 && getan(g) === 0 && getan(p.heute) === 0) {
      rot('produktsuche_still', `Die Produktsuche ist eingeschaltet, hat aber seit gestern nichts bearbeitet, obwohl ${zahlDe(p.wartend)} Barcodes warten. Vermutlich läuft der Prozessor nicht (Ausrollen, Zeitplan, Schlüssel).`);
    }
  }

  if (k.regelVersion && k.regelVersion.alt && k.regelVersion.alt !== k.regelVersion.neu) {
    gelb('regeln_geaendert', 'Die Prüfregeln haben sich seit dem letzten Lauf geändert. Die Ergebnisse von heute bitte einmal ansehen.');
  }
  return w;
}

module.exports = { warnungen };
