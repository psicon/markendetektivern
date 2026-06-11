# Plan: Gamification serverseitig (Option E)

Ziel: Den Client-Write-Burst beim „gekauft markieren" eliminieren (= der nachgewiesene
Auslöser des nativen Firestore-WatchStream-Stalls), Gamification robust + serverseitig
machen, Instant-Feedback behalten. iOS unberührt, Journey-Tracking unberührt, Migration bleibt.

---

## 1. Kernidee / Architektur

Heute (Client macht ~14 Firestore-Ops pro `complete_shopping`):
```
mark gekauft → trackAction() → trackGameActionPoints()
   4× Anti-Abuse-Queries (ledger) + addDoc(ledger) + getDoc(user) + updateDoc(user)
   + Achievement-Batch + checkAndUpdateLevel (getDoc+updateDoc) + leaderboard (getDoc+setDoc)
   + updateUserStats (savings)  ← separate
= Write-Burst → stallt den nativen gRPC-Stream → alle Reads hängen
```

Neu (Client macht 1 kleinen Write):
```
mark gekauft
   → Client: OPTIMISTISCH "+X Punkte"-Toast sofort (lokal gerechnet, nur Anzeige)
   → Client: schreibt EIN Event-Doc  gamification_events/{autoId}
             { userId, action, metadata, clientTs, dedupeHint }
             (nativer SDK queued das Write durabel → App beenden / offline = safe)
   → Cloud Function (onCreate): verarbeitet ALLES serverseitig
             Anti-Abuse + ledger + stats.pointsTotal + achievements + level + leaderboard
   → Client: onSnapshot auf users/{uid} (existiert schon via AuthContext)
             • stats.pointsTotal / currentLevel updaten → autoritative Zahl
             • Diff der achievements-Map → Achievement-Banner
             • currentLevel gestiegen → Level-Up-Banner
```

Warum das den Stall killt: bestätigt durch den Test „Custom-Items (1 Cart-Write, keine
Cascade) frieren NIE ein". Ein einzelner kleiner Event-Write churnt den Stream nicht.

### Trigger-Mechanismus: Event-Doc, NICHT HTTPS-Callable
- **Event-Doc (gewählt):** Write wird vom nativen SDK **durabel lokal gequeued** → überlebt
  App-Beenden + Offline, synchronisiert bei Reconnect. Genau die „App beenden ist safe"-Garantie.
- HTTPS-Callable (verworfen): synchroner Netz-Call, **failt offline**, queued nicht.

---

## 2. Was wandert wohin

