/**
 * Per-tool field projection — the PHI control this provider leans on hardest.
 *
 * Every tool returns the named fields its job needs and drops the rest. Allow-list, never deny-list,
 * so a field SaludTools adds next release does **not** leak by default: it simply is not in a list, and
 * the tool that should carry it has to be edited on purpose.
 *
 * This is permitted by *Fidelity over Unification* (ADR 0009) because nothing is renamed, retyped or
 * reshaped — each kept field keeps the vendor's own name and value. What is dropped is not signal for
 * the job; it is somebody's medical record travelling further than it was asked to.
 */

/** Keep only `fields`, in order, skipping the ones the record does not carry. */
export function project<T extends string>(
  record: unknown,
  fields: readonly T[],
): Record<string, unknown> | null {
  if (record === null || typeof record !== 'object' || Array.isArray(record)) return null;
  const source = record as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    if (field in source) out[field] = source[field];
  }
  return out;
}

/** Project each element of a list, dropping anything that was not a record. */
export function projectAll<T extends string>(
  records: readonly unknown[],
  fields: readonly T[],
): readonly Record<string, unknown>[] {
  return records
    .map((record) => project(record, fields))
    .filter((record): record is Record<string, unknown> => record !== null);
}

/**
 * A patient, as a service conversation needs them: who they are, how to reach them, and whether they
 * agreed to be reached.
 *
 * `habeasData` is in this list deliberately. It is the clinic's own record of the patient's
 * authorization to be contacted, and an agent that cannot see it is an agent that cannot respect it.
 * Surfacing it is not the same as interpreting it: what the agent then does is the tenant's rule and,
 * where Ley 1581 speaks, the law's — never this adapter's.
 */
export const PATIENT_FIELDS = [
  'firstName',
  'secondName',
  'firstLastName',
  'secondLastName',
  'birthDate',
  'gender',
  'documentType',
  'documentNumber',
  'phone',
  'cellPhone',
  'email',
  'eps',
  'habeasData',
] as const;

/** A full appointment, for the patient it belongs to. */
export const APPOINTMENT_FIELDS = [
  'id',
  'startAppointment',
  'endAppointment',
  'patientDocumentType',
  'patientDocumentNumber',
  'doctorDocumentType',
  'doctorDocumentNumber',
  'modality',
  'stateAppointment',
  'notificationState',
  'appointmentType',
  'clinic',
  'comment',
] as const;

/**
 * A booked interval with **nobody's identity on it** — the projection that makes `get_agenda` safe to
 * offer in a patient-facing channel (grill-notes D7). Drop one field from this list and the tool stops
 * being a calendar and starts being a read of other people's records.
 *
 * Every patient field is gone, and so are two that look harmless and are not:
 *
 * - **`comment`** is free text a receptionist types. The vendor's own documented example is
 *   *"el paciente viene acompañado de su hijo"* — a sentence about a patient and their family, in the
 *   field a naive projection would keep because it is "just a note".
 * - **`appointmentType`** is also free text, and the vendor's own examples are `"Pruebas Luis"` and
 *   `"CITADEPRUEBA"`. The first one is a person's name. A field whose published sample leaks an
 *   identity is not a field an anonymous calendar can carry.
 *
 * `doctorDocumentNumber` stays: it is how the caller books with the same doctor, and a treating
 * physician's professional identity inside their own clinic's scheduling system is not the patient
 * confidentiality this projection exists to protect.
 */
export const AGENDA_FIELDS = [
  'id',
  'startAppointment',
  'endAppointment',
  'doctorDocumentType',
  'doctorDocumentNumber',
  'modality',
  'stateAppointment',
  'clinic',
] as const;

/* ───────────────────────── Clinical surfaces (phase 3) ─────────────────────────
 *
 * Every list below is transcribed from the vendor's own attribute tables
 * (`docs/design/saludtools-provider/clinical-surfaces.md`, read 2026-09-28) — **Documented, not
 * Observed**. No clinical response body has ever been seen: the production key belongs to a live
 * clinic and reading one real record is exactly what xcale-backend#1055 has not decided.
 *
 * Building an allow-list from documentation that has been wrong seven times sounds reckless and is
 * the opposite. **A projection's failure mode is omission.** If the vendor documented a field that
 * does not exist, it is never `in` the record and nothing happens; if it omitted one that does, the
 * projection drops it. Every known documentation error in this integration lands on that safe side —
 * a value the agent does not get, never somebody's record travelling further than it was asked to.
 *
 * The reverse — a deny-list, or passing the record through — has the opposite failure mode, and
 * there is no version of "we were wrong about a field" that is acceptable when the field is a
 * pregnancy history.
 */

/**
 * The storage fields SaludTools attaches to every document it returns, and which never travel.
 *
 * `pathLocation` (`patients/1/11111/files/<uuid>/`) and `uuid` describe another system's bucket
 * layout; `patient` is its internal row id. None of them is signal for any job an agent or a
 * consumer does, and a storage path that embeds a patient id is a small map of where that patient's
 * files live. They are listed here rather than merely left out of the allow-list so that the reason
 * is written down next to the decision.
 */
