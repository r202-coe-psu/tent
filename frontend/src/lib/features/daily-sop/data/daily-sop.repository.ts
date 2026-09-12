import type { AuthorContext } from '$lib/db/model';
import type { DailySopAssessment, DailySopDraft } from '../domain/daily-sop';

export type DailySopAuthorContext = AuthorContext & { assessorName?: string };

export interface DailySopRepository {
	list(shelterCode: string): Promise<DailySopAssessment[]>;
	read(id: string): Promise<DailySopAssessment | null>;
	findByShelterDate(shelterCode: string, date: string): Promise<DailySopAssessment | null>;
	createCompleted(
		draft: DailySopDraft,
		date: string,
		ctx: DailySopAuthorContext
	): Promise<
		| { kind: 'created'; assessment: DailySopAssessment }
		| { kind: 'duplicate'; assessment: DailySopAssessment }
	>;
	updateCompleted(
		existing: DailySopAssessment,
		draft: DailySopDraft,
		ctx: DailySopAuthorContext
	): Promise<DailySopAssessment>;
}
