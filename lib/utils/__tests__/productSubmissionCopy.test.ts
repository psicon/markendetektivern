import { describeSubmission, primaryReasonCode } from '../productSubmissionCopy';

describe('productSubmissionCopy (86cbam5ep)', () => {
  it('pending ohne Gründe → Wird geprüft', () => {
    const c = describeSubmission({ status: 'pending' });
    expect(c.label).toBe('Wird geprüft');
    expect(c.tone).toBe('pending');
  });

  it('pending MIT holdReasons → Zurückgestellt mit übersetztem Grund', () => {
    const c = describeSubmission({ status: 'pending', holdReasons: ['ean_fehlt'] });
    expect(c.label).toBe('Zurückgestellt');
    expect(c.headline).toMatch(/Strichcode/);
    expect(c.tone).toBe('held');
  });

  it('rejected → Nicht gezählt; Freitext-Suffix wird NIE angezeigt', () => {
    const c = describeSubmission({ status: 'rejected', holdReasons: ['fotos_unpassend: Smartphone statt Preisschild'] });
    expect(c.label).toBe('Nicht gezählt');
    expect(c.headline).toBe('Ein Foto passte nicht zum Schritt');
    expect(`${c.headline} ${c.body}`).not.toMatch(/Smartphone/);
  });

  it('rejected mit rejectReason (ohne holdReasons) → derselbe Code-Vorrat', () => {
    const c = describeSubmission({ status: 'rejected', rejectReason: 'doppelt_eingereicht' });
    expect(c.headline).toMatch(/schon eingereicht/);
  });

  it('rejected mit unbekanntem Code → generischer, positiver Hinweis', () => {
    const c = describeSubmission({ status: 'rejected', rejectReason: 'irgendwas_neues' });
    expect(c.label).toBe('Nicht gezählt');
    expect(c.body).toMatch(/nächsten Produkt/);
  });

  it('approved → Angenommen; Vergütungs-Hinweis nur mit Aktion, Orts-Hinweis bei rewardSkipped', () => {
    expect(describeSubmission({ status: 'approved', campaignId: 'x' }).body).toMatch(/Cashback-Guthaben/);
    expect(describeSubmission({ status: 'approved', campaignId: null }).body).not.toMatch(/Cashback-Guthaben/);
    expect(describeSubmission({ status: 'approved', campaignId: 'x', rewardSkipped: true }).body).toMatch(/Standort/);
  });

  it('Copy-Ton: nie „abgelehnt"/„falsch"/„Fehler" in Nutzer-Texten', () => {
    const codes = ['ean_fehlt', 'kein_produktname', 'produkt_bereits_verguetet', 'doppelt_eingereicht', 'bilder_wiederverwendet', 'fotos_unpassend', 'preis_fehlt', 'sperre_woche_gleicher_nutzer', 'preis_bildschirm', 'unbekannt'];
    for (const code of codes) {
      const c = describeSubmission({ status: 'rejected', rejectReason: code });
      expect(`${c.label} ${c.headline} ${c.body}`).not.toMatch(/abgelehnt|falsch|Fehler/i);
    }
  });

  it('preis_fehlt (Preis-Pflicht seit 26.09.2026) hat einen eigenen Text, nicht den Standardtext', () => {
    const c = describeSubmission({ status: 'rejected', rejectReason: 'preis_fehlt' });
    expect(c.headline).toMatch(/kein Preis/);
    expect(c.body).toMatch(/Preisschild|Kassenbon/);
  });

  // 02.10.2026 (Entscheidung Patrick): Wochen-Sperre. Der Server schreibt
  // vorerst `doppelt_eingereicht` (alle Versionen kennen ihn), der präzise
  // Text liegt für die nächste Version bereit. Keiner der Texte darf noch
  // versprechen, dass anderer Preis/Hersteller/Markt sofort zählt.
  it('Wochen-Sperre: kein Text verspricht „sofort mit anderem Preis/Hersteller/Markt"', () => {
    for (const code of ['doppelt_eingereicht', 'sperre_woche_gleicher_nutzer', 'sperre_30_tage_gleicher_nutzer']) {
      const c = describeSubmission({ status: 'rejected', rejectReason: code });
      expect(c.headline).not.toBe('Diese Einreichung konnte nicht gezählt werden');
      expect(`${c.headline} ${c.body}`).not.toMatch(/Preis|Hersteller|Markt|nächsten Tag/);
    }
    expect(describeSubmission({ status: 'rejected', rejectReason: 'sperre_woche_gleicher_nutzer' }).body).toMatch(/nächster Woche/);
  });

  // 04.10.2026: Bildschirmfoto als Preisbeleg. Der Server schreibt vorerst
  // `fotos_unpassend` (alle Versionen kennen ihn); der eigene Text liegt bereit.
  it('preis_bildschirm hat einen eigenen Text und nennt, was zählt (Preisschild, Kassenbon, e-Bon)', () => {
    const c = describeSubmission({ status: 'rejected', rejectReason: 'preis_bildschirm' });
    expect(c.headline).not.toBe('Diese Einreichung konnte nicht gezählt werden');
    expect(c.headline).toMatch(/Bildschirm/);
    expect(c.body).toMatch(/Preisschild/);
    expect(c.body).toMatch(/e-Bon/);
  });

  it('primaryReasonCode bevorzugt holdReasons und strippt den Suffix', () => {
    expect(primaryReasonCode({ holdReasons: ['fotos_unpassend: xyz'], rejectReason: 'ean_fehlt' })).toBe('fotos_unpassend');
    expect(primaryReasonCode({ rejectReason: 'ean_fehlt' })).toBe('ean_fehlt');
    expect(primaryReasonCode({})).toBeNull();
  });
});
