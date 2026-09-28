import { z } from 'zod';

import { defineTool, err, ok, type ToolDefinition, type ToolOutcome } from '../../core/tool';
import type { SaludtoolsClient } from './client';
import { clinicalAbsence, unwrapSaludtools } from './errors';
import { SLUG } from './manifest';
import {
  DISABILITY_FIELDS,
  DOCUMENT_FIELDS,
  EXAM_PRESCRIPTION_FIELDS,
  EXAM_PRESCRIPTION_ITEM_FIELDS,
  EXAM_RESULT_FIELDS,
  FAMILY_HISTORY_FIELDS,
  GYNECO_HISTORY_FIELDS,
  PARACLINIC_FIELDS,
  PERSONAL_HISTORY_FIELDS,
  PRESCRIBED_MEDICINE_FIELDS,
  PRESCRIPTION_FIELDS,
  project,
  projectAll,
} from './projections';

/*
 * PHASE 3 — the clinical reads. Read this before adding, exposing or calling anything here.
 *
 * ## Every tool in this file is CONTROL-PLANE, and for two different reasons
 *
 * `controlPlane: true` means dispatched by `tools/call` but **withdrawn from `tools/list`**
 * (ADR 0013). A consumer builds its agent's menu from `tools/list`, so a tool that never appears
 * there cannot be chosen by a model, hallucinated into a plan, or reached through prompt injection.
 *
 * - **For the reads in this file it is TEMPORARY, and it is the whole reason they could be built.**
 *   The grill's rule was that xcale-backend#1055 — may a clinic's agent put patient records in front
 *   of the model? — is answered *before phase 3 is written*, not before it ships. That rule exists to
 *   stop clinical PHI reaching an LLM before a human decided it may. Withdrawing the tools honours
 *   the rule's purpose exactly: the code exists, is typed and is tested, and **no agent can see or
 *   call any of it**. Zero PHI reaches a model. When #1055 lands, exposing a tool is deleting one
 *   line from its definition.
 * - **For the clinical WRITES (phase 4) it is PERMANENT** — decision D5. Prescribing, recording a
 *   diagnosis or filing a disability certificate are not moves an agent makes on a patient's behalf
 *   under any tenant's rules.
 *
 * If you are here to turn a read on: read `docs/design/saludtools-provider/clinical-surfaces.md`
 * first, and read `GYNECO_HISTORY_FIELDS` in `projections.ts` before you turn that one on at all.
 *
 * ## What is NOT here, and why
 *
 * - **`CLINIC_HISTORY`'s read.** Its response nests `patientVitalSignsRecord` — roughly eighty
 *   numeric fields — plus `sectionDiagnostic` and `patientPhysicalExamination`. D6 wants an
 *   allow-list, and an allow-list of eighty fields transcribed by hand from a web page is a list
 *   with a typo in it. It is also the surface nothing can reach from a patient document (observed:
 *   it rejects both documented field names), so there is no agent path to it anyway. It gets its own
 *   pass, with the field list generated rather than typed.
 * - **Anything that is not in the vendor's attribute tables.** These schemas are *Documented*, never
 *   *Observed*: the production key is a live clinic's and no clinical record has been read. The
 *   projections are safe under that uncertainty — see the block comment in `projections.ts` — but
 *   the input schemas are not proven, and the first real call will correct some of them.
 */

/** The patient, as most clinical surfaces name them. */
const patientRef = {
  documentType: z
    .number()
    .int()
    .positive()
    .describe('Patient identity document type id — from the `documentTypes` catalog'),
  documentNumber: z.string().min(1).describe('Patient identity document number'),
};

/**
 * The patient, as `EXAMS_RESULTS`, `CLINIC_HISTORY`, `EXAMS_PRESCRIPTION` and `PARACLINICS` name
 * them — `patientDocumentType`, not `documentType`.
 *
 * **Not a typo, and deliberately not unified.** Six surfaces say `documentType` and four say
 * `patientDocumentType`; nothing distinguishes the two groups but the vendor's own history. A helper
 * that normalised them would hide the very difference that made three surfaces look unreachable for
 * a week (`clinical-surfaces.md` §1). Fidelity over Unification (ADR 0009).
 */
