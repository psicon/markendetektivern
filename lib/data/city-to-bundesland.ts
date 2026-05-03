// Static lookup: German city name → Bundesland.
//
// Used by the leaderboard aggregator (Cloud Function later, admin
// script today) to roll up per-user stats into Bundesland/City
// buckets. Covers ~150 cities — based on a 30k-journey sample, this
// hits >80 % of journeys. Cities not in the table fall back to
// `null` and are dropped from the aggregation (rather than guessed).
//
// English aliases are included because the IP-geocoder occasionally
// returns the English form (Munich, Cologne, Hanover, Nuremberg…).
// Common typos / variants are NOT covered — keeping the table tight
// and predictable.

export const CITY_TO_BUNDESLAND: Readonly<Record<string, string>> = {
  // ─── City-states ─────────────────────────────────────────────────────
  Berlin: 'Berlin',
  Hamburg: 'Hamburg',
  Bremen: 'Bremen',
  Bremerhaven: 'Bremen',

  // ─── Bayern ──────────────────────────────────────────────────────────
  München: 'Bayern',
  Munich: 'Bayern',
  Nürnberg: 'Bayern',
  Nuremberg: 'Bayern',
  Augsburg: 'Bayern',
  Würzburg: 'Bayern',
  Regensburg: 'Bayern',
  Ingolstadt: 'Bayern',
  Erlangen: 'Bayern',
  Bamberg: 'Bayern',
  Aschaffenburg: 'Bayern',
  Bayreuth: 'Bayern',
  Landshut: 'Bayern',
  Kempten: 'Bayern',
  Rosenheim: 'Bayern',
  Fürth: 'Bayern',
  Schweinfurt: 'Bayern',
  Passau: 'Bayern',
  Coburg: 'Bayern',
  Memmingen: 'Bayern',
  Hof: 'Bayern',
  Amberg: 'Bayern',
  Weiden: 'Bayern',
  Straubing: 'Bayern',
  'Neu-Ulm': 'Bayern',
  Erding: 'Bayern',
  Freising: 'Bayern',
  'Garmisch-Partenkirchen': 'Bayern',
  Dinkelsbühl: 'Bayern',
  Volkach: 'Bayern',
  Baiersdorf: 'Bayern',
  Eching: 'Bayern',
  'Grafing bei München': 'Bayern',
  Tegernsee: 'Bayern',

  // ─── Baden-Württemberg ───────────────────────────────────────────────
  Stuttgart: 'Baden-Württemberg',
  Karlsruhe: 'Baden-Württemberg',
  Mannheim: 'Baden-Württemberg',
  Heidelberg: 'Baden-Württemberg',
  'Freiburg im Breisgau': 'Baden-Württemberg',
  Freiburg: 'Baden-Württemberg',
  Heilbronn: 'Baden-Württemberg',
  Pforzheim: 'Baden-Württemberg',
  Reutlingen: 'Baden-Württemberg',
  Tübingen: 'Baden-Württemberg',
  Konstanz: 'Baden-Württemberg',
  Ulm: 'Baden-Württemberg',
  'Esslingen am Neckar': 'Baden-Württemberg',
  Esslingen: 'Baden-Württemberg',
  Ludwigsburg: 'Baden-Württemberg',
  Aalen: 'Baden-Württemberg',
  Sindelfingen: 'Baden-Württemberg',
  Göppingen: 'Baden-Württemberg',
  'Schwäbisch Gmünd': 'Baden-Württemberg',
  'Villingen-Schwenningen': 'Baden-Württemberg',
  Friedrichshafen: 'Baden-Württemberg',
  Offenburg: 'Baden-Württemberg',
  Tuttlingen: 'Baden-Württemberg',
  Albstadt: 'Baden-Württemberg',
  Lörrach: 'Baden-Württemberg',
  Rastatt: 'Baden-Württemberg',
  Singen: 'Baden-Württemberg',

  // ─── Nordrhein-Westfalen ─────────────────────────────────────────────
  Köln: 'Nordrhein-Westfalen',
  Cologne: 'Nordrhein-Westfalen',
  Düsseldorf: 'Nordrhein-Westfalen',
  Dortmund: 'Nordrhein-Westfalen',
  Essen: 'Nordrhein-Westfalen',
  Duisburg: 'Nordrhein-Westfalen',
  Bochum: 'Nordrhein-Westfalen',
  Wuppertal: 'Nordrhein-Westfalen',
  Bielefeld: 'Nordrhein-Westfalen',
  Bonn: 'Nordrhein-Westfalen',
  Münster: 'Nordrhein-Westfalen',
  Mönchengladbach: 'Nordrhein-Westfalen',
  Gelsenkirchen: 'Nordrhein-Westfalen',
  Aachen: 'Nordrhein-Westfalen',
  Krefeld: 'Nordrhein-Westfalen',
  Oberhausen: 'Nordrhein-Westfalen',
  Hagen: 'Nordrhein-Westfalen',
  Hamm: 'Nordrhein-Westfalen',
  Mülheim: 'Nordrhein-Westfalen',
  'Mülheim an der Ruhr': 'Nordrhein-Westfalen',
  Leverkusen: 'Nordrhein-Westfalen',
  Solingen: 'Nordrhein-Westfalen',
  Herne: 'Nordrhein-Westfalen',
  Neuss: 'Nordrhein-Westfalen',
  Paderborn: 'Nordrhein-Westfalen',
  Recklinghausen: 'Nordrhein-Westfalen',
  Bottrop: 'Nordrhein-Westfalen',
  Remscheid: 'Nordrhein-Westfalen',
  Moers: 'Nordrhein-Westfalen',
  Siegen: 'Nordrhein-Westfalen',
  Witten: 'Nordrhein-Westfalen',
  Iserlohn: 'Nordrhein-Westfalen',
  Gütersloh: 'Nordrhein-Westfalen',
  Detmold: 'Nordrhein-Westfalen',
  Marl: 'Nordrhein-Westfalen',
  Lünen: 'Nordrhein-Westfalen',
  Eschweiler: 'Nordrhein-Westfalen',
  Selm: 'Nordrhein-Westfalen',
  Mettmann: 'Nordrhein-Westfalen',
  Düren: 'Nordrhein-Westfalen',
  Dinslaken: 'Nordrhein-Westfalen',
  Unna: 'Nordrhein-Westfalen',
  'Hennef (Sieg)': 'Nordrhein-Westfalen',
  Hennef: 'Nordrhein-Westfalen',
  Herzogenrath: 'Nordrhein-Westfalen',
  Schwelm: 'Nordrhein-Westfalen',
  Leopoldshöhe: 'Nordrhein-Westfalen',

  // ─── Hessen ──────────────────────────────────────────────────────────
  'Frankfurt am Main': 'Hessen',
  Frankfurt: 'Hessen',
  Wiesbaden: 'Hessen',
  Kassel: 'Hessen',
  Darmstadt: 'Hessen',
  Offenbach: 'Hessen',
  'Offenbach am Main': 'Hessen',
  Hanau: 'Hessen',
  Marburg: 'Hessen',
  Gießen: 'Hessen',
  Fulda: 'Hessen',
  Rüsselsheim: 'Hessen',
  'Bad Homburg': 'Hessen',
  'Bad Homburg vor der Höhe': 'Hessen',
  Wetzlar: 'Hessen',
  Lahntal: 'Hessen',
  'Hessisch Lichtenau': 'Hessen',
  Linsengericht: 'Hessen',
  Witzenhausen: 'Hessen',

  // ─── Niedersachsen ───────────────────────────────────────────────────
  Hannover: 'Niedersachsen',
  Hanover: 'Niedersachsen',
  'Hannoversch Münden': 'Niedersachsen',
  Braunschweig: 'Niedersachsen',
  Osnabrück: 'Niedersachsen',
  Oldenburg: 'Niedersachsen',
  Wolfsburg: 'Niedersachsen',
  Göttingen: 'Niedersachsen',
  Salzgitter: 'Niedersachsen',
  Hildesheim: 'Niedersachsen',
  Lüneburg: 'Niedersachsen',
  Celle: 'Niedersachsen',
  Wilhelmshaven: 'Niedersachsen',
  Lingen: 'Niedersachsen',
  'Lingen (Ems)': 'Niedersachsen',
  Ronnenberg: 'Niedersachsen',
  Tann: 'Niedersachsen',

  // ─── Sachsen ─────────────────────────────────────────────────────────
  Dresden: 'Sachsen',
  Leipzig: 'Sachsen',
  Chemnitz: 'Sachsen',
  Zwickau: 'Sachsen',
  Plauen: 'Sachsen',
  Görlitz: 'Sachsen',
  Werdau: 'Sachsen',
  'Bad Lausick': 'Sachsen',

  // ─── Rheinland-Pfalz ─────────────────────────────────────────────────
  Mainz: 'Rheinland-Pfalz',
  Ludwigshafen: 'Rheinland-Pfalz',
  'Ludwigshafen am Rhein': 'Rheinland-Pfalz',
  Koblenz: 'Rheinland-Pfalz',
  Trier: 'Rheinland-Pfalz',
  Kaiserslautern: 'Rheinland-Pfalz',
  Worms: 'Rheinland-Pfalz',
  Neuwied: 'Rheinland-Pfalz',
  Speyer: 'Rheinland-Pfalz',
  'Bad Kreuznach': 'Rheinland-Pfalz',

  // ─── Schleswig-Holstein ──────────────────────────────────────────────
  Kiel: 'Schleswig-Holstein',
  Lübeck: 'Schleswig-Holstein',
  Flensburg: 'Schleswig-Holstein',
  Neumünster: 'Schleswig-Holstein',
  Norderstedt: 'Schleswig-Holstein',
  Heist: 'Schleswig-Holstein',

  // ─── Brandenburg ─────────────────────────────────────────────────────
  Potsdam: 'Brandenburg',
  Cottbus: 'Brandenburg',
  'Brandenburg an der Havel': 'Brandenburg',
  'Frankfurt (Oder)': 'Brandenburg',
  Oranienburg: 'Brandenburg',
  Falkensee: 'Brandenburg',

  // ─── Sachsen-Anhalt ──────────────────────────────────────────────────
  'Halle (Saale)': 'Sachsen-Anhalt',
  Halle: 'Sachsen-Anhalt',
  Magdeburg: 'Sachsen-Anhalt',
  'Dessau-Roßlau': 'Sachsen-Anhalt',
  Wittenberg: 'Sachsen-Anhalt',
  Jessen: 'Sachsen-Anhalt',

  // ─── Thüringen ───────────────────────────────────────────────────────
  Erfurt: 'Thüringen',
  Jena: 'Thüringen',
  Gera: 'Thüringen',
  Weimar: 'Thüringen',
  Eisenach: 'Thüringen',
  'Bad Blankenburg': 'Thüringen',

  // ─── Mecklenburg-Vorpommern ──────────────────────────────────────────
  Rostock: 'Mecklenburg-Vorpommern',
  Schwerin: 'Mecklenburg-Vorpommern',
  Neubrandenburg: 'Mecklenburg-Vorpommern',
  Stralsund: 'Mecklenburg-Vorpommern',
  Greifswald: 'Mecklenburg-Vorpommern',
  Wismar: 'Mecklenburg-Vorpommern',
  'Ostseebad Binz': 'Mecklenburg-Vorpommern',

  // ─── Saarland ────────────────────────────────────────────────────────
  Saarbrücken: 'Saarland',
  Neunkirchen: 'Saarland',
  Saarlouis: 'Saarland',
  Homburg: 'Saarland',
};

/**
 * Resolve a (possibly English / variant) city name to a Bundesland.
 * Returns `null` for unknown / fallback values like "DACH-Region".
 */
export function bundeslandForCity(city: string | null | undefined): string | null {
  if (!city) return null;
  return CITY_TO_BUNDESLAND[city] ?? null;
}

/**
 * Normalize an English city name to its German form for display
 * (Cologne → Köln, Munich → München …). Returns the input unchanged
 * if not in the alias table.
 */
const EN_TO_DE: Readonly<Record<string, string>> = {
  Munich: 'München',
  Cologne: 'Köln',
  Hanover: 'Hannover',
  Nuremberg: 'Nürnberg',
};
export function normalizeCityName(city: string): string {
  return EN_TO_DE[city] ?? city;
}
