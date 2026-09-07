'use strict';

/**
 * Wo wurde eingekauft? — EINE Antwort aus mehreren Quellen (07.09.2026).
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
function ortVonEinreichung(doc, zusatz) {
  const c = doc?.capture || {};

  // 1) Gerätestandort
  const g = c.gps;
  if (g && Number.isFinite(g.lat) && Number.isFinite(g.lon)) {
    const genau = Number.isFinite(g.accuracyM) ? Math.round(g.accuracyM) : GENAUIGKEIT.geraet;
    const treffer = naechsteOrtschaft(g.lat, g.lon);
    return {
      quelle: 'geraet',
      label: treffer ? `${treffer.ort}${treffer.plz ? `, ${treffer.plz}` : ''}` : 'Gerätestandort',
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
      quelle: 'filiale',
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
      quelle: 'nutzerangabe',
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
    quelle: null,
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
    return {
      quelle: 'filiale',
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
    quelle: null, label: 'keine Filialadresse erkannt', genauigkeitM: null,
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
let raster = null;
function bauRaster() {
  raster = new Map();
  for (const [schluessel, e] of Object.entries(PLZ)) {
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

module.exports = { ortVonEinreichung, ortVonBon, plzKoordinate, ortKoordinate, ortsverzeichnisAusBons, naechsteOrtschaft, GENAUIGKEIT };
