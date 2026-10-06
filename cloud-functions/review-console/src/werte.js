'use strict';
/**
 * Effektive Werte einer Produktfoto-Einreichung (`crowd_uploads`) — EINE Quelle
 * für Morgenrunde (taeglicheRunde.js) und Prüfkonsole (einreichung.js).
 *
 * Warum: Bis 26.09.2026 las die Runde die nachgelesenen Felder (*RescueOcr) mit,
 * die Konsole nicht. Derselbe Fall hieß im Tagesbericht „K-Classic Gouda" und in
 * der Konsole „(ohne Name) · Kein Name erkennbar"; einmal wurde deshalb „trotz
 * Sperre" freigegeben, obwohl nichts gesperrt war. Wer eine Regel hier ändert,
 * ändert sie für beide.
 *
 * Reihenfolge je Angabe: was der Nutzer eingetragen hat → was der Namer beim
 * Anlegen las → was später nachgelesen wurde. Die nachgelesenen Felder schreibt
 * nur der Server (firestore.rules sperrt sie beim Anlegen).
 */
const { ms } = require('./duplicatePolicy');

/** GTIN-Prüfziffer (8/12/13/14 Stellen). */
function pruefzifferOk(code) {
  if (!/^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(code)) return false;
  const z = code.split('').map(Number);
  const p = z.pop();
  let summe = 0;
  z.reverse().forEach((v, i) => { summe += v * (i % 2 === 0 ? 3 : 1); });
  return (10 - (summe % 10)) % 10 === p;
}

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const gueltigerPreis = (p) => !!p && Number.isFinite(p.priceCents) && p.priceCents > 0;

/** Nachgelesene EAN nur mit gültiger Prüfziffer. Die Rettung schreibt nur
 *  solche (eanAusLesungen); eine andere wäre eingeschleust oder Altbestand. */
function gerettetEan(x) {
  const e = x.eanRescueOcr;
  return typeof e === 'string' && pruefzifferOk(e) ? e : null;
}

/**
 * Effektive EAN: korrigiert (Morgenrunde, `eanKorrektur`) → gespeichert (`ean`,
 * gescannt/getippt) → nachgelesen (`eanRescueOcr`). Wer die EAN einer
 * Einreichung braucht, nimmt DIESE Funktion — `ean` allein ist bei einer
 * korrigierten Einreichung die falsche Nummer (Entscheidung Patrick 06.10.2026).
 */
const eanOf = (x) => eanKorrekturOf(x) || x.ean || gerettetEan(x) || null;
const nameOf = (x) => x.productName || x.productNameOcr || x.productNameRescueOcr || null;
/** Liefert das Preis-OBJEKT ({priceCents, …}); ob es gültig ist, prüft die Doppel-Regel (priceOf). */
const preisOf = (x) => (gueltigerPreis(x.priceOcr) ? x.priceOcr : x.priceRescueOcr || null);

/**
 * Hersteller für die ANZEIGE — inklusive Nachlesung. Für die Doppel-Regel gilt
 * er NICHT, siehe policyOf.
 */
const herstellerAnzeige = (x) =>
  text(x.manufacturerOcr && x.manufacturerOcr.name) || text(x.manufacturerRescueOcr && x.manufacturerRescueOcr.name);

/**
 * Eingabe der Doppel-Regel (evaluateDuplicate).
 *
 * `manufacturerOcr` bleibt AUSSCHLIESSLICH der Wert des Namers: ein
 * nachgelesener Hersteller löst keine Sperre. „Kaufland Stiftung & Co."
 * (Markeninhaber) und „DMK" (Produzent) stehen auf derselben Packung — als
 * „andere Daten" gewertet gäbe das eine echte Dublette frei (CLAUDE.md,
 * Produktfoto-Runde 20.09.2026). Ein nachgelesener PREIS darf dagegen lösen:
 * der Preis vom Schild ist eindeutig.
 *
 * `eanVorher` (06.10.2026): nach einer Barcode-Korrektur die ursprünglich
 * gespeicherte Nummer, sonst null. evaluateDuplicate liest das Feld nicht; die
 * Aufrufer bilden damit die Gruppe der VERWANDTEN Einreichungen (eanNummern,
 * teilenNummer) für die zusätzliche Prüfung `ean_alt_doppelt`.
 */
const policyOf = (id, x, serverZeit = null) => ({
  id, userId: x.userId ?? null, ean: eanOf(x), eanVorher: eanVorherOf(x), marketId: x.marketId ?? null,
  status: x.status, createdAt: einreichZeit(x, serverZeit), priceOcr: preisOf(x), manufacturerOcr: x.manufacturerOcr ?? null,
});

/**
 * Einreich-Zeitpunkt für die Regeln: der Server-Zeitpunkt des Dokuments
 * (`createTime` des Snapshots), wo der Aufrufer ihn hat — sonst `createdAt`.
 *
 * Warum (Prüfrunde 02.10.2026): `createdAt` schreibt der Client, und
 * firestore.rules prüft den Wert beim Anlegen nicht. Die App setzt
 * serverTimestamp(); ein veränderter Client könnte das Feld aber um mehr als
 * sieben Tage verschieben und so die Wochen-Sperre und die Regel „ältere
 * eigene noch offen" umgehen. `createTime` setzt Firestore selbst. Gemessen
 * 02.10.2026: bei 0 von 4.102 Einreichungen weichen die beiden um mehr als
 * 10 Minuten ab — die Umstellung ändert am Bestand nichts. Ein Rules-Zwang
 * (`createdAt == request.time`) wäre die Alternative, sperrte aber jede
 * ältere App-Version aus, die das Feld anders setzt.
 */
function einreichZeit(x, serverZeit = null) {
  return ms(serverZeit) ?? ms(x && x.createdAt);
}

/** Eingabe der Vollständigkeitsprüfung (completenessCheck) mit effektiver EAN und effektivem Namen. */
const vollstaendigkeitOf = (x) => ({
  images: x.images, ean: eanOf(x), productName: x.productName, productNameOcr: x.productNameOcr || x.productNameRescueOcr,
});

/** Woher die angezeigten Werte stammen — damit ein nachgelesener Wert als solcher erkennbar bleibt. */
function herkunftOf(x) {
  const nameQuelle = x.productName ? 'nutzer' : x.productNameOcr ? 'ocr' : x.productNameRescueOcr ? 'nachgelesen' : null;
  return {
    nameQuelle,
    eanNachgelesen: !x.ean && !!gerettetEan(x),
    eanKorrigiert: !!eanKorrekturOf(x),
    preisNachgelesen: !gueltigerPreis(x.priceOcr) && gueltigerPreis(x.priceRescueOcr),
    herstellerNachgelesen: !text(x.manufacturerOcr && x.manufacturerOcr.name) && !!text(x.manufacturerRescueOcr && x.manufacturerRescueOcr.name),
  };
}

