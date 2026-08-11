'use strict';

/**
 * Bewertet, WO eine Produkt-Einreichung entstanden ist — und wie sicher
 * das ist.
 *
 * REIN UND DETERMINISTISCH: keine I/O, keine Zeitfunktion, kein Zufall.
 * Alles Zeitbezogene kommt als Parameter herein. Dadurch ist das Modell
 * testbar und — wichtiger — jederzeit aus den Rohsignalen im Dokument
 * neu berechenbar, ohne ein einziges Byte aus Storage zu laden. Dieselbe
 * Trennung wie in ai-product-comparison: die Mathematik macht der Code.
 *
 * ═══ Warum Präzedenz statt gewichteter Mittelung ═══
 *
 * Die Signale unterscheiden sich in ihrer Genauigkeit um vier Größen-
 * ordnungen: GPS liegt bei ~10 m, die IP-Ortung bei gemessenen 61,7 /
 * 61,7 / 99,5 / 377,2 km (Vergleich gegen die vier Dokumente mit
 * EXIF-GPS, 11.08.2026). Jeder gewichtete Mittelwert aus beidem ergibt
 * eine Koordinate, die zu KEINER Quelle gehört und präziser aussieht als
 * jede von ihnen. Deshalb: die höchstrangige verfügbare Messung gewinnt
 * allein, alle anderen dürfen nur bestätigen oder widersprechen.
 *
 * ═══ Warum zwei Achsen ═══
 *
 * `granularity` sagt, WAS behauptet wird (Punkt/Stadt/Land), `confidence`
 * WIE SICHER. Nur so lässt sich die heutige Lage ehrlich abbilden: für
 * fast jede Alt-Einreichung ist „Deutschland, sehr sicher" die korrekte
 * Aussage. Ein einachsiges Feld müsste daraus „low" machen und würde
 * damit eine belastbare Information als unsicher darstellen.
 *
 * ═══ Die IP-Ortung kann nie gewinnen ═══
 *
 * `journeyLocation` hat die höchste Abdeckung (89,6 % verwertbar) und den
 * geringsten Wert. Sie geht ausschließlich als LANDES-Signal ein (dort
 * war sie in 4 von 4 Ground-Truth-Fällen korrekt) und als Eintrag in
 * `signals[]`. Sie liefert niemals lat/lon und hebt niemals die Konfidenz
 * über das, was eine echte Messung trägt. Ein Feld, das um 60–380 km
 * danebenliegt, aber wie eine Stadt aussieht, richtet mehr Schaden an als
 * ein leeres Feld.
 */

const MODEL_VERSION = 'ploc-v1';

/** Rangfolge. Kleinerer Index gewinnt. `market_country` ist der Boden. */
const PRECEDENCE = [
  'gps_capture',
  'exif_gps',
  'user_confirmed_place',
  'user_profile_region',
  'market_country',
];

/**
 * Obergrenzen je Quelle. Eine Selbstauskunft über den Wohnort kann nie
 * „hoch sicher" für den AUFNAHMEORT sein, egal wie viel sie bestätigt —
 * sie beantwortet eine andere Frage.
 */
/**
 * Wer die Konfidenz eines Siegers senken darf.
 *
 * Bewusst NICHT enthalten: `user_profile_region` (Wohnort ≠ Aufnahmeort —
 * wer auswärts einkauft, erzeugt sonst dauerhaft Widersprüche) und
 * `market_country` (kennt keine Position). Die IP-Ortung ist gar nicht
 * erst Kandidat.
 */
const DARF_DEMOTIEREN = new Set(['gps_capture', 'exif_gps', 'user_confirmed_place']);

const CONFIDENCE_CAP = {
  gps_capture: 'high',
  exif_gps: 'high',
  user_confirmed_place: 'medium',
  user_profile_region: 'low',
  market_country: 'high', // Land ist belegbar, nur eben grob
};

const LEVELS = ['none', 'low', 'medium', 'high'];
const stufe = (c) => LEVELS.indexOf(c);
const deckel = (c, cap) => (stufe(c) > stufe(cap) ? cap : c);
const heben = (c, n) => LEVELS[Math.max(0, Math.min(LEVELS.length - 1, stufe(c) + n))];

/** Entfernung in km. Nur für Plausibilitätsprüfungen, nicht für Ausgaben. */
function distanzKm(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const x =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(x));
}