export const DOCUMENT_FIELDS = [
  'id',
  'fileName',
  'typeFile',
  'byteSize',
  'insertDate',
  'encounterId',
  'diaryId',
  'idExam',
] as const;

/**
 * One prescribed medicine inside a prescription.
 *
 * The vendor's own misspellings are kept verbatim — `comercialProductName`, `frecuencyImproved`,
 * `intakemethod`. They are the wire, and "correcting" them here would mean the field simply never
 * matches and the dose silently disappears from a prescription. Fidelity over Unification (ADR 0009)
 * is not a style preference on this list; it is the difference between a readable prescription and
 * an empty one.
 */
export const PRESCRIBED_MEDICINE_FIELDS = [
  'medicinePrescriptionType',
  'comercialProductName',
  'comercialProductId',
  'magistralPreparationFormula',
  'principleActiveType',
  'atcConcentrationId',
  'intakemethod',
  'quantityImproved',
  'quantityUnit',
  'frecuencyImproved',
  'frequencyUnit',
  'durationImproved',
  'durationUnit',
  'totalQuantity',
  'indicationsTaking',
  'comments',
  'pharmaForm',
] as const;

/**
 * A prescription. `PatientId` is deliberately absent: the caller already identified the patient to
 * ask for this, so handing back SaludTools' internal row id for them adds no signal and gives a
 * consumer a second, undocumented way to address a person.
 */
export const PRESCRIPTION_FIELDS = [
  'encounterId',
  'doctorDocumentType',
  'doctorDocumentNumber',
  'improved',
  'prescriptedMedicine',
] as const;

/** An exam result. `Documentos` is the vendor's capitalisation, and carries the shared document shape. */
export const EXAM_RESULT_FIELDS = [
  'medicalExamType',
  'classificationType',
  'examDate',
  'comments',
  'Documentos',
] as const;

/** A disability certificate (_incapacidad_). */
export const DISABILITY_FIELDS = [
  'diagnosticCIE10ID',
  'consultationExternalCauseID',
  'treatmentAreaOfApplicationID',
  'reoccurenceTypeID',
  'startInabilityDate',
  'endInabilityDate',
  'comments',
] as const;

/** A personal antecedent. */
export const PERSONAL_HISTORY_FIELDS = [
  'encounterCommonInfo',
  'friendlyNameId',
  'othersDiagnosticText',
  'othersDiagnosticTextGroupId',
  'diagnosticType',
  'diagnosticText',
  'diagnosisDate',
  'antecedentStateType',
  'antecedentState',
  'comments',
] as const;

/** A family antecedent. `diagnosticText` and `diagnosticType` are mutually exclusive per the vendor. */
export const FAMILY_HISTORY_FIELDS = [
  'encounterCommonInfo',
  'familiarRelationshipType',
  'diagnosticText',
  'diagnosticType',
  'diagnosisDate',
  'comments',
] as const;

/**
 * Gynaecological and obstetric history — **the most sensitive record this provider exposes.**
 *
 * Pregnancies, terminations, caesareans, age at first intercourse, number of sexual partners,
 * contraception. Ley 1581 calls health data sensitive; this is the part of it nobody would want
 * discussed by an agent that merely had access to it.
 *
 * Every documented field is kept, because a partial obstetric history is a misleading one and this
 * record has no identifiers or storage detail to drop — the whole list IS the clinical signal. The
 * control that matters for this surface is therefore NOT the projection. It is that the tool stays
 * withdrawn from `tools/list` until xcale-backend#1055 says otherwise, and that whoever turns it on
 * reads this comment first.
 */
export const GYNECO_HISTORY_FIELDS = [
  'fup',
  'weeksOfPregnancy',
  'otherObservations',
  'fur',
  'trustworthy',
  'contraceptiveType',
  'detailContraceptiveMethod',
  'aliveBirths',
  'pregnancies',
  'births',
  'cesareans',
  'ceases',
  'molas',
  'ectopics',
  'menarche',
  'pubarchy',
  'telarchy',
  'irs',
  'sexualPartners',
  'menstrualRegularity',
  'menstrualCycles',
  'lastCytologyDate',
  'previousGestationalObservations',
  'currentlyPregnant',
  'ultrasoundDate',
  'gestationWeek',
  'gestationDay',
  'observations',
] as const;

/** A clinical-laboratory result (_paraclínico_). `examDate` arrives as `DD-MM-AAAA` here — a third
 * date format, and not the one the rest of this API uses. Passed through verbatim rather than
 * normalised: an adapter that silently reformats a date is an adapter that can silently get it
 * wrong, and Fidelity over Unification (ADR 0009) says the vendor's value travels as the vendor
 * wrote it. */
export const PARACLINIC_FIELDS = [
  'value',
  'classification',
  'typeId',
  'unitId',
  'comments',
  'examDate',
] as const;

/** One exam inside an exam prescription. */
export const EXAM_PRESCRIPTION_ITEM_FIELDS = [
  'examPrescriptionType',
  'examTypeCode',
  'comments',
  'freePrescriptionText',
] as const;

/** An exam prescription: a named container plus the exams it prescribes. */
export const EXAM_PRESCRIPTION_FIELDS = ['name', 'encounterId', 'examsRemissions'] as const;
