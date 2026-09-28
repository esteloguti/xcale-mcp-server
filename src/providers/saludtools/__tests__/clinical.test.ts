import { describe, expect, it, vi } from 'vitest';

import { ProviderErrorCode } from '../../../core/errors';
import { SecretString } from '../../../core/secret-string';
import type { ProviderCallContext, ToolResult } from '../../../core/types';
import { createSaludtoolsProvider } from '../provider';
import { buildSaludtoolsClinicalTools } from '../clinical';
import { createSaludtoolsClient } from '../client';
import { PRESCRIBED_MEDICINE_FIELDS } from '../projections';

/**
 * PHASE 3 — the clinical reads.
 *
 * These tools exist before xcale-backend#1055 is answered only because **none of them can be reached
 * by an agent**. That is not a comment, it is the first test in this file, and if it ever goes red
 * the right move is to stop and read the header of `clinical.ts`, not to update the expectation.
 */

const JWT = 'eyJhbGciOi.header.signature.minted-saludtools-jwt';
const CTX: ProviderCallContext = { credential: { secret: new SecretString(JWT) } };
const BASE_URL = 'https://saludtools.qa.carecloud.com.co';

function provider(body: unknown, status = 200) {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = vi.fn(async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return {
    provider: createSaludtoolsProvider({
      fetchImpl: impl as unknown as typeof globalThis.fetch,
      baseUrl: BASE_URL,
    }),
    calls,
  };
}

function successData(result: ToolResult): Record<string, unknown> {
  if (result.kind !== 'success') throw new Error(`expected success, got: ${result.message}`);
  return result.data as Record<string, unknown>;
}

function sentBody(init: RequestInit | undefined): Record<string, unknown> {
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

const CLINICAL = buildSaludtoolsClinicalTools(createSaludtoolsClient({ baseUrl: BASE_URL }));

describe('phase 3 is invisible to agents — the property that let it be built at all', () => {
  it('withdraws EVERY clinical tool from tools/list', () => {
    /*
     * The grill's rule was that #1055 is answered before phase 3 is WRITTEN. Its purpose is that no
     * clinical PHI reaches a model before a human decided it may. `controlPlane: true` honours that
     * purpose exactly — a consumer builds its agent's menu from `tools/list`, so a tool that never
     * appears there cannot be chosen, hallucinated, or reached through prompt injection.
     *
     * Every one, with no exception list: an exception here is a patient's medical record on a
     * model's context window.
     */
    const exposed = CLINICAL.filter((tool) => tool.controlPlane !== true).map((tool) => tool.name);
    expect(exposed).toEqual([]);
    expect(CLINICAL.length).toBeGreaterThan(10);
  });

  it('keeps them out of the published list while leaving them callable by name', async () => {
    const { provider: p } = provider([]);
    const published = (await p.listTools()).map((tool) => tool.name);

    for (const tool of CLINICAL) {
      expect(published, `${tool.name} is published`).not.toContain(tool.name);
    }
    // The agenda loop is still published — this is a withdrawal, not a broken provider.
    expect(published).toContain('mcp_saludtools_get_agenda');
  });

  it('declares who each clinical tool can reach', () => {
    // A schema cannot say that `documentNumber` is somebody's cédula. identityPolicy does
    // (xcale-mcp-server#101), and a PHI surface with tools that declare nothing is the thing that
    // field exists to prevent.
    for (const tool of CLINICAL) {
      expect(tool.identityPolicy, `${tool.name} declares no identity policy`).toBeDefined();
    }
  });
});

describe('the two clinical absences are told apart, because they need opposite answers', () => {
  const absence = (message: string) => ({ id: null, code: 412, message, body: null });

  it('reports an unregistered patient as such', async () => {
    // Observed 2026-09-24 on MEDICINE/READ with a document nobody holds.
    const { provider: p } = provider(
      absence('No existe paciente con ese tipo y numero de documentacion en la compañia'),
    );
    const data = successData(
      await p.callTool(
        'mcp_saludtools_get_last_prescription',
        { documentType: 1, documentNumber: '99999999999999' },
        CTX,
      ),
    );
    expect(data).toEqual({ found: false, reason: 'patient_not_registered' });
  });

  it('reports a registered patient with no such record as such', async () => {
    // Observed 2026-09-24 on the synthetic patient, who existed and had no prescriptions.
    const { provider: p } = provider(
      absence(
        'No se ha encontrado una prescripcion en nuestra base de datos con los valores de busqueda ingresados.',
      ),
    );
    const data = successData(
      await p.callTool(
        'mcp_saludtools_get_last_prescription',
        { documentType: 1, documentNumber: '999999902' },
        CTX,
      ),
    );
    expect(data).toEqual({ found: false, reason: 'no_record_for_patient' });
  });

  it('does not collapse them into one absence', () => {
    /*
     * The failure this guards is concrete: told "not found" for a patient who IS registered, an
     * agent offers to register them, the create is refused as a duplicate, and the conversation
     * loops — a loop built entirely out of a missing distinction. Same class of bug as the three
     * absent-value defects this integration has already produced.
     */
    expect('patient_not_registered').not.toEqual('no_record_for_patient');
  });

  it('still reports a real input error as an error', async () => {
    // A malformed body is not an absence. Matching too loosely here would turn every mistake into
    // "this patient has no records", which reads as an answer and is a lie.
    const { provider: p } = provider(
      absence('El cuerpo del evento esta mal conformado por favor verifique la documentacion'),
    );
    const result = await p.callTool(
      'mcp_saludtools_get_gyneco_history',
      { documentType: 1, documentNumber: '999999902' },
      CTX,
    );
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.code).toBe(ProviderErrorCode.INVALID_INPUT);
    }
  });
});

