import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { touch, makeDoc, type AuthorContext } from '$lib/db/model';
import { getShelterDb } from '$lib/db/shelter';
import {
	isReferral,
	type Referral,
	type ReferralFilter,
	referralFilterSchema,
	type ReferralInput,
	type ReferralStatus,
	buildReferralBody,
	referralSchema
} from '../domain/referral.schema';
import { applyTransition } from '../domain/referral.transitions';
import { peopleRepository } from '$lib/features/people';
import type { ReferralRepository } from './referral.repository';

export class ReferralRemoteRepository implements ReferralRepository {
	private readonly repo: Repository;

	constructor(private readonly dbName: string) {
		this.repo = createRemoteRepository(dbName);
	}

	async list(filter?: ReferralFilter): Promise<Referral[]> {
		const parsed = referralFilterSchema.parse(filter ?? {});
		const selector: Record<string, unknown> = {
			type: 'referral'
		};

		if (parsed.status) {
			selector.status = parsed.status;
		}
		if (parsed.evacuee_id) {
			selector.evacuee_id = parsed.evacuee_id;
		}

		const sort =
			parsed.sort === 'created_at_asc'
				? [{ type: 'asc' }, { created_at: 'asc' }]
				: [{ type: 'desc' }, { created_at: 'desc' }];

		const docs = await this.repo.find<Referral>({
			selector,
			limit: parsed.limit,
			skip: parsed.skip,
			sort
		});
		return docs.filter(isReferral);
	}

	async get(id: string): Promise<Referral | null> {
		const doc = await this.repo.get<Referral>(id);
		return doc && isReferral(doc) ? doc : null;
	}

	async create(input: ReferralInput, ctx: AuthorContext): Promise<Referral> {
		const evacuee = await peopleRepository().getEvacuee(input.evacuee_id);
		if (!evacuee) {
			throw new Error(`Evacuee with ID ${input.evacuee_id} was not found in the active shelter.`);
		}

		const body = buildReferralBody(input);
		const rawDoc = makeDoc('referral', 1, body, ctx);

		const doc = referralSchema.parse(rawDoc);
		return this.repo.put(doc) as Promise<Referral>;
	}

	async transition(
		id: string,
		to: ReferralStatus,
		actor: string,
		reason?: string
	): Promise<Referral> {
		const latest = await this.repo.get<Referral>(id);
		if (!latest || !isReferral(latest)) {
			throw new Error(`Referral ${id} not found or invalid`);
		}

		const nowIso = new Date().toISOString();

		// Side-effect for capacity referral: when accepted, transfer evacuee to destination shelter
		if (to === 'accepted' && latest.referral_type === 'capacity' && latest.to_shelter_code) {
			const evacuee = await peopleRepository().getEvacuee(latest.evacuee_id);
			if (!evacuee) {
				throw new Error(
					`Evacuee ${latest.evacuee_id} not found — cannot complete shelter transfer`
				);
			}

			await peopleRepository().updateEvacuee({
				...evacuee,
				shelter_code: latest.to_shelter_code,
				updated_at: nowIso
			});
		}

		const updated = applyTransition(latest, to, actor, nowIso, reason);
		return this.repo.put(touch(updated)) as Promise<Referral>;
	}
}

let singleton: ReferralRepository | null = null;
let singletonDbName: string | null = null;

export function referralRepository(): ReferralRepository {
	const currentDb = getShelterDb();
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new ReferralRemoteRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}