/* ── Barcode-Nummer vom Foto (Entscheidung Patrick 02.10.2026, „Super-Vorschlag") ──
 * Die Morgenrunde liest die Ziffern unter dem Strichcode des Barcode-Fotos
 * mit (im Aufruf der Bildprüfung) und legt sie in `eanFotoOcr` ab. Weicht die
 * gelesene Nummer von der gespeicherten ab, bleibt die Einreichung liegen —
 * ein Mensch entscheidet. Anlass: Einreichungen mit falschen EANs.
 */
const ziffern = (v) => String(v ?? '').replace(/\D/g, '');
/** GTIN auf 14 Stellen: EAN-13 „0…"/UPC-A und EAN-13 sind dann vergleichbar. */
const gtin14 = (c) => ziffern(c).padStart(14, '0');

/**
 * Gruppenschlüssel einer EAN für die Doppel-Regel: dieselbe GTIN in jeder
 * Schreibweise (führende Nullen, UPC-A als 12 Stellen, EAN-13 mit „0" davor).
 *
 * Warum (Prüfrunde 02.10.2026): die App nimmt beim Eintippen 8–14 Ziffern
 * ohne Normalisierung an. Wer „0" + EAN-13 eintippt, landete in einer eigenen
 * Gruppe — und die Wochen-Sperre griff nicht. Nach GS1 ist die links mit
 * Nullen aufgefüllte 14-stellige Form DIE kanonische GTIN; zwei Schreibweisen
 * mit derselben Form sind dasselbe Produkt. Ohne 8–14 Ziffern bleibt der
 * Rohwert (sonst fielen alle unbrauchbaren Eingaben in EINE Gruppe).
 * @returns {string|null}
 */
function eanSchluessel(e) {
  if (e == null || e === '') return null;
  const z = ziffern(e);
  return z.length >= 8 && z.length <= 14 ? z.padStart(14, '0') : String(e);
}

/**
 * Alle Schreibweisen derselben GTIN, wie sie in `ean`/`eanRescueOcr` stehen
 * können (8–14 Stellen, nur führende Nullen weggelassen) — für Abfragen mit
 * `in` (höchstens 8 Werte, Firestore erlaubt 30). Der Rohwert ist immer dabei.
 */
function eanVarianten(e) {
  const s = eanSchluessel(e);
  if (!s) return [];
  const out = new Set([String(e)]);
  if (/^\d{14}$/.test(s)) {
    for (let n = 8; n <= 14; n++) {
      if (/^0*$/.test(s.slice(0, 14 - n))) out.add(s.slice(14 - n));
    }
  }
  return [...out];
}

/**
 * Waagen-/Händler-Code mit eingerechnetem Gewicht oder Preis (GS1 „variable
 * measure" / Ladennummern): GTIN-13 mit Präfix 02, 04 oder 20–29, UPC-A mit
 * Zahlsystem 2 oder 4. Die Nummer wechselt von Packung zu Packung — liest das
 * Modell so einen Code, ist das kein Beleg für eine falsche EAN. Lose Ware
 * wird angenommen (Entscheidung Patrick 20.09.2026).
 *
 * EAN-8 ist NIE ausgenommen (Prüfrunde 02.10.2026): EAN-8 mit 0 oder 2 vorne
 * sind bei Lidl, Penny und Norma fest gedruckte Produkt-Barcodes der
 * Eigenmarken (294 von 3.910 Einreichungen mit EAN, 7,5 %). Bis dahin fiel
 * für sie der Abgleich ganz weg — auch wenn eine völlig andere EAN gespeichert
 * war, also genau das Muster „falsche EANs".
 */
function istHandelsCode(code) {
  const c = ziffern(code);
  if (c.length < 12 || c.length > 14) return false;
  return /^(02|04|2)/.test(gtin14(c).slice(1));
}

/** Die vom Barcode-Foto gelesene Nummer — nur mit gültiger Prüfziffer. */
function eanFotoOf(x) {
  const e = x && x.eanFotoOcr && typeof x.eanFotoOcr === 'object' ? ziffern(x.eanFotoOcr.ean) : '';
  return e && pruefzifferOk(e) ? e : null;
}

/**
 * Höchstens so viele der 14 Stellen darf eine Lesung mit falscher Prüfziffer
 * von der gespeicherten Nummer abweichen, um noch als „verlesen" zu gelten
 * (Prüfrunde 2, 02.10.2026). Gemessen in zwei Trockenläufen: echte Lesefehler
 * derselben Nummer lagen bei 1–2 Stellen (eine Ziffer falsch, eine verloren),
 * die übrigen bei 4–12 — dort zeigt das Foto eine andere Nummer.
 */
const MAX_LESEFEHLER_STELLEN = 2;

/** An wie vielen der 14 Stellen (GTIN-14, links mit Nullen) sich zwei Nummern unterscheiden. */
function stellenAbstand(a, b) {
  const x = gtin14(a).slice(-14);
  const y = gtin14(b).slice(-14);
  let n = 0;
  for (let i = 0; i < 14; i++) if (x[i] !== y[i]) n++;
  return n;
}

/**
 * Gespeicherte EAN gegen die Nummer vom Barcode-Foto.
 *
 * Verglichen wird mit `ean` — der Nummer, die die App gescannt oder der Nutzer
 * eingetippt hat. Eine nur nachgelesene EAN (`eanRescueOcr`) stammt selbst aus
 * den Fotos; dort gäbe es nichts zu prüfen.
 *
 * @returns {{art:'gleich'|'abweichend'|'zweifelhaft'|'kein_urteil', gelesen:string|null, gespeichert:string|null, grund?:string, roh?:string, abstand?:number}}
 *   `kein_urteil`: Foto nicht lesbar, Prüfziffer falsch bei höchstens
 *   MAX_LESEFEHLER_STELLEN abweichenden Stellen (ein Lesefehler derselben
 *   Nummer), Waagen-/Händler-Code auf BEIDEN Seiten, oder keine gespeicherte
 *   EAN. Daraus folgt weder Halten noch Freigeben.
 *   `zweifelhaft` (Prüfrunde 2, 02.10.2026): Prüfziffer falsch UND an mehr
 *   als MAX_LESEFEHLER_STELLEN Stellen anders als gespeichert — das Foto zeigt
 *   vermutlich eine andere Nummer. Wird wie eine Abweichung mit einer zweiten
 *   Lesung nachgeprüft (eanFotoBestaetigen); `gelesen` bleibt null (keine
 *   gültige GTIN), die Ziffern stehen in `roh`. Anlass:
 *   Kfs5jFA6qqOF8gD9iTEk — gespeichert 4250231136474, am ersten Tag gelesen
 *   4013602136424 (abweichend, gehalten), am zweiten 4013602313647 (falsche
 *   Prüfziffer, 12 Stellen anders) → „kein Urteil" → freigegeben.
 */
