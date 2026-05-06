// ────────────────────────────────────────────────────────────────────────
// JS-Thread-Performance Feature-Flags (2026-05)
// ────────────────────────────────────────────────────────────────────────
//
// Zentrale Schalter für die fünf "Provider-Cascade + Background-Work"-
// Fixes (A-E). Die Patterns die hier addressiert werden waren seit
// August/September 2025 im Code, wurden aber durch App-Wachstum
// (mehr Screens, mehr Daten, mehr Tracking-Call-Sites) erst jetzt
// auf Android spürbar.
//
// Jeder Boolean kann unabhängig auf `false` gesetzt werden um den
// jeweiligen Fix sofort zu rollbacken — ohne Code-Änderung. Empfohlene
// Vorgehensweise bei Problemen: einzeln auf `false` flippen + neu
// builden, isoliert testen welcher Fix das Problem auslöst.
//
// Die Fixes sind alle SEMANTIK-erhaltend: gleiche Outputs, gleiche
// Side-Effects — nur weniger Re-Renders und weniger Konkurrenz mit
// User-Input.

export const PERF = {
  // Fix A: AuthContext `value` Object via `useMemo` stabilisieren.
  // Heute: jedes Re-Render von AuthProvider erzeugt ein neues
  // value-Object → ALLE `useAuth()`-Consumer rerendern → Cascade
  // durch die ganze App. Mit useMemo: Object-Identity stabil
  // solange Inhalte (user, userProfile, callbacks…) sich nicht
  // ändern → Consumer rendern nur wenn ECHT was Neues da ist.
  memoAuthValue: true,

  // Fix B: Gleiches Pattern für AnalyticsProvider's contextValue.
  // AnalyticsProvider rendert besonders oft (`usePathname()` als
  // Dep), daher ist die Cascade hier doppelt teuer.
  memoAnalyticsValue: true,

  // Fix C: Screen-Tracking Firestore-Writes (im AnalyticsProvider's
  // `useFocusEffect`) via `InteractionManager.runAfterInteractions`
  // deferren. Heute laufen die Writes synchron im Tap-Handler. Mit
  // Defer: Navigation-Animation läuft sofort, Tracking-Events
  // erreichen Firestore 1 Frame später (User merkt nichts, weil
  // die Events fire-and-forget sind).
  deferScreenTracking: true,

  // Fix D: `achievementService.trackAction` Body in `runAfterInteractions`
  // wickeln. Heute: jeder Tap auf "Add to Favorite", "Mark Purchased"
  // etc. löst 6-10 Firestore-Calls + Profile-Refresh-Cascade aus —
  // synchron im JS-Thread. Mit Defer: gleiche Arbeit, aber außerhalb
  // des Tap-Critical-Paths. Achievement-Unlock-Toasts erscheinen
  // ggf. ~100 ms später — nicht wahrnehmbar.
  // Wichtig: trackAction wird teilweise `await`'d (useAchievements,
  // interner daily_streak Call). Body wird daher in ein Promise
  // gewrappt, sodass `await` weiterhin sauber funktioniert.
  deferTrackAction: true,

  // Fix E: Rating-Poll-Intervall von 2 s auf 10 s. Maximal-Verzögerung
  // für das Rating-Modal-Erscheinen wächst von 2 s auf 10 s — irrelevant
  // weil das Modal eh erst nach Level-Up-Overlay erscheint (das selber
  // 3-5 s dauert). 5x weniger AsyncStorage-Reads im Hintergrund.
  reduceRatingPollFrequency: true,

  // Fix F: Ersetzt `Animated.createAnimatedComponent(LegendList)` +
  // `useAnimatedScrollHandler` durch plain `<LegendList>` +
  // `useAnimatedRef` + `useScrollViewOffset`. Das löst den iOS-
  // Status-Bar-Tap-Bug auf physischen Geräten — Reanimateds
  // Animated-Wrapper-Klasse interferiert mit iOS' "topmost
  // UIScrollView mit scrollsToTop=true"-Heuristik. Mit useScrollViewOffset
  // bleibt die UI-Thread-Animation für Chrome-Collapse erhalten,
  // aber das native UIScrollView ist nicht mehr versteckt.
  // Load-more-Trigger geht von Animated-Worklet zu plain JS-onScroll
  // (OK — das Trigger-Decision war eh JS-thread via runOnJS).
  // Rollback: PERF.useScrollOffset = false → fällt zurück auf
  // Animated.createAnimatedComponent + useAnimatedScrollHandler.
  useScrollOffset: true,

  // Fix H: Dedupe `achievementService.trackAction`-Calls innerhalb
  // eines 5-Sekunden-Fensters für identische (userId, action, productId)
  // Tripel. Ohne diesen Fix können 10 schnelle Taps auf "Add to
  // Favorite" desselben Produkts 10× die komplette Achievement-Cascade
  // (12 getDocs + batch.commit + checkLevel + refreshProfile) feuern —
  // wenn die `runAfterInteractions`-Queue leer wird, prasseln alle 10
  // gleichzeitig auf den JS-Thread → mehrsekündiger Freeze.
  // Mit Dedupe: nur die erste Action zählt, der Rest wird gedroppt
  // (Achievement-Progress wird ohnehin nur 1× hochgezählt).
  // Rollback: PERF.dedupeTrackAction = false.
  dedupeTrackAction: true,

  // Fix G: Status-Bar-Tap auf physischen iOS-Geräten funktionierte
  // nach Fix F immer noch nicht, weil LegendList INTERN noch
  // `react-native`'s `Animated.ScrollView` benutzt (siehe
  // node_modules/@legendapp/list/index.js). Diese Subclass
  // (`RCTAnimatedScrollView`) wird von iOS' strikter
  // `scrollsToTop`-Heuristik auf physischen Geräten nicht zuverlässig
  // als gültiger UIScrollView-Kandidat erkannt — im Sim ist die
  // Heuristik laxer, deshalb funktioniert's dort.
  // Mit Fix G geben wir LegendList eine plain `ScrollView`-
  // Komponente via `renderScrollComponent`-Prop. Das ist ein
  // dokumentiertes LegendList-Pattern — damit ist der native
  // View ein simples `RCTScrollView`, das iOS perfekt kennt.
  // Trade-off: useScrollViewOffset funktioniert nur mit
  // Reanimated-tracked ScrollViews. Mit plain ScrollView müssen
  // wir scrollY aus dem JS-Thread `onScroll`-Handler updaten —
  // ~16 ms (1 Frame) Latenz für die Chrome-Collapse-Animation.
  // Visuell unsichtbar bei normalem Scrollen.
  // Rollback: PERF.legendListPlainScrollView = false → fällt
  // zurück auf LegendList's default `Animated.ScrollView`.
  legendListPlainScrollView: true,

  // Phase 0 C: kategorien-Liste (für Filter-Sheet) lazy laden statt
  // beim Stöbern-Mount. Wird nur gebraucht wenn der User auf das
  // Kategorie-Filter-Chip tippt — und selbst dann höchstens einmal
  // pro Session (sheet-State löst Reload nur beim ersten Open aus).
  // Spart 1 Firestore-Query auf Critical-Path.
  // Rollback: PERF.lazyKategorien = false → wieder im Mount-refData-Promise.all.
  lazyKategorien: true,

  // Phase 0 D: handelsmarken-Liste lazy laden. Bulk-Liste hat ~1160
  // Dokumente und ist die teuerste einzelne Query auf Stöbern-Mount
  // (~1.2 s auf Android Web SDK). Wird NICHT für Card-Rendering
  // gebraucht — die Card-Brand-Eyebrow-Texte kommen aus per-Produkt
  // ref-batches via getDocumentsBatch (Fix K). Bulk-Liste wird nur
  // für das Handelsmarke-Filter-Sheet gebraucht.
  // Spart 1 große Firestore-Query (1.2 s) auf Critical-Path.
  // Rollback: PERF.lazyHandelsmarken = false.
  lazyHandelsmarken: true,
};

// Konstanten für Fix E (referenced by GamificationProvider).
export const RATING_POLL_INTERVAL_MS = PERF.reduceRatingPollFrequency
  ? 10000
  : 2000;