const altPatientRef = {
  patientDocumentType: z
    .number()
    .int()
    .positive()
    .describe('Patient identity document type id — from the `documentTypes` catalog'),
  documentNumber: z.string().min(1).describe('Patient identity document number'),
};

/** A record id, as the surfaces that read by id take it. */
const recordId = {
  id: z.number().int().positive().describe("The record's SaludTools id"),
};

/** Uniform paging for the clinical searches, translated to SaludTools' 0-based `pageable`. */
const MAX_PROVIDER_PAGE_SIZE = 20;
const paging = {
  page: z.number().int().positive().default(1).describe('1-based page number'),
  pageSize: z
    .number()
    .int()
    .positive()
    .default(MAX_PROVIDER_PAGE_SIZE)
    .describe(`Records per page (clamped to ${MAX_PROVIDER_PAGE_SIZE}, the provider's ceiling)`),
};

function pageable(page: number, pageSize: number): { page: number; size: number } {
  return { page: page - 1, size: Math.min(pageSize, MAX_PROVIDER_PAGE_SIZE) };
}

/**
 * Shape a clinical read's outcome.
 *
 * The two absences are reported by NAME rather than as one `found: false`, because they call for
 * opposite next moves — register this person, versus tell them they have no such record. See
 * `clinicalAbsence` in `errors.ts` for both observed wordings and why prose-matching is unavoidable
 * on this surface.
 */
function clinicalRead(
  result: ReturnType<typeof unwrapSaludtools>,
  shape: (record: unknown) => unknown,
): ToolOutcome {
  if (!result.ok) {
    const absence = clinicalAbsence(result);
    if (absence) return ok({ found: false, reason: absence });
    return err(result.code, result.message);
  }
  if (result.data === null || result.data === undefined) {
    // Not observed on a clinical surface — absence arrives as a 412 with prose, handled above. If it
    // ever does arrive structurally, "no record" is the only thing an empty body can mean here.
    return ok({ found: false, reason: 'no_record_for_patient' });
  }
  return ok({ found: true, record: shape(result.data) });
}

/** Shape a clinical search's outcome: a page of projected records, or a named absence. */
function clinicalSearch(
  result: ReturnType<typeof unwrapSaludtools>,
  fields: readonly string[],
): ToolOutcome {
  if (!result.ok) {
    const absence = clinicalAbsence(result);
    if (absence) return ok({ records: [], total: 0, reason: absence });
    return err(result.code, result.message);
  }
  const body = result.data as {
    readonly content?: unknown;
    readonly totalElements?: unknown;
  } | null;
  if (body === null || typeof body !== 'object') return ok({ records: [], total: 0 });
  const content = Array.isArray(body.content) ? body.content : [];
  return ok({
    records: projectAll(content, fields),
    total: typeof body.totalElements === 'number' ? body.totalElements : content.length,
  });
}

/** A prescription, with its medicine list projected too — the nested half D6 would otherwise miss. */
function shapePrescription(record: unknown): unknown {
  const projected = project(record, PRESCRIPTION_FIELDS);
  if (projected === null) return null;
  const medicines = projected.prescriptedMedicine;
  if (Array.isArray(medicines)) {
    projected.prescriptedMedicine = projectAll(medicines, PRESCRIBED_MEDICINE_FIELDS);
  }
  return projected;
}

/** An exam result, with its attached document projected — storage paths and internal ids dropped. */
function shapeExamResult(record: unknown): unknown {
  const projected = project(record, EXAM_RESULT_FIELDS);
  if (projected === null) return null;
  if (projected.Documentos !== undefined && projected.Documentos !== null) {
    projected.Documentos = Array.isArray(projected.Documentos)
      ? projectAll(projected.Documentos, DOCUMENT_FIELDS)
      : project(projected.Documentos, DOCUMENT_FIELDS);
  }
  return projected;
}

/** An exam prescription, with its exam list projected. */
function shapeExamPrescription(record: unknown): unknown {
  const projected = project(record, EXAM_PRESCRIPTION_FIELDS);
  if (projected === null) return null;
  const exams = projected.examsRemissions;
  if (Array.isArray(exams)) {
    projected.examsRemissions = projectAll(exams, EXAM_PRESCRIPTION_ITEM_FIELDS);
  }
  return projected;
}

const flat =
  (fields: readonly string[]) =>
  (record: unknown): unknown =>
    project(record, fields);

