import type { ProviderManifest } from '../../core/provider-port';

export const SLUG = 'lobbypms';

/**
 * LobbyPMS — a hotel PMS widely used in Colombia. The agent's menu holds the money-free catalog
 * reads (room types, availability without prices); everything that carries money, guest data or a
 * write is backend-only (`controlPlane`, ADR 0013). See `docs/design/lobbypms-provider/`.
 *
 * `connectionProbe`: `list_room_types` — a cheap no-argument read that proves the pasted token is
 * real, the property's API access is on, AND this server's egress IP is authorized in the property
 * (LobbyPMS refuses calls from any IP the property has not added).
 *
 * No `contextDiscovery`: no documented endpoint names the property behind a token, so the
 * `propertyId` is pasted at connect (`context.ts`).
 */
export const lobbypmsManifest: ProviderManifest = {
  slug: SLUG,
  displayName: 'LobbyPMS',
  category: 'hospitality',
  schemaVersion: '2026-10-15',
  providerVersion: '0.1.0',
  capabilities: { webhooks: false, polling: true, pagination: true },
  connectionProbe: { tool: `mcp_${SLUG}_list_room_types` },
};
