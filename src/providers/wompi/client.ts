import type { RequestSpec } from '../../core/auth/http-request';
import type { RequestResult } from '../../core/http';
import type { WompiContext, WompiEnvironment } from './context';

/** Verified (sandbox, 2026-10-21/22) and documented (production). */
const DEFAULT_BASE_URLS: Readonly<Record<WompiEnvironment, string>> = {
  sandbox: 'https://sandbox.wompi.co/v1',
  production: 'https://production.wompi.co/v1',
};

export type QueryParams = Readonly<Record<string, string | number | undefined>>;

/** Executes an authenticated request; the core reveals the private key and adds the bearer header. */
export type AuthedRequest = (spec: RequestSpec) => Promise<RequestResult>;

export interface WompiClientDeps {
  /** Tests only: point both environments somewhere else. */
  readonly baseUrls?: Readonly<Record<WompiEnvironment, string>>;
}

export interface WompiClient {
  get(
    path: string,
    request: AuthedRequest,
    ctx: WompiContext,
    params?: QueryParams,
  ): Promise<RequestResult>;
  post(
    path: string,
    request: AuthedRequest,
    ctx: WompiContext,
    body: Readonly<Record<string, unknown>>,
  ): Promise<RequestResult>;
}

/**
 * The call context carried no `environment`. Thrown before any request: guessing would send a
 * production tenant's charge to the sandbox (where it looks paid) or a sandbox key to production
 * (where it looks broken). Tools map it to `PROVIDER_INVALID_INPUT`.
 */
export class WompiEnvironmentMissing extends Error {
  constructor() {
    super('Wompi call needs the connection environment');
    this.name = 'WompiEnvironmentMissing';
  }
}

function baseUrlFor(
  baseUrls: Readonly<Record<WompiEnvironment, string>>,
  ctx: WompiContext,
): string {
  if (!ctx.environment) throw new WompiEnvironmentMissing();
  return baseUrls[ctx.environment];
}

function buildUrl(baseUrl: string, path: string, params: QueryParams = {}): string {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) qs.set(key, String(value));
  }
  const query = qs.toString();
  return `${baseUrl}/${path}${query ? `?${query}` : ''}`;
}

export function createWompiClient(deps: WompiClientDeps = {}): WompiClient {
  const baseUrls = deps.baseUrls ?? DEFAULT_BASE_URLS;

  return {
    get: async (path, request, ctx, params) =>
      request({ method: 'GET', url: buildUrl(baseUrlFor(baseUrls, ctx), path, params) }),

    post: async (path, request, ctx, body) =>
      request({
        method: 'POST',
        url: buildUrl(baseUrlFor(baseUrls, ctx), path),
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      }),
  };
}
