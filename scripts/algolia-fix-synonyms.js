// Algolia Synonym-Fix v3 — saubere Bier-Familie ohne mehrdeutige Wörter.
//
// Problem-Historie:
//   v1 (initial): bidirektional bier ↔ pils ↔ lager ↔ helles ↔ weizen ↔ ...
//        → "Bier" findet "Helles Brot", "Weizenbrot", "Weizentoast".
//   v2 (vorher): "weizen" rausgenommen, "weizenbier → bier" einseitig.
//        → "Bier" findet immer noch "Helles Brot" (helles war noch drin).
//   v3 (hier):  ALLE mehrdeutigen Tokens raus aus den Synonymgruppen.
//        Mehrdeutig = Wort hat eine Nicht-Bier-Bedeutung im Deutschen
//        die in unserem Produkt-Index real vorkommen kann.
//
// Mehrdeutige Tokens, die NICHT als Synonym für "Bier" eingetragen
// werden dürfen (sie machen dann nur wörtlichen Match):
//   • "weizen"   → auch Weizenmehl, Weizenbrot, Weizentoast
//   • "helles"   → auch generisches Adjektiv "hell" (Helles Brot)
//   • "lager"    → auch Lagerware / Vorrat-Bezeichnung
//   • "bock"     → auch Tier (Ziegenbock, Rehbock)
//   • "alt"      → generisches Adjektiv (alt/jung)
//
// Eindeutige Bierstile, die SEHR WOHL bidirektional zu "bier" gehören:
//   • pils, pilsener, pilsner
//   • kölsch
//   • altbier        (zusammengesetzt → eindeutig)
//   • bockbier       (zusammengesetzt → eindeutig)
//   • weizenbier     (zusammengesetzt → eindeutig)
//   • weißbier, weissbier
//   • hefeweizen     (zusammengesetzt → eindeutig)
//   • lagerbier      (zusammengesetzt → eindeutig)
//
// Konsequenz für die User-Erfahrung:
//   • "Bier"        → findet alle Produkte mit "Bier", "Pils", "Kölsch",
//                     "Altbier", "Bockbier", "Weizenbier", "Weißbier",
//                     "Hefeweizen", "Lagerbier" im Namen/in den Tags.
//                     KEIN "Helles Brot" mehr, KEIN "Weizenbrot" mehr.
//   • "Weizen"      → findet wörtlich "Weizen…" — also Weizenbier,
//                     Weizenmehl, Weizenbrot. Alles korrekt für
//                     den User der "Weizen" tippt (mehrdeutige
//                     Suche → mehrdeutige Treffer, ist OK).
//   • "Helles"      → findet wörtlich "Helles…" — Helles Bier,
//                     Helles Brot. Auch korrekt: User der nur
//                     "Helles" tippt meint vielleicht beides.
//   • "Pils"        → findet alle Bier-Produkte (auch ohne "Pils"
//                     im Namen, dank bidirektionalem Synonym).

const { algoliasearch } = require('algoliasearch');

const APP_ID = 'Y0KKZHT49Q';
// Admin API key — vom User in der Conversation übergeben.
const ADMIN_KEY = '6513c383e437bb744db65c43898d9a64';

const INDICES = ['produkte', 'markenProdukte'];

// Die finalen Synonymgruppen (v3). Alle bidirektional.
// Reihenfolge spielt keine Rolle, Algolia matched n×n innerhalb der
// Gruppe.
const SYNONYM_GROUPS = [
  // Bier — nur eindeutige Stile.
  ['bier', 'pils', 'pilsener', 'pilsner', 'kölsch', 'altbier', 'bockbier', 'weizenbier', 'weißbier', 'weissbier', 'hefeweizen', 'lagerbier'],
  // Joghurt-Familie — Skyr ist ein isländisches Sauermilchprodukt,
  // funktional ein Joghurt-Substitut.
  ['joghurt', 'jogurt', 'yoghurt', 'skyr'],
  // Pasta-Familie — wörtliche Übersetzung.
  ['pasta', 'nudeln', 'teigwaren'],
  // Käse-Familie (gleiche Sorte, verschiedene Schreibweisen).
  ['frischkäse', 'streichkäse'],
  ['hartkäse', 'reibkäse', 'parmesan'],
  ['quark', 'topfen'],
  // Wurst-Familie.
  ['wurst', 'wurstwaren', 'aufschnitt'],
  ['salami', 'hartwurst'],
  // Süßwaren.
  ['schokolade', 'schoko'],
  ['bonbons', 'süßigkeiten', 'candy'],
  // Backwaren — eng eingegrenzt damit "Brot" nicht alles matched.
  ['baguette', 'stangenbrot'],
  ['brötchen', 'semmel', 'schrippe', 'weckle', 'rundstück'],
  // Getränke — Säfte und Limos.
  ['limonade', 'limo', 'softdrink'],
];

async function main() {
  const client = algoliasearch(APP_ID, ADMIN_KEY);

  for (const indexName of INDICES) {
    console.log(`\n→ Index "${indexName}":`);

    // 1. Bestehende Synonyme listen (zur Sichtkontrolle in den Logs).
    try {
      const list = await client.searchSynonyms({
        indexName,
        searchSynonymsParams: { query: '', hitsPerPage: 200 },
      });
      console.log(`  Vorher: ${list.nbHits} Synonym-Einträge`);
    } catch (e) {
      console.warn(`  Konnte Synonyme nicht listen:`, e.message);
    }

    // 2. ALLE Synonyme atomar ersetzen.
    //    `replaceAllSynonyms` ist ein Alias für ein Save-mit-clear:
    //    es atomar löscht alles und schreibt unsere Liste neu —
    //    keine Lücke, kein Fenster wo der Index ohne Synonyme
    //    läuft. forwardToReplicas:true sorgt dafür, dass Replikate
    //    (sortiert-by-preis etc.) ebenfalls aktualisiert werden.
    const synonyms = SYNONYM_GROUPS.map((tokens, i) => ({
      objectID: `bier-family-v3-${i}`,
      type: 'synonym',
      synonyms: tokens,
    }));

    const result = await client.saveSynonyms({
      indexName,
      synonymHit: synonyms,
      replaceExistingSynonyms: true,
      forwardToReplicas: true,
    });
    console.log(`  ✅ ${synonyms.length} Synonymgruppen gepusht (taskID ${result.taskID})`);

    // 3. Auf Indexierung warten — sonst zeigt eine Suche unmittelbar
    //    danach noch alte Treffer.
    await client.waitForTask({ indexName, taskID: result.taskID });
    console.log(`  ✅ Indexierung fertig`);
  }

  console.log('\n✨ Synonym-Fix v3 erfolgreich angewendet.');
}

main().catch((e) => {
  console.error('❌ Fehler:', e);
  process.exit(1);
});