/**
 * Phase 3's tools. Every one is `controlPlane: true` — see the file header.
 *
 * `identityPolicy` is `subject-bound` wherever the caller names a patient, and `subject-scoped`
 * where it names a record id: the consumer is told which argument identifies a person, because a
 * schema alone cannot say that `documentNumber` is somebody's cédula (xcale-mcp-server#101).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function buildSaludtoolsClinicalTools(
  client: SaludtoolsClient,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): readonly ToolDefinition<any>[] {
  return [
    /* ─────────────────── Reachable from a patient document ─────────────────── */

    defineTool({
      name: `mcp_${SLUG}_get_last_prescription`,
      description:
        "Read a patient's most recent medicine prescription. Identified by the patient's identity " +
        'document. Answers `{found: false, reason: "patient_not_registered"}` when nobody holds that ' +
        'document, and `reason: "no_record_for_patient"` when the patient exists and has none.',
      input: z.object({ ...patientRef }).strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) =>
        clinicalRead(
          unwrapSaludtools(
            // The nested `{search: {...}}` body is MEDICINE's documented read-last variant, and the
            // only clinical surface that takes it. Observed accepted 2026-09-24.
            await client.event('MEDICINE', 'READ', { search: { ...args } }, ctx.request),
            'read last prescription',
          ),
          shapePrescription,
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_get_gyneco_history`,
      description:
        "Read a patient's gynaecological and obstetric history — pregnancies, births, contraception " +
        'and menstrual history. Highly sensitive under Ley 1581; see the projection comment before ' +
        'exposing this to anything.',
      input: z.object({ ...patientRef }).strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) =>
        clinicalRead(
          unwrapSaludtools(
            await client.event('GYNECOOBS_HISTORY', 'READ', { ...args }, ctx.request),
            'read gynaecological history',
          ),
          flat(GYNECO_HISTORY_FIELDS),
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_get_family_history`,
      description: "Read a patient's family medical history by their identity document.",
      input: z.object({ ...patientRef }).strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) =>
        clinicalRead(
          unwrapSaludtools(
            await client.event('FAMILY_HISTORY', 'READ', { ...args }, ctx.request),
            'read family history',
          ),
          flat(FAMILY_HISTORY_FIELDS),
        ),
    }),

    /* ───────── Searches: how a caller discovers the ids the reads below need ───────── */

    defineTool({
      name: `mcp_${SLUG}_search_exam_results`,
      description:
        "List a patient's exam results. This is how record ids are discovered: the exam-result read " +
        'takes an id, and nothing else in the API hands one out.',
      input: z.object({ ...altPatientRef, ...paging }).strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) => {
        const { page, pageSize, ...filters } = args;
        return clinicalSearch(
          unwrapSaludtools(
            await client.event(
              'EXAMS_RESULTS',
              'SEARCH',
              { ...filters, pageable: pageable(page, pageSize) },
              ctx.request,
            ),
            'search exam results',
          ),
          EXAM_RESULT_FIELDS,
        );
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_search_family_history`,
      description: "List a patient's family-history entries.",
      input: z.object({ ...patientRef, ...paging }).strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) => {
        const { page, pageSize, ...filters } = args;
        return clinicalSearch(
          unwrapSaludtools(
            await client.event(
              'FAMILY_HISTORY',
              'SEARCH',
              { ...filters, pageable: pageable(page, pageSize) },
              ctx.request,
            ),
            'search family history',
          ),
          FAMILY_HISTORY_FIELDS,
        );
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_search_disabilities`,
      description: "List a patient's disability certificates (_incapacidades_).",
      input: z.object({ ...patientRef, ...paging }).strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) => {
        const { page, pageSize, ...filters } = args;
        return clinicalSearch(
          unwrapSaludtools(
            await client.event(
              'INABILITYWORK',
              'SEARCH',
              { ...filters, pageable: pageable(page, pageSize) },
              ctx.request,
            ),
            'search disabilities',
          ),
          DISABILITY_FIELDS,
        );
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_search_patient_files`,
      description:
        "List the documents attached to a patient's record. Returns metadata only — no file content.",
      input: z.object({ ...patientRef, ...paging }).strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) => {
        const { page, pageSize, ...filters } = args;
        return clinicalSearch(
          unwrapSaludtools(
            await client.event(
              'PATIENT_FILES',
              'SEARCH',
              { ...filters, pageable: pageable(page, pageSize) },
              ctx.request,
            ),
            'search patient files',
          ),
          DOCUMENT_FIELDS,
        );
      },
    }),

    defineTool({
      name: `mcp_${SLUG}_search_personal_history`,
      description: "List a patient's personal medical antecedents.",
      input: z.object({ ...patientRef, ...paging }).strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-bound', identityFields: ['documentNumber'] },
      handler: async (args, ctx) => {
        const { page, pageSize, ...filters } = args;
        return clinicalSearch(
          unwrapSaludtools(
            await client.event(
              'ANTECEDENT_PERSONAL',
              'SEARCH',
              { ...filters, pageable: pageable(page, pageSize) },
              ctx.request,
            ),
            'search personal history',
          ),
          PERSONAL_HISTORY_FIELDS,
        );
      },
    }),

    /* ───────────────────────── Reads by record id ───────────────────────── */

    defineTool({
      name: `mcp_${SLUG}_get_prescription`,
      description: 'Read one medicine prescription by its SaludTools id.',
      input: z.object({ ...recordId }).strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-scoped' },
      handler: async (args, ctx) =>
        clinicalRead(
          unwrapSaludtools(
            await client.event('MEDICINE', 'READ', { id: args.id }, ctx.request),
            'read prescription',
          ),
          shapePrescription,
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_get_exam_result`,
      description:
        'Read one exam result by its SaludTools id — the id comes from `search_exam_results`.',
      input: z.object({ ...recordId }).strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-scoped' },
      handler: async (args, ctx) =>
        clinicalRead(
          unwrapSaludtools(
            await client.event('EXAMS_RESULTS', 'READ', { id: args.id }, ctx.request),
            'read exam result',
          ),
          shapeExamResult,
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_get_disability`,
      description: 'Read one disability certificate by its SaludTools id.',
      input: z.object({ ...recordId }).strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-scoped' },
      handler: async (args, ctx) =>
        clinicalRead(
          unwrapSaludtools(
            await client.event('INABILITYWORK', 'READ', { id: args.id }, ctx.request),
            'read disability',
          ),
          flat(DISABILITY_FIELDS),
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_get_patient_file`,
      description:
        "Read one patient document's metadata by its SaludTools id. Storage path and internal ids " +
        "are dropped — they describe another system's bucket layout, not the document.",
      input: z.object({ ...recordId }).strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-scoped' },
      handler: async (args, ctx) =>
        clinicalRead(
          unwrapSaludtools(
            await client.event('PATIENT_FILES', 'READ', { id: args.id }, ctx.request),
            'read patient file',
          ),
          flat(DOCUMENT_FIELDS),
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_get_personal_history_entry`,
      description: 'Read one personal antecedent by its SaludTools id.',
      input: z.object({ ...recordId }).strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-scoped' },
      handler: async (args, ctx) =>
        clinicalRead(
          unwrapSaludtools(
            await client.event('ANTECEDENT_PERSONAL', 'READ', { id: args.id }, ctx.request),
            'read personal history entry',
          ),
          flat(PERSONAL_HISTORY_FIELDS),
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_get_paraclinic`,
      description:
        'Read one clinical-laboratory result by its SaludTools id. `examDate` comes back as ' +
        '`DD-MM-AAAA` on this surface — the vendor uses a different date format here than elsewhere, ' +
        'and it travels verbatim.',
      input: z.object({ ...recordId }).strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-scoped' },
      handler: async (args, ctx) =>
        clinicalRead(
          unwrapSaludtools(
            await client.event('PARACLINICS', 'READ', { id: args.id }, ctx.request),
            'read paraclinic',
          ),
          flat(PARACLINIC_FIELDS),
        ),
    }),

    defineTool({
      name: `mcp_${SLUG}_get_exam_prescription`,
      description: 'Read one exam prescription by its SaludTools id.',
      input: z.object({ ...recordId }).strict(),
      controlPlane: true,
      identityPolicy: { mode: 'subject-scoped' },
      handler: async (args, ctx) =>
        clinicalRead(
          unwrapSaludtools(
            await client.event('EXAMS_PRESCRIPTION', 'READ', { id: args.id }, ctx.request),
            'read exam prescription',
          ),
          shapeExamPrescription,
        ),
    }),
  ];
}
