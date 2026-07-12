/**
 * Parser für den 5.x-Web-SDK-Session-Rest im AsyncStorage (Session-Rettung,
 * Audit 12.07.2026). Bewusst OHNE React-Native-Imports — pur + jest-testbar.
 *
 * Das alte Firebase-WEB-SDK persistierte die Session unter
 * `firebase:authUser:<apiKey>:[DEFAULT]` als JSON mit u.a.
 * `{ uid, email, stsTokenManager: { refreshToken }, providerData: [...] }`.
 * Die RNFirebase-Migration liest diesen Eintrag nicht — er liegt aber
 * weiterhin auf jedem Update-Gerät und ist unser Rettungsanker.
 */

export const LEGACY_AUTH_KEY_PREFIX = 'firebase:authUser:';

export interface LegacyAuthRecord {
  uid: string;
  refreshToken: string;
  email: string | null;
  hadProviders: boolean;
}

/** Findet den Legacy-Session-Key in einer AsyncStorage-Key-Liste. */
export function findLegacyAuthKey(keys: readonly string[]): string | null {
  const hit = keys.find((k) => typeof k === 'string' && k.startsWith(LEGACY_AUTH_KEY_PREFIX));
  return hit ?? null;
}

/**
 * Parst den JSON-Wert des Legacy-Keys. Gibt null zurück, wenn der Eintrag
 * korrupt ist oder keinen brauchbaren Refresh-Token enthält — der Aufrufer
 * markiert die Rettung dann als „nichts zu retten".
 */
export function parseLegacyAuthRecord(raw: string | null | undefined): LegacyAuthRecord | null {
  if (!raw) return null;
  let data: any;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  const uid = typeof data?.uid === 'string' ? data.uid.trim() : '';
  const refreshToken =
    typeof data?.stsTokenManager?.refreshToken === 'string'
      ? data.stsTokenManager.refreshToken.trim()
      : '';
  if (!uid || !refreshToken) return null;
  const providers = Array.isArray(data?.providerData)
    ? data.providerData.filter((p: any) => p && p.providerId && p.providerId !== 'firebase')
    : [];
  return {
    uid,
    refreshToken,
    email: typeof data?.email === 'string' && data.email.trim() ? data.email.trim() : null,
    hadProviders: providers.length > 0,
  };
}