function eanFotoBefund(gespeichertRoh, gelesenRoh) {
  const gelesen = ziffern(gelesenRoh);
  const gespeichert = ziffern(gespeichertRoh) || null;
  if (!gelesen) return { art: 'kein_urteil', gelesen: null, gespeichert, grund: 'nicht_lesbar' };
  if (!pruefzifferOk(gelesen)) {
    const abstand = gespeichert ? stellenAbstand(gelesen, gespeichert) : null;
    if (abstand != null && abstand > MAX_LESEFEHLER_STELLEN) {
      return { art: 'zweifelhaft', gelesen: null, roh: gelesen.slice(0, 14), gespeichert, grund: 'pruefziffer_weit_weg', abstand };
    }
    return { art: 'kein_urteil', gelesen: null, gespeichert, grund: 'pruefziffer' };
  }
  // Waagen-Code nur dann ohne Urteil, wenn auch die gespeicherte Nummer einer
  // ist (Prüfrunde 2, 02.10.2026): dann wechselt die Nummer mit Gewicht/Preis
  // von Packung zu Packung. Ist gespeichert ein normaler Hersteller-Barcode,
  // ist ein Waagen-Code auf dem Foto eine echte Abweichung.
  if (istHandelsCode(gelesen) && (!gespeichert || istHandelsCode(gespeichert))) return { art: 'kein_urteil', gelesen, gespeichert, grund: 'handelscode' };
  if (!gespeichert) return { art: 'kein_urteil', gelesen, gespeichert, grund: 'nichts_gespeichert' };
  if (gtin14(gelesen) === gtin14(gespeichert)) return { art: 'gleich', gelesen, gespeichert };
  return { art: 'abweichend', gelesen, gespeichert };
}

/**
 * Eine Abweichung aus der Bildprüfung wird mit einer ZWEITEN, nur auf das
 * Barcode-Foto gerichteten Lesung nachgeprüft (gemessen 02.10.2026 an 273
 * offenen Fällen: 9 Abweichungen in der Bildprüfung, davon 7 echt — eine von
 * einem unscharfen Foto, bei dem jede Lesung eine andere, aber gültige Nummer
 * erfand, eine von einem dunklen Foto mit einer falsch gelesenen Ziffer).
 *
 *  - zweite Lesung = erste       → `abweichend`, `bestaetigt: true`
 *  - zweite Lesung = gespeichert → `gleich` (die erste Lesung war falsch)
 *  - sonst (leer, unsicher, ungültig, eine dritte Nummer) → `unsicher`
 *
 * `unsicher` hält den Fall ebenfalls an (Prüfrunde 02.10.2026). Patricks
 * Vorgabe lautet: weicht die gelesene Nummer ab, bleibt der Fall liegen. Bis
 * dahin wurde ein unbestätigter Fall freigegeben — auch wenn die zweite Lesung
 * die gespeicherte Nummer genauso wenig bestätigte. Ohne Befund geht es nur
 * weiter, wenn eine Lesung die GESPEICHERTE Nummer liefert. Kosten: rund
 * 2 von 270 Fällen zusätzlich für den Menschen.
 *
 * Seit Prüfrunde 2 (02.10.2026) auch für `zweifelhaft` (falsche Prüfziffer,
 * weit weg): zweite Lesung = gespeichert → `gleich`, sonst `unsicher`
 * (halten). Eine einzelne gültige, andere Nummer bestätigt hier nichts — die
 * erste Lesung war ja keine gültige. Das ist strenger als vorher (bis dahin
 * „kein Urteil", also weiter), keine Abschwächung.
 *
 * Das „gleich" gilt nur, solange kein früherer Lauf den Fall wegen der Nummer
 * angehalten hat — sonst gilt dessen Befund bis zur Entscheidung in der
 * Konsole, auch gegen ein heutiges „gleich" (eanFotoMitVorbefund,
 * Schlussprüfung 03.10.2026).
 *
 * @param {object} befund  eanFotoBefund aus der Bildprüfung
 * @param {string|null} zweitRoh  Ziffern der zweiten Lesung
 */
function eanFotoBestaetigen(befund, zweitRoh) {
  if (!befund) return befund;
  const zweit = ziffern(zweitRoh);
  const gueltig = !!zweit && pruefzifferOk(zweit);
  const istGespeichert = gueltig && !!befund.gespeichert && gtin14(zweit) === gtin14(befund.gespeichert);
  if (befund.art === 'abweichend') {
    // `zweit`: die zweite Lesung selbst — eine Korrektur (eanKorrekturAus) legt
    // beide Lesungen am Dokument ab, nicht nur die erste.
    if (gueltig && gtin14(zweit) === gtin14(befund.gelesen)) return { ...befund, bestaetigt: true, zweit };
    // Erste Lesung eine ANDERE gültige Nummer, zweite die gespeicherte → weiter
    // wie „gleich": die erste gilt als Fehllesung. Entscheidung Patrick
    // 04.10.2026 („ja", Frage 6). Wirkung laut Trockenlauf ~1 Fall/Tag. Gilt
    // nur am ersten Tag — ein angehaltener Fall bleibt bis zum Menschen.
    if (istGespeichert) return { art: 'gleich', gelesen: zweit, gespeichert: befund.gespeichert, grund: 'zweite_lesung' };
    return { art: 'unsicher', gelesen: befund.gelesen, gespeichert: befund.gespeichert, zweit: gueltig ? zweit : null, grund: gueltig ? 'lesungen_uneinig' : 'zweite_lesung_leer' };
  }
  if (befund.art === 'zweifelhaft') {
    if (istGespeichert) return { art: 'gleich', gelesen: zweit, gespeichert: befund.gespeichert, grund: 'zweite_lesung' };
    return { art: 'unsicher', gelesen: null, roh: befund.roh, gespeichert: befund.gespeichert, zweit: gueltig ? zweit : null, grund: gueltig ? 'lesungen_uneinig' : 'zweite_lesung_leer' };
  }
  return befund;
}

