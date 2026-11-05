'use strict';

/**
 * Wo wurde eingekauft? — die Antwort für Prüfwerkzeug und Karte (07.09.2026).
 *
 * ═══ Dieses Modul entscheidet die Rangfolge NICHT ═══
 *
 * Das tut seit August 2026 `cloud-functions/crowd-upload-location/src/scorer.js`
 * und schreibt das Ergebnis als `probableLocation` ans Dokument — mit Quelle,
 * Konfidenz, Granularität, den mitbewertenden Signalen und `usableFor` als
 * Missbrauchsschutz. Beim ersten Bau stand die Rangfolge hier ein zweites Mal;
 * zwei Entscheider über dieselbe Frage laufen im Betrieb auseinander. Also:
 * `probableLocation` ist die Autorität, hier steht nur, was dort fehlt —
 * Koordinaten zu Ortsnamen (224 von 234 Stadt-Angaben tragen keine), die
 * Filialadresse bei Bons (dort gibt es kein `probableLocation`) und die
 * Auffälligkeiten.
 *
 *
 * Bis hierher zeigte das Prüf-Werkzeug als Ort das Wort „GPS" an. Das ist die
 * Herkunft der Angabe, nicht der Ort — und beantwortet die Frage nicht, die
 * jemand beim Prüfen hat: *wo war dieser Mensch?*
 *
 * Es gibt vier Quellen. Ihre Reihenfolge ist nicht Geschmackssache, sondern an
 * den eigenen Daten gemessen (Stand 07.09.2026, 1.613 Einreichungen und 6.478
 * Bons):
 *
 *  1. GERÄTESTANDORT zur Aufnahme (`capture.gps`) — 458 Einreichungen.
 *     Genauigkeit: 246× besser als 20 m, 341× besser als 50 m, 433 von 458
 *     besser als 100 m. Das ist der einzige echte Aufnahmeort. Bons haben ihn
 *     nie (dort wird nichts fotografiert, was ein GPS mitschreibt).
 *
 *  2. FILIALADRESSE vom Kassenbon — bei Bons `store` (5.419 von 6.478 mit
 *     Postleitzahl), bei Produktfotos `priceReceipt`, wenn das Preisbild ein
 *     Kassenbon ist (286 vollständig). Straße und Hausnummer stehen darauf; für
 *     die Karte wird die Postleitzahl aufgelöst. Gemessen gegen 120 Fälle mit
 *     gleichzeitigem GPS-Fix: Median 2,0 km, 90. Perzentil 7,8 km daneben.
 *     Für „in welcher Stadt wurde gekauft" also belastbar, für „an welcher
 *     Ecke" nicht.
 *
 *  3. VOM NUTZER ANGEGEBENER ORT (`capture.confirmedPlace.city`) — 132×.
 *     Beantwortet eine ANDERE Frage: bei 25 Einreichungen mit beidem stimmte
 *     er nur 9× mit dem Bon-Ort überein, und die Abweichungen sind Wohnort
 *     gegen Einkaufsort (Kotzenbüll/Tönning, 7 km) oder Schreibweisen
 *     (Nettersheim/Nettersheim-Zingsheim). Deshalb hinter dem Bon, nicht davor.
 *
 *  4. NETZZUGANG (IP-Ortung, `journeyLocation`) — 1.397×, also die häufigste
 *     und zugleich die einzige, die als Ort NICHTS taugt: gegen 440 echte
 *     GPS-Fixes gemessen liegt sie im Median 59,8 km daneben, im 90. Perzentil
 *     293 km, im Extrem 9.628 km. Sie wird hier NICHT als Ort geführt und
 *     erscheint auch auf keiner Karte. Sie bleibt am Dokument, taugt aber nur
 *     für die Aussage „welches Land".
 *
 * Was NICHT als Ort zählt: der Marktname. „LiDL" steht an 1.613 von 1.613
 * Einreichungen und benennt die Kette, nicht die Filiale — es gibt tausende.
 */

const PLZ = require('../data/plz.json');

/** Vertrauensstufen, absteigend. Die Zahl ist der typische Fehler in Metern. */
const GENAUIGKEIT = {
  geraet: 50,
  filiale: 2000,
  nutzerangabe: 8000,
};

const normOrt = (s) => String(s || '').toLowerCase().replace(/[^a-zäöüß]/g, '');

