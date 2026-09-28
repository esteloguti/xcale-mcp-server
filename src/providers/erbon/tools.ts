import type { ToolDefinition } from '../../core/tool';
import type { ErbonClient } from './client';
import type { ErbonContext } from './context';

/**
 * The curated Erbon tool set. **S1: empty on purpose** — this slice ships the provider scaffolding
 * (manifest, auth, context, client) and discovery only. S2 adds the four menu reads
 * (`check_availability`, `list_room_types`, `list_rates`, `get_hotel`) via `toolFactory<ErbonContext>()`;
 * S3 adds `get_rate_prices` as a `controlPlane` (routable-but-not-listed) money tool. See
 * `docs/design/erbon-read-only-provider/implementation-plan.md`.
 */
export function buildErbonTools(
  _client: ErbonClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- erased input type (heterogeneous tool collection)
): ReadonlyArray<ToolDefinition<any, ErbonContext>> {
  return [];
}