/**
 * Die zweite Lesung kam nicht zustande (technischer Fehler oder Arbeitszeit
 * abgelaufen). Nie ein Urteil über die Einreichung, aber auch keine Freigabe:
 * eine Abweichung bleibt (unbestätigt) stehen, eine zweifelhafte Lesung wird
 * `unsicher`.
 */
function eanFotoOhneZweitlesung(befund, fehler) {
  if (!befund) return befund;
  const f = String(fehler || 'unbekannt').slice(0, 80);
  if (befund.art === 'abweichend') return { ...befund, bestaetigt: false, fehler: f };
  if (befund.art === 'zweifelhaft') return { art: 'unsicher', gelesen: null, roh: befund.roh, gespeichert: befund.gespeichert, zweit: null, grund: 'zweite_lesung_gescheitert', fehler: f };
  return befund;
}

/** Befunde, die einen Fall anhalten (Entscheidung Patrick 02.10.2026, 2a). */
const EAN_HALTEN = new Set(['abweichend', 'unsicher']);

/**
 * Der Halte-Befund eines FRÜHEREN Laufs (Prüfrunde 2, 02.10.2026): bis dahin
 * bewertete die Runde die Nummer jeden Morgen neu, nur aus der Lesung dieses
 * Tages — eine Abweichung vom Vortag war vergessen, sobald die nächste Lesung
 * „kein Urteil" ergab (Kfs5jFA6qqOF8gD9iTEk wäre am zweiten Tag freigegeben
 * worden). Jetzt hält ein gespeicherter Befund `abweichend`/`unsicher` an, bis
 * ein Mensch in der Konsole entscheidet (eanFotoMitVorbefund).
 *
 * Quelle ist `eanFotoOcr`; scheiterte dessen Speichern, steht derselbe Befund
 * in `review.rundeOffen.eanFoto` (Prüfkonsolen-Feld, siehe
 * fotoRundeRegeln.rundeOffenEintrag). Hält EINE der beiden Quellen an, gilt
 * der Halt (fail-closed, Schlussprüfung 03.10.2026) — `eanFotoOcr` zuerst.
 * Bis dahin galt der jüngere Lauf: ein neueres „gleich" konnte einen älteren
 * Halt verdrängen. Das ging nur über das automatische Aufheben, das es nicht
 * mehr gibt.
 * Seit 06.10.2026 zählt ein Befund nicht mehr, den eine gespeicherte Korrektur
 * aufgelöst hat (`abweichend` mit genau der korrigierten Nummer, siehe
 * eanKorrekturOf) — `gespeichert` ist dann die korrigierte Nummer, gegen die
 * das Foto seitdem geprüft wird (eanAbgleichOf).
 * `korrekturfaehig`: trägt der Befund allein eine Korrektur (alle Quellen
 * vertrauenswürdig und einig, siehe eanFotoHalteQuellen)? Ein übernommener
 * Befund gibt das beim Neuschreiben weiter (eanFotoMitVorbefund).
 * @returns {{befund:'abweichend'|'unsicher', gelesen:string|null, gespeichert:string|null, bestaetigt:boolean, zweit:string|null, lauf:string|null, quelle:'eanFotoOcr'|'rundeOffen', vertraut:boolean, korrekturfaehig:boolean}|null}
 */
function eanFotoVorbefund(x) {
  const quellen = eanFotoHalteQuellen(x);
  if (!quellen.length) return null;
  const [erste] = quellen;
  const gleich = (q) => q.befund === erste.befund && q.bestaetigt === erste.bestaetigt
    && (q.gelesen ? !!erste.gelesen && gtin14(q.gelesen) === gtin14(erste.gelesen) : !erste.gelesen);
  return { ...erste, korrekturfaehig: quellen.every((q) => q.vertraut && gleich(q)) };
}

/**
 * Lauf, dessen Barcode-Befunde ohne Vermerk (`korrekturfaehig`) noch allein
 * eine Korrektur tragen dürfen: der letzte Lauf des Codes VOR der
 * Barcode-Korrektur (Stand fe89647e). Geprüft 06.10.2026 an den Daten: alle 18
 * haltenden Befunde offener Einreichungen (und ihre Rückfälle in
 * `review.rundeOffen`) stammen aus genau diesem Lauf, keine der Einreichungen
 * existierte beim Lauf davor — jeder Fall wurde also genau einmal angesehen.
 *
 * Warum überhaupt ein Vermerk (Prüfrunde 06.10.2026, Übergangslücke): der
 * alte Code ersetzt JEDEN alten Halt durch eine heute bestätigte Abweichung,
 * egal mit welcher Nummer, und behält einen alten Halt gegen einen heutigen
 * Widerspruch stillschweigend bei — auch im Trockenlauf. Läuft er nach dem
 * 06.10. noch einmal (Zeitplan 08:00 bis zum Ausrollen), steht ein früherer
 * `unsicher` oder ein Widerspruch nirgends mehr; ein Befund „abweichend,
 * bestätigt M" sähe dann aus wie zwei saubere Lesungen. Nachgestellt am
 * echten Fall otzruv…_4 (Delverde Eliche, Foto unscharf, eine Lesung erfand
 * 8002270014512): am Folgetag wäre bei unlesbarem Foto auf die erfundene
 * Nummer korrigiert und bezahlt worden. Deshalb trägt nur ein Befund mit
 * Vermerk (geschrieben vom neuen Code, der Widersprüche festhält) oder einer
 * aus diesem Lauf eine Korrektur allein; jeder andere braucht heute eine
 * eigene zweifache Lesung derselben Nummer (eanKorrekturAus).
 */
const LETZTER_LAUF_OHNE_VERMERK = '2026-10-06_080038';

/**
 * ALLE Halte-Befunde früherer Läufe (`eanFotoOcr` zuerst, dann
 * `review.rundeOffen.eanFoto`) in der Form von eanFotoVorbefund. Eine Korrektur
 * aus einem alten Befund verlangt, dass JEDE Quelle dasselbe sagt
 * (eanKorrekturAus) — eanFotoVorbefund nimmt nur die erste.
 *
 * `vertraut` (Prüfrunde 06.10.2026, Übergangslücke): darf diese Quelle allein
 * eine Korrektur tragen? Nur eine Abweichung, und nur
 *  - mit Vermerk `korrekturfaehig: true` (vom Code seit der Korrektur
 *    geschrieben) und — bei einer bestätigten — der zweiten Lesung `zweit`
 *    gleich der ersten, oder
 *  - ohne Vermerk aus genau LETZTER_LAUF_OHNE_VERMERK (beim Rückfall in
 *    `review.rundeOffen` zählt dessen Lauf: der alte Code schrieb ihn jeden
 *    Morgen neu, auch über einen Widerspruch hinweg).
 * Ein ausdrückliches `korrekturfaehig: false` (Befund aus einer gebremsten
 * Runde ohne Speichern, übernommener nicht vertrauter Befund) ist nie vertraut.
 */