| Logik | Heute | Neu |
|---|---|---|
| Anti-Abuse (oneTime/dedupe/dailyCap/weeklyCap) | Client (4 ledger-Queries) | **CF** (sicherer — Client kann's nicht umgehen) |
| ledger-Eintrag schreiben | Client | **CF** |
| stats.pointsTotal erhöhen | Client | **CF** |
| Achievement-Progress + Completion | Client (writeBatch) | **CF** |
| Level-Berechnung + Update | Client | **CF** |
| Leaderboard (leaderboards/{uid}) | Client | **CF** |
| Savings (totalSavings) | Client (updateUserStats) | **CF** (ins Event gefaltet) |
| Streak (daily_streak, App-Start) | Client | **CF** (gleicher Event-Pfad) |
| Punkte-Toast (Instant) | Client-Callback | **Client optimistisch** (unverändert schnell) |
| Achievement-/Level-Banner | Client-Callback (onAchievementUnlock/onLevelUp) | **Client via Snapshot-Diff** |
| Config laden (levels/actions/achievements) | Client (read-only) | **unverändert** (Client braucht's für Optimistik + Banner; CF liest es auch) |
| Journey-Tracking | Client | **unverändert** (entkoppelt — bestätigt) |

---

## 3. Cloud Function `gamification-processor`

- **Trigger:** `onDocumentCreated('gamification_events/{eventId}')`, Region `europe-west3`, Node 22.
- **Eigene Codebase** in `firebase.json` (wie die anderen 15 CFs), Deploy-Pattern wie gehabt.
- **Idempotenz:** Firestore-Trigger feuern at-least-once → guard nötig. Pro Event-Doc genau
  einmal verarbeiten: nach Erfolg `processedAt` setzen (oder Event löschen); beim Re-Fire
  `processedAt` vorhanden → skip. (Pattern wie cashback-ledger idempotent per receiptId.)
- **Logik = exakte Portierung** der Client-Spec (1:1, sonst divergiert die Optimistik):
  1. Config laden: `gamification/actions`, `gamification/levels/items`, `achievements/*`
     (CF-seitig cachen pro Instanz).
  2. Anti-Abuse gegen `users/{uid}/ledger` (gleiche Queries: action==, timestamp-Ranges).
     Reject → Event als `skipped: <grund>` markieren, keine Punkte.
  3. ledger-Eintrag `users/{uid}/ledger/{autoId}` = { action, points, timestamp:serverTs, metadata }.
  4. `users/{uid}.stats.pointsTotal += points`, `lastActivityAt`.
  5. Achievements: relevante matchen (direct / first_action_any / savings_total),
     Progress per Typ (one-time/count/streak/milestone), Completion → +achievement.points,
     `users/{uid}.achievements[id]` schreiben.
  6. Level: `calculateLevel(points, savings)` (DUAL-Gate: points≥req UND savings≥req),
     bei Änderung `stats.currentLevel` + legacy `level`.
  7. Leaderboard `leaderboards/{uid}`: total/weekly/monthly/yearly Punkte + Savings,
     Period-Resets (Mon-Start / YYYY-MM / YYYY), `photoUrl: null` statt undefined.
  8. Savings: `metadata.totalSavings` → `users/{uid}.totalSavings += savings`.
- **Streak:** `daily_streak`-Event (vom Client beim App-Start statt direktem Write) → CF rechnet
  Streak-Diff + Bonus (`max(0, streakDay-1)`) + ledger + achievements.

### Edge-Cases / Gotchas (aus der Spec)
- Level-Gate ist **UND** (points UND savings), nicht ODER.
- savings-Quelle: top-level `totalSavings` (primär), nicht `stats.savingsTotal`.
- Streak-Bonus = `streakDay-1`, nicht `streakDay`.
- first_action_any nur für scan/search/view_comparison.
- Compound-Index `(action, timestamp)` auf `users/{uid}/ledger` muss existieren (für CF-Queries).

---

## 4. Client-Änderungen

`lib/services/achievementService.ts` — `trackAction()` wird schlank:
- **Optimistik (instant):** Punkte aus geladener `gameActions`-Config rechnen → `onPointsEarned`
  sofort feuern (Toast). *(Best-effort: bei Anti-Abuse-Reject zeigt der Toast evtl. fälschlich
  "+X" — harmlos, Snapshot korrigiert die echte Zahl nicht nach unten. Optional: leichter lokaler
  dedupe/cap-Check aus dem ledger-Cache vor dem Toast.)*
- **Event schreiben:** 1× `addDoc(gamification_events, { userId, action, metadata, clientTs })`,
  fire-and-forget. Kein ledger/stats/batch/leaderboard mehr im Client.
- `updateUserStats` (savings) entfällt im Client → savings reisen in `metadata` mit.

Banner via Snapshot-Diff (neuer kleiner Listener ODER im bestehenden AuthContext-users-Listener):
- Vorherige vs. neue `achievements`-Map vergleichen → neu `completed` → `showBanner(bannerDataFromAchievement)`.
- Vorheriges vs. neues `stats.currentLevel` → gestiegen → `showBanner(bannerDataFromLevelUp)`.
- **De-dupe:** Set der schon-gebannten achievement-ids pro Session (kein Doppel-Banner;
  Optimistik feuert KEINEN Banner, nur den Punkte-Toast → Banner kommt nur aus dem Snapshot).
- `bannerDataFromAchievement/LevelUp` + Config-Loading bleiben (Client braucht sie weiter).

Aufrufer (11 trackAction-Stellen + 2 updateUserStats) bleiben **API-gleich** — sie rufen weiter
`trackAction(uid, action, metadata)`; nur die Implementierung dahinter ändert sich.

---

## 5. Security-Rules (gestaffelt, damit nichts bricht)

- **Neu:** `gamification_events/{id}` — `allow create: if auth && request.resource.data.userId == auth.uid && valid shape; update/delete: false`.
- **Später (Phase 3, nach voller Umstellung):** Client-Writes auf `users/{uid}/ledger`,
  `stats.pointsTotal`, `stats.currentLevel`, `users/{uid}/achievements` auf **read-only**
  (nur CF/Admin schreibt) → echter Sicherheitsgewinn (Client kann keine Punkte fälschen).
  Vorher NICHT tightenen, sonst bricht der alte Pfad während des Rollouts.

---

## 6. Konsistenz / Parität
- CF-Logik muss **byte-genau** der Client-Spec entsprechen (Punkteformel, Anti-Abuse-Fenster,
  Level-Dual-Gate, Streak-Bonus), sonst weicht die Optimistik vom Server-Ergebnis ab.
- Optimistik ist **nur Anzeige**; der Snapshot ist autoritativ. Kleine Abweichung (Anti-Abuse
  reject) = Toast war zu optimistisch, aber die echte Zahl im Profil stimmt.
- Anti-Abuse wird **strenger/sicherer** (serverseitig, nicht umgehbar) — Verhalten ansonsten gleich.

## 7. Rollout / Rollback (sicher)
- **Feature-Flag** `GAMIFICATION_SERVER_SIDE` (Remote Config oder Konstante):
  - `false` → alter Client-Pfad (heutiges Verhalten, Rollback jederzeit).
  - `true` → neuer Event-Pfad.
- **Phase 1:** CF deployen + Event-Rule + Client-Event-Pfad hinter Flag (Flag aus). Auf Emulator/
  TestFlight mit Flag an verifizieren (Punkte/Achievements/Level parität, Stall weg, Banner ok,
  Offline-Queue ok).
- **Phase 2:** Flag an für alle.
- **Phase 3:** Rules tighten (Client read-only auf ledger/stats) nachdem der Event-Pfad stabil ist.
- **Backfill:** keiner nötig — bestehende Punkte/Level bleiben; die CF verarbeitet nur NEUE Events.

## 8. iOS + Journey
- iOS: rein backend + Client-Vereinfachung → **plattform-neutral, iOS unverändert** (sogar entlastet,
  weniger Writes). Kein Platform-Gate nötig.
- Journey-Tracking: **entkoppelt bestätigt** (achievementService importiert journeyTrackingService nicht)
  → bleibt unangetastet.

## 9. Risiken / offene Punkte
- **R1 Logik-Drift:** CF muss exakt zur Client-Spec passen. Mitigation: die oben gemappte Spec ist
  die Quelle; nach Bau einen Parität-Test (gleiche Aktion → gleiche Punkte/Level wie alt).
- **R2 Idempotenz/Races:** at-least-once Trigger + 2 schnelle Events könnten denselben Cap knapp
  überschreiten (wie heute auch best-effort). Akzeptabel; processedAt-Guard gegen Doppel-Zählung.
- **R3 Banner-Timing:** Banner kommt jetzt über den Snapshot (1–3s nach CF) statt instant. Punkte-
  Toast ist weiter instant. Celebration leicht verzögert = ok/erwünscht.
- **R4 Optimistik-Genauigkeit:** ohne lokalen Anti-Abuse-Check kann der Toast selten zu optimistisch
  sein. Entscheidung nötig (siehe unten).
- **Offene Entscheidung A:** Optimistik best-effort (einfach) ODER lokaler dedupe/cap-Vorcheck (genauer, mehr Code)?
- **Offene Entscheidung B:** Streak (App-Start) gleich mit umstellen (empfohlen, gleicher Pfad) oder Phase 2?
- **Offene Entscheidung C:** Flag via Remote-Config (live umschaltbar) oder Build-Konstante?

## 10. Aufwand (grob)
- CF (Logik-Portierung + Idempotenz + Deploy): groß (Kern der Arbeit).
- Client (trackAction schlank + Snapshot-Diff-Banner + savings ins Event): mittel.
- Rules (Event-Rule jetzt, tighten später): klein.
- Test/Rollout (Parität + Stall-Verifikation + Flag): mittel.
→ Mehrtägig, aber die einzige Variante die alle Anforderungen sauber erfüllt.
