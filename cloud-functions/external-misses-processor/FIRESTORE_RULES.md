# Firestore Rules — `external_lookup_misses`

Diese Rules MUSST du in der Firebase Console
(Firestore → Rules) ergänzen, sonst kann der Client das Doc nicht
schreiben und die Misses werden silently verworfen.

## Rules-Snippet

```js
// external_lookup_misses — Client darf upsert'en (create/merge), aber
// NICHT processor-only-Felder schreiben (status nach 'processing' etc.).
match /external_lookup_misses/{ean} {
  // Lese-Zugriff: nur Admin im Backend brauchen. Mobile-App liest
  // nicht (Misses sind ein internes Backlog). Daher restriktiv —
  // schützt vor Reverse-Engineering ("welche EANs hat der Service
  // schon scannen müssen?"). Wenn du irgendwann eine Admin-UI
  // mobil bauen willst → auf `request.auth != null` erweitern.
  allow read: if false;

  // Schreib-Zugriff: jeder authentifizierte User (anonymous OK) darf
  // ein Miss-Doc upserten. Wir limitieren auf die Felder die der
  // Client schreibt — alles andere (status-Wechsel, processedAt, etc.)
  // ist Cloud-Function-only.
  allow create: if request.auth != null
    && request.resource.data.keys().hasOnly([
      'ean', 'status', 'firstSeenAt', 'lastSeenAt',
      'hitCount', 'triedSources', 'bestSource'
    ])
    && request.resource.data.ean is string
    && request.resource.data.status == 'pending';

  // Update vom Client: darf nur lastSeenAt, hitCount, triedSources,
  // bestSource erhöhen / aktualisieren. Status-Übergänge sind
  // Processor-only (CF mit Admin-SDK umgeht Rules eh).
  allow update: if request.auth != null
    && request.resource.data.diff(resource.data).affectedKeys().hasOnly([
      'lastSeenAt', 'hitCount', 'triedSources', 'bestSource'
    ]);

  // Delete: nur Admin (= CF) — die Console-Rules erlauben hier
  // standardmäßig nichts, daher kein Eintrag nötig. Wenn du explizit
  // verbieten willst:
  allow delete: if false;
}
```

## Validation Test

Nach dem Deploy der Rules:

```
# Schreib-Test als anonymer User (sollte funktionieren)
# → manuell im Sim ein nicht-existierender EAN scannen
# → Firestore-Console: external_lookup_misses sollte ein Doc haben

# Lese-Test (sollte fehlschlagen)
# → in der App KEIN Lesezugriff auf misses-Collection nötig,
#   wenn doch noch wo ein get/query auftaucht: Permission-Denied
#   Error im Log → bedeutet Rules greifen wie gewünscht.
```

## Was passiert wenn Rules nicht deployed sind?

- Client-`recordMiss` failt mit `permission-denied`
- `try/catch` fängt das ab, loggt nur `non-blocking warn`
- User-Flow bleibt heile, Detail-Page rendert OpenFood-Daten
- ABER: Backlog wächst nicht, Processor (T4) hat nichts zu tun.

Das ist okay als Übergangszustand. Die App ist nicht kaputt, der Service
sammelt nur keine Misses bis die Rules da sind.
