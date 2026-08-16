'use strict';

/**
 * Tests des Negativ-Cache-Prädikats (istPendingFrisch).
 *
 * Die Funktion entscheidet, ob eine Bon-Zeile die teure Analyse
 * (Embedding + Gemini) überspringt. Die teuren Fehler wären unsichtbar:
 * Ein zu großzügiger Skip friert falsche Zuordnungen ein, ein Skip trotz
 * menschlicher Freigabe würde die Freigabe ignorieren. Deshalb prüfen
 * die Tests vor allem die Vorrang-Regeln.
 */

const admin = require('firebase-admin');
if (!admin.apps.length) admin.initializeApp({ projectId: 'test-projekt' });

const { istPendingFrisch, PENDING_TTL_MS, MATCH_VERSION } = require('../matcher');

const JETZT = 1_700_000_000_000;
const ts = (ms) => ({ toMillis: () => ms });

const frischerMarker = (over = {}) => ({
  pendingStatus: 'needs_review',
  pendingMatchVersion: MATCH_VERSION,
  lastAiAt: ts(JETZT - 60_000),
  ...over,
});

describe('Ein frischer Pending-Marker ersetzt die Neu-Analyse', () => {
  it('needs_review innerhalb der TTL ist frisch', () => {
    expect(istPendingFrisch(frischerMarker(), JETZT, MATCH_VERSION)).toBe(true);
  });

  it('promotion_pending ebenso', () => {
    expect(
      istPendingFrisch(
        frischerMarker({ pendingStatus: 'promotion_pending', pendingReweapifyId: 'x1' }),
        JETZT,
        MATCH_VERSION,
      ),
    ).toBe(true);
  });
});

describe('Eine Entscheidung gewinnt IMMER gegen den Marker', () => {
  it('menschlich gelocktes Alias ist nie "pending"', () => {
    // Der wichtigste Fall: Review-Team hat entschieden, während der
    // Marker noch am Doc klebt. Der Lookup muss den Lock nehmen.
    expect(
      istPendingFrisch(frischerMarker({ resolvedBy: 'human' }), JETZT, MATCH_VERSION),
    ).toBe(false);
  });

  it('automatisch gelocktes Alias ebenso', () => {
    expect(
      istPendingFrisch(frischerMarker({ resolvedBy: 'ai-auto' }), JETZT, MATCH_VERSION),
    ).toBe(false);
  });

  it('das historische "ai-review-pending" zählt NICHT als Lock', () => {
    // Dieser Wert war im Lookup schon immer als nicht-gelockt definiert.
    expect(
      istPendingFrisch(frischerMarker({ resolvedBy: 'ai-review-pending' }), JETZT, MATCH_VERSION),
    ).toBe(true);
  });
});

describe('Der Cache verfällt', () => {
  it('nach Ablauf der TTL wird neu analysiert — der Katalog wächst', () => {
    const alt = frischerMarker({ lastAiAt: ts(JETZT - PENDING_TTL_MS - 1) });
    expect(istPendingFrisch(alt, JETZT, MATCH_VERSION)).toBe(false);
  });

  it('exakt an der Grenze: noch frisch eine Millisekunde davor', () => {
    const knapp = frischerMarker({ lastAiAt: ts(JETZT - PENDING_TTL_MS + 1) });
    expect(istPendingFrisch(knapp, JETZT, MATCH_VERSION)).toBe(true);
  });

  it('eine neue Matcher-Version entwertet alte Marker', () => {
    const marker = frischerMarker({ pendingMatchVersion: MATCH_VERSION - 1 });
    expect(istPendingFrisch(marker, JETZT, MATCH_VERSION)).toBe(false);
  });
});

describe('Robustheit gegen kaputte Daten', () => {
  it('kein Marker, kein Skip', () => {
    expect(istPendingFrisch(null, JETZT, MATCH_VERSION)).toBe(false);
    expect(istPendingFrisch({}, JETZT, MATCH_VERSION)).toBe(false);
  });

  it('fehlender oder kaputter Zeitstempel heißt: neu analysieren', () => {
    // Genau die Fehlerklasse der Journey-Sentinels: ein Objekt, das wie
    // ein Timestamp aussieht, aber keiner ist, darf nie als frisch gelten.
    expect(istPendingFrisch(frischerMarker({ lastAiAt: null }), JETZT, MATCH_VERSION)).toBe(false);
    expect(
      istPendingFrisch(frischerMarker({ lastAiAt: { _methodName: 'serverTimestamp' } }), JETZT, MATCH_VERSION),
    ).toBe(false);
  });
});
