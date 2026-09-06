'use strict';

/**
 * Regionale Steuerung von Aktionen (Produktentscheidung 06.09.2026).
 *
 * Eine Aktion kann auf ein Gebiet beschränkt werden — und zwar für ALLE drei
 * Verdien-Wege (Bons, Produktfotos, Umfragen), weil die Prüfung hier zentral
 * liegt und die drei Auswerter nur `matchesTargeting()` aufrufen.
 *
 * ═══ Warum PLZ-PRÄFIXE und nicht feste „Gebiete" ═══
 *
 * Ein Präfix ist beliebig fein: '3' ist das ganze PLZ-Gebiet 3, '30' der Raum
 * Hannover, '30159' eine einzelne Zustellregion. Eine Aktion „nur Gebiet 0 und
 * 1" ist damit `zipPrefixes: ['0','1']`, eine Stadt-Aktion `['50','51']` —
 * ohne dass ein neues Konzept nötig wird. Die Bon-Daten stützen das: über die
 * letzten 30 Tage verteilen sich die Bons gleichmäßig auf alle zehn Gebiete
 * (215–520 pro Gebiet), eine Steuerung auf dieser Ebene trifft also überall
 * eine sinnvoll große Gruppe.
 *
 * ═══ Woher die Region kommt (Reihenfolge = Verlässlichkeit) ═══
 *
 *  1. `bon`    — Filialadresse aus dem Kassenbon (`receipts.store.zip`).
 *                Härteste Quelle: steht gedruckt auf dem Beleg. 84 % der Bons.
 *  2. `bonfoto`— Bon, der als Produktfoto-Preisbild eingereicht wurde
 *                (`crowd_uploads.priceReceipt.zip`).
 *  3. `profil` — abgeleitete Nutzer-Region (`users/{uid}.region`), die aus den
 *                eigenen Bons des Nutzers stammt. Damit sind auch Umfragen und
 *                Produktfotos steuerbar, obwohl dort selbst keine PLZ anfällt:
 *                4 % der Profile haben eine Ortsangabe, aber wer Bons einreicht,
 *                hat eine belegte Region.
 *  4. `ort`    — Ortsname (Produktfoto-Ortsbestätigung, Profil-Freitext), über
 *                die aus echten Bons gelernte Tabelle Ort → PLZ aufgelöst.
 *
 * ═══ Was passiert, wenn die Region unbekannt ist ═══
 *
 * Standard ist `onUnknown: 'allow'`. Wer einen Bon ohne lesbare Anschrift
 * einreicht, hat nichts falsch gemacht — ihn deshalb um die Vergütung zu
 * bringen, wäre dieselbe Ungerechtigkeit wie eine Client-only-Regel. Wer eine
 * Aktion strikt auf ein Gebiet begrenzen MUSS (z. B. weil ein Händler nur dort
 * zahlt), setzt `onUnknown: 'deny'` bewusst.
 */

/** Ein Datensatz-Land, das wir kennen. */
const COUNTRIES = new Set(['DE', 'AT', 'CH']);

const norm = (s) => String(s ?? '')
  .toLowerCase()
  .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
  .replace(/[^a-z0-9]+/g, ' ')
  .trim();

function cleanZip(z) {
  const s = String(z ?? '').replace(/\D/g, '');
  return /^\d{4,5}$/.test(s) ? s : null;
}

/**
 * Region eines Datensatzes, in der Reihenfolge der Verlässlichkeit.
 * @param {object} sources {bonZip, bonFotoZip, profilZip, ortName, country, cityToZip}
 * @returns {{zip:string|null, city:string|null, country:string|null, source:string|null}}
 */
function resolveRegion(sources = {}) {
  const { bonZip, bonFotoZip, profilZip, ortName, country, cityToZip } = sources;
  const c = COUNTRIES.has(String(country || '').toUpperCase()) ? String(country).toUpperCase() : null;

  const direct = [
    ['bon', cleanZip(bonZip)],
    ['bonfoto', cleanZip(bonFotoZip)],
    ['profil', cleanZip(profilZip)],
  ].find(([, z]) => z);
  if (direct) return { zip: direct[1], city: null, country: c, source: direct[0] };

  // Ortsname → PLZ über die aus echten Bons gelernte Tabelle.
  const key = norm(ortName);
  if (key && cityToZip) {
    const hit = cityToZip instanceof Map ? cityToZip.get(key) : cityToZip[key];
    const z = cleanZip(hit);
    if (z) return { zip: z, city: String(ortName), country: c, source: 'ort' };
  }
  return { zip: null, city: ortName ? String(ortName) : null, country: c, source: null };
}

/**
 * Passt eine Aktion zu einer Region?
 *
 * @param {object} campaign  Kampagnen-Dokument (targeting optional).
 * @param {object} region    Ergebnis von resolveRegion().
 * @returns {{ok:boolean, grund:string|null}}
 *   grund: 'kein_targeting' | 'plz_passt' | 'land_passt' | 'region_unbekannt_erlaubt'
 *        | 'plz_ausserhalb' | 'land_ausserhalb' | 'region_unbekannt'
 */
