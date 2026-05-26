/**
 * Age-Utilities — Integer-Age als Single Source of Truth.
 *
 * Hintergrund (T12): vor dieser Vereinheitlichung koexistierten zwei
 * Quellen fürs Alter:
 *   - `users/{uid}.age` (Integer, vom Slider) + `ageReportedAt`/
 *     `ageReportedYear` (Capture-Date)
 *   - `users/{uid}.birthDate` (Timestamp, vom DatePicker)
 *
 * T12 vereinheitlicht auf Integer-Age:
 *   - Slider in 3 Screens (Sheet, edit-profile, email-register).
 *   - Capture-Date wird mitgespeichert → currentAgeFromReported()
 *     rechnet den aktuellen Wert hoch (Year-Precision).
 *   - `ageFromBirthDate()` bleibt für LEGACY-Reads alter User-Docs
 *     die noch birthDate haben. Beim ersten Save wird auf age
 *     migriert.
 */

/** Berechnet das aktuelle Alter in vollen Jahren aus einem
 *  birthDate. Legacy-Pfad — nur für Reads alter User-Docs.
 *  Returns null wenn das Datum unplausibel ist. */
export function ageFromBirthDate(birthDate: Date | null | undefined): number | null {
  if (!birthDate) return null;
  const d = birthDate instanceof Date ? birthDate : new Date(birthDate);
  if (isNaN(d.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) {
    age--;
  }
  return age >= 0 && age <= 120 ? age : null;
}

/** Bucket-Mapping fürs Dashboard-Group-by. */
export function ageBucketFromAge(age: number): string {
  if (age <= 24) return '16-24';
  if (age <= 34) return '25-34';
  if (age <= 44) return '35-44';
  if (age <= 54) return '45-54';
  if (age <= 64) return '55-64';
  return '65+';
}

/**
 * Berechnet das aktuelle Alter aus einem damals angegebenen Wert
 * + dem Jahr der Angabe (T11.18).
 *
 * Beispiel: User hat 2026 das Alter 32 angegeben.
 *   currentAgeFromReported(32, 2026) → 2030 liefert 36.
 *
 * Hinweis: dies ist eine YEAR-PRECISION-Schätzung. Wenn der echte
 * Geburtstag im Jahr noch nicht erreicht ist, ist die Schätzung
 * 1 Jahr zu hoch. Für höhere Präzision müsste `birthDate` (Tag-
 * genau) statt `age` (Integer) erhoben werden — der Demografie-
 * Sheet erfasst aber bewusst nur das Alter (Slider) damit die UX
 * leichtgewichtig bleibt. Anonymität geht vor Tagesgenauigkeit.
 */
export function currentAgeFromReported(
  reportedAge: number,
  reportedYear: number,
  now: Date = new Date(),
): number {
  const yearsSince = now.getFullYear() - reportedYear;
  return reportedAge + Math.max(0, yearsSince);
}