/**
 * Grobe DACH-Landeszuordnung ohne externen Geocoder.
 *
 * Bewusst nur Bounding-Boxen: die Frage ist „passt die Messung zum
 * gewählten Markt", nicht „in welcher Gemeinde liegt der Punkt". Ein
 * Reverse-Geocoder wäre dafür ein neuer Kostenpunkt, eine neue
 * Abhängigkeit und ein zusätzlicher meldepflichtiger Datenfluss.
 * Die Boxen überlappen an den Grenzen leicht — deshalb liefert die
 * Funktion im Zweifel `null` statt einer falschen Zuordnung.
 */
function landAusKoordinate(lat, lon) {
  if (lat == null || lon == null) return null;
  const treffer = [];
  if (lat >= 47.27 && lat <= 55.06 && lon >= 5.87 && lon <= 15.04) treffer.push('DE');
  if (lat >= 46.37 && lat <= 49.02 && lon >= 9.53 && lon <= 17.16) treffer.push('AT');
  if (lat >= 45.82 && lat <= 47.81 && lon >= 5.96 && lon <= 10.49) treffer.push('CH');
  return treffer.length === 1 ? treffer[0] : null;
}

/** Datenminimierung: die gespeicherte Genauigkeit folgt der Konfidenz. */
function runden(wert, confidence) {
  if (wert == null) return null;
  if (confidence === 'high') return Math.round(wert * 1e5) / 1e5; // ~1 m
  if (confidence === 'medium') return Math.round(wert * 1e3) / 1e3; // ~110 m
  return null; // low/none tragen NIE eine Koordinate
}

function granularitaetAusGenauigkeit(accuracyM) {
  if (accuracyM == null) return 'city';
  if (accuracyM <= 100) return 'point';
  if (accuracyM <= 1000) return 'store';
  if (accuracyM <= 10000) return 'city';
  return 'region';
}

/**
 * Basis-Konfidenz aus der MESSGÜTE des Siegers.
 *
 * `ageMinutes` ist der Abstand zwischen Messung und Aufnahme. Er zählt,
 * weil ein Galeriefoto den AUFNAHME-, nicht den Einreichungsort belegt:
 * eines der vier Ground-Truth-Dokumente war 10,8 Tage alt. Ohne diese
 * Prüfung würde ein solcher Wert einen falschen Ort behaupten.
 */
function basisKonfidenz(kandidat) {
  const { kind, accuracyM, ageMinutes } = kandidat;

  if (kind === 'gps_capture') {
    if (accuracyM != null && accuracyM <= 100 && (ageMinutes == null || ageMinutes <= 15)) return 'high';
    if (accuracyM != null && accuracyM <= 100 && ageMinutes <= 180) return 'medium';
    // Android „Ungefährer Standort" liefert 1–3 km. Ehrlich: medium.
    if (accuracyM != null && accuracyM <= 3000) return 'medium';
    return 'low';
  }

  if (kind === 'exif_gps') {
    if (ageMinutes == null) return 'medium'; // ohne DateTimeOriginal nicht datierbar
    if (ageMinutes <= 60) return 'high';
    if (ageMinutes <= 1440) return 'medium';
    return 'low'; // belegt den Aufnahme-, nicht den Einreichungsort
  }

  if (kind === 'user_confirmed_place') return 'medium';
  if (kind === 'user_profile_region') return 'low';

  if (kind === 'market_country') {
    if (kandidat.laenderQuellen >= 2) return 'high';
    if (kandidat.laenderQuellen === 1) return 'medium';
    return 'low';
  }

  return 'none';
}

/**
 * @param {object} roh Normalisierte Rohsignale (siehe README der Function).
 * @param {number} roh.submittedAtMs Anlagezeit des Dokuments.
 * @returns {object} probableLocation, IMMER gefüllt — auch der Negativfall.
 */