function matchesTargeting(campaign, region) {
  const t = campaign && campaign.targeting;
  const prefixes = Array.isArray(t && t.zipPrefixes) ? t.zipPrefixes.map((p) => String(p).replace(/\D/g, '')).filter(Boolean) : [];
  const countries = Array.isArray(t && t.countries) ? t.countries.map((x) => String(x).toUpperCase()).filter((x) => COUNTRIES.has(x)) : [];
  if (!prefixes.length && !countries.length) return { ok: true, grund: 'kein_targeting' };

  const zip = region && region.zip ? String(region.zip) : null;
  const land = region && region.country ? String(region.country).toUpperCase() : null;

  // Land zuerst: es ist die gröbere und zuverlässigere Angabe.
  if (countries.length) {
    if (!land) {
      // Ohne Land keine Aussage → wie unbekannte Region behandeln.
      return unknown(t);
    }
    if (!countries.includes(land)) return { ok: false, grund: 'land_ausserhalb' };
    if (!prefixes.length) return { ok: true, grund: 'land_passt' };
  }

  if (prefixes.length) {
    if (!zip) return unknown(t);
    const hit = prefixes.some((p) => zip.startsWith(p));
    return hit ? { ok: true, grund: 'plz_passt' } : { ok: false, grund: 'plz_ausserhalb' };
  }
  return { ok: true, grund: 'kein_targeting' };
}

function unknown(t) {
  const mode = t && t.onUnknown === 'deny' ? 'deny' : 'allow';
  return mode === 'deny'
    ? { ok: false, grund: 'region_unbekannt' }
    : { ok: true, grund: 'region_unbekannt_erlaubt' };
}

/**
 * Aus mehreren aktiven Aktionen die passende wählen.
 *
 * Warum der Server das darf und soll: Beim Bon wählt die App die Aktion, BEVOR
 * irgendjemand die Filialadresse kennt — die steht erst nach der Texterkennung
 * fest. Eine regionale Aktion könnte der Nutzer also gar nicht korrekt wählen.
 * Deshalb korrigiert der Server: passt die gewählte Aktion nicht zur Region,
 * bekommt der Bon die nächstbeste passende Aktion derselben Art.
 *
 * @param {object[]} campaigns   aktive Aktionen (bereits nach Art gefiltert)
 * @param {object} region
 * @param {string|null} preferredId  vom Client gewählte Aktion
 * @returns {{campaign:object|null, korrigiert:boolean, grund:string|null}}
 */
function pickCampaignForRegion(campaigns, region, preferredId) {
  const list = Array.isArray(campaigns) ? campaigns.filter(Boolean) : [];
  if (!list.length) return { campaign: null, korrigiert: false, grund: 'keine_aktion' };

  const preferred = preferredId ? list.find((c) => c.id === preferredId) : null;
  if (preferred) {
    const m = matchesTargeting(preferred, region);
    if (m.ok) return { campaign: preferred, korrigiert: false, grund: m.grund };
  }

  // Die passenden Alternativen: engste zuerst (eine Stadt-Aktion schlägt die
  // bundesweite), bei Gleichstand das frühere Ende — wie in der App-Liste.
  const passend = list
    .filter((c) => c !== preferred && matchesTargeting(c, region).ok)
    .sort((a, b) => {
      const sa = spezifitaet(a);
      const sb = spezifitaet(b);
      if (sa !== sb) return sb - sa;
      return (endMs(a) || Infinity) - (endMs(b) || Infinity);
    });

  if (!passend.length) {
    return { campaign: null, korrigiert: false, grund: preferred ? 'region_ausserhalb' : 'keine_passende_aktion' };
  }
  return { campaign: passend[0], korrigiert: Boolean(preferred), grund: matchesTargeting(passend[0], region).grund };
}

/** Je genauer das Gebiet, desto höher — eine 5-stellige Aktion schlägt eine bundesweite. */
function spezifitaet(c) {
  const t = c && c.targeting;
  const prefixes = Array.isArray(t && t.zipPrefixes) ? t.zipPrefixes : [];
  if (prefixes.length) return Math.max(...prefixes.map((p) => String(p).replace(/\D/g, '').length || 0));
  if (Array.isArray(t && t.countries) && t.countries.length) return 0.5;
  return 0;
}

function endMs(c) {
  const e = c && c.endAt;
  if (!e) return null;
  if (typeof e.toMillis === 'function') return e.toMillis();
  if (e instanceof Date) return e.getTime();
  if (typeof e === 'number') return e;
  return null;
}

/** Kurzform fürs Dokument/Log: was galt bei der Entscheidung. */
function targetingStamp(campaign, region, match) {
  return {
    zip: (region && region.zip) || null,
    country: (region && region.country) || null,
    source: (region && region.source) || null,
    grund: (match && match.grund) || null,
    zipPrefixes: (campaign && campaign.targeting && campaign.targeting.zipPrefixes) || null,
  };
}

module.exports = { resolveRegion, matchesTargeting, pickCampaignForRegion, targetingStamp, norm, cleanZip, COUNTRIES };