/** Postleitzahl → Koordinate. Land ist optional, Standard Deutschland. */
function plzKoordinate(plz, land) {
  const p = String(plz || '').trim();
  if (!p) return null;
  const l = String(land || 'DE').toUpperCase().slice(0, 2);
  const e = PLZ[`${l}:${p}`] || (l !== 'DE' ? PLZ[`DE:${p}`] : null) || PLZ[`AT:${p}`];
  return e ? { lat: e[0], lon: e[1], ort: e[2], bundesland: e[3] } : null;
}

/**
 * Ortsname → Koordinate über die Postleitzahlen-Tabelle.
 *
 * Menschen schreiben Orte anders, als sie im Verzeichnis stehen:
 * „Nettersheim-Zingsheim" für den Ortsteil, „Frankfurt (Oder)" mit Zusatz,
 * „Sankt Wendel" gegen „St. Wendel". Ohne diese Nachsicht blieben zwei Drittel
 * der Nutzerangaben ohne Punkt auf der Karte (gemessen: 47 von 132 aufgelöst).
 * Darum drei Stufen, jede strenger belegt als die nächste.
 */
let ortIndex = null;
function bauOrtIndex() {
  ortIndex = new Map();
  for (const [schluessel, e] of Object.entries(PLZ)) {
    if (e[4] === 1 || istFirmenname(e[2])) continue; // ein Firmenname ist kein Ortsname
    const land = schluessel.slice(0, 2);
    const k = `${land}|${normOrt(e[2])}`;
    if (!ortIndex.has(k)) ortIndex.set(k, []);
    ortIndex.get(k).push(e);
  }
}
function mittelpunkt(treffer) {
  const lat = treffer.reduce((s, e) => s + e[0], 0) / treffer.length;
  const lon = treffer.reduce((s, e) => s + e[1], 0) / treffer.length;
  return { lat: Math.round(lat * 1e4) / 1e4, lon: Math.round(lon * 1e4) / 1e4, ort: treffer[0][2], bundesland: treffer[0][3] };
}
function ortKoordinate(ortsname, land, zusatz) {
  const roh = String(ortsname || '').trim();
  if (roh.length < 3) return null;
  if (!ortIndex) bauOrtIndex();
  const l = String(land || 'DE').toUpperCase().slice(0, 2);
  // Zuerst die eigenen Bon-Adressen — sie kennen auch kleine Orte.
  const eigen = zusatz && zusatz.get(`${l}|${normOrt(roh)}`);
  if (eigen) return eigen;

  const varianten = [roh];
  // Zusatz in Klammern weg: „Frankfurt (Oder)" → „Frankfurt"
  const ohneKlammer = roh.replace(/\s*\([^)]*\)\s*/g, ' ').trim();
  if (ohneKlammer && ohneKlammer !== roh) varianten.push(ohneKlammer);
  // Ortsteil abtrennen: „Nettersheim-Zingsheim" → „Nettersheim" (und der Teil danach)
  for (const teil of roh.split(/[-–/,]/)) {
    const t = teil.trim();
    if (t.length >= 3) varianten.push(t);
  }
  // Abkürzungen ausschreiben, wie das Verzeichnis sie führt
  varianten.push(roh.replace(/\bSt\.?\s+/i, 'Sankt '), roh.replace(/\bSankt\s+/i, 'St. '));
  varianten.push(roh.replace(/\ba\.?\s*d\.?\s+/i, 'an der '), roh.replace(/\ba\.?\s*M\.?$/i, 'am Main'));

  for (const v of varianten) {
    const treffer = ortIndex.get(`${l}|${normOrt(v)}`);
    if (treffer && treffer.length) return mittelpunkt(treffer);
  }
  // BEWUSST KEIN Präfix-Abgleich als letzte Stufe. Der Versuch kostete beim
  // Bauen zwei Fehltreffer: „Kotzenbüll" (Schleswig-Holstein) landete auf
  // „Kotzen" (Brandenburg, 300 km entfernt), „Neustadt" auf einem beliebigen
  // von zwanzig. Ein falscher Punkt auf einer Karte, nach der jemand
  // entscheidet, ist schlimmer als gar keiner.
  return null;
}

