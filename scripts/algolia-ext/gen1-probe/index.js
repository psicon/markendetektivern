// Wegwerf-Sonde: prueft nur, ob Cloud Functions (1st gen) in diesem Projekt einen
// Firestore-Trigger gegen die eur3-Datenbank registrieren kann. Tut nichts.
exports.probe = (event, context) => {
  console.log('gen1-eur3-probe', context.eventType, context.resource);
};
