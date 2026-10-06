/**
 * Infrastrukturfehler der Produktdaten-Suche — EINE Stelle für alle drei
 * Dienste (KI-Auslesen, Serper-Suche, Apify-Rendering).
 *
 * Regel (CLAUDE.md): Ein Infrastrukturfehler ist NIE eine Aussage über das
 * Produkt. Wer einen dieser Fehler fängt, darf daraus kein „keine Daten“
 * machen — scrapeEan antwortet dann mit 503, und der external-misses-processor
 * versucht die EAN später erneut.
 *
 * Anlass: Vom 18.08. bis 01.10.2026 war das Anthropic-Guthaben leer; das
 * Auslesen meldete „nichts gefunden“, und ~5.400 EANs wurden dauerhaft als
 * 'no-data' abgeschlossen. Serper und Apify hatten dieselbe Schwäche
 * (Guthaben/Kontofehler → still leere Liste bzw. null).
 */

class InfrastrukturFehler extends Error {
  constructor(code, message, cause) {
    super(message);
    this.name = 'InfrastrukturFehler';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

/** KI nicht erreichbar, Kontingent, Zeitlimit, kaputte Antwort nach Wiederholungen. */
class ExtractUnavailableError extends InfrastrukturFehler {
  constructor(message, cause) { super('extract_unavailable', message, cause); this.name = 'ExtractUnavailableError'; }
}
/** Serper-Suche gescheitert (Netz, Zeitlimit, HTTP-Fehler inkl. leerem Guthaben). */
class SearchUnavailableError extends InfrastrukturFehler {
  constructor(message, cause) { super('search_unavailable', message, cause); this.name = 'SearchUnavailableError'; }
}
/** Apify-Konto-/Kontingentfehler (401/402/403/429) — betrifft jede Seite, nicht nur diese.
 *  Außerdem das Gesamturteil von scrapeEan, wenn KEIN Kandidat eine Seite
 *  geliefert hat, weil alle an Abruffehlern scheiterten (siehe unten). */
class FetchUnavailableError extends InfrastrukturFehler {
  constructor(message, cause) { super('fetch_unavailable', message, cause); this.name = 'FetchUnavailableError'; }
}

/**
 * EINE Seite war nicht abrufbar: 401/403/408/425/429, 5xx, Zeitlimit oder
 * Netzfehler — beim Shop selbst oder beim Apify-Rendering dieser Seite.
 *
 * Bewusst KEIN InfrastrukturFehler: Kaufland antwortet praktisch immer mit
 * 403, zwei solche Seiten hintereinander dürfen die Suche nicht abbrechen.
 * Aber auch keine Aussage über das Produkt — bis 04.10.2026 gab fetchHtml
 * hier null zurück, der Kandidat zählte wie eine leere Seite, und scheiterten
 * alle Kandidaten so, schloss der Prozessor die EAN als 'no-data' ab
 * (seit 02.10. neun Fälle, die ausschließlich daran scheiterten). Wer alle
 * Kandidaten nur so verliert, antwortet mit FetchUnavailableError (503).
 */
class SeiteNichtAbrufbarError extends Error {
  constructor(url, { status = null, grund = 'http' } = {}, cause) {
    super(`Seite nicht abrufbar (${status ?? grund}): ${url}`);
    this.name = 'SeiteNichtAbrufbarError';
    this.code = 'seite_nicht_abrufbar';
    this.url = url;
    this.status = status;
    // 'http' | 'zeitlimit' | 'netz' beim Shop; 'apify_<status>' |
    // 'apify_leer' | 'apify_antwort' | 'apify_zeitlimit' | 'apify_netz' beim
    // Rendern über Apify (src/fetcher.js)
    this.grund = grund;
    if (cause) this.cause = cause;
  }
}

/** HTTP-Status, die einen Abruffehler bedeuten (nicht „Seite gibt es nicht“). */
function istAbrufFehlerStatus(status) {
  return [401, 403, 408, 425, 429].includes(status) || status >= 500;
}

module.exports = {
  InfrastrukturFehler,
  ExtractUnavailableError,
  SearchUnavailableError,
  FetchUnavailableError,
  SeiteNichtAbrufbarError,
  istAbrufFehlerStatus,
};