function eanFotoHalteQuellen(x) {
  if (!x || typeof x !== 'object') return [];
  const lauf = (v) => (typeof v === 'string' ? v.slice(0, 40) : null);
  const o = x.eanFotoOcr && typeof x.eanFotoOcr === 'object' ? x.eanFotoOcr : null;
  const ro = x.review && typeof x.review === 'object' && x.review.rundeOffen && typeof x.review.rundeOffen === 'object' ? x.review.rundeOffen : null;
  const r = ro && ro.eanFoto && typeof ro.eanFoto === 'object' ? { ...ro.eanFoto, lauf: ro.lauf } : null;
  const haelt = (b) => !!b && EAN_HALTEN.has(b.befund) && !durchKorrekturErledigt(x, b);
  const gespeichert = ziffern(eanAbgleichOf(x)) || null;
  const vertraut = (q) => {
    if (q.befund !== 'abweichend') return false;
    if (q.korrekturfaehig === true) {
      if (q.bestaetigt !== true) return true; // trägt ohnehin keine Korrektur
      const g = ziffern(q.ean); const z = ziffern(q.zweit);
      return !!g && !!z && gtin14(g) === gtin14(z);
    }
    return q.korrekturfaehig == null && lauf(q.lauf) === LETZTER_LAUF_OHNE_VERMERK;
  };
  return [o, r].filter(haelt).map((q) => ({
    befund: q.befund,
    gelesen: ziffern(q.ean) || null,
    gespeichert,
    bestaetigt: q.bestaetigt === true,
    zweit: ziffern(q.zweit) || null,
    lauf: lauf(q.lauf),
    quelle: q === o ? 'eanFotoOcr' : 'rundeOffen',
    vertraut: vertraut(q),
    // Notbremse der Korrektur hat diesen Befund angehalten (06.10.2026): er
    // wird nie mehr automatisch korrigiert (eanKorrekturAus). Jeder Wert zählt.
    ...(q.korrekturGebremst ? { gebremst: lauf(q.korrekturGebremst) || 'ja' } : {}),
  }));
}

/**
 * Befund dieses Laufs mit dem Halte-Befund eines früheren verbinden
 * (Prüfrunde 2, 02.10.2026; Schlussprüfung 03.10.2026).
 *
 * Ein früher Halte-Befund hält weiter an, bis ein Mensch in der Konsole
 * entscheidet (force + Notiz) — egal, was heute gelesen wird. Ein späteres
 * „kein Urteil" (Foto diesmal unlesbar, Prüfziffer falsch), eine ausgefallene
 * Bildprüfung und auch zwei Lesungen der GESPEICHERTEN Nummer heben ihn nicht
 * auf (Entscheidung Patrick 2a: „Weicht sie ab, bleibt die Einreichung
 * liegen" — ein Mensch entscheidet). Bis zur Schlussprüfung 03.10.2026 hob
 * die Runde einen Halt mit zwei Lesungen der gespeicherten Nummer selbst auf —
 * eine eigene Abschwächung, die Patrick nie vorgelegt war; ein einmal
 * angehaltener Fall kam damit ohne Menschen zur Freigabe.
 *
 * Änderungen am alten Befund (Stand 06.10.2026, Prüfrunde zur Barcode-Korrektur):
 *  - alter `unsicher`: bleibt `unsicher`, was heute auch gelesen wird — auch
 *    zwei gleiche heutige Lesungen ersetzen ihn nicht. Bis dahin ersetzte eine
 *    heute bestätigte Abweichung JEDEN alten Befund; am Folgetag wäre der Fall
 *    dann als korrigierbar erschienen (`ean_unsicher` bleibt beim Menschen).
 *  - alter `abweichend` mit Nummer N:
 *    - heute zweimal N (bestätigt) → der heutige Befund ersetzt ihn (stärkerer
 *      Beleg, hält weiter an); ein Bremsvermerk (`korrekturGebremst`) bleibt.
 *    - heute widerspricht (heuteWiderspricht: die gespeicherte Nummer, eine
 *      andere — auch zweimal gelesen —, falsche Prüfziffer, uneinige Lesungen)
 *      → `unsicher` mit `grund: 'lesungen_uneinig_tage'` und `frueher`, NEU
 *      zu speichern. Damit ist der Widerspruch am Dokument festgehalten: ein
 *      späterer Lauf, der wieder N liest oder nichts lesen kann, darf den Fall
 *      nicht automatisch korrigieren (eanKorrekturAus korrigiert nie aus
 *      `unsicher`). Bis dahin blieb der alte Befund stehen und der Widerspruch
 *      war am nächsten Morgen vergessen.
 *    - sonst (heute keine Bildprüfung, nichts lesbar, N nur einmal gelesen)
 *      → der alte Befund bleibt unverändert.
 *  In jedem Fall hält er weiter an — aufgehoben wird ein alter Halt nur in der
 *  Konsole oder durch die Barcode-Korrektur (eanKorrekturAus).
 *  Ein unverändert übernommener `abweichend` trägt seinen Vermerk
 *  `korrekturfaehig` (eanFotoVorbefund) und seine zweite Lesung weiter, damit
 *  ein Neuschreiben (Rückfall, Bremsvermerk) aus einem nicht vertrauten Befund
 *  keinen vertrauten macht (Prüfrunde 06.10.2026, Übergangslücke).
 *
 * @param {object|null} heute   Befund dieses Laufs (nach zweiter Lesung) oder null (heute keine Bildprüfung)
 * @param {object|null} vorher  eanFotoVorbefund
 * @returns {object|null}  Befund für entscheideFall; aus dem alten Befund
 *   übernommen → mit `vorbefund` (dann nicht neu speichern, außer er stand nur in rundeOffen)
 */
