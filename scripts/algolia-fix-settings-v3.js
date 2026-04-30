// Algolia Settings + Synonyme v3 — saubere FMCG-Suche.
//
// Strategie (siehe Conversation für ausführliche Begründung):
//
// 1. Algolia-Native Features voll aktivieren (Layer 1 der Such-
//    Pipeline aus dem Strategie-Doc):
//      • removeStopWords: ['de']     — "der/die/das/mit/und/von/im/im"
//        raus aus der Query.
//      • decompoundedAttributes      — deutsche Komposita zerlegen.
//        "Apfelsaft" findet "Saft", "Schokoladenpudding" findet
//        "Schokolade" — ohne dass wir Synonyme pflegen müssen.
//      • ignorePlurals: ['de']       — "Tomate" / "Tomaten" gleich.
//      • queryLanguages: ['de']      — Deutsch-Linguistik aktivieren.
//
// 2. Synonyme drastisch reduzieren auf das, was Decompounding NICHT
//    abfängt: Regionalismen, Schreibweisen, eindeutige Bierstile.
//    Mehrdeutige Adjektive (helles, dunkel, leicht, mild, scharf,
//    weizen, lager, bock, alt) bleiben draußen — sie matchen dann
//    nur wörtlich, was in 95 % der Fälle korrekt ist.
//
// Konsequenzen für die Suche:
//   • "Apfelsaft" / "Saft" / "Apfel"      → alle drei finden
//                                           Apfelsaft-Produkte (decompound).
//   • "Schokolade" / "Schoko" / "Schokopudding" → alle drei finden
//                                           Schoko-Produkte (decompound +
//                                           kurze Synonym-Gruppe).
//   • "Bier"                              → nur echte Biere, keine
//                                           Helles-Brot-False-Positives mehr.
//   • "Tomate" / "Tomaten" / "Tomatensoße" → alles korrekt ohne
//                                           Synonym (decompound + plurals).
//
// Hinweis für später: Wenn nach Tier 1+2 noch konkrete Suchen stinken,
// machen wir Algolia "Rules" (Merchandising) statt mehr Synonyme.
// Rules sind chirurgischer ("wenn Query=X dann boost ObjectID=Y nach
// oben") und ohne Side Effects auf andere Suchen.

const { algoliasearch } = require('algoliasearch');

const APP_ID = 'Y0KKZHT49Q';
const ADMIN_KEY = '6513c383e437bb744db65c43898d9a64';

// ─── Index-Settings — pro Index ──────────────────────────────────────
//
// Wir setzen NICHT alles via setSettings — searchableAttributes +
// existierende Settings bleiben unangetastet (sind in v2 schon
// kuratiert). Nur die NEUEN Native-Features-Knöpfe drehen.
const NEW_SETTINGS_NONAME = {
  // Deutsch-Linguistik aktivieren — basis für Stops, Plurals,
  // Decompound. War in v2 schon mal gesetzt, hier zur Sicherheit
  // explizit nochmal mit.
  queryLanguages: ['de'],
  // Stop-Words entfernen.
  removeStopWords: ['de'],
  // Plurals/Singulars vereinheitlichen.
  ignorePlurals: ['de'],
  // Deutsche Komposita zerlegen — auf den Feldern wo Free-Text
  // steht. `name` ist der Produktname, `beschreibung` sind die
  // Tags. Die ID-/Referenz-Felder (handelsmarke, kategorie etc.)
  // dürfen NICHT decompounded werden, sonst zerlegen wir auch
  // Marken-Strings.
  decompoundedAttributes: {
    de: ['name', 'beschreibung'],
  },
};

// Markenprodukte-Index hat keine `beschreibung`-Tags — aber `name`
// reicht völlig, das ist eh das wichtigste Suchfeld. Wenn beschreibung
// existiert wird sie ignoriert (Algolia kümmert das nicht).
const NEW_SETTINGS_MARKEN = {
  queryLanguages: ['de'],
  removeStopWords: ['de'],
  ignorePlurals: ['de'],
  decompoundedAttributes: {
    de: ['name', 'beschreibung'],
  },
};

