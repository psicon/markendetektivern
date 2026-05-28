/**
 * Stabile Hash-Funktion über die Comparison-Inputs.
 *
 * Wenn der Hash unverändert ist UND die promptVersion auch unverändert
 * ist, MUSS der Comparison-Output identisch sein. Spart Gemini-Calls
 * bei Firestore-Triggers die feuern obwohl die relevanten Felder nicht
 * geändert wurden (z.B. Image-URL geändert, Stufe-Update, etc.).
 */

const crypto = require('crypto');

/**
 * Baut einen kanonischen String aus zwei Snapshots. Felder werden in
 * fester Reihenfolge serialisiert damit der Hash deterministisch ist.
 */
function snapshotKey(s) {
  if (!s) return 'null';
  return [
    s.energy,
    s.fat,
    s.satFat,
    s.carbs,
    s.sugar,
    s.fiber,
    s.protein,
    s.salt,
    // Zutaten case-insensitive + whitespace-collapsed normalisieren
    // damit z.B. "MILCH, Salz" und "Milch,Salz" denselben Hash haben.
    String(s.ingredients || '')
      .toLowerCase()
      .replace(/\s+/g, ' ')
      .trim(),
    // v7: Stufe wieder im Hash. Wenn ein Produkt von Stufe 3 auf 5
    // hochgestuft wird, MUSS der Cap neu greifen und das Reasoning
    // neu generiert werden — kann den Score verändern selbst bei
    // sonst identischen Daten.
    s.stufe ?? 'null',
  ].join('|');
}

function inputHash(nonameSnapshot, originalSnapshot) {
  const key =
    'noname=' +
    snapshotKey(nonameSnapshot) +
    '||orig=' +
    snapshotKey(originalSnapshot);
  return crypto.createHash('sha256').update(key).digest('hex').slice(0, 16);
}

module.exports = { inputHash };
