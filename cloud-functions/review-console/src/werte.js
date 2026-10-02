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

const eanOf = (x) => x.ean || gerettetEan(x) || null;
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
 */
const policyOf = (id, x, serverZeit = null) => ({
  id, userId: x.userId ?? null, ean: eanOf(x), marketId: x.marketId ?? null,
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
    if (gueltig && gtin14(zweit) === gtin14(befund.gelesen)) return { ...befund, bestaetigt: true };
    // Erste Lesung eine ANDERE gültige Nummer, zweite die gespeicherte → weiter
    // wie „gleich". Eigene Annahme, Patrick vorgelegt am 03.10.2026
    // (WISSEN-FOTORUNDE.md, „Offen für Patrick"): die erste Lesung gilt als
    // Fehllesung. Patricks Wortlaut („weicht sie ab, bleibt die Einreichung
    // liegen") ließe auch Halten zu. Wirkung laut Trockenlauf ~1 Fall/Tag.
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
 * @returns {{befund:'abweichend'|'unsicher', gelesen:string|null, gespeichert:string|null, bestaetigt:boolean, zweit:string|null, lauf:string|null, quelle:'eanFotoOcr'|'rundeOffen'}|null}
 */
function eanFotoVorbefund(x) {
  if (!x || typeof x !== 'object') return null;
  const lauf = (v) => (typeof v === 'string' ? v.slice(0, 40) : null);
  const o = x.eanFotoOcr && typeof x.eanFotoOcr === 'object' ? x.eanFotoOcr : null;
  const ro = x.review && typeof x.review === 'object' && x.review.rundeOffen && typeof x.review.rundeOffen === 'object' ? x.review.rundeOffen : null;
  const r = ro && ro.eanFoto && typeof ro.eanFoto === 'object' ? { ...ro.eanFoto, lauf: ro.lauf } : null;
  const haelt = (b) => !!b && EAN_HALTEN.has(b.befund);
  const quelle = haelt(o) ? o : haelt(r) ? r : null;
  if (!quelle) return null;
  return {
    befund: quelle.befund,
    gelesen: ziffern(quelle.ean) || null,
    gespeichert: ziffern(x.ean) || null,
    bestaetigt: quelle.bestaetigt === true,
    zweit: ziffern(quelle.zweit) || null,
    lauf: lauf(quelle.lauf),
    quelle: quelle === o ? 'eanFotoOcr' : 'rundeOffen',
  };
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
 * Einzige Änderung am alten Befund: eine heute BESTÄTIGTE Abweichung ersetzt
 * ihn (stärkerer Beleg, er hält weiter an); alles andere lässt ihn stehen.
 *
 * @param {object|null} heute   Befund dieses Laufs (nach zweiter Lesung) oder null (heute keine Bildprüfung)
 * @param {object|null} vorher  eanFotoVorbefund
 * @returns {object|null}  Befund für entscheideFall; aus dem alten Befund
 *   übernommen → mit `vorbefund` (dann nicht neu speichern, außer er stand nur in rundeOffen)
 */
function eanFotoMitVorbefund(heute, vorher) {
  if (!vorher) return heute;
  if (heute && heute.art === 'abweichend' && heute.bestaetigt === true) return heute;
  return {
    art: vorher.befund, gelesen: vorher.gelesen, gespeichert: vorher.gespeichert || (heute && heute.gespeichert) || null,
    ...(vorher.befund === 'abweichend' ? { bestaetigt: vorher.bestaetigt } : { zweit: vorher.zweit }),
    vorbefund: { lauf: vorher.lauf, quelle: vorher.quelle },
    heute: heute ? { art: heute.art, gelesen: heute.gelesen || heute.roh || null } : null,
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
  const befund = b.art === 'zweifelhaft' ? 'unsicher' : b.art;
  return {
    ean: b.gelesen || b.roh || null, befund,
    ...(b.grund ? { grund: b.grund } : {}),
    ...(befund === 'abweichend' ? { bestaetigt: b.bestaetigt === true } : {}),
    ...(befund === 'unsicher' ? { zweit: b.zweit || null } : {}),
    ...(b.fehler ? { fehler: String(b.fehler).slice(0, 80) } : {}),
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
};
