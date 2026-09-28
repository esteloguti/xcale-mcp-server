import { describe, expect, it } from 'vitest';

import { erbonProvider } from '../provider';

/**
 * S1 — foundation & discovery. Asserts the provider's published shape (manifest, auth, contextSchema)
 * without any tools yet. The full conformance suite + behavior tests land in S2–S4 once tools exist.
 */
describe('erbon provider — S1 discovery shape', () => {
  it('is identified as the erbon hospitality provider', () => {
    expect(erbonProvider.manifest.slug).toBe('erbon');
    expect(erbonProvider.manifest.displayName).toBe('Erbon');
    expect(erbonProvider.manifest.category).toBe('hospitality');
    expect(erbonProvider.manifest.providerVersion.length).toBeGreaterThan(0);
    expect(erbonProvider.manifest.schemaVersion.length).toBeGreaterThan(0);
  });

  it('publishes credential_exchange auth minted from /auth/login with reference delivery', () => {
    const auth = erbonProvider.auth;
    expect(auth.type).toBe('credential_exchange');
    if (auth.type !== 'credential_exchange') throw new Error('unreachable');
    expect(auth.credentialDelivery).toBe('reference');
    expect(auth.tokenEndpoint).toBe('https://api.erbonsoftware.com/auth/login');
    expect(auth.method).toBe('POST');
    expect(auth.bodyFields).toEqual({ username: 'username', password: 'password' });
    expect(auth.responseFields.token).toBe('bearerToken');
    expect(auth.responseFields.expiry).toBe('expirationUTCDate');
    expect(auth.tokenPlacement).toBe('bearer_header');
  });

  it('identifies the hotel via a contextSchema requiring hotelID', () => {
    const schema = erbonProvider.contextSchema as
      | { properties?: Record<string, unknown>; required?: readonly string[] }
      | undefined;
    expect(schema).toBeDefined();
    expect(schema?.properties?.hotelID).toBeDefined();
    expect(schema?.required).toContain('hotelID');
  });

  it('declares no connectionProbe (a credential_exchange proves itself by minting at connect)', () => {
    expect(erbonProvider.manifest.connectionProbe).toBeUndefined();
    expect(erbonProvider.manifest.contextDiscovery).toBeUndefined();
  });

  it('offers no alternative connect methods', () => {
    expect(erbonProvider.additionalAuth).toBeUndefined();
  });
});