function eanFotoMitVorbefund(heute, vorher) {
  if (!vorher) return heute;
  const heuteKurz = heute ? { art: heute.art, gelesen: heute.gelesen || heute.roh || null } : null;
  if (vorher.befund === 'abweichend') {
    const gleicheNr = heute && !!ziffern(heute.gelesen) && !!vorher.gelesen && gtin14(heute.gelesen) === gtin14(vorher.gelesen);
    if (heute && heute.art === 'abweichend' && heute.bestaetigt === true && gleicheNr) {
      return vorher.gebremst ? { ...heute, korrekturGebremst: vorher.gebremst } : heute;
    }
    if (heuteWiderspricht(heute, vorher.gelesen)) {
      return {
        art: 'unsicher', gelesen: vorher.gelesen, gespeichert: vorher.gespeichert || heute.gespeichert || null,
        zweit: ziffern(heute.gelesen || heute.roh).slice(0, 14) || null, grund: 'lesungen_uneinig_tage',
        frueher: { lauf: vorher.lauf, ean: vorher.gelesen, bestaetigt: vorher.bestaetigt === true }, heute: heuteKurz,
      };
    }
  }
  return {
    art: vorher.befund, gelesen: vorher.gelesen, gespeichert: vorher.gespeichert || (heute && heute.gespeichert) || null,
    // Abweichung: Vermerk und zweite Lesung gehen beim Neuschreiben mit
    // (eanFotoEintrag, rundeOffenEintrag) — ein nicht vertrauter Befund bleibt
    // ausdrücklich `korrekturfaehig: false`, sonst würde er durch das
    // Neuschreiben zum vertrauten. Ein bestätigter Befund des alten Codes trägt
    // kein `zweit`; „bestätigt" hieß dort schon „zweite Lesung = erste".
    ...(vorher.befund === 'abweichend'
      ? { bestaetigt: vorher.bestaetigt, korrekturfaehig: vorher.korrekturfaehig === true, zweit: vorher.zweit || (vorher.bestaetigt ? vorher.gelesen : null) }
      : { zweit: vorher.zweit }),
    ...(vorher.gebremst ? { korrekturGebremst: vorher.gebremst } : {}),
    vorbefund: { lauf: vorher.lauf, quelle: vorher.quelle },
    heute: heuteKurz,
  };
}

/**
 * Was die Runde in `eanFotoOcr` ablegt (ohne `at`/`quelle`/`lauf`). Das Feld
 * wird als GANZES ersetzt, nicht zusammengeführt — sonst blieben `bestaetigt`
 * oder `zweit` eines früheren Laufs neben einem neuen Befund stehen (Prüfrunde
 * 2). `zweifelhaft` wird nie abgelegt (die zweite Lesung macht daraus
 * `gleich` oder `unsicher`); falls doch, als `unsicher`.
 */
function eanFotoEintrag(b) {
  // Korrigiert (06.10.2026): die Foto-Nummer gilt, `vorher` ist die gespeicherte.
  // Hält nicht an (nicht in EAN_HALTEN); die Korrektur selbst steht in `eanKorrektur`.
  if (b.art === 'korrigiert') return { ean: b.gelesen, befund: 'korrigiert', vorher: b.gespeichert || null, korrekturAus: (b.korrektur && b.korrektur.aus) || null };
  const befund = b.art === 'zweifelhaft' ? 'unsicher' : b.art;
  return {
    ean: b.gelesen || b.roh || null, befund,
    ...(b.grund ? { grund: b.grund } : {}),
    // Abweichung (Prüfrunde 06.10.2026, Übergangslücke): beide Lesungen und der
    // Vermerk, ob der Befund allein eine Korrektur tragen darf
    // (eanFotoHalteQuellen). Ein heutiger Befund ist es; ein übernommener nur,
    // wenn er es vorher war (eanFotoMitVorbefund), ein in einer gebremsten Runde
    // ohne Speichern gelesener nicht (taeglicheRunde 4c).
    ...(befund === 'abweichend' ? { bestaetigt: b.bestaetigt === true, zweit: ziffern(b.zweit).slice(0, 14) || null, korrekturfaehig: b.korrekturfaehig !== false } : {}),
    ...(befund === 'unsicher' ? { zweit: b.zweit || null } : {}),
    // Notbremse der Korrektur (06.10.2026): dieser Befund wird nie mehr automatisch korrigiert.
    ...(befund === 'abweichend' && b.korrekturGebremst ? { korrekturGebremst: String(b.korrekturGebremst).slice(0, 40) } : {}),
    ...(b.fehler ? { fehler: String(b.fehler).slice(0, 80) } : {}),
  };
}

/* ── Korrigierte Barcode-Nummer (Entscheidung Patrick 06.10.2026: „ja") ──
 *
 * Eindeutige Fälle korrigiert die Morgenrunde selbst, statt sie liegen zu
 * lassen: das Barcode-Foto wurde von ZWEI unabhängigen Lesungen gleich gelesen
 * (Bildprüfung + zweite Lesung nur des Barcode-Fotos), die Nummer ist eine
 * gültige GTIN (Prüfziffer, 8/12/13/14 Stellen) und kein Waagen-/Händlercode
 * (istHandelsCode: GTIN-13 mit 02/04/20–29, UPC-A mit 2/4 — strenger als
 * „02/20–29 bei 13 Stellen", EAN-8 bleibt korrigierbar). Dann gilt die
 * Foto-Nummer als EAN der Einreichung, und alle weiteren Regeln rechnen mit
 * ihr.
 *
 * Anlass (06.10.2026): 18 von 20 liegenden Fällen hingen an der Barcode-Prüfung,
 * alle von Android (6.0.20/1248, 6.0.17/1240), 12 von einer Person; jede
 * gespeicherte Nummer hatte eine gültige Prüfziffer, oft stimmten nur die
 * letzten 5–6 Ziffern (rechte Hälfte des EAN-13). 8 davon waren zweimal gleich
 * gelesen — genau diese Klasse wird korrigiert. Liest die zweite Lesung nichts
 * oder etwas anderes (`unsicher`), bleibt der Fall beim Menschen.
 *
 * Gespeichert in `eanKorrektur` (nur Server, firestore.rules), NIE in `ean`:
 * die ursprüngliche Nummer bleibt dort für Audit und für die Messung, wie oft
 * der Scanner falsch liest (dieselbe Regel wie bei den *RescueOcr-Feldern).
 */

/**
 * Darf eine Nummer vom Barcode-Foto die gespeicherte ersetzen? Gültige GTIN,
 * kein Waagen-/Händlercode — und keine GTIN-14 mit Packungsindikator 1–9
 * (Prüfrunde 06.10.2026): das ist die Nummer eines Umkartons bzw. einer
 * Handelseinheit (ITF-14 auf dem Versandkarton, in Discountern oft direkt im
 * Regal), nie die des Artikels. Sonst ersetzte die Runde eine richtige EAN-13
 * durch die Kartonnummer derselben Ware. Ein solcher Fall bleibt wie vor dem
 * 06.10. beim Menschen. GTIN-14 mit führender 0 ist dieselbe GTIN-13 und bleibt
 * korrigierbar.
 */
