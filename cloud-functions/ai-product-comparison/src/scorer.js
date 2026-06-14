/**
 * scorer.js — DETERMINISTISCHE Nährwert- + Label-Bewertung.
 *
 * Kernidee (2026-05-29 Rewrite): Mathematik macht Code, nicht die KI.
 * Ob 2,83g < 3g Salz ist, ist keine LLM-Aufgabe. Wir berechnen den
 * objektiven Nährwert- und Label-Vergleich hier — konsistent, gratis,
 * 0% Halluzination. Die KI macht NUR noch das Qualitative (Zutaten-
 * Zusatzstoffe) + schreibt den Text.
 *
 * Output: { nutritionPoints, labelPoints, facts }
 *   nutritionPoints > 0  → NoName nährwert-technisch besser
 *   labelPoints > 0       → NoName label-technisch besser (Bio/Nutri-Score)
 *   facts: strukturierte Liste der konkreten Unterschiede (für die
 *          KI-Text-Generierung + Audit)
 *
 * Skala-Mapping (mit LLM-Zutaten-Verdikt zusammen) passiert in
 * combineScore() ganz unten.
 */

// Gewichte nach ernährungsphysiologischer Relevanz. Salz + Zucker +
// gesättigte Fette sind die Haupt-Treiber für "ungesund"; Kalorien +
// Gesamtfett sekundär; Eiweiß + Ballaststoffe sind Positiv-Marker.
// minAbs: absolute Mindest-Differenz (in der Einheit) damit ein
// Unterschied überhaupt zählt. Verhindert das Small-Base-Problem:
// satFat 0,7g vs 0,4g ist +75% relativ aber nur 0,3g absolut —
// ernährungsphysiologisch irrelevant. Ein Unterschied muss BEIDE
// Schwellen (relativ ≥8% UND absolut ≥minAbs) reissen um zu zählen.
const NUTRIENT_CONFIG = {
  salt:    { weight: 3.0, lowerBetter: true,  minAbs: 0.2,  label: 'Salz',                unit: 'g' },
  sugar:   { weight: 3.0, lowerBetter: true,  minAbs: 1.5,  label: 'Zucker',              unit: 'g' },
  satFat:  { weight: 2.0, lowerBetter: true,  minAbs: 0.8,  label: 'gesättigte Fettsäuren', unit: 'g' },
  fat:     { weight: 1.0, lowerBetter: true,  minAbs: 1.5,  label: 'Fett',                unit: 'g' },
  energy:  { weight: 1.0, lowerBetter: true,  minAbs: 20,   label: 'Kalorien',            unit: 'kcal' },
  protein: { weight: 1.5, lowerBetter: false, minAbs: 1.5,  label: 'Eiweiß',              unit: 'g' },
  fiber:   { weight: 1.5, lowerBetter: false, minAbs: 1.0,  label: 'Ballaststoffe',       unit: 'g' },
};

// Relativ-Schwelle: Unterschiede unter 8% = Messrauschen, zählen nicht.
// (User-Vorgabe 2026-05-29: strenger — 5,7% weniger Salz soll NICHT
//  schon "besser" auslösen, das ist praktisch gleich.)
const EQUAL_THRESHOLD = 0.08;
// Ab 25% relativem Unterschied gilt's als "deutlich" (1.5× Gewicht).
const STRONG_THRESHOLD = 0.25;

function fmtNum(v) {
  if (v == null) return '';
  return (Math.round(v * 100) / 100).toString().replace('.', ',');
}

/**
 * Berechnet den deterministischen Nährwert-Vergleich.
 * @param noname  Snapshot des NoName-Produkts
 * @param original Snapshot des Original-Markenprodukts
 * @returns { nutritionPoints, facts: string[], detail: [...] }
 */
