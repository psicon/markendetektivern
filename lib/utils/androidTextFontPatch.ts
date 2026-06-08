/**
 * Android Text-Font Patch
 *
 * Problem: React Native + Android wendet fontWeight NICHT auf custom
 * Fonts an. Wenn man `{ fontFamily: 'Nunito', fontWeight: '700' }`
 * setzt, sucht Android nach einer Font "Nunito", findet keine
 * (weil nur `Nunito_400Regular`, `Nunito_500Medium`,
 * `Nunito_600SemiBold`, `Nunito_700Bold` geladen sind) und fällt
 * auf System-Default zurück. fontWeight wird komplett ignoriert.
 *
 * iOS dagegen resolvet `fontFamily: 'Nunito'` + weight zur richtigen
 * Variante nativ. Dort gibt's kein Problem.
 *
 * Dieser Patch:
 *   • Hooked Text.render und TextInput.render
 *   • Sucht im finalen style nach fontFamily='Nunito' (oder unset
 *     wenn fontWeight gesetzt ist — Default-Family-Annahme)
 *   • Resolvet zu Nunito_XXX gemäß fontWeight (oder 400 wenn unset)
 *   • Ersetzt den fontFamily im style
 *
 * Nur Android-Pfad — auf iOS wird die Funktion gar nicht aufgerufen.
 *
 * Side-effect-import: in `app/_layout.tsx` ganz oben einmal
 * importieren, dann ist der Patch global aktiv.
 *
 * Forbidden Pattern Hinweis: Text.render zu patchen ist sonst meist
 * ein Anti-Pattern wegen RN-Version-Drift. Hier ist's der minimal-
 * invasive Weg — Alternative wäre ein eigener `<NunitoText>`-Wrapper
 * der überall manuell verwendet werden muss; bei ~440 existierenden
 * `{ fontFamily, fontWeight: X }` Callsites über Dutzende Screens
 * nicht praktikabel.
 *
 * Falls dieser Patch jemals durch ein RN-Upgrade bricht, ist der
 * Sichtbarkeit-Effekt: Android-Texte rendern wieder in System-Font.
 * Die App funktioniert weiter, nur die Typo ist visuell falsch.
 */

import { Platform, Text, TextInput, type StyleProp, type TextStyle } from 'react-native';
import {
  NUNITO_BOLD,
  NUNITO_MEDIUM,
  NUNITO_REGULAR,
  NUNITO_SEMIBOLD,
} from '@/constants/tokens/typography';

if (Platform.OS === 'android') {
  // ─── Style-Flattening Helper ───────────────────────────────────
  //
  // RN-Styles können Arrays von Arrays/Objects sein. Wir wollen den
  // final-resolved fontFamily und fontWeight. StyleSheet.flatten()
  // macht genau das, ohne dass wir manuell durchlaufen müssen.
  const flatten = (style: StyleProp<TextStyle>): TextStyle => {
    // require statt static import — vermeidet Circular falls
    // StyleSheet selber irgendwann von dieser Datei abhängt.
    const StyleSheet = require('react-native').StyleSheet;
    return StyleSheet.flatten(style) || {};
  };

  const resolveNunito = (weight?: TextStyle['fontWeight']): string => {
    const w = String(weight ?? '');
    if (w === 'bold' || w === '700' || w === '800' || w === '900') return NUNITO_BOLD;
    if (w === '600') return NUNITO_SEMIBOLD;
    if (w === '500') return NUNITO_MEDIUM;
    return NUNITO_REGULAR;
  };

  // Cache der Resolutions — String-Lookup ist billig, aber spart bei
  // dichten Listen (Stöbern: 1000+ Text-Renders) noch ein bisschen.
  const cache = new Map<string, string>();
  const resolveCached = (weight?: TextStyle['fontWeight']): string => {
    const key = String(weight ?? '');
    let v = cache.get(key);
    if (!v) {
      v = resolveNunito(weight);
      cache.set(key, v);
    }
    return v;
  };

  // ─── Text.render Patch ─────────────────────────────────────────
  type AnyComponent = any;
  const patchRender = (Component: AnyComponent, name: string) => {
    const originalRender = Component.render;
    if (!originalRender) {
      console.warn(`[androidTextFontPatch] ${name}.render unavailable — skipping`);
      return;
    }
    // WICHTIG (RN 0.79): Wir resolven auf den INPUT-Props (dem `style` das
    // an Text/TextInput übergeben wird), NICHT auf dem gerenderten
    // Output-Element. Ab RN 0.76+ destrukturiert Text seinen `style` und gibt
    // eine umstrukturierte Element-Struktur zurück — der User-Style liegt dann
    // NICHT mehr auf `element.props.style`, sodass die alte (Output-basierte)
    // Variante ein stiller No-op wurde (Android-Texte fielen auf System-Font
    // zurück). Input-Modifikation ist version-robust: forwardRef-Render-
    // Signatur ist (props, ref).
    Component.render = function patchedRender(props: any, ref: any) {
      if (props && props.style) {
        const flat = flatten(props.style);
        // Nur eingreifen wenn fontFamily explizit 'Nunito' ist (nicht den
        // Fall "weight gesetzt, family unset" — sonst würden 3rd-party-/
        // Navigation-Texte ungewollt auf Nunito gemappt).
        if (flat.fontFamily === 'Nunito') {
          const resolved = resolveCached(flat.fontWeight);
          if (resolved !== 'Nunito') {
            // Append-only: Original-Style bleibt, nur fontFamily wird zur
            // konkreten geladenen Variante (Nunito_700Bold etc.) überschrieben.
            props = { ...props, style: [props.style, { fontFamily: resolved }] };
          }
        }
      }
      return originalRender.call(this, props, ref);
    };
  };

  patchRender(Text, 'Text');
  patchRender(TextInput, 'TextInput');
}

// no-op default export — Datei wird via side-effect-import benutzt.
export {};