/**
 * Ergänzendes Ortsverzeichnis aus den EIGENEN Bon-Adressen.
 *
 * Das öffentliche Postleitzahlen-Verzeichnis führt nur Hauptgemeinden — weder
 * „Schleusingen" noch „Kotzenbüll" stehen darin, obwohl beide echte Orte sind,
 * in denen unsere Nutzer einkaufen. Die Kassenbons kennen sie: dort steht der
 * Ortsname zusammen mit der Postleitzahl, und die lässt sich auflösen. Der
 * Aufrufer baut das Verzeichnis einmal aus den Bons und reicht es durch.
 *
 * @param {Array<{city: string, zip: string, country?: string}>} adressen
 * @returns {Map<string, {lat, lon, ort, bundesland}>}
 */
function ortsverzeichnisAusBons(adressen) {
  const v = new Map();
  for (const a of adressen || []) {
    if (!a || !a.city || !a.zip) continue;
    const schluessel = `${String(a.country || 'DE').toUpperCase().slice(0, 2)}|${normOrt(a.city)}`;
    if (v.has(schluessel)) continue;
    const k = plzKoordinate(a.zip, a.country);
    if (k) v.set(schluessel, { ...k, ort: a.city });
  }
  return v;
}

const ms = (v) => (v && typeof v.toMillis === 'function' ? v.toMillis() : null);

/**
 * Der Ort EINER Produktfoto-Einreichung.
 * @returns {{quelle, label, genauigkeitM, lat, lon, plz, ort, bundesland, land, alternativen}}
 */
/**
 * Grobe Länderzuordnung für Punkte außerhalb DACH — damit ein Aufnahmeort in
 * Belgien „Belgien" heißt statt namenlos in der Landschaft zu stehen. Bewusst
 * nur Rechtecke: die Frage ist „passt das überhaupt zusammen", nicht „welche
 * Gemeinde". Überlappen zwei Rechtecke an einer Grenze, gibt es keinen Namen
 * statt eines falschen.
 */
const LAENDER = [
  ['Deutschland', 47.27, 55.06, 5.87, 15.04], ['Österreich', 46.37, 49.02, 9.53, 17.16],
  ['Schweiz', 45.82, 47.81, 5.96, 10.49], ['Belgien', 49.50, 51.51, 2.55, 6.41],
  ['Niederlande', 50.75, 53.56, 3.36, 7.23], ['Luxemburg', 49.45, 50.19, 5.73, 6.53],
  ['Frankreich', 42.33, 51.09, -4.80, 8.23], ['Italien', 36.65, 47.09, 6.62, 18.52],
  ['Dänemark', 54.56, 57.75, 8.07, 12.69], ['Polen', 49.00, 54.84, 14.12, 24.15],
  ['Tschechien', 48.55, 51.06, 12.09, 18.86], ['Spanien', 36.00, 43.79, -9.30, 3.32],
  ['Kroatien', 42.38, 46.55, 13.49, 19.45], ['Ungarn', 45.74, 48.59, 16.11, 22.90],
  ['Großbritannien', 49.96, 58.64, -8.65, 1.76], ['Schweden', 55.34, 69.06, 11.11, 24.16],
  ['Türkei', 35.81, 42.11, 25.66, 44.83], ['Griechenland', 34.80, 41.75, 19.37, 28.25],
  ['USA', 24.52, 49.38, -124.77, -66.95],
];
function landAusKoordinate(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  const treffer = LAENDER.filter(([, laMin, laMax, loMin, loMax]) => lat >= laMin && lat <= laMax && lon >= loMin && lon <= loMax);
  return treffer.length === 1 ? treffer[0][0] : null;
}
const inDACH = (lat, lon) => lat >= 45.8 && lat <= 55.1 && lon >= 5.8 && lon <= 17.2;
/** Länderkürzel, soweit sie im Projekt vorkommen. */
const KURZ = { Deutschland: 'DE', Österreich: 'AT', Schweiz: 'CH', Belgien: 'BE', Niederlande: 'NL', Luxemburg: 'LU', Frankreich: 'FR', Italien: 'IT', Dänemark: 'DK', Polen: 'PL', Tschechien: 'CZ', Spanien: 'ES', Kroatien: 'HR', Ungarn: 'HU', Großbritannien: 'GB', Schweden: 'SE', Türkei: 'TR', Griechenland: 'GR', USA: 'US' };

/** Standardstandorte der Entwickler-Simulatoren — ein Fix von dort ist kein Einkauf. */
const SIMULATOR_ORTE = [
  ['iOS-Simulator, San Francisco', 37.7858, -122.4064],
  ['iOS-Simulator, Apple Park', 37.3349, -122.0090],
  ['Android-Emulator, Mountain View', 37.4220, -122.0840],
];

