/**
 * Nutrition-History-Watcher (ClickUp 86c9uq418)
 *
 * Firestore onWrite-Trigger auf `produkte/*` und `markenProdukte/*`.
 * Schreibt drei History-Collections:
 *   • nutritionhistory_produkte
 *   • nutritionhistory_markenProdukte
 *   • pricehistory_produkte
 *   • pricehistory_markenProdukte
 *
 * Regeln:
 *
 * Nutrition (Zutaten + Nährwerte) — getrennt per Feldgruppe:
 *   • Bei Änderung von `attr_ingredientStatement` ODER irgendeinem
 *     `nutr_*` Feld → Snapshot ALT in nutritionhistory_<col>.
 *   • Aber: wenn die NEUE Source `manual` ODER `rewe` ist → SKIP
 *     History (trusted-source-Update braucht keine Audit-Trail).
 *
 * Price (preis):
 *   • Bei jeder Änderung von `preis` → Snapshot in pricehistory_<col>.
 *   • KEINE Source-Exclusion — Preise kommen quasi nur von Rewe und
 *     wir wollen die komplette Zeitreihe.
 *
 * Die Function ist idempotent: doppelte Triggers für denselben
 * Change-Event sind selten (Firestore deduped meist), aber ein
 * doppelter History-Eintrag wäre OK.
 *
 * Deployment-Codebase: nutrition-history-watcher
 */

const admin = require('firebase-admin');
const functions = require('firebase-functions');

if (!admin.apps.length) admin.initializeApp();
const db = admin.firestore();

const REGION = 'europe-west1';

// Quellen die "trusted" sind und keine History triggern (für Nutrition).
// Trusted-Sources triggern KEINE History (Audit-Trail nicht nötig):
//   - manual: eigene Recherche
//   - rewe:   reweapify-Pipeline
//   - ocr:    Bilder-Erkennung von Produkt-Etiketten
const TRUSTED_SOURCES = new Set(['manual', 'rewe', 'ocr']);

// nutr_*-Feldnamen die wir auf Änderung prüfen. Sollten dem
// reweapify-Schema entsprechen.
const NUTR_FIELDS = [
  'Energie',
  'Fett',
  'FettdavongesttigteFettsuren',
  'Kohlenhydrate',
  'KohlenhydratedavonZucker',
  'Ballaststoffe',
  'Eiwei',
  'Salz',
];

/** Strict-equal-Vergleich der für Firestore-Felder reicht (string,
 *  number, null/undefined als gleich). Für Strings: trim + lower
 *  damit Whitespace-Diffs nicht als Change zählen. */
function valuesDiffer(a, b) {
  // Beide null/undefined → gleich
  if (a == null && b == null) return false;
  // Eines null, anderes nicht → Change
  if (a == null || b == null) return true;
  // Strings: normalisierter Vergleich
  if (typeof a === 'string' && typeof b === 'string') {
    return a.trim() !== b.trim();
  }
  // Numbers: direkt
  return a !== b;
}

/** Sammelt alle nutr_*-Felder eines Docs als flaches Object. */
function extractNutrFields(data) {
  const out = {};
  for (const f of NUTR_FIELDS) {
    const valKey = `nutr_${f}_val`;
    const unitKey = `nutr_${f}_unit`;
    if (data[valKey] !== undefined) out[valKey] = data[valKey];
    if (data[unitKey] !== undefined) out[unitKey] = data[unitKey];
  }
  if (data.nutr_serving_size !== undefined) out.nutr_serving_size = data.nutr_serving_size;
  if (data.nutr_serving_unit !== undefined) out.nutr_serving_unit = data.nutr_serving_unit;
  return out;
}

/** Prüft ob sich IRGENDEIN nutr_*-Feld geändert hat. */
function nutritionChanged(before, after) {
  for (const f of NUTR_FIELDS) {
    if (valuesDiffer(before[`nutr_${f}_val`], after[`nutr_${f}_val`])) return true;
    if (valuesDiffer(before[`nutr_${f}_unit`], after[`nutr_${f}_unit`])) return true;
  }
  if (valuesDiffer(before.nutr_serving_size, after.nutr_serving_size)) return true;
  if (valuesDiffer(before.nutr_serving_unit, after.nutr_serving_unit)) return true;
  return false;
}