function scoreNutrition(noname, original) {
  let points = 0;
  const facts = [];
  const detail = [];

  for (const [key, cfg] of Object.entries(NUTRIENT_CONFIG)) {
    const n = noname?.[key];
    const o = original?.[key];
    // Beide Seiten müssen einen Zahlenwert haben — sonst ignorieren
    // (fehlt nur einer = "nicht deklariert", kein Vor-/Nachteil).
    if (typeof n !== 'number' || typeof o !== 'number') continue;
    if (o === 0 && n === 0) continue;

    // Relativ-Differenz gegen Original-Basis (o). Bei o=0 nehmen wir
    // absolute Differenz als "deutlich" wenn n>0.
    const base = o !== 0 ? Math.abs(o) : Math.max(Math.abs(n), 1);
    const rel = (n - o) / base; // >0: NoName hat MEHR
    const absDiff = Math.abs(n - o);

    // BEIDE Schwellen müssen reissen: relativ ≥8% UND absolut ≥minAbs.
    // Sonst = Messrauschen (z.B. 0,3g satFat-Unterschied bei Senf).
    if (Math.abs(rel) < EQUAL_THRESHOLD || absDiff < (cfg.minAbs || 0)) {
      detail.push({ key, dir: 'equal', n, o });
      continue;
    }

    // intensity: deutlich (>20%) zählt 1.5×
    const intensity = Math.abs(rel) >= STRONG_THRESHOLD ? 1.5 : 1.0;
    // noNameHasMore = rel > 0. Ob das gut ist hängt an lowerBetter.
    const noNameHasMore = rel > 0;
    const noNameBetter = cfg.lowerBetter ? !noNameHasMore : noNameHasMore;

    const delta = cfg.weight * intensity * (noNameBetter ? 1 : -1);
    points += delta;

    detail.push({ key, dir: noNameBetter ? 'noname' : 'original', n, o, rel });

    // Fact-String für KI + Audit
    const richtung = noNameBetter ? 'weniger' : 'mehr';
    const richtungPos = cfg.lowerBetter
      ? (noNameBetter ? 'weniger' : 'mehr')
      : (noNameBetter ? 'mehr' : 'weniger');
    facts.push(
      `${cfg.label}: NoName ${fmtNum(n)}${cfg.unit} vs Original ${fmtNum(o)}${cfg.unit} ` +
        `(NoName ${richtungPos})`,
    );
  }

  return { nutritionPoints: points, facts, detail };
}

/**
 * Label-Vergleich (Nutri-Score, Eco-Score, NOVA, Bio, Vegan, …).
 * Strukturierte Felder aus dem Snapshot.labels.
 */
function scoreLabels(noname, original) {
  let points = 0;
  const facts = [];
  const ln = noname?.labels || {};
  const lo = original?.labels || {};

  // Nutri-Score: a(beste)…e. Niedriger = besser.
  // WICHTIG: für Nicht-Strings -1 (nicht null) zurückgeben — `null >= 0`
  // coerced in JS zu `true`, dann würde der Guard unten greifen und
  // `.toUpperCase()` auf dem Nicht-String werfen. -1 lässt den Guard korrekt
  // fehlschlagen (unbekannt = nicht vergleichbar).
  const grade = (g) => {
    if (typeof g !== 'string') return -1;
    const c = g.trim().toLowerCase();
    return ['a', 'b', 'c', 'd', 'e'].indexOf(c); // 0..4, -1 wenn unbekannt
  };
  const nutriN = grade(ln.nutriscore);
  const nutriO = grade(lo.nutriscore);
  if (nutriN >= 0 && nutriO >= 0 && nutriN !== nutriO) {
    // kleinerer Index = besser
    const noNameBetter = nutriN < nutriO;
    points += noNameBetter ? 1.5 : -1.5;
    facts.push(
      `Nutri-Score: NoName ${ln.nutriscore.toUpperCase()} vs Original ${lo.nutriscore.toUpperCase()}`,
    );
  }

  // NOVA-Gruppe: 1(wenig verarbeitet)…4. Niedriger = besser.
  const novaN = parseInt(ln.nova, 10);
  const novaO = parseInt(lo.nova, 10);
  if (Number.isFinite(novaN) && Number.isFinite(novaO) && novaN !== novaO) {
    const noNameBetter = novaN < novaO;
    points += noNameBetter ? 1.0 : -1.0;
    facts.push(`NOVA: NoName Gruppe ${novaN} vs Original Gruppe ${novaO}`);
  }

  // Bio: bool. Wenn einer Bio ist und der andere nicht.
  if (typeof ln.isBio === 'boolean' && typeof lo.isBio === 'boolean' && ln.isBio !== lo.isBio) {
    const noNameBetter = ln.isBio && !lo.isBio;
    points += noNameBetter ? 2.0 : -2.0;
    facts.push(
      noNameBetter
        ? 'NoName ist Bio-zertifiziert, Original nicht'
        : 'Original ist Bio-zertifiziert, NoName nicht',
    );
  }

  return { labelPoints: points, facts };
}

