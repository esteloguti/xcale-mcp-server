import { describe, expect, it } from 'vitest';

import { wompiAuth } from '../auth';
import { wompiContext } from '../context';

describe('wompi call context', () => {
  it('accepts the public key with either environment', () => {
    expect(wompiContext.parse({ publicKey: 'pub_test_x', environment: 'sandbox' })).toEqual({
      publicKey: 'pub_test_x',
      environment: 'sandbox',
    });
    expect(wompiContext.parse({ publicKey: 'pub_prod_x', environment: 'production' })).toEqual({
      publicKey: 'pub_prod_x',
      environment: 'production',
    });
  });

  // Optional on purpose: a required key would make the consumer's generated connect form ask the
  // owner for it. The consumer derives it from the key prefixes instead; the client requires it.
  it('does not require the environment', () => {
    expect(wompiContext.safeParse({ publicKey: 'pub_test_x' }).success).toBe(true);
  });

  it('requires the public key', () => {
    expect(wompiContext.safeParse({ environment: 'sandbox' }).success).toBe(false);
    expect(wompiContext.safeParse({ publicKey: '', environment: 'sandbox' }).success).toBe(false);
  });

  it('refuses any other environment and any undeclared key', () => {
    expect(wompiContext.safeParse({ publicKey: 'pub_test_x', environment: 'test' }).success).toBe(
      false,
    );
    expect(
      wompiContext.safeParse({ publicKey: 'pub_test_x', environment: 'sandbox', extra: 1 }).success,
    ).toBe(false);
  });
});

describe('wompi auth descriptor', () => {
  it('forwards a single secret, the private key, as a bearer header', () => {
    expect(wompiAuth).toEqual({
      type: 'bearer',
      credentialDelivery: 'forwarded',
      fields: [{ key: 'private_key', label: 'Wompi private key', placement: 'header' }],
    });
  });
});
