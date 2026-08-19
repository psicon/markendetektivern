'use strict';

/**
 * Gemeinsamer Gemini-Client für assessor/comparator/manufacturer.
 *
 * Backend-Umschaltung (Incident 19.08.2026): AI-Studio-Keys haengen am
 * monatlichen Spending-Cap der Rechnungskontostufe — bei Erreichen liefern
 * ALLE Keys des Kontos 429 RESOURCE_EXHAUSTED. Vertex AI rechnet uebers
 * GCP-Projekt-Billing und kennt dieses Stufenlimit nicht. Das genutzte
 * Modell (gemini-3.5-flash) ist unter Location 'global' publiziert
 * (geprueft 19.08.2026). GEMINI_USE_VERTEX=false = alter AI-Studio-Pfad
 * ueber den uebergebenen apiKey.
 */

const { GoogleGenAI } = require('@google/genai');

let _client = null;
function getGenAIClient(apiKey) {
  if (_client) return _client;
  const useVertex = String(process.env.GEMINI_USE_VERTEX ?? 'true') !== 'false';
  if (useVertex) {
    _client = new GoogleGenAI({
      vertexai: true,
      project: process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'markendetektive-895f7',
      location: process.env.GEMINI_VERTEX_LOCATION || 'global',
    });
    return _client;
  }
  if (!apiKey) throw new Error('GEMINI_API_KEY not set');
  _client = new GoogleGenAI({ apiKey });
  return _client;
}

module.exports = { getGenAIClient };
