'use strict';
/**
 * Statistik fürs Dashboard (tagesbericht.html) — die letzten N Tage, direkt aus
 * den echten Daten, unabhängig davon, ob die Morgenrunde lief.
 *
 * Anlass (24.09.2026): Das Dashboard zeigte nur Berichte der Morgenrunde, und
 * die gibt es erst ab dem 24.09. Patrick wollte „inklusive Statistiken" — also
 * auch den Verlauf davor.
 *
 * Geld kommt aus dem LEDGER, nicht aus `crowd_uploads.rewardCents`: das Feld
 * fehlt an ~40 % der gebuchten Freigaben (CLAUDE.md, gemessen 19.09.). Jede
 * Foto-Buchung hat die feste ID `users/{uid}/cashback_ledger/crowd_{uploadId}`
 * und wird gezielt gelesen — kein collectionGroup-Suchlauf.
 * Bon-Beträge stammen aus `receipts.cashbackCents` (nach der Budget-Deckelung
 * geschrieben) und gelten nur für Status approved/paid.
 *
 * Diese Datei ist rein (keine Firestore-Abhängigkeit); das Laden macht index.js.
 */

const berlinTag = (t) => new Date(t).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });

function leereTage(jetzt, tage) {
  const liste = [];
  const gesehen = new Set();
  for (let i = tage - 1; i >= 0; i--) {
    const tag = berlinTag(jetzt - i * 24 * 60 * 60 * 1000);
    if (gesehen.has(tag)) continue; // Zeitumstellung: ein Kalendertag kann doppelt fallen
    gesehen.add(tag);
    liste.push(tag);
  }
  return liste;
}

const plus = (obj, key, n = 1) => { obj[key] = (obj[key] || 0) + n; };

/**
 * @param {object} e
 * @param {number} e.jetzt
 * @param {number} e.tage
 * @param {Array<{id:string, status:string, createdAt:number|null, reviewedAt:number|null, rejectReason:string|null}>} e.fotos
 * @param {Map<string,{cents:number, at:number|null}>} e.fotoBuchungen  uploadId → Ledger-Eintrag (earn)
 * @param {Array<{status:string, createdAt:number|null, grund:string|null, cents:number}>} e.bons
 */
function baueStatistik({ jetzt, tage, fotos, fotoBuchungen, bons }) {
  const tagesliste = leereTage(jetzt, tage);
  const imFenster = new Set(tagesliste);
  const leer = () => ({ eingereicht: 0, freigegeben: 0, abgelehnt: 0, cents: 0 });
  const fotoTage = Object.fromEntries(tagesliste.map((t) => [t, leer()]));
  const bonTage = Object.fromEntries(tagesliste.map((t) => [t, { eingereicht: 0, approved: 0, no_reward: 0, rejected: 0, sonst: 0, cents: 0 }]));
  const fotoGruende = {};
  const bonGruende = {};
  let fotosOffen = 0;
  let bonsInPruefung = 0;

  for (const f of fotos || []) {
    if (f.status === 'pending') fotosOffen++;
    const ein = f.createdAt ? berlinTag(f.createdAt) : null;
    if (ein && imFenster.has(ein)) fotoTage[ein].eingereicht++;
    const buchung = fotoBuchungen && fotoBuchungen.get(f.id);
    // Entscheidungstag: reviewedAt, bei Altbeständen ohne reviewedAt der Buchungstag.
    const entschieden = f.reviewedAt || (buchung && buchung.at) || null;
    const tag = entschieden ? berlinTag(entschieden) : null;
    if (!tag || !imFenster.has(tag)) continue;
    if (f.status === 'approved') {
      fotoTage[tag].freigegeben++;
      if (buchung && buchung.cents > 0) fotoTage[tag].cents += buchung.cents;
    } else if (f.status === 'rejected') {
      fotoTage[tag].abgelehnt++;
      plus(fotoGruende, f.rejectReason || 'ohne_grund');
    }
  }

  for (const b of bons || []) {
    if (b.status === 'review') bonsInPruefung++;
    const tag = b.createdAt ? berlinTag(b.createdAt) : null;
    if (!tag || !imFenster.has(tag)) continue;
    const t = bonTage[tag];
    t.eingereicht++;
    if (b.status === 'approved' || b.status === 'paid') {
      t.approved++;
      t.cents += Math.max(0, Number(b.cents) || 0);
    } else if (b.status === 'no_reward') {
      t.no_reward++;
      plus(bonGruende, b.grund || 'ohne_grund');
    } else if (b.status === 'rejected') {
      t.rejected++;
      plus(bonGruende, b.grund || 'ohne_grund');
    } else {
      t.sonst++;
    }
  }

  const summe = (tageObj, felder, von) => {
    const s = Object.fromEntries(felder.map((k) => [k, 0]));
    tagesliste.slice(von).forEach((t) => felder.forEach((k) => { s[k] += tageObj[t][k] || 0; }));
    return s;
  };
  const fotoFelder = ['eingereicht', 'freigegeben', 'abgelehnt', 'cents'];
  const bonFelder = ['eingereicht', 'approved', 'no_reward', 'rejected', 'sonst', 'cents'];
  return {
    tage: tagesliste,
    fotos: {
      jeTag: tagesliste.map((t) => ({ tag: t, ...fotoTage[t] })),
      summe: summe(fotoTage, fotoFelder, 0),
      letzte7: summe(fotoTage, fotoFelder, Math.max(0, tagesliste.length - 7)),
      gruende: fotoGruende,
      offen: fotosOffen,
    },
    bons: {
      jeTag: tagesliste.map((t) => ({ tag: t, ...bonTage[t] })),
      summe: summe(bonTage, bonFelder, 0),
      letzte7: summe(bonTage, bonFelder, Math.max(0, tagesliste.length - 7)),
      gruende: bonGruende,
      inPruefung: bonsInPruefung,
    },
  };
}

module.exports = { baueStatistik, leereTage };