/** Kernlogik — entscheidet was zu loggen ist und schreibt's. */
async function handleChange(change, context, collectionName) {
  const before = change.before.exists ? change.before.data() : null;
  const after = change.after.exists ? change.after.data() : null;

  // Delete-Event → loggen wir nicht (Doc-Removal ist eh selten und
  // separates Audit-Konzept).
  if (!after) return;
  // Create-Event (before==null) → nur loggen wenn echte Daten neu
  // dazukommen UND Source nicht trusted ist. Sonst entsteht beim
  // initialen Backfill für JEDES Produkt ein History-Eintrag, was
  // sinnlos viel Volumen produziert.
  const isCreate = !before;
  const beforeData = before || {};

  // ─── 1) Nutrition-History ───────────────────────────────────
  const ingredientsChanged = valuesDiffer(
    beforeData.attr_ingredientStatement,
    after.attr_ingredientStatement,
  );
  const nutChanged = nutritionChanged(beforeData, after);

  if (ingredientsChanged || nutChanged) {
    const newIngSource = after.ingredientsSource;
    const newNutSource = after.nutritionSource;

    // Wenn Create-Event UND beide Source trusted (manual/rewe) →
    // skip (kein "Vor-Wert" der erhaltenswert wäre).
    // Wenn Update-Event → skip pro Feldgruppe wenn neue Source trusted.
    const skipIng =
      isCreate || TRUSTED_SOURCES.has(newIngSource);
    const skipNut =
      isCreate || TRUSTED_SOURCES.has(newNutSource);

    if ((ingredientsChanged && !skipIng) || (nutChanged && !skipNut)) {
      const historyDoc = {
        productId: change.after.id,
        productPath: change.after.ref.path,
        productName: after.name ?? beforeData.name ?? null,
        changedAt: admin.firestore.FieldValue.serverTimestamp(),
        changedFields: [
          ingredientsChanged && !skipIng ? 'ingredients' : null,
          nutChanged && !skipNut ? 'nutrition' : null,
        ].filter(Boolean),
        before: {
          attr_ingredientStatement: beforeData.attr_ingredientStatement ?? null,
          ingredientsSource: beforeData.ingredientsSource ?? null,
          ingredientsUpdatedAt: beforeData.ingredientsUpdatedAt ?? null,
          ...extractNutrFields(beforeData),
          nutritionSource: beforeData.nutritionSource ?? null,
          nutritionUpdatedAt: beforeData.nutritionUpdatedAt ?? null,
        },
        triggeredByNewSource: {
          ingredients: newIngSource ?? null,
          nutrition: newNutSource ?? null,
        },
      };
      const historyCol = `nutritionhistory_${collectionName}`;
      try {
        await db.collection(historyCol).add(historyDoc);
        console.log(
          `📚 [${collectionName}/${change.after.id}] nutrition history geschrieben (${historyDoc.changedFields.join('+')})`,
        );
      } catch (e) {
        console.error(`Fehler beim Nutrition-History-Write für ${change.after.ref.path}:`, e);
      }
    }
  }

  // ─── 2) Price-History ───────────────────────────────────────
  // Jede preis-Änderung loggen, keine Source-Exclusion (Preise sind
  // Zeitreihen-Daten — komplette Historie wertvoll).
  const priceChanged = valuesDiffer(beforeData.preis, after.preis);
  if (priceChanged && !isCreate) {
    const priceHistoryDoc = {
      productId: change.after.id,
      productPath: change.after.ref.path,
      productName: after.name ?? beforeData.name ?? null,
      changedAt: admin.firestore.FieldValue.serverTimestamp(),
      before: {
        preis: beforeData.preis ?? null,
        preisDatum: beforeData.preisDatum ?? null,
      },
      after: {
        preis: after.preis ?? null,
        preisDatum: after.preisDatum ?? null,
      },
      // Diff für schnelle Analytics
      deltaAbs:
        typeof after.preis === 'number' && typeof beforeData.preis === 'number'
          ? Number((after.preis - beforeData.preis).toFixed(4))
          : null,
      deltaPct:
        typeof after.preis === 'number' &&
        typeof beforeData.preis === 'number' &&
        beforeData.preis !== 0
          ? Number((((after.preis - beforeData.preis) / beforeData.preis) * 100).toFixed(2))
          : null,
    };
    const historyCol = `pricehistory_${collectionName}`;
    try {
      await db.collection(historyCol).add(priceHistoryDoc);
      console.log(
        `💶 [${collectionName}/${change.after.id}] price history geschrieben (${beforeData.preis} → ${after.preis})`,
      );
    } catch (e) {
      console.error(`Fehler beim Price-History-Write für ${change.after.ref.path}:`, e);
    }
  }
}

// ─── Firestore-Trigger ────────────────────────────────────────────
exports.onProdukteWrite = functions
  .region(REGION)
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .firestore.document('produkte/{productId}')
  .onWrite(async (change, context) => {
    await handleChange(change, context, 'produkte');
    return null;
  });

exports.onMarkenProdukteWrite = functions
  .region(REGION)
  .runWith({ memory: '256MB', timeoutSeconds: 60 })
  .firestore.document('markenProdukte/{productId}')
  .onWrite(async (change, context) => {
    await handleChange(change, context, 'markenProdukte');
    return null;
  });
