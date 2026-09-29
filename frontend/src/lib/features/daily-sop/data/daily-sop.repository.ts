import type { AuthorContext } from '$lib/db/model';
import type {
	DailySopRoleAssessment,
	DailySopRoleCode,
	DailySopRoleDraft
} from '../domain/daily-sop';
import type { SopRatioKey } from '$lib/features/sop-ratios';

export type DailySopRoleAuthorContext = AuthorContext & {
	assessorName?: string;
	sopRatios?: Partial<Record<SopRatioKey, string>>;
};

export interface DailySopRoleRepository {
	list(shelterCode: string): Promise<DailySopRoleAssessment[]>;
	read(id: string): Promise<DailySopRoleAssessment | null>;
	findByShelterDateRole(
		shelterCode: string,
		date: string,
		role: DailySopRoleCode
	): Promise<DailySopRoleAssessment | null>;
	createOrUpdate(
		role: DailySopRoleCode,
		draft: DailySopRoleDraft,
		date: string,
		ctx: DailySopRoleAuthorContext
	): Promise<DailySopRoleAssessment>;
}