// ─── Synonyme — drastisch reduziert ──────────────────────────────────
//
// Vorher 13 Gruppen, jetzt 7. Jede einzelne dient einem konkreten
// Bedarf den Decompounding nicht erschlägt:
//
//   • Bierstile:    eindeutige Markennamen für Bier-Sorten, die nicht
//                   das Wort "Bier" enthalten (Pils, Kölsch …).
//                   Ohne Synonym findet "Bier" kein Pils.
//   • Pasta/Nudeln: keine Wortverwandtschaft, decompound hilft nicht.
//   • Quark/Topfen: regional (D vs. AT), keine Wortverwandtschaft.
//   • Brötchen/Semmel/Schrippe/Weckle/Rundstück: regional.
//   • Joghurt/Jogurt/Yoghurt: Schreibweisen.
//                  Skyr ist NICHT mehr drin — Skyr ist eine eigene
//                  Produktklasse, wer Skyr sucht will keinen
//                  generischen Joghurt.
//   • Limo/Limonade: Abkürzung. (Softdrink rausgenommen — Cola ist
//                  Softdrink aber nicht "Limonade".)
//   • Schoko/Schokolade: Abkürzung. (Decompound deckt
//                  "Schokoladenpudding"→"Schokolade" ab, aber NICHT
//                  Schoko↔Schokolade weil "Schoko" kein eigener
//                  Wortstamm im Lexikon ist.)
const SYNONYM_GROUPS = [
  ['bier', 'pils', 'pilsener', 'pilsner', 'kölsch', 'altbier', 'bockbier', 'weizenbier', 'weißbier', 'weissbier', 'hefeweizen', 'lagerbier'],
  ['pasta', 'nudeln', 'teigwaren'],
  ['quark', 'topfen'],
  ['brötchen', 'semmel', 'schrippe', 'weckle', 'rundstück'],
  ['joghurt', 'jogurt', 'yoghurt'],
  ['limo', 'limonade'],
  ['schokolade', 'schoko'],
];

const INDICES = [
  { name: 'produkte', settings: NEW_SETTINGS_NONAME },
  { name: 'markenProdukte', settings: NEW_SETTINGS_MARKEN },
];

async function main() {
  const client = algoliasearch(APP_ID, ADMIN_KEY);

  for (const { name: indexName, settings } of INDICES) {
    console.log(`\n→ Index "${indexName}":`);

    // 1. Settings patchen — partial update via setSettings, alle
    //    NICHT genannten Settings bleiben unangetastet.
    const settingsRes = await client.setSettings({
      indexName,
      indexSettings: settings,
      forwardToReplicas: true,
    });
    console.log(`  ✅ Settings patched (taskID ${settingsRes.taskID})`);
    await client.waitForTask({ indexName, taskID: settingsRes.taskID });
    console.log(`  ✅ Settings reindex done`);

    // 2. Synonyme atomar ersetzen.
    const synonyms = SYNONYM_GROUPS.map((tokens, i) => ({
      objectID: `fmcg-syn-v3-${i}`,
      type: 'synonym',
      synonyms: tokens,
    }));

    const synRes = await client.saveSynonyms({
      indexName,
      synonymHit: synonyms,
      replaceExistingSynonyms: true,
      forwardToReplicas: true,
    });
    console.log(`  ✅ ${synonyms.length} Synonymgruppen gepusht (taskID ${synRes.taskID})`);
    await client.waitForTask({ indexName, taskID: synRes.taskID });
    console.log(`  ✅ Synonyme reindex done`);
  }

  console.log('\n✨ Algolia Settings + Synonyme v3 erfolgreich angewendet.');
  console.log('   • Decompounding aktiv für name + beschreibung');
  console.log('   • Stop-Words + Plurals deutsch');
  console.log('   • 7 Synonymgruppen statt 13');
}

main().catch((e) => {
  console.error('❌ Fehler:', e);
  process.exit(1);
});
