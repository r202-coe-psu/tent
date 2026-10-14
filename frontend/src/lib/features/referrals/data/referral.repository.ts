import type {
	Referral,
	ReferralFilter,
	ReferralInput,
	ReferralStatus
} from '../domain/referral.schema';
import type { AuthorContext } from '$lib/db/model';

export type ReferralSubmitIntent = 'draft' | 'send';

export type ReferralBatchFailure = {
	evacuee_id: string;
	error: string;
};

export type ReferralBatchResult = {
	created: Referral[];
	failed: ReferralBatchFailure[];
};

/** Per-id outcome of a bulk transition (CR-167 FR-B3): partial success, no rollback. */
export type ReferralBulkTransitionResult = {
	succeeded: Referral[];
	failed: { id: string; error: string }[];
};

export interface ReferralRepository {
	list(filter?: ReferralFilter): Promise<Referral[]>;
	get(id: string): Promise<Referral | null>;
	create(input: ReferralInput, ctx: AuthorContext): Promise<Referral>;
	transition(id: string, to: ReferralStatus, actor: string, reason?: string): Promise<Referral>;
	/** One call for many ids, one shared `reason`; the server enforces every per-item rule. */
	bulkTransition(
		ids: string[],
		to: ReferralStatus,
		reason?: string
	): Promise<ReferralBulkTransitionResult>;
}
