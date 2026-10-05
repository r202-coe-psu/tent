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

export type DailySopRolePage = {
	items: DailySopRoleAssessment[];
	bookmark: string | null;
};

export interface DailySopRoleRepository {
	listPage(
		shelterCode: string,
		bookmark?: string | null,
		asOfDate?: string
	): Promise<DailySopRolePage>;
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
		ctx: DailySopRoleAuthorContext,
		baseAssessment?: DailySopRoleAssessment | null
	): Promise<DailySopRoleAssessment>;
}
