# Project notes for Claude Code

## KI-Unternehmenssystem: bestätigte Vorgaben und aktueller Einstieg

Für diese Arbeit zuerst `docs/AI_ORCHESTRATION_INTERVIEW.md` lesen.
Der tatsächliche technische Stand steht in `tools/company-os/README.md`,
Rollen und Abnahmen in `tools/company-os/ROLES.md`, der Wissensvertrag
in `tools/company-os/KNOWLEDGE.md`. Historische Testzahlen und frühere
Installationspläne nicht als aktuellen Zustand ausgeben.

Patrick hat den Bau und die zentrale Staging-Einrichtung autorisiert.
Dashboard, Steuerung, gemeinsames moderierbares Gedächtnis und austauschbare
selbst betriebene Modelle sollen bei Hetzner laufen. Der aktuelle zentrale
Zugang ist `https://team.revealy.de`, Server `144.76.202.144`.
Keine bezahlten Modell-APIs oder automatisch aktivierten Zusatzcredits.
Persönliche Codex-/Claude-Abos gehören jeweils ihrem Nutzer; keine
Kontingentbündelung oder Limitumgehung. Ein erreichbares Dashboard ist
kein Beleg für unbegrenzte KI-Verfügbarkeit.

Patrick ist Gründer, Entwickler und derzeit für Sales, Support,
Buchhaltung und Investor Relations verantwortlich. Julian ist Senior
Developer; Manon ist für Marketing zuständig. Timo ist perspektivisch
im Sales vorgesehen und hat noch keine operativen Rechte. Gehälter,
Personal, Finanzen, Buchhaltung, Investor Relations und wichtige
Kundeninformationen bleiben standardmäßig ausschließlich für Patrick
sichtbar, auch in Suche, Erinnerungen und Modellkontexten. Die erneute
Bewertung der EU-Verarbeitung ist keine pauschale Datenfreigabe.
Produktionsveröffentlichungen und externe Nachrichten benötigen die
entsprechende ausdrückliche Autorisierung.

13 interne Prüfperspektiven sind aufgabenbezogen konfigurierbar. Eine
KI-Perspektive ersetzt weder menschliche Zustimmung noch tatsächliche
Kunden- oder psychologische Abnahme. Patrick gibt zunächst konkrete
Aufgabenfassungen frei; Verantwortliche delegieren, danach folgen echte
Ergebnisse, unabhängige Prüfungen und die Endabnahme. Quellen-, Plan-
oder Ergebniswechsel entwerten frühere Freigaben.

Stand 09.09.2026: Zentrale Stagingversion auf Hetzner installiert,
ClickUp-Quellenprüfung und kontrollierter Statusabgleich implementiert.
Patricks Codex-/Claude-Logins wurden erkannt; Kostenbestätigungen und
ein echter persönlich freigegebener Produktlauf fehlen noch. ClickUp
war zuletzt zentral nicht verbunden. Hindsight ist lokal angeschlossen,
wartet aber auf freigegebene Quellen. BookStack ist optional und noch
nicht installiert; Paperclip bleibt deaktiviert. Mit „Claw“ meinte
Patrick Claude, nicht OpenClaw.

Seit 09.09.2026, 13:31:39 UTC sind Claude-/Codex-Rollenprüfungen über
die persönlichen Broker technisch angeschlossen: Anbieterwahl, separate
versionsgebundene Datenfreigabe, vollständige Originalbelege und Quellenzitate.
705 Linux-Tests bestanden, acht übersprungen. Persönliche Prüfprofile bleiben
ausgeschaltet; echte Abo-Qualifikation und Kostenbestätigungen fehlen.
Abo-Limits halten weitere Rollenprüfungen desselben persönlichen Anbieters
auch nach Neustart an. Nur bewusstes erneutes Beauftragen durch den Owner
gibt diese Warteschlange frei; kein automatischer Modell-/Kontowechsel.
Details: `tools/company-os/docs/native-review-workers.md`.

Seit 09.09.2026, 14:02:52 UTC ist der Text-/Markdown-Wissenseingang
mit Originaldatei, SHA-256, Meeting-Datum und Zeilenbereich bereitgestellt.
713 Linux-Tests bestanden, acht übersprungen. Import ist keine Modellfreigabe;
Teamfreigabe umfasst ausdrücklich auch die vollständige Originaldatei.
PDF/Word und automatische Meetings fehlen noch. Seit 14:24:32 UTC ist für große Bestände eine nachvollziehbare
Wortauswahl eingebaut: alle Pflichtregeln plus sämtliche erkannten passenden
Quellen, mit sichtbarer Auslassungsliste. 724 Linux-Tests bestanden, acht
übersprungen. Semantische Vollständigkeit ist nicht belegt. Das ausgewählte
Kontextpaket bleibt auf 8000 Bytes begrenzt; passt es nicht, hält der Auftrag an. Keine echte Unternehmensquelle wurde durch diesen Release importiert.
Details: `tools/company-os/docs/knowledge-import.md`.

Seit 09.09.2026, 14:53:45 UTC ist der automatische ClickUp-Eingang
bereitgestellt: ausschließlich für Patrick sichtbar nach zentralem OAuth, mit Suche, persistentem Pausenschalter und Wartezeit
nach Abruffehlern. Import ist standardmäßig ein privater Entwurf; eine
Teamaufgabe benötigt ausdrückliche Teilung der vollständigen Quelle und
die Wahl des Verantwortlichen. Keine automatische Freigabe, Zuweisung
in ClickUp, Modellbeauftragung oder Wissensaufnahme daraus ableiten.
743 Linux-Tests bestanden, acht übersprungen. Details und Grenzen:
`tools/company-os/docs/clickup-intake.md`.
Der ursprüngliche Fünf-Minuten-Takt ist überholt. Seit 15:12:47 UTC gilt
bei noch unbekanntem ClickUp-Tarif höchstens ein automatischer Versuch
alle drei Stunden: 60 reservierte MCP-Anfragen der Zentrale in rollierenden
24 Stunden, davon höchstens 30 automatisch. Andere Apps teilen das entfernte
Workspace-Kontingent; das tatsächliche Restkontingent ist unbekannt.
Neustart, Anmeldung oder Umschalten setzen den eigenen Zähler nicht zurück.
757 Linux-Tests bestanden, acht übersprungen; neun Betriebsprüfungen gesund.
Details: `tools/company-os/docs/clickup-budget.md`.
Die Tarif-/Everything-AI-Frage ist seit dieser Prüfung offen.

Die vollständige autonome Entwicklungsorganisation ist noch nicht
abgenommen. Qwen3:1.7b ist ein begrenzter Pilot. Der getrennte 8B-Versuch
bestätigte nach korrigiertem HTTP-Zeitlimit eine echte vollständige
Antwort, scheiterte aber an einem nicht wortgleichen Quellenzitat.
Keine Prüferfreigabe daraus ableiten; Details und Fortsetzung stehen
in `tools/company-os/docs/local-model-qualification-handoff-2026-09-09.md`.
Die experimentellen Änderungen sind nicht im Live-Dashboard registriert.

Betriebsstörungen eskalieren Patrick → Julian → Manon, ohne zusätzliche
vertrauliche Leserechte. E-Mail-Adressen und Fristen sind noch zu klären;
kein funktionierender automatischer Versand oder externes Backup behaupten.
Seit 09.09.2026, 12:51 UTC ist der unabhängige interne Betriebsmonitor
mit Minutenintervall und der Dashboard-Ansicht „Betrieb“ aktiv. Neun
Kernprüfungen sind bestätigt. Eine Vorfallübernahme ist weder Reparatur
noch Aufgabenfreigabe. Externe Hostüberwachung bleibt offen.
Ein weiterer Stopp darf einen bestehenden privaten Gründer-Stopp weder
herabstufen noch dessen Grund überschreiben, auch nicht bei
`haltForRecovery()`. Nur Patrick kann ihn aufheben; unbestätigte
Worker-Bereinigung blockiert auch seine Rückfreigabe.

## Meta-Regel: "merk dir das" → SOFORT in CLAUDE.md

Wenn der User sagt **"merk dir das"**, **"schreib dir das auf"**,
**"mark this down"**, **"speicher dir das"**, oder etwas
sinngemäßes ("du verlierst immer den Kontext", "behalt das"…),
dann ist das eine **direkte Anweisung an dieses File**.

Was tun:
1. Sofort an passender Stelle in `/Users/patricksieber/Documents/src/markendetektivern/CLAUDE.md`
   eine Notiz dazu hinzufügen (eigene Section oder unter
   passendem bestehenden Abschnitt).
2. Konkret + actionable formulieren — nicht "User mag X", sondern
   "tu Y, nicht Z, weil W".
3. Mit committen (`git add CLAUDE.md && git commit`) im selben
   Schwung wie die andere Arbeit, oder als eigener Commit.

**Nicht** auf den nächsten Turn verschieben, **nicht** im
Conversation-Memory parken. Conversation-Memory ist flüchtig,
CLAUDE.md ist persistent über Sessions hinweg.

Diese Regel gilt für jede zukünftige Erinnerungs-Aufforderung.
Wenn unklar ist, wo das hin soll, lieber unter ein neues Heading
am Ende von CLAUDE.md legen als gar nicht.

## Meta-Regel: Sichere Learnings aus Fehlern → SOFORT in CLAUDE.md

