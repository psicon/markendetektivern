/**
 * Age-Utilities — birthDate als Single Source of Truth.
 *
 * Hintergrund: vor T6 koexistierten zwei Quellen für das Alter:
 *   - `users/{uid}.age` (Integer, vom Onboarding-Slider geschrieben)
 *   - `users/{uid}.birthDate` (Timestamp, vom Register-Date-Picker)
 * Bei Geburtstag-Übergängen veraltete `age` und wurde inkonsistent.
 *
 * T6 macht `birthDate` zur Source of Truth wenn vorhanden:
 *   - Read: ageFromBirthDate() liefert die echte Zahl just-in-time.
 *   - Write: wenn nur ein Slider-Age gegeben ist (Onboarding-
 *     Bottom-Sheet T3), wird sowohl `age` als auch ein
 *     approximativer `birthDate`-Stamp gespeichert. Edit-Profile
 *     kann später den exakten Tag setzen ohne dass die Integer-
 *     Auswertung kaputt geht.
 */

/** Berechnet das aktuelle Alter in vollen Jahren aus einem
 *  birthDate. Returns null wenn das Datum unplausibel ist. */
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

/** Aus integer-Age einen approximativen birthDate-Stamp ableiten
 *  (1. Januar des passenden Jahres). Wird gebraucht wenn Onboarding-
 *  Slider den Wert liefert aber wir keinen exakten Tag haben.
 *  Edit-Profile überschreibt das später mit dem echten Datum. */
export function approximateBirthDateFromAge(age: number): Date {
  const now = new Date();
  return new Date(now.getFullYear() - age, 0, 1);
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