/**
 * Was an dieser Ortsangabe erklärungsbedürftig ist — leer heißt unauffällig.
 *
 * Anlass: eine Einreichung stand mit einem sehr genauen Standort (± 4 m) in
 * Belgien, bei einem Markt, der für Deutschland hinterlegt ist. Der Punkt war
 * richtig, das Werkzeug sagte nur nicht, dass daran etwas bemerkenswert ist.
 * Gemessen an 458 Gerätestandorten: 2 außerhalb DACH (einer davon auf dem
 * Standardstandort des iOS-Simulators), 10 gröber als ein Kilometer.
 */
function auffaelligkeiten({ lat, lon, genauigkeitM, erwartetesLand, quelle }) {
  const raus = [];
  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    for (const [name, sLat, sLon] of SIMULATOR_ORTE) {
      // Eng: der Simulator liefert exakt dieselben Koordinaten. 0,01 Grad sind
      // rund einen Kilometer — weit genug für Rundungen, eng genug, um einen
      // echten Aufenthalt in derselben Stadt nicht fälschlich zu beschuldigen.
      if (Math.abs(lat - sLat) < 0.01 && Math.abs(lon - sLon) < 0.01) {
        return [{ art: 'simulator', text: `Standardstandort eines Entwickler-Simulators (${name}) — das ist keine echte Aufnahme` }];
      }
    }
    if (!inDACH(lat, lon)) {
      const land = landAusKoordinate(lat, lon);
      raus.push({
        art: 'ausland',
        text: land
          ? `Aufnahmeort liegt in ${land}, außerhalb des Aktionsgebiets`
          : `Aufnahmeort liegt weit außerhalb des Aktionsgebiets (${lat.toFixed(2)}, ${lon.toFixed(2)})`,
      });
    } else if (erwartetesLand) {
      const land = landAusKoordinate(lat, lon);
      const kurz = { Deutschland: 'DE', Österreich: 'AT', Schweiz: 'CH' }[land];
      if (kurz && kurz !== String(erwartetesLand).toUpperCase()) {
        raus.push({ art: 'landabweichung', text: `Aufnahmeort liegt in ${land}, der Markt ist für ${erwartetesLand} hinterlegt` });
      }
    }
  }
  // Erst ab fünf Kilometern ist die Stadt nicht mehr sicher — bei ein bis zwei
  // Kilometern steht der Ortsname korrekt da. Die Schwelle lag zuerst bei einem
  // Kilometer und erzeugte damit zehn von zwölf Warnungen für Fälle, an denen
  // nichts zu beanstanden war; eine Warnung, die zu oft kommt, wird überlesen.
  if (quelle === 'geraet' && Number.isFinite(genauigkeitM) && genauigkeitM > 5000) {
    raus.push({ art: 'ungenau', text: `Der Standort ist nur auf ${Math.round(genauigkeitM / 1000)} km genau — der Ort darüber ist geraten` });
  }
  return raus;
}

const QUELLE_TEXT = {
  // ploc-v2 (24.09.2026): Filialadresse vom Kassenbon auf dem Preisfoto ist
  // Ortsquelle Nr. 1 im Ortsschätzer (crowd-upload-location/src/scorer.js).
  receipt_address: ['filiale', 'Filialadresse vom Kassenbon auf dem Preisfoto'],
  gps_capture: ['geraet', 'Standort des Geräts bei der Aufnahme'],
  exif_gps: ['geraet', 'Standort aus den Bilddaten'],
  user_confirmed_place: ['nutzerangabe', 'Ort, den der Nutzer angegeben hat'],
  user_profile_region: ['profil', 'Wohnort laut Profilangabe'],
  market_country: ['land', 'nur das Land des gewählten Marktes'],
};

