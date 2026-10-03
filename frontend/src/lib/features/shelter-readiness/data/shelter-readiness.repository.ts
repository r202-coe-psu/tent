import { allDocsByType, getDoc, putDocStrict } from '$lib/db/couch-db';
import { getShelterDb } from '$lib/db/shelter';
import { ShelterReadinessAssessmentDocSchema } from '../domain/readiness.schemas';
import type {
	ReadinessAuditEntry,
	ReadinessVerdict,
	ShelterReadinessAssessmentDoc
} from '../domain/readiness.types';
import { tallyAssessmentSummary } from '../domain/readiness.utils';

export const READINESS_DOC_TYPE = 'shelter_readiness_assessment' as const;

function isReadinessDoc(doc: unknown): doc is ShelterReadinessAssessmentDoc {
	if (!doc || typeof doc !== 'object') return false;
	const candidate = doc as Record<string, unknown>;
	return candidate.type === READINESS_DOC_TYPE;
}

export class ShelterReadinessRepository {
	/**
	 * Lists all readiness assessments for a given shelter, sorted newest first.
	 */
	async listAssessments(shelterCode: string): Promise<ShelterReadinessAssessmentDoc[]> {
		const dbName = getShelterDb(shelterCode);
		const rawDocs = await allDocsByType(dbName, READINESS_DOC_TYPE, isReadinessDoc);

		const parsedDocs: ShelterReadinessAssessmentDoc[] = [];
		for (const raw of rawDocs) {
			const parsed = ShelterReadinessAssessmentDocSchema.safeParse(raw);
			if (parsed.success) {
				parsedDocs.push(parsed.data);
			} else {
				console.warn(
					`[ShelterReadinessRepository] Invalid doc schema for id ${(raw as { _id?: string })._id}:`,
					parsed.error
				);
			}
		}

		return parsedDocs.sort((a, b) => b.created_at.localeCompare(a.created_at));
	}

	/**
	 * Gets a single assessment by its document ID.
	 */
	async getAssessmentById(
		shelterCode: string,
		docId: string
	): Promise<ShelterReadinessAssessmentDoc | null> {
		const dbName = getShelterDb(shelterCode);
		const raw = await getDoc<ShelterReadinessAssessmentDoc>(dbName, docId);
		if (!raw || !isReadinessDoc(raw)) return null;

		const parsed = ShelterReadinessAssessmentDocSchema.safeParse(raw);
		return parsed.success ? parsed.data : null;
	}

	/**
	 * Retrieves the latest completed assessment for display on the shelter profile,
	 * falling back to the latest draft if no completed assessment exists.
	 */
	async getLatestAssessment(shelterCode: string): Promise<ShelterReadinessAssessmentDoc | null> {
		const all = await this.listAssessments(shelterCode);
		if (all.length === 0) return null;

		const latestSubmitted = all.find((d) => d.status === 'submitted');
		return latestSubmitted ?? all[0];
	}

	/**
	 * Saves an assessment in 'draft' status.
	 */
	async saveDraft(doc: ShelterReadinessAssessmentDoc): Promise<ShelterReadinessAssessmentDoc> {
		const dbName = getShelterDb(doc.shelter_code);
		const summary = tallyAssessmentSummary(doc.items);
		const now = new Date().toISOString();

		const updatedDoc: ShelterReadinessAssessmentDoc = {
			...doc,
			status: 'draft',
			summary,
			updated_at: now
		};

		return putDocStrict(dbName, updatedDoc);
	}

	/**
	 * Submits an assessment with a final inspector verdict and mandatory justification note.
	 */
	async submitVerdict(params: {
		doc: ShelterReadinessAssessmentDoc;
		verdict: ReadinessVerdict;
		justificationNote: string;
		submittedBy: string;
	}): Promise<ShelterReadinessAssessmentDoc> {
		if (!params.justificationNote.trim()) {
			throw new Error('กรุณาระบุเหตุผลหรือมาตรการชดเชยในการตัดสินผลความพร้อม');
		}

		const dbName = getShelterDb(params.doc.shelter_code);
		const now = new Date().toISOString();
		const summary = tallyAssessmentSummary(params.doc.items);

		const submittedDoc: ShelterReadinessAssessmentDoc = {
			...params.doc,
			status: 'submitted',
			verdict: params.verdict,
			justification_note: params.justificationNote.trim(),
			summary,
			submitted_by: params.submittedBy,
			submitted_at: now,
			updated_at: now
		};

		return putDocStrict(dbName, submittedDoc);
	}

	/**
	 * Allows System Admin to edit an already submitted assessment with audit history tracking.
	 */
	async adminEditAssessment(params: {
		doc: ShelterReadinessAssessmentDoc;
		editedBy: string;
		reason: string;
		newVerdict?: ReadinessVerdict;
	}): Promise<ShelterReadinessAssessmentDoc> {
		if (!params.reason.trim()) {
			throw new Error('กรุณาระบุเหตุผลในการแก้ไขผลการประเมินย้อนหลัง');
		}

		const dbName = getShelterDb(params.doc.shelter_code);
		const now = new Date().toISOString();
		const summary = tallyAssessmentSummary(params.doc.items);

		const auditEntry: ReadinessAuditEntry = {
			edited_by: params.editedBy,
			edited_at: now,
			reason: params.reason.trim(),
			previous_verdict: params.doc.verdict
		};

		const updatedDoc: ShelterReadinessAssessmentDoc = {
			...params.doc,
			verdict: params.newVerdict ?? params.doc.verdict,
			summary,
			updated_at: now,
			edit_history: [...(params.doc.edit_history ?? []), auditEntry]
		};

		return putDocStrict(dbName, updatedDoc);
	}
}

let _repoInstance: ShelterReadinessRepository | null = null;

export function getShelterReadinessRepository(): ShelterReadinessRepository {
	if (!_repoInstance) {
		_repoInstance = new ShelterReadinessRepository();
	}
	return _repoInstance;
}
