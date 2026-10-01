/**
 * aggregateRatingsByPath — Bewertungsschnitte auf dem Produkt-Dokument.
 *
 * Herkunft: bis 01.10.2026 lief diese Funktion nur in der Cloud Console
 * (1st gen, europe-west3, nodejs20, Version 15 vom 11.09.2025, Quelle
 * gs://gcf-sources-139509881339-europe-west3/aggregateRatingsByPath-…/version-15).
 * nodejs20 endet am 30.10.2026. Die Logik unten ist WÖRTLICH aus Version 15
 * übernommen; geändert sind nur:
 *   • Import `firebase-functions/v1` (ab SDK v6 liefert der Wurzel-Import die
 *     2nd-gen-API — ohne `/v1` wäre das ein anderer Funktionstyp),
 *   • Region + Ressourcen ausdrücklich gesetzt (vorher Console-Werte),
 *   • Projekt-ID aus der Laufzeitumgebung statt fest eingetragen (in
 *     Produktion derselbe Wert; im Emulator ein demo-Projekt, damit ein
 *     Testlauf nie die Produktion erreichen kann),
 *   • FieldValue über `firebase-admin/firestore` statt
 *     `admin.firestore.FieldValue` (identisches Objekt, siehe unten).
 * Wer das Verhalten ändern will: erst die Tests unter test/ anpassen, die
 * gegen das Verhalten von Version 15 prüfen.
 *
 * Was sie tut: Bei jedem Anlegen/Ändern/Löschen in productRatings/{id}
 * rechnet sie die Differenz (alt → neu) je Kriterium in die Zähler
 * ratingCount<K>/ratingSum<K>/averageRating<K> des Produkts ein, plus
 * ratingCount (= ratingCountOverall). Ziel ist produkte/<id> über
 * `productID`, sonst markenProdukte/<id> über `brandProductID`.
 * Doppelzustellungen fängt processedRatingEvents/{eventId} ab.
 *
 * Bewusst KEINE Wiederholung bei Fehlern (wie live: RETRY_POLICY_DO_NOT_RETRY).
 * Kein `failurePolicy` setzen, ohne das abzuwägen: ein Retry nach einem
 * Fehler NACH dem Commit ist durch den Marker abgesichert, ändert aber das
 * Betriebsverhalten.
 *
 * Deploy: eigene Codebase `bewertungen`, solo deployen
 * (firebase deploy --only functions:bewertungen).
 */
const functions = require("firebase-functions/v1");
const admin = require("firebase-admin");
// Modularer Import statt admin.firestore.FieldValue: dasselbe Objekt, aber der
// Functions-Emulator bindet admin.firestore() und verliert dabei die statischen
// Felder (FieldValue wäre dort undefined, auch mit dem SDK von Version 15).
const { FieldValue } = require("firebase-admin/firestore");

// Initialisiere Firebase Admin SDK nur einmal
if (!admin.apps.length) {
  admin.initializeApp({
    // Ausdrücklich gesetzt statt aus FIREBASE_CONFIG gelesen: die
    // Console-Version trug dort einen kaputten Wert. In Produktion setzt
    // die Laufzeit GCLOUD_PROJECT=markendetektive-895f7.
    projectId: process.env.GCLOUD_PROJECT || 'markendetektive-895f7'
  });
}
const db = admin.firestore();

const REGION = 'europe-west3';

// --- Basisnamen der Bewertungskriterien ---
const RATING_CRITERIA = [
    'Overall',
    'PriceValue',
    'TasteFunction',
    'Similarity',
    'Content'
];
// Name der Collection zum Verfolgen verarbeiteter Events
const PROCESSED_EVENTS_COLLECTION = 'processedRatingEvents';