function ortVonEinreichung(doc, zusatz) {
  const c = doc?.capture || {};
  const erwartet = doc?.marketLand || null;
  const p = doc?.probableLocation;

  // Der Ortsschätzer hat bereits entschieden — hier wird nur ergänzt.
  if (p && p.source) {
    const [quelle, wort] = QUELLE_TEXT[p.source] || ['unbekannt', String(p.source)];
    let lat = Number.isFinite(p.lat) ? p.lat : null;
    let lon = Number.isFinite(p.lon) ? p.lon : null;
    let ort = p.city || null;
    let plz = null;
    let bundesland = p.bundesland || null;

    // Die Lücke, für die dieses Modul da ist: `granularity: 'city'` trägt einen
    // Ortsnamen, aber keine Koordinate.
    // Der Schätzer schreibt das Land als `land` (scorer.js). `country` gab es
    // hier nie — gemessen an 1.207 Dokumenten: 1.207× `land`, 0× `country`.
    // Beide lesen, damit ein späterer Umbau im Schätzer nichts bricht.
    const land = p.land ?? p.country ?? null;
    if (lat == null && ort) {
      const k = ortKoordinate(ort, land || erwartet, zusatz);
      if (k) { lat = k.lat; lon = k.lon; bundesland = bundesland || k.bundesland; }
    }
    // Umgekehrt: eine Koordinate ohne Namen bekommt einen. Die Tabelle deckt
    // DE und AT ab — ein Punkt außerhalb bekommt darum das LAND als Namen und
    // nicht das Etikett des Marktes, das dort nichts mehr aussagt.
    let ausserhalb = null;
    if (lat != null && !ort) {
      const t = naechsteOrtschaft(lat, lon);
      if (t) { ort = t.ort; plz = t.plz; bundesland = bundesland || t.bundesland; }
      else ausserhalb = landAusKoordinate(lat, lon);
    }
    const genauigkeitM = Number.isFinite(p.accuracyM) ? Math.round(p.accuracyM) : null;
    // Quelle Bon (ploc-v2): probableLocation trägt weder PLZ noch Straße —
    // die stehen am Bon selbst. Dieselbe Schreibweise wie im Altpfad.
    const bonQuelle = p.source === 'receipt_address' ? doc?.priceReceipt || null : null;
    if (bonQuelle?.zip) plz = String(bonQuelle.zip);
    const bonLabel = bonQuelle
      ? [bonQuelle.street, [bonQuelle.zip, bonQuelle.city || ort].filter(Boolean).join(' ')].filter(Boolean).join(', ')
      : null;
    return {
      quelle, quelleText: wort,
      granularitaet: p.granularity || null,
      konfidenz: p.confidence || null,
      label: bonLabel
        ? bonLabel
        : ort
        ? `${ort}${plz ? `, ${plz}` : ''}`
        : lat != null
          ? `${ausserhalb || 'außerhalb der Ortstabelle'} (${lat.toFixed(3)}, ${lon.toFixed(3)})`
          : (land ? `nur das Land ist bekannt: ${land}` : 'Ort nicht bestimmbar'),
      genauigkeitM,
      lat, lon, plz, ort, bundesland,
      // Liegt der gemessene Punkt außerhalb des erwarteten Landes, gilt die
      // Messung — sonst stünde an einem Punkt in Belgien „DE", nur weil der
      // Markt dafür hinterlegt ist.
      land: (lat != null && ausserhalb ? KURZ[ausserhalb] || ausserhalb : null) || land || erwartet || null,
      erfasstAm: ms(c.capturedAt),
      auffaellig: auffaelligkeiten({ lat, lon, genauigkeitM, erwartetesLand: erwartet, quelle }),
      alternativen: weitereQuellen(doc, quelle),
      herkunft: 'probableLocation',
    };
  }

  // Rückfall für Einreichungen ohne `probableLocation` — alle aus der Zeit vor
  // August 2026, als der Ortsschätzer eingeführt wurde.
  const g = c.gps;
  if (g && Number.isFinite(g.lat) && Number.isFinite(g.lon)) {
    const genau = Number.isFinite(g.accuracyM) ? Math.round(g.accuracyM) : GENAUIGKEIT.geraet;
    const treffer = naechsteOrtschaft(g.lat, g.lon);
    return {
      quelle: 'geraet', quelleText: 'Standort des Geräts bei der Aufnahme',
      granularitaet: 'point', konfidenz: null, herkunft: 'altbestand',
      auffaellig: auffaelligkeiten({ lat: g.lat, lon: g.lon, genauigkeitM: genau, erwartetesLand: erwartet, quelle: 'geraet' }),
      label: treffer ? `${treffer.ort}${treffer.plz ? `, ${treffer.plz}` : ''}` : 'Gerätestandort ohne Ortszuordnung',
      genauigkeitM: genau,
      lat: g.lat, lon: g.lon,
      plz: treffer?.plz ?? null, ort: treffer?.ort ?? null, bundesland: treffer?.bundesland ?? null,
      land: doc?.marketLand || treffer?.land || null,
      erfasstAm: ms(g.fixAt) ?? ms(c.capturedAt),
      alternativen: weitereQuellen(doc, 'geraet'),
    };
  }

  // 2) Filialadresse vom Kassenbon im Preisbild
  const bon = doc?.priceReceipt;
  if (bon && bon.zip) {
    const k = plzKoordinate(bon.zip, bon.country || doc?.marketLand);
    return {
      quelle: 'filiale', quelleText: 'Adresse auf dem Kassenbon im Preisbild',
      granularitaet: 'store', konfidenz: null, herkunft: 'altbestand', auffaellig: [],
      label: [bon.street, [bon.zip, bon.city || k?.ort].filter(Boolean).join(' ')].filter(Boolean).join(', ') || 'Filiale laut Bon',
      genauigkeitM: GENAUIGKEIT.filiale,
      lat: k?.lat ?? null, lon: k?.lon ?? null,
      plz: bon.zip, ort: bon.city || k?.ort || null, bundesland: k?.bundesland ?? null,
      land: (bon.country || doc?.marketLand || 'DE').toUpperCase(),
      erfasstAm: ms(c.capturedAt),
      alternativen: weitereQuellen(doc, 'filiale'),
    };
  }

  // 3) Vom Nutzer angegebener Ort
  const cp = c.confirmedPlace;
  if (cp && (cp.city || cp.name)) {
    const name = cp.city || cp.name;
    const k = ortKoordinate(name, doc?.marketLand, zusatz);
    return {
      quelle: 'nutzerangabe', quelleText: 'Ort, den der Nutzer angegeben hat',
      granularitaet: 'city', konfidenz: null, herkunft: 'altbestand', auffaellig: [],
      label: name,
      genauigkeitM: GENAUIGKEIT.nutzerangabe,
      lat: k?.lat ?? null, lon: k?.lon ?? null,
      plz: null, ort: name, bundesland: k?.bundesland ?? null,
      land: (doc?.marketLand || 'DE').toUpperCase(),
      erfasstAm: ms(c.capturedAt),
      alternativen: weitereQuellen(doc, 'nutzerangabe'),
    };
  }

  return {
    quelle: null, quelleText: null, granularitaet: null, konfidenz: null,
    herkunft: 'altbestand', auffaellig: [],
    label: 'kein Ort erfasst',
    genauigkeitM: null,
    lat: null, lon: null, plz: null, ort: null, bundesland: null,
    land: (doc?.marketLand || null),
    erfasstAm: ms(c.capturedAt),
    alternativen: weitereQuellen(doc, null),
  };
}