function bewerteLocation(roh) {
  const signals = [];
  const conflicts = [];

  // ── Kandidaten sammeln ───────────────────────────────────────────────
  // Nur MESSUNGEN und bewusste Nutzerangaben. Die IP-Ortung ist hier
  // absichtlich nicht dabei.
  const kandidaten = [];

  if (roh.captureGps && typeof roh.captureGps.lat === 'number') {
    kandidaten.push({
      kind: 'gps_capture',
      lat: roh.captureGps.lat,
      lon: roh.captureGps.lon,
      accuracyM: roh.captureGps.accuracyM ?? null,
      ageMinutes: roh.captureGps.ageMinutes ?? null,
    });
  }

  if (roh.exifGps && typeof roh.exifGps.lat === 'number') {
    kandidaten.push({
      kind: 'exif_gps',
      lat: roh.exifGps.lat,
      lon: roh.exifGps.lon,
      accuracyM: roh.exifGps.accuracyM ?? 25,
      ageMinutes: roh.exifGps.ageMinutes ?? null,
    });
  }

  if (roh.confirmedPlace) {
    kandidaten.push({
      kind: 'user_confirmed_place',
      lat: typeof roh.confirmedPlace.lat === 'number' ? roh.confirmedPlace.lat : null,
      lon: typeof roh.confirmedPlace.lon === 'number' ? roh.confirmedPlace.lon : null,
      accuracyM: roh.confirmedPlace.accuracyM ?? 2000,
      city: roh.confirmedPlace.city ?? null,
      bundesland: roh.confirmedPlace.bundesland ?? null,
      land: roh.confirmedPlace.land ?? null,
      ageMinutes: 0,
    });
  }

  if (roh.profileRegion && (roh.profileRegion.city || roh.profileRegion.bundesland)) {
    kandidaten.push({
      kind: 'user_profile_region',
      lat: null, // Selbstauskunft liefert NIE eine Koordinate
      lon: null,
      accuracyM: null,
      city: roh.profileRegion.city ?? null,
      bundesland: roh.profileRegion.bundesland ?? null,
      land: roh.profileRegion.land ?? null,
      ageMinutes: null,
    });
  }

  // ── Landes-Signale: die einzige Rolle, die die IP-Ortung spielen darf ─
  const laender = [];
  if (roh.marketLand) laender.push({ quelle: 'market', land: roh.marketLand });
  if (roh.ipLand) laender.push({ quelle: 'ip', land: roh.ipLand });
  if (roh.profileRegion?.land) laender.push({ quelle: 'profile', land: roh.profileRegion.land });

  const landesStimmen = {};
  laender.forEach((l) => {
    landesStimmen[l.land] = (landesStimmen[l.land] || 0) + 1;
  });
  const landMehrheit =
    Object.entries(landesStimmen).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const laenderUneins = Object.keys(landesStimmen).length > 1;

  if (landMehrheit) {
    kandidaten.push({
      kind: 'market_country',
      lat: null,
      lon: null,
      accuracyM: null,
      land: landMehrheit,
      laenderQuellen: laenderUneins ? 0 : landesStimmen[landMehrheit],
      ageMinutes: null,
    });
  }

  // ── Alle Signale protokollieren, auch die, die nie gewinnen können ───
  if (roh.ipLocation && roh.ipLocation.source === 'ip') {
    signals.push({
      kind: 'ip_region',
      city: roh.ipLocation.city ?? null,
      // Bewusst OHNE lat/lon: sonst landet die Rasterkoordinate über kurz
      // oder lang doch in einer Auswertung, die sie für einen Ort hält.
      note: 'Netzzugang, nicht Aufenthaltsort — nie als Position verwenden',
    });
  }
  if (roh.ipLocation && roh.ipLocation.source === 'fallback') {
    signals.push({ kind: 'ip_fallback', note: 'DACH-Mittelpunkt, kein Ort' });
  }

  // ── Sieger nach fester Rangfolge ─────────────────────────────────────
  kandidaten.sort((a, b) => PRECEDENCE.indexOf(a.kind) - PRECEDENCE.indexOf(b.kind));
  const sieger = kandidaten[0];

  if (!sieger) {
    return {
      modelVersion: MODEL_VERSION,
      granularity: 'none',
      confidence: 'none',
      source: 'none',
      lat: null,
      lon: null,
      accuracyM: null,
      city: null,
      bundesland: null,
      land: null,
      agreement: 'single',
      ageMinutes: null,
      signals,
      conflicts,
      usableFor: [],
    };
  }

  kandidaten.forEach((k) => {
    signals.push({
      kind: k.kind,
      city: k.city ?? null,
      distanceKmToWinner: k === sieger ? 0 : distanzKm(sieger, k),
    });
  });

  let confidence = basisKonfidenz(sieger);

  // ── Kreuzvalidierung ─────────────────────────────────────────────────
  // Nur Quellen aus DARF_DEMOTIEREN dürfen die Konfidenz senken: eigene
  // Messungen und die bewusste Ortsangabe des Nutzers. Die Selbstauskunft
  // aus dem Profil ist ein WOHNORT — außerhalb des Wohnorts einzukaufen
  // ist normal und darf niemals als Widerspruch zählen. Die IP-Ortung ist
  // gar nicht erst Kandidat; sie widerspricht laut Messung praktisch immer
  // (0 von 64), und ein Vetorecht für sie würde jedes GPS-Signal dauerhaft
  // entwerten.
  //
  // Der Rang spielt hier bewusst KEINE Rolle: zwei echte Messungen 500 km
  // auseinander sind ein Widerspruch, egal welche von beiden gewinnt.
  let agreement = 'single';

  for (const k of kandidaten) {
    if (k === sieger) continue;
    const d = distanzKm(sieger, k);
    if (d == null) continue; // ohne Koordinate kein Abstand — und kein Veto

    if (d <= 5) {
      agreement = 'corroborated';
    } else if (d > 150 && DARF_DEMOTIEREN.has(k.kind)) {
      conflicts.push(`${k.kind}_${Math.round(d)}km_entfernt`);
      agreement = 'conflicting';
      confidence = heben(confidence, -1);
    }
  }

  // Untergrenze: eine echte Messung bleibt eine echte Messung. Auch mehrere
  // Widersprüche dürfen sie nicht auf „none" drücken — sonst wäre sie von
  // „gar kein Signal vorhanden" nicht mehr unterscheidbar.
  if (sieger.lat != null && stufe(confidence) < stufe('low')) confidence = 'low';

  // Landesprüfung: liegt die Messung außerhalb des gewählten Marktlandes,
  // ist mit hoher Wahrscheinlichkeit das MARKTFELD falsch, nicht die
  // Messung. Deshalb nur vermerken, nicht abwerten.
  const gemessenesLand = landAusKoordinate(sieger.lat, sieger.lon);
  if (gemessenesLand && roh.marketLand && gemessenesLand !== roh.marketLand) {
    conflicts.push(`land_gemessen_${gemessenesLand}_vs_markt_${roh.marketLand}`);
  }
  if (laenderUneins && sieger.kind === 'market_country') {
    conflicts.push('laender_quellen_uneins');
  }

  confidence = deckel(confidence, CONFIDENCE_CAP[sieger.kind] ?? 'none');

  // ── Ausgabe ──────────────────────────────────────────────────────────
  const hatKoordinate = sieger.lat != null && (confidence === 'high' || confidence === 'medium');
  const granularity = hatKoordinate
    ? granularitaetAusGenauigkeit(sieger.accuracyM)
    : sieger.kind === 'market_country'
      ? 'country'
      : sieger.city
        ? 'city'
        : sieger.bundesland
          ? 'region'
          : 'country';

  // `usableFor` ist der Missbrauchsschutz: eine Auswertung auf Stadtebene
  // fragt `usableFor array-contains 'city'` und kann eine Landesangabe
  // nicht versehentlich als Ort lesen.
  //
  // WICHTIG — die Ebenen werden EINZELN belegt, nicht aus der Konfidenz des
  // Siegers abgeleitet. Sonst entsteht eine Umkehrung: ein Dokument MIT
  // Selbstauskunft (Sieger `user_profile_region`, gedeckelt auf „low")
  // verlöre die Landesebene, die ein Dokument OHNE Selbstauskunft (Sieger
  // `market_country`, „high") behält. Mehr Information darf nie zu einer
  // schlechteren Verwertbarkeit führen. Genau das trat im Trockenlauf über
  // die 299 Bestandsdokumente auf: 94 landeten fälschlich bei [].
  const RADIUS = { point: 100, store: 1000, city: 10000, region: 50000 };
  const landFinal = sieger.land ?? gemessenesLand ?? landMehrheit ?? null;
  const usableFor = [];

  // Landesebene: gilt, sobald eine Quelle sie belegt und keine widerspricht —
  // unabhängig davon, wer das Rennen um die Position gewonnen hat.
  if (landFinal && !laenderUneins) usableFor.push('country');

  // Alles Feinere ausschließlich aus einer echten Messung.
  if (hatKoordinate && stufe(confidence) >= stufe('medium') && sieger.accuracyM != null) {
    Object.keys(RADIUS)
      .filter((l) => RADIUS[l] >= sieger.accuracyM)
      .forEach((l) => usableFor.push(l));
  }

  return {
    modelVersion: MODEL_VERSION,
    granularity,
    confidence,
    source: sieger.kind,
    lat: hatKoordinate ? runden(sieger.lat, confidence) : null,
    lon: hatKoordinate ? runden(sieger.lon, confidence) : null,
    accuracyM: hatKoordinate ? (sieger.accuracyM ?? null) : null,
    city: sieger.city ?? null,
    bundesland: sieger.bundesland ?? null,
    land: landFinal,
    agreement,
    ageMinutes: sieger.ageMinutes ?? null,
    signals,
    conflicts,
    usableFor,
  };
}

module.exports = {
  bewerteLocation,
  MODEL_VERSION,
  PRECEDENCE,
  CONFIDENCE_CAP,
  distanzKm,
  landAusKoordinate,
  __test__: { basisKonfidenz, granularitaetAusGenauigkeit, runden },
};