/**
 * Kombiniert deterministische Punkte (Nährwert + Label) mit dem
 * KI-Zutaten-Verdikt zu einem finalen 1-5 Score.
 *
 * @param nutritionPoints  von scoreNutrition
 * @param labelPoints      von scoreLabels
 * @param ingredientVerdict 'noname' | 'original' | 'equal' (von der KI)
 * @param stufe            optional 3/4/5 (Trust-Cap)
 */
function combineScore({ nutritionPoints, labelPoints, ingredientVerdict, ingredientStrength, stufe }) {
  // Zutaten-QUALITÄT ist EXTREM wichtig (User-Vorgabe 2026-05-29). Die KI
  // liefert Verdikt + Stärke; wir gewichten gradiert. Eine sauberere
  // Zutatenliste (echte statt künstliche Aromen, weniger Zusatzstoffe,
  // hochwertigere Zutaten in höherem Anteil) zählt deutlich.
  const STRENGTH_POINTS = { slight: 1.5, clear: 3.5, strong: 5.0 };
  const mag = STRENGTH_POINTS[ingredientStrength] || STRENGTH_POINTS.slight;
  let ingredientPoints = 0;
  if (ingredientVerdict === 'noname') ingredientPoints = mag;
  else if (ingredientVerdict === 'original') ingredientPoints = -mag;

  const total = nutritionPoints + labelPoints + ingredientPoints;

  // ─── Mapping mit LEICHTEM NoName-Tilt, aber STRENGER als v13 ───────
  // User-Vorgabe 2026-05-29: "kippt zu schnell zugunsten NoName".
  //   • Messrauschen-Schwelle ist jetzt 8% (s.o.) → marginale
  //     Nährwert-Unterschiede zählen gar nicht erst.
  //   • Für "4" (etwas besser) braucht es total ≥ 2.5 = EIN klarer
  //     Vorteil (Salz/Zucker ≥8% weniger, ODER sauberere Zutaten).
  //   • Tilt steckt im asymmetrischen Graubereich: NoName braucht +2.5
  //     für "besser", das Original aber -3.5 für "schlechter" — kleine
  //     Original-Vorteile bleiben "gleichwertig".
  let score;
  if (total >= 5.0) score = 5;          // klar besser (mehrere Vorteile)
  else if (total >= 2.5) score = 4;     // etwas besser (ein klarer Vorteil)
  else if (total > -3.5) score = 3;     // gleichwertig (asymmetrischer Tilt)
  else if (total > -6.0) score = 2;     // etwas schlechter
  else score = 1;                       // klar schlechter

  // ─── Zutaten-Qualitäts-CAP (EXTREM-Gewichtung, User-Vorgabe) ───────
  // Ein klarer/starker Zutaten-NACHTEIL des NoName (mehr Zusatzstoffe,
  // künstliche statt echte Aromen, billigere Substitute) verhindert das
  // Top-Urteil — egal wie gut die Nährwerte sind. Ein Produkt voller
  // Zusatzstoffe ist nicht "klar besser", auch mit weniger Zucker/Fett.
  // Symmetrisch: ein klarer/starker Zutaten-VORTEIL schützt vor dem
  // schlechtesten Urteil.
  if (ingredientVerdict === 'original') {
    if (ingredientStrength === 'strong' && score > 3) score = 3;
    else if (ingredientStrength === 'clear' && score > 4) score = 4;
  } else if (ingredientVerdict === 'noname') {
    if (ingredientStrength === 'strong' && score < 3) score = 3;
    else if (ingredientStrength === 'clear' && score < 2) score = 2;
  }

  // Stufe-Cap (unbemerkt): nachweislich identische Produkt-Familien
  // dürfen nicht unter "gleichwertig" fallen.
  if (stufe === 5 && score < 3) score = 3;
  else if (stufe === 4 && score < 2) score = 2;

  return { score, total, ingredientPoints };
}

module.exports = {
  scoreNutrition,
  scoreLabels,
  combineScore,
  NUTRIENT_CONFIG,
};
