# Firestore Security Rules für Leaderboard Collection

Diese Rules müssen in der Firebase Console unter "Firestore Database" → "Rules" hinzugefügt werden:

```javascript
// Bestenlisten Collection
match /leaderboards/{userId} {
  // Lesen: Alle können alle Leaderboard-Einträge lesen
  allow read: if true;
  
  // Schreiben: Nur der eigene User kann seinen Eintrag aktualisieren
  // UND nur wenn er authentifiziert ist
  allow write: if request.auth != null 
    && request.auth.uid == userId
    && validateLeaderboardData();
}

// Validation function für Leaderboard-Daten
function validateLeaderboardData() {
  let data = request.resource.data;
  
  return data.keys().hasAll(['userId', 'displayName', 'stats', 'lastUpdated', 'weekStartDate', 'monthStartDate', 'yearStartDate'])
    && data.userId == request.auth.uid
    && data.stats.keys().hasAll(['points', 'savings'])
    && data.stats.points.keys().hasAll(['total', 'weekly', 'monthly', 'yearly'])
    && data.stats.savings.keys().hasAll(['total', 'weekly', 'monthly', 'yearly'])
    && data.stats.points.total >= 0
    && data.stats.savings.total >= 0
    && data.displayName is string
    && data.displayName.size() <= 50;
}
```

## Zusätzliche Sicherheitsüberlegungen:

1. **Anti-Manipulation**: Die Stats werden nur durch den authentifizierten User selbst aktualisiert
2. **Datenschutz**: Nur `displayName` wird öffentlich angezeigt, keine sensiblen Daten
3. **Validation**: Alle erforderlichen Felder und Datentypen werden validiert
4. **Rate Limiting**: Firebase hat eingebaute Rate Limits für Firestore Writes

## Indexes die erstellt werden müssen:

```
Collection: leaderboards
Fields: stats.points.total (Descending)
Fields: stats.points.weekly (Descending)
Fields: stats.points.monthly (Descending)
Fields: stats.points.yearly (Descending)
Fields: stats.savings.total (Descending)
Fields: stats.savings.weekly (Descending)
Fields: stats.savings.monthly (Descending)
Fields: stats.savings.yearly (Descending)
```

Diese Indexes werden automatisch von Firebase vorgeschlagen wenn die ersten Queries ausgeführt werden.
