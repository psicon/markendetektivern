# Umfragen — Datenbank-Anleitung (ClickUp 86ca8fbpz)

> Bis die RevealyIQ-Anlage-UI deployt ist, werden Umfragen **direkt in
> Firestore** angelegt. Diese Datei ist die Referenz für das exakte
> Dokument-Schema.

## Wo

- **`polls/{autoId}`** — die Umfrage selbst (Fragen, Zielgruppe, Auslöser, Reward).
  Projekt `markendetektive-895f7`. Doc-ID = Firestore-Auto-ID.
- **`poll_responses/{autoId}`** — schreibt die App automatisch (NICHT von Hand anlegen).
- Cashback-Reward: vergibt die Cloud Function `survey-reward` automatisch beim
  Antwort-Schreiben (idempotent, Budget-/Per-User-Limit serverseitig durchgesetzt).

Umfragen sind **eigenständig** — KEINE Verknüpfung zu `cashback_campaigns`.

## `polls`-Dokument — alle Felder

```jsonc
{
  // ── Pflicht ──
  "title": "Wie kaufst du ein?",
  "status": "active",                 // 'draft'|'active'|'paused'|'completed'|'archived' — nur 'active' wird ausgespielt
  "questions": [
    {
      "id": "q_1781351903721",        // eindeutig pro Frage. Konvention: q_<timestamp-ms>
      "questionText": "Wie oft vergleichst du Preise?",
      "questionType": "single_choice", // 'single_choice' | 'multiple_choice' | 'text'
      "order": 0,
      "required": true,
      "options": ["Immer", "Manchmal", "Selten"] // entfällt bei 'text'
    }
  ],
  "targeting": {},                    // siehe unten (leer = alle User)

  // ── Auslöser ──
  "trigger": { "type": "general" },   // ODER { "type": "action", "action": "...", "cooldownHours": 6 }

  // ── Belohnung ──
  "rewardTrigger": "completion",      // 'completion' | 'per_answer' | 'none'
  "rewardCents": 10,                  // Betrag in Cent (entfällt bei 'none')
  "budgetCents": 50000,               // optional: Gesamt-Budget (Cent). Leer = unbegrenzt
  "budgetRemainingCents": 50000,      // optional: = budgetCents beim Anlegen (CF zählt runter)
  "maxPerUser": 3,                    // optional: max. vergütete Antworten PRO USER

  // ── Action-Targeting (nur bei trigger.type==='action') ──
  "actionDisplay": "immediate",       // 'immediate' (Sheet sofort) | 'hint' (antippbarer Hinweis-Toast)
  "targetProductIds": ["<docId>"],    // optional: nur bei diesen Produkten (produkte/markenProdukte Doc-IDs)
  "targetBrandIds": ["<herstellerId>"], // optional: nur bei diesen Marken/Herstellern

  // ── Zeitfenster (optional, ISO-Strings) ──
  "startDate": null,
  "endDate": null,

  // ── Metadaten ──
  "createdBy": "admin@markendetektive.de",
  "createdAt": <serverTimestamp>,     // Firestore-Timestamp (NICHT ISO-String!)
  "updatedAt": <serverTimestamp>,
  "totalViews": 0, "totalResponses": 0, "responseRate": 0
}
```

## `trigger` — wann erscheint die Umfrage?

