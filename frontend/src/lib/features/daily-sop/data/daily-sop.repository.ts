import type { AuthorContext } from '$lib/db/model';
import type { DailySopAssessment, DailySopDraft } from '../domain/daily-sop';

export interface DailySopRepository {
	list(shelterCode: string): Promise<DailySopAssessment[]>;
	read(id: string): Promise<DailySopAssessment | null>;
	findByShelterDate(shelterCode: string, date: string): Promise<DailySopAssessment | null>;
	createCompleted(
		draft: DailySopDraft,
		date: string,
		ctx: AuthorContext
	): Promise<
		| { kind: 'created'; assessment: DailySopAssessment }
		| { kind: 'duplicate'; assessment: DailySopAssessment }
	>;
	updateCompleted(
		existing: DailySopAssessment,
		draft: DailySopDraft,
		ctx: AuthorContext
	): Promise<DailySopAssessment>;
}
