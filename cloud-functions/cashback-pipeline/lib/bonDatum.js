'use strict';

/**
 * 86cb9zuq1: Jahres-Fehllesung erkennen. Liest die OCR „24.08.26" als
 * 2020-08-24, landet der Bon als bon_too_old — obwohl Tag+Monat exakt dem
 * Upload-Tag entsprechen (37 Live-Fälle, alle dieses Musters; niemand lädt
 * Jahre später am selben Kalendertag hoch). Regel: Tag+Monat == Upload-Tag
 * (Berlin) UND Jahr != Upload-Jahr → Jahr auf das Upload-Jahr korrigieren.
 * @returns {{ bonDate: string|null, corrected: null|{from:string,to:string,reason:string} }}
 */
function plausibilizeBonDate(iso, uploadedAt, { maxTage = 7 } = {}) {
  if (typeof iso !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return { bonDate: iso ?? null, corrected: null };
  }
  const up = uploadedAt instanceof Date && Number.isFinite(uploadedAt.getTime()) ? uploadedAt : new Date();
  const upIso = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(up); // YYYY-MM-DD
  const upYear = upIso.slice(0, 4);
  if (iso.slice(5) === upIso.slice(5) && iso.slice(0, 4) !== upYear) {
    const to = `${upYear}-${iso.slice(5)}`;
    return { bonDate: to, corrected: { from: iso, to, reason: 'year_misread_same_day' } };
  }
  // Erweiterung 11.10.2026 (Patrick: „ja“): liegen Tag+Monat mit dem Upload-Jahr
  // (oder, über den Jahreswechsel, dem Vorjahr) höchstens maxTage vor
  // dem Upload, ist ein anderes gelesenes Jahr eine Fehllesung („09.10.26“ als
  // 2020). Gemessen 10.09.–11.10.2026: 20 Bons nur deshalb als zu alt
  // abgelehnt, darunter bon_mv3g41ngk06agr (zwei Gemini-Lesungen „2020“, Mistral
  // und Haiku „2026“). Ein echter Bon desselben Kalendertags aus einem Vorjahr
  // würde dadurch ebenfalls angenommen — bewusst in Kauf genommen.
  if (iso.slice(0, 4) !== upYear) {
    const upMs = Date.parse(`${upIso}T12:00:00Z`);
    for (const jahr of [Number(upYear), Number(upYear) - 1]) {
      const kandidat = `${jahr}-${iso.slice(5)}`;
      const kMs = Date.parse(`${kandidat}T12:00:00Z`);
      if (!Number.isFinite(kMs) || kandidat === iso) continue;
      const tage = Math.round((upMs - kMs) / 86400000);
      if (tage >= 0 && tage <= maxTage) {
        return { bonDate: kandidat, corrected: { from: iso, to: kandidat, reason: 'year_misread_recent' } };
      }
    }
  }
  return { bonDate: iso, corrected: null };
}

module.exports = { plausibilizeBonDate };