function eanKorrigierbar(code) {
  const c = ziffern(code);
  return pruefzifferOk(c) && !istHandelsCode(c) && !(c.length === 14 && c[0] !== '0');
}

/**
 * Hat ein Mensch die Korrektur verworfen (`eanKorrekturVerworfen`, nur Server,
 * Prüfkonsole „Korrektur verwerfen", Prüfrunde 06.10.2026)? Dann gilt wieder
 * die gespeicherte Nummer — in Runde, Konsole und jeder künftigen
 * Doppel-Prüfung —, und die Runde korrigiert diese Einreichung nie wieder
 * (eanKorrekturAus). Jedes Objekt zählt (fail-closed: lieber keine Korrektur
 * als eine, die ein Mensch zurückgenommen hat).
 */
function eanKorrekturVerworfen(x) {
  return !!(x && x.eanKorrekturVerworfen && typeof x.eanKorrekturVerworfen === 'object');
}

/**
 * Die korrigierte EAN einer Einreichung — nur, wenn der Eintrag in sich stimmt:
 * korrigierbare Nummer, und `vorher` ist genau die gespeicherte `ean` (eine
 * Korrektur gilt nur für die Nummer, die sie korrigiert hat) — und kein Mensch
 * sie verworfen hat (eanKorrekturVerworfen).
 * @returns {string|null}
 */
function eanKorrekturOf(x) {
  const k = x && x.eanKorrektur && typeof x.eanKorrektur === 'object' ? x.eanKorrektur : null;
  if (!k || eanKorrekturVerworfen(x)) return null;
  const neu = ziffern(k.ean);
  const vorher = ziffern(k.vorher);
  const gespeichert = ziffern(x.ean);
  if (!eanKorrigierbar(neu) || !vorher || !gespeichert) return null;
  if (gtin14(vorher) !== gtin14(gespeichert) || gtin14(neu) === gtin14(gespeichert)) return null;
  return neu;
}

/**
 * Nummer, gegen die das Barcode-Foto geprüft wird: nach einer Korrektur die
 * korrigierte (die nächste Bildprüfung soll sie bestätigen, nicht wieder die
 * alte „falsch" finden), sonst die gespeicherte (Rohwert wie bisher).
 */
const eanAbgleichOf = (x) => eanKorrekturOf(x) || (x ? x.ean ?? null : null);

/** Die ursprünglich gespeicherte Nummer einer KORRIGIERTEN Einreichung, sonst null (policyOf.eanVorher). */
const eanVorherOf = (x) => (eanKorrekturOf(x) ? ziffern(x.ean) : null);

/**
 * Alle Nummern einer Einreichung als Gruppenschlüssel (eanSchluessel): die
 * effektive (`ean` der Policy) und — nach einer Korrektur — die ursprünglich
 * gespeicherte (`eanVorher`).
 * @param {{ean?:string|null, eanVorher?:string|null}} p  policyOf
 */
function eanNummern(p) {
  return [...new Set([eanSchluessel(p && p.ean), eanSchluessel(p && p.eanVorher)].filter(Boolean))];
}

/**
 * Verwandt = die beiden teilen eine Nummer (effektiv oder ursprünglich, je
 * Seite). Die Doppel-Regel über ALLE verwandten Einreichungen (`ean_alt_doppelt`,
 * Prüfrunde 06.10.2026) deckt drei Wege ab, die die Gruppe nach effektiver EAN
 * nicht sieht: die eigene alte Nummer = die Nummer einer früheren
 * (korrigiert: ihre neue), eine frühere wurde VON dieser Nummer weg korrigiert,
 * beide wurden von derselben alten Nummer weg korrigiert.
 */
function teilenNummer(a, b) {
  const s = new Set(eanNummern(a));
  return eanNummern(b).some((k) => s.has(k));
}

/**
 * Hat eine gespeicherte Korrektur diesen Halte-Befund aufgelöst? Ja, wenn er
 * `abweichend` mit genau der korrigierten Nummer ist — das ist der Befund, aus
 * dem die Korrektur entstand (z. B. ein Rückfall in `review.rundeOffen`, dessen
 * Aktualisieren scheiterte). Ein späterer Befund GEGEN die korrigierte Nummer
 * trägt eine andere Nummer und hält weiter.
 */
function durchKorrekturErledigt(x, b) {
  const korr = eanKorrekturOf(x);
  return !!korr && !!b && b.befund === 'abweichend' && !!ziffern(b.ean) && gtin14(b.ean) === gtin14(korr);
}

/**
 * Widerspricht die heutige Lesung einem alten Halte-Befund mit Nummer `nr`?
 * Nein, wenn heute keine Bildprüfung lief (null), nichts lesbar war, oder
 * heute dieselbe Nummer gelesen wurde — auch nur einmal (zweite Lesung leer
 * oder technisch gescheitert). Alles andere widerspricht: die gespeicherte
 * Nummer (auch über die zweite Lesung), eine andere — auch zweimal gelesen —,
 * eine Lesung mit falscher Prüfziffer, uneinige Lesungen (fail-closed).
 */
function heuteWiderspricht(heute, nr) {
  if (!heute) return false;
  if (heute.art === 'kein_urteil' && heute.grund === 'nicht_lesbar') return false;
  const gleicheNr = !!nr && !!ziffern(heute.gelesen) && gtin14(heute.gelesen) === gtin14(nr);
  if (heute.art === 'abweichend') return !gleicheNr;
  if (heute.art === 'unsicher') return !(gleicheNr && !heute.zweit);
  return true;
}

