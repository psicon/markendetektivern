import { router } from 'expo-router';

/**
 * Back navigation that ALWAYS has a target.
 *
 * Pops the stack if there's something to go back to; otherwise falls back to
 * Home. Needed for screens that can be entered COLD via a deep link (e.g.
 * markendetektive://noname-detail/{id}) — there's no parent screen, so a plain
 * `router.back()` triggers React Navigation's "The action 'GO_BACK' was not
 * handled by any navigator" warning and does nothing. Use this for the back
 * button of any deep-linkable detail screen.
 */
export function backOrHome() {
  if (router.canGoBack()) {
    router.back();
  } else {
    router.replace('/(tabs)');
  }
}