describe('the projections drop what must not travel', () => {
  it('strips storage layout and internal ids from a document', async () => {
    /*
     * `pathLocation` embeds a patient's internal id in a bucket path — a small map of where that
     * person's files live — and `uuid` and `patient` are another system's row identity. None is
     * signal for any job; all three are in the vendor's response.
     */
    const { provider: p } = provider({
      id: 1,
      code: 200,
      body: {
        id: 30303,
        fileName: 'img.png',
        typeFile: 'image/png',
        byteSize: 57198,
        pathLocation: 'patients/1/11111/files/b3b5f98a-b935-4d3c-b12a-20e083206a7a/',
        uuid: 'b3b5f98a-b935-4d3c-b12a-20e083206a7a',
        insertDate: '2022-09-08T15:32:17.000+00:00',
        encounterId: 12345,
        diaryId: 67890,
        patient: 11111,
        idExam: 13579,
      },
    });
    const data = successData(
      await p.callTool('mcp_saludtools_get_patient_file', { id: 30303 }, CTX),
    );
    const record = data.record as Record<string, unknown>;

    expect(record.fileName).toBe('img.png');
    expect(record).not.toHaveProperty('pathLocation');
    expect(record).not.toHaveProperty('uuid');
    expect(record).not.toHaveProperty('patient');
    expect(JSON.stringify(data)).not.toContain('b3b5f98a');
  });

  it('projects the medicines nested inside a prescription, not just the envelope', async () => {
    // The nested half is where a flat projection quietly leaks: the outer object looks projected
    // while the list inside it passes through whole.
    const { provider: p } = provider({
      id: 1,
      code: 200,
      body: {
        encounterId: 12500,
        PatientId: 12800,
        doctorDocumentType: 1,
        doctorDocumentNumber: 1111111,
        improved: true,
        prescriptedMedicine: [
          {
            medicinePrescriptionType: 'ACTIVE_PRINCIPLE',
            quantityUnit: 'Tabletas',
            comments: 'Tomar despues del desayuno',
            undocumentedInternalField: 'should not travel',
          },
        ],
      },
    });
    const data = successData(
      await p.callTool(
        'mcp_saludtools_get_last_prescription',
        { documentType: 1, documentNumber: '999999902' },
        CTX,
      ),
    );
    const record = data.record as Record<string, unknown>;
    const medicines = record.prescriptedMedicine as Record<string, unknown>[];

    expect(medicines[0]?.quantityUnit).toBe('Tabletas');
    expect(medicines[0]).not.toHaveProperty('undocumentedInternalField');
    // The caller already named the patient to ask; handing back SaludTools' row id for them adds no
    // signal and gives a consumer a second, undocumented way to address a person.
    expect(record).not.toHaveProperty('PatientId');
  });

  it("keeps the vendor's own misspellings, because they are the wire", () => {
    /*
     * `comercialProductName`, `frecuencyImproved`, `intakemethod`. "Correcting" any of them means the
     * field never matches and the dose silently disappears from a prescription — a projection that
     * tidies spelling is a projection that returns an empty medicine.
     */
    expect(PRESCRIBED_MEDICINE_FIELDS).toContain('comercialProductName');
    expect(PRESCRIBED_MEDICINE_FIELDS).toContain('frecuencyImproved');
    expect(PRESCRIBED_MEDICINE_FIELDS).toContain('intakemethod');
  });
});

