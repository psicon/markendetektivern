// EdgeGlow.android.tsx — Stub für Android-Test.
//
// React Native Metro picks this file automatically über die Android-
// Platform-Extension (.android.tsx > .tsx). Auf iOS bleibt
// EdgeGlow.tsx mit dem Skia-basierten Halo aktiv.
//
// Hintergrund: Wir testen ob das Native @shopify/react-native-skia
// Package die Surface-Stops auf Android verursacht (logcat zeigt
// `EGLConsumer is not attached to an OpenGL ES context`). Auf
// Android: kein EdgeGlow-Render → Skia-Module wird auf JS-Seite
// nicht importiert → TurboModule sollte ruhig bleiben.

interface EdgeGlowProps {
  visible: boolean;
  tint: string;
  secondaryTint?: string;
}

export function EdgeGlow(_props: EdgeGlowProps) {
  return null;
}
