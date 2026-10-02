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
/** Apify-Konto-/Kontingentfehler (401/402/403/429) — betrifft jede Seite, nicht nur diese. */
class FetchUnavailableError extends InfrastrukturFehler {
  constructor(message, cause) { super('fetch_unavailable', message, cause); this.name = 'FetchUnavailableError'; }
}

module.exports = { InfrastrukturFehler, ExtractUnavailableError, SearchUnavailableError, FetchUnavailableError };