exports.aggregateRatingsByPath = functions
  .region(REGION)
  // Werte der Console-Version 15: 256 MB, 60 s, bis 3000 Instanzen.
  .runWith({ memory: '256MB', timeoutSeconds: 60, maxInstances: 3000 })
  .firestore
  .document("productRatings/{ratingId}") // Trigger auf deine Rating Collection
  .onWrite(async (change, context) => {
    const ratingId = context.params.ratingId;
    const eventId = context.eventId; // Eindeutige ID für dieses spezifische Ereignis

    const processedEventRef = db.collection(PROCESSED_EVENTS_COLLECTION).doc(eventId);

    const ratingDataBefore = change.before.data();
    const ratingDataAfter = change.after.data();
    const existsBefore = change.before.exists;
    const existsAfter = change.after.exists;

    console.log(`--- Start Processing RatingId: ${ratingId}, EventId: ${eventId} ---`);
    console.log(`Event Details: existsBefore=${existsBefore}, existsAfter=${existsAfter}`);

    // --- Ziel-Produkt bestimmen ---
    let productRef = null;
    let collectionName = '';
    let documentId = '';
    const relevantData = ratingDataAfter ?? ratingDataBefore;
    
    if (!relevantData) {
        console.log("No relevant data found for RatingId:", ratingId, "EventId:", eventId);
        // Schreibe trotzdem Marker, falls Event ungültig ist, um Retries zu stoppen
        try { 
            await processedEventRef.set({ 
                processedAt: FieldValue.serverTimestamp(), 
                status: 'NoData' 
            }); 
        } catch(e) {
            console.error("Error setting processed marker:", e);
        }
        return null;
    }

    // 🔧 FIX: Korrekte Produkt-Referenz basierend auf Rating-Typ
    if (relevantData.productID && relevantData.productID.path) {
        // NoName Produkt (produkte Collection)
        const pathParts = relevantData.productID.path.split('/');
        if (pathParts.length >= 2 && pathParts[0] === 'produkte') {
            collectionName = pathParts[0]; 
            documentId = pathParts[1];
            productRef = db.collection(collectionName).doc(documentId);
            console.log(`✅ NoName Product detected: ${productRef.path}`);
        } else { 
            console.error(`Invalid productID path for NoName. RatingId: ${ratingId}, Path: ${relevantData.productID.path}`); 
            return null; 
        }
    } else if (relevantData.brandProductID && relevantData.brandProductID.path) {
        // Markenprodukt (markenProdukte Collection)
        const pathParts = relevantData.brandProductID.path.split('/');
        if (pathParts.length >= 2 && pathParts[0] === 'markenProdukte') {
            collectionName = pathParts[0]; 
            documentId = pathParts[1];
            productRef = db.collection(collectionName).doc(documentId);
            console.log(`✅ Brand Product detected: ${productRef.path}`);
        } else { 
            console.error(`Invalid brandProductID path for Brand Product. RatingId: ${ratingId}, Path: ${relevantData.brandProductID.path}`); 
            return null; 
        }
    }
    
    if (!productRef) {
        console.error(`❌ Error: Could not find valid product reference. RatingId: ${ratingId}, EventId: ${eventId}`);
        console.error(`Available fields:`, Object.keys(relevantData));
        return null;
    }

    const productPath = productRef.path;
    console.log(`🎯 Target product: ${productPath} (Collection: ${collectionName})`);

    // --- Inkrementelle Aggregation in Transaktion (mit Idempotenz-Check) ---
    try {
      await db.runTransaction(async (transaction) => {
        // 1. Prüfen, ob dieses Event schon verarbeitet wurde
        const processedDoc = await transaction.get(processedEventRef);
        if (processedDoc.exists) {
          console.log(`⏭️  Event ${eventId} already processed. Skipping.`);
          return; // WICHTIG: Verhindert erneute Ausführung
        }

        // 2. Produkt-Daten lesen
        const productDoc = await transaction.get(productRef);
        const productData = productDoc.exists ? productDoc.data() : {};

        // 3. Änderungen pro Feld berechnen und Updates vorbereiten
        const updates = {};
        console.log(`📊 Calculating incremental updates for ${collectionName}/${documentId}`);

        for (const criterion of RATING_CRITERIA) {
            const ratingField = `rating${criterion}`;
            const countField = `ratingCount${criterion}`;
            const sumField = `ratingSum${criterion}`;
            const avgField = `averageRating${criterion}`;

            // Lese alte Werte aus dem Produkt-Dokument (oder 0)
            const oldCount = productData?.[countField] ?? 0;
            const oldSum = productData?.[sumField] ?? 0;

            // Lese Rating-Werte vor/nach Änderung aus Event-Daten
            const ratingBeforeVal = (existsBefore && typeof ratingDataBefore?.[ratingField] === 'number' && ratingDataBefore[ratingField] >= 1 && ratingDataBefore[ratingField] <= 5)
                                     ? ratingDataBefore[ratingField] : 0;
            const ratingAfterVal = (existsAfter && typeof ratingDataAfter?.[ratingField] === 'number' && ratingDataAfter[ratingField] >= 1 && ratingDataAfter[ratingField] <= 5)
                                    ? ratingDataAfter[ratingField] : 0;

            // Berechne Änderungen basierend auf Gültigkeit (1-5)
            let countChange = 0;
            let sumChange = 0;
            const validBefore = ratingBeforeVal > 0;
            const validAfter = ratingAfterVal > 0;

            if (validAfter && !validBefore) { // Neu gültig geworden
                countChange = 1;
                sumChange = ratingAfterVal;
            } else if (!validAfter && validBefore) { // Ungültig geworden / Gelöscht
                 countChange = -1;
                 sumChange = -ratingBeforeVal;
            } else if (validAfter && validBefore) { // Gültiges Update
                 countChange = 0;
                 sumChange = ratingAfterVal - ratingBeforeVal;
            } // else: war und blieb ungültig -> keine Änderung

            // Nur Updates durchführen, wenn sich Zähler oder Summe tatsächlich ändern
            if (countChange !== 0 || sumChange !== 0) {
                const newCount = oldCount + countChange;
                const newSum = oldSum + sumChange;
                let newAverage = 0;
                if (newCount > 0) {
                    newAverage = Math.round((newSum / newCount) * 10) / 10;
                }

                updates[countField] = newCount;
                updates[sumField] = newSum;
                updates[avgField] = newAverage;

                console.log(`  📈 ${criterion}: Count ${oldCount}→${newCount}, Sum ${oldSum}→${newSum}, Avg ${newAverage}`);
            } else {
                 console.log(`  ➡️  ${criterion}: No change detected.`);
                 // Stelle sicher, dass vorhandene Felder nicht versehentlich gelöscht werden
                 if (productData?.hasOwnProperty(countField)) updates[countField] = oldCount;
                 if (productData?.hasOwnProperty(sumField)) updates[sumField] = oldSum;
                 if (productData?.hasOwnProperty(avgField)) updates[avgField] = productData[avgField];
            }
        }

        // 4. Gesamtzähler 'ratingCount' (optional)
         const finalOverallCount = updates.hasOwnProperty('ratingCountOverall')
             ? updates['ratingCountOverall']
             : (productData?.['ratingCountOverall'] ?? 0);
         // Füge ratingCount nur hinzu, wenn es sich ändert oder noch nicht existiert
         if (!productData?.hasOwnProperty('ratingCount') || productData['ratingCount'] !== finalOverallCount) {
             updates['ratingCount'] = finalOverallCount;
             console.log(`📊 Setting overall ratingCount to: ${finalOverallCount}`);
         }

        // 5. Nur schreiben, wenn es Updates gibt
        if (Object.keys(updates).length > 0) {
             // Prüfe ob überhaupt Felder geändert wurden (abgesehen vom optionalen ratingCount)
             const hasMeaningfulUpdate = Object.keys(updates).some(key => key !== 'ratingCount');

             if (hasMeaningfulUpdate) {
                 console.log(`💾 Final update for ${productPath}:`, JSON.stringify(updates));
                 if (productDoc.exists) {
                     transaction.update(productRef, updates);
                 } else {
                     console.warn(`⚠️  Product ${productPath} did not exist. Creating with aggregates.`);
                     transaction.set(productRef, updates); // Erstellen falls nicht existent
                 }
             } else {
                  console.log(`ℹ️  No meaningful updates to commit for ${productPath}.`);
             }
        } else {
             console.log(`ℹ️  No updates needed for ${productPath}.`);
        }

        // 6. Setze den Marker, dass dieses Event verarbeitet wurde (IMMER, wenn kein Fehler auftrat)
        transaction.set(processedEventRef, { 
            processedAt: FieldValue.serverTimestamp(), 
            ratingId: ratingId, 
            productPath: productPath,
            collectionName: collectionName,
            status: 'Success' 
        });

      });
      console.log(`✅ Transaction successfully committed for EventId: ${eventId}, Product: ${productPath}`);
    } catch (error) {
        console.error(`❌ Transaction failed for EventId: ${eventId}, Product: ${productPath}, Error:`, error);
        // WICHTIG: Marker NICHT setzen bei Fehler!
        throw error; // Fehler weiterwerfen für Retries
    }
});