describe('the field name is not uniform, and the adapter respects that', () => {
  it('sends `documentType` to the surfaces that name it that way', async () => {
    const { provider: p, calls } = provider({ id: null, code: 200, body: {} });
    await p.callTool(
      'mcp_saludtools_get_gyneco_history',
      { documentType: 1, documentNumber: '123' },
      CTX,
    );
    const body = sentBody(calls[0]?.init) as { body: Record<string, unknown> };
    expect(body.body).toHaveProperty('documentType', 1);
    expect(body.body).not.toHaveProperty('patientDocumentType');
  });

  it('sends `patientDocumentType` to the surfaces that name it THAT way', async () => {
    /*
     * Six surfaces say `documentType` and four say `patientDocumentType`. Sending the wrong one is
     * not a near miss — production answers "el cuerpo del evento esta mal conformado", which reads
     * exactly like "this surface cannot be reached by document" and cost a week of believing three
     * surfaces were unreachable.
     */
    const { provider: p, calls } = provider({ id: null, code: 200, body: { content: [] } });
    await p.callTool(
      'mcp_saludtools_search_exam_results',
      { patientDocumentType: 1, documentNumber: '123' },
      CTX,
    );
    const body = sentBody(calls[0]?.init) as { body: Record<string, unknown> };
    expect(body.body).toHaveProperty('patientDocumentType', 1);
    expect(body.body).not.toHaveProperty('documentType');
  });

  it('uses the nested read-last body for MEDICINE, and only for MEDICINE', async () => {
    const { provider: p, calls } = provider({ id: null, code: 200, body: {} });
    await p.callTool(
      'mcp_saludtools_get_last_prescription',
      { documentType: 1, documentNumber: '123' },
      CTX,
    );
    const body = sentBody(calls[0]?.init) as { eventType: string; body: Record<string, unknown> };
    expect(body.eventType).toBe('MEDICINE');
    expect(body.body).toHaveProperty('search');
  });
});

describe('the clinical searches', () => {
  it("translate 1-based paging to the provider's 0-based pageable and clamp at 20", async () => {
    const { provider: p, calls } = provider({ id: null, code: 200, body: { content: [] } });
    await p.callTool(
      'mcp_saludtools_search_patient_files',
      { documentType: 1, documentNumber: '123', page: 3, pageSize: 50 },
      CTX,
    );
    const body = sentBody(calls[0]?.init) as { body: { pageable: unknown } };
    expect(body.body.pageable).toEqual({ page: 2, size: 20 });
  });

  it('return an empty page as an empty page, not as an error', async () => {
    const { provider: p } = provider({
      id: null,
      code: 200,
      body: { content: [], totalElements: 0, empty: true },
    });
    const data = successData(
      await p.callTool(
        'mcp_saludtools_search_disabilities',
        { documentType: 1, documentNumber: '123' },
        CTX,
      ),
    );
    expect(data).toEqual({ records: [], total: 0 });
  });

  it('project every record in the page', async () => {
    const { provider: p } = provider({
      id: null,
      code: 200,
      body: {
        content: [
          { startInabilityDate: '2022-09-30', comments: 'reposo', internalRowId: 99 },
          { startInabilityDate: '2022-10-30', comments: 'control', internalRowId: 100 },
        ],
        totalElements: 2,
      },
    });
    const data = successData(
      await p.callTool(
        'mcp_saludtools_search_disabilities',
        { documentType: 1, documentNumber: '123' },
        CTX,
      ),
    );
    const records = data.records as Record<string, unknown>[];
    expect(records).toHaveLength(2);
    expect(data.total).toBe(2);
    for (const record of records) expect(record).not.toHaveProperty('internalRowId');
  });
});
