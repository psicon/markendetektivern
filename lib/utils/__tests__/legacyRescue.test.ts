import { isEffectivelyAnonymous } from '../authIdentity';
import {
  findLegacyAuthKey,
  LEGACY_AUTH_KEY_PREFIX,
  parseLegacyAuthRecord,
} from '../legacyAuthRecord';

// Session-Rettung 5.x→6.0 (Audit 12.07.2026): pure Bausteine.

describe('isEffectivelyAnonymous', () => {
  const u = (isAnonymous: boolean, providerIds: string[]) =>
    ({
      isAnonymous,
      providerData: providerIds.map((providerId) => ({ providerId })),
    }) as any;

  it('null/undefined → false (kein User ist kein Gast)', () => {
    expect(isEffectivelyAnonymous(null)).toBe(false);
    expect(isEffectivelyAnonymous(undefined)).toBe(false);
  });

  it('echter Anon-User → true', () => {
    expect(isEffectivelyAnonymous(u(true, []))).toBe(true);
  });

  it('per Custom-Token geretteter Gast (isAnonymous=false, 0 Provider) → true', () => {
    expect(isEffectivelyAnonymous(u(false, []))).toBe(true);
  });

  it("interner 'firebase'-Eintrag zählt nicht als Provider", () => {
    expect(isEffectivelyAnonymous(u(false, ['firebase']))).toBe(true);
  });

  it('registrierte User (password/google/apple/facebook) → false', () => {
    expect(isEffectivelyAnonymous(u(false, ['password']))).toBe(false);
    expect(isEffectivelyAnonymous(u(false, ['google.com']))).toBe(false);
    expect(isEffectivelyAnonymous(u(false, ['apple.com']))).toBe(false);
    expect(isEffectivelyAnonymous(u(false, ['facebook.com']))).toBe(false);
  });

  it('fehlendes providerData-Array → wie 0 Provider', () => {
    expect(isEffectivelyAnonymous({ isAnonymous: false } as any)).toBe(true);
  });
});

describe('findLegacyAuthKey', () => {
  it('findet den Web-SDK-Session-Key zwischen anderen Keys', () => {
    const keys = [
      'onboarding_v1_completed',
      `${LEGACY_AUTH_KEY_PREFIX}AIzaSyDXqH…:[DEFAULT]`,
      'premium_cache_v1',
    ];
    expect(findLegacyAuthKey(keys)).toBe(keys[1]);
  });

  it('null wenn kein Legacy-Key existiert (echter Neu-Install)', () => {
    expect(findLegacyAuthKey(['a', 'b'])).toBeNull();
    expect(findLegacyAuthKey([])).toBeNull();
  });
});

describe('parseLegacyAuthRecord', () => {
  const valid = {
    uid: 'oldUid123',
    email: 'test@example.com',
    stsTokenManager: { refreshToken: 'AMf-vBz…token', accessToken: 'x', expirationTime: 1 },
    providerData: [{ providerId: 'password' }],
  };

  it('parst einen validen 5.x-Eintrag', () => {
    const r = parseLegacyAuthRecord(JSON.stringify(valid));
    expect(r).toEqual({
      uid: 'oldUid123',
      refreshToken: 'AMf-vBz…token',
      email: 'test@example.com',
      hadProviders: true,
    });
  });

  it('anonymer 5.x-User (keine Provider, keine Email) → hadProviders false', () => {
    const r = parseLegacyAuthRecord(
      JSON.stringify({ ...valid, email: null, providerData: [] }),
    );
    expect(r).toMatchObject({ uid: 'oldUid123', hadProviders: false, email: null });
  });

  it('korrupt/leer/ohne Token → null (Rettung wird als „nichts zu retten" markiert)', () => {
    expect(parseLegacyAuthRecord(null)).toBeNull();
    expect(parseLegacyAuthRecord('')).toBeNull();
    expect(parseLegacyAuthRecord('not json')).toBeNull();
    expect(parseLegacyAuthRecord(JSON.stringify({ uid: 'x' }))).toBeNull();
    expect(
      parseLegacyAuthRecord(JSON.stringify({ stsTokenManager: { refreshToken: 'y' } })),
    ).toBeNull();
  });
});
