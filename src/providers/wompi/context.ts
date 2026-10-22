import { z } from 'zod';

/**
 * Wompi call context (Explicit Context principle). Published to the consumer as `contextSchema`.
 *
 * `publicKey` identifies the merchant account (`pub_test_…` / `pub_prod_…`). It is not a secret —
 * Wompi's own checkout pages carry it — so it travels as context, while the private key is the one
 * forwarded secret.
 *
 * `environment` picks the base URL: one deployment of this server serves tenants in Wompi's sandbox
 * and in production, so it cannot be a deployment value. It is **optional in the schema** on purpose:
 * a required key would make the consumer's generated connect form ask the owner for it. The consumer
 * derives it from the key prefixes at connect time and sends it; the client refuses to call without it
 * (`client.ts`), so "optional" never means "guessed".
 */
export const wompiContext = z
  .object({
    publicKey: z.string().min(1),
    environment: z.enum(['sandbox', 'production']).optional(),
  })
  .strict();

export type WompiContext = z.infer<typeof wompiContext>;

export type WompiEnvironment = NonNullable<WompiContext['environment']>;
