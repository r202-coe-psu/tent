import type {
	Referral,
	ReferralFilter,
	ReferralInput,
	ReferralStatus
} from '../domain/referral.schema';
import type { AuthorContext } from '$lib/db/model';

export interface ReferralRepository {
	list(filter?: ReferralFilter): Promise<Referral[]>;
	get(id: string): Promise<Referral | null>;
	create(input: ReferralInput, ctx: AuthorContext): Promise<Referral>;
	transition(id: string, to: ReferralStatus, actor: string, reason?: string): Promise<Referral>;
}