/** Der Ort EINES Kassenbons. Bons tragen nie GPS — die Filialadresse ist die Quelle. */
function ortVonBon(doc, zusatz) {
  const s = doc?.store || {};
  if (s.zip || s.city) {
    const k = s.zip ? plzKoordinate(s.zip, s.country) : ortKoordinate(s.city, s.country, zusatz);
    const lat0 = k?.lat ?? null;
    const lon0 = k?.lon ?? null;
    return {
      quelle: 'filiale', quelleText: 'Adresse auf dem Kassenbon',
      granularitaet: s.zip ? 'store' : 'city', konfidenz: s.zip ? 'high' : 'medium',
      herkunft: 'bonkopf',
      auffaellig: auffaelligkeiten({ lat: lat0, lon: lon0, genauigkeitM: null, erwartetesLand: s.country, quelle: 'filiale' }),
      label: [s.street, [s.zip, s.city || k?.ort].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      genauigkeitM: s.zip ? GENAUIGKEIT.filiale : GENAUIGKEIT.nutzerangabe,
      lat: k?.lat ?? null, lon: k?.lon ?? null,
      plz: s.zip ?? null, ort: s.city || k?.ort || null, bundesland: k?.bundesland ?? null,
      land: (s.country || 'DE').toUpperCase(),
      erfasstAm: null,
      alternativen: [],
    };
  }
  return {
    quelle: null, quelleText: null, granularitaet: null, konfidenz: null,
    herkunft: 'bonkopf', auffaellig: [],
    label: 'keine Filialadresse auf dem Bon erkannt', genauigkeitM: null,
    lat: null, lon: null, plz: null, ort: null, bundesland: null, land: null,
    erfasstAm: null, alternativen: [],
  };
}

/** Was die anderen Quellen sagen — damit beim Prüfen ein Widerspruch auffällt. */
function weitereQuellen(doc, ausser) {
  const c = doc?.capture || {};
  const raus = [];
  if (ausser !== 'geraet' && c.gps && Number.isFinite(c.gps.lat)) {
    const t = naechsteOrtschaft(c.gps.lat, c.gps.lon);
    raus.push({ quelle: 'geraet', label: t ? `${t.ort} (Gerät)` : 'Gerätestandort' });
  }
  if (ausser !== 'filiale' && doc?.priceReceipt?.city) {
    raus.push({ quelle: 'filiale', label: `${doc.priceReceipt.city} (Bon)` });
  }
  if (ausser !== 'nutzerangabe' && c.confirmedPlace?.city) {
    raus.push({ quelle: 'nutzerangabe', label: `${c.confirmedPlace.city} (Angabe)` });
  }
  return raus;
}

/**
 * Umkehr-Suche: Koordinate → nächstgelegene Postleitzahl. Damit bekommt ein
 * GPS-Punkt einen lesbaren Namen, ohne einen fremden Dienst zu fragen.
 * Der Index wird beim ersten Aufruf gebaut (13.314 Einträge, einmalig ~20 ms).
 */
/**
 * Firmen- und Behördennamen, die GeoNames im Ortsfeld führt.
 *
 * Die Markierung in `plz.json` (fünftes Feld) fängt die eindeutigen Fälle. Sie
 * ist aber Datenpflege und veraltet mit der nächsten Tabelle — deshalb steht
 * dieselbe Regel zusätzlich hier im Code. Gemessen: über die Markierung allein
 * blieben rund 490 Einträge mit Namen wie „Kassenärztliche Vereinigung" oder
 * „Deutsche Rentenversicherung" als Ortsnamen stehen.
 */
const FIRMENNAME = /(GmbH|\bAG\b|\bKG\b|mbH|\bSE\b|OHG|e\.\s?V|\bCo\b|Stiftung|Finanzamt|Postfach|Versicherung|Rentenversicherung|\bBank\b|Sparkasse|Verlag|Zentrale|Holding|Institut|Universit|Hochschul|Klinik|Amtsgericht|Bundesamt|Ministerium|Vereinigung|Kammer|Verband|Genossenschaft|Gesellschaft|Krankenkasse|Versand|Rundfunk|Zeitung)/i;
const istFirmenname = (name) => FIRMENNAME.test(String(name || ''));

let raster = null;
function bauRaster() {
  raster = new Map();
  for (const [schluessel, e] of Object.entries(PLZ)) {
    // Reine Firmen-Postleitzahlen (fünftes Feld = 1) taugen nicht als ORTSNAME:
    // GeoNames führt Großkunden-Postleitzahlen mit dem Firmennamen im Ortsfeld,
    // und ein Gerätestandort wurde dadurch zu „Finanzamt Köln-Porz" statt zu
    // „Köln" — bei 150 von 463 Standorten. Ihre Koordinate bleibt nutzbar,
    // nur die Rückwärts-Suche überspringt sie.
    if (e[4] === 1) continue;
    const k = `${Math.round(e[0] * 2)}/${Math.round(e[1] * 2)}`; // halbes Grad
    if (!raster.has(k)) raster.set(k, []);
    raster.get(k).push({ plz: schluessel.slice(3), land: schluessel.slice(0, 2), lat: e[0], lon: e[1], ort: e[2], bundesland: e[3] });
  }
}
function naechsteOrtschaft(lat, lon) {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  if (!raster) bauRaster();
  const zLat = Math.round(lat * 2);
  const zLon = Math.round(lon * 2);
  let beste = null;
  let besteD = Infinity;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      for (const p of raster.get(`${zLat + dy}/${zLon + dx}`) || []) {
        const d = (p.lat - lat) ** 2 + ((p.lon - lon) * Math.cos(lat * Math.PI / 180)) ** 2;
        if (d < besteD) { besteD = d; beste = p; }
      }
    }
  }
  // Über 30 km ist keine sinnvolle Zuordnung mehr (Grad² grob in km²).
  return beste && Math.sqrt(besteD) * 111 <= 30 ? beste : null;
}

module.exports = {
  ortVonEinreichung, ortVonBon, plzKoordinate, ortKoordinate, ortsverzeichnisAusBons,
  naechsteOrtschaft, landAusKoordinate, auffaelligkeiten, inDACH, GENAUIGKEIT,
};