/**
 * Korrektur aus dem heutigen Befund (nach zweiter Lesung) bzw. aus einem
 * gespeicherten Halte-Befund.
 *
 *  - Ohne alten Befund: heute `abweichend` UND `bestaetigt` (zweite Lesung =
 *    erste) UND korrigierbar.
 *  - Mit altem Befund (Patricks „ja" hebt für GENAU diese Klasse die Regel
 *    „ein angehaltener Fall wird nie automatisch aufgehoben" auf): JEDE
 *    haltende Quelle (eanFotoOcr, review.rundeOffen.eanFoto) sagt `abweichend`,
 *    `bestaetigt`, dieselbe korrigierbare Nummer, keine trägt einen Bremsvermerk
 *    (`korrekturGebremst`) — UND heute lief eine Bildprüfung, und zwar:
 *    - sind alle Quellen vertraut (eanFotoHalteQuellen `vertraut`: Vermerk
 *      `korrekturfaehig` oder Lauf LETZTER_LAUF_OHNE_VERMERK): eine, die nicht
 *      widerspricht (heuteWiderspricht; nichts lesbar zählt nicht als
 *      Widerspruch);
 *    - sonst (Prüfrunde 06.10.2026, Übergangslücke): heute selbst `abweichend`
 *      UND `bestaetigt` mit derselben Nummer — „nichts lesbar" reicht dort
 *      nicht, der alte Befund könnte einen Widerspruch oder ein `unsicher`
 *      verdecken. Ergebnis mit `heuteBestaetigt: true`.
 *    Ohne Bildprüfung heute keine Korrektur aus einem alten Befund (Prüfrunde
 *    06.10.2026: sonst hätte ein Ausfall der Bildprüfung als Bestätigung
 *    gegolten). Ein alter `unsicher`-Befund — auch einer aus Lesungen, die
 *    sich über Tage widersprachen (`lesungen_uneinig_tage`,
 *    eanFotoMitVorbefund) — wird nie korrigiert.
 *  - Höchstens EINE Korrektur je Einreichung: steht schon eine, korrigiert die
 *    Runde nie wieder (eine weitere Abweichung gegen die korrigierte Nummer
 *    hält an — zwei Korrekturen wären kein eindeutiger Fall mehr). Hat ein
 *    Mensch eine Korrektur verworfen (eanKorrekturVerworfen), ebenfalls nie.
 *
 * @param {object} x  Einreichung
 * @param {object|null} heute  heutiger Befund nach zweiter Lesung, OHNE alten Befund (eanFotoBestaetigen/eanFotoOhneZweitlesung), null = heute keine Bildprüfung
 * @returns {{ean:string, vorher:string, lesungen:string[], aus:'heute'|'vorbefund', befundVom:string|null, heuteBestaetigt?:boolean}|null}
 */
function eanKorrekturAus(x, heute) {
  if (!x || typeof x !== 'object' || eanKorrekturOf(x) || eanKorrekturVerworfen(x)) return null;
  const vorher = ziffern(x.ean);
  if (!vorher) return null;
  const quellen = eanFotoHalteQuellen(x);
  if (quellen.length) {
    const neu = quellen[0].gelesen;
    const einig = quellen.every((q) => q.befund === 'abweichend' && q.bestaetigt === true && !q.gebremst && !!q.gelesen && gtin14(q.gelesen) === gtin14(neu));
    if (!einig || !heute || !eanKorrigierbar(neu) || gtin14(neu) === gtin14(vorher)) return null;
    const vertraut = quellen.every((q) => q.vertraut);
    const heuteBestaetigt = heute.art === 'abweichend' && heute.bestaetigt === true && !heute.korrekturGebremst
      && !!ziffern(heute.gelesen) && gtin14(heute.gelesen) === gtin14(neu);
    if (vertraut ? heuteWiderspricht(heute, neu) : !heuteBestaetigt) return null;
    return { ean: neu, vorher, lesungen: [neu, neu], aus: 'vorbefund', befundVom: quellen[0].lauf || null, ...(vertraut ? {} : { heuteBestaetigt: true }) };
  }
  if (!heute || heute.art !== 'abweichend' || heute.bestaetigt !== true || heute.korrekturGebremst || !eanKorrigierbar(heute.gelesen)) return null;
  const neu = ziffern(heute.gelesen);
  if (gtin14(neu) === gtin14(vorher)) return null;
  return { ean: neu, vorher, lesungen: [neu, ziffern(heute.zweit) || neu], aus: 'heute', befundVom: null };
}

/** Befund „korrigiert" für entscheideFall: hält nicht an; die Regeln rechnen mit `gelesen`. */
function eanFotoKorrigiert(k) {
  return { art: 'korrigiert', gelesen: k.ean, gespeichert: k.vorher, bestaetigt: true, korrektur: k };
}

/** Was in `eanKorrektur` am Dokument landet (ohne `at`/`lauf`/`quelle`, die setzt die Runde). */
function eanKorrekturEintrag(k) {
  return {
    ean: k.ean, vorher: k.vorher, lesungen: (k.lesungen || []).slice(0, 2), aus: k.aus,
    ...(k.befundVom ? { befundVom: k.befundVom } : {}),
    // Alter Befund ohne Vermerk, heute selbst zweimal gelesen (eanKorrekturAus).
    ...(k.heuteBestaetigt ? { heuteBestaetigt: true } : {}),
    // Ohne Namen: das Dokument darf der Einreicher selbst lesen (firestore.rules).
    regel: 'Barcode-Korrektur 06.10.2026: Foto-Nummer zweimal gleich gelesen, gültige GTIN, kein Waagen-Code',
  };
}

/** Bildarten, auf denen ein Preis steht (Lesedienst und Nachlesung benutzen dieselben Namen). */
const PREIS_ARTEN = ['preisschild', 'kassenbon', 'beides'];

/**
 * Anzeichen, dass im Bild doch ein Preis ist, obwohl keiner gelesen wurde: der
 * Lesedienst hat beim Anlegen ein Preisschild oder einen Kassenbon erkannt.
 * Widerspricht das einer Bildprüfung, die „kein Preis" sagt, lehnt die
 * Morgenrunde NICHT ab, sondern lässt den Fall liegen (Preis-Pflicht 26.09.2026).
 * @returns {string|null} kurzer Hinweis für den Menschen
 */
function preisHinweisOf(x) {
  const art = String(x.priceImageKind || '').toLowerCase();
  if (PREIS_ARTEN.includes(art)) return `Lesedienst sah auf dem Preisfoto: ${art}`;
  const b = x.priceReceipt;
  if (b && (b.zip || b.city || b.merchant || b.street)) return 'Lesedienst erkannte einen Kassenbon';
  return null;
}

module.exports = {
  pruefzifferOk, eanOf, nameOf, preisOf, policyOf, einreichZeit, herstellerAnzeige, vollstaendigkeitOf, herkunftOf, preisHinweisOf, PREIS_ARTEN,
  gtin14, eanSchluessel, eanVarianten, istHandelsCode, eanFotoOf, eanFotoBefund, eanFotoBestaetigen,
  eanFotoOhneZweitlesung, eanFotoVorbefund, eanFotoMitVorbefund, eanFotoEintrag, stellenAbstand, MAX_LESEFEHLER_STELLEN, EAN_HALTEN,
  eanKorrigierbar, eanKorrekturOf, eanAbgleichOf, durchKorrekturErledigt, eanKorrekturAus, eanFotoKorrigiert, eanKorrekturEintrag, eanFotoHalteQuellen,
  heuteWiderspricht, eanVorherOf, eanNummern, teilenNummer, eanKorrekturVerworfen, LETZTER_LAUF_OHNE_VERMERK,
};
