import { ProviderErrorCode } from '../../core/errors';
import type { RequestResult } from '../../core/http';
import { err, ok, type ToolOutcome } from '../../core/tool';

/**
 * LobbyPMS error shaping.
 *
 * LobbyPMS reports failure with an HTTP status (Documented: 400, 401, 403, 404, 422, 500, 503) and,
 * for business refusals, a JSON body `{ "error_code": "<MACHINE_CODE>", "error" | "code": "<text>" }`.
 * The core's status map is the default; it is overridden in ONE narrow case:
 *
 * **A documented business code is never "reconnect".** `cancel-booking` documents
 * `UNAUTHORIZED_BOOKING` ("the booking was not created through the API"). Whatever status it rides
 * on, it is a refusal a reconnect cannot fix — mapped to `PROVIDER_AUTH_EXPIRED` it would flip a
 * working connection to "reconnect required" for every tenant who asked to cancel a front-desk
 * booking. So a body naming a code in `BUSINESS_CODES` is `PROVIDER_ERROR` (or `INVALID_INPUT` for
 * `INPUT_PARAMETERS`), never the status's default. A 401/403 WITHOUT such a code keeps the core's
 * `PROVIDER_AUTH_EXPIRED` — the token or the IP authorization is what failed, and the owner must act.
 *
 * The machine code (and only the machine code) is put in the message, so the consumer can tell
 * `RECORD_NOT_FOUND` from `BOOKING_CHECK_IN_COMPLETE`. The provider's free text is not: it is
 * untranslated and not ours to forward to a guest.
 */

/** Documented business codes (create-customer, cancel-booking). Additive as LobbyPMS shows more. */
const BUSINESS_CODES: ReadonlySet<string> = new Set([
  'INPUT_PARAMETERS',
  'RECORD_NOT_FOUND',
  'UNAUTHORIZED_BOOKING',
  'BOOKING_CHECK_IN_COMPLETE',
  'RESTRICTED_RESERVATION',
]);

/** A machine code: upper-case words joined by underscores — never free text. */
const MACHINE_CODE = /^[A-Z][A-Z0-9_]{2,63}$/;

/** Read `error_code` out of an error body, if the body is JSON and the value is a machine code. */
export function lobbyErrorCode(body: string): string | undefined {
  try {
    const parsed = JSON.parse(body) as { error_code?: unknown };
    const code = parsed?.error_code;
    return typeof code === 'string' && MACHINE_CODE.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}

function classify(res: Extract<RequestResult, { ok: false }>, code: string | undefined) {
  if (code === 'INPUT_PARAMETERS') return ProviderErrorCode.INVALID_INPUT;
  if (code !== undefined && BUSINESS_CODES.has(code)) return ProviderErrorCode.PROVIDER_ERROR;
  return res.errorCode;
}

/**
 * The single unwrap every LobbyPMS tool goes through. `operation` is a stable label (the tool's
 * verb). The request URL — which carries `api_token` — is never touched here.
 */
export function unwrapLobby(res: RequestResult, operation: string): ToolOutcome {
  if (!res.ok) {
    const code = lobbyErrorCode(res.body);
    return err(
      classify(res, code),
      `LobbyPMS ${operation} failed (HTTP ${res.status}${code ? `, ${code}` : ''})`,
    );
  }
  return ok(res.data);
}
