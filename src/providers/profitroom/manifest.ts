import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'profitroom';

/**
 * No `logoUrl` yet: no approved Profitroom asset in `assets/` (implementation plan §1.6). The field is
 * optional; add it with the asset.
 */
export const profitroomManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'Profitroom',
  category: 'hospitality',
  schemaVersion: '2026-10-14',
  providerVersion: '0.1.0',
};