- **`{ "type": "general" }`** → erscheint in der **Umfragen-Übersicht** (Belohnungen-Tab → Tile „Umfragen"). Der User geht sie aktiv durch (Pull).
- **`{ "type": "action", "action": "<X>", "cooldownHours": 6 }`** → erscheint als **Popup nach einer Aktion** (Push).
  - `action`: `save_product` (favorisiert) · `view_comparison` (Produkt aufgerufen) · `submit_rating` (bewertet) · `add_to_cart` (in Einkaufszettel gelegt) · `complete_shopping` (Einkauf abgeschlossen) · `scan_product` · `convert_product`
  - `cooldownHours`: frühestens nach N Stunden erneut zeigen (Default 6). `0` = bei jeder Aktion (nur zum Testen, sonst Spam!).

## `rewardTrigger` — wie wird vergütet?

| Wert | Verhalten | Wofür |
|---|---|---|
| `completion` | EINMALIGE Pauschale bei Abschluss, danach nie wieder | allgemeine Umfragen |
| `per_answer` | bei JEDER Beantwortung (bis maxPerUser/Budget) | wiederholte action-Umfragen |
| `none` | keine Vergütung (reine Datensammlung) | Insights ohne Cashback |

**„Kann ein User eine Umfrage 100× ausfüllen?"** → Nur wenn du es zulässt. `maxPerUser`
deckelt vergütete Antworten pro User; `budgetCents` deckelt die Gesamt-Auszahlung.
Beides erreicht → Umfrage verschwindet.

## Produktspezifische Action-Umfragen

Ohne `targetProductIds`/`targetBrandIds` feuert eine Action-Umfrage bei **jedem**
Produkt. Zum Eingrenzen:

```jsonc
"trigger": { "type": "action", "action": "save_product" },
"targetProductIds": ["0247JdXahwTZ3oRm8ck7"]   // nur dieses Produkt (Salzstangen)
// oder:
"targetBrandIds": ["Tj6g82LYEQn7dkaCuZXD"]     // nur diese Marke
```

- `targetProductIds`: Doc-IDs aus `produkte` ODER `markenProdukte`.
- `targetBrandIds`: die `hersteller`-Ref-ID des Produkts —
  `markenProdukte.hersteller` → `hersteller`-Collection (= Marke),
  `produkte.hersteller` → `hersteller_new`-Collection (= Hersteller).
- Beide Listen leer/fehlen → alle Produkte.

## targeting (Zielgruppe, für general + action)

```jsonc
"targeting": {
  "gender": ["male", "female", "diverse"],   // RevealyIQ-Codes (App mappt: Männlich/Weiblich/Anderes)
  "minAge": 25, "maxAge": 45,
  "regions": ["Bayern", "Berlin"],            // Bundesland-Namen; "Bundesweit" = alle
  "favoriteMarkets": ["aldi", "lidl"],        // users.favoriteMarket (Discounter)
  "isPremium": true
}
```
Plus optional Profil-Targeting (App-Erweiterung):
```jsonc
"profileTargeting": [{ "dimension": "health", "min": 0.6, "minConfidence": 0.7 }]
```
Regel: fehlt ein demografischer Wert beim User UND das Kriterium ist gesetzt → User wird ausgeschlossen.

## Beispiel: produktspezifische „Pro Antwort"-Umfrage anlegen (Admin-Skript)

```js
// in cloud-functions/survey-reward/ ausführen (hat firebase-admin):
//   GOOGLE_CLOUD_PROJECT=markendetektive-895f7 node anlegen.js
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'markendetektive-895f7' });
const db = admin.firestore();
db.collection('polls').add({
  title: 'Produkt-Feedback',
  status: 'active',
  trigger: { type: 'action', action: 'view_comparison' },
  targetProductIds: ['0247JdXahwTZ3oRm8ck7'],
  rewardTrigger: 'per_answer', rewardCents: 5, maxPerUser: 5,
  actionDisplay: 'immediate',
  targeting: {},
  questions: [{
    id: `q_${Date.now()}`, questionText: 'Würdest du es weiterempfehlen?',
    questionType: 'single_choice', order: 0, required: true,
    options: ['Ja', 'Vielleicht', 'Nein'],
  }],
  createdBy: 'admin@markendetektive.de',
  createdAt: admin.firestore.FieldValue.serverTimestamp(),
  updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  totalViews: 0, totalResponses: 0, responseRate: 0,
}).then((r) => { console.log('angelegt:', r.id); process.exit(0); });
```

## Testen

- **Status zurücksetzen** (beantwortete Umfragen wieder sehen): App → Profil →
  Dev-Tools → „Komplett-Reset (lokal)" (wischt den lokalen answered-/Cooldown-State).
- Action-Umfragen: nach Antwort/Wegklick erst nach `cooldownHours` (Default 6 h) wieder.