Komplement zur "merk dir das"-Regel: User-getriggert vs. selbst-
getriggert. Wenn aus einem Fehler eine **klare, übertragbare
Erkenntnis** entsteht (technische Limitierung verstanden, Pattern
hat reproduzierbar gefailt, Architektur-Entscheidung nach 2× in
dieselbe Falle laufen) → sofort als "Forbidden Pattern" oder
Design-Rule eintragen, im selben Commit wie der Fix. Format:
"tu Y, nicht Z, weil W". NICHT für Preferences ("User mag X
anders") oder Spekulation ("vielleicht wäre Y besser").

## Nutrition-Scraper: NIEMALS Name-Search, NUR EAN

Für die Cloud-Function `nutrition-scraper` (alle Endpoints +
Resolver + Serper-Queries) gilt: **Suche IMMER per GTIN (EAN),
NIEMALS per Produkt-Name**. User-Vorgabe 2026-05-17, mehrfach
bestätigt.

Begründung:
- Name-Search liefert Random-Treffer von ähnlich-genannten
  Produkten anderer Hersteller → Claude extrahiert falsche Daten
  → DB wird kontaminiert.
- EAN ist global-eindeutig → Treffer ist garantiert dasselbe
  Produkt (oder kein Treffer → safe skip).
- Audit hat gezeigt: bei EAN-Search liefert Google für die meisten
  unserer Produkte die echten Shop-Detail-Pages (myTime, Globus,
  etc.) → ist NICHT die Limitierung. Limitierung früherer Tests
  war: Stichprobe zu ALDI-Eigenmarken-lastig (4061464*, 4056489*,
  4337256* — werden NUR bei ALDI verkauft, daher wenig Shop-Coverage).

Was tun:
- Wenn ein Shop nicht über EAN findbar ist → Shop aus Liste raus,
  NICHT auf Name-Search ausweichen.
- Falls neue Source-Adapter (z.B. shop-spezifischer Crawler)
  hinzukommen: input-Parameter MUSS EAN sein, fail-fast wenn nicht
  vorhanden.

## EAN-Storage: `EANs[]` (Array) ist die Source of Truth

Auf `produkte/*` und `markenProdukte/*` ist **`EANs: string[]`** das
kanonische EAN-Feld. Reale Daten tragen NUR `EANs[]` — KEIN singuläres
`EAN: string`. Das TypeScript-Interface (`lib/types/firestore.ts`)
deklariert zwar ein Legacy-`EAN: string`, aber das ist NICHT die
Daten-Konvention. **Niemals dem Type/dem Graph blind trauen — gegen
echte Daten gegenchecken.** (Mai 2026: einmal `EAN: gtin` in Promotion-
Docs reingeschrieben weil der Type es hatte → wieder rausgenommen, weil
reale Docs es nicht nutzen.)

Was tun:
- **Schreiben** (Promotion, Backfill, neue Produkte): NUR `EANs: [gtin]`
  setzen. Kein singuläres `EAN`.
- **Lesen**: über `extractEans(product)` gehen — der merged defensiv
  `EAN, ean, gtin, GTIN` + `EANs[]` + `eans[]` + `moreInformation.EAN`,
  dedupt, filtert auf ≥8 Zeichen. So sind Altdaten mit Legacy-Singles
  abgedeckt OHNE dass neuer Code singuläre Felder schreiben muss.
- Alle Pipelines greifen bereits auf `EANs[]` zu: nutrition-scraper
  (openfood/serper-Suche), nutrition-backfill, receipt-matcher
  (`buildMeta` liest `EANs[0]`), App-Nährwerte. EAN-Suche (Scraper/
  openfood) iteriert ALLE Einträge aus `EANs[]`.
- **Drift-Warnung:** `extractEans` existiert 3× kopiert
  (`lib/utils/productNutrition.ts`, `cloud-functions/nutrition-backfill`,
  `cloud-functions/nutrition-scraper` inline). Wenn die Logik geändert
  werden muss → alle 3 nachziehen, oder zu einem geteilten Helper
  refactoren.

## Meta-Regel: ClickUp-Tasks immer kommentieren + 'In Review' setzen

Wenn ich an einem ClickUp-Task arbeite (egal ob Bug, Feature,
Bug-Fix, Refactor, etc.):

1. **Kommentar im Task pflicht** — direkt nach dem Commit/Push,
   im ClickUp-Task einen Comment hinterlassen mit:
   - was kurz war das Problem
   - was hab ich konkret geändert (Commit-Hash + Pfade)
   - Edge-Cases / Begründungen / wichtige Trade-offs
   Format: technisch + actionable, kein Marketing-Speech. Reader
   ist der User oder ein Future-Me.

2. **Status auf 'In Review' setzen** wenn ich überzeugt bin, dass
   der Task aus meiner Sicht erledigt ist. Status-Wert: `in review`
   (ClickUp-API normalisiert lowercase). NICHT auf 'done' / 'closed'
   selbst setzen — das ist User-Entscheidung nach manueller Prüfung.

3. **Wenn unsicher**: Comment hinterlassen + Status NICHT ändern.
   Der User entscheidet dann ob's reicht.

Tool: `mcp__…__clickup_create_task_comment` für 1, `clickup_update_task`
mit `status: 'in review'` für 2.

## Meta-Regel: Lange Antworten brauchen TLDR + Stichpunkte (User-Vorgabe 11.09.2026)

User-Wortlaut: „Ich möchte, dass du dir mal merkst, dass du, wenn du das tust,
zumindest ein TLDR hinzufügst und in Stichpunkten erklärst, inklusive
Empfehlungen, was zu tun ist und warum."

Das ist die dritte Ansage zum selben Punkt (vorher: „ich blicke bei dir nicht
durch, weil du immer alles in einer Rolle of Text zurückgibst"). Kurz fassen
allein reicht nicht — manche Antworten MÜSSEN lang sein (Bewertungen,
Architekturfragen, Geld-Läufe). Dann gilt:

1. **TLDR zuerst**, vor allem anderen. Zwei bis drei Zeilen, die die Frage
   beantworten und die Empfehlung nennen. Wer nur das liest, kann entscheiden.
2. **Danach Stichpunkte**, keine Absätze. Tabellen, wo es Zahlen sind.
3. **Empfehlung ausdrücklich als solche kennzeichnen** — was zu tun ist UND
   warum. Nicht die Begründung über den Text verteilen und den Leser selbst
   schließen lassen.
4. **Offene Entscheidungen ans Ende**, als klare Frage.

Gegenprobe vor dem Absenden: Wenn die Antwort über ~10 Zeilen geht und oben
kein TLDR steht, ist sie nicht fertig.

## Meta-Regel: KURZ und in normaler Sprache (User-Vorgabe 20.09.2026)

User-Wortlaut: „Ich habe nicht die Zeit, die ganze Scheiße immer zu lesen und
mit deiner geschwurbelten Argumentation und Verbalität hier umzugehen. Halt das
kurz." Das ist die VIERTE Ansage zum selben Punkt (vorher: Rolle of Text, TLDR-
Regel 11.09.). Die TLDR-Regel darunter bleibt gültig, reicht aber offensichtlich
nicht — sie hat lange Antworten nur besser sortiert statt kürzer gemacht.

Ab jetzt gilt beim Antworten:

1. **Standard sind 5–10 Zeilen.** Länger nur, wenn Patrick ausdrücklich Details
   will oder eine Zahl ohne Kontext falsch verstanden würde. Im Zweifel kurz und
   nachfragen, ob mehr gewünscht ist.
2. **Keine internen Namen ohne Erklärung.** „Namer", „Prüfkonsole",
   „Doppel-Regel", „Worktree", „fail-closed", „Präfix 02/2x" — das sind MEINE
   Wörter, nicht seine. Entweder in einem Halbsatz erklären („der Dienst, der
   aus den Fotos den Produktnamen liest") oder weglassen.
3. **Erst das Ergebnis, dann die Folge, dann — nur wenn nötig — der Weg.**
   Nicht die Beweisführung nacherzählen. Was ich geprüft habe, interessiert nur,
   wenn das Ergebnis strittig ist.
4. **Keine Tabellen für drei Zahlen.** Ein Satz reicht.
5. **Bei ClickUp-Tasks:** im Chat EIN Satz je Task, in normaler Sprache, was
   kaputt ist und was es ihn kostet. Die Details stehen im Task — dafür ist er da.
6. **Gegenprobe vor dem Absenden:** Würde jemand ohne diesen Sitzungs-Kontext
   die Antwort in 30 Sekunden verstehen? Wenn nein, kürzen.

Das gilt auch für Zwischenmeldungen während der Arbeit, nicht nur für den
Abschlussbericht.

## Meta-Regel: User-Wortlaut zweimal lesen, nicht "vereinfachen"

"Selbes Aussehen, aber X" = alles bleibt, ändere NUR X. Keine
eigene Interpretation ("naja, ohne Pille macht raised Button
keinen Sinn → wegnehmen") — das endet in Cancel-Loops. Bei
Unklarheit kurz fragen. Bei Vergleichen ("warum ist X auf Home
anders als Stöbern?") **nicht** raten welche Seite gewinnt — beide
Optionen anbieten oder fragen.

## Meta-Regel: Arbeitsweise — clever, gewissenhaft, kostenbewusst, selbstgeprüft (User-Vorgabe 05.09.2026)

User-Wortlaut: „immer best practices nutzen, sei clever und gewissenhaft,
kostenorientiert und immer nach der besten lösung bestrebt (ohne die kosten
überzustrapazieren). prüfe dich immer selbst und erschaffe rollen zur prüfung
die passen."

Was das konkret heißt — bei JEDER Aufgabe, nicht nur bei großen:
1. **Beste Lösung, nicht schnellste.** Erst Root-Cause und Alternativen
   abwägen, dann bauen. Workarounds nur mit Begründung + Follow-up-Task.
2. **Kostenbewusst.** Laufende Kosten (Gemini-Calls, Firestore-Reads,
   Storage, Builds, Token) sind Teil der Lösung: pro Vorschlag die
   Kostenwirkung nennen und die günstigste Variante wählen, die das Ziel
   VOLL erreicht. Nicht sparen, wo es Qualität kostet (siehe „Billig
   zuerst"-No-Go bei der OCR) — aber auch nichts verbrennen (z.B. Re-OCR
   von 4.700 Bons, wenn ein Feld schon im Cache steht).
3. **Selbstprüfung ist Pflicht, mit passenden Rollen.** Vor „fertig":
   Prüfrollen definieren, die zum Risiko der Änderung passen, und jede
   Rolle die Änderung angreifen lassen (Skeptiker/Refuter, Geld-Buchhalter
   bei Ledger-Änderungen, Datenschutz bei personenbezogenen Feldern,
   Alt-Client/Migration bei Schema-Änderungen, Ops/Rollback bei Deploys,
   Nutzer-Sicht bei Copy/UI). Bei Geld/Daten: zwei Runden gegen den
   AKTUELLEN Stand, Funde fixen, erneut prüfen. Umsetzung: Workflow mit
   Rollen-Agenten oder explizite Checkliste — aber nie „ich hab's gelesen,
   passt".
4. **Gewissenhaft berichten.** Was verifiziert ist, was nur plausibel ist,
   was offen bleibt — getrennt und ehrlich.

## Meta-Regel: Best Practices — IMMER, ohne Ausnahme

Wir entwickeln **immer nach Best Practices**. Das ist keine
optionale Verbesserung, das ist die Baseline. Wenn ein Pattern
schmerzhaft ist (State-Race, dead code, copy-paste) → fix it,
nicht workaround it.

Konkretes Mindest-Set für jede neue/geänderte Datei:

### Architektur
- **Single Source of Truth pro Domain.** Status der App lebt
  an EINER Stelle (Service, Context, oder Reducer). Wenn ein
  AsyncStorage-Key an >1 Stelle direkt geschrieben wird, ist das
  ein Bug — wickle ihn in einen Service.
- **No dead code.** Bevor du was Neues schreibst: check ob's
  schon existiert. Wenn alter Code (Provider, Service-Methode,
  Komponente) nicht mehr genutzt wird → löschen, nicht parallel
  einen zweiten Pfad aufbauen.
- **State-Race verhindern** (nicht reparieren). Wenn zwei
  setState-Calls im selben Tick + danach ein Read passieren → 
  benutze `useReducer` mit atomaren Updates ODER refactore zu
  einem einzigen state-Objekt. Workaround-Parameter wie
  `overrideXyz` durch drei Funktionen reichen = code smell.
- **Komponenten < 400 Zeilen.** Wenn eine Datei größer wird,
  ist das ein Signal das mehrere Verantwortlichkeiten drin
  stecken. Split: pro Step/Section eigene Komponente, gemeinsamer
  Provider/Context für Daten, dünner Container der orchestriert.
- **Hooks-Regel ist nicht verhandelbar.** Niemals "ALLE useState
  IMMER (keine conditionals!)" als Kommentar — das ist die
  Hooks-Rule, kein Workaround. Wenn du das hinschreibst, ist
  der File zu groß und braucht Refactoring.

### State-Persistenz (Onboarding/Auth/etc.)
- **Storage-Keys NIE direkt schreiben.** Immer durch Service-
  Methode wickeln. Wenn ein Test/Debug-Screen den Key resetten
  will → benutze die `reset*`-Methode des Service. Beispiel:
  `OnboardingService.markCompleted()`, nicht
  `AsyncStorage.setItem('onboarding_v1_completed', 'true')`.
- **Status-Transitionen sind atomar.** Wenn `state=completed`
  bedeutet "User hat Onboarding fertig + Daten in Firestore",
  dann muss der Flag erst gesetzt werden NACHDEM Firestore-Write
  succeeded ist. Andernfalls: User killt App nach Storage-Set
  aber vor Firestore-Write → Onboarding ist "fertig" aber Daten
  fehlen.
- **Semantik der Flags klar trennen.** `completed` ≠ `skipped`
  ≠ `abandoned`. Wenn `hasPassedX()` über zwei Flags ODER-verknüpft,
  ist das ein Hinweis dass das Statussystem unterspezifiziert ist.
  Verwende einen Enum-State (`'pending' | 'in_progress' |
  'completed' | 'skipped'`), nicht zwei Booleans.
- **Resume-State funktionert oder existiert nicht.**
  `saveProgress`/`loadProgress` als Methoden zu haben ohne sie
  jemals aufzurufen ist schlimmer als sie gar nicht zu haben —
  weil's so aussieht als ob's geht. Entweder Resume integrieren
  ODER die Methoden löschen.

### Navigation / Flow
- **Pro Auth/Onboarding-Übergang: GENAU EINE Funktion** die
  alle Side-Effects orchestriert (Firestore-Save, Storage-Flag,
  Premium-Refresh, Route). Keine 3 parallelen Pfade
  (completeOnboarding / completeOnboardingForAuth / skipOnboarding)
  die nur 80% denselben Code teilen — wenn 80% gleich, dann
  refactor zu 1 Funktion mit Parameter.
- **`router.back()` muss immer einen sinnvollen Ziel-State
  haben.** Wenn ein Screen via `router.replace` betreten wurde,
  ist `router.back()` ein No-op oder springt aus der App raus.
  Wenn User den Back-Button sehen darf, dann `router.push` als
  Übergang — sonst Back-Button ausblenden.
- **Auth-Pfad muss alle vorgelagerten Flags setzen.**
  Wenn User durchs Onboarding zu /auth/welcome geleitet wird,
  muss DORT `markOnboardingCompleted` triggern (in jedem Sign-In-
  Handler), nicht im vorherigen Screen — sonst Re-Start-Bug.

### Code-Hygiene
- **Statische Imports oben im File.** Außer wenn ein konkretes
  Performance-/Lazy-Load-Argument greift (Code-Splitting), keine
  `await import(...)` in async-Funktionen. Insbesondere NICHT
  denselben Modul-Pfad an 5 Stellen lazy importieren.
- **Imports aufräumen.** Ungenutzte Imports sind ein Signal dass
  der File geschrumpft ist ohne dass jemand nachgezogen hat.
  Beim Editieren mit-aufräumen.
- **Error-Handling konsistent pro Funktion.** Entweder die
  Funktion ist robust (catch + recover) ODER sie wirft (caller
  fängt). Kein Mix aus "stillen warns" + "Alert.alert" + "kein
  Catch" in derselben Funktion.

Wenn du eine bestehende Datei berührst und siehst dass sie diese
Regeln verletzt → **flag es dem User**, fix es nicht heimlich
mit. Aber das was du SELBER schreibst hält sich an die Regeln.

## ⛔️ Hosting-Site `markendetektive-895f7` ist GETEILT — Deploy-Falle (17.07.2026)

Die Default-Hosting-Site trägt **zwei Dinge gleichzeitig**: die Marketing-Startseite
(Quelle: `~/Documents/LokaleFragen/firebase-app`, eigenes Git-Repo) UND produktive
App-Infrastruktur. Firebase Hosting **ersetzt bei jedem Deploy den KOMPLETTEN
Site-Inhalt — es gibt kein Merge**. Wer aus einem der beiden Repos deployt, ohne die
Dateien des anderen mitzuliefern, reißt live Features ab.

**Vorfall 17.07.2026:** Ein Marketing-Deploy (dessen `firebase.json` hat KEINE
`site`-Angabe → landet automatisch auf der Default-Site) ersetzte `public-web/`.
Folge: `/join-list/**` und `/p/**` waren 404 → **alle Einladungs-Links für geteilte
Einkaufszettel und alle Produkt-Share-Links tot**, mehrere Stunden unbemerkt
(`.well-known/*` überlebte, weil Firebase die App-Links-Dateien selbst ausliefert).

**Technisch abgesichert (17.07.) — beide Richtungen:**
- **Dieses Repo kann die Site nicht mehr deployen**: der `markendetektive-895f7`-Block
  wurde aus `firebase.json` ENTFERNT (nur noch `md-receipt-admin` steht drin). Ein
  versehentliches `firebase deploy --only hosting` kann die Marketing-Site nicht mehr
  löschen. Den Block NICHT wieder hinzufügen.
- **Der Marketing-Deploy schützt unsere Dateien**: `predeploy` (`scripts/app-infra.mjs`)
  synct `public-web/`-Dateien von hier rüber und bricht ab, wenn Dateien oder Rewrites
  fehlen; `postdeploy` (`scripts/verify-live.mjs`) smoke-testet alle 10 Live-Pfade.

**Regeln:**
- Der kanonische (und einzige) Deploy der Default-Site läuft aus `~/Documents/LokaleFragen/firebase-app`.
  Dessen `public/` enthält Kopien von `public-web/join.html` + `public-web/monitor-md2026.html`,
  dessen `firebase.json` die Rewrites `/join-list/** → /join.html` und `/p/** → Cloud Run
  productshare`. Beides ist dort als PRODUKTIV kommentiert + im README gewarnt.
- **Ändere ich hier `public-web/join.html` oder `monitor-md2026.html` → Kopie nach
  `~/Documents/LokaleFragen/firebase-app/public/` nachziehen**, sonst deployt der nächste
  Marketing-Deploy den alten Stand. **Assets nicht vergessen** — `join.html` braucht
  `app-icon.png`, `app-store-badge.svg`, `google-play-badge.png` aus demselben Ordner
  (am 17.07. übersehen → Einladungsseite lud mit kaputten Bild-Platzhaltern).
- Einladungs-Links sind in der App **hardcoded** (`lib/services/sharedListService.ts`,
  `INVITE_LINK_BASE`) — die URL kann NICHT einfach umgezogen werden, alte Links blieben
  sonst für immer tot.
- **Nach jedem Hosting-Deploy (egal aus welchem Repo) verifizieren:**
  ```bash
  for p in / /join-list/TEST /monitor-md2026.html /p/test; do
    curl -s -o /dev/null -w "%{http_code}  $p\n" "https://markendetektive-895f7.web.app$p"
  done   # alle 200 = ok
  ```

## Forbidden Patterns

Dinge die mindestens einmal teuer waren und nicht neu probiert
werden sollten. Andere "Don't"-Regeln stehen verteilt im File
(siehe `await import('react-native')`, `persistentLocalCache`,
`USE_FLYING_TABS`-Legacy etc.) — hier nur die Learnings aus
Recent-Sessions.

- **Eine Codebase von einem Zweig ausrollen, dem Änderungen eines anderen
  Zweigs fehlen, die schon live sind (Vorfall 23./24.09.2026).** Die
  Zweitprüfung unsicherer Bons (19.09., von Patrick eingeschaltet) lag nur im
  Session-Zweig; am 23.09. um 10:07 wurde `cashback-pipeline` aus
  `feat/rnfirebase-migration` ausgerollt (EDEKA-Fix) — dort fehlte der Code, die
  Zweitprüfung war still weg (letzte Nutzung 22.09.), Bons mit Warenkorb-Rabatt
  wurden wieder abgelehnt. Umgekehrt hätte ein Ausrollen aus dem Session-Zweig
  den EDEKA-Fix und den Vergütungs-Push entfernt. Firebase ERSETZT die Codebase
  komplett, es gibt kein Zusammenführen. Regel: **vor jedem Functions-Deploy**
  `git log <deploy-zweig>..<jeder-andere-aktive-zweig> -- cloud-functions/<codebase>`
  prüfen — nicht leer = erst zusammenführen, dann ausrollen. Session-Zweige
  nach dem Ausrollen zeitnah in den Arbeitszweig mergen, sonst wiederholt es
  sich. Absicherung im Betrieb: der Tagesbericht der Morgenrunde warnt rot,
  wenn die Zweitprüfung eingeschaltet ist, aber 48 h nicht lief.

- **expo-camera `takePictureAsync` aufrufen, BEVOR `onCameraReady` gefeuert
  hat.** Verletzt den dokumentierten expo-camera-Vertrag (CameraView-Doc:
  „wait for the onCameraReady callback before calling this method"). Auf
  Android (CameraX `ImageCapture`) liefert ein Auslösen vor dem ersten
  Stream-Frame den **letzten Puffer der VORHERIGEN Kamera-Session** zurück
  = das Foto eines vorher fotografierten Produkts. War die Ursache des
  „vertauschte Produktfotos"-Bugs im Produkt-Wizard (86ca…, 2026-07-03):
  bei rapiden Einreichungen (Wizard remountet, Kamera noch nicht bereit)
  landeten byte-identische Fremd-Produkt-Fotos in `crowd_uploads` — forensisch
  bewiesen per md5 (gleicher Step, cross-submission, echtes Gerät; z.B.
  Olivenöl-Ordner enthielt die `hersteller`+`zutaten` einer früheren
  Eiernudeln-Einreichung). Regel: JEDER `takePictureAsync`-Callsite MUSS
  auf einen `cameraReady`-State gaten (`onCameraReady={() => setCameraReady
  (true)}`, Shutter `disabled={capturing || !cameraReady}`, in der
  Capture-Funktion `if (!cameraReady) return;`) und `cameraReady` beim
  Remount/Teardown der CameraView (`if (!showExpoCam) setCameraReady(false)`)
  zurücksetzen. `app/cashback/capture.tsx` macht es korrekt (Referenz);
  `app/product-submit/wizard.tsx` tat es bis 2026-07-03 NICHT. Diagnose-Weg
  bei „falsche Bilder in Uploads": NICHT die Queue/Pfade verdächtigen (die
  waren sauber) — per Storage-`md5Hash` (JSON-API, ohne Download) auf
  byte-identische Objekte über Slots/Sessions scannen; identische Bytes =
  reused File/Frame, nie zwei echte Aufnahmen.

- **Mehrere Codebases in EINEM `firebase deploy` (05.09.2026, review-console).**
  Symptom: alle Functions der einen Codebase failen mit Container-Healthcheck
  und `Function 'X' is not defined in the provided module`, obwohl das Modul
  lokal sauber lädt (`node -e "console.log(Object.keys(require('./index.js')))"`
  zeigt alle Exporte). Zweimal reproduziert (mit crowd-upload-namer, mit
  cashback-pipeline+hosting), beide Male ging derselbe Stand **solo** sofort
  durch — das ist die schon dokumentierte Multi-Codebase-Flake, nur in der
  Gen2-Variante. Regel: **jede Codebase einzeln deployen.** Die echte Ursache
  steht NUR in den Cloud-Run-Logs (`gcloud logging read
  'resource.labels.service_name="<fn-lowercase>"'`), der Deploy-Output zeigt
  nur den Healthcheck. Zusätzlich gilt: Deploy erst starten, wenn alle Edits
  der Codebase geschrieben sind — ein laufendes Append landet halb im Paket.

- **Legacy-Storage-Function `optimizeImage` war die ECHTE Ursache der
  „vertauschten Produktfotos" — nicht die Kamera (2026-07-03).** Der onCameraReady-
  Fix oben war ein berechtigtes Hardening, aber die cross-DEVICE-/cross-ACCOUNT-
  Vertauschung (3 verschiedene Handys, `optimized:true`, `metageneration:2`,
  uniform 800×1067) kam serverseitig: eine **nicht im Repo liegende** Gen2-
  Storage-Function `optimizeImage` (europe-west3, Trigger auf JEDEN Bucket-
  `object.finalized`, Juni 2024 per Console deployt) lud jedes Bild in einen
  Temp-Pfad, der NUR `path.basename(filePath)` nutzte → `/tmp/front.jpg`. Bei
  gleichzeitigen Uploads gleicher Basenames (Frank+Peter je `front.jpg`)
  überschrieb ein Lauf die Temp-Datei des anderen → fremdes Bild zurück in den
  eigenen Pfad geschrieben. Nebenschaden: verkleinerte crowd_uploads/Bons auf
  q40/800px (ruinierte OCR). **Fix (aktiv):** Traffic auf Cloud-Run-Revision
  `optimizeimage-00027-dal` (skippt `crowduploads/`+`cashback-uploads/` komplett
  + eindeutiger UUID-Temp-Pfad für alle anderen Pfade). Vorher hing 100% Traffic
  auf der ALTEN Revision `00009-noz` (Tag „working") — deshalb wirkte ein bloßer
  `gcloud functions deploy` NICHT (neue Revision bekam 0% Traffic). **Rollback:**
  `gcloud run services update-traffic optimizeimage --region=europe-west3
  --project=markendetektive-895f7 --to-revisions=optimizeimage-00009-noz=100`.
  Durability-Risiko: die Function ist nicht im Repo → ein Console-Redeploy könnte
  den Fix überschreiben; langfristig ins Repo/CI holen. Diagnostik-Merker:
  `object.finalized`-Storage-Trigger sind unsichtbar, wenn man nur die Repo-
  Codebases durchsucht — `gcloud functions list` + Storage-Metadaten
  (`optimized:true`, `metageneration>1`) verraten sie.

- **crowd_uploads-Bild-Dateinamen OHNE eindeutigen Token vergeben
  (`{step}.jpg`).** Defense-in-Depth gegen die Basename-Kollisions-Klasse oben:
  seit `3f38f87` hängt `newImageBatchId()` (`lib/services/productSubmit.ts`) einen
  global eindeutigen 8-Byte-Hex-Token pro Einreichung an JEDEN Dateinamen
  (`front_<batch>.jpg`, `ean_<code>_<batch>.jpg` …); alle Bilder EINER Einreichung
  teilen den Token. Der Token wird EINMAL pro `doSubmit` erzeugt und für ALLE
  Steps genutzt (nicht mehr nur EAN). Das `images`-Map im Doc bleibt per Step
  gekeyt (`images.front` = voller Pfad) → Leser (crowd-upload-namer, Operator)
  nutzen den Map-Key, NIE den Dateinamen parsen. Regel: NIE wieder einen festen
  `{step}.jpg`-Basename einführen — jeder Basename muss über Einreichungen/User
  hinweg eindeutig sein, damit kein Basename-gekeyter Prozess je Bilder vertauscht.

- **`addDoc` auf dem Geldpfad — ein Schreibvorgang ohne Schlüssel, an dem ein
  zweiter scheitern kann (10.09.2026).** `submitProduct` legte Produktfoto-
  Einreichungen mit `addDoc` an; jeder Aufruf prägt eine neue Zufalls-ID, also
  wird JEDE Wiederholung zwangsläufig ein zusätzliches Dokument. Ausgelöst hat
  es der Einreichen-Knopf, der im ausgelieferten Stand (build 1234, `18b8cb6`)
  nur `disabled={!allCaptured}` trug und während ≥4 s GPS-Wartezeit plus sieben
  Dateikopien keinerlei Rückmeldung gab — jeder weitere Tipp startete einen
  eigenen Lauf mit eigenem Bild-Token. Ergebnis: 3 Nutzer, 7 byteidentische
  Einreichungen, jede davon abgelehnt (siehe „Eine Doppel-Regel MUSS eine Kopie
  übrig lassen"). **Die 10–13 s zwischen den Kopien sind KEINE Frist**, sondern
  die Laufzeit EINES Auftrags in der seriellen Warteschlange — wer nach einem
  Retry-Timer sucht, sucht falsch. Fix (`productSubmissionDocId`): deterministische
  Doc-ID `uid_sessionId_productIndex` + `setDoc`. Weil `firestore.rules` auf
  `crowd_uploads` `update, delete: if false` setzt, ist der zweite Schreibvorgang
  ein verbotenes `update` — „der erste gewinnt" ist damit SERVERSEITIG erzwungen
  und hängt nicht an Client-Disziplin (im Emulator belegt,
  `rules-tests/firestore.rules.test.js`). Regel: **jeder Schreibvorgang, an dem
  Geld hängt, braucht eine deterministische ID aus fachlichen Feldern** — die
  Buchungsseite macht es längst so (`crowd_<uploadId>`, siehe „Ein Status-Feld
  ist kein Mechanismus"), die Erzeugungsseite tat es nicht. Zwei Ergänzungen,
  die nicht fehlen dürfen: ohne verwertbaren Schlüssel wird auf eine Zufalls-ID
  ausgewichen (eine Dublette ist besser als eine verlorene Einreichung), und ein
  `permission-denied` gilt nur dann als „liegt schon vor", wenn ein Lesevorgang
  das Dokument BESTÄTIGT — sonst verschwände eine Einreichung bei abgelaufener
  Anmeldung lautlos. Die Doc-ID im Regelwerk an die uid zu binden wäre der
  nächste Schritt, sperrt aber sofort alle Feldgeräte aus, die weiter Zufalls-IDs
  schreiben — erst nach vollständiger Update-Verbreitung.
- **Einen Auslöse-Knopf ohne Wiedereintritts-Zustand lassen, wenn danach eine
  rückmeldungsfreie Wartezeit kommt.** Teil desselben Vorfalls. Zwei Details, die
  eine naive Sperre nicht abdeckt: (1) `Alert.alert` blockiert NICHT — eine
  Sperre, die im `finally` fällt, ist wieder offen, während der Erfolgs-Dialog
  noch steht und die Fotos unverändert im State liegen; (2) ein `boolean` reicht
  nicht, weil „läuft gerade" und „für diesen Vorgang schon erledigt" zwei
  Zustände sind. Muster im Wizard: `submitZustand: 'idle' | 'laeuft' | 'fertig'`
  plus ein Ref mit den bereits eingereichten Slots; die Sperre fällt erst, wenn
  ein NEUER Vorgang beginnt. Und der Riegel gehört zusätzlich dorthin, wo Arbeit
  entsteht (`enqueueProductUpload` gibt für denselben Slot den bestehenden
  Auftrag zurück) — sonst kostet jeder Extra-Tipp sieben Dateikopien und sieben
  Uploads, auch wenn am Ende nur ein Dokument übrig bleibt.
- **Zwei React-Native-`<Modal>`s gleichzeitig sichtbar präsentieren.**
  iOS deadlockt ("Attempt to present X on Y which is already presenting Z")
  → App FRIERT EIN (kein Crash, harter Hang). Passierte als Hyperbug
  (86ca8g2p9): nach dem Abgeben einer Bewertung öffnete eine action-
  getriggerte Umfrage ihr `FilterSheet`-Modal ÜBER dem noch präsentierten
  `RatingsSheet`-Modal. Beide Sheet-Komponenten (`FilterSheet`,
  `RatingsSheet`) sind RN-`<Modal>`. Regel: NIE ein zweites Modal-Sheet
  öffnen, solange ein anderes präsentiert ist — erst das erste schließen
  (+ Dismiss-Animation abwarten), dann das zweite. Mechanik dafür existiert:
  `lib/services/sheetPresence.ts` (globaler Zähler offener Sheets;
  `FilterSheet`/`RatingsSheet` melden sich an/ab via `registerSheetOpen`).
  Konsumenten, die programmatisch ein Sheet öffnen (z.B. action-Umfragen im
  `SurveyProvider`), MÜSSEN über `isAnySheetOpen()` / `whenSheetsIdle()`
  gaten. Neue Modal-basierte Sheets immer am Zähler registrieren; ein
  Sheet, das selbst nicht zählen soll (das gerade präsentierte), setzt
  `registerPresence={false}`. Nicht-Modal-Overlays (Toasts, Reanimated-
  Slide-Up-Views wie AchievementUnlockBanner) sind unkritisch.

- **Upload-Bilder (Bon + Produkt) komprimieren/runterskalieren VOR dem Upload.**
  Die Cloud-Pipelines brauchen VOLLE Bildqualität für die Analyse: OCR von
  Nährwert-/Zutaten-Labels, Bon-Text-Erkennung, Produkt-Identifikation,
  EAN-Lesbarkeit. Ein verkleinertes/stark JPEG-komprimiertes Bild macht kleine
  Schrift unleserlich → OCR/Extraktion failt. `prepareForUpload`
  (`lib/utils/cashbackImage.ts`) ist BEWUSST ein Pass-Through;
  `expo-image-manipulator` NICHT zum Verkleinern vor Upload einsetzen — weder
  für Produktfotos (`uploadProductImage`/`uploadQueue`) noch für Bons
  (`uploadBonImage`). User-Vorgabe 2026-06: "volle qualität für die analyse,
  egal ob bon oder produkt". Storage-Kosten sind sekundär; falls nötig
  server-seitig NACH der Analyse archivieren/verkleinern, NIE client-seitig vor
  Upload.

- **Firestore-Write (`setDoc`/`addDoc`/`updateDoc`) im kritischen UI-Pfad
  awaiten.** Die Promise löst erst bei SERVER-Ack auf — **offline hängt sie
  ewig** (der lokale Cache wird optimistisch geupdatet, aber `await` blockt bis
  Reconnect). Symptom: Flugmodus → Submit-Button-Spinner hängt für immer (war
  genau so bei `cashback/review.tsx handleSubmit` → `await createPendingMirror`).
  Regel: **optimistische / Mirror-/Placeholder-Writes fire-and-forget**
  (`void setDoc(...).catch(...)`), der lokale State + der `onSnapshot`-Listener
  (feuert offline sofort aus dem Cache) treiben die UI, und **sofort
  navigieren** statt auf den Write zu warten. Nur das eigentliche Netz-Werk
  (Storage-Upload, Callable/HTTPS-CF) wird versucht und failt offline sauber →
  Error-State + Auto-Resume bei Reconnect (NetInfo). Lokalen Error-State IMMER
  vor einem etwaigen abschließenden Mirror-Write setzen (Z. „setUploadStep
  ('error')" vor „setPendingMirrorError"). Juni 2026.

- **Time-based Debouncing für "wait for async transition to complete"** —
  Wenn ein React-State-Wechsel ein async-Side-Effect-Window hat
  (z.B. `signOut()` → kurze Null-User-Phase → `signInAnonymously()`),
  NICHT mit `setTimeout(action, 600)` werkeln. Stattdessen einen
  expliziten `isXxxing: boolean`-State im Context als Guard nehmen:
  `setIsLoggingOut(true)` am Anfang von `logout()`, `setIsLoggingOut(false)`
  im `finally`. Konsumenten checken `if (isLoggingOut) return;` BEVOR
  sie auf den transienten Null-State reagieren. Deterministisch, kein
  Timing-Glücksspiel. Beispiel: Tabs-Layout-Escape-Hatch zu
  `/auth/welcome` (siehe `app/(tabs)/_layout.tsx` T17.14).

- **`withRepeat(withTiming(ZIEL))` ohne Start-Reset** — animiert ab der
  zweiten Wiederholung von ZIEL nach ZIEL = steht still (Sweep/Loop
  laeuft genau 1x). Immer `withRepeat(withSequence(withTiming(START,
  {duration:0}), withTiming(ZIEL, {...})), -1)`. Kostete am 2026-06-12
  zwei Test-Runden beim SheenSweep.

- **Callback-Props in Reanimated-Worklets (`runOnJS`) oder deps-limitierten
  Memos (`useImperativeHandle([x])`, `useCallback`) capturen, wenn der Callback
  kontext-abhängige Writes macht.** Worklets + Handles halten die Closure des
  ERSTELLUNGS-Renders. Beispiel (Stufe 5, Ground-Truth-verifiziert): SwipeRows
  Bought-Animation rief `onSwipeBought` vom Mount-Render → ✓ in der GETEILTEN
  Liste schrieb `gekauft:true` auf den PERSÖNLICHEN Zettel (det-IDs in beiden
  Collections identisch → still falsches Doc). Unsichtbar, solange das Ziel
  konstant ist; jeder neue Kontext-Switch (Listen-Umschalter!) macht es zum
  Datenbug. Fix-Pattern: Props in Refs spiegeln (`propRef.current = prop` pro
  Render), Worklet-Callbacks lesen `propRef.current`. Analog für SPÄTE
  Callbacks (Fehler-Reverts, Retry-Toasts, Netz-Listener): via Ref lesen oder
  gegen den beim Aufruf gecapturten Kontext guarden. Und async Loads mit
  wechselbarer Quelle brauchen einen Epoch-Guard (monotoner Zähler, vor jedem
  setState prüfen) — sonst überschreibt ein langsamer Load der alten Quelle
  den State der neuen.

- **Ad-/Paywall-/Premium-Gates auf `!isPremium` bauen ODER SDK-Fehler als
  „kein Premium" maskieren.** Premium-Boot-Race (User-Report 2026-07-02,
  Commit 18cc685): `isPremium` startet false, bis RevenueCat antwortet —
  jedes `!isPremium`-Gate behandelt „Status unbekannt" als Free-User →
  zahlende Kunden sahen beim Start Werbung + Auto-Paywall. Verstärker:
  der Service maskierte JEDEN Fehler als Mock-false (nach Cache-Invalidate!)
  und persistierte das in `premium_cache_v1` → nächster Boot auch false.
  Regeln: (1) Werbung NUR bei `showAds` (= `premiumKnown && !isPremium`)
  aus dem RevenueCatProvider, Content-Sperren/Upsells NUR bei
  `!isPremiumEffective` (= unknown wird wie Premium behandelt, fail-closed
  für zahlende Kunden). NIE direkt `!isPremium`. (2) Status-Reads müssen
  Fehler als `null` (unbekannt) liefern, nie als false — `isPremiumOrNull`/
  `forceRefreshPremiumOrNull` nutzen; ein null darf weder State noch
  AsyncStorage-Cache anfassen. (3) Der Premium-Cache wird NUR mit
  bestätigten Werten beschrieben (premiumKnown-Gate). (4) init-Fehler ≠
  Mock-Mode — uninitialisiert lassen + Retry.

- **RevenueCat-Downgrades aus Listener/Cache-Reads übernehmen (Premium-
  Regression 2026-07-02, Commit cef84bf).** Premium hängt bei Receipt-Setups
  am RESTORE, nicht am RC-Serverstand der uid. Der CustomerInfo-Listener
  feuert bei Registrierung sofort mit dem gecachten (entitlement-losen)
  Stand, und Cache-Reads nach einem Restore können stale sein. Regeln:
  (1) Listener + Hintergrund-Abgleiche übernehmen NUR true (Upgrade).
  (2) Ein SDK-false beim Boot ist erst FINAL, nachdem der Geräte-Restore
  durch ist — dessen zurückgegebene CustomerInfo DIREKT auswerten
  (revenueCatService.restorePremiumOrNull), nie danach den Cache lesen.
  (3) „Käufe wiederherstellen" ebenso über das direkte Restore-Ergebnis.

- **Edge-to-Edge auf Android DEAKTIVIEREN (`edgeToEdgeEnabled: false` /
  AppCompat-Theme + windowOptOutEdgeToEdgeEnforcement).** Teuerste
  Fehldiagnose des 86cahgwmn-Zyklus (2026-07-02/03, kostete Builds
  1191+1192): Die App ist SEIT JEHER Edge-to-Edge gebaut (5.0.5 =
  `Theme.EdgeToEdge` + `expo.edgeToEdgeEnabled=true` + app.json true;
  Tab-Bar/FABs/Toasts nutzen `insets.bottom` korrekt). Das Abschalten
  „fixte" 3-Button-Geräte scheinbar, brach aber **Android-15-Geräte mit
  Gesten-Nav** (Poco M7 Pro/HyperOS): targetSdk 35 ERZWINGT dort
  Edge-to-Edge, das Opt-Out wird von OEMs ignoriert/inkonsistent
  umgesetzt → Mischmodus mit insets.bottom=0 → „iOS-Bar weg", App klebt
  am Rand, Back-Swipe tot. Altes Android (Cubot, ≤14) kaschiert das —
  Geräte-Spaltung ist DAS Erkennungsmuster. Regeln: (1) Alle DREI
  Schalter bleiben true (styles.xml `Theme.EdgeToEdge`,
  android/gradle.properties `expo.edgeToEdgeEnabled=true`, app.json).
  (2) Scheinbare „Content unter der Leiste"-Bugs sind IMMER fehlende
  `insets.bottom` an der jeweiligen Callsite (z.B. ScrollView-
  `contentContainerStyle.paddingBottom: X + insets.bottom` auf den
  Produktseiten), NIE ein Grund, Edge-to-Edge global abzuschalten.
  (3) Emulator-Falle: Pixel-3a-AVD hat nur 24dp-NavBar (statt 48dp auf
  echten Geräten) — Überlappungen dort klein/übersehbar.

- **Lokaler Android-Debug-Build (`npx expo run:android`) braucht JDK 17**
  (`/usr/local/opt/openjdk@17/...`) — das RN-Gradle-Plugin lehnt JDK 25 ab
  („Error resolving plugin com.facebook.react.settings > 25.0.2"). Expos
  Install-Schritt flaket (wie iOS) → `adb install android/app/build/outputs/
  apk/debug/app-debug.apk` manuell + `adb reverse tcp:8081 tcp:8081`.
  Release-Builds weiterhin NUR via EAS.

- **Fire-and-forget `void asyncStorageWrite(...)` direkt vor
  `setVisible(false)`/`setState`** — Race-Garantie. Wenn ein Listener
  auf das State-Change wartet und dann den just-geschriebenen Wert
  liest, kommt der Schreib oft NICHT rechtzeitig durch. Repro:
  Coachmark-`dismiss()` mit `setVisible(false); void markSeen(tour)` →
  Demographics-Sheet-Effect feuert sofort wegen visible-Flip, fragt
  `getSeen('home')` → kriegt noch `false` → Sheet wird nie gezeigt.
  Fix: `await CoachmarkService.markSeen(tour); setVisible(false)` —
  Storage erst persistieren, DANN das Signal flippen das Listener
  weckt. 50ms UX-Cost, race weg. Siehe `hooks/useCoachmark.ts`
  T17.14.

- **Meta-App-Auth-Toggles auf "im Client eingebettet" / "Native oder
  Desktop-App".** In Meta-Dashboard → App-Einstellungen → Erweitert →
  "App-Authentifizierung". Wenn EINER dieser Toggles AN ist, schaltet
  Meta die Server-Side-Operations auf dem App-Secret ab. Konsequenz:
  Firebase-Backend's `debug_token`-Call (Teil von `signInWithIdp` für
  Facebook-Provider) failt mit
  `(#100) "You must provide an app access token, or a user access
  token that is an owner or developer of the app"` → Firebase
  retourniert generisches `auth/invalid-credential`, RNFirebase
  maskiert die echte Server-Antwort, Symptom: jeder FB-Login bricht
  ab, egal ob nativer FB-SDK oder Browser-OAuth, egal ob App-ID +
  Secret in Firebase Console korrekt sind. Diagnostik: direkter
  REST-Call zu `identitytoolkit.googleapis.com/v1/accounts:signInWithIdp`
  zeigt die echte `INVALID_IDP_RESPONSE`-Message. Fix:
  **BEIDE Toggles AUS** ("Native oder Desktop-App?" + "Ist der
  App-Geheimcode im Client eingebettet?"). Erst dann darf Firebase
  den Secret server-side verwenden. Wir embed'den den Secret nicht in
  der App; er liegt nur in Firebase Console — die Meta-Settings müssen
  das reflektieren. T17.19 (Mai 2026), nach 3 Tagen Debugging.

- **`BlurView` mit `experimentalBlurMethod="dimezisBlurView"` auf
  Android.** Triggert Surface-Stops / Grey-Screens (Fabric).
  Nur in iOS-Branches verwenden. Für Android-Blur-Look → tinted
  View mit 0.92 Alpha (siehe Header-Pattern).
- **Skia `BackdropBlur` als RN-Backdrop.**
  `@shopify/react-native-skia` 2.6.x sampled nur Skia-Canvas-
  internen Content (`saveLayer` mit kBackdrop-Flag), NICHT RN-
  Views unter dem Canvas. Nicht als BlurView-Ersatz versuchen —
  der Effekt bleibt unsichtbar.
- **Boot-Pfad künstliche Delays.**
  `await new Promise(setTimeout)` oder ähnlich in `app/_layout.tsx`,
  `app/index.tsx`, `FontLoader` → Android-Whitescreen, weil
  Custom-`<SplashScreen>`-Overlay nur iOS mountet. Native splash
  covered den echten Boot. Deferred work → `InteractionManager.
  runAfterInteractions(...)`.
- **Mehrere ScrollViews mit `scrollsToTop=true` gleichzeitig aktiv** —
  iOS blockiert den Status-Bar-Tap (Batterie-Ecke = scroll-to-top)
  KOMPLETT wenn >1 sichtbares UIScrollView den Default
  `scrollsToTop=true` trägt. Kein Fallback, kein "erster gewinnt".
  In einer Tab-App (`(tabs)/*.tsx`) sind nach dem ersten Besuch ALLE
  Tab-Screens gemountet (Expo-Router lazy + freezeOnBlur ist nur
  visuell pausiert) → jeder Root-ScrollView lebt im UIKit-Tree.
  Lösung: pro Tab-Screen `useIsFocused()` aus `@react-navigation/
  native` als Gate auf den Root-ScrollView: `scrollsToTop={isFocused}`.
  Bei Tab-internen Sub-Pages (Stöbern's 3 PagerView-Listen) noch
  `&& tab === 'X'` kombinieren. So ist garantiert genau EIN
  UIScrollView aktiv.
  Plus: für Listen-Wrapper wie `LegendList` zusätzlich
  `renderScrollComponent={plainScrollComponent}` setzen damit iOS
  das native UIScrollView (statt Animated.ScrollView) sauber
  detect'tet — sonst greift `scrollsToTop` auf Lib-Ebene gar nicht.

- **Android + `fontFamily` + `fontWeight` mit custom fonts.**
  React Native + Android wendet `fontWeight` NICHT auf custom Fonts
  an. `{ fontFamily: 'Nunito', fontWeight: '700' }` schickt Android
  auf die Suche nach einer Font NAMENS "Nunito", findet keine
  (weil nur `Nunito_400Regular`, `Nunito_500Medium`,
  `Nunito_600SemiBold`, `Nunito_700Bold` via
  `@expo-google-fonts/nunito` geladen sind) und fällt KOMMENTARLOS
  auf System-Default zurück. iOS dagegen resolvet das nativ
  korrekt — der Bug bleibt also lokal auf Android. Auf iOS-Devices
  sieht alles richtig aus, auf Android renderten dann ~440 Callsites
  (alle die `{ fontFamily, fontWeight: fontWeight.X }` aus
  `@/constants/tokens` nutzen) in System-Sans-Serif statt Nunito.
  Lösung: `lib/utils/androidTextFontPatch.ts` als Side-effect-Import
  in `app/_layout.tsx` ganz oben. Patcht `Text.render` und
  `TextInput.render` auf Android — wenn `fontFamily === 'Nunito'`,
  resolvet zur expliziten Nunito_XXX Variante gemäß fontWeight.
  **Seit Stufe 1 (86cahgwmn) macht derselbe Render-Patch zusätzlich
  einen PLATTFORMÜBERGREIFENDEN `maxFontSizeMultiplier`-Deckel (1.3 =
  130 %):** injiziert den Default auf JEDEM Text/TextInput (iOS + Android),
  außer die Callsite setzt einen eigenen Wert oder `allowFontScaling={false}`.
  Grund: fixe Kartenhöhen liefen bei großer System-Schrift über (Text-
  Clipping-Ursache >100 %). Die Nunito-Resolution bleibt Android-gated,
  die Multiplier-Injektion läuft auf beiden Plattformen. Wenn der Deckel je
  stört (z.B. eine Stelle soll voll skalieren) → dort explizit
  `maxFontSizeMultiplier` überschreiben, NICHT den globalen Default entfernen.
  Separat: in `constants/tokens/typography.ts` gibt's
  `fontFamilyVariants.{regular,medium,semibold,bold,heading,body}`
  und `nunitoFont(weight)` für Code der direkt die explizite
  Variante setzen will (SVG-Text, Skia-Text, andere Stellen die
  nicht durchs Text-Render gehen). NIE wieder
  `{ fontFamily: 'Nunito', fontWeight: X }` einführen ohne sich
  sicher zu sein dass entweder der Patch greift ODER die explizite
  Variante gesetzt ist.

- **KVC `setValue:forKey:` auf undokumentierte iOS-Properties.**
  Im Mai 2026 versucht `VNDocumentCameraViewController.setValue(false,
  forKey: "autoScansEnabled")` einzubauen um Apple's Auto-Shutter
  abzuschalten. Resultat: harter Crash mit `NSUnknownKeyException` —
  die Property ist nicht KVC-compliant deklariert. KVC ist NICHT
  silent fallback, das war Wunschdenken. Apple's private/internal
  Properties sind nicht via KVC erreichbar es sei denn die Klasse
  opted explizit ein. Grundregel: kein KVC-Hack auf iOS-Properties
  die nicht im public Header stehen. Wenn Auto-Shutter o.ä. wirklich
  nötig wäre → eigener Camera-Stack mit `VNDetectRectanglesRequest`,
  nicht KVC-Trickserei.

- **`firebase deploy --only firestore:indexes` wenn `firestore.indexes.json`
  NICHT die Source-of-Truth ist.** In diesem Projekt werden Indizes über die
  Firebase-Console + eine **Staging-DB** (`default-staging`) verwaltet, nicht
  im lokalen File. Das committete `firestore.indexes.json` hatte nur 1 Index.
  Ein `deploy --only firestore:indexes --force` hat daraufhin **75 produktive
  Composite-Indizes auf `(default)` gelöscht** (alles was nicht im File stand) —
  `--force` bestätigt die Löschung ohne Rückfrage. Recovery war nur möglich, weil
  die Staging-DB die Indizes noch hatte:
  `firebase firestore:indexes --database default-staging` exportiert sie im
  exakten File-Format → mergen → wiederherstellen. Regeln:
  (1) NIE `--force` bei `firestore:indexes`. (2) VOR jedem Index-Deploy zuerst
  den Live-Stand exportieren (`firebase firestore:indexes [--database X]`) und
  ins File mergen, damit das File ein Superset ist (Deploy erstellt dann nur,
  löscht nichts). (3) firebase-Deploy bricht bei `409 index already exists` ab,
  wenn Indizes noch `CREATING`/mid-delete sind → für idempotentes Anlegen die
  Firestore-Admin-REST-API nutzen (`POST …/collectionGroups/{cg}/indexes`,
  Bearer aus `gcloud auth print-access-token`, 409 = skip; `__name__`-Felder +
  `density` vorm POST strippen; fieldOverrides via `PATCH …/fields/{fp}
  ?updateMask=indexConfig`). gcloud ist als User-Account authed; Audit-Logs
  (`CreateIndex` = admin activity) wären der letzte Fallback für Definitionen.

## Builds & deploys — niemals automatisch triggern

**Regel**: niemals einen `eas build` oder `eas submit` aus eigener
Initiative starten. Nur wenn der User explizit darum bittet
("build", "neuer build", "test build", "TestFlight", "Play Store",
"submit", "deployen", "rollout" etc.). Default für ein Code-
Change: committen, fertig — nicht builden.

Grund: Builds kosten Zeit (15–25 min) + EAS-Quota + bumpen
Versionsnummern (autoIncrement). User muss kontrollieren wann das
passiert. Wenn unsicher ob ein Build gewollt ist → fragen, nicht
einfach machen.

### Lokale Tests → Metro, NICHT xcodebuild

Wenn User "test mal auf dem sim" sagt → **`expo start`** + Sim mit
Dev-Client öffnen reicht. Metro served das aktuelle JS hot-reload.
KEIN voller `xcodebuild -configuration Release …` für jeden
JS-Change — das kostet 5-10 min pro Iteration für 0 Mehrwert
gegenüber Metro. Lokale Release-Builds nur wenn explizit ein
nativer/Pod-Change drinsteckt der getestet werden muss (z.B.
Plugin-Patch der Info.plist ändert).

User-Hinweis 2026-05-27: "builden musst du nicht immer für solche
tests da wir ja metro haben". Default: Metro. xcodebuild nur bei
nativen Änderungen.

**Metro IMMER via `nohup npx expo start --port 8081 > /tmp/metro.log 2>&1 &`
+ `disown` starten, NIE als run_in_background-Bash-Task.** Background-
Tasks haben ein 10-Minuten-Timeout — Metro stirbt dann mit, die App im
Sim läuft scheinbar weiter (Bundle im Speicher), aber on-demand
geladene Assets (Bilder via require) kommen nicht mehr an → Symptom
"Bilder fehlen", Icons gehen weiter (sind im Bundle). Kostete am
2026-06-10 eine Debugging-Runde. Zweites Learning desselben Abends:
NEUE Asset-Dateien (z.B. assets/rewards/*.png) nimmt ein laufender
Metro nicht auf — nach dem Anlegen neuer Assets Metro neu starten,
Hot-Reload reicht nicht (geänderte Dateiinhalte dagegen schon).

**Drittes Learning (2026-06-11, kostete DREI "ich sehe keinen
Unterschied"-Runden): Wenn Metro läuft, aber Code-Änderungen NIE im
Bundle ankommen (auch nach --clear-Restart nur der Stand vom
Start-Zeitpunkt), ist der File-Watcher tot — Ursache war ein
hängender Watchman-Daemon (Intel-Brew-Install, `watchman version`
hing endlos; killen + State löschen half NICHT). Fix:
`brew unlink watchman` → Metro fällt auf den Node-Watcher zurück,
der zuverlässig läuft. Diagnose-Rezept: Marker-Kommentar in eine
Datei appenden, 4s warten, Bundle curlen
(`http://localhost:8081/.expo/.virtual-metro-entry.bundle?platform=ios&dev=true`
— expo-router hat KEINEN ./index-Entry, index.bundle gibt nur eine
5KB-Fehler-JSON) und auf den Marker greppen. 0 Treffer = Watcher tot.**

## Android: APK aufs Device — Workflow

Wenn der User „aufs Device packen", „APK installieren" o.ä. sagt:
**NICHT `adb install` ausführen, NICHT `eas build:run`** — das endet
oft in Signatur-Mismatches oder Play-Protect-Blocks. Stattdessen:

1. Aktuellsten EAS-Android-Build holen:
   ```bash
   eas build:list --platform android --limit 1 --json
   ```
   → die `applicationArchiveUrl` rauskopieren.

2. Datei in `~/Downloads` mit Versions-/Build-Naming packen:
   ```bash
   curl -L -o ~/Downloads/markendetektive-<version>-<build>.aab "<url>"
   ```
   Beispiel: `markendetektive-5.0.7-1155.aab`

3. Wenn's eine `.aab` ist (production-Profil): mit `bundletool` zu
   universal-APK konvertieren:
   ```bash
   cd ~/Downloads
   bundletool build-apks --bundle=<file>.aab --output=<file>.apks --mode=universal
   unzip -o -q <file>.apks -d <build-dir>
   cp <build-dir>/universal.apk <file>.apk
   ```
   (`internal`-Profil baut direkt APK, kein bundletool nötig)

4. APK auf den Device-Download-Ordner pushen:
   ```bash
   adb push ~/Downloads/<file>.apk /sdcard/Download/
   ```

5. **Fertig.** User installiert manuell vom Device aus dem Download-
   Ordner. Das umgeht Play-Protect-Restrictions, Signatur-Mismatches,
   und MIUI-Sicherheits-Blocks.

**Niemals stattdessen `adb install` direkt feuern** — das hat zwei
mal in Folge mit `INSTALL_FAILED_USER_RESTRICTED` geendet. User
will's manuell installieren, weil das auf seinem Device der
zuverlässige Weg ist.

## Builds & deploys — ALWAYS via EAS, NEVER local

**Beide Plattformen** werden über EAS Build gebaut, nicht lokal.
Das ist der etablierte Workflow für dieses Projekt — nicht
selbst nachdenken, einfach die Befehle nehmen.

```bash
# Android (Play Store internal/production)
eas build --platform android --profile production --non-interactive --no-wait

# iOS (TestFlight)
eas build --platform ios --profile production --non-interactive --no-wait
```

**NIEMALS** `cd android && ./gradlew assembleRelease` o.ä. lokal
ausführen. Das hat schonmal Java-14-vs-17-Stress + ANDROID_HOME-
Stress + 1 h Zeitverlust verursacht. Lokale Builds sind in diesem
Projekt keine Option.

### versionCode / buildNumber

**PFLICHT-CHECK VOR JEDEM iOS-BUILD (mehrfach in dieselbe Falle gelaufen):**
Die committete/Working-Tree-`buildNumber` ist NICHT die Wahrheit — sie hinkt
hinterher (durch den Entitlements-Hack-Workflow + Branch-Drift bleibt sie
veraltet). Wenn man blind baut, kommt eine NIEDRIGERE Nummer raus als die
zuletzt hochgeladene → **Apple lehnt jeden Build ≤ der letzten ab**. Passiert:
committed stand auf 1190, letzter TestFlight war 1202, Build kam als 1191 raus
= wertlos.

IMMER ZUERST die echte letzte Nummer holen, NICHT der lokalen Datei vertrauen:
```bash
eas build:list --platform ios --limit 5 --non-interactive --json \
  | python3 -c "import sys,json;[print(b.get('appBuildVersion'),b.get('status')) for b in json.load(sys.stdin)]"
```
Höchste FINISHED-Nummer = LATEST. Dann `app.json` → `expo.ios.buildNumber` UND
`Info.plist` → `CFBundleVersion` auf **LATEST** setzen → autoIncrement macht
LATEST+1. (Analog Android: `eas build:list --platform android` → höchste
`appBuildVersion` = versionCode-Stand.)

Nach dem Build die Working-Tree-Nummer NICHT wieder auf eine alte zurückfallen
lassen (z.B. beim Restore des Entitlements-Hacks) — `buildNumber` gehört NICHT
in den Hack; nach Restore sofort wieder auf die aktuelle Nummer setzen.

`eas.json` hat `production.autoIncrement: true` mit
`appVersionSource: "local"`. Das bedeutet:
- EAS liest die Version aus `app.json` + `Info.plist` /
  `android/app/build.gradle`
- **Beim Build-Start** bumped EAS automatisch +1 und committed
  die neuen Werte zurück in die lokalen Dateien

Wenn der User "TestFlight 1063" sagt, ist das die FINALE Nummer,
die im Build laufen soll. Das heißt: lokal auf 1062 setzen, dann
EAS triggern → autoIncrement macht 1063. Oder autoIncrement für
diesen einen Build deaktivieren. NICHT lokal auf 1063 setzen,
weil EAS dann auf 1064 bumped.

Beide Plattformen haben getrennte Zähler:
- iOS: `app.json` → `expo.ios.buildNumber` + `Info.plist` →
  `CFBundleVersion`
- Android: `app.json` → `expo.android.versionCode` +
  `android/app/build.gradle` → `versionCode`

EAS synchronisiert beide Stellen pro Plattform automatisch.

### Android-Submit landet NUR im INTERNAL-Track — Promotion ist manuelle Pflicht

`eas.json` → `submit.production.android` hat KEINEN `track`-Eintrag → EAS lädt
aufs Default-Ziel **internal**, NICHT production. Der Play-Store-Rollout braucht
danach IMMER die manuelle Promotion in der Play Console (Internal → Production).

**Vorfall (aufgedeckt 28.08.2026):** Android vc 1234 (6.0.15, Capture/Standort-
Feature, identischer Commit wie iOS 1264) wurde am 11.08. gebaut + submitted —
und blieb dann **~2 Wochen unbemerkt im Internal-Track** liegen. Die Nutzer
liefen durchgehend auf vc 1230 (6.0.13; per Reporting-API bewiesen: 0 Nutzer
auf 1234 bis mind. 23.08.). Folge: iOS lieferte ab 11.08. Standort-Daten in
crowd_uploads, Android gar keine — sah aus wie ein Android-Bug, war aber ein
nie ausgerollter Release. Auch vc 1231–1233 erreichten nie ein Feld-Gerät.

Regeln:
- Nach jedem Android-Submit gehört die **Promotion zur Definition of Done**
  (oder bewusst dokumentiert, dass der Build im Internal-Track bleibt).
- Rollout VERIFIZIEREN, nicht annehmen: Track-Status via Android-Publisher-API
  (edits→tracks.list, read-only) zeigt was promoted ist; die Reporting-API
  (`crashRateMetricSet:query` mit dimension versionCode + metric distinctUsers)
  zeigt, welche versionCodes WIRKLICH im Feld laufen (~4 Tage Daten-Latenz,
  endTime ≤ "current freshness" sonst 400).
- Merker: iOS-Verhalten ≠ Android-Verhalten bei identischem Commit → IMMER erst
  prüfen, ob beide Builds überhaupt bei Nutzern angekommen sind, bevor man
  einen Plattform-Bug sucht.

### `.easignore` ERSETZT `.gitignore` — nichts wird gemerged

Sobald eine `.easignore` existiert, benutzt EAS **ausschliesslich** diese Datei
fuer den Upload-Tarball und ignoriert `.gitignore` **komplett**. Alles, was nur
in `.gitignore` steht, landet damit im Build-Archiv.

Konkreter Fall (26.07.2026): `android/app/.cxx/` (CMake/NDK-Zwischenstand) ist
in `android/.gitignore` ausgeschlossen, stand aber nicht in `.easignore` → 1,3 GB
mit **650 Dateien voller absoluter macOS-Pfade** (`/Users/patricksieber/...` in
`compile_commands.json` / `build.ninja`) wanderten auf den Linux-Build-Worker.
Upload-Archiv war dadurch **220 MB statt ~30 MB** (der Kommentar oben in
`.easignore` nennt ~50 MB als Ziel — die Warnung der CLI ist ernst zu nehmen).

Regeln:
- Beim Anlegen/Aendern von `.easignore` **jeden relevanten `.gitignore`-Eintrag
  gegenpruefen**, ob er dort auch stehen muss (Build-Outputs, `.cxx/`, Caches).
- Nach `eas build` die Zeile „Your project archive is X MB" lesen. Deutlich ueber
  ~50 MB = irgendwas Lokales wird mitgeschleppt. Diagnose: `du -sm * .[a-z]*`
  im Repo-Root und gegen die `.easignore`-Liste abgleichen.
- Lokale Android-Builds (Debug wie Release) erzeugen/aktualisieren `.cxx/` und
  `app/build/` — beides darf NIE ins Archiv.

### Build-Ergebnisse

Builds erscheinen unter
`https://expo.dev/accounts/patze1411/projects/markendetektive/builds`.
Beim `--no-wait` Flag returnt der CLI sofort, der Build läuft
auf EAS-Servern weiter.

### WICHTIG: `eas build` ≠ Auto-Submit zu TestFlight / Play Store

Der `eas build`-Befehl baut **nur** und lädt das IPA/AAB als
Artefakt zu EAS hoch. Er pushed **NICHT** automatisch zu
TestFlight oder zum Play-Internal-Track. Wenn der User sagt
"mach ne neue TestFlight-Version", müssen ZWEI Schritte laufen:

```bash
# 1. Bauen
eas build --platform ios --profile production --non-interactive --no-wait

# 2. NACH Build-Finish: Submitten
eas submit --platform ios --profile production --latest --non-interactive
```

Analog für Android:
```bash
eas submit --platform android --profile production --latest --non-interactive
```

Submit-Profile-Konfig steckt in `eas.json` unter `submit.production`:
- iOS: appleId `patrick@markendetektive.de`, ascAppId `6471081082`
- Android: serviceAccount `markendetektive-895f7-ee3923910ddd.json`

**REGEL (User-Wort)**: Wenn der User **TestFlight**, **Play
Store**, **Internal-Track**, oder sinngemäß "in TestFlight haben",
"aufs Device der Tester", "an die Beta-User" sagt → **Submit ist
Pflicht**. Build allein reicht NICHT. Default-Vorgehen:

```bash
# In einem Schritt — Build + Auto-Submit
eas build --platform ios --profile production --auto-submit --non-interactive --no-wait
```

Oder zwei Schritte (wenn der Build schon läuft / fertig ist):
```bash
eas submit --platform ios --profile production --latest --non-interactive
```

Niemals einen iOS-Build als "TestFlight-Version 1063" verkaufen,
solange `eas submit` nicht durch ist und Apple die Verarbeitung
nicht abgeschlossen hat (i.d.R. 5–30 min nach submit). Bis dahin
ist der Build NUR ein IPA-Artefakt auf den EAS-Servern.

### Submit gehört zum Build — IMMER, beide Plattformen (User-Vorgabe 09.09.2026)

User-Wortlaut: „beide submitten wenn sie durch sind (immer)".

Ein fertiger Build ist ab jetzt kein Endzustand mehr. Wenn ein Build
angefordert wurde und durchläuft, wird er **ohne Rückfrage submittet** —
iOS nach TestFlight, Android in den Track, den `eas.json` vorgibt. Das
ersetzt die frühere Praxis, nach dem Build noch einmal nachzufragen.

**Was das NICHT ändert:** Builds werden weiterhin nie aus eigener Initiative
gestartet (siehe „Builds & deploys — niemals automatisch triggern"). Die
Regel greift erst, wenn der User einen Build bestellt hat.

**Was sie NICHT abdeckt — und wo der Vorgang trotzdem stehen bleibt:** Der
Android-Submit landet im **internen Track**. Die Freigabe für die Produktion
ist ein Schritt von Hand in der Play Console, den ich nicht ausführen kann.
Nach jedem Android-Submit deshalb ausdrücklich sagen, dass der Build dort
liegt und auf die Promotion wartet — im August 2026 blieb genau so ein
Release zwei Wochen unbemerkt liegen, während alle glaubten, es sei
ausgerollt (siehe „Android-Submit landet NUR im INTERNAL-Track").

Praktisch: `--auto-submit` beim Build mitgeben, oder nach dem Durchlauf
`eas submit --platform <ios|android> --profile production --latest
--non-interactive`. Danach den Submission-Status prüfen — die CLI meldet
Fehlschläge nur unspezifisch, der ITMS-Code steht im EAS-Dashboard
(siehe „Submission-Status lokal auslesen").

### iOS TestFlight: Pflicht-Checkliste VOR jedem Build (Juni 2026)

Jede Zeile hier hat mindestens einen Build/eine TestFlight-Version
gekostet. Alle 4 Checks ausführen, DANN bauen — nie umgekehrt.

**1. Entitlements-Check (Vorfall Build 1211: Apple-Login + Push tot):**
```bash
git diff ios/MarkenDetektive/MarkenDetektive.entitlements
grep -c applesignin ios/MarkenDetektive/MarkenDetektive.entitlements  # muss 1 sein
```
EAS baut den WORKING TREE (inkl. uncommitted Changes). Der
"Entitlements-Hack" (Datei temporär leeren für lokale Dev-Builds)
darf NIE uncommitted liegen bleiben — Build 1211 ging mit leeren
Entitlements zu TestFlight → `com.apple.AuthenticationServices.
AuthorizationError` bei jedem Apple-Login + Push tot (aps-environment
fehlte). Vor jedem Build: Diff muss leer sein, applesignin drin.

**2. buildNumber-Check** (siehe Abschnitt oben — `eas build:list`,
höchste FINISHED-Nummer = lokale Nummer; autoIncrement macht +1).

**2b. Version-Train-Check (Vorfall Build 1248, ITMS-90186/90062):** Sobald
Apple eine App-Version APPROVED/RELEASED hat, ist deren „Train" (z.B. 6.0.0)
für neue Build-Uploads GESCHLOSSEN — jeder weitere iOS-Build braucht eine
HÖHERE `CFBundleShortVersionString` (6.0.1), sonst lehnt Apple den Upload ab
(Build-Minuten verbrannt, Submission scheitert still; Fehlertext kommt nur
per Apple-Mail/ASC, die EAS-CLI zeigt nur „Something went wrong"). Vor jedem
iOS-Build nach einem App-Store-Release: `expo.version` (app.json) +
`CFBundleShortVersionString` (Info.plist) + `versionName` (build.gradle,
Konsistenz) bumpen. Symptom-Merker: Build FINISHED, aber in ASC/TestFlight
taucht er auch nach 30+ Min NICHT auf (nicht mal „Wird verarbeitet").
Die In-App-Anzeige liest `nativeApplicationVersion` aus dem Binary — nur die
drei Config-Stellen bumpen, kein Code.

**3. Image-Check: `eas.json` → `production.ios.image` MUSS ein
konkretes Xcode-Image sein (Stand: `macos-tahoe-26.4-xcode-26.4`).**
- NIE `"latest"`: EAS dreht das Image still weiter (latest sprang
  Juni 2026 auf Xcode 26.4 und brach den fmt-Pod) → Builds brechen
  ohne eigene Code-Änderung.
- NIE `"default"`: war Xcode 15.4 → FirebaseSharedSwift braucht das
  Swift-6-Keyword `sending` → "cannot find type 'sending'".
- Älteres Xcode (16.4) ist KEIN Ausweg mehr: Apple lehnt seit Juni
  2026 alles unter dem iOS-26-SDK ab → **ITMS-90725** ("must be
  built with the iOS 26 SDK"). Xcode 26.x ist Pflicht.
- Gültige Image-Namen: https://docs.expo.dev/build-reference/infrastructure/

**4. fmt-Patch-Check: der `FMT_USE_CONSTEVAL`-Block in
`ios/Podfile` (post_install) darf NICHT entfernt werden.**
fmt 11.0.2 + Xcode-26-Clang = "call to consteval function ... is not
a constant expression" in `Pods/fmt/format-inl.h`. WICHTIG: ein
Compiler-Define `-DFMT_USE_CONSTEVAL=0` ist WIRKUNGSLOS — fmt's
`base.h` setzt das Macro ohne `#ifndef`-Guard hart auf 1, sobald
`__cpp_consteval` existiert, und überschreibt jeden Define. Deshalb
patcht der post_install-Hook die Header-QUELLE nach `pod install`
(gsub `define FMT_USE_CONSTEVAL 1` → `0`). Entfällt erst, wenn
RN/Expo eine fmt-Version mit Xcode-26-Fix einzieht.

**Build + Submit (ein Befehl, Standard):**
```bash
eas build --platform ios --profile production --auto-submit --non-interactive --no-wait
```

**Nachkontrolle (Pflicht, ~20 min nach Start):**
- Build-Status: `eas build:view <id> --json` → FINISHED + ipa-URL.
- Submission: bei Fehlschlag zeigt die CLI nur "Fastlane pilot
  failed" / `SUBMISSION_SERVICE_IOS_UNKNOWN_ERROR` — die ECHTE
  Apple-Begründung (ITMS-Code) steht NUR im EAS-Dashboard unter der
  Submission-URL (die Submission-Logs sind verschlüsselt, lokal
  nicht lesbar). Bei ITMS-Code → Code nachschlagen, nicht raten.
- Erst "in TestFlight" melden, wenn die Submission durch ist.

## Redesign status — what's done, what's left

Check before suggesting "next screen": grep for `DetailHeader |
FilterSheet | HeroPill | useTokens` (new-design markers) vs.
`ThemedView | ThemedText | IconSymbol` (legacy markers). New-
design files use the former and almost none of the latter.

**Done (new design):**
- ✅ `app/(tabs)/index.tsx` — Home
- ✅ `app/(tabs)/explore.tsx` — Stöbern
- ✅ `app/(tabs)/rewards.tsx` — Belohnungen (Einlösen + Bestenliste)
- ✅ `app/noname-detail/[id].tsx` — Produktdetail
- ✅ `app/product-comparison/[id].tsx` — Produktvergleich
- ✅ `app/achievements.tsx` — Errungenschaften & Level
- ✅ `app/profile.tsx` — Profil (consolidated from profile.tsx +
  profile-new.tsx + profile-old.tsx + the deleted Mehr tab —
  identity, level/savings hero, menu, settings toggles, social
  sheet, dev tools all in one)
- ✅ `app/favorites.tsx` — Favoriten (DetailHeader + SegmentedTabs
  + PagerView, FilterSheet for sort/market filters, Crossfade
  skeleton on initial load, sliding gradient bulk-action bar
  when items selected, tap-to-navigate with prefetch +
  explicit-checkbox bulk selection)
- ✅ `app/edit-profile.tsx` — Profil-Editor (DetailHeader + Save
  in right slot, avatar with camera-badge overlay + inline upload
  spinner, two surface cards (Identität + Optionales),
  ClearableInput / SelectRow / SegmentedTabs-style Gender pills,
  Date-Picker im FilterSheet auf iOS / native Dialog auf Android,
  full-width pill Save-CTA am Bottom)
- ✅ `app/history.tsx` — Such- & Scanverlauf (DetailHeader +
  SegmentedTabs + PagerView, Crossfade(fillParent) skeleton,
  shared relative-time formatter, tap-to-navigate with prefetch
  for scan items, "Verlauf löschen"-Pill als Top-Action statt
  floating button)
- ✅ `app/purchase-history.tsx` — Kaufhistorie (DetailHeader +
  SegmentedTabs(Marken/NoNames mit Counts) + PagerView, FlatList
  mit Infinite-Scroll-Pagination + Footer-Spinner, Crossfade
  (fillParent) skeleton beim Initial-Load, PurchaseCard mit
  Eyebrow-Logo + 2-Line-Name + Preis-mit-Gekauft-Datum-Zeile,
  flache Footer-Statusleiste "X von Y Käufen · Chronologisch
  sortiert", tap-to-navigate mit Prefetch je nach Stufe)
- ✅ Suche **inline in Stöbern** (gemerged — kein separates
  `/search-results` mehr). `app/(tabs)/explore.tsx` ist die einzige
  Such+Browse-Page. Drei Tabs: **Alle** (default für Such-Aufrufe
  von außen), Eigenmarken, Marken. Der `Alle`-Tab merged
  Eigenmarken+Marken (alphabetisch im Browse-Modus, Algolia-
  ranking-interleaved im Search-Modus). Such-Submit triggert
  einen Algolia-Call (`AlgoliaService.searchAll`) + Firestore-
  Enrich pro Hit (für `bildClean*` + `packTypInfo`). Active-
  Search-Chip (`Suche: "Bier" ✕`) im Filter-Rail führt zurück
  zum Browse-Modus. Algolia-Calls 24-h-LRU-cached
  (`SEARCH_CACHE_*` in `lib/services/algolia.ts`). Algolia-Index-
  Settings in beiden Indizes: `typoTolerance: 'strict'`,
  `minWordSizefor1Typo: 6`, `removeWordsIfNoResults: 'none'`,
  `searchableAttributes` explizit + 13 Synonym-Gruppen (Bier↔Pils/
  Lager/Weizen, Joghurt↔Skyr, Pasta↔Nudeln, Käse-Familie usw.).
  Externe Aufrufer (`(tabs)/index.tsx`, `history.tsx`) routen via
  `(tabs)/explore?query=…&tab=alle` — Stöbern's Route-Effect feuert
  beim Eintreffen automatisch `runSearch(params.query)`.
- ✅ `app/tipps-und-tricks.tsx` — Tipps & Tricks (DetailHeader,
  zentriertes Hero "Spare bis zu 200 € pro Monat", "Wusstest du
  schon?"-Section mit horizontaler Snap-Scroll-Liste aus Quick-
  Tip-Pill-Cards (78 % Screen-Width), pro Tipp-Kategorie eine
  Surface-Card mit getöntem 44×44-Icon-Kreis + Title +
  Description + Bullet-Liste in Kategorie-Tint, CTA-Card am Ende
  mit gradient Pill-Highlight die zum Stöbern-Tab linkt)
- ✅ `app/shopping-list.tsx` — Einkaufszettel (DetailHeader +
  SegmentedTabs mit DREI Tabs Marken/NoNames/Alle Produkte +
  PagerView, SwipeRow mit Pan-Geste in Reanimated 3 (rechts =
  gekauft, links = löschen), inline RowActions als zweite Eingabe,
  pro Tab unterschiedlicher Gradient-Banner (orange Sparpotenzial /
  green Ersparnis / petrol Gesamt), Crossfade(fillParent) Skeleton
  beim Initial-Load, FilterSheet + OptionList für Sortierung +
  Märkte + Kategorien, FAB ersetzt durch Filter-Pill + Plus-Pill
  im DetailHeader-Right-Slot, sticky Bottom-CTA mit Tab-spezifischer
  Aktion (Marken → Umwandeln, NoNames → Alle gekauft, Alle →
  Einkauf abschließen), BrandCard expandiert NoName-Alternativen
  inline mit Lieblingsmarkt-Bevorzugung, alle bestehenden Handler
  1:1 erhalten: handleConvertSingle/Selected, handleMarkAsPurchased,
  handleMarkAllAsPurchased, handleRemoveFromCart, BatchActionLoader,
  AddCustomItemModal, LevelUpOverlay, Achievement-Tracking,
  Journey-Tracking, Analytics)

**Open (legacy design):**
- ⏳ `app/markets/*`, `app/onboarding/*`, `app/auth/*`

When marking a screen done, MOVE it from "Open" to "Done" in this
table. If a previously-redesigned screen gets touched and
regresses, move it back. Don't trust memory across sessions.

## Design system rules (apply everywhere, retroactively too)

These are the rules established while building the Belohnungen +
Errungenschaften screens. Every new screen should reuse these
components/values 1:1 — no parallel re-inventing.

### Earn-Action-Farben + Icons (Schnellzugriff = Single Source)

Die drei Verdien-/Einreich-Aktionen haben app-weit FESTE Farbe +
Icon, definiert in `buildEarnActions()` (`app/(tabs)/rewards.tsx`).
Überall wo eine dieser Aktionen visuell auftaucht (Schnellzugriff-
Tiles, Cashback-Aktion-Cards mit `campaign.kind`, künftige Stellen)
EXAKT diese Werte nehmen — nicht neu erfinden:

- **Kassenbon scannen** (`receipt`): grün `#0d8575`, Icon `receipt`, dark tile (weiße fg)
- **Produkte einreichen** (`product_photos` / `photo`): lila `#5b4f9c`, Icon `camera-plus-outline`, dark tile (weiße fg)
- **Umfragen** (`survey`): grau `#dde2e4`, Icon `poll`, light tile (dunkle fg `#191c1d`)

User-Vorgabe 2026-05-30. Icon-Kreis + Aktions-Button einer Aktion-
Card spiegeln das Tile: bg = Aktionsfarbe, fg = weiß (dark) bzw.
`#191c1d` (light/Umfrage). NIE eigene Icons/Farben pro Aktion setzen.

### Tab switches → swipeable pills + PagerView

Whenever a screen has internal tabs (Stöbern's Eigenmarken/Marken,
Detail page's Inhaltsstoffe/Nährwerte, Rewards' Einlösen/Bestenliste,
any future page with tab-style selectors):

- Visually: `SegmentedTabs` — pill-style, raised active segment on a
  white card, equal-width segments.
- Mechanically: wired to a `PagerView` (`react-native-pager-view`).
  `onPageSelected` updates the SegmentedTabs `value`, taps call
  `pagerRef.current?.setPage(idx)` so the two stay in sync.
- Animation: the native page-swipe (UIPageViewController on iOS,
  ViewPager2 on Android). NOT a JS crossfade/translate.
- Pages stay mounted (PagerView default) so swiping back is instant.
  Per-page data lazy-loads on first focus when expensive.
- **Reference implementation**: Stöbern (`app/(tabs)/explore.tsx`).
  Use the same `setPage` + shared scroll-handler pattern as a template.

**Ausnahme: embedded Tabs INSIDE einer ScrollView.** PagerView
greift vertikale Drags ab und blockiert den parent-ScrollView —
auf Touch in der PagerView-Region kann die Page nicht mehr nach
oben/unten gescrollt werden. Plus: PagerView constrained die
Pages auf seine eigene Höhe, was bei dynamischem Content (z.B.
unterschiedlich langer Zutaten-Text) zu abgeschnittenem Inhalt
führt (catch-22 wenn die Höhe über onLayout der Pages bestimmt
werden soll). Für solche embedded-Tabs (Beispiel:
`product-comparison/[id].tsx` Inhaltsstoffe/Nährwerte) →
conditional Render: `{tab === 'X' ? <PageA/> : <PageB/>}`. Tap
auf SegmentedTabs switched.

**Swipe ohne PagerView (2026-05-29):** Statt PagerView (das den
Vertical-Scroll blockiert) eine horizontale `Gesture.Pan()` aus
`react-native-gesture-handler`, NUR um den Tab-Content gewickelt
(`<GestureDetector>`), mit `.activeOffsetX([-20,20])` (startet nur bei
klar horizontalem Swipe) + `.failOffsetY([-12,12])` (bei vertikalem Drag
gewinnt der parent-ScrollView). `.onEnd` prüft `translationX` (Schwelle
±40) und ruft `runOnJS(onTabChange)(...)`. Geste via `useMemo([tab])`
damit der im Worklet gelesene tab-Wert frisch bleibt. So funktioniert
Swipe + Vertical-Scroll gleichzeitig, ohne PagerView-Höhen-Bug, und der
Swipe ist exakt auf den Tab-Bereich begrenzt.

PagerView bleibt das richtige Werkzeug wenn die Tabs den ganzen
Screen einnehmen UND die Pages SELBST scrollbare Listen sind
(wie in Stöbern) — dort gibt's keinen Konflikt weil die Listen
die Vertical-Touches behalten.

### Header chrome → `DetailHeader` (stack screens) or BlurView pattern (tab screens)

- **Stack/detail screens** (`achievements`, `noname-detail/[id]`,
  `product-comparison/[id]`, …): use the shared
  `components/design/DetailHeader.tsx` directly. Pass `title`,
  `onBack={() => router.back()}`, optional `right={<...>}` slot for
  trailing actions, optional `scrollY` + `scrolledTitle` for the
  morphing-title behaviour. Native stack header is hidden via
  `navigation.setOptions({ headerShown: false })`.
- **Tab screens** (`rewards`, `index`, `explore`): inline the same
  pattern — BlurView on iOS (`intensity={80}`, scheme-aware tint),
  tinted opaque View on Android (`rgba(245,247,248,0.92)` light /
  `rgba(15,18,20,0.92)` dark) — both `position: 'absolute'` from
  `top: 0` with `paddingTop: insets.top`. The `expo-blur` fallback
  on Android is poor, hence the tinted-View fork.
- Content scrolls under the chrome: ScrollView gets
  `contentContainerStyle.paddingTop = insets.top + <row-height>`.
- Back button: 40×40 round Pressable, `arrow-left` icon (24 px),
  `theme.text` colour. Title: extraBold 20 px (DetailHeader) or 26 px
  (tab title like "Belohnungen") — `letterSpacing: -0.2 to -0.4`.
- **Keine Hairline am Bottom-Edge des Headers.** Der Visual-Cut
  zwischen Header und Content ist durch das Material selbst
  (BlurView iOS / tinted View Android) gegeben. Eine zusätzliche
  `theme.border`-Linie wirkt als grauer Bruch beim Scrollen — hat
  ein User-Bug-Report im Mai 2026 explizit angesprochen. Wenn ein
  Schatten-Hint gewünscht ist, dann nur in der Form, dass der
  Header eine Material-Schicht IST, nicht als separate Linie drauf.

### Tab-Bar — per-Platform Pattern (NICHT vereinheitlichen)

Die Tab-Bar (`app/(tabs)/_layout.tsx`, `FlyingTabBar`) hat
**bewusst zwei verschiedene Umsetzungen** je Plattform. Nicht
"vereinheitlichen" — die Trade-offs sind absichtlich verschieden.

**iOS — floating Pill:**
- `position: 'absolute'`, `left: PILL_MARGIN_X (50)`, `right: PILL_MARGIN_X`,
  `bottom: pillBottom (~insets.bottom + 1)`
- `borderRadius: PILL_RADIUS (18)` an allen vier Ecken
- Höhe `PILL_HEIGHT (58)`
- Raised Stöbern-Mittel-Button bricht oben aus (`top: -RAISED_LIFT (22)`)
- `<GlassBackdrop>` hinter der Pille — MaskedView + BlurView
  (intensity 50, dimezisBlurView OK auf iOS) mit vertikalem Gradient
  (transparent oben → opak unten), Höhe = `pillBottom + PILL_HEIGHT/2`

**Android — full-width Bottom-Bar:**
- `position: 'absolute'`, `left: 0`, `right: 0`, `bottom: 0`
- `borderTopLeftRadius: PILL_RADIUS`, `borderTopRightRadius: PILL_RADIUS`,
  Bottom-Corners flat (= 0)
- Höhe = `PILL_HEIGHT + insets.bottom`, `paddingBottom: insets.bottom`
  (Tabs sitzen oben, Gesture-Bar bleibt safe)
- `paddingHorizontal: 24` — Home/Rewards minimal nach innen, kleben
  nicht an der Edge (Konsistenz mit iOS-Atmung)
- **Raised Stöbern-Button BLEIBT** — bricht aus dem Top-Edge der Bar
  raus, gleicher RaisedMiddleTab wie auf iOS
- **Kein GlassBackdrop** — Bar ist solid `cardBackground`, full-width,
  bottom-flush. Kein Blur nötig.
- `elevation: 14` (Material-Lift), kein iOS-Shadow

**Warum verschieden:** iOS hat homogene Geräte-Landschaft (predictable
safe-area, gleiche Gesture-Bar-Höhe). Auf Android variieren OEM-Skins
(MIUI, Samsung One UI, Pixel-Stock-Gestures) so stark, dass eine
floating Pille auf manchen Devices verloren wirkt oder zu nah am
Gesture-Bar liegt. Full-width + bottom-flush ist platform-konventionell.

### Plattform-spezifische Icons (iOS-Style auf iOS, Android-Style auf Android)

Konventions-/System-Icons IMMER plattform-korrekt rendern — iOS-Nutzer
erwarten das iOS-Glyph, Android-Nutzer das Material-Glyph. Umsetzung via
`Platform.OS === 'ios' ? <iOS-Icon/> : <Android-Icon/>`.

- **Teilen / Share**: iOS = `Ionicons name="share-outline"` (Quadrat + Pfeil
  nach oben, entspricht SF-Symbol `square.and.arrow.up`), Android =
  `MaterialCommunityIcons name="share-variant"` (drei verbundene Punkte =
  Material-Share). Referenz: Einkaufszettel-Header (`app/shopping-list.tsx`).
- Gilt analog für andere konventionsbehaftete Icons. NIE ein und dasselbe Icon
  für beide Plattformen, wenn iOS/Android dafür ein klar unterschiedliches
  System-Glyph haben (Share ist der Paradefall). User-Vorgabe 2026-06: „teilen
  icon auf ios im ios style und auf android im android style".

### Search input → ONE shared style across the app

Every search field in the app — Stöbern (Eigenmarken / Marken),
Search-Results, History-Search, Cart-Search, etc. — uses the same
visual block. Defined inline in `(tabs)/explore.tsx`'s
`renderSearchInput`; treat that as the canonical reference.

```
height:           38
borderRadius:     11
backgroundColor:  theme.surface
borderWidth:      1
borderColor:      theme.border
paddingHorizontal:12
flexDirection:    'row'
gap:              8
inner:
  • magnify icon (16 px, theme.textMuted)
  • TextInput (fontSize 14, fontWeight medium, color theme.text)
  • close-circle clear button (16 px, theme.textMuted) when value
```

When a screen NEEDS a "submit" affordance (i.e. submission is not
done via the keyboard's return key — Stöbern's in-place search is
the example), add a 38×38 pill RIGHT NEXT TO the input, NOT inside it:

```
width:            38
height:           38
borderRadius:     11           // matches the input
backgroundColor:  brand.primary  (active) / theme.borderStrong (disabled)
icon:             magnify, 18 px, white
gap from input:   8 px
```

DON'T introduce a tall (44 + radius 22) "search-bar-on-its-own-row"
pattern, a different placeholder typography, or a separate "Filter
+ search" button. ONE input style. ONE submit pill. Everywhere.

### Bottom sheets → `FilterSheet` ALWAYS

Every bottom sheet in the app uses `components/design/FilterSheet.tsx`:

- Slide-up animation via Reanimated 3 (spring on enter, timing on exit).
- Drag handle (44×5 px pill) at the top.
- Title row with X close button — handled by FilterSheet, do NOT add
  your own header inside the children.
- Backdrop fade + pan-to-dismiss (>100 px translation OR >500 px/s
  velocity closes).
- API: `<FilterSheet visible title onClose>{children}</FilterSheet>`.
- Children render as the sheet body — no padding wrapper, FilterSheet
  applies `paddingHorizontal: 20`.
- DON'T use `FixedAndroidModal`, raw `<Modal>`, or roll your own
  bottom sheet. ONE source of truth.

### Hero card pattern

Big gradient cards used as the visual anchor of a screen. Examples:
Cashback hero (Belohnungen Einlösen), StatusHero (Belohnungen
Bestenliste), CurrentLevelHero (Errungenschaften).

Shared dimensions + style:

- `borderRadius: 18`, `paddingHorizontal: 14`, `paddingVertical: 12`
- Diagonal gradient: `start={{ x: -1, y: 0.34 }} end={{ x: 1, y: -0.34 }}`
- Fixed height (`HERO_HEIGHT = 144`) when the card sits inside a
  PagerView so its sibling cards don't jump heights on tab swap.
  Free height when the card is alone on its screen and richer
  content is desired (CurrentLevelHero).
- Inner layout when fixed-height: `<View flex:1 justifyContent:'space-between'>`
  → top row anchored, bottom (progress bars) anchored.
- Top row layout: `flexDirection: 'row', alignItems: 'stretch', gap: 12, minHeight: 52`.
  Three columns:
    1. 52 px circle (avatar / icon — `borderRadius: 26`,
       `backgroundColor: 'rgba(255,255,255,0.22)'`, 2 px
       `rgba(255,255,255,0.55)` border)
    2. Middle column with `flex: 1, justifyContent: 'space-between'`
       → title at top, status pill at bottom
    3. Right column with `alignItems: 'flex-end', justifyContent: 'space-between'`
       → big number at top, currency pill at bottom
  This guarantees the two pills sit on the same baseline.

### Hero pill (`HeroPill`)

Single pill component used for ALL labels inside hero cards. Defined
inline in `app/achievements.tsx` and `app/(tabs)/rewards.tsx` (eventual
target: extract to `components/design/HeroPill.tsx`).

```
paddingHorizontal: 8
paddingVertical: 3
borderRadius: 10
backgroundColor: 'rgba(255,255,255,0.22)'
icon: MaterialCommunityIcons 11 px gold (#ffd44b)
text: fontSize 10, fontWeight extraBold, letterSpacing 0.4, white
```

Use it for:

- Level chip (`Level X · Name`)
- Currency labels (`DETEKTIV-PUNKTE`, `CASHBACK-TALER`)
- Status chips (`Bereit zur Auszahlung`, `Noch X € bis Auszahlung`)
- Stat chips inline (`X Tage Streak`, `X/2 Freezes`, `Noch X Pkt …`)

NEVER define a one-off pill style inline if the role is the same.

### Progress bar (`ProgressBar`)

Single bar component. Used inside hero cards for level/payout progress.

```
icon left (13 px white, opacity 0.95)
label inline (fontSize 12, bold, white opacity 0.95)
counter right ("X / Y", fontSize 12, extraBold, white)
bar (height 5, borderRadius 3, bg rgba(255,255,255,0.22), fill #fff)
```

### Selectors → `ScopeCard` for everything

Three contexts on the Belohnungen screen, all using the SAME
`ScopeCard` component:

- Outer scope (Overall / Regionenkampf)
- Period switcher (Legendär / Rising Star / On Fire)
- Region geo (Bundesländer / Städte)

`ScopeCard` accepts either an MDI glyph name (rendered in a coloured
icon-circle) OR a short emoji string (rendered as text). Heuristic:
contains a hyphen → MDI, else emoji.

```
flex: 1 (rows are equal-width)
minHeight: 50
borderRadius: 12
paddingHorizontal: 10, paddingVertical: 8
inactive: theme.surface bg, 1 px theme.border
active: theme.primaryContainer bg, 1.5 px theme.primary border, shadows.sm
icon-circle (when MDI): 24×24, primary bg when active, surfaceAlt when inactive
title: extraBold 13 px, theme.text
sub: medium 10 px, theme.textMuted
```

### Card pattern in horizontal scroll

For Levels + Achievements horizontal scrolls (and the Bestenliste
card lists):

- Width 156–168 px, height 168–200 px (fixed in scroll, content
  fills with hierarchy)
- White surface (`theme.surface`)
- Soft shadow (`shadows.sm`)
- Border accent: 1 px `theme.border` default, 1.5–2 px in level/diff
  colour when unlocked/active, primary colour when active
- Inner padding: 12–14
- Top row: icon-circle (40–44 px) + status indicator
- Title: extraBold 15 px, `letterSpacing: -0.2`
- Description: medium 11 px, `theme.textSub`, 3 lines max
- Bottom: progress bar (height 4–5 px, diff/level colour fill) OR
  done state (✓ + points)

### Difficulty (achievements)

Same 4-tier ladder app-wide:

- ≤10 pts → Einfach, `#2196F3` (blue)
- ≤20 pts → Mittel, `#4CAF50` (green)
- ≤25 pts → Schwer, `#FF9800` (orange)
- >25 pts → Meister, `#F44336` (red)

`difficultyFor(points)` returns `{ label, color }`. Used for
achievement card borders, icon-circle bg, difficulty chip, progress
bar fill.

### Level gradient

Level-tinted gradients on hero cards + active level cards. Map
mirrors the legacy `/achievements` screen so users see the same
colour for the same level across screens:

- Lvl 1 → `[level.color, '#9E6B50']` (Braun)
- Lvl 2 → `[level.color, '#FF9800']` (Orange)
- Lvl 3 → `[level.color, '#4CAF50']` (Grün)
- Lvl 4 → `[level.color, '#FFC107']` (Gold)
- Lvl 5 → `[level.color, '#FF5252']` (Rot)
- 6+   → `[level.color, '#9E6B50']`

`levelGradient(levelId, baseColor)` helper — defined inline in
both `achievements.tsx` and `rewards.tsx` (target: shared util).

### Lottie animations

For completed achievements only. `lottieFor(achievement)` maps the
`trigger.action` to a file in `assets/lottie/`:

- `first_action_any` → `rocket.json`
- `daily_streak` (≥7) → `streak-fire.json`, else `streak-bonus.json`
- `view_comparison` → `comparison.json`
- `complete_shopping` / `create_list` → `task.json`
- `search_product` → `search.json`
- `submit_rating` → `ratingsthumbsup.json`
- `convert_product` → `swap.json`
- `share_app` → `review.json`
- `submit_product` → `favorites.json`
- `save_product` → `favorites2.json`
- `savings_total` → `savings.json`
- fallback → `confetti.json`

Auto-play, loop, `speed={0.8}`. In-progress achievements use
`<IconSymbol name={achievement.icon}>` (SF symbol → native icon
mapping, Firestore-driven).

### Loaders → skeletons, never blocking spinners

Page-level / list-level loading states use **shimmer skeletons that
mirror the live layout**, never a centered `ActivityIndicator`. The
header chrome (`DetailHeader` / tab BlurView) stays mounted during
the load — only the body swaps. Reference:
`components/design/Skeletons.tsx` (`Shimmer`, `ProductCardSkeleton`,
`ProductDetailSkeleton`, `AchievementsSkeleton`).

The triage rule:

- ❌ **Don't** use `ActivityIndicator` for: a screen that just
  navigated in, a list that's fetching its first page, a hero card
  that's waiting on data, a modal/sheet whose body is loading.
  → Use a `Shimmer`-based skeleton that matches the eventual
  layout (same row count, same card dimensions) so the
  data-swap is invisible.
- ✅ **Do** use `ActivityIndicator` for: inline button states
  (auth submit, save, delete-while-pressed), pagination footers
  (`onEndReached` "loading more" rows when the list already has
  data), camera/permission init blockers, app-boot before fonts/
  auth are ready.

When adding a skeleton:

- Keep it inside the live page's render tree so the chrome
  doesn't unmount.
- Match dimensions exactly — same card width/height, same hero
  height, same row height — to prevent layout jumps.
- Add the named composite to `Skeletons.tsx` (e.g.
  `AchievementsSkeleton`) when the layout is reused; one-off
  skeletons can stay inline using the `Shimmer` building block.

### Progressive loading (detail screens) — NO POPPING

Detail screens (`noname-detail/[id]`, `product-comparison/[id]`)
use a **shape-matching Crossfade** pattern: skeletons that have the
SAME outer shape as the eventual content, faded into the live
content over 320 ms via a single shared value. Because the
container/chip/pill/button shapes are identical between skeleton
and content, the user perceives "details fill in", not "thing
morphs" — no pop.

We attack popping + slowness at four layers: **Firestore offline
persistence**, **in-memory caches**, **route prefetch on tap**, and
**shape-matching Crossfade for the reveal**.

#### 1. Firestore — in-memory cache only, NEVER persistent

`lib/firebase.ts` uses `getFirestore()`. **Auf Android wird die
native Disk-Persistenz explizit ABGESCHALTET** via
`firestore().settings({ persistence: false })` VOR der ersten
Firestore-Op. Das ist PFLICHT — nicht entfernen.

**Warum (teures Learning, Juni 2026 — Tage gekostet):**
`@react-native-firebase` defaultet auf `persistence: true`
(Disk-Cache). Der intendierte Projekt-Stand war IN-MEMORY (alter
Web-SDK: `getFirestore` ohne `persistentLocalCache`). Die
Native-Migration hat die Disk-Persistenz unbeabsichtigt aktiviert.
Folge NUR auf Android: der native SDK hält den über die Session
gelesenen **Referenz-Graph** (produkte / hersteller_new /
handelsmarken / kategorien / packungstypen / discounter /
markenProdukte — ~170+ Docs via `getDocumentByReference`) als
**persistente Query-Targets** und re-validiert sie bei JEDEM Write.
Ein Cart-Write am Einkaufszettel (gekauft-markieren / löschen)
löste dann einen **WatchStream-RESET-Sturm** + `View.computeDoc
Changes → ObjectValue.equals` über alle re-gelieferten Docs aus →
der gRPC-WatchStream-Worker (`FirestoreWorker`-Thread) drehte
**5+ Min bei 600% CPU** durch und blockierte ALLE weiteren Reads
("alles was nachgeladen wird hängt"). Custom/Freitext-Items hingen
NICHT (kein Referenz-Graph). Produktseite hing NICHT (nur ~1
Produkt aktiv). iOS hing NICHT (handhabt dieselbe Persistenz nativ
sauber). Diagnose-Beweis: SIGQUIT-Thread-Dump auf den
`FirestoreWorker` zeigte `protobuf MapFieldLite/AbstractProtobuf
List.equals`-Rekursion; `firestore().setLogLevel('debug')` →
nativer WatchStream-Log zeigte den RESET + die 172 re-gelieferten
Referenz-Docs.

**Regeln:**
- `persistence: false` auf Android NICHT entfernen. iOS NICHT
  anfassen (läuft mit Default-Persistenz, kein Spin).
- Diagnose-Hebel für künftige native-Firestore-Probleme:
  `(firestoreNamespace as any)().settings(...)` +
  `(firestoreNamespace as any).setLogLevel('debug')` (→ logcat
  `I Firestore:`, NICHT `I/Firestore`) + `adb shell kill -3 <pid>`
  → ANR-Trace `/data/anr/` für den `FirestoreWorker`-Stack.
- **DO NOT** switch to the WEB-SDK `initializeFirestore` with
  `persistentLocalCache` / `persistentSingleTabManager` — those are
  web-only (IndexedDB), and on RN the SDK code path crashes via
  `new NativeEventEmitter()` (PushNotificationIOS lazy getter weg in
  modern RN). Half a day verloren. Die In-Memory-Caches in
  `services/firestore.ts` (5-min TTL + inflight-dedup) + der
  manuell gecachte `getDocumentByReference` geben die Revisit-Speed.

#### Never `await import('react-native')`

Same root cause as above (PushNotificationIOS lazy getter):
`await import('react-native')` triggers metro's `metroImportAll`,
which enumerates **all** RN exports and fires the lazy getter
that runs `new NativeEventEmitter(null)` and crashes. ALL
`react-native` imports must be **static** at the top of the file.
If you need `InteractionManager`, `Keyboard`, `Platform`, etc.
in an `async` block, import them statically:

```tsx
import { InteractionManager } from 'react-native';
// …
useEffect(() => {
  InteractionManager.runAfterInteractions(() => {
    /* deferred work */
  });
}, []);
```

Dynamic imports of *other* packages (`expo-haptics`, internal
services) are fine — only `react-native` itself is poisoned.

#### 2. In-memory product-detail cache

`FirestoreService` keeps a 5-minute TTL cache for
`getProductWithDetails`, `getMarkenProduktWithDetails`, and
`getProductComparisonData`, plus inflight-promise de-duplication.
Cache is module-scoped, RAM-only, no AsyncStorage write.

#### 3. Prefetch on tap

Every `router.push` to a detail screen MUST be preceded by:

```tsx
FirestoreService.prefetchProductDetails(id);   // for /noname-detail/:id
FirestoreService.prefetchComparisonData(id, isMarkenProdukt);  // for /product-comparison/:id
router.push(...)
```

The prefetch fires off the Firestore fetch + image download
synchronously; the navigation animation runs in parallel. By the
time the destination screen mounts and calls `getProductWithDetails`,
the inflight promise (or the cache) hands data back instantly.

`getProductWithDetails` and `getMarkenProduktWithDetails`
internally call `RNImage.prefetch(productData.bild)` the moment
the main getDoc lands, in parallel with the reference fetch. The
hero image is in the OS disk cache by the time the screen renders.

Prefetch sites currently wired: `app/(tabs)/index.tsx`,
`app/(tabs)/explore.tsx` (covers both browse + in-place search),
`app/product-comparison/[id].tsx` (alternatives). Whenever you add
a new entry-point that links to a detail screen, add the prefetch.

#### 4. Shape-matching Crossfade

Two `<Crossfade>` blocks per detail screen, each with a skeleton
that mirrors the live content's shape:

- **`noname-detail`** (Stufe 1, 2): single fetch.
  - Top block (Crossfade #1, delay 0, duration 320 ms):
    skeleton = 240 px rounded surfaceAlt container + Hersteller
    chip placeholder at top-left + price-pill placeholder at
    bottom-left + 3 action-button placeholders at bottom-right.
    Each placeholder uses the SAME background colour, padding,
    radius, and position as the live element.
  - Bottom block (Crossfade #2, delay 150 ms, duration 320 ms):
    skeleton = info-card surface with Hersteller/Kategorie row
    placeholders + tabs pill + body card + stufe-row surfaceAlt
    container with S-letter / dots / text-line placeholders.
- **`product-comparison`** (Stufe 3, 4, 5): two-phase fetch.
  - Top block (Crossfade #1, gated on `mainReady`, delay 0):
    same hero skeleton as noname-detail.
  - Bottom block (Crossfade #2, gated on `nonamesReady`, delay 0):
    section-header placeholder + 2 alternativen-card shapes
    matching `NN_CARD_WIDTH` × the live card layout + tabs
    skeleton. Stagger comes from the natural Firestore round-
    trip delta between `mainReady` and `nonamesReady` — no
    artificial delay needed.

Crossfade implementation (in `components/design/Skeletons.tsx`):
- Single `useSharedValue` `t` drives BOTH layers. Skeleton opacity
  = 1 - t, content opacity = t. They sum to 1 at every frame, so
  perceived brightness is constant (no "muddy double-image" or
  "blank gap" mid-frame).
- Default duration 320 ms, default delay 0.
- **`fillParent` prop:** when wrapping a `flex: 1` child like
  `PagerView`, `ScrollView`, or `FlatList`, you MUST pass
  `fillParent` so both layers are absolute-positioned to inherit
  the parent's dimensions. Without it the inner Animated.View
  collapses to 0 height (it doesn't `flex` by default) and the
  child claims `flex: 1` of `0` → renders empty. Default mode
  (no `fillParent`) keeps content in normal flow — correct for
  inline crossfades and fixed-height blocks (240 px hero card).

`Shimmer` block (the building block inside placeholders):
- 1.4 s pulse between opacity 0.85 → 1.0 (range 0.15). Was 0.65 → 1.0
  (range 0.35) — too aggressive, contrasted too much with live
  content, contributed to the "pop" feeling. Calmer pulse =
  smoother crossfade.

Morph titles use combined `transform + opacity` in one
`useAnimatedStyle` worklet at the same 320 ms tempo:
`morphFade.value = withTiming(product ? 1 : 0, { duration: 320 })`.

#### Rules

- **Skeleton elements MUST match the live element's shape**: same
  container backgroundColor, same paddings, same border radius,
  same absolute position. The skeleton is "the same shape with
  Shimmer fills"; the content is "the same shape with real
  values". Crossfade between them reads as "details fill in",
  not "thing transforms".
- **Always render the chrome on the first frame**: `DetailHeader`
  + ScrollView are outside the Crossfade. Only the body blocks
  swap.
- **Use `<Crossfade>` from `Skeletons.tsx`**, not ad-hoc opacity
  wiring. It runs entirely on the Reanimated 3 UI thread (zero
  JS-thread cost per frame).
- **320 ms duration, ≤200 ms stagger** — slower than 200 ms feels
  "graceful" rather than "snappy". Don't go below 250 ms on
  detail screens; it reads as a pop again. Don't go above 220 ms
  on the stagger; the second wave starts feeling like a separate
  pop instead of a continuous cascade.
- **Action handlers gate on `p`/`mp` non-null**, so taps during
  the fade never see undefined product data.
- **No `LayoutAnimation`, no `Animated.spring` opacity, no JS
  `setTimeout` swap.** Always Reanimated 3 worklets.
- **Don't use the `onBasic` / `onMainBasic` / `onMainResolved`
  service callbacks.** Staged data → multiple skeleton-to-content
  swaps → multiple pops. Wait for full data per block, crossfade
  once.

### Animations → Reanimated 3 only

- `useSharedValue`, `useAnimatedStyle`, `useAnimatedScrollHandler`,
  `withSpring`, `withTiming`, `interpolate(..., Extrapolation.CLAMP)`.
- NO `Animated.Value` / `Animated.timing` from `react-native`. NO
  layout-driven animations (avoid `LayoutAnimation`). Every animated
  value runs on the UI thread.
- Stable per-day randomness (e.g. motivation-line variant rotation)
  uses `Math.floor(Date.now() / 86_400_000)` as a seed — keeps the
  string stable inside a session, fresh next day.

### Section header

Page section titles all use the same shape:

```
flexDirection: 'row',
justifyContent: 'space-between',
alignItems: 'baseline',
paddingHorizontal: 20,
marginBottom: 10
```

- Title: `extraBold 20 px, letterSpacing -0.2`, `theme.text`
- Sub (right-aligned, optional): `medium 12 px, theme.textMuted`,
  e.g. counts like `5 / 24`, `Level 3 / 16`

### Spacing rules

- Page section vertical gap: `paddingTop: 10–22` between sections
  (10 for related, 18–22 for unrelated)
- Horizontal scroll content padding: `paddingHorizontal: 20, gap: 10`
- Card-inner gaps: 6–8 between icon row + title, 8–10 between
  title + body / progress
- Sheet content: `paddingBottom: 8` inside FilterSheet (safe-area
  is owned by FilterSheet itself)

### Border radii — pick from the token system, do NOT improvise

The radii live in `constants/tokens/radii.ts`:

```
xs:   4    // tiny chips, dots
sm:   8    // small badges, sticker labels
md:   12   // chips, segmented-tab pills, ScopeCard
lg:   16   // small surface cards (use 14 = lg-2 for QuickAccessCards)
xl:   18   // prominent containers — hero cards, MorphingCartButton,
            //                       MorphingHeader, RatingsSheet,
            //                       Floating-Pill Tab-Bar
2xl:  25   // legacy bottom-sheet / old tab-bar curve
full: 9999 // true circle (only buttons / status dots)
```

**Pick rules:**

- **Card-level container?** → `radii.xl` (18). That's hero cards,
  MorphingCartButton, the floating tab pill — anything that's a
  prominent surface holding other things. ONE value across the app
  so neighbouring elements (e.g. cart FAB next to tab pill) match.
- **Smaller surface card** (Schnellzugriff, AchievementCard horizontal
  scroll cards)? → `radii.lg - 2 = 14`. The QuickAccessCard precedent
  is canonical.
- **Pills / chips / badges (selectors, segmented tabs, hero pills)?**
  → `radii.md` (12) or smaller. Inputs use 11 (search-input pattern,
  see "Search input → ONE shared style").
- **Round buttons** (FABs, raised middle tab button, icon-circle
  avatars)? → `radii.full` (or width/2). Buttons are a separate
  category from containers and are allowed to be perfectly round
  even when they sit inside a non-round container.
- **NEVER** use a one-off radius like 22 or 20 just because it
  "looks right". If none of the tokens match, raise a question
  instead of improvising — drift accumulates fast and breaks the
  visual system across screens.

**Why this rule exists:** when the floating tab pill was first
built it used full capsule (PILL_HEIGHT/2 = 29), then an arbitrary
22, both wrong. The cart FAB right next to it uses `radii.xl` =
18. Inconsistent radii on adjacent prominent surfaces read as
"unfinished design", not "intentional variation". Lock to the
token tier, neighbours will match automatically.

### Copy-Ton: NIE Frustration texten (User-Vorgabe, app-weit)

Niemals negativ/abwertend formulieren — keine „ohne Cashback", „ohne
Vergütung", „keine Vergütung", „nachträglich nicht vergütet" o.ä.
Stattdessen IMMER positiv + vorwärts-gewandt: was der User DAVON hat +
was als Nächstes geht. Beispiele:
- ❌ „Dieser Bon wurde ohne aktive Aktion eingereicht … nachträglich
  vergütet wird er nicht." → ✅ „Dein Bon ist gespeichert und zählt zu
  deiner Ausgabenübersicht. Sobald eine Aktion läuft, gibt's beim
  nächsten Mal etwas obendrauf."
- ❌ „Aktuell ohne Cashback." → ✅ Zeile weglassen ODER den Nutzen nennen
  („du hilfst, die Datenbank zu vervollständigen").
- Limits/Caps: nicht „keine Vergütung mehr", sondern „diese Woche schon
  am Ziel — nächste Woche geht's weiter".
Gilt für Bons, Produkt-Einreichung, Umfragen, Payout — überall. Wenn ein
Zustand faktisch 0 € bedeutet, framing auf „gespeichert/zählt/nächstes
Mal", nie auf den Mangel. User-Vorgabe 2026-05-31: „nie frustration
hervorrufen".

### Toasts → ONE library, one helper-set

ALL toasts go through `lib/services/ui/toast.tsx` (built on
`@backpackapp-io/react-native-toast`). It renders a compact
iOS-Dynamic-Island-style pastel pill — pointed-island-style,
auto-width, NOT in-your-face. Every action that mutates state
(add to cart, favorite, mark purchased, delete, error, etc.)
should produce a toast so the user gets confirmation.

**Helper picker:**

| Use case | Helper |
|---|---|
| Reward feedback (Punkte) | `showPointsToast(msg, points, scheme)` |
| Streak day milestone | `showStreakToast(days, bonus, scheme)` |
| Add to cart | `showCartAddedToast(msg, onOpenCart, scheme)` |
| Already in cart (info) | `showAlreadyInCartToast(onOpenCart, scheme)` |
| Cart purchased / removed | `showPurchasedToast(msg, scheme)` |
| Convert success | `showConvertSuccessToast(savings, scheme)` |
| Bulk convert | `showBulkConvertSuccessToast(savings, scheme)` |
| Bulk purchased | `showBulkPurchasedToast(db, custom, savings, scheme)` |
| Favorite add/remove | `showFavoriteAdded/RemovedToast(name, scheme)` |
| Rating success/error | `showRatingToast(msg, type, scheme)` |
| Generic info / error | `showInfoToast(msg, type, scheme)` |
| **Network-fail with retry** | `showRetryableErrorToast(msg, onRetry, opts)` |

**Position auto-routing:** POINTS, STREAK, ANTI_ABUSE land at the
BOTTOM (near the gamification "score zone"). Everything else lands
at the TOP. Don't fight this — it's intentional.

**Don't:**
- Roll your own toast/snackbar component. Always use the helpers.
- Use `Alert.alert` for non-critical confirmations — that's a
  blocking native modal, the toast is non-blocking.
- Show a toast for every render or every Firestore-listener
  update. Toasts confirm USER ACTIONS, not data changes.

**Network-error pattern (U2 from the audit):** any async call in
the critical path (receipt scan, login, withdraw, submit) wraps:

```ts
try { await someApiCall() }
catch (e) {
  console.error('uploadReceipt failed', e);
  showRetryableErrorToast(
    'Bon konnte nicht hochgeladen werden — Verbindung prüfen.',
    () => someApiCall(),
  );
}
```

The action-pill stays for 8 seconds (long) until the user taps or
swipes. Standard errors WITHOUT retry use `showInfoToast(msg,
'error')` instead — short, no action.

### Celebrations → ONE banner, no confetti modal

Achievement-Unlocks and Level-Ups go through ONE component:
`components/ui/AchievementUnlockBanner.tsx`. Slide-up from above
the tab bar, Lottie 72×72 left, title + subtitle middle, optional
points-pill right, gradient-tinted backdrop in the achievement's
tier color. Auto-dismiss after 7 s, swipe-down or tap-body to
dismiss earlier.

There used to be a "tier" system that routed major events to a
big confetti modal (`LevelUpOverlay` / `AchievementUnlockOverlay`).
That's GONE — visually inconsistent, JS-thread Animated.Value,
ugly. Don't reintroduce it.

**Auto-trigger** (achievement earned / level reached): the
`GamificationProvider` listens to `achievementService` callbacks
and calls the banner internally — pages don't need to do anything.

**Manual trigger** (catalog preview taps, e.g. "tap a level/
achievement card to see what it would feel like"): use the context:

```tsx
import {
  bannerDataFromAchievement,
  bannerDataFromLevelUp,
  useGamification,
} from '@/components/ui/GamificationProvider';

const { showBanner } = useGamification();
// onPress level card:
showBanner(bannerDataFromLevelUp(level.id, prev));
// onPress achievement card:
showBanner(bannerDataFromAchievement(a));
```

`bannerDataFromX` helpers handle the lottie selection + tint color
+ tap-target navigation. Don't construct `BannerData` by hand
unless you're adding a new celebration source.

**Never** build a one-off "celebration modal" inline in a screen.
If a new celebration source appears (e.g. cashback payout), add a
new `bannerDataFromPayout` helper and route through the same
banner. ONE celebration component app-wide.

### Number formatting

- pts: `Number.toLocaleString('de-DE')` — German thousand separators
- € amounts: `value.toFixed(2).replace('.', ',') + ' €'` — comma
  decimal, ` €` suffix with space
- Achievement progress: `formatProgress(value, action)` — for
  `savings_total` returns `X,YZ €`, otherwise rounded integer.
  Don't render raw floats — Math.round catches floating-point noise.

### Cost-conscious data

- Pre-aggregate in Cloud Functions, store ONE doc, read once per
  session + cache. The leaderboard aggregator
  (`cloud-functions/leaderboard-aggregator/`) is the reference —
  nightly pubsub.schedule, `.select()` field projection on scans,
  in-memory cache + inflight-promise dedup on the client.
- For period-windowed data that can't be pre-aggregated daily
  (week/month leaderboards), use the existing per-user counters
  (`leaderboards/{uid}.stats.points.weekly`) maintained by
  `leaderboardService.updateUserStats`. Live `orderBy().limit(25)`
  query from the app, ~25 reads per session.
- NEVER scan a collectionGroup at runtime — that pattern doesn't
  scale. Index it with `.select()` at the daily-aggregator level
  or via per-user denormalised counters.

### Nutrition / Zutaten Schema (reweapify-Format)

Wir nutzen das **reweapify-Schema** als kanonisches Format für
Nährwerte und Zutaten auf `produkte/*` und `markenProdukte/*`.
Reweapify ist die Pipeline-Output-Collection von Rewes-API; wir
übernehmen ihr Schema 1:1 damit kein Mapping nötig ist.

```
// Zutaten
attr_ingredientStatement: string  // "Zucker, Glukosesirup, 15% VOLLMILCHPULVER…"
ingredientsSource:        'manual' | 'rewe' | 'ocr' | 'openfood' | 'scraper' | 'legacy'
ingredientsUpdatedAt:     Timestamp

// Nährwerte (per nutr_serving_size, default 100g)
nutr_Energie_val:                          number   nutr_Energie_unit: 'kcal' | 'kJ'
nutr_Fett_val:                             number   nutr_Fett_unit: 'g'
nutr_FettdavongesttigteFettsuren_val:      number   _unit: 'g'   // sic — Tippfehler aus reweapify
nutr_Kohlenhydrate_val:                    number   _unit: 'g'
nutr_KohlenhydratedavonZucker_val:         number   _unit: 'g'
nutr_Ballaststoffe_val:                    number   _unit: 'g'
nutr_Eiwei_val:                            number   _unit: 'g'   // sic — Eiweiß ohne ß
nutr_Salz_val:                             number   _unit: 'g'
nutr_serving_size:                         number   nutr_serving_unit: 'g'
nutritionSource:        'manual' | 'rewe' | 'ocr' | 'openfood' | 'scraper' | 'legacy'
nutritionUpdatedAt:     Timestamp
```

Trust-Hierarchie (höhere Source wird NIE überschrieben):
1. `manual` — eigene Recherche (Admin-UI / manuelle Edits)
2. `rewe`   — aus reweapify oder direkter Rewe-Pipeline
3. `ocr`    — Bilder-Erkennung von Produkt-Etiketten / Kassenbon-Photos
4. (priority chain für untrusted, newest wins within source:)
   reweapify-fill → scraper → openfood → legacy

App-Reading: `lib/utils/productNutrition.ts` `extractIngredients()`/
`extractNaehrwerte()` lesen beide Formate (legacy `naehrwerte: {}` +
`zutaten: ""` + neues `nutr_*`/`attr_ingredientStatement`) — die
Cloud Functions schreiben nur das neue Format. Sobald der Backfill
einmal durchlief sind alle Produkte im neuen Format; die Legacy-
Read-Pfade können später entfernt werden.

History-Collections:
- `nutritionhistory_produkte` / `nutritionhistory_markenProdukte`
  — Watcher schreibt Snapshots wenn untrusted Sources Werte ändern
- `pricehistory_produkte` / `pricehistory_markenProdukte` — Watcher
  schreibt JEDE Preisänderung (keine Source-Exclusion)

Cloud Functions: `cloud-functions/nutrition-history-watcher/`
(onWrite-Trigger), `cloud-functions/nutrition-backfill/` (HTTPS-Trigger
für one-shot reweapify→openfood→scraper Backfill).

### KI-Analyse (ai-product-comparison) — Architektur ab v15

NoName-vs-Markenprodukt-Bewertung (5-Punkte-Skala 1=rot…5=grün) +
faktischer Begründungstext. Liegt in `cloud-functions/ai-product-comparison/`.

**Hybrid-Prinzip (seit v14): Mathematik macht Code, nicht die KI.**
- `src/scorer.js` rechnet Nährwerte + Labels DETERMINISTISCH (0%
  Halluzination, konsistent, gratis). Ein Unterschied zählt nur wenn er
  BEIDE Schwellen reisst: relativ ≥8% UND absolut ≥`minAbs` (gegen das
  Small-Base-Problem: satFat 0,7 vs 0,4g = +75% rel. aber nur 0,3g abs.
  → irrelevant). `combineScore` hat asymmetrischen NoName-Tilt: +2.5
  für "besser", -3.5 für "schlechter" (kleine Original-Vorteile bleiben
  "gleichwertig"). NIE die Score-Mathe wieder ins LLM zurückverlagern.
- Das LLM (`src/comparator.js`, gemini-3.5-flash) liefert NUR noch
  `{ingredientVerdict, reasoning}` — Zutaten-Qualität + Fakten-Text,
  KEINEN Score. Das verhindert die alte v1-v13-Inkonsistenz (Score
  widersprach dem Reasoning).

**Fallback-Kette (nie "skippen wenn irgendwas fehlt"):**
- NoName ohne markenProdukt-Link → Standalone-Assessment
  (`src/assessor.js`, kategorie-relativ → Schoki wird an Schoki gemessen,
  nicht an Salat). Landet in `aiAssessment`.
- NoName MIT Link, aber Marke (noch) ohne Daten → ebenfalls Standalone-
  Assessment des NoName, NICHT skippen. Sobald die Marke gepflegt wird,
  springt der echte Vergleich an und überschreibt es.
- Nur wenn das NoName SELBST keine Daten hat → `aiComparison.skipped`.
- `aiComparison` und `aiAssessment` werden gegenseitig gelöscht
  (FieldValue.delete) → die UI sieht nie beide. Beide Detail-Screens
  (`noname-detail`, `product-comparison`) rendern `AiComparisonScale`
  und fallen auf `AiHealthScale` (aiAssessment) zurück.

**Debounce — trailing, 1h (NICHT sofort triggern):**
- Trigger (onCreate/onUpdate/onMarkenProduktUpdate) bewerten NICHT
  sofort, sondern setzen nur `aiComparisonDirtyAt = serverTimestamp()`.
  Jede relevante Änderung bumpt den Timestamp.
- `processPendingComparisons` (scheduled, alle 15 Min) verarbeitet nur
  Produkte deren letzte Änderung ≥1h her ist. So läuft die KI nicht 5×
  während ein Scraper/Admin mehrere Felder nacheinander pflegt. Flag-
  Clear ist transaktional (löscht nur wenn `dirtyAt` unverändert, sonst
  würde eine Änderung während des Gemini-Calls verschluckt).
- WICHTIG: `aiComparisonDirtyAt` darf NICHT in `RELEVANT_PRODUKTE_FIELDS`
  stehen — sonst triggert das Setzen des Flags einen Re-Trigger-Loop.
- `scheduledComparisonBackfill` (cursor-basiert) macht den Komplett-
  Durchlauf und resettet automatisch bei `PROMPT_VERSION`-Bump → ein
  Versions-Bump = sauberes Re-Backfill aller ~7321 Produkte.
- HTTPS `runComparisonForProduct?key=…&produktId=…&force=1` läuft sofort
  + force (debug/admin). TRIGGER_KEY = Secret `NUTRITION_SCRAPER_TRIGGER_KEY`.

**Hersteller-Einschätzung (`src/manufacturer.js`, ab Mai 2026):**
- PRO HERSTELLER einmal berechnet (`hersteller/{id}.aiHersteller`), NICHT
  pro Produkt — derselbe Hersteller wird nicht 50× bewertet. Die App liest
  es über die `hersteller`-Reference, die im Produkt-Detail eh geladen wird
  (folgt der Marke→Hersteller-Kette, also der echte Maker, kein Platzhalter).
- KEIN Score (User-Vorgabe) — reine Info-Karte `AiManufacturerCard`:
  `{herkunft}` (Badge) + `{summary}` (2-4 Sätze).
- ZWEI Collections (User-Klärung 2026-05-29):
  • `hersteller` = MARKEN (haben `herstellerref` → hersteller_new, `bild`=
    Markenbild). `markenProdukte.hersteller` zeigt hierauf.
  • `hersteller_new` = die ECHTEN Hersteller. `produkte.hersteller` zeigt
    hierauf — DAS liest die NoName-Produktkarte. Beide werden bewertet
    (eigene Trigger + Backfills + State-Docs).
- UI-Platzierung:
  • noname-detail + product-comparison: `AiManufacturerCard` für den
    Hersteller des NoName (`p/picked.hersteller` = hersteller_new) UNTER
    der KI-Analyse.
  • product-comparison Hero: das (i)-Info-Icon am Markenprodukt-Hersteller
    öffnet ein FilterSheet mit: Markenbild + kuratierten `infos` (= die
    MARKE) und GENAU EINER KI-Hersteller-Karte (`mp.hersteller.aiHersteller`
    = hersteller_new). KEINE zweite KI-Karte für die Marke — die wäre
    Hersteller-artig redundant, v.a. wenn Marke = Hersteller (z.B. Bauer /
    J. Bauer GmbH & Co. KG). Die Marke-Bewertung auf collection `hersteller`
    läuft zwar weiter, wird hier aber NICHT als eigene Karte gezeigt.
- Inhalt = Modell-Wissen: neutrale Herkunft/Einordnung + NUR breit
  dokumentierte, unstrittige Kontroversen, DEFENSIV formuliert ("stand in
  der Kritik wegen…"). NIE erfinden; unbekannter Hersteller → nur Herkunft.
  Grund: falsche Skandal-Behauptung = Rufschädigungs-Risiko. Trainingsstand,
  keine Live-News → Transparenz-Hinweis in der Karte.
- Trigger: `onHerstellerCreate/Update` (sofort, ~968 Hersteller = geringes
  Volumen, kein Debounce nötig) + `scheduledManufacturerBackfill` (cursor,
  `aggregates/aiHerstellerBackfill`, Reset bei `MANUFACTURER_PROMPT_VERSION`-
  Bump). Platzhalter ("z - NoName", Single-Char) → `skipped:'no-name'`.
- HTTPS `runManufacturerForHersteller?key=…&herstellerId=…&force=1`.

### Cashback-Pipeline kann schon OCR + Zeilen-Positionen (nicht neu bauen!)

`cloud-functions/cashback-pipeline` (Gemini-OCR, `lib/ocr.js extractReceipt`)
liefert PRO BON bereits: `items[] {name, priceCents, qty}` + `bonDate` +
Total, dazu Merchant-Resolver (→ Discounter, `lib/merchant.js`), Σ-vs-Total-
Reconciliation + DocAI-Fallback. Schreibt `users/{uid}/purchased_products/
{cashbackId_slug}` mit `{itemName, priceCents, qty, receiptId, bonDate,
merchantId/Name/Land}`. → Bon-Rohdaten + Markt + Preis + Datum pro Position
sind PROD-erprobt da. Beim Thema „Bon-Artikel zuordnen / Journey abschließen"
(ClickUp 86ca0wbg7) NICHT die OCR neu bauen. Was FEHLT ist nur: (1) Zuordnung
`itemName` → unsere `produkte`/`markenProdukte`-`productId` (Klassifikation +
KI-Normalisierung + Vektor-Shortlist + KI-Pick + Alias-Lexikon), (2) Preis-
verlauf-Verknüpfung (`pricehistory_*`/`observedPrice` + Einheiten-Norm),
(3) Journey/Zettel-Abschluss (`sourceJourneyId` + Outcome-Resolver Bon+Abhaken,
dedupe), (4) not-in-catalog → ExternalLookupMiss, (5) BigQuery-Export (B2B).
Bonus: Match-Precision lässt sich direkt an den bereits gesammelten
`purchased_products` messen (kein separater OCR-Spike nötig).

## Submission-Status lokal auslesen (die CLI kann es NICHT)

`eas build:list`/`build:view` liefern `submissions: null` — das ist eine Lücke
der CLI, **kein Beweis, dass kein Submit lief**. Genau daran bin ich am
26.07. gescheitert: Auto-Submit von iOS 1258 war längst erfolgreich, ich hielt
ihn für ausgefallen und habe zweimal nachgeschossen; beide Retries scheiterten
als Doppel-Upload mit dem nichtssagenden „Something went wrong". Auch
`--verbose --verbose-fastlane` zeigt nichts.

Der echte Status steht in der Expo-GraphQL-API, erreichbar mit dem lokalen
CLI-Token (`~/.expo/state.json` → `auth.sessionSecret`):
```bash
SEC=$(python3 -c "import json;print(json.load(open('$HOME/.expo/state.json'))['auth']['sessionSecret'])")
curl -sS https://api.expo.dev/graphql -H "Content-Type: application/json" -H "expo-session: $SEC" \
  -d '{"query":"query($appId:String!){app{byId(appId:$appId){submissions(filter:{platform:IOS},limit:6,offset:0){status createdAt submittedBuild{appBuildVersion appVersion} error{errorCode message}}}}}","variables":{"appId":"5b645e59-c337-44e5-81cd-7681b4515623"}}'
```
`submissions` verlangt zwingend `filter:{platform:IOS|ANDROID}` (ohne → 
GRAPHQL_VALIDATION_FAILED). appId = die Project-ID aus `eas build:view`.
Python-`urllib` scheitert hier an fehlendem CA-Bundle — curl nehmen, NICHT die
Zertifikatsprüfung abschalten.

**Vor einem manuellen `eas submit` immer erst diesen Status abfragen.** Ein
bereits hochgeladener Build lässt sich nicht erneut einreichen.

## Android-Build scheitert bei ~9 min in `configureCMake` → Codegen-Race

Symptom: `EAS_BUILD_UNKNOWN_GRADLE_ERROR`, `buildDuration` ~555–566 s (statt
~1.310 s bei Erfolg), im Log
`Execution failed for task ':app:configureCMakeRelWithDebInfo[arm64-v8a]'` und
darunter mehrfach
`add_subdirectory given source ".../android/build/generated/source/codegen/jni/"
which is not an existing directory`.

**Ursache:** Mit `newArchEnabled=true` erzeugt jedes autolinkte Modul seine
Codegen-Artefakte selbst; `Android-autolinking.cmake` zieht genau diese
Verzeichnisse per `add_subdirectory` herein. EAS baut mit
`-Dorg.gradle.parallel=true` (steht in `GRADLE_OPTS` auf dem Worker), und ohne
explizite Kante ist `:app:configureCMake*` VOR den Codegen-Tasks eingeplant —
gemessen per `--dry-run`: Position 275 vs. letzter Codegen 569.

**Es ist ein RACE, kein deterministischer Fehler.** Identischer Code scheiterte
in 1224/1225/1227 und lief in 1222/1223/1226 durch (~50 %). Das ist die
gefährliche Eigenschaft: ein einzelner grüner Build beweist NICHTS. Beleg im
Log: erfolgreicher Build = 19 `generateCodegenArtifactsFromSchema`-Tasks,
gescheiterter = 3.

**Lokal nicht reproduzierbar** — dort liegen Codegen-Reste früherer Builds in
`node_modules/*/android/build/`, also findet CMake die Verzeichnisse immer. Ein
grüner lokaler `:app:bundleRelease` entlastet den Code, sagt aber nichts über
diesen Fehler.

**Fix** (in `android/app/build.gradle`, unter `apply plugin: google-services`):
`gradle.projectsEvaluated` sammelt alle `generateCodegenArtifactsFromSchema`-Tasks
der Subprojekte und hängt sie als `dependsOn` an jeden `configureCMake*`/
`buildCMake*`-Task des App-Projekts. Parallelität bleibt erhalten.
`org.gradle.parallel=false` in `gradle.properties` wäre WIRKUNGSLOS — EAS setzt
die System-Property per `-D` auf der Kommandozeile, das gewinnt.

**Verifikation ohne 25-Minuten-Build:**
```bash
cd android && ./gradlew :app:bundleRelease --dry-run --parallel --console=plain \
  | grep -n SKIPPED
# :app:configureCMake* MUSS hinter dem letzten generateCodegenArtifactsFromSchema liegen
```

**EAS-Build-Logs lokal lesen** (die CLI zeigt sie nicht):
```bash
npx eas-cli build:view <id> --json | python3 -c "import sys,json;print(json.load(sys.stdin)['logFiles'][0])"
curl -sS -o log.raw "<signierte URL, 900 s gueltig>"
node -e "require('fs').writeFileSync('log.txt', require('zlib').brotliDecompressSync(require('fs').readFileSync('log.raw')))"
```
Die Datei ist **brotli**-komprimiert (`curl --compressed` scheitert mit
„Unrecognized content encoding", gzip/zlib ebenfalls) und enthält JSON-Zeilen
mit dem Text im Feld `msg`.

## `tsc --noEmit` ist KEIN grünes Gate — gegen gemessene Baseline prüfen

Stand 26.07.2026: **361 Fehler** am Produktiv-Commit `c453505`. Der Satz weiter
unten („`tsc --noEmit` is the pre-deploy gate") beschreibt den Wunsch, nicht die
Realität. Wer `npx tsc --noEmit | tail -5` laufen lässt, sieht fünf Fehler und
hält das für die Gesamtmenge — genau dieser Fehlschluss hat am 26.07. zur
falschen Behauptung „0 neue Fehler" geführt.

Regeln:
- **Nie `| tail`** zum Bewerten. Immer `| grep -c "error TS"` für die Zahl.
- **Neu ≠ vorhanden.** Die einzig gültige Aussage ist ein Vergleich gegen eine
  frisch gemessene Baseline:
  ```bash
  git worktree add -q --detach /tmp/md-base <baseline-commit>
  ln -s "$PWD/node_modules" /tmp/md-base/node_modules   # spart 10 min npm i
  (cd /tmp/md-base && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "error TS") > /tmp/base.txt
  # Signaturen ohne Zeilennummern vergleichen, sonst zaehlt jede Verschiebung als "neu":
  sed -E 's/\(([0-9]+),([0-9]+)\)//' … | sort   →  comm -13 base now
  git worktree remove /tmp/md-base --force
  ```
- **Neue Test-Dateien kippen Fehler-Sichtbarkeit.** Kommen `__tests__`-Files ins
  Programm, gewinnt bei `setTimeout` mal RN (`number`), mal `@types/node`
  (`NodeJS.Timeout`) → dutzende `Type 'number' is not assignable to type
  'Timeout'` in Dateien, die niemand angefasst hat. Das ist kein Laufzeitdefekt
  (beide Handles funktionieren, `clearTimeout` nimmt beide) und darf nicht als
  eigene Regression missverstanden werden.
- **jest ist das belastbare Gate** in diesem Repo, nicht tsc.

## `MobileAds` ist eine FACTORY, keine Modul-Instanz

`import { default: MobileAds } from 'react-native-google-mobile-ads'` liefert
eine **Funktion**. Alle Methoden (`setRequestConfiguration`, `initialize`, …)
hängen an dem, was `MobileAds()` zurückgibt. Ein Feature-Check auf
`MobileAds.setRequestConfiguration` ist darum IMMER `undefined` — und weil ein
solcher Block typischerweise in `if (…)` steht und nichts wirft, scheitert er
**lautlos**. Genau so lief der `maxAdContentRating: 'PG'`-Block monatelang nie.
Richtig: `const ads = MobileAds(); await ads.setRequestConfiguration({…})`.
Merker: im selben File steht `await MobileAds()` — wo der Default-Export
aufgerufen wird, ist er keine Instanz. Bei „Konfiguration wirkt nicht" immer
erst prüfen, ob der Guard überhaupt true werden KANN, und einen `else`-Zweig
mit Warnung einziehen, damit der Ausfall sichtbar wird.

## Substring-Matching auf kurzen Stämmen ist bei deutschen Komposita eine Falle

`text.includes('creme')` trifft „Schokoladen**creme**s", „Eis**creme**",
„Frischkäse**creme**"; `includes('deo')` trifft „Ro**deo**"; `includes('pasta')`
trifft „Zahn**pasta**". In `domainFromFreeText` (`lib/utils/productTaxonomy.ts`)
hat das Lebensmittel als Drogerie klassifiziert → der Alternativen-Guard warf
passende Vorschläge weg und ließ Drogerie-Artikel durch.

Substring-Matching ist hier trotzdem richtig (Komposita wie
„Vollwaschmittel" scheitern an Wortgrenzen). Der Preis: **kurze/mehrdeutige
Stämme dürfen nicht nackt in der Liste stehen**, nur als eindeutiges Kompositum
(`handcreme`, `zahncreme`, `deodorant`). Zusätzlich zwei Klassen trennen:
*exklusive* Marker (nie Lebensmittel → entscheiden sofort) und *mehrdeutige*
(`haushalt` in „Haushaltszucker") — treffen beide Welten zu, ist `null` die
richtige Antwort, weil `null` fail-open ist und eine falsch geratene Domäne
legitime Alternativen verwirft.

## Other notes

- TypeScript strict; `tsc --noEmit -p tsconfig.json` is the
  pre-deploy gate.
- Firebase project: `markendetektive-895f7`. Cloud Functions deploy
  via Node 22 (`nvm use 22`), CLI `firebase-tools` ≥ 15.15.
- Firestore rules: aggregates doc path is `aggregates/leaderboard_v1`,
  `allow read: if true; allow write: if false`. Write is admin-only
  (Cloud Function).

## Firestore Security Rules — WHITELIST, getestet (Stufe 0, 86cahgwmn)

`firestore.rules` wurde 2026-07 komplett neu geschrieben (vorher organisch
gewachsen + in kritischen Teilen offen). **Regeln:**
- **WHITELIST-Prinzip:** finaler `match /{document=**} { allow read, write: if
  false }` — jede Collection braucht einen bewussten Eintrag. Neue Collection =
  neuer Rules-Block, sonst gesperrt.
- **GENAU EIN `/users/{userId}`-Block.** NIE einen zweiten anlegen — Firestore
  unioniert (OR) alle zutreffenden match-Blöcke, der lockerste gewinnt → jede
  Validierung im strengeren Block wird toter Code. (Genau das war der alte Bug:
  5 überlappende /users-Blöcke + ein Blanket-Subcollection-Write hebelten die
  Ledger/Geld-Validierung aus.)
- **GELD ist server-only.** `cashback_balance_cents`/`_lifetime_cents`/
  `cashback_monthly`/`cashback_campaign_*`/`cashback_last_bon_date` sind per
  `touchesMoneyFields`-Whitelist vom User-Doc-Update ausgenommen;
  `users/*/cashback_ledger` + `purchased_products` write:false. Punkte
  (`users/*/ledger`) sind client-append-only + shape-validiert (KEIN Geld —
  darum weiter client-schreibbar; NIE Punkte→Geld-Brücke bauen solange das so
  ist). Cloud Functions (Admin-SDK) umgehen Rules → Geld-Writes laufen dort.
- **Öffentlicher Katalog** (produkte/markenProdukte/hersteller*/handelsmarken/
  kategorien/discounter/packungstypen/merchants/external_products/reweapify/
  nutritionscrape/aggregates/achievements/cashback_config/cashback_campaigns/
  polls) = `read: if true` (Boot-Reads laufen teils VOR abgeschlossenem
  Anonymous-Sign-In → kein `auth != null` als read-Gate einbauen, sonst Boot-
  Race), `write: if false`. `produkte/markenProdukte` hatten mal `update: if
  true` (jeder konnte den Katalog defacen) — NIE wieder.
- Owner-only + Owner-Feld-Check: `poll_responses`/`productRatings`/`userfeedback`/
  `pushTokens`/`crowd_uploads` verlangen `request.resource.data.userId (bzw.
  userID) == request.auth.uid`. `leaderboards/{uid}` write nur eigenes Doc.

**Rules-Tests sind PFLICHT vor jedem `deploy --only firestore:rules`:**
`npm run test:rules` (`rules-tests/firestore.rules.test.js`, 31 Tests via
`@firebase/rules-unit-testing` + Firestore-Emulator). Testet BEIDE Richtungen:
Angriffe scheitern (Guthaben-Fälschung, Umfrage-Mint, Rang-Forgery, Katalog-
Defacement, Cross-User-Read, FlutterFlow-Backdoor) UND jeder legitime App-Flow
geht durch. **Emulator braucht Java 21+** — firebase-tools 15.15 lehnt <21 ab;
`openjdk 25` liegt unter `/usr/local/Cellar/openjdk/*/libexec/openjdk.jdk/
Contents/Home` (JAVA_HOME setzen). Beim Ändern der Rules IMMER: (1) Test
anpassen/erweitern, (2) `npm run test:rules` grün, (3) deploy `--only
firestore:rules` (NIE `firestore:indexes` mit-deployen — Indizes separat
verwaltet, siehe Index-Learning oben), (4) Live-Regression (App im Sim durch
Kern-Screens, `permission-denied` im Metro-Log = Regel bricht einen Flow).
Client-Nutzungs-Census (jede erlaubte Op braucht eine echte Callsite) ist die
Grundlage — beim Hinzufügen neuer Client-Reads/Writes die Rules mitziehen.
- Achievements + leaderboards data lives at:
    - `users/{uid}.stats.{pointsTotal, currentLevel, currentStreak, …}`
    - `users/{uid}/ledger/{id}` — per-event point ledger
    - `users/{uid}/purchases/{id}` — purchase history with savings
    - `leaderboards/{uid}` — per-user weekly/monthly counters
    - `aggregates/leaderboard_v1` — nightly pre-built top lists +
      percentile thresholds
    - `gamification/config/levels` — Level catalogue (loaded via
      `achievementService.getAllLevels()`)
    - `achievements/*` — Achievement catalogue

## Geteilte Einkaufszettel — `shared_lists` (Stufe 5, 86cahgwmn)

Wachstums-Feature: Einkaufszettel mit Familie/Freunden teilen, Echtzeit-Sync.
**Bewusst 100% ISOLIERT gebaut** — der persönliche `shopping-list.tsx` (4500
Zeilen) wurde NICHT angefasst. Neue Collection, neue CF-Codebase, neue Screens,
nur additive Touches sonst. „Nichts kaputt machen"-Garantie by design.

**Datenmodell (v2, nach User-Feedback komplett neu geschnitten):**
- `shared_lists/{listId}` = `{ ownerId, ownerName, name, memberIds: string[],
  memberNames: {uid→name}, inviteCode, inviteExpiresAt, createdAt, updatedAt }`.
  `memberIds` ist das Autorisierungs-Feld (`array-contains` Query + Rules-Gate).
- `shared_lists/{listId}/items/{itemId}` = **EXAKT das Einkaufswagen-Doc-Schema**
  (`markenProdukt`/`handelsmarkenProdukt` als DocumentReference, `customItem`,
  `gekauft`, `name`, `anzahl`, `timestamp` — plus `addedBy`/`addedByName`).
  Det-IDs (`brand_<id>`/`noname_<id>`) bleiben erhalten. NIEMALS wieder ein
  eigenes Item-Schema erfinden — das v1-Schema (`{name, kind, purchased…}`)
  erzwang einen separaten Simpel-Screen und wurde vom User zu Recht zerlegt
  („muss 1:1 sein"). Ein Legacy-Fallback rendert v1-Items als Freitext.
- **Warum `memberNames`/`addedByName` denormalisiert:** fremde `users/*`-Profile
  sind per Rules owner-only → Clients können Namen anderer Mitglieder NICHT
  direkt lesen. Namen wandern darum als Map aufs List-Doc + pro Item.

**Firestore-Rules (`shared_lists`-Block, VOR dem finalen deny-all):**
- read: `signedIn() && uid in resource.data.memberIds`.
- create: nur Owner mit `memberIds.size()==1 && memberIds[0]==uid` (man kann sich
  nicht selbst in eine Liste mit Fremden schreiben).
- update: `ownerId` unverändert + **keine Client-Expansion von `memberIds`**
  (`new.difference(old).size()==0`) + (Owner ODER Self-Leave
  `old.difference(new)==[uid]`). Beitritt läuft NUR server-seitig (CF).
- delete: nur Owner. items-Subcollection: read/write via
  `get(/shared_lists/$(listId)).data.memberIds`.
- Rules-Tests: 15 zusätzliche in `rules-tests/firestore.rules.test.js`
  (Gesamt 46), beide Richtungen (Expansion-Angriff scheitert, legit Flows gehen).

**Beitritt = Cloud Function (server-only, kein Client-Write auf memberIds):**
- `cloud-functions/shared-lists/index.js` → `joinSharedList` (v2 onCall,
  europe-west3, MAX_MEMBERS=6). Prüft Auth, **lehnt anonyme User ab**
  (`sign_in_provider==='anonymous'`), findet Liste per `inviteCode`, Transaktion:
  Ablauf (48h) + Kapazität + Idempotenz, dann `memberIds.concat([uid])` +
  `memberNames[uid]`.
- Client ruft die Callable per **`fetch`** (kein `@react-native-firebase/
  functions` installiert → kein nativer Rebuild nötig): POST an
  `https://europe-west3-…/joinSharedList`, Body `{"data":{inviteCode,displayName}}`,
  `Authorization: Bearer <idToken>`. Siehe `sharedListService.joinViaCode`.

**Vollintegration im Einkaufszettel (KEINE eigenen Screens):** Die geteilte
Liste IST der Einkaufszettel — `shopping-list.tsx` schaltet per
`activeSharedListId` die Datenquelle um (kompakte Chips-Zeile oben:
`Meine Liste | <Name> 👥N [🛒N ⚙ wenn aktiv]`; aktiver Chip nochmal =
Verwaltungs-Sheet). Gleiche Pipeline, gleiche Cards, gleiche Handler: alle 9
Cart-Methoden im `FirestoreService` haben einen optionalen `sharedListId`/
`cartTarget`-Param (Helper `cartDocRef`/`cartCollectionRef`; Default =
personal, externe Aufrufer unverändert). Live-Sync via onSnapshot-Trigger +
debounced Reload. Attribution „· von X" rendert in den Cards nur, wenn das
Feld existiert (= shared). `app/shared-list/[id].tsx` + `app/shared-lists.tsx`
wurden GELÖSCHT — nicht wieder anlegen. `app/join-list/[code].tsx` (Deep-Link-
Ziel) routet nach Join zu `/shopping-list?list=<id>`.
`components/ui/SharedListManageSheet.tsx` = Einladen (QR/Link) + Mitglieder +
Verlassen. Race-Schutz im Screen: Epoch-Guard in `loadShoppingCart` (out-of-
order Loads), Refs für späte Callbacks (Outbox-Flush, Retry/Revert),
Chip-Tap-Guard (aktiver Chip ≠ initialLoading).

**Client-Service:** `lib/services/sharedListService.ts` — `createSharedList
(name, seedDocs, ownerName)` (Seeds = Cart-Doc-Payloads 1:1, det-IDs via
setDoc), `subscribeMySharedLists`, `subscribeSharedList`,
`subscribeSharedListItemsTrigger` (nur Change-Signal, Laden macht die Cart-
Pipeline), `leaveList`/`removeMember`, `rename`, `rotateInvite`,
`inviteLinkFor`, `joinViaCode`. Item-CRUD läuft NICHT hier, sondern über die
FirestoreService-Cart-Methoden (cartTarget).

**Einladungs-Links sind HTTPS, NIE das Custom-Scheme:** die iOS-Kamera öffnet
`markendetektive://…` aus QR-Codes NICHT („Keine nutzbaren Daten gefunden" —
kostete einen User-Report). `inviteLinkFor` →
`https://markendetektive-895f7.web.app/join-list/<code>`; `public-web/join.html`
(Firebase Hosting, Default-Site, Rewrite `/join-list/**`) leitet aufs
App-Scheme weiter (iOS Auto-Versuch + Button, Android `intent://` mit
Play-Fallback, Store-Links). Deploy: `firebase deploy --only
hosting:markendetektive-895f7` — die Admin-Site `md-receipt-admin` NICHT
anfassen. QR = `react-native-qrcode-svg` (rein JS auf react-native-svg, kein
native Rebuild; lokal generiert, immer weißer Grund + dunkle Module).

**App-weit „aktuelle Liste" (`lib/services/activeListService.ts`):** Die im
Einkaufszettel gewählte Liste ist DAS Add-Ziel für die ganze App (persistiert
in `active_cart_list_v1`; Key wird NUR vom Service geschrieben). Produktseiten
(noname-detail, product-comparison), Favorites-Bulk-Add und der Cart-Badge-Hook
(`useShoppingCartCount`) lesen/abonnieren den Service — Adds, Mengen-Pills und
Counter folgen also der aktiven Liste. Lazy Session-Validierung gegen
`memberIds` (entfernte User → Fallback persönlicher Zettel). Beim Hinzufügen
NEUER Cart-Callsites: `ActiveListService.getCartTarget(displayName)` ans
`cartTarget` der FirestoreService-Methode reichen + Status-Reads mit
`(await ActiveListService.getActiveList())?.listId` — sonst landet der Add
im falschen Zettel.

**Produktentscheidung (User 2026-07-02):** Abhaken in geteilten Listen vergibt
Punkte/Ersparnis/Kaufhistorie an den ABHAKENDEN (identisch zum eigenen Zettel —
„wer kauft, kriegt den Kauf"), und ALLE Aktionen (add/+1, purchase, remove,
convert, custom) tracken in die User-Journey des jeweils AUSFÜHRENDEN Mitglieds
(Journeys sind architektonisch immer user-eigen, kein Listen-Scope).
**journeyId/viewedProductIndex werden bei geteilten Listen NIE ins Item-Doc
geschrieben** (Write-Gates in addToShoppingCart/convertToNoName) und beim Lesen
ignoriert (Read-Gates in markAsPurchased/removeFromShoppingCart) — eine fremde
journeyId im Doc führte sonst zum Silent-Drop des Events beim Specific-Flush
(users/{ich}/journeys kennt die Journey des anderen Mitglieds nicht, kein
Fallback) und jedes +1 überschrieb die ID. Ohne journeyId greift überall der
saubere Fallback in die aktive Journey des Ausführenden.

**Deploy-Status: BEIDE Prod-Deploys sind LIVE (2026-07-02).**
1. `firebase deploy --only firestore:rules` ✅ (Erstellen/Lesen im Sim bewiesen).
2. `firebase deploy --only functions:shared-lists` ✅ — Achtung Learning: der
   Deploy braucht `npm install` IM CF-Ordner (sonst „Couldn't find
   firebase-functions package" beim Analyse-Schritt). Lockfile ist committet.
E2E verifiziert: Unauth-Call → 401 UNAUTHENTICATED; Join-Deep-Link mit echtem
Token → CF-Lookup per inviteCode → idempotent (alreadyMember) → App landet in
der Liste. Sollte je eine neue CF-Codebase dazukommen: gleiche Checkliste
(npm install im Ordner, Rules-Tests grün, dann deploy).

## Apple-Sign-In im SIMULATOR testen (Sim-Build-Saga 2026-06-11)

Vier Fallen in Serie, jede hat einen Build/eine Stunde gekostet:
1. **`expo run:ios` baut Sim-Targets mit deaktiviertem Code-Signing**
   → CODE_SIGN_ENTITLEMENTS wird ignoriert, Apple-Login wirft
   `AuthorizationError 1000`. Fuer einen Sim-Build MIT Entitlements:
   `xcodebuild -workspace ios/MarkenDetektive.xcworkspace -scheme
   MarkenDetektive -configuration Debug -sdk iphonesimulator
   CODE_SIGNING_ALLOWED=YES CODE_SIGN_IDENTITY=- build`
   (gleiches DerivedData via -derivedDataPath = inkrementell).
2. **Nachsignieren des fertigen .app (codesign --force [--deep] --sign -
   --entitlements …) macht die App UNSTARTBAR** (SBMainWorkspace
   denied) — nicht versuchen, immer neu bauen.
3. **Entitlements-Pruefung bei SIM-Builds NICHT via
   `codesign -d --entitlements`** (zeigt leeres Dict!) — massgeblich
   ist die Binary-Sektion: `xcrun otool -s __TEXT __entitlements
   App.app/Binary` (XML-Hexdump; applesignin muss drin sein).
4. **nohup-Builds brauchen `env LANG=en_US.UTF-8`** — sonst crasht
   CocoaPods an den Umlauten in den Podfile-Kommentaren
   ("Unicode Normalization not appropriate for ASCII-8BIT").
Ausserdem: lokale Pod-Checkouts sind teils read-only — der
fmt-Patch-Hook chmod't deshalb vor dem Write (ios/Podfile).
Und selbst mit allem: Apple-Login im Sim braucht eine in den
Sim-Settings eingeloggte Apple-ID und bleibt wackliger als auf
dem Device — finaler Test gehoert auf TestFlight.

## iOS Dev-Client aufs PHYSISCHE iPhone (install + launch + Metro)

Lokale JS-Tests → Metro (siehe oben). Wenn die App auf dem physischen
iPhone NICHT installiert ist ODER ein NATIVE/Swift/Pod-Change getestet
werden muss (mehrfach durchexerziert, sonst 1 h verloren):
1. Device: `xcrun devicectl list devices` → UUID. Bundle-ID
   `de.markendetektive` (Dev + Prod teilen sie → nur EINE gleichzeitig
   installierbar; ein TestFlight-Build überschreibt den Dev-Client).
2. Bauen+installieren (NUR bei Native-Change; JS reicht Metro):
   `npx expo run:ios --device <udid> --configuration Debug`. Build klappt
   meist, aber **Expos Install-Schritt flaket oft mit „Error: null"** →
   dann manuell: `xcrun devicectl device install app --device <id>
   ~/Library/Developer/Xcode/DerivedData/MarkenDetektive-*/Build/Products/Debug-iphoneos/MarkenDetektive.app`.
3. App MIT Metro-Verbindung starten (Dev-Client-Deep-Link):
   `xcrun devicectl device process launch --terminate-existing --device <id>
   --payload-url "markendetektive://expo-development-client/?url=http://<LAN-IP>:8081" de.markendetektive`.
   Scheme: seit Juni 2026 sind BEIDE registriert — `app.json` hat
   `"scheme": ["markendetektive", "markendetektivern"]`. `markendetektive` ist
   der saubere (passt zu slug + bundle `de.markendetektive`); `markendetektivern`
   (mit n, Altlast aus dem RN-Rewrite) bleibt nur für Backward-Compat. Neuer
   Dev-Launch nutzt `markendetektive://…`; der alte rn-Scheme geht weiter.
   Beides greift erst nach einem nativen Rebuild (Scheme → Info.plist /
   AndroidManifest beim Prebuild). LAN-IP via `ipconfig getifaddr en0`.
   **iPhone muss ENTSPERRT sein** (sonst „device was not unlocked").
4. Fehler „[runtime not ready]: Exception in HostFunction … EXDevMenuApp"
   = Dev-Client-Hänger (oft nach Fast-Refresh / Metro mit `--clear` mitten
   im Rebuild), KEIN Bundle-Fehler. Fix: Metro warm neu starten + Launch
   aus Schritt 3 (terminate-existing).
5. JS hot-reloadet über den verbundenen Dev-Client; nur Native (`modules/*`,
   Pods, Info.plist) braucht den Rebuild.

## Admin-SDK / Firestore lokal + CF-Deploy

- Firestore-Admin lokal: **ADC des Nutzerkontos reicht** — `admin.initializeApp
  ({ projectId: 'markendetektive-895f7' })` ohne `GOOGLE_APPLICATION_CREDENTIALS`
  greift auf `~/.config/gcloud/application_default_credentials.json` zu. Das
  früher genutzte `/tmp/sa.json` liegt in `/tmp` und wird von macOS aufgeräumt —
  ist regelmäßig weg; nicht darauf aufbauen, sondern ADC nehmen (Service-Account-
  Datei nur, wenn ein Skript Rechte braucht, die das Nutzerkonto nicht hat). Skripte aus einem CF-Ordner MIT `firebase-admin` laufen lassen
  (z.B. `cloud-functions/preference-profile-cf`), `node --check` vorher.
  Die Play-Store-SA `markendetektive-895f7-ee3923910ddd.json` hat KEINE
  Firestore-Rechte.
- CF-Deploy (Node 22, firebase-tools ≥15.15):
  `PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH" npx firebase-tools@15.15.0
  deploy --only "functions:<codebase>" --project markendetektive-895f7 --non-interactive`.
  Bei kombiniertem Multi-Codebase-Deploy flaket Gen1 reproduzierbar beim
  Cold-Load („Function … is not defined") → einzelne Codebase solo redeployen
  geht durch.
- Gemini: Secret `GEMINI_API_KEY` + `@google/genai`, Modell
  `gemini-3.5-flash`, Setup in `cloud-functions/ai-product-comparison`
  (wiederverwendbar). Key lesen: `firebase-tools functions:secrets:access`.

## Cashback Go-Live / Tremendous PRODUCTION (86caf62v6)

Scharfgeschaltet 2026-06-28. **PRODUCTION ist der fail-safe Code-Default**
(`index.js`: `TREMENDOUS_SANDBOX = process.env.TREMENDOUS_ENV === 'sandbox'`;
`TREMENDOUS_BASE` = Sandbox NUR bei diesem expliziten Opt-in, sonst
`api.tremendous.com`). Die `.env` MUSS Production NICHT erzwingen — ein Redeploy
aus einem Clean-Checkout, eine fehlende/vertippte Variable, eine fehlende `.env`
landen ALLE sicher auf Production.

(Frühere Falle, an der Wurzel behoben — Commit R3: davor wählte der Code Live
nur bei `TREMENDOUS_ENV==='production'`; da das env in der gitignorierten `.env`
lebte, wäre ein Clean-Redeploy still auf Sandbox gefallen und hätte echte
Auszahlungen gebrochen. Default invertiert → kein „dran-denken" mehr nötig.)

- **Sandbox (nur lokal/Test):** explizit `TREMENDOUS_ENV=sandbox` in
  `cashback-pipeline/.env` + Sandbox-Campaign `I0UO36DNEAU2`. Zurück auf Prod =
  die Zeile wieder entfernen (Default greift).
- **Welche Base eine deployte Function nutzt prüfen** (kein Geld): `gcloud
  functions describe processPayout --region=europe-west3 --gen2 --project=
  markendetektive-895f7 --format="yaml(serviceConfig.environmentVariables)"
  | grep -i tremendous` → fehlt `TREMENDOUS_ENV` ODER ≠ 'sandbox' = Production.
- Secrets liegen korrekt in Secret Manager (PROD): `TREMENDOUS_API_KEY`
  (Prefix `PROD_`), `TREMENDOUS_WEBHOOK_SECRET` (20 Zeichen), Admin-Resolver-Key
  = `NUTRITION_SCRAPER_TRIGGER_KEY`. Deploy bindet die LATEST-Version → ein
  Redeploy aktiviert sie. Prefix/Länge prüfen ohne Leak via `gcloud secrets
  versions access latest --secret=… | cut -c1-5` bzw. `… | wc -c`.
- Read-only PROD-Smoke (kein Geld): `GET api.tremendous.com/api/v2/
  funding_sources` (Auth + Balance) + `/campaigns` (Campaign existiert). Ein
  ECHTER Test-Payout bewegt echtes Geld → nur mit User-OK (Betrag+Empfänger).
- **Tremendous-MINDESTBETRAG = €1.** Die Campaign `FPJPQK8WTF8O`-Produkte haben
  alle min ≥ €1 (Bank Transfer/PayPal/Amazon/Visa/Google Play = €1, Apple €2,
  Penny/Kaufland/Lieferando €5). Eine Order < €1 failt mit `"Amount €X EUR does
  not meet the minimum for available products"` (HTTP 400, validation failure)
  → unser `processPayout` bucht das Guthaben sauber zurück (Refund-Pfad
  bewiesen). Konsequenz: `payoutThresholdCents` NIE < 100 setzen (sonst kann der
  User einen Betrag wählen, der garantiert an Tremendous scheitert). Beim
  Test-Setup also Schwelle ≥ 100c + Betrag ≥ €1 (und ≤ Tremendous-Funding-Balance).

## IP-Ortung (`journeyLocation.city`) ist der Netzzugang, NICHT der Aufenthaltsort

Auf `crowd_uploads` (und in jeder Journey) steht neben der Selbstauskunft
`userLocation` auch `journeyLocation` aus `anonymousLocationService` — IP-basiert
über ipapi.co. **Das Stadtfeld beantwortet NICHT „wo war der Nutzer".**

Gemessen am Backfill vom 11.08.2026 (292 Einreichungen, 127 Nutzer):
- Von 64 Einreichungen mit Selbstauskunft UND IP-Stadt stimmte **keine einzige**
  überein (0/64). Bei einem echten Ortsbezug wären 40–70 % zu erwarten.
- 7 Nutzer „sprangen" >100 km, Spitzenwert 651 km; einer 479 km
  (Aachen/Erfurt/Dachau) **in 28 Stunden** — physisch nicht plausibel.
- Das Muster ist eindeutig Mobilfunk-Gateway: ländliche Selbstauskunft →
  Berlin/München/Frankfurt/Wien.

**Harte Ground Truth (EXIF-GPS, 4 Dokumente, 11.08.2026):** ein Vollscan über alle
2.086 Bilder fand 10 mit GPS-IFD in 4 Dokumenten. Gegen diese echten Aufnahmeorte
liegt die IP-Position **61,7 / 61,7 / 99,5 / 377,2 km** daneben. Auf LANDESEBENE
stimmte sie in 4 von 4 Fällen — mehr darf daraus nicht abgeleitet werden.

**KORREKTUR (11.08.2026): das Feld taugt auch NICHT als Regionsschlüssel.**
Hier stand vorher „115 von 127 Nutzern haben durchgehend dieselbe IP-Stadt".
Diese Zahl war ein Artefakt — sie betrachtete NUR die zu den Uploads gematchten
Journeys. Über den VOLLEN Journey-Verlauf gemessen haben nur **41 von 132**
Einreichern genau eine Stadt; 90 haben mehrere (bis zu 25), und bei Nutzern mit
≥3 IP-Journeys liegt der Anteil der häufigsten Stadt im **Median bei 55 %**
(p25 38 %, p75 75 %). Nur 11,8 % haben eine 100-%-Stadt. Wer auf der alten
Annahme ein Kohorten- oder Konfidenzmodell baut, kalibriert es falsch.
**Verwertbar ist die IP-Ortung ausschließlich auf Landesebene.**

Regeln beim Auswerten:
- `source: 'fallback'` immer ausschließen — das ist der DACH-Mittelpunkt
  (51.15/10.45), eingetragen wenn die IP-Abfrage scheiterte, kein Ort.
- `lat`/`lon` sind auf ~5 km gerundet (`Math.round(wert * 20) / 20`),
  `geohash5` = `lat_lon` derselben Werte. Rasterpunkte, keine Koordinaten.
- Nachgetragene Werte tragen `journeyLocationMatch` (Zuordnung über die Zeit,
  nächste Journey vor dem Upload, Fenster 6 h, `deltaMinutes` je Dokument).
  Der Vorwärtspfad hat das Feld NICHT — dort stammt die Location direkt aus der
  laufenden Journey. Wer Aufnahme-Beobachtung von Rekonstruktion trennen will,
  filtert auf das Vorhandensein dieses Felds.

## Journeys werden NICHT gelöscht — endgültige User-Entscheidung (17.08.2026)

User-Wortlaut: "journeys löschen wir nicht - fertig." Keine Retention-Regel,
kein Cleanup-Löschen, keine Vorschläge mehr in diese Richtung. Kostensenkung
bei Journeys läuft ausschließlich über LESE-Optimierung (Zeitfenster/
Inkremente in den Nacht-Aggregatoren), nie über Datenlöschung.

## Cloud-Kosten: Konto-Realität (abgelesen 16.08.2026, Billing-Console)

Bei Kostenfragen NIE aus Monitoring-Metriken hochrechnen, ohne diese Fakten:
- **Billing-Konto `010830-229407-74D273` (StuByteFlexCo) trägt 8+ Projekte.**
  Konto-Summen (z.B. "1.160 € in 15 Tagen") sind NICHT MarkenDetektive —
  Aug 1.–15.: RevealyIQ-Familie ~740 €, MrToots 258 €, MarkenDetektive 186 €.
- **Netto zahlt das Konto derzeit ~0 €**: Google-for-Startups-Guthaben
  (20.017 $ von 23.000 $ übrig, bis 27.06.2028) + 855 € GenAI-Trial decken
  alles. Bei ~2.400 €/Monat Brutto-Burn ist das Guthaben ~Frühjahr 2027 leer —
  DAS ist die relevante Uhr, nicht die Monatsrechnung.
- **Gemini läuft seit 19.08.2026 über VERTEX AI** (siehe Incident-Abschnitt
  unten) — Kosten erscheinen im eigenen Projekt als Dienst "Vertex AI",
  guthabengedeckt, ohne AI-Studio-Stufendeckel. Historie: 16.–19.08. lief es
  auf eigenem AI-Studio-Key (Secret-Version 2, Fingerprint 84151aee2f6f; am
  19.08. disabled, Version 3 = alter Key als Zwischen-Rollback angelegt —
  beide Keys sind bei erreichtem Konto-Cap gleichermaßen tot). Merke:
  Functions pinnen die beim Deploy neueste ENABLED-Version — eine neue
  Secret-Version wirkt NIE ohne Redeploy.
- **Firestore-Reads firmieren in der Rechnung unter Dienst "App Engine"**
  (SKU "Cloud Firestore Read Ops"). MarkenDetektive Aug-Tempo: ~190 €/Monat —
  größter eigener Serverposten; enthält die nächtlichen 4-Mio-Dokument-Reads
  der Backup-Extension, die in der Firebase-Nutzungsanzeige UNSICHTBAR sind.
- MarkenDetektive real: ~380 €/Monat Infrastruktur + ~517 €/Monat Gemini
  (Aug-Tempo; Gemini hat sich seit Juli verdoppelt, wächst mit Bon-Volumen).

## Kampagnen laufen still aus — Nachfolger ist Pflicht VOR dem Monatsende

**Vorfall 01.09.2026:** Alle Cashback-Kampagnen endeten am 31.08. (endAt),
drei blieben auf `active: true` stehen, niemand legte einen Nachfolger an.
Folge in 2 Tagen: 157 Bons, davon 119 `no_reward (no_active_campaign)`; bei
Produktfotos fand der Client keine Aktion mehr → 33 Uploads mit
`campaignId: null`, die bei Freigabe NIE vergütet worden wären (der Trigger
crowd-upload-reward bricht ohne campaignId nur mit logger.info ab — kein
`rewardSkipped`, nichts fällt auf). Erst die Backlog-Analyse fand es.

Regeln:
- Kampagnen-Zeitraum ist die WAHRHEIT (Pipeline UND Client filtern auf
  `active && startAt <= now <= endAt`); `active:false` beim Auslaufen setzen
  ist Hygiene, ersetzt aber keinen Nachfolger.
- Vor jedem Monatsende: Nachfolge-Kampagne(n) je `kind` (receipt,
  product_photos) anlegen — Felder 1:1 klonen, Budget = Restbudget des
  Vorgängers, `startAt` = endAt des Vorgängers. Skript-Muster: 02.09.2026
  (`september-2026`, `produkt-fotos-september-2026`).
- Prüf-Signal, das nie fehlen darf: Anteil `no_active_campaign` unter den
  Bons der letzten 24 h. Steigt er sprunghaft → Kampagne fehlt.
- Uploads, die im Loch eingingen, per `campaignId`-Backfill dem Nachfolger
  zuordnen (Zeitraum des Nachfolgers dafür rückdatieren).

## Produktentscheidungen 05.09.2026 (endgültig, nicht neu aufmachen)

- **Bon-Alter: 7 Tage.** `MAX_BON_AGE_DAYS = 7` ist die Wahrheit, Kampagnen-
  `maxAgeDays` darf großzügiger sein. Die App zeigt die Zahl aus dem Mirror.
- **Orts-Pflicht im Produktfoto-Wizard bleibt.** Nicht lockern; der Fallback
  (Orts-Schritt bei ausbleibendem GPS-Fix, ec63e08) nimmt die Reibung, das
  Gate `crowd-upload-reward/src/locationGate.js` bleibt scharf.
- **Algolia bleibt** (86c9jqmja rejected). Synonyme werden gepflegt, keine
  Ablöse-Diskussion mehr.
- **Bons: Einkaufsort = Filialadresse vom Bon-Kopf**, nicht Gerätestandort.
  OCR-Prompt v1.4 liefert `storeAddress {street, zip, city}`; für den Bestand
  parst `lib/storeAddress.js` die seit v1.0 mitgelieferte `merchantSubtitle`
  (6.044/6.193 Bons haben sie). Landet in `receipts.store`, Mirror
  `storeCity/storeZip`, `purchased_products.storeZip/storeCity/storeStreet`.
  Der Consent-Text + der iOS-Purpose-String sagen je Verdien-Weg, was
  „Standort" konkret ist (Bons: Filialadresse vom Bon; Fotos: Aufnahmeort);
  consentVersion NICHT gebumpt (Wortlaut-Präzisierung, keine neue Daten-
  kategorie). Präzise: bei Bons fließt kein GPS in den Datensatz, die IP-
  Journey-Ortung (~5-km-Raster) bleibt als `receipts.journey.location`.
  **Anwalt (Doc-Änderungen, kein Code):** Datenschutzerklärung sagt „kein
  GPS-Zugriff" (Produktfotos speichern präzises GPS, Freigabe ist Bedingung)
  und zählt die Bon-Daten ohne Filialadresse auf — beides nachziehen.
- **Die 51 auffälligen Foto-Einreichungen vom 29.08. werden NICHT gesichtet**
  (User-Entscheidung; alle bereits vergütet).

## `ocr_confidence_low` staut Bons — und sagt nichts über die Prämie (07.09.2026)

Am 07.09. lagen ALLE 23 offenen Review-Bons auf demselben Grund
`ocr_confidence_low`, jeder mit sauberer Rekonziliation (Σ Positionen = Endsumme),
bekanntem Markt und gültigem Bon-Datum (0–6 Tage). Das ist kein Zufall: die
Robust-OCR verlangt Übereinstimmung auf SEQUENZ-Ebene (`name#priceCents`) über
unabhängige Lesungen — bei 30–70 Positionen kippt eine einzige abweichend
gelesene Artikelbezeichnung die Confidence auf `low`, obwohl kein für Geld
relevanter Wert wackelt.

Wichtig für jede Review-Entscheidung: die Prämie hängt an Markt, Bon-Datum,
Endsumme und der Zahl anrechenbarer Artikel — NICHT an der Schreibweise
einzelner Artikelnamen (die fließen ins Matching, nicht ins Ledger). Ein Bon mit
`confidence: low`, aber `reconciliation.ok`, bekanntem Markt und Datum im Fenster
ist freizugeben. Beim Nachprüfen eine unabhängige Zweitlesung des Bildes machen
(Markt / Datum / Endsumme / ist es überhaupt ein Bon / Manipulationsspuren) und
NUR bei Widerspruch in diesen vier Punkten ablehnen — nicht wegen der Confidence
selbst. Skript-Muster: `cloud-functions/cashback-pipeline/.pruefe-bons.js`
(schreibt nichts, urteilt nur).

Offen (Follow-up): das Review-Gate erzeugt so einen Dauerstau, den nur jemand
von Hand auflöst. Sinnvolle Verschärfung wäre, `low` nur dann in Review zu
schicken, wenn zusätzlich ein für Geld relevantes Feld unsicher ist
(Markt unbekannt, Datum fehlt, Rekonziliation schief) — sonst durchlaufen lassen.

## Zweitprüfung unsicherer Bons + Warenkorb-Rabatt + Rossmann (14.09.2026)

User-Vorgabe (86cbfvwge): „ein fetteres Model drüber lassen, das dann entscheiden
kann. Wenn das auch nicht entscheiden kann, dann wird erst abgelehnt."

**Wie es läuft** (`lib/refereePolicy.js` Regeln, `lib/ocr_referee.js` Aufruf,
`lib/prompt_referee.js` Prompt, index.js Schritte 3b/6v/6y2):
- Würde ein Bon mit Robust-Bewertung `none`/`low` wegen `reconciliation_delta`,
  `no_bon_date`, `not_a_receipt`, `unknown_merchant` oder `bon_too_old` abgelehnt,
  fordert Durchlauf 1 die Prüfung an (`ocr.refereeRequest`) und stellt neu zu.
  Durchlauf 2 (Cache-Pfad, eigene 540 s) nimmt sie per Transaktion in Anspruch
  (`claimedBy` = Event-ID, Tagesdeckel `ocrRefereeMaxPerDay`, Zähler
  `cashback_referee_usage/{Tag}`), liest bis zu 4× mit `gemini-3.1-pro-preview`
  und ersetzt die Lesung nur bei zwei übereinstimmenden, in sich stimmigen,
  vollständigen Lesungen. Danach laufen ALLE Gates normal.
- Schalter `cashback_config/v1.ocrReferee`: false | 'shadow' | true (Default aus).
- **Eine Entscheidung heißt „nicht abgelehnt", nicht „ausgezahlt"**: sie zählt im
  Gate 6w als `medium` (Feld-Gate über die Zeugen der Prüfung). Mit
  `ocrFieldGate: 'shadow'` landet sie in der Prüfkonsole, mit `true` wird sie
  automatisch freigegeben. NICHT auf `high` setzen — zwei Lesungen desselben
  Modells sind korreliert, und sonst würden die schwächsten Erstlesungen am
  wenigsten geprüft (Review 14.09.).
- Ausgelassen (Regeln aus den Live-Daten): Markt auf allen Lesungen gleich
  (Katalogfrage, z. B. Rossmann), Datum auf allen Lesungen gleich oder keins in
  der Frist, not_a_receipt ohne Markt UND Datum.

**Gemessen** (Live-Test an 13+6 echten Ablehnungen, nur lesend):
- Alle 3 Netto-Bons mit Warenkorb-Rabatt/App-Gutschein entschieden — die OCR war
  dort RICHTIG, nur `reconcile()` kannte keine Rabatte auf den ganzen Einkauf
  (18 von 44 recon-`none`-Ablehnungen seit 01.09.).
- Abgeschnittene/verdeckte/zerknitterte Fotos: kein Modell rettet sie; das Modell
  meldet sie per `bonComplete: false` selbst → abgelehnt, wie gewollt.
- ~10–65 s pro Bon, ~0,02–0,05 $ pro Lesung, ~3 von 30 Aufrufen 429.

**Teure Fallen, nicht wieder hineinlaufen:**
- `gemini-3.1-pro-preview` ignoriert `thinkingBudget` (Denken bis MAX_TOKENS,
  ~195 s, kein Ergebnis) → `thinkingConfig: { thinkingLevel: 'LOW' }`. Nur unter
  Location `global` erreichbar; 429 und 404 → Rückfall `gemini-2.5-pro`.
  Google empfiehlt für Gemini 3 Temperatur 1.0 (niedriger → Schleifen).
- Keinen Ablehngrund und kein Upload-Datum in den Prompt: „Datum lag vor dem
  Upload" + Upload-Datum lädt ein, ein passendes Datum zu „finden"; „Summe passte
  nicht" lädt zu einer erfundenen Rabattzeile ein. Außerdem prüft `plausibel()`
  jede Lesung gegen die Erstlesungen (Endsumme bekannt, bei Rabatt nicht mehr
  Artikel, bei bon_too_old nur ein schon gelesenes Datum).
- Warenkorb-Rabatt in `reconcile()` nur mit Belegkette: Σ Artikel = gedruckte
  Zwischensumme, Zwischensumme − benannte Rabattzeilen = Endbetrag (±2 ct),
  Rabatt < 25 % und ≤ 20 €. Ohne diese Grenzen besteht eine Lesung, die jeden
  Artikel doppelt führt und die Differenz als „Rabatt" ausweist.
- `buildOcrField` ist eine Whitelist und der Final-Write ersetzt `ocr` komplett —
  `refereeRequest`/`referee` MÜSSEN dort und in `ocrFromCache` stehen (sonst ist
  die Schleifensperre nach dem ersten Write weg, wie bei `robust` am 02.09.).
- Parallele Läufe (Reprocessing mit geleertem `ocr` + Sweeper) überschreiben das
  `ocr`-Feld ganz: Früh-Persist und Anforderung laufen deshalb über
  `writeOcrIfNoReferee` (Transaktion, bricht ab, wenn schon eine Prüfung
  angefordert/abgelegt ist), und Schritt 6y2 liest vor dem Ledger nach, ob ein
  anderer Lauf übernommen hat. Sonst: parallele bezahlte Prüfungen und im
  schlimmsten Fall ein Storno gegen eine entschiedene Gutschrift.
- Übersprungene Prüfungen (Schalter aus, Tagesdeckel, menschliche Entscheidung)
  legen NICHTS ab — ein gespeichertes „skipped" hätte die Prüfung für immer
  verbraucht. Kam KEINE Lesung zurück (429/Timeout), wird nichts abgelegt und
  mit `referee_unavailable` geworfen (Infra-Code → nach 5 Versuchen `review`,
  nie `rejected`). Das Ergebnis wird transaktional nur mit eigenem Anspruch
  abgelegt (`persistRefereeResult`), sonst überschriebe die zuletzt fertige
  Prüfung die andere.
- `shadow`-Ergebnisse wirken nach dem Umschalten auf `true` NICHT nach (der Bon
  gilt als geprüft). Nicht erst in `shadow` laufen lassen, wenn man die Wirkung
  auf genau diese Bons will.

**`processCashback` hat KEINEN PubSub-Retry** (`retryPolicy:
RETRY_POLICY_DO_NOT_RETRY`, geprüft 14.09. per `gcloud functions describe`).
Die Kommentare „werfen → PubSub-Retry" im catch-Block stimmen nicht: ein Wurf
erhöht nur `attempts` und bleibt liegen. Die EINZIGE Wiederaufnahme ist
`sweepStuckReceipts` (nur Status `ocr_pending`, ≥ 20 min seit Anlage/letztem
Sweep, max. 5×, jedes Mal neue Event-ID). Wer „bei Fehler werfen, der Retry
holt es" plant, muss prüfen, dass der Bon dabei in `ocr_pending` bleibt.

**Rossmann (12487v299kf):** Der Alias stand seit Langem in `lib/merchant.js`, aber
es gab kein `discounter`-Dokument → jeder Rossmann-Bon `unknown_merchant`.
`eligibleMerchants` in `DEFAULT_CONFIG` wird NIRGENDS gelesen (tote Config, nicht
als Wahrheit nehmen). Angelegt: `discounter/8bQNdFStWCnJKy9P1Gey` (DE, Logo
`maerkte/rossmann.png`, Farbe `#EC0000` aus dem Logo). Nebenwirkung: jeder neue
`discounter` erscheint sofort in Stöbern-Marktfilter, MarketSelector und
Onboarding — ohne Produkte mit leerer Liste. Nachverarbeitet per
`.rossmann-nachverarbeitung-1409.js` (199 Bons seit Juli, pro Nutzer sequenziell,
Pipeline entscheidet): 16 gutgeschrieben, 16 Prüfung, 97 ohne Prämie wegen
< 4 Artikeln (Drogerie-Bons sind kurz), 29 Tageslimit, 19 zu alt, 10 Summe,
5 ohne Datum, 4 ohne Aktion, 3 Duplikat.

**Praxistest in Produktion (19.09.2026, Schalter von Patrick auf true).** Drei
echte, zuvor abgelehnte Bons neu zugestellt: zwei Netto-Bons mit Warenkorb-Rabatt
wurden in 24 bzw. 33 s entschieden (3,95 € bzw. 2,00 € Rabatt erkannt, je 8 ct
berechnet) und stehen jetzt in der Prüfkonsole; der abgeschnittene Screenshot
blieb unentschieden und damit abgelehnt. Keine Auszahlung, kein Storno, Zähler
`cashback_referee_usage/2026-09-19` = 3 Läufe, 0 Ausfälle. Wichtig für die
Erwartung: **im Beobachtungs-Modus (`ocrFieldGate: 'shadow'`) macht die
Zweitprüfung aus einer Ablehnung einen Warteschlangen-Eintrag, keine
Auszahlung.** Gemessen am 19.09.: 98 Bons in der Prüfkonsole (7,90 €), davon
würden mit `ocrFieldGate: true` 64 (5,12 €) automatisch freigegeben, 24 blieben
wegen uneiniger Geldfelder, 10 haben keine Einzellesungen.

**`ocrFieldGate` steht seit 19.09.2026 auf `true`** (Entscheidung Patrick). Zwei
Dinge, die man dabei wissen muss:
- **Weder der Schalter noch die Zweitprüfung wirken rückwirkend.** Beide greifen
  nur im laufenden Verarbeitungsdurchlauf. Wer eine Warteschlange auflösen will,
  muss die Bons ERNEUT ZUSTELLEN (`.nachlauf-1909.js`: Status auf `ocr_pending`,
  Spiegel mit, publish, pro Nutzer sequenziell, mehrere Nutzer parallel).
- Gemessen am 19.09. über 134 Bons (103 aus der Warteschlange + 31
  Zweitprüfungs-Kandidaten): 60 freigegeben und gebucht (480 ct), 12 Tageslimit,
  3 als Doppel erkannt, 33 blieben in der Warteschlange. Alle Geld-Invarianten
  sauber (0 Doppelbuchungen, 0 Freigaben ohne Buchung, 0 Buchungen ohne
  Freigabe, 0 Tageslimit-Verstöße, Spiegel überall gleich).
- **Die Zweitprüfung entscheidet selten** — von 31 Kandidaten 3 entschieden
  (1 davon mit Geld), 25 unentschieden, 3 vorher schon als Doppel erkannt. Das
  deckt sich mit der Messung vom 14.09.: der Hebel liegt beim Warenkorb-Rabatt,
  nicht am stärkeren Modell. Verbrauch an dem Tag: 33 Läufe (Deckel 40).
- **Ein Rest bleibt strukturell hängen:** 10 der verbliebenen 33 Bons tragen
  keine Einzellesungen (`ocr.robust.reads` fehlt, Stand vor dem Deploy vom
  09.09.) — das Feld-Gate kann sie nie freigeben. Für sie hilft nur eine frische
  Texterkennung (`ocr`-Feld löschen + republish) oder eine Entscheidung in der
  Prüfkonsole.

**Warteschlange auflösen: über den RESOLVER, nicht über erneutes Zustellen
(19.09.2026).** Am selben Tag beide Wege gefahren und verglichen:
- Erneutes Zustellen (`processCashback`) wendet das Feld-Gate an, setzt aber
  KEIN `backfilled` → der Schutz gegen nachträgliches Abhaken greift nicht.
- Der Resolver (`resolveCashbackReview`, auch der Weg der Prüfkonsole) rechnet
  die Deckel neu, bucht, schreibt die Positionen MIT `backfilled: true`
  (Stichprobe 19.09.: 104 von 104) und pusht. Damit bleibt ein heutiger
  Einkaufszettel unberührt.
Vorgehen, das sich bewährt hat: `.pruefe-bons-*.js` (unabhängige Zweitlesung,
schreibt nichts) → Auffälligkeiten selbst ansehen → `.review-approve-*.js`
(Duplikat- und Tageslimit-Logik wie die Pipeline, Freigabe über den Resolver,
`SKIP_IDS` für von Hand zurückgestellte Fälle). Ergebnis 19.09.: 35 Freigaben,
294 ct, 0 Doppelbuchungen, 0 Freigaben ohne Buchung, Warteschlange von 37 auf 2.

**Zwei Fallen in der Zweitlesung selbst** (beide am 19.09. aufgetreten):
- „manipuliert" trifft sonst jeden eBon und jedes Bildschirmfoto. Die Frage muss
  ausdrücklich sagen: ein digitaler Bon oder ein sauberer Screenshot IST ein
  Kassenbon, Manipulation heißt sichtbare Bearbeitungsspuren. Vorher: 4 von 37
  falsch markiert, danach 0.
- „datum_widerspricht" entsteht fast immer durch die Jahres-Fehllesung der
  ZWEITLESUNG (2020/2024/2028 statt 2026) — Tag und Monat stimmen. Erst
  vergleichen, ob nur das Jahr abweicht; die Pipeline korrigiert genau das
  (`plausibilizeBonDate`).
- Das alte `.pruefe-bons.js` misst das Bon-Alter gegen HEUTE. Für lange
  gehaltene Bons ist das falsch — die Pipeline misst gegen den UPLOAD. In der
  Kopie vom 19.09. korrigiert.

**Beim erneuten Zustellen greift der Schutz gegen nachträgliches Abhaken NICHT
(19.09.2026).** Die Regel vom 02.09. („nachgezogene Bon-Positionen dürfen keinen
heutigen Einkaufszettel abhaken") hängt an `purchased_products.backfilled ===
true` — und dieses Feld setzt AUSSCHLIESSLICH `resolveCashbackReview`. Der Weg
über `processCashback` (Sweeper, jedes Reprocessing-Skript, der Nachlauf vom
19.09.) setzt es nicht. Gemessen: bei 75 von 134 Bons war die Journey-/Zettel-
Schließung scharf, 108 `receiptMatches` mit erlaubter Schließung; dass nichts
passierte, lag daran, dass kein betroffener Nutzer einen offenen Zettel-Eintrag
hatte. **Vor jedem Massen-Reprocessing also entweder über den Resolver gehen
oder erst den Fix einbauen** (ClickUp-Task 19.09.). Merksatz: der Schutz hängt am
AUFRUFER statt an der Tatsache — genau das Muster, das die Ortsregel vermeidet.

**Weitere Merker aus dem Nachlauf (alle gemessen, 19.09.2026):**
- `matchStatus: 'skipped_ineligible'` im receipt-matcher ist ein ENDZUSTAND: der
  Trigger hängt an `onDocumentCreated`, und der spätere Merge-Write (Bon wird
  doch freigegeben) ist ein Update — es feuert nichts mehr. 33 Artikel zweier
  bezahlter Bons hängen dadurch dauerhaft.
- `crowd_uploads.rewardCents` taugt NICHT für Geld-Auswertungen: 208 tatsächlich
  gebuchte Freigaben tragen das Feld nicht. Immer das Ledger nehmen.
- Budget-Abgleiche brauchen einen STABILEN Lesezeitpunkt (der Zähler läuft im
  Betrieb weiter) — sonst sieht ein Fenster von 8 ct wie eine Lücke aus.
- Die alte 3110-ct-Differenz auf `milchprodukt-fotos-september-2026` ist geklärt:
  exakt der Verbrauch der Schwester-Aktion bis 05.09., also die manuelle
  „ein Topf"-Angleichung. Steht jetzt in deren `budgetNote`. Regel: **jede
  manuelle Budget-Korrektur dort vermerken** — `increment` hinterlässt keine Spur.
- Fallen bei einem Massen-Lauf mehrere gehaltene Bons desselben Nutzers auf
  denselben Bon-TAG, entscheidet sonst die Verarbeitungsreihenfolge, wer die
  Prämie bekommt (3 Fälle am 19.09.). Das ist eine fachliche Entscheidung —
  Kollisionen vorher ausweisen und bewusst wählen (höhere Endsumme o. Ä.).

**Die Uhrzeit der Zweitprüfung wird aus den Erstlesungen übernommen**
(`einheitlicheUhrzeit`, 19.09.). Sie ist der einzige Teil des
kontenübergreifenden Doppel-Schlüssels (`transactionHash`), den keine Prüfung
absichert: `plausibel()` schaut auf Endsumme, Artikelzahl und Datum, und im
Zeugen-Paar gilt eine FEHLENDE Uhrzeit nicht als Widerspruch. Im Praxistest las
eine von drei Prüf-Lesungen 06:21 statt 08:19 (sechs Erstlesungen einheitlich) —
gerettet hat nur, dass zufällig das andere Paar gewann. Die Entscheidung wird
deshalb NICHT verworfen (die Uhrzeit trägt kein Geld), nur der Schlüssel richtig
gestellt.

**Bildprüfung: ein an 429 gescheiterter Audit darf NICHT freigeben (19.09.2026).**
`.crowd-review-*.js` übersprang bis dahin nur Einreichungen OHNE Verdikt; ein
Verdikt `{echt: null}` (Infrastrukturfehler) rutschte als Freigabe durch. Jetzt:
`skip` mit Grund `vision_audit_unvollstaendig`, die Einreichung bleibt offen für
die nächste Runde. Gegenstück zur Regel „ein Infrastrukturfehler ist nie ein
Urteil über Nutzerdaten" — er ist eben auch keine Freigabe. Praktisch: bei 429
den Audit für die offenen Fälle einfach wiederholen (mit Pause), das löst die
meisten.

**EAN-Rettung (19.09.2026), mit Vorsicht.** Wie die Namens-Rettung vom 13.09.:
vollständige Einreichungen ohne `ean` (Barcode-Foto liegt vor) werden per Vision
nachgelesen → eigenes Feld `eanRescueOcr` (`.crowd-ean-rescue-1909.js`).
Übernommen wird nur, was ZWEI unabhängige Lesungen gleich lesen UND die
GTIN-Prüfziffer besteht. Grund für die Strenge: unter den EAN-losen Einreichungen
ist viel lose Ware (Banane, Melone, Salat) — ein Modell, das nach einer Nummer
gefragt wird, liefert dort gern eine vom Waage-Etikett, und händlerinterne GTINs
(Präfix 02, 20–29) bestehen die Prüfziffer. Wurzel ist der Wizard: im
Barcode-Schritt nimmt der Auslöser ein Foto an, auch wenn nichts dekodiert wurde
(`app/product-submit/wizard.tsx`), das manuelle Eingabefeld erscheint nur auf dem
Galerie-Weg — 163 sonst vollständige Einreichungen ohne EAN.
**Drift-Warnung:** die Prüfkonsole (`review-console/index.js precheckOf`) liest
WEDER `productNameRescueOcr` NOCH `eanRescueOcr` — Konsole und Ops-Skript
urteilen über denselben Fall verschieden. Beim nächsten Konsolen-Umbau nachziehen.

**Korrekturen an älteren Notizen (gemessen 19.09.2026):**
- Der Foto-Trigger schreibt das Ergebnis inzwischen ans Dokument
  (`rewardResult` / `rewardNotCreditedReason`); der Satz „Per-User-Deckel greift
  still, der Trigger schreibt nichts ans Doc" stimmt nicht mehr. Seit 13.09. gibt
  es keine freigegebene Einreichung ohne `rewardResult`.
- `weeklyBonCap` gilt für Produktfotos NICHT (der Trigger liest es nicht, bewusst:
  eine Foto-Freigabe soll dem Nutzer die Bon-Woche nicht wegnehmen). Einzige
  Mengenbremse pro Kopf ist `maxPerUserCents` — und zwar JE AKTION.
- Spiegel-Drift (Client überschreibt Server-Status): Rate stabil 0,6–0,7 % seit
  dem 04.09., die „Verdreifachung" war ein Artefakt der Reparatur vom 03.09.
  Am 19.09. wurden 28 Spiegel repariert. **Vorsicht bei Reparaturen:** der
  GamificationProvider feiert jeden Übergang aus einem nicht-terminalen Zustand —
  eine Reparatur lässt bei offener App Banner für Tage alte Bons aufpoppen.

**Deploy aus einem Worktree: die gitignorierte `.env` fehlt dort.** Ohne sie fielen
`CASHBACK_OCR_ENGINE`, DocAI-Einstellungen und `TREMENDOUS_CAMPAIGN_ID` still weg.
Vor jedem Deploy aus einem Worktree `cloud-functions/<codebase>/.env` aus dem
Haupt-Checkout kopieren und per `cmp` prüfen.

## Produktentscheidung 20.09.2026: lose Ware wird angenommen

Frische/lose Ware (Kräuterbund, Obst, Frischetheke) trägt keinen echten
Produkt-Barcode, sondern nur den Code der Ladenwaage — der gilt nur in diesem
Markt, und zwei verschiedene Produkte können denselben tragen.

**Entscheidung Patrick: trotzdem annehmen und vergüten.** Niemand soll fürs
Mitmachen bestraft werden. Diese Datensätze werden aufgenommen und für
Preisvergleiche genutzt.

Was daraus folgt (offen, ClickUp 12487v2akqg): solche Codes am Dokument
kennzeichnen und die Doppel-Prüfung bei ihnen zusätzlich nach Markt trennen —
sonst sperrt ein fremdes Produkt aus einem anderen Laden eine korrekte
Einreichung. Nicht ablehnen, nur sauber einsortieren.

## Produktfoto-Runde 20.09.2026 — vier Regeln, die je eine Runde gekostet hätten

**Ein Ops-Skript im Worktree lädt die Regel AUS DEMSELBEN Worktree.**
`.crowd-review-*.js` holt die Doppel-Regel über `path.join(__dirname, '..',
'review-console', 'src', 'duplicatePolicy.js')` — das löst auf die Worktree-Kopie
auf, nicht auf den Haupt-Checkout. Am 20.09. hatte Patrick die Regel um 13:22
geändert (`ffda2c3`: fremde Einreichungen sperren niemanden mehr, gegen den
eigenen Account nur noch 24 h statt 30 Tage). Der Worktree trug die Fassung vom
14.09. — der fertig geprüfte Lauf hätte **8 von 14 Ablehnungen** gegen eine
Entscheidung geschrieben, die wenige Stunden alt war, und eine Ablehnung ist
terminal. **Vor jeder Entscheidungsrunde prüfen, ob die geladene Regeldatei dem
Haupt-Checkout entspricht** (`git log -1 -- cloud-functions/review-console/src/
duplicatePolicy.js` dort gegen den Worktree, oder schlicht `git cherry-pick`).
Gefunden hat das nur die adversarielle Prüfrunde, nicht der Lauf selbst.

**Die Ablehntexte der Ops-Skripte erreichen die Nutzer NICHT.** `noteFor()`
schreibt nach `reviewNote` — und `lib/utils/productSubmissionCopy.ts` sagt im
Kopfkommentar ausdrücklich, dass dieses Feld nie angezeigt wird. Was der Nutzer
liest, steht in `REASON_COPY`, gekeyt auf den Grund-Code. Gemessen am 20.09.:
**140 von 447 Ablehnungen (31 %) trugen einen Code ohne Eintrag** (73×
`unvollstaendig`, 36+26× die beiden Sperr-Gründe, dazu `bild_defekt`) und
zeigten deshalb den Standardtext „alle Ansichten scharf, EAN und Preis gut
lesbar" — bei Sperren sachlich falsch, denn deren Fotos waren in Ordnung.
Regel: **jeder neue Grund-Code braucht im selben Commit einen `REASON_COPY`-
Eintrag.** Nachgezogen für alle sechs offenen Codes.

**Fail-closed braucht Symmetrie.** Die Doppel-Regel wertet einen fehlenden
Vergleichswert als „gleich" — wer also keinen Preis hat, wird gesperrt. Wenn
man fehlende Preise beim KANDIDATEN nachliest, muss die REFERENZ dieselbe
Chance bekommen, sonst entscheidet, auf welcher Seite die OCR zufällig
versagte. Am 20.09. hingen 4 von 9 Sperren nur an einer Referenz ohne Preis;
nach der Nachlesung blieben alle vier gesperrt (1,49/1,79/0,99/1,29 € beidseits
identisch) — jetzt aber belegt statt angenommen.

**Ein geretteter PREIS darf eine Sperre lösen, ein geretteter HERSTELLER
nicht.** Beim K-Classic Gouda las die eine Seite „Kaufland Stiftung & Co."
(Markeninhaber), die andere „DMK Deutsches Milchkontor" (Produzent) — beides
steht auf derselben Packung. Als „andere Daten" gewertet hätte das eine echte
Dublette (identischer Preis, gleicher Markt, 10 Tage) freigegeben. Preis vom
Schild ist eindeutig, eine Firmenangabe ist es nicht.

**Sieben Dateien sind nicht sieben Ansichten — und dieselbe Datei ist nicht
immer ein Mangel.** Zwei Fälle am selben Tag, beide nur durch den Bild-Audit
unterscheidbar: (a) ein Petersilienbund mit sieben EIGENEN Aufnahmen derselben
Vorderansicht (sieben verschiedene md5 → die Bild-Dedup ist blind, die
Vollständigkeitsregel zählt nur Dateien) — keine der verlangten Angaben ist zu
sehen, abgelehnt; (b) ein geriebener Gouda, bei dem `zutaten`, `naehrwerte` und
`hersteller` byteidentisch sind — das eine Rückseitenfoto trägt Zutatenliste,
Nährwerttabelle UND die Kontaktangabe, der Datensatz ist vollständig,
freigegeben. Eine Byte-Prüfung entscheidet hier in beide Richtungen falsch.

**Preis- und Hersteller-Rettung (`.crowd-preis-rescue-2009.js`)** — dritter Fall
der Klasse nach Name (13.09.) und EAN (19.09.). Ursache ist derselbe
Spar-Reflex, der bei der Bon-OCR schon dokumentiert ist: `crowd-upload-namer`
liest Name, Preis und Hersteller in EINEM Aufruf mit
`thinkingConfig: { thinkingBudget: 0 }` und 512 Token. Von 102 offenen
Einreichungen fehlten 4 Namen, 23 Preise, 16 Herstellerangaben; mit Denken
nachgelesen kamen 4 Namen, 8 Preise und 16 Herstellerangaben dazu. Gegenprobe
zur Erwartung: bei **18 der 32 Fälle war schlicht kein Preis im Bild** — das
„Preis"-Foto zeigt zu 40 % nochmal das Produkt (deckt sich mit der Messung des
Namers vom 06.09.). Grenzen wie bei der EAN-Rettung: zwei übereinstimmende
Lesungen, eigenes Feld (`priceRescueOcr`/`manufacturerRescueOcr`), nie in
`priceOcr`/`manufacturerOcr`.

**Ergebnis der Runde:** 102 offen → 96 freigegeben (1316 ct, alle gebucht),
6 abgelehnt (1 Barcode-Foto zeigt den Boden, 3 lose Ware ohne Produkt-Barcode,
1 siebenmal dieselbe Ansicht, 1 Eigen-Doppel binnen einer Minute), 0 ohne
Buchung, 0 ohne Grund am Dokument, Warteschlange leer.

## Morgenrunde Produktfotos (seit 24.09.2026)

Täglich 08:00 prüft und entscheidet `fotoRundeTaeglich` (Codebase
review-console) alle offenen Produktfoto-Einreichungen — Freigaben UND
Ablehnungen automatisch (Entscheidung Patrick 24.09.), Bericht mit Warnungen
in `ops_tagesberichte`. Die Nachricht an die Nutzer schickt NICHT die Runde,
sondern der Sammler in crowd-upload-reward (eine pro Person) — die Runde darf
deshalb keinen Push-Merker (`rewardPushSentAt`) setzen. Dashboard:
md-receipt-admin.web.app/tagesbericht.html; Meldung im eigenen Claude-Chat +
ClickUp (geplante Aufgabe `morgenrunde-bericht`). Scharf nur mit
`cashback_config/v1.fotoWorker === true`. **Alles Weitere — Regeln, Notbremse,
Vorfälle — steht in `cloud-functions/review-console/WISSEN-FOTORUNDE.md`.**
Handrunden mit den `.crowd-*-DDMM.js`-Skripten sind damit überholt; wer doch
von Hand prüft, nutzt dieselben Regeln (Datei `review-console/src/fotoRundeRegeln.js`).

**Bons in `review` entscheidet seit 24.09. die Bon-Runde um 07:45**
(`bonRundeTaeglich`, Regeln `review-console/src/bonRegeln.js`, Schalter
`cashback_config/v1.bonWorker`). Sie ersetzt die Handrunden
`.pruefe-bons-*.js` + `.review-approve-*.js` und entscheidet ausschließlich über
den Resolver. Zwei Regeln aus ihrer Prüfrunde, die für JEDE Bon-Nacharbeit
gelten: (1) eine Zweitlesung, die Datum oder Endsumme NICHT liest, bestätigt
nichts — „nicht lesbar" als „kein Widerspruch" zu werten gibt jeden Bon frei;
(2) vor einer Freigabe das Budget der wirksamen Aktion prüfen — der Resolver
schließt einen Bon bei leerem Budget ENDGÜLTIG ohne Prämie ab.
Details in `WISSEN-FOTORUNDE.md` („Bon-Runde").

## Bons nachverarbeiten / Review auflösen — Regeln (Money-Ops 02.09.2026)

Am 02.09. wurden 163 Review-Bons (seit Juli gehalten, „meistens innerhalb eines
Tages" versprochen) und 120 Bons ohne Aktion nachverarbeitet. Zwei adversarielle
Review-Runden (29 Funde) haben Fallen gezeigt, die für JEDE Nacharbeit gelten:

- **Das Tageslimit kennt nur das JÜNGSTE vergütete Bon-Datum**
  (`cashback_last_bon_date`, nur vorwärts). Wer ÄLTERE Bons nachverarbeitet
  (Republish, Reprocessing, Review-Freigabe), umgeht es → zwei Gutschriften für
  dasselbe Bon-Datum. Regel: bei Nacharbeit die Same-Date-Frage SELBST
  entscheiden — Ledger frisch lesen (earn−reverse>0 → receipts.bonDate),
  pro User SEQUENZIELL (publish → auf finalen Status pollen → nächster Bon),
  eigener Bon ausgeschlossen. Lauf B (`.repair-campaign.js`) vor Lauf A
  (`.review-approve.js`); A prüft per Gate, dass B final ist.
  **Root-Fix seit 05.09.2026:** das Tageslimit ist ein echter Zähler —
  `users/{uid}/cashback_days/{YYYY-MM-DD}` = `{ bonDate, receiptIds[] }`
  (server-only, kein Rules-Block nötig). `syncLedgerForReceipt` liest das
  Tages-Doc in der Transaktion (Cap = `receiptIds` ohne eigenen Bon ≥
  `config.dailyCap`), schreibt beim Earn den Bon hinein (+ `bonDate` am Ledger-
  Earn) und entfernt ihn beim Reverse aus ALLEN Kandidaten-Tagen (Ledger-Earns,
  Aufrufer-Datum, `opts.extraDays` = gespeichertes receipts.bonDate — die OCR
  kann zwischen Earn und Reverse ein anderes Datum lesen). Pre-Check 6y liest
  dasselbe Doc, ist aber nicht autoritativ. Übergangs-Fallback: bei
  `dailyCap === 1` UND `config.dailyCapLegacyFallback !== false` zählt das alte
  Vorwärts-Feld mit (Earns aus dem Fenster Backfill↔Deploy); der Reverse
  löscht das Feld, wenn es auf den stornierten Bon zeigt. Nach Backfill 2 +
  VERIFY grün wird `dailyCapLegacyFallback: false` gesetzt (Sunset, kein
  Deploy). Liest eine neue OCR-Lesung ein anderes Datum, hängt der Noop-Zweig
  den Bon in den neuen Tag um. Backfill `.backfill-cashback-days.js` ist
  TRANSAKTIONAL pro User (setzt die aktive Menge je Tag, entfernt stale IDs,
  löscht leere Docs, datiert Legacy-Earns; VERIFY=1 → exit 1 bei fehlend ODER
  stale). Reihenfolge: Config `dailyCap=1` → Backfill → Deploy → Backfill
  erneut → VERIFY → Fallback-Sunset. 27 historische Tage mit 2 vergüteten Bons
  = die alte Lücke; 16 aktive Earns ohne auflösbares Receipt/Datum (alte
  Test-Resets) zählen an keinem Tag. `cashback_last_bon_date` bleibt für den
  Client-Softcheck.
  `cashback_config/v1.dailyCap` ist jetzt semantisch ein Zähler — von 3 auf 1
  gesetzt, damit das gelebte Verhalten bleibt; 3 würde ab sofort 3 Bons/Tag
  vergüten (kein Deploy nötig). **Seit 24.09.2026 steht er auf 3 (Entscheidung
  Patrick, `dailyCapNote` am Dokument)** — Pipeline, Resolver und Bon-Runde
  lesen denselben Wert.
- **Der OCR-Cache-Pfad muss `ocr.robust` mitführen** (index.js Cache-Zweig).
  Ohne ihn ist das Review-Gate 6w bei jedem Retry/Reprocessing blind
  (conf=null → keine Prüfung) und der Final-Write löscht robust am Doc.
- **Gates, die einen Status VON approved WEG bewegen, müssen an
  `alreadyCredited` hängen** (6w: `!alreadyCredited && reviewDecision !==
  'approve'`). Sonst storniert eine PubSub-Redelivery über
  `syncLedgerForReceipt(status='review')` eine echte Gutschrift — dieselbe
  Klasse wie die Selbststornos vom 19./26.08.
- **Ledger-Precheck ist fail-CLOSED** (`ledger_precheck_failed` → Retry, nach
  MAX_PROCESS_ATTEMPTS `review`, nie `rejected`). Infrastrukturfehler sind
  keine Aussage über den Bon.
- **`resolveCashbackReview`** hat dieselben Caps wie die Pipeline, lädt die
  Config STRIKT (kein Fallback auf campaignsEnabled:false), reversed bei
  reject/no_reward einen evtl. vorhandenen Earn, schreibt purchased_products
  mit `backfilled:true` und pusht. Decisions: `approve` |
  `reject[&reason=duplicate_content_self|_cross_user&duplicateOf=…&priorStatus=…]`
  | `no_reward&reason=daily_cap_reached|weekly_cap_reached|per_user_cap_reached`.
  `cents<=0` → 409 (nie still „Budget erschöpft").
- **Nachgezogene purchased_products dürfen keinen HEUTIGEN Zettel abhaken:**
  `receipt-matcher` onPurchasedProductMatch setzt `noClose` bei
  `backfilled===true` oder Bon älter als 14 Tage (Matching + Alias-Lernen
  laufen weiter, nur der Cart-/Journey-Side-Effect entfällt).
- **Cross-User-Dedup greift nur bei gleicher Bon-Uhrzeit** (transactionHash).
  Gleicher Markt+Tag+Summe aus zwei Accounts binnen Minuten (OCR liest die Zeit
  verschieden) rutscht durch → bei Freigaben skippen und manuell sichten.
- **Skripte für Geld-Läufe:** Fail-fast bei jedem Nicht-200, Ergebnisdatei
  nach JEDEM Bon, IDs VOR dem ersten Write merken (und mergen, nie
  überschreiben), Publish mit Retry, Key nur aus ENV und nie loggen, DRY_RUN
  zuerst. Vor dem Lauf zwei Skeptiker-Runden gegen die AKTUELLEN Dateien —
  Runde 1 fand 14, Runde 2 (nach Fixes) 15 Punkte, davon 15 am neuen Stand
  widerlegt. Ohne diese Runden wären u.a. Journey-Abschlüsse aus Juli-Bons und
  der Review-Gate-Selbststorno live gegangen.

## Ein Schalter, der nichts abschaltet — Opt-outs brauchen einen LESER (08.09.2026)

Schwester der Regel darunter („Ein Status-Feld ist kein Mechanismus"), diesmal
in der anderen Richtung: dort fehlte der Trigger zu einem Versprechen, hier
fehlte der LESER zu einer Verweigerung.

**Vorfall (86cbfdq5j):** Der Schalter unter `/notification-settings` schrieb
seit Mai 2026 `users/{uid}.pushNotificationsEnabled: false`. Dieses Feld wurde
im gesamten Projekt **nirgends gelesen** — die einzigen Treffer waren die zwei
Schreibstellen. `getUserTokens` in `cashback-pipeline/lib/push.js` holte stur
alle Token. Wer Push abbestellte, bekam Push. Dazu drei weitere Defekte am
selben Schalter: `disable()` hing an `if (this.pushToken)` und war damit
meistens ein kompletter Nichtstuer; es räumte das Badge nicht; und `isEnabled`
war allein aus der iOS-Systemberechtigung abgeleitet, sprang beim nächsten
Wechsel in den Vordergrund also wieder auf AN.

**Regeln:**
- **Jede Verweigerung (Opt-out, Stummschaltung, Sperre) braucht im selben
  Commit die Stelle, die sie LIEST.** Prüffrage analog zur Geld-Regel: *Wer
  genau fragt dieses Feld ab, bevor gehandelt wird?* Gibt es die Stelle nicht,
  gehört der Schalter aus der Oberfläche — ein Versprechen, das niemand
  einlöst, ist schlimmer als ein fehlendes.
- **Die Prüfung gehört an den Ort, an dem Empfänger entstehen**, nicht an jeden
  Aufrufer. In `push.js` steht sie deshalb in `getUserTokens`; jeder künftige
  Sendeweg erbt sie.
- **Fail-open bei fehlendem Wert.** 283.728 von 283.756 Konten trugen das Feld
  gar nicht. Hätte „nicht gesetzt" als „aus" gegolten, hätte der Deploy alle
  Nachrichten der App lautlos abgeschaltet. Nur ein ausdrückliches `false`
  zählt; ein Lesefehler ebenfalls nicht (Infrastruktur ist keine Aussage über
  den Willen des Nutzers — dieselbe Linie wie beim Aktionsgebiet).
- **Berechtigung ≠ Wunsch.** Systemberechtigung („dürfen wir?") und
  Nutzerentscheidung („will er?") sind zwei Zustände. In ein Boolean gequetscht
  gewinnt immer der, der zuletzt geschrieben hat — hier die OS-Abfrage im
  AppState-Listener. Getrennt führen, für die Anzeige und-verknüpfen:
  `lib/services/pushPreference.ts` (Wunsch, lokal + gespiegelt) neben
  `permissionStatus` (System) im `PushNotificationProvider`.
- **Ein Token-Schreibvorgang darf eine Abbestellung nicht aufheben.**
  `savePushToken` setzte `pushNotificationsEnabled: true` mit — damit hätte
  jede Token-Registrierung den Opt-out stillschweigend zurückgenommen. Die
  Einstellung schreibt NUR die Stelle, die den Nutzer gefragt hat.
- **Offline-Absicherung für Präferenz-Writes:** Firestore-Promises lösen
  offline nie auf und scheitern auch nicht (Projektregel) — ein `catch` fängt
  den Fall also nicht. Deshalb Merker VOR dem Schreiben setzen, nach der
  Bestätigung löschen, beim nächsten Start nachholen (`nachholenFallsOffen`).
  Sonst bestellt jemand im Funkloch ab und bekommt dauerhaft weiter Nachrichten.

**`aps.badge` ist ein SETZ-Feld, kein Zähler.** `cashback-pipeline` schickte
hart `badge: 1` mit; die einzige Räum-Methode der App (`setBadgeCount`) hatte
repo-weit KEINEN Aufrufer. Die rote Eins blieb damit für immer am App-Symbol —
Wegwischen der Mitteilung, App-Neustart, Geräte-Neustart und Ausloggen ändern
den Wert NICHT, weil er persistenter Gerätezustand ist und nicht an den
Einträgen in der Mitteilungszentrale hängt. Kostete eine 1★-Rezension
(07.09.2026, „wie bekomme ich die rote eins weg?"). Regel: Wer einen
Badge-Wert sendet, liefert im selben Commit die Stelle, die ihn auf 0 setzt —
Mount **und** AppState `'active'` im `PushNotificationProvider` decken beide
Wege ab (Tap aus dem Hintergrund, Start aus dem beendeten Zustand). Ein fester
Wert ohne Informationsgehalt (immer 1) gehört gar nicht erst gesendet.
Bestehende Badges räumt nur eine stille Zustellung nach
(`cashback-pipeline/.badge-reset.js`, `apns-push-type: background` +
`content-available: 1` + `badge: 0`) — die geht an echte Geräte und braucht
ausdrückliche Freigabe.

## Testen und tsc scheitern am falschen Node — und an `tools/company-os` (08.09.2026)

Zwei Umgebungsfallen, die zusammen eine halbe Stunde und fast eine
Fehldiagnose gekostet haben:

- **`jest` und `tsc` brauchen den nvm-Node 22.22.2 plus mehr Heap.** Der
  Standard-Node dieser Shell (`~/.local/bin/node`, v22.23.1) läuft dem
  Speicher davon. jest meldet dann **„18 failed, 11 passed"** mit
  `ChildProcessWorker._onExit` — das sieht wie 18 kaputte Suiten aus und ist
  ein OOM. tsc **stürzt intern ab** (`TypeError: Cannot read properties of
  undefined (reading 'kind')`) und gibt dabei **0 Fehler** aus — wer nur
  `grep -c "error TS"` liest, hält das für ein grünes Gate. Richtig:
  ```bash
  PATH="$HOME/.nvm/versions/node/v22.22.2/bin:$PATH"     NODE_OPTIONS=--max-old-space-size=6144 npx jest
  ```
  Immer den Exit-Code mitprüfen, nie nur die Fehlerzahl.
- **`tools/company-os` (4,3 GB, untracked) ist in `tsconfig.include`
  (`**/*.ts`) und im jest-Dateilauf.** Ein gezielter Testlauf
  (`npx jest <pfad>`) kippt daran auch mit 8 GB, und tsc stürzt an den
  vendorten Paperclip-Quellen ab. Ausweg ohne Konfigurationsänderung: einen
  Worktree am Basis-Commit anlegen (`git worktree add --detach /tmp/md-base
  HEAD`, `node_modules` symlinken), die geänderten Dateien hineinkopieren und
  dort messen — der Worktree kennt keine untracked Dateien. Das ist zugleich
  der einzige ehrliche tsc-Vergleich, weil beide Seiten denselben
  Dateibestand haben.
- **tsc-Baseline am 08.09.2026: 342 Fehler** (gemessen im Worktree, ohne
  `tools/company-os`). Die im Abschnitt oben genannten 361 stammen vom
  26.07.2026 und passen nicht mehr.

## Ein Status-Feld ist KEIN Mechanismus — Geld-Versprechen brauchen einen Trigger

**Vorfall 07.08.2026:** `crowd_uploads` (Produkt-Einreichungen) hatte ein
`status`-Feld mit `pending | approved | rejected` und den Kommentar „reward
credited later after review". Das „later" wurde nie gebaut. Ergebnis: **144
freigegebene Einreichungen, 0 Cent ausgezahlt**, während in der App wörtlich
„Aktuell 0,15 € pro komplettem Datensatz" stand und die Aktion aktiv lief.
87 Menschen hatten auf ein Versprechen hin fotografiert, ihre Einreichung
wurde bestätigt — und es kam nichts. Nachgezahlt per
`scripts/backfill-crowd-upload-rewards.js` (13,05 € an 60 Nutzer), der
laufende Betrieb hängt seither an `cloud-functions/crowd-upload-reward`
(`onDocumentUpdated`, Flanke `pending → approved`).

**Die übertragbare Regel:** Wer irgendwo ein Status-Feld einführt, an dem eine
Vergütung, ein Punktestand oder eine Freischaltung hängt, muss im selben
Commit den Trigger mitliefern ODER die Zusage aus der UI nehmen. Ein
Kommentar „wird später gutgeschrieben" ist kein Mechanismus, und niemand
merkt sein Fehlen — es gibt keinen Fehler, keinen Log, keine Beschwerde
(die Nutzer sehen nur „genehmigt" und warten).

**Prüffrage bei jedem Geld-Feature:** Wer genau schreibt ins Ledger? Es gibt
GENAU DREI Stellen (`cashback-pipeline` = Bons, `survey-reward` = Umfragen,
`crowd-upload-reward` = Produktfotos). Steht die neue Quelle nicht dort, wird
nichts ausgezahlt — egal wie vollständig die Datenstruktur aussieht.

**Buchungsform ist einheitlich, nicht neu erfinden:** EINE Transaktion mit
Ledger-Eintrag (`type:'earn'`, `cents`, `campaignId`, `balanceAfterCents`,
`reason`), `cashback_balance_cents` + `cashback_lifetime_cents`,
`cashback_campaign_totals[cid]` und `budgetRemainingCents` (increment,
race-frei). Idempotenz IMMER über eine deterministische Doc-ID
(`crowd_<uploadId>`) statt über eine Query — dieselbe ID nutzen Backfill und
Trigger, dadurch kann ein nachgezahlter Datensatz nicht doppelt gebucht
werden. Firestore-Trigger sind at-least-once; ohne feste ID gibt es
Doppelgutschriften.

**Geld-Regeln knüpfen an TATSACHEN an, nie an ein versioniertes Modell.**
Die Ortsanforderung des Foto-Rewards (`crowd-upload-reward/src/locationGate.js`,
11.08.2026) prüft `capture.confirmedPlace || capture.gps` — also ob der Nutzer
einen Ort ANGEGEBEN hat. Sie prüft bewusst NICHT `probableLocation.confidence`,
obwohl das naheläge: diese Bewertung stammt aus einem Modell, das sich ändern
darf (`crowd-upload-location/src/scorer.js`, versioniert). Hinge das Geld daran,
entschiede eine Modelländerung rückwirkend darüber, wer bezahlt wird — und
niemand würde es merken.

**Eine neue Anforderung braucht eine Übergangsfrist für alte Clients.** Eine
Regel, die nur der aktualisierte Client erfüllen kann, darf nicht sofort für
alle gelten — sonst trifft sie Leute, die schlicht noch nicht aktualisiert
haben. `locationGate` greift deshalb nur bei Dokumenten mit `clientVersion`
(= App kennt den Pflicht-Schritt); ohne das Feld wird vergütet und der Vorgang
mit `grund: 'gnadenfrist_alter_client'` markiert, damit messbar bleibt, wann
man die Frist gefahrlos abschalten kann. Und: ein ausbleibender Betrag wird
IMMER ins Dokument geschrieben (`rewardSkipped` + `rewardSkippedReason`), nie
nur geloggt — ein still ausbleibender Betrag ist genau das Muster, das zu
„144 freigegeben, 0 Cent ausgezahlt" geführt hat.

**Bei Nachzahlungen NICHT die Perioden-Zähler hochsetzen**
(`cashback_campaign_weekly`, `cashback_monthly`): die deckeln laufende
Bon-Einreichungen. Eine Nachzahlung für UNSER Versäumnis darf dem Nutzer
nicht seine aktuelle Woche oder seinen Monat wegnehmen.

## Regionale Aktionen — PLZ-Präfixe, EINE Regel für alle drei Verdien-Wege (06.09.2026)

Eine Aktion kann auf ein Gebiet beschränkt werden. Feld am Kampagnen-Dokument
(`cashback_campaigns/{id}`), alle Teile optional:
```
targeting: {
  zipPrefixes: ['0','1'],      // PLZ-PRÄFIX, beliebig fein: '3' = Gebiet 3,
                               // '30' = Raum Hannover, '30159' = eine PLZ
  countries: ['DE'],           // optional, zusätzlich
  onUnknown: 'allow' | 'deny', // Standard allow
}
```
Fehlt `targeting` (oder ist leer), gilt die Aktion überall — Bestandskampagnen
ändern ihr Verhalten nicht.

- **Modul:** `cloud-functions/cashback-pipeline/lib/targeting.js` (+ 21 Tests).
  **Kopie** in `cloud-functions/crowd-upload-reward/src/targeting.js` — Codebases
  teilen keinen Code; bei Änderungen BEIDE nachziehen (Drift wie bei `extractEans`).
- **Woher die Region kommt** (Reihenfolge = Verlässlichkeit): `bon`
  (receipts.store.zip, 84 % der Bons) → `bonfoto` (crowd_uploads.priceReceipt.zip,
  wenn das Preisbild ein Kassenbon ist) → `profil` (users/{uid}.region, aus den
  eigenen Bons abgeleitet) → `ort` (Ortsname über eine aus Bons gelernte Tabelle).
  Datenlage 06.09.: Profile haben zu 4 % eine Ortsangabe und zu 0 % eine PLZ —
  deshalb ist die aus Bons abgeleitete Nutzer-Region die einzige Quelle, mit der
  sich Produktfotos und Umfragen überhaupt regional steuern lassen.
- **`users/{uid}.region`** schreibt die Bon-Pipeline bei jedem Bon mit Filial-PLZ
  fort (fire-and-forget, `{zip, city, country, source:'bon', receiptId, at}`).
- **Bons:** Der Server korrigiert die Wahl der App. Die App wählt die Aktion,
  bevor die Filialadresse bekannt ist (die steht erst nach der OCR fest) — passt
  sie nicht zum Gebiet, nimmt `pickCampaignForRegion` die nächstbeste passende
  Aktion (engstes Gebiet zuerst, dann früheres Ende). Gibt es keine:
  `rejectReason = 'ausserhalb_aktionsgebiet'` statt `no_active_campaign`. Die
  Entscheidung steht als `receipts.targeting` am Doc, der Mirror trägt
  `campaignRegionSwitched`.
- **Produktfotos:** `crowd-upload-reward` prüft vor der Buchung; passt das Gebiet
  nicht, wird NICHT gebucht und `rewardSkipped/rewardSkippedReason:
  'ausserhalb_aktionsgebiet'` + `rewardRegion` ans Doc geschrieben. Fehler beim
  Prüfen sind fail-open (ein Infrastrukturfehler ist keine Aussage über die
  Einreichung).
- **Umfragen:** noch nicht angeschlossen — `survey-reward` läuft auf einem Stand
  von Juni (der Fix 7d8e91b vom 28.06. ist nie deployt worden). Erst deployen,
  dann targeting einhängen.
- **Unbekannte Region ist standardmäßig erlaubt.** Wer einen Bon ohne lesbare
  Anschrift einreicht, hat nichts falsch gemacht; `onUnknown:'deny'` ist die
  bewusste Ausnahme für Aktionen, die ein Gebiet strikt einhalten müssen.

## Standortpflicht im Reward-Programm + Ortsrangfolge (24.09.2026, ab 6.0.20)

Gründerentscheidung, endgültig: Wer am Reward-Programm teilnimmt (Bons,
Produktfotos, vergütete Umfragen), MUSS die Standortfreigabe erteilt haben,
auch auf iOS. Die Kopplung ist geklärt, nicht neu aufmachen. Das Datenschema
bleibt unverändert: nur Logik innerhalb bestehender Felder und Werte.

- **Rangfolge des geltenden Orts:** 1) Filialadresse vom Kassenbon auf dem
  Preisfoto (`priceReceipt`), 2) GPS, 3) Ortsangabe, 4) IP. Die Stufen 3
  und 4 gelten nur, wenn GPS bei ERTEILTER Freigabe technisch scheitert.
- **App (`lib/services/standortPflicht.ts`, `useStandortPflicht`):** Die
  Sperre steht am ZIEL (Bon-Scanner, Foto-Assistent, Umfrage-Sheet), nicht
  am Einstieg. So deckt sie jeden Pfad ab, auch Deep-Links, und wird bei
  jedem Wechsel in den Vordergrund neu geprüft. Der Freitext-Ort im
  Assistenten erscheint nur noch bei fehlendem Fix, nie als Ersatz für die
  Freigabe. Die Sperre ersetzt den Inhalt und ist nie ein zweites Modal.
- **Server (`crowd-upload-reward/src/locationGate.js`, Kopie in
  review-console):** `STANDORTPFLICHT_AB_BUILD = { android: 1244, ios: 1270 }`.
  Ältere Builds bieten „Ort eintippen“ noch an und werden weiter vergütet.
  Stufe 4 zahlt auch bei gescheiterter IP-Abfrage (`source: 'fallback'`),
  weil das ein Infrastrukturfehler ist.
- **Bedeutungswechsel ab Deploy 24.09.2026:** `rewardLocationRule:
  'ort_aus_kassenbon'` steht jetzt an JEDER Einreichung mit vollständigem
  Bon-Kopf, auch wenn GPS vorliegt. Bis dahin stand der Wert nur, wenn der
  Bon die letzte verbliebene Quelle war. Wer auswertet, trennt nach
  Deploy-Datum; GPS gegen Bon unterscheidet man über `capture.gps` und
  `priceReceipt`.
- **Ortsschätzer ploc-v2:** `receipt_address` ist Rang 1, aber NUR mit
  aufgelöster PLZ-Koordinate (sonst wäre keine Widerspruchsprüfung gegen
  GPS möglich). Der Update-Trigger `onCrowdUploadBonAdresse` (retry) ist
  nötig, weil der Namer `priceReceipt` erst Sekunden NACH der Anlage
  schreibt. Einziger Leser von `probableLocation` ist review-console
  (`ort.js`). Deshalb muss review-console VOR crowd-upload-location live
  sein, sonst fallen die Bon-Orte von der Karte.
- **Die IP steht trotzdem an fast jedem Dokument** (`journeyLocation`,
  `journey.location`). Das ist ein Rohsignal und wird nirgends als Ort
  angezeigt. Wer „überall IP“ sieht, schaut auf Rohdaten.

## Der Ortsschätzer entscheidet — nicht ein zweites Modul (07.09.2026)

**`probableLocation` ist die Autorität für „welcher Ort gilt".** Geschrieben von
`cloud-functions/crowd-upload-location/src/scorer.js` (seit August 2026, an 1.202
von 1.619 Einreichungen), mit Quelle, Konfidenz, Granularität, den
mitbewertenden Signalen und `usableFor` als Missbrauchsschutz.

Beim Bau des Prüfwerkzeugs wurde diese Rangfolge versehentlich ein zweites Mal
aufgestellt — zwei Entscheider über dieselbe Frage, die im Betrieb auseinander
laufen. Korrigiert: `cloud-functions/review-console/src/ort.js` liest
`probableLocation` und steuert nur bei, was dort fehlt:
- **Koordinaten zu Ortsnamen** — `granularity: 'city'` trägt einen Ortsnamen,
  aber in 224 von 234 Fällen keine Koordinate.
- **Bons** — für `receipts` gibt es kein `probableLocation`; dort ist die
  Filialadresse vom Bonkopf die Quelle.
- **Auffälligkeiten** (siehe unten).

Wer eine neue Ortsfrage beantworten will: erst prüfen, ob `scorer.js` sie schon
beantwortet. `granularity` sagt WAS behauptet wird (point/store/city/country),
`confidence` WIE SICHER, `usableFor` WOFÜR der Wert taugt.

**Auffälligkeiten benennen, nicht stillschweigend zeichnen** (`auffaelligkeiten()`):
Aufnahmeort außerhalb DACH (2 Fälle), Standardstandort eines Entwickler-
Simulators (1 — San Francisco, exakt der iOS-Default), Genauigkeit gröber als
ein Kilometer (10). Anlass: eine Einreichung stand mit ± 4 m in Belgien bei
einem deutschen Markt. Der Punkt war richtig — das Werkzeug sagte nur nicht,
dass daran etwas bemerkenswert ist. Im Prüfwerkzeug über der Ortsangabe, auf
der Karte rot und als eigener Filter.

**Was NICHT auf die Karte kommt:** die IP-Ortung (Median 60 km daneben), der aus
früheren Bons abgeleitete Wohnort (`user_profile_region`, 144 Fälle — sagt
nichts über DIESE Einreichung; das wäre derselbe Fehler wie die IP-Ortung, nur
subtiler) und die reine Landesangabe (`market_country`, 515). Statt einer
Sammelzahl „ohne Ort" steht in der Seitenleiste, WARUM ein Fall fehlt.

## Welcher Ort gilt? — Rangfolge, an den eigenen Daten gemessen (07.09.2026)

Frage des Users: „Ort: GPS — was bringt mir das? Welchen Ort nehmen wir jetzt?"
Antwort als Rangfolge, jede Stufe mit Messwert. Umgesetzt in
`cloud-functions/review-console/src/ort.js`; die Zahlen stammen aus 1.613
Produktfoto-Einreichungen und 6.478 Bons.

| Rang | Quelle | Feld | Verfügbar | Genauigkeit |
|---|---|---|---|---|
| 1 | **Gerätestandort zur Aufnahme** | `capture.gps` | 458 Fotos, 0 Bons | 246× < 20 m, 433 von 458 < 100 m |
| 2 | **Filialadresse vom Kassenbon** | `store` (Bons), `priceReceipt` (Fotos) | 5.419 Bons, 286 Fotos | Median 2,0 km, p90 7,8 km |
| 3 | **Angabe des Nutzers** | `capture.confirmedPlace.city` | 132 Fotos | stadtgenau, meint oft den Wohnort |
| — | **IP-Ortung** | `journeyLocation` | 1.397 Fotos, 6.387 Bons | **als Ort verworfen** |

Begründungen, die man nicht neu diskutieren muss:

- **Rang 2 vor Rang 3**, obwohl die Nutzerangabe „direkter" wirkt: bei 25
  Einreichungen mit beidem stimmten nur 9 überein, und die Abweichungen sind
  Wohnort gegen Einkaufsort (Kotzenbüll/Tönning) oder Schreibweisen
  (Nettersheim/Nettersheim-Zingsheim). Der Bon sagt, wo gekauft wurde; die
  Angabe sagt, wo jemand wohnt.
- **Die IP-Ortung ist als Ort unbrauchbar** — gegen 440 echte GPS-Fixes
  gemessen: Median 59,8 km, p90 293 km, Extremwert 9.628 km. Sie erscheint auf
  keiner Karte und in keiner Ortsangabe. Für „welches Land" bleibt sie gültig
  (siehe den älteren Abschnitt zur IP-Ortung).
- **Der Marktname ist kein Ort.** Er steht an 1.613 von 1.613 Einreichungen und
  benennt die Kette, nicht die Filiale.
- **Die Genauigkeit wird immer mit angezeigt** („± 16 m", „± 2 km"), und
  widersprechende Quellen stehen als Zusatz daneben — eine Ortsangabe ohne
  Angabe ihrer Herkunft ist beim Prüfen wertlos.

**Postleitzahl → Koordinate:** `cloud-functions/review-console/data/plz.json`,
13.314 Einträge für DE und AT aus GeoNames (Herkunft und Neuerzeugung stehen in
`data/QUELLE.md`). Deckt 5.383 von 5.419 real vorkommenden Bon-Postleitzahlen ab.
Ergänzt wird sie zur Laufzeit aus den **eigenen Bon-Adressen**: das öffentliche
Verzeichnis führt nur Hauptgemeinden, kennt also weder Schleusingen noch
Kotzenbüll — die Kassenbons kennen beide (`ortsverzeichnisAusBons`).

**Kein Präfix-Abgleich bei Ortsnamen.** Der Versuch kostete beim Bauen zwei
Fehltreffer: „Kotzenbüll" (Schleswig-Holstein) landete auf „Kotzen"
(Brandenburg, 300 km), „Neustadt" auf einem beliebigen von zwanzig. Ein falscher
Punkt auf einer Karte, nach der jemand entscheidet, ist schlimmer als gar keiner
— lieber ein Fall ohne Ort als einer am falschen Ort.

## Karte — md-receipt-admin.web.app/karte.html (seit 07.09.2026)

Alle Produktfotos und Bons als Punkte, Filter nach Art, Zeitraum, Ortsquelle,
Markt und Zustand; drei Darstellungen (gruppiert, einzeln, Dichte je Ort).
Backend: Callable `reviewMapPoints` (review-console) liefert 6.066 Punkte in
rund 4 Sekunden als **Array-Tupel statt Objekten** — als Objektliste wären es
900 KB, so sind es 684 KB. Gefiltert wird im Browser: einmal laden, danach ist
jeder Filterwechsel sofort und kostet keinen Firestore-Read.

Ohne verwertbaren Ort und deshalb nicht auf der Karte: 935 von 1.614 Fotos und
1.091 von 6.478 Bons. Das sind Altfälle (Fotos vor der Ortspflicht, Bons vor
OCR v1.4 ohne Filialadresse) — die Zahl steht in der Seitenleiste, damit
niemand die Karte für vollständig hält.

## Review-Konsole (Web-Back-Office) — md-receipt-admin.web.app (seit 05.09.2026)

Produktfotos (`crowd_uploads`) und Bons (`receipts`) sichten, filtern, suchen,
freigeben — einzeln und Batch. Design: `docs/REVIEW_CONSOLE_DESIGN.md`.
- **Eine Site, ein Login:** Hosting-Site `md-receipt-admin` (`receipt-admin-web/`),
  Seiten `pruefen.html` (DAS Prüf-Werkzeug) und `index.html` (Bon-Matching),
  gemeinsame `admin-common.js`. `produktfotos.html`/`bons.html` sind seit dem
  Rework nur noch Weiterleitungen — die alten Tabellen sind weg, nicht
  wiederbeleben. Firebase-Auth E-Mail/Passwort + Custom-Claim `admin:true`.
  Kein Build-Schritt. Deploy: `firebase deploy --only hosting:md-receipt-admin`.
- **Prüf-Werkzeug `pruefen.html` (Rework 07.09.2026, User: „Die Performance ist
  schrecklich, ich sehe die Fotos nicht"):** ein Fall füllt den Bildschirm, alle
  7 Fotos sofort sichtbar, Entscheidung per Taste (F freigeben, A ablehnen +
  Ziffer für den Grund, O ohne Prämie bei Bons, → später, ← zurück), Klick aufs
  Bild = Vollbild mit dem ORIGINAL. Warteschlange links, ältester zuerst.
  Rücknahme (`decision: 'reopen'`) gibt es NUR aus `rejected` zurück nach
  `pending` — eine Freigabe hat schon gebucht und wird nie per Klick
  zurückgenommen; das Werkzeug bietet Undo darum bewusst nur bei Ablehnungen.
  Callables dafür: `reviewQueue` (schlanke Liste + Vorprüfungs-Urteil je Zeile)
  und `reviewCases` (bis 6 Fälle komplett MIT fertigen Bild-URLs). Die nächsten
  drei Fälle werden immer vorgeladen, dadurch ist der Wechsel sofort.
- **Keine Entscheidung über einen Fall, den man nicht sieht.** `S.zeigt` hält die
  ID des Falls, der WIRKLICH gerendert ist; `decidePhoto`/`decideReceipt`
  steigen aus, wenn sie nicht passt. Drei Wege führten vorher an dieser Regel
  vorbei: die Entscheidungsleiste wurde vor dem Laden sichtbar geschaltet
  (bei „Lade Fall …" war F scharf), `advance()` lief ohne `await` (zweimal F
  entschied über den nächsten, ungesehenen Fall), und `keydown` prüfte keine
  Modifikatoren (Cmd+F löste eine Freigabe aus). Bei jedem neuen Bedienelement
  auf dem Geldpfad: erst der Zustand, dann die Sichtbarkeit.
- **Der Bon-Resolver antwortet mit `creditedCents`, nicht `cents`** — und er
  rechnet die Deckel beim Freigeben NEU. Ein Bon, der Tage in der Prüfung lag,
  kommt mit `status: 'no_reward'` und 0 Cent zurück. Wer nur auf `ok: true`
  schaut, meldet „Freigegeben ✓" für eine Freigabe ohne Geld — dieselbe Klasse
  wie „144 freigegeben, 0 Cent". Immer den Betrag UND den Status auswerten.
- **GeoNames führt Großkunden-Postleitzahlen mit dem FIRMENNAMEN im Ortsfeld.**
  Ungefiltert wurde aus einem Gerätestandort „Finanzamt Köln-Porz, 51139" statt
  „Köln" — bei 150 von 463 Standorten. `data/plz.json` markiert solche Einträge
  (fünftes Feld = 1, 1.641 Stück); die Rückwärts-Suche überspringt sie, ihre
  Koordinate bleibt für Bon-Adressen nutzbar. Beim Neuerzeugen der Tabelle das
  Muster in `data/QUELLE.md` mitziehen — und KEIN `\b` ans Musterende setzen,
  sonst rutscht „Universität" durch (ä ist in Python ein Wortzeichen).
- **Warnschwellen an der Wirklichkeit messen.** Die Auffälligkeit „Standort zu
  ungenau" stand zuerst bei einem Kilometer und erzeugte damit zehn von zwölf
  Warnungen für Fälle, an denen nichts zu beanstanden war (bei 2 km stimmt der
  Ortsname). Jetzt fünf Kilometer → zwei Warnungen, beide echt. Eine Warnung,
  die zu oft kommt, wird überlesen.
- **Zwei Fallen, die die Abnahme gefunden hat (07.09.2026):**
  (1) Ein Schalter für „Freigabe trotz Sperre", der den FALL ÜBERLEBT, legt nach
  dem ersten Fehlschlag die ganze Sitzung lahm — der Server verlangt zu `force`
  eine Notiz, und ohne Rücksetzen scheiterte danach jede weitere Freigabe. Ein
  Zustand auf dem Geldpfad gehört an den Fall, nie ans Werkzeug; und eine
  Aufforderung, die garantiert scheitert, darf gar nicht erst dastehen.
  (2) `precheckOf` liest `_policy` — wer ihm flache Objekte ohne dieses Feld
  gibt, bekommt „alles unauffällig" zurück. So meldete die Warteschlange 83
  gesperrte Fälle als 0, während dasselbe Urteil im geöffneten Fall korrekt
  stand. Beim Bauen verkürzter Listen IMMER `_policy` mitgeben.
- **Bilder NIE im Browser über `getDownloadURL` holen** (das war die alte
  Konsole): 7 rules-geprüfte Abrufe je Fall, und die Originale sind ~5 MB —
  34 MB pro Fall. Serverseitig zwei URLs liefern: die Kachel über die im Projekt
  installierte Extension `invertase/image-processing-api`
  (`https://us-central1-…cloudfunctions.net/ext-image-processing-api-handler/process
  ?operations=<URL-kodiertes JSON>`, Operationen input(type gcs)/resize/output)
  → ~90 KB je Bild, `cache-control: public, max-age=31536000`, zweiter Abruf
  0,15 s; das Original nur für die Lupe, per Storage-Download-Token
  (`metadata.firebaseStorageDownloadTokens`, kein signBlob nötig). Gemessen:
  516 KB statt 34 MB je Fall.
- **Backend `cloud-functions/review-console`** (europe-west1, onCall, admin-only,
  Admin-SDK — Firestore-Rules bleiben zu): `reviewListUploads`, `reviewGetUpload`,
  `reviewDecideUploads` (Batch ≤100, Transaktion je Doc, Ergebnis je ID),
  `reviewListReceipts`, `reviewGetReceipt`, `reviewDecideReceipt` (ruft
  `resolveCashbackReview` server-seitig mit `NUTRITION_SCRAPER_TRIGGER_KEY`).
  Listen: EINE Gleichheits-Query serverseitig, Rest im Speicher — bewusst
  kein Composite-Index. Storage-Rules: Lesen für `admin:true`.
- **Geld bucht die Konsole NIE selbst:** Foto-Freigabe = Status-Flip
  `pending→approved`, den `crowd-upload-reward` bucht; Bon-Entscheidungen laufen
  über den bestehenden Resolver (Caps, Ledger-Reverse).
- **Doppel-Regel** (`src/duplicatePolicy.js`, Produktentscheidung 05.09.): Referenz
  = jüngste FREIGEGEBENE Einreichung derselben EAN; innerhalb 30 Tagen nur mit
  anderen Daten (Preis, Hersteller, Markt) freigabefähig, sonst Sperre
  (`sperre_30_tage_gleicher_nutzer` / `_anderer_nutzer`); ältere offene → hold.
  Fehlende Vergleichswerte = gleich (fail-closed). Bei JEDER Freigabe frisch
  berechnet; `force` + Notiz übersteuert (am Doc `review.forced`).
  Vergleichsdaten liefert `crowd-upload-namer` (`priceOcr`, `manufacturerOcr`).
- **Neu erstellte Callables brauchen `allUsers` als `roles/run.invoker`** — der
  CLI-Deploy setzte das bei den drei Bon-Callables nicht (HTML-403 statt
  JSON-PERMISSION_DENIED = Cloud-Run-IAM, nicht unser Auth-Check). Fix:
  `gcloud run services add-iam-policy-binding <fn> --member=allUsers --role=roles/run.invoker`.
- **E2E ohne Admin-Passwort:** Functions-Emulator mit Mini-Config
  (`--config firebase.emu.json` mit nur dieser Codebase; `--only functions:<codebase>`
  filtert NICHT) + selbstgebautem JWT (`alg: none`, Claim `admin:true`) gegen die
  Prod-Firestore — nur Lese-Aufrufe. Custom-Token-Minting scheitert lokal an
  fehlendem `signBlob`.

## Cashback-Pipeline — Architektur-Map + Learnings (Task 86ca0wbg7)

Flow: `enqueueCashback` (https.onRequest; billige Pre-OCR-Dedups: Byte-Hash
`capture.hash` + Perceptual-dHash mit count+zeit-bounded Hamming-Scan) →
PubSub → `processCashback` (onMessagePublished; OCR → Reconciliation →
DocAI-Eskalation → Dedup → Gates → Ledger). Region `europe-west3`.

Docs/Collections:
- `receipts/{id}` = Haupt-Bon-Doc (OCR, capture, journey, nested
  `merchant:{id(slug),discounterId,land,name,raw,matchedScore}`).
  **Dedup prüft NUR gegen `receipts`** (contentHash/transactionHash/itemsHash =
  indizierte Equality, schließen sich selbst via `doc.id===cashbackId` aus).
- `users/{uid}/cashback_status/{id}` = schlanker Mirror — **das liest die APP**
  (Meine Bons + Ausgaben).
- `users/{uid}/purchased_products/*` = OCR-Artikel pro Bon (fürs Matching;
  Kategorie liegt unter `productData.kategorie`, Ersparnis `productData.ersparnis`,
  Hersteller `productData.hersteller` — Top-Level ist leer/0/null).
  **ACHTUNG (86caf62v6): enthält NICHT nur akzeptierte Bons.** Seit dem B2B-
  Change schreibt `writePurchasedProducts` auch valide-aber-ABGELEHNTE Bons
  (`RELIABLE_REJECT_REASONS` = bon_too_old | unknown_merchant | below_min_items),
  markiert mit `rewardEligible:false` + `bonStatus`/`rejectReason`. Nicht-erfasst
  bleiben suspekte/doppelte (not_a_receipt, reconciliation_delta, duplicate_*,
  no_bon_date, max_retries, review). Geld/Ledger ist UNBERÜHRT (nur approved
  bekommt Cashback). Der `receipt-matcher` überspringt `rewardEligible===false`
  im Auto-Trigger + Manual-Re-Match (`matchStatus:'skipped_ineligible'`, kein
  Journey-Closure / kein receiptMatch). **Wer purchased_products für B2B-/Geld-
  Metriken liest, MUSS auf `rewardEligible===true` filtern** — und `matchBacklog
  Manual` schreibt bei non-dryRun noch receiptMatch für rejected (offener
  Follow-up: dort auch auf rewardEligible filtern oder dryRun=1 fahren).
- `users/{uid}/cashback_ledger/*` = Geld-Ledger (earn/reverse/payout),
  idempotent per `receiptId`. Balance `cashback_balance_cents`/
  `cashback_lifetime_cents`; Counter `cashback_monthly`/`cashback_campaign_weekly`/
  `cashback_campaign_totals`.
- `cashback_campaigns/{slug}` = Aktionen. Feld `maxAgeDays` (Bon-Alter-Limit,
  global Default `MAX_BON_AGE_DAYS=7` — Entscheidung 05.09.2026, endgültig; der
  Mirror trägt IMMER die angewandte Grenze in `maxAgeDays`, damit die App die
  Zahl zeigt), `budgetRemainingCents`/`budgetTotalCents`,
  `cashbackPerBonCents`/`tiers`/`weeklyBonCap`/`maxPerUserCents`.

Gotchas:
- **Markt-ID-Bruch:** `produkte.discounter` = zufällige `discounter`-DocID,
  `merchantId` = Slug („edeka"). Resolver (lib/merchant.js) gibt jetzt
  `discounterId` (echte DocID) zurück → Markt-Matching + App-Logo. Frontend
  löst land-aware auf (discounterId → Slug/Name-Fallback) via
  `FirestoreService.getDiscounter()`.
- **Pfand zählt NICHT** als eligible: `isPfandItem()` in lib/ocr.js
  (`category==='Pfand'` ODER name~pfand/leergut) → in `countEligibleItems`
  + beide per-Item-`eligible`-Flags. Reconciliation UNBERÜHRT.
- **Verhungerte Bons (03.09.2026):** ~1 Bon pro 5 Tage bleibt in `ocr_pending`
  mit `attempts=0` und `updatedAt===createdAt` — processCashback hat die
  PubSub-Nachricht nie gesehen, obwohl enqueue den Publish als Erfolg meldete
  (9 Fälle, bis 41 Tage alt, in der App ewig „wird geprüft"). Ursache im
  Eventarc/PubSub-Pfad nicht belegbar (keine Logs). Abhilfe: `sweepStuckReceipts`
  (onSchedule alle 15 min) republiziert `ocr_pending` älter als 20 min, max.
  5× pro Bon (`sweptAt`/`sweepCount`). Doppelzustellung ist Noop (OCR-Cache,
  Ledger-Idempotenz, alreadyCredited). Normale Verarbeitung: p50 ≈ 40 s,
  p90 ≈ 2 min; Ausreißer bis ~17 min sind Eskalation/Cold-Start, kein Stau.
  Zweiter Befund derselben Runde: die App überschreibt den Mirror mit
  `upload_failed`/`uploading`, NACHDEM der Server final war (10 Fälle in
  45 Tagen; Queue-Retry nach Timeout, obwohl enqueue durch war) → Nutzer sieht
  „Upload fehlgeschlagen" für einen vergüteten Bon. Reparatur per
  `.fix-stale-mirrors.js`; Root-Fix (bonUploadQueue darf den Mirror nur
  schreiben, wenn dort kein Server-Status steht) ist offen.
- **Bild-Wiederverwendung trifft nur die JÜNGERE Einreichung (13.09.2026):**
  Bis dahin markierte die md5-Regel beide Seiten einer Gruppe — bei einem
  Nutzer, der denselben Artikel zweimal einreichte, fiel damit auch der
  legitime Erst-Datensatz durch. Richtig ist: pro Bildgruppe (Storage-Pfad
  oder md5, nur Identitäts-Slots) nach `createdAt` sortieren, die älteste
  behält ihre Chance, alle jüngeren gelten als Wiederverwendung. Wirkung in
  der Runde 13.09.: aus 16 Ablehnungen „bilder_wiederverwendet" wurden 7
  Freigaben plus 9 Ablehnungen unter dem fachlich richtigen Grund
  (30-Tage-Doppel-Regel, gleicher Nutzer).
- **Lauf-internen Status auch bei Ablehnung nachziehen:** Wer eine Runde
  chronologisch entscheidet, muss abgelehnte Einreichungen im Speicher auf
  `rejected` setzen — sonst sieht das jüngere Geschwister sie weiter als
  „noch offen" und bleibt grundlos auf `doppelt_eingereicht` hängen (9 Fälle
  am 13.09.). Die Konsole hat das Problem nicht, weil sie in der Transaktion
  den echten Stand liest.
- **Namens-OCR kann versagen, ohne dass die Einreichung schlecht ist
  (13.09.2026):** 23 vollständige Einreichungen trugen `productNameOcrAt`
  (der Namer lief), aber keinen Namen — bei 21 davon las ein zweiter
  Gemini-Lauf auf dasselbe Vorderseiten-Foto den Namen problemlos, und keine
  der EANs stand im Katalog (es waren also genau die Lücken-Datensätze, für
  die die Aktion zahlt). Vor einer Ablehnung wegen `kein_produktname` deshalb
  einen Rettungs-Lauf fahren (`.crowd-name-rescue-1309.js`, schreibt in ein
  EIGENES Feld `productNameRescueOcr`, damit die Messung der Namer-Qualität
  nicht verfälscht wird).
- **md5-Bilddedup NUR auf den Identitäts-Fotos (09.09.2026):** Die Regel
  „dieselben Fotos = wiederverwendet = ablehnen" darf `preis` NICHT mitzählen.
  Befund der Runde 09.09.: zwei ECHTE Sorten (K-Classic Minis Edelschimmel /
  Kümmel, eigene EANs, derselbe Markt, dieselbe Minute) teilten ausschließlich
  das Preisschild — ein gemeinsames Regal-/Aktionsschild ist plausibel. Mit
  `preis` in der Prüfmenge lehnt die Regel beide korrekten Einreichungen ab
  (und trifft dabei auch das Original, weil beide Seiten markiert werden).
  Prüfmenge deshalb: front, rueckseite, hersteller, ean, naehrwerte, zutaten.
  Die Review-Konsole hat den md5-Check bisher gar nicht — er lebt nur im
  Ops-Skript `.crowd-review-0909.js`; beim Übernehmen in die Konsole diese
  Einschränkung mitnehmen.
- **Ops-Freigaberunden ab 09.09. laufen mit den KONSOLEN-Regeln:**
  `.crowd-review-0909.js` importiert `review-console/src/duplicatePolicy.js`
  (Vollständigkeit + 30-Tage-Doppel-Regel) und schreibt dieselben Felder wie
  `reviewDecideUploads` (status, review.precheck, reviewedAt, reviewedBy,
  holdReasons, rejectReason, reviewNote mit den Konsolen-Texten). Nicht wieder
  die alten Skript-Regeln (.crowd-approve.js/.crowd-reject.js) verwenden — sonst
  entscheiden Konsole und Skript verschieden. Zusätzlich zur Konsole: md5-Check
  (siehe oben) und der Gemini-Vision-Audit; **ohne Vision-Verdict wird nicht
  freigegeben** (frische Uploads laufen noch durch die Namer-OCR und bleiben
  offen für die nächste Runde).
- **Eine Doppel-Regel MUSS eine Kopie übrig lassen (10.09.2026).** Schwester der
  Regel „Ein Status-Feld ist kein Mechanismus": dort fehlte der Trigger, hier
  entschied die Regel gegen ALLE. `crowd_uploads` enthielt 3 Gruppen (7 Docs,
  3 Nutzer), in denen jede Kopie abgelehnt war — eine als
  `bilder_wiederverwendet`, die übrigen als `doppelt_eingereicht`. Damit ging
  auch die erste, völlig korrekte Einreichung leer aus; niemand bekam für diese
  Produkte etwas. Ursache: der md5-Vergleich in `.crowd-review-0909.js`
  (`md5Map`) markiert BEIDE Seiten eines Treffers, also auch die Referenz.
  **Prüffrage bei jeder Sperr-/Doppel-/Dedup-Regel: Kann eine Gruppe entstehen,
  in der am Ende KEINE Einreichung freigabefähig ist?** Wenn ja, ist die Regel
  falsch. Konkret: die älteste Kopie einer byteidentischen Gruppe nie markieren
  (sie IST die Referenz), rein pendente Gruppen halten statt sperren, und für
  die jüngeren `doppelt_eingereicht` statt `bilder_wiederverwendet` verwenden.
  Die Konsolen-Regel macht das richtig (`duplicatePolicy.js`: ältere offene
  Kopie → `hold`, Sperre nur gegen `approved`) — beim Nachziehen des md5-Checks
  in `precheckOf` (ClickUp 86cbfvwtm) darf diese Eigenschaft nicht verloren
  gehen. Reparatur: `.crowd-doppel-original-0910.js` (je Gruppe die älteste
  Kopie `rejected → approved`, Buchung macht der Trigger; 12+15+12 ct im Ledger
  verifiziert). Gegenprobe danach: 0 EANs ohne eine zahlbare Einreichung.
  Nebenbefund aus derselben Runde: der Ablehnungstext unterstellte „dieselben
  Fotos für eine andere Einreichung verwendet" — tatsächlich hatte die App
  dieselbe Einreichung mehrfach abgeschickt. Ein Sperr-Text darf nie ein
  Verhalten behaupten, das die Daten nicht belegen (`reviewNote` ist intern,
  war hier also nicht sichtbar — die App-Texte in
  `lib/utils/productSubmissionCopy.ts` sind es).
- **Budget 0 ist keine Ablehnung, sondern ein stiller Nicht-Vorgang — auch bei
  Produktfotos (10.09.2026).** Eine der drei Nachfreigaben hing an
  `mai-juni-2026CloneClone` mit `budgetRemainingCents: 0` (Übertrag in den
  Nachfolger am 03.09.). Eine Freigabe wäre in `campaign_budget_exhausted`
  gelaufen und hätte NICHTS gebucht — exakt die 38 Fälle vom 03.09. Regel: vor
  einer Nachfreigabe das Budget der ZUGEORDNETEN Aktion prüfen und genau den
  nie ausgezahlten Betrag zurücklegen (nach der Buchung steht die Aktion wieder
  auf 0, netto verschiebt sich kein Budget) — ODER die Einreichung bewusst dem
  Nachfolger zuordnen. Niemals blind auf `approved` setzen und hoffen.
- **Produktfoto-Freigabe, Ortsangabe (03.09.2026):** Android 6.0.15 überspringt
  den Orts-Schritt bei erteilter Berechtigung (18b8cb6) und hat KEINEN Fallback,
  wenn der GPS-Fix ausbleibt → Einreichung ohne Ort, `locationGate` würde
  `no_location` → approved ohne Cent. 55 solche Uploads stehen pending mit
  `holdReasons: ort_fehlt_gps_unavailable_app_uebersprang_schritt`. Der
  Gate-Fix (`gpsStatus unavailable/timeout` → vergüten mit Grund
  `gps_fix_fehlt_schritt_uebersprungen`) ist am 03.09. mit Freigabe von Patrick
  deployt; die 55 sind freigegeben. Wizard-Fallback: ClickUp 86cbe02xm.
  Falle dabei: wer Kampagnen-Budget „in einen Topf" überträgt (Rest → 0),
  muss VORHER alle noch offenen Freigaben der alten Kampagne buchen — sonst
  läuft der Trigger ins Budget 0 und bucht still nichts (38 Fälle am 03.09.,
  Nachbuchung per `.crowd-retrigger-0903.js`). Tracking-Task: 86cbe02vk.
  Per-User-Deckel greift still: der Trigger schreibt bei „Deckel/Budget" NICHTS
  ans Doc (nur Log) — 41 Freigaben am 03.09. ohne Buchung waren korrekt
  (6 Nutzer am 5-€-Cap), sind aber nur per Ledger-Abgleich erkennbar.
- **Retry app-level (KEIN PubSub-Dead-Letter):** `MAX_PROCESS_ATTEMPTS=5`;
  transient → NICHT voreilig „rejected" (Mirror bleibt in-progress), nur
  `attempts`/`lastError` + throw; nach Max → `max_retries_exceeded`.
  **OCR-Idempotenz:** OCR sofort am Doc persistieren (`buildOcrField`), Retry
  nutzt sie → kein erneuter Gemini-Call.
- **Test-Reset eines Users:** NUR `receipts` löschen reicht NICHT (→ Doppel-
  Gutschrift, Geister-Historie, Budget-Leck). Sauber = `receipts`(des Users) +
  `cashback_status` + `purchased_products` + `cashback_ledger` + `cashback_days`
  (Tageszähler — sonst bleibt der Tag für den User gesperrt) löschen +
  User-Cashback-Felder zurücksetzen + `budgetRemainingCents` je Kampagne um den
  vom User verbrauchten Betrag (Ledger `earn`−`reverse` je `campaignId`) zurückgeben.
- **App-Reject-Texte ohne Hardcode:** Pipeline schreibt angewandte `maxAgeDays`
  in den Mirror, App zeigt die echte Zahl (pending/[id].tsx + GamificationProvider).
- **Scanner-Crop** (modules/bon-edge-detector/ios/BonVision.swift,
  `warpAndWriteJPEG`): KEIN uniformes Skalieren um den Schwerpunkt (über-padded
  bei langen schmalen Bons oben/unten). Kanten-spezifisch: `warpLeftPad=0.012`.

## Bon→Produkt-Matching — validierter Ansatz (Task 86ca0wbg7)

KI-Matcher = **markt-gefilterte Shortlist → Gemini-3.5-flash-Pick →
selbstlernendes Alias-Lexikon (`receiptAliases`)**. An 251 echten
`purchased_products`-Zeilen bewiesen: KI löst Eigenmarken-Kürzel (G&G/KLC/GL/
KB) + Markt+Preis brillant (avg conf 0,92), Pfand/Frische-Eligibility
out-of-the-box. **map-rate 26% — Flaschenhals ist NICHT die KI**, sondern
Katalog-Abdeckung (NoName Aldi/Lidl/Kaufland-lastig, EDEKA/Netto/Hofer dünn)
+ Retrieval-Recall. Die Lücken = Nachfrage-Signal für 86ca33pum (bezahlte
Erfassung). **Kosten:** KI pro NEUEM String (alias-gecacht), nicht pro Bon-Zeile
→ ~gratis bei Skalierung. Nächster Bau-Schritt: Production-Matcher-CF
(`receipt-matcher`, Trigger pro Bon → Lexikon-Lookup → Shortlist → Gemini-Pick
→ receiptAlias/receiptMatch + Journey-Closure).
</content>

## Cashback-OCR — Architektur + teure Learnings (Juni 2026)

Bon-OCR läuft **server-seitig** (`cloud-functions/cashback-pipeline`), NICHT
in der App — Metro/TestFlight/App-Version beeinflussen die Erkennung NICHT.

- **Engine-Auswahl kommt aus `.env`, NICHT aus dem Code-Default.**
  `CASHBACK_OCR_ENGINE` in `cloud-functions/cashback-pipeline/.env` überschreibt
  `const OCR_ENGINE = (process.env... || 'default')`. Ich habe einmal nur den
  Code-Default geändert + deployed → wirkungslos, weil `.env=cv-hybrid` gewann.
  **Beim Ändern der Engine IMMER `.env` anfassen, nicht nur den Code.** (Deploy-
  Log zeigt „Loaded environment variables from .env" — das ist der Hinweis.)
- **Default-Engine = `gemini-direct`** (Bild → Gemini, `lib/ocr.js` +
  `lib/prompt.js` v1.3 + `lib/ocr_robust.js`). **`cv-hybrid`** (Cloud Vision
  flat-text → Gemini, `lib/ocr_cvhybrid.js` + `lib/prompt_text.js`) ist NUR
  Rollback: Cloud Vision linearisiert vertikal **versetzte Preis-Spalten**
  falsch interleaved (Namen/Preise vertauscht) → die Geometrie ist im flachen
  Text verloren, kein Text-Prompt rettet das. **Beim OCR-Validieren IMMER die
  ECHTE Prod-Engine testen, nicht den Legacy-Pfad** (ich habe erst `prompt.js`
  gefixt+validiert, während Prod `cv-hybrid` lief → Fix griff nie).
- **Robust-OCR (`lib/ocr_robust.js`):** liest das Bild mehrfach, vertraut dem
  was unabhängige Läufe auf **Sequenz-Ebene** (`name#priceCents`) übereinstimmen
  (fängt Swaps/Kompensation die Σ==Total NICHT sieht). Early-stop bei 2er-
  Agreement; sonst Eskalation auf `gemini-2.5-pro`. `confidence` (high/medium/
  low/none) landet in `receipts/*.ocr.robust`.
- **Σ(items)==totalCents ist KEIN vollständiges Korrektheits-Orakel** (Swaps +
  kompensierende Fehler + Pfand-Toleranz ±200ct bleiben unsichtbar). Auto-
  Freigabe sollte langfristig zusätzlich an `ocr.robust.confidence==='high'`
  hängen + low → User-Tap/Review.
- **Modell:** `gemini-3.5-flash` primär, `gemini-2.5-pro` Eskalation. An echten
  Bons: 3.5-flash 30/42 reconcile-clean vs 2.5-flash 18/42; pro ~33% teurer.
- **„Billig zuerst" (Phase-0 ohne Denken) ist ENDGÜLTIG No-Go (2× gemessen,
  08/2026):** Runde 1 (60 Juli-Bons): 2 falsch akzeptiert; Runde 2 (100 frische
  Bons, Kurz-Bon-Schranke ≤25 Artikel): 4 falsch akzeptiert (davon 3 KURZE Bons
  — die Schranke hilft nicht) bei nur 50,5 % Phase-0-Ausbeute. Regel war
  „falsch akzeptiert muss 0 sein". Thinking-Budget 0/1024 wird vom Modell
  zudem geclampt. Die Konsens-Lesungen brauchen das Denken — hier NICHT sparen.
  Der stattdessen gebaute Spar-Hebel ist der **Eskalations-Deckel**
  (`opts.escalationGate` in ocr_robust.js + Gate-Closure in index.js): kappt
  Enhance/Pro/DocAI für Bons, die laut ≥2 unabhängigen Basis-Lesungen sicher
  an Policy-Gates scheitern (deutlich zu alt mit +14-Tage-Marge / Markt auf
  allen Lesungen unbekannt). Kill-Switch `CASHBACK_OCR_ESCALATION_CAP=false`.
  Entscheidung trifft weiter NUR der Gate-Block; gedeckelte Ergebnisse tragen
  confidence low/none → Review-Gate fängt Drift (nie Auto-Payout).
- **Bildqualität ist der eigentliche Engpass** (Knicke durch Ziffern), nicht das
  Modell-Reasoning. 2×-Upscale+Kontrast+Schärfen hebt harte Bons messbar
  (1/6→5/6) — noch NICHT in der Pipeline (bräuchte `sharp`).
- **Testen:** ein NEU fotografierter Bon läuft frisch; exakt dasselbe Bild-File
  trifft per Dedup (`receipts` contentHash) das alte gecachte Ergebnis.

## `thinkingBudget` bei gemini-3.5-flash nicht mehr nutzen — `thinkingLevel` (24.09.2026)

Vertex lehnt seit dem 22.09.2026 ~13 Uhr UTC einen TEIL der Anfragen mit
`thinkingConfig: { thinkingBudget: 0 }` ab: 400 „Thinking budget is not
supported for this model" (gemessen 4 von 15 Anfragen mit denselben Bildern —
eine schrittweise ausgerollte Modellversion, bei uns hatte sich nichts
geändert). Der Produktfoto-Namer (`crowd-upload-namer`) speicherte jeden Fehler
als „kein Name, kein Preis, kein Hersteller", ohne zweiten Versuch: 47
Einreichungen mit einwandfrei lesbaren Fotos, in der Konsole „(ohne Name)",
und die Morgenrunde lehnte bei uneiniger Nachlesung mit `kein_produktname` ab.
Regeln:
- Denken über `thinkingConfig: { thinkingLevel: 'LOW' }` steuern (Namer und
  Morgenrunde tun das; 15/15 Anfragen ok). Denk-Token zählen zu
  `maxOutputTokens` — 512 ist dafür zu knapp.
- Ein KI-Aufruf, dessen Ergebnis dauerhaft am Dokument landet, braucht
  Wiederholung bei 429/5xx/Netz/abgeschnittenem JSON und bei endgültigem
  Scheitern einen Fehler-VERMERK (`productNameOcrFehler`) — nie „leer" als
  Ergebnis speichern. Sonst sieht ein technischer Fehler aus wie „nicht lesbar".
- Seit 24.09. ebenfalls auf `thinkingLevel: 'LOW'` umgestellt (vorsorglich,
  sie zeigten den Fehler noch nicht): `receipt-matcher/matcher.js`,
  `ai-product-comparison/src/{comparator,assessor,manufacturer}.js`. Im Repo
  steht kein `thinkingBudget: 0` mehr — nicht wieder einführen.
- Diagnose-Rezept: `gcloud logging read '"Thinking budget"'` über alle Dienste;
  eine Stunden-Zeitreihe der Fehler gegen die Erfolge zeigt, ab wann Google
  umgestellt hat.

## Gemini läuft über VERTEX AI, nicht AI Studio (Incident 19.08.2026)

**Was passiert ist:** Der AI-Studio-Monatsdeckel („monthly spending cap",
Stufen-Limit des Rechnungskontos, ~219 €) wurde erreicht → **ALLE Gemini-Keys
des Kontos** (eigener Key UND alter crapsnap-Key) lieferten 429
RESOURCE_EXHAUSTED. Der Deckel gilt KONTOWEIT (StuByteFlexCo) und ist **nicht
manuell anhebbar** (Google stuft nur automatisch hoch). Key-Rotation/Rollback
ist bei diesem Fehler ZWECKLOS — erst per Direkt-Curl beweisen, WELCHER Scope
gesperrt ist, bevor man Keys tauscht.

**Fix (deployt 19.08.):** Alle 5 Gemini-Codebases (cashback-pipeline,
receipt-matcher, ai-product-comparison, crowd-upload-namer, image-cleanup)
nutzen `new GoogleGenAI({ vertexai: true, project, location })` — läuft übers
GCP-Projekt-Billing (Startup-Guthaben), kennt den AI-Studio-Deckel nicht.
Rückschalter: `GEMINI_USE_VERTEX=false` in der jeweiligen `.env` → alter
Key-Pfad (Secret GEMINI_API_KEY bleibt gebunden).

**Vertex-Modell-Verfügbarkeit ist PRO LOCATION verschieden (19.08. geprüft):**
- `gemini-3.5-flash`, `gemini-2.5-flash-image`, `gemini-embedding-001` (via
  SDK `embedContent`; REST nur `:predict`): NUR `global`.
- `gemini-2.5-pro` (Robust-OCR-Eskalation): NICHT unter `global`, nur regional
  → `GEMINI_VERTEX_LOCATION_PRO`, Default `europe-west4` (Client-Factory in
  lib/ocr.js ist modell-bewusst). Bei neuen Modellen IMMER erst curl-Test
  gegen die Ziel-Location, 404 heißt „woanders publiziert".
- `gemini-3-pro-image-preview` (image-cleanup Retry-Stufe B): auf Vertex
  NIRGENDS → schlägt unter Vertex fehl (Item endet 'failed'); Nachbearbeitung
  via retry-failures.js mit GEMINI_USE_VERTEX=false wenn der Cap frei ist.
- Embeddings sind zwischen AI Studio und Vertex **byte-identisch** (Kosinus
  1.0000 gegen Bestandsvektoren verifiziert) → Vektor-Index kompatibel.

**Der eigentliche Bug (gefixt 19.08.):** ocr_robust.js verschluckte geworfene
Lese-Versuche (`catch { continue; }` ohne Log). Bei Totalausfall lieferte
Phase 4 den `isReceipt:false`-Stub → Nutzer sah fälschlich „kein Kassenbon".
**Es gab bis dahin NIE eine echte not_a_receipt-Ablehnung** — alle 53 waren
verschluckte Infrastrukturfehler (Marker: `ocr.robust.attempts == 0` = OCR
lief nie). Jetzt: leere reads → Error `code:'ocr_unavailable'` → index.js
behandelt transient (Retry), nach MAX_PROCESS_ATTEMPTS → Status **'review'**
(reviewReason 'ocr_unavailable'), NIE 'rejected'. Regel: ein Infrastruktur-
fehler darf nie als inhaltliche Aussage über User-Daten enden. Reprocessing
abgelehnter Bons: `ocr`-Feld LÖSCHEN (sonst re-used der Retry den kaputten
Cache), Status auf 'ocr_pending', Message mit `{cashbackId, uid}` (BEIDE
Pflicht) auf Topic `cashback-ocr-jobs` republishen.

## Sim-Testing: NUR wenn's wirklich nötig ist (User-Vorgabe 2026-06-12)

Screenshot-Loops im Simulator verbrennen massiv Tokens. Default-Vorgehen
bei Bugfixes: **logisch vorgehen** — Code lesen, Root-Cause herleiten,
Fix + Callsite-Audit (z.B. "wer ruft das ohne catch"), tsc-Baseline.
Sim/Screenshots nur einsetzen, wenn die Hypothese sich NICHT aus dem
Code beweisen lässt (z.B. natives Rendering-Verhalten, Gesten-Hit-
Targets) oder der User explizit drum bittet. User-Wortlaut: "nicht die
ganze zeit im sim testen - das verbrennt tokens ohne ende … du kannst
das schon machen aber nur wenns sinn macht." Qualität bleibt gleich —
die Beweisführung läuft über Code-Review statt Screen-Staring.

## Sim-Testing headless: Taps, echtes Offline, RevenueCat-Falle (2026-06-11)

Erarbeitet beim Offline-Resilienz-Test (86ca7uguc) — damit sind
autonome UI-Tests im Simulator OHNE manuelles Klicken möglich:

- **Taps/Texteingabe im Sim headless**: `idb` (Facebook iOS-Bridge).
  Setup: `brew install facebook/fb/idb-companion` + `/usr/bin/python3
  -m pip install --user fb-idb` (NICHT Python 3.14 — asyncio-Bruch;
  System-Python 3.9 funktioniert → Binary liegt in
  `~/Library/Python/3.9/bin/idb`). Nutzung: `idb ui tap --udid <UDID>
  <x> <y>` (LOGISCHE Punkte, nicht Screenshot-Pixel! iPhone 16 =
  393×852), `idb ui text "..."`, `idb ui key 40` (=Enter).
  Screenshots via `xcrun simctl io <UDID> screenshot` (Pixel →
  fuer Tap-Koordinaten durch Scale teilen). osascript/cliclick
  scheitern an fehlender Accessibility-Permission.
- **Echtes Offline-Testen**: Mac-Netz kappen, aber NUR innerhalb
  EINES Bash-Calls mit `trap restore EXIT` (sonst stirbt die eigene
  Session). WICHTIG: `networksetup -setairportpower en0 off` reicht
  NICHT — macOS failt auf USB-LAN/iPhone-Tethering over. ALLE
  Services deaktivieren (`-setnetworkserviceenabled "USB 10/100/1000
  LAN" off` + iPhone + Thunderbolt Bridge + Wi-Fi) und IM Fenster mit
  `curl -m 4` verifizieren ("wirklich offline"). Sim-Statusbar-Icon
  ist NICHT verlaesslich.
- **Deep-Link auf dieselbe Route remountet nicht** (expo-router) —
  fuer frische Lade-Effekte eine NEUE Param-ID verwenden.
- **RevenueCat im Simulator**: `restorePurchases()` (und tlw. schon
  StoreKit-Zugriffe) triggern im Sim einen ENDLOS-Sandbox-Apple-ID-
  Prompt ("Bei Apple Account anmelden"), der jede Session ueberlagert
  und sich nicht killen laesst (AuthenticationServicesUI respawnt).
  Darum: Boot-Restore nur `if (Device.isDevice)` (expo-device) —
  steht in RevenueCatProvider. Frischer Test-Sim: `simctl create` +
  App aus DerivedData installieren + Dev-Client-Deep-Link
  (`markendetektivern://expo-development-client/?url=...`).

## Play Developer Reporting API (Crash-/Vitals-Analysen) — Fallen + Tooling

Helper: `scripts/play-vitals/play_api.py` (JWT aus Play-SA
`markendetektive-895f7-ee3923910ddd.json`, Scope `playdeveloperreporting`,
Token-Cache + 503-Retry). Vollständige Analyse-Methodik + Referenz-Abfragen:
`docs/CRASH_ANALYSIS_6011_2026-07-20.md` (Anhang A/B). Die teuren Fallen:

- **`errorIssues:search`/`errorReports:search` sind GET** (Filter als
  URL-encodete Query-Params). Ein POST liefert eine generische 404-HTML-Seite —
  sieht aus wie „Endpoint nicht verfügbar", ist nur die falsche HTTP-Methode
  (hat am 20.07. fast zur Fehldiagnose „API nicht freigeschaltet" geführt).
- **DAILY-Metric-Queries brauchen `timeZone {id:"America/Los_Angeles"}`** in
  start/endTime — sonst kommt **stillschweigend `{}`** statt eines Fehlers.
- `FULL_RANGE` existiert für crashRate/anrRate nicht (nur HOURLY/DAILY);
  `errorCountMetricSet` verlangt Dimension `reportType`.
- **`firstAppVersion`/`lastAppVersion` sind intervall-/filterbezogen.** Eine
  auf `versionCode = X` gefilterte Abfrage zeigt IMMER first=X — für „seit wann
  existiert dieser Crash?" ungefiltert + langes Fenster (Issue-IDs sind
  versionsübergreifend stabil) abfragen.
- `distinctUsers` gerundet; `errorReports` sind Samples. GA4-BigQuery-Export
  hat KEINE `app_exception`-Events, Crashlytics-BQ-Export nicht aktiviert →
  Play-API ist die einzige programmatische Crash-Quelle.
- **Bekannter Top-Crash der App** (Stand 07/2026): `561a7ca7…` = nativer
  `JavaTurboModule::setEventEmitterCallback`-Crash beim Setup des
  AdMob-TurboModules, NUR armeabi_v7a-Geräte (Galaxy A13 & Co. — 32-bit-
  Userspace trotz arm64-CPU, von Google-CDD bei 2–4 GB RAM so empfohlen),
  existiert seit vc 1065 — NICHT durch den 6.0.11-Banner-Patch abgedeckt.
  **Root-Cause = RN-Core-Bug (variadisches JNI `CallVoidMethod` auf 32-bit),
  gefixt in react-native 0.79.6 — unser 0.79.5 ist die LETZTE Version ohne
  den Fix.** Fix-Pfad: `npx expo install --fix` (Expo SDK 53 pinnt selbst
  0.79.6; 0.79.7 = letzte 0.79.x, nimmt noch einen Fabric-Soft-Error-Fix
  mit) + neuer EAS-Build (C++-Fix in libreactnative.so, NICHT per
  patch-package nachrüstbar). Crash zeigt sich NUR in signierten
  Release-Builds auf 32-bit — lokal/Debug nie reproduzierbar. Belege:
  RN #51628 / PR #51695, invertase#754 (A13 + 0.79.6-Bestätigungen),
  stripe#2091. Details §9 der Analyse-Doc
  (`docs/CRASH_ANALYSIS_6011_2026-07-20.md`).

## Bewertungs-Prompts (In-App-Review) — Regeln + Fallen

Play stand 07/2026 bei **3,44★** (545 Bewertungen, davon 146× 1★), iOS bei
4,02★ — obwohl die App gut ist: die zufriedene Mehrheit wurde nie gefragt.
Aktueller Stand: Auto-Prompt = **nativer Dialog direkt**, ausgelöst nach dem
ersten Erfolg + Walk-Through (`lib/services/firstCaseService.ts`, ClickUp
86cav7gqm) sowie beim Level-Up ≥3 (`ratingPrompt.ts`).

- **PRODUKTENTSCHEIDUNG (02./03.09.2026, endgültig): Der Dialog nach dem
  ersten Fall bleibt — auch wenn er beim Neu-Nutzer über den Walkthrough-Demo-
  Tap binnen 1–2 Minuten kommt. KEIN Reife-Gate (Sessions/Tage/Scans) bauen,
  nicht mehr als Bug flaggen** (ClickUp 86cbc0kyq wurde dafür rejected).
  Datenlage (Stand 03.09.): App-Store-Text-Rezensionen vorher/nachher (1.5.–
  25.7. vs. 26.7.–2.9.) Ø 1,5 → 3,5, 0 → 3 Fünf-Sterne bei je n=6; Trichter
  `ratingFunnelEvents` seit 1.8.: 18.148 Dialog-Anfragen, 52 % binnen 5 min
  nach Kontoerstellung, 90 % auf Level ≤ 2, genau EINE Beschwerde (Play, 31.8.).
  Harte Store-Regeln (3/365, keine Vorfrage, kein Incentive) sind eingehalten;
  nur die Empfehlung „erst nach Engagement" nicht — das ist kein Ablehnungs-
  grund. Der Play-Gesamttrend ist per API NICHT abrufbar (nur Console).
  Was davon unabhängig offen bleibt (S, optional): drei kontextfreie Pfade
  prompten ~3 s nach App-Öffnen ohne Feier (Resume mit offener Sequenz, Level-
  Up-Flag beim Kaltstart, 30-Tage-Re-Feier ohne Produktseite) — das ist der
  Pfad, der zur „3 Sekunden"-Rezension passt; und das Telemetrie-Label
  (GamificationProvider ruft markCelebrated VOR getCelebrationContext → alles
  wird `veteran_case`). Beides darf man schließen, ohne den Erst-Fall-Dialog
  anzutasten.
- **NIEMALS eine Vorfrage vor dem nativen Dialog** („Gefällt dir die App?" →
  Weiche). Google verbietet das **wörtlich** in den In-App-Review-Guidelines
  („shouldn't ask the user any questions before or while presenting the rating
  card"), bei Apple ist es Grauzone (5.6.1), und in DE ist selektive
  Bewertungsaufforderung **UWG-riskant** (Irreführung, abmahnbar). Steuerung
  läuft AUSSCHLIESSLICH übers Timing. Das `AppRatingModal` (mit Sentiment-
  Funnel) ist nur noch der MANUELLE Pfad (Profil → „App bewerten") — dort
  unkritisch, weil user-initiiert. Es darf NIE in den Auto-Pfad zurückkehren.
- **NIE Punkte/Belohnungen an eine Bewertung koppeln** (Apple 3.2.2(x),
  Play-Policy, UWG). Auch nicht indirekt: der Erst-Fall-Feier-Banner trägt
  bewusst KEINE Punkte-Pill, weil er unmittelbar vor dem Dialog läuft.
- **Budget erst NACH dem Aufruf verbuchen.** `requestReview()` ist auf beiden
  Plattformen fire-and-forget ohne Rückkanal — ein `true` beweist nur „hat
  nicht geworfen", nicht dass die Karte erschien. Wer vorher verbucht,
  verbrennt bei jedem blockierten Versuch (Modul fehlt, App im Hintergrund,
  Sheet offen) das 1×-pro-App-Version-Budget, ohne dass je ein Dialog kam.
  Version-Riegel zusätzlich **uid-frei** halten (`nativeReviewAskedVersion_global`),
  sonst umgeht ein Logout + neuer Anonymous-Sign-In das Budget.
- **Manueller „Bewerten"-Button → Store-Deep-Link, nicht die API** (Apple:
  „Avoid requesting a review as the result of a user action"; bei Google kann
  das Quota verbraucht sein → es passiert dann still gar nichts). iOS mit
  `?action=write-review`.
- **Jedes Gate braucht eine Gegenkante.** Ein Prompt, der wegen offenem Sheet /
  laufender Tour / Hintergrund abgelehnt wird, muss später erneut evaluiert
  werden (Bus-Tick, AppState-Listener) — sonst bleibt er für immer liegen.
  Und: ein Abbruch darf NIE den Trigger verbrauchen (sonst verliert genau die
  Gruppe den Prompt, bei der es einmal nicht passte).
- **Feier-Kopplung NICHT an `first_action_any` hängen.** Dieses Achievement ist
  im Standard-Funnel schon vom **Walkthrough-Demo-Tap** verbraucht (Demo-Karte
  → Produktseite → `trackAction('view_comparison')`), also lange vor dem ersten
  eigenen Scan. Wer „erster Erfolg" daran hängt, feiert im falschen Moment.

## `isAnySheetOpen()` sieht das Umfrage-Sheet NICHT

`components/survey/SurveyProvider.tsx` präsentiert ein echtes RN-`<Modal>`
(FilterSheet), registriert sich aber bewusst mit `registerPresence={false}` im
Zähler (sonst blockierte es sich selbst). Es ist damit für `isAnySheetOpen()`
**unsichtbar** — und `requestActionSurvey` läuft nach JEDER Aktion, also auch
beim allerersten Scan. Wer ein zweites Modal oder einen System-Dialog
präsentiert, MUSS zusätzlich `isSurveyVisible()` aus
`lib/services/sheetPresence.ts` prüfen (sonst Zwei-Modal-Deadlock bzw. still
verschluckter System-Dialog).

## Push: Link, Berechtigung, Deploy — drei Fallen aus dem 17.09.2026

**1. Ein Deep-Link hat zwei Seiten — nie nur eine prüfen.** Vom 19.08. bis
17.09. schickte `sendCashbackReady` `markendetektivern://cashback/pending/<id>`,
der App-Resolver entfernte nur `markendetektive://` (ohne „rn"). Jeder Tap
landete auf der Startseite, obwohl der Tap-Fix 86cb7gfc9 „fertig" war. Regel:
Server-Link und Resolver hängen an einem Vertragstest
(`lib/services/__tests__/pushDeepLinkVertrag.test.ts` lädt
`cashback-pipeline/lib/pushLinks.js`). Links als Pfad (`/cashback/pending/<id>`)
schicken, nicht als Schema. Und Kaltstart-Taps vormerken, bis die erste Route
steht: `app/index.tsx` ersetzt sonst per `replace('/(tabs)')` das Ziel.
Android meldet jeden Tap doppelt (expo-notifications + RNFB) → Duplikatsperre
in `pushDeepLinks.ts` nicht entfernen.

**2. expo-notifications `denied` heißt auf Android 13+ NICHT „abgelehnt".**
`getPermissionsWithPromiseImplApi33` prüft `!areNotificationsEnabled()` vor
„undetermined" — eine nie angefragte Berechtigung kommt als `denied`. Bis 6.0.17
wurde deshalb kein Android-13+-Nutzer je gefragt (7.362 Konten). Immer
`canAskAgain` mitlesen (`pushPermissionStatus.ts`). RNFB `hasPermission` kennt
auf Android nur 1/0. Und nach `harteBerechtigungAnfragen` NIE einen zweiten Weg
laufen lassen, der selbst fragt (`pushNotificationService.initialize`) —
Android zeigt den Dialog sonst sofort erneut, und die zweite Ablehnung ist
endgültig.

**3. Vor einem Functions-Deploy den DEPLOYTEN Stand vergleichen, nicht nur den
Working Tree.** Am 17.09. lief die cashback-pipeline auf `e1c2030`
(Zweitprüfung 86cbfvwge, Branch `claude/quirky-morse-a8d24d`, nicht gemergt).
Ein Deploy aus `feat/rnfirebase-migration` hätte die Zweitprüfung still aus der
Produktion entfernt. Prüfung ohne Risiko:
```bash
gcloud functions describe processCashback --region=europe-west3 --gen2 --project=markendetektive-895f7 \
  --format="value(buildConfig.source.storageSource.bucket,buildConfig.source.storageSource.object)"
# Zip holen (gcloud storage cp), entpacken, index.js + lib/ gegen den Deploy-Stand diffen
```
Weicht es ab: aus einem Worktree auf dem deployten Commit + eigener Änderung
deployen (`.env` hineinkopieren — sie ist nicht im Git) oder erst mergen.

**4. Eine Nebenwirkung (Push, Mail) hängt am Ergebnis der Transaktion, nie an
einem vorab gelesenen Zustand (24.09.2026).** Bis dahin prüfte der Bon-Push
`!alreadyCredited` — gelesen VOR der Ledger-Transaktion. Zwei gleichzeitige
Läufe sahen beide „noch nicht gebucht", einer buchte, beide schickten
„Ka-ching!". Und Pub/Sub stellt dieselbe Nachricht wirklich doppelt zu, mit
DERSELBEN Event-ID und parallel (seit 08.09. sechsmal, fünfmal überlappend):
las der zweite Lauf die OCR anders, stornierte er die schon gemeldete
Gutschrift. Mit dem Live-Code nachgestellt, in Produktion bis dahin ohne
Schaden. Regeln:
- Die Buchungsfunktion sagt, ob SIE gebucht hat (`syncLedgerForReceipt` →
  `frischGebucht`); nur darauf reagieren. Zusätzlich ein Merker am Dokument in
  einer Transaktion (`gutschriftPushAt`, bei Fotos `rewardPushSentAt`).
- Wer einen Bon verarbeitet oder entscheidet, meldet sich in einer Transaktion
  am Dokument an (`lib/laufAnspruch.js`): gleiche Event-ID parallel → nichts
  tun; Konsole entscheidet nicht, solange ein Lauf rechnet; Pipeline rechnet
  nicht, solange die Konsole entscheidet; der Kehrlauf legt keinen Bon neu auf,
  an dem gerade ein Lauf rechnet.
- Eine Statusprüfung („nur `review` ist auflösbar") außerhalb einer
  Transaktion schützt vor nichts, sobald zwei Menschen oder ein Mensch und ein
  Skript gleichzeitig klicken.
- Ein Trigger, der bei Lesefehlern wirft, „damit erneut zugestellt wird",
  braucht `retry: true` — sonst ist der Wurf ein stilles Verwerfen
  (crowd-upload-reward lief bis 24.09. mit RETRY_POLICY_DO_NOT_RETRY). Und eine
  Wiederholung wertet das ALTE Ereignis aus: den aktuellen Status in der
  Buchungs-Transaktion mitlesen.

## Meta-Regel: Support-Sessions — antworten, NICHT selbst fixen

Sessions, in denen der User App-/Support-Anfragen (Kontaktformular,
Store-Rezensionen, Kunden-Mails) reinkopiert, sind **ausschließlich
zum Beantworten** da. Default-Output ist die fertige Antwort an den
Kunden — kein Code-Change, kein Refactor, kein Deploy.

**Was ich trotzdem beibehalte** (der User findet das ausdrücklich gut):
Bei der Recherche fürs Beantworten stoße ich regelmäßig auf echte
Bugs und habe direkt eine Fix-Idee. Die soll ich weiterhin liefern —
aber **als ClickUp-Task**, nicht als Implementierung.

Konkret:
1. Ursache sauber am Code verifizieren (`datei:zeile`), damit die
   Antwort an den Kunden stimmt.
2. Fund + konkreten Fix als **ClickUp-Task** im DevBacklog anlegen
   (Liste `901506173503` = MarkenDetektive_DevBacklog). Beschreibung
   so schreiben, dass eine **andere Session ohne diesen Kontext**
   damit sofort arbeiten kann: Symptom, verifizierte Ursache mit
   Zeilenankern, konkreter Fix, Verifikations-Checkliste.
3. Dem User im Chat kurz sagen, was angelegt wurde — und **nicht**
   anfangen zu implementieren.

**Ausnahme:** Der User sagt explizit, ich soll darüber hinaus etwas
tun ("fix das", "mach das", "setz das um"). Dann normal umsetzen.

Datenkorrekturen am Kundenkonto (Kulanz-Gutschrift, Level-Freigabe
o.ä.) sind KEIN Dev-Work in diesem Sinne — die gehören zum
Beantworten dazu, brauchen aber weiterhin das Okay des Users.

## R8 ist seit 6.0.19 an — und die Pauschalregeln waren die Ursache (20.09.2026)

Play meldete für 6.0.17 „DEX-Codeoptimierung: Verschleierung 2 %" (Grenzwert 25 %,
Frist Februar 2027). Ursache war eine fehlende Zeile: `android.enableProguardInReleaseBuilds`
stand nirgends, also lief jeder Release mit `minifyEnabled false`. Jetzt gesetzt in
`android/gradle.properties`; gemessen an `mapping.txt`: **59,1 % der 44.678 Klassen umbenannt**.

**Die wichtigste Erkenntnis ist die umgekehrte Richtung:** Die zehn Pauschalregeln
`-keep class <paket>.** { *; }`, die in `proguard-rules.pro` standen, hätten 24.369 Klassen
(37 % des DEX) von der Umbenennung ausgenommen — `com.google.android.gms.**` allein 22 %.
Alle zehn waren überflüssig, weil die Bibliotheken ihre Regeln selbst mitliefern
(`consumerProguardFiles` bzw. `proguard.txt` im AAR). **Vor jeder neuen Keep-Regel erst
prüfen, ob die Bibliothek sie schon mitbringt:**
```bash
grep -n consumerProguardFiles node_modules/<lib>/android/build.gradle
unzip -p ~/.gradle/caches/modules-2/files-2.1/<gruppe>/<artefakt>/*/*/<x>.aar proguard.txt
```
Nie wieder eine Pauschalregel über einen großen Paketbaum zurückholen — sie arbeitet direkt
gegen die Play-Kennzahl.

**Zwei Mechanismen, die man NICHT nachbauen muss** (beide am Artefakt belegt):
aapt2 erzeugt Keep-Regeln für jede im Manifest per `android:name` deklarierte Komponente,
und die AGP-Standarddatei hält `native <methods>`, Enums, Parcelable-CREATOR und
`@JavascriptInterface`. **Aber:** Klassennamen in `android:value` sind NICHT gedeckt —
deshalb braucht `RNHeadlessAppLoader` eine eigene Regel. Bei neuen Bibliotheken prüfen:
```bash
grep -oE 'android:value="[a-z][a-zA-Z0-9_.$]*\.[A-Z][a-zA-Z0-9_.$]*"' \
  android/app/build/intermediates/merged_manifest/release/*/AndroidManifest.xml
```

**Vier Fälle, die still gebrochen wären** (Details je Regel in `proguard-rules.pro`):
Hermes-Intl (libhermes.so sucht 5 Klassen per JNI über den Namen, kein Java-Code
referenziert sie → R8 **löscht** sie → jedes `toLocaleString('de-DE')` bricht);
`ExpoModulesPackageList` (nur per `Class.forName`, alle Aufrufer fangen die Exception ab
→ App startet ohne ein einziges natives Expo-Modul, ohne Fehlermeldung);
expo-notifications-Parcelables (Klassenname steht im Parcel → Tap auf eine beim Update
offene Nachricht stürzt in `NotificationForwarderActivity.onCreate` ab);
`FirebaseAnalytics.setConsent` (UMP reicht die Einwilligung per Reflection dorthin weiter
→ ohne Schutz erhebt die App weiter Analytics, obwohl der Nutzer abgelehnt hat).
Gemeinsames Muster: **kein Absturz im Debug, kein Aufrufer im Code, kein Test schlägt an.**

**Prüfschritt, der sich gelohnt hat — R8 EINMAL LOKAL laufen lassen**, bevor ein EAS-Build
startet. Das ist die bewusste Ausnahme von „keine lokalen Release-Builds": es geht nicht um
ein Artefakt, sondern um die Diagnosedateien, die es sonst nirgends gibt.
```bash
cd android && JAVA_HOME=/usr/local/opt/openjdk@17 ANDROID_HOME=$HOME/Library/Android/sdk \
  ./gradlew :app:minifyReleaseWithR8 --console=plain --no-daemon   # ~11 min
```
Danach in `android/app/build/outputs/mapping/release/`: `missing_rules.txt` (existiert nur bei
Fehlern — AGP 8.13 macht aus fehlenden Klassen einen **Fehler**, der Build stirbt),
`configuration.txt` (vollständig gemergte Regelmenge — damit ist jede Annahme über fremde
Regeln prüfbar statt geglaubt), `usage.txt` (alles, was R8 **entfernt** hat),
`mapping.txt` (Verschleierungsquote direkt messbar). `android/app/build/` ist in `.easignore`,
die Reste stören den EAS-Upload also nicht.

**`shrinkResources` bleibt AUS.** Zweite, unabhängige Fehlerquelle (Ressourcen, die nur per
`getIdentifier()` angesprochen werden). Wenn das mal kommt, dann als eigener Release.

### Reflexion unter R8: der eine Test, der entscheidet (Nachtrag 20.09.2026)

**R8 schreibt Reflexions-Zeichenketten MIT UM, wenn der Klassenbezug statisch im
Code steht.** `ReactActivityDelegate::class.java.getDeclaredField("mReactDelegate")`
funktioniert deshalb weiter — R8 benennt das Feld um *und* ersetzt das Literal;
im DEX von Build 1242 kommt „mReactDelegate" 0-mal vor. **Nicht** umschreiben kann
R8, wenn die Klasse erst zur Laufzeit feststeht: `fragment.getClass().getMethod(…)`,
`classLoader.loadClass("…")`. Dort bleibt das Literal stehen, das Ziel wird
umbenannt, der Zugriff scheitert — und praktisch immer lautlos, weil solche Stellen
ihre Ausnahme abfangen.

**Der Test dauert zwei Befehle und beendet jede Diskussion:**
```bash
strings classes*.dex | grep -F "<literal>"     # Literal noch da?
grep "<name>" mapping.txt                       # Ziel umbenannt?
```
Beides ja = echter Bruch. Literal weg = R8 hat es mitgezogen, nichts zu tun.
**Nie eine Keep-Regel aus einer Quelltext-Fundstelle allein ableiten** — das
produzierte in dieser Runde einen Fehlalarm („Startabsturz auf jedem Gerät"), der
sich am installierten Release-Build in 30 Sekunden widerlegen ließ.

**Gefunden hat dieser Test drei echte Fälle** (alle in `proguard-rules.pro` 6c/5):
`ScreenFragment.getScreen()` (Reanimated → Tab-Übergänge tot),
`FirebaseRemoteConfig` (Analytics löscht den Rollout-Zustand),
`Screen.getActivityState()` (überlebte nur zufällig).

**Nicht verwechseln:** Der `NoSuchFieldException: No field mIsFinished` im logcat
kommt **nicht** von R8 — RN 0.79.7 hat `MessageQueueThreadImpl` auf Kotlin
umgestellt, das Feld heißt dort `isFinished`. Reanimated sucht den alten Java-Namen,
der Fehler steht auch in 6.0.18 im Log. Keine Keep-Regel dafür bauen, sie träfe ins Leere.

**Abnahme eines R8-Releases gehört auf ein echtes Gerät**, nicht in den Debug-Build:
AAB → `bundletool build-apks --mode=universal` → `adb install` → starten, durchklicken,
`logcat` auf `FATAL` und `[Reanimated]` prüfen. Nur dort zeigen sich Verschleierungsfehler.
