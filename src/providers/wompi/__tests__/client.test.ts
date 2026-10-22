import { describe, expect, it, vi } from 'vitest';

import type { RequestSpec } from '../../../core/auth/http-request';
import type { RequestResult } from '../../../core/http';
import { WompiEnvironmentMissing, createWompiClient } from '../client';

/** An authed-request double: records each spec it is handed and answers 200 with an empty list. */
function recordingRequest() {
  const specs: RequestSpec[] = [];
  const request = vi.fn(async (spec: RequestSpec): Promise<RequestResult> => {
    specs.push(spec);
    return { ok: true, status: 200, data: { data: [] } };
  });
  return { request, specs };
}

describe('wompi client', () => {
  it('sends a sandbox connection to the sandbox API, with the query it was given', async () => {
    const { request, specs } = recordingRequest();

    await createWompiClient().get(
      'transactions',
      request,
      {
        publicKey: 'pub_test_x',
        environment: 'sandbox',
      },
      { reference: 'xcale-connection-probe' },
    );

    expect(specs).toEqual([
      {
        method: 'GET',
        url: 'https://sandbox.wompi.co/v1/transactions?reference=xcale-connection-probe',
      },
    ]);
  });

  it('sends a production connection to the production API', async () => {
    const { request, specs } = recordingRequest();

    await createWompiClient().get('transactions', request, {
      publicKey: 'pub_prod_x',
      environment: 'production',
    });

    expect(specs[0]?.url).toBe('https://production.wompi.co/v1/transactions');
  });

  // Fails closed: a missing environment must never be guessed, or a production tenant's charge
  // could be sent to the sandbox (and look paid) or a sandbox key to production (and look broken).
  it('refuses to call Wompi when the connection has no environment', async () => {
    const { request } = recordingRequest();

    await expect(
      createWompiClient().get('transactions', request, { publicKey: 'pub_test_x' }),
    ).rejects.toBeInstanceOf(WompiEnvironmentMissing);
    expect(request).not.toHaveBeenCalled();
  });

  it("posts a JSON body to the connection's API", async () => {
    const { request, specs } = recordingRequest();

    await createWompiClient().post(
      'payment_links',
      request,
      { publicKey: 'pub_test_x', environment: 'sandbox' },
      { name: 'Valoración', amount_in_cents: 150000 },
    );

    expect(specs).toEqual([
      {
        method: 'POST',
        url: 'https://sandbox.wompi.co/v1/payment_links',
        headers: { 'content-type': 'application/json' },
        body: '{"name":"Valoración","amount_in_cents":150000}',
      },
    ]);
  });

  it('refuses to post when the connection has no environment', async () => {
    const { request } = recordingRequest();

    await expect(
      createWompiClient().post('payment_links', request, { publicKey: 'pub_test_x' }, {}),
    ).rejects.toBeInstanceOf(WompiEnvironmentMissing);
    expect(request).not.toHaveBeenCalled();
  });

  // Wompi deactivates a link only with PATCH (PUT answers 404 — verified on the sandbox, 2026-10-22).
  it("patches a JSON body to the connection's API", async () => {
    const { request, specs } = recordingRequest();

    await createWompiClient().patch(
      'payment_links/test_XGd2UH',
      request,
      { publicKey: 'pub_test_x', environment: 'sandbox' },
      { active: false },
    );

    expect(specs).toEqual([
      {
        method: 'PATCH',
        url: 'https://sandbox.wompi.co/v1/payment_links/test_XGd2UH',
        headers: { 'content-type': 'application/json' },
        body: '{"active":false}',
      },
    ]);
  });

  it('refuses to patch when the connection has no environment', async () => {
    const { request } = recordingRequest();

    await expect(
      createWompiClient().patch('payment_links/x', request, { publicKey: 'pub_test_x' }, {}),
    ).rejects.toBeInstanceOf(WompiEnvironmentMissing);
    expect(request).not.toHaveBeenCalled();
  });
});
