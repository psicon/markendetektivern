module.exports = function (api) {
  api.cache(true);

  // Production-Build: alle console.* Calls werden zu no-ops kompiliert.
  // Hintergrund: 1262 console.* Calls im Codebase, jeder davon läuft
  // auf Android via React-Native-Bridge — simple Logs ~1-3 ms,
  // Object-Dumps (z.B. das User-Profil mit allen Achievements)
  // 100-300 ms pro Stück. Bei einem trackAction-Cascade mit
  // 30+ Logs internally = mehrsekündiger JS-Thread-Freeze auf Android.
  // Dev-Modus (Metro) bleibt unangetastet — Logs sind weiterhin
  // sichtbar für Debugging. NUR im Release-Build werden sie gestrippt.
  //
  // Update 2026-05 (Fix O): `warn` AUCH strippen, weil RNFirebase v23
  // auf jedem `analytics().logEvent()`-Aufruf 2 lange Deprecation-
  // Warnings feuert (~100 ms JSI-Bridge-Cost pro Stück). Bei Stöbern's
  // hochfrequentem Tracking summiert sich das zu mehrsekündigen
  // JS-Thread-Freezes. 175 user-defined `console.warn` calls in der
  // Codebase werden auch gestrippt — die meisten sind Error-Path-
  // Hinweise die auf Firestore-Permission-Edge-Cases warnen, niemand
  // sieht sie in Prod ohnehin.
  // Nur `console.error` bleibt erhalten — das ist legitim für
  // Crashlytics-Capture und Error-Boundaries.
  const isProduction =
    process.env.BABEL_ENV === 'production' ||
    process.env.NODE_ENV === 'production';

  return {
    presets: ['babel-preset-expo'],
    plugins: isProduction
      ? [
          [
            'transform-remove-console',
            { exclude: ['error'] },
          ],
        ]
      : [],
  };
};
