import { describe, expect, it } from 'vitest';

import { PROVIDERS } from '../../providers';
import { buildCatalog } from '../catalog';
import { createRegistry } from '../registry';

describe('buildCatalog', () => {
  const catalog = buildCatalog(createRegistry(PROVIDERS));

  it('lists every registered provider with discovery metadata', () => {
    expect(catalog.length).toBe(PROVIDERS.length);
    const echo = catalog.find((e) => e.slug === 'echo');
    expect(echo).toBeDefined();
    expect(echo?.authDescriptor.type).toBe('api_key');
    expect(echo?.toolCount).toBeGreaterThan(0);
    expect(echo?.providerVersion).toBe('0.1.0');
    expect(echo?.schemaVersion.length).toBeGreaterThan(0);
  });

  it('carries no secrets and no consumer-specific concepts', () => {
    const json = JSON.stringify(catalog);
    // The scan targets secret VALUES and consumer concepts — not authDescriptor field NAMES.
    // `password` is intentionally NOT here: it is a legitimate non-secret `bodyFields` wire field
    // name (Erbon's `/auth/login` expects `{username,password}`), never a secret value — those are
    // kept out by SecretString + Credential-in-Transit-Only. A leaked SECRET field would still trip
    // `clientSecret`/`client_secret`. Do not re-add `password` (it re-breaks Erbon). See ADR
    // authdescriptor-field-names-are-non-secret.md.
    expect(json).not.toMatch(/clientSecret|client_secret|tenant|\bplan\b/i);
  });

  it('publishes additionalAuthDescriptors only for providers declaring extra connect methods', () => {
    // ADR multiple-connect-methods-per-provider: cloudbeds publishes the API-key lane.
    const cloudbeds = catalog.find((e) => e.slug === 'cloudbeds');
    expect(cloudbeds?.additionalAuthDescriptors?.length).toBeGreaterThan(0);
    expect(cloudbeds?.additionalAuthDescriptors?.[0]?.type).toBe('bearer');
    // Omitted — not empty, not null — when a provider declares none (additive-contract discipline).
    const echo = catalog.find((e) => e.slug === 'echo');
    expect(echo).toBeDefined();
    expect(echo && 'additionalAuthDescriptors' in echo).toBe(false);
  });
});
