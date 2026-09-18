import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { getShelterDb } from '$lib/db/shelter';
import { touch, type AuthorContext } from '$lib/db/model';
import { sha256Hex } from '$lib/db/hash';
import {
	isVolunteer,
	volunteerSchema,
	makeVolunteer,
	type Volunteer,
	type VolunteerInput,
	type VolunteerStatus
} from '../domain/volunteer.schema';
import { trackingTokenHashFromPayload } from '$lib/features/volunteer-portal/domain/volunteer';
import { nextVolunteerCode } from '../domain/volunteer-code';
import type { VerificationStatus } from '../domain/verification';
import type { VolunteerFilter, VolunteerRepository } from './volunteer.repository';

function normalizePhone(value: string): string {
	const digits = value.replace(/[\s\-()]/g, '');
	if (digits.startsWith('+66')) return `0${digits.slice(3)}`;
	if (digits.startsWith('66') && digits.length >= 11) return `0${digits.slice(2)}`;
	return digits;
}

/** Mint the permanent role-card secret without ever persisting its plaintext. */
function mintTrackingToken(): string {
	const bytes = new Uint8Array(16);
	crypto.getRandomValues(bytes);
	const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
	return `TKT-VOL-${hex.toUpperCase()}`;
}

/**
 * Remote CouchDB repository for the volunteers feature (`volunteer` doc type).
 * Writes go to the active shelter DB (`getShelterDb()`) via cookie-authenticated
 * HTTP — mirrors `people.remote.ts` / `operations.remote.ts`.
 */
export class VolunteerRemoteRepository implements VolunteerRepository {
	private readonly repo: Repository;

	constructor(private readonly dbName: string) {
		this.repo = createRemoteRepository(dbName);
	}

	/**
	 * Validate before every write — `createRemoteRepository.put` validates
	 * nothing, so without this an invalid document shape persists and is then
	 * trusted on read by the rest of the slice.
	 */
	private save(doc: Volunteer): Promise<Volunteer> {
		return this.repo.put(volunteerSchema.parse(doc) as Volunteer);
	}

	async list(filter?: VolunteerFilter): Promise<Volunteer[]> {
		let all = await this.repo.allByType('volunteer', isVolunteer);
		if (filter?.status) all = all.filter((v) => v.status === filter.status);
		if (filter?.source) all = all.filter((v) => v.source === filter.source);
		if (filter?.checkedIn !== undefined) {
			all = all.filter((v) => v.checked_in === filter.checkedIn);
		}
		const q = filter?.search?.trim().toLowerCase();
		if (q) {
			all = all.filter((v) =>
				[v.first_name, v.last_name, v.nickname ?? '', v.phone ?? '']
					.join(' ')
					.toLowerCase()
					.includes(q)
			);
		}
		return all;
	}

	async get(id: string): Promise<Volunteer | null> {
		const doc = await this.repo.get<Volunteer>(id);
		if (doc === null) return null;
		return isVolunteer(doc) ? doc : null;
	}

	async getByTrackingToken(token: string): Promise<Volunteer | null> {
		const normalized = token.trim().toUpperCase();
		const embeddedHash = trackingTokenHashFromPayload(normalized);
		const docs = await this.repo.find<Volunteer>({
			selector: {
				type: 'volunteer',
				$or: [
					{ tracking_token_hash: embeddedHash ?? (await sha256Hex(normalized)) },
					{ tracking_token: token }
				]
			},
			limit: 1
		});
		return docs.filter(isVolunteer)[0] ?? null;
	}

	async getByPhoneHash(phoneHash: string): Promise<Volunteer | null> {
		const docs = await this.repo.find<Volunteer>({
			selector: { type: 'volunteer', phone_hash: phoneHash },
			limit: 1
		});
		return docs.filter(isVolunteer)[0] ?? null;
	}

	async create(
		input: VolunteerInput,
		ctx: AuthorContext,
		fields?: { status?: VolunteerStatus }
	): Promise<Volunteer> {
		const existing = await this.repo.allByType('volunteer', isVolunteer);
		const volunteer_code = nextVolunteerCode(existing.map((v) => v.volunteer_code));
		const doc = makeVolunteer(input, ctx, { volunteer_code, status: fields?.status });
		const phoneHash = doc.phone ? await sha256Hex(normalizePhone(doc.phone)) : null;
		const trackingToken = input.source === 'public_apply' ? null : mintTrackingToken();
		return this.save({
			...doc,
			phone_hash: phoneHash,
			tracking_token_hash: trackingToken ? await sha256Hex(trackingToken) : null
		});
	}

	async update(volunteer: Volunteer): Promise<Volunteer> {
		const latest = await this.repo.get<Volunteer>(volunteer._id);
		if (!latest) throw new Error(`ไม่พบข้อมูลอาสาสมัคร: ${volunteer._id}`);
		return this.save(touch({ ...volunteer, _rev: latest._rev }));
	}

	async reviewIdentity(
		id: string,
		status: VerificationStatus,
		actor: string,
		notes?: string | null
	): Promise<Volunteer> {
		const latest = await this.repo.get<Volunteer>(id);
		if (!latest) throw new Error(`ไม่พบข้อมูลอาสาสมัคร: ${id}`);
		return this.save(
			touch({
				...latest,
				identity_verified: status === 'verified',
				identity_verification: {
					status,
					reviewed_at: new Date().toISOString(),
					reviewed_by: actor,
					notes: notes ?? null
				}
			})
		);
	}

	async reviewSkill(
		id: string,
		skillCode: string,
		status: VerificationStatus,
		actor: string,
		notes?: string | null,
		credentialReference?: string | null
	): Promise<Volunteer> {
		const latest = await this.repo.get<Volunteer>(id);
		if (!latest) throw new Error(`ไม่พบข้อมูลอาสาสมัคร: ${id}`);
		return this.save(
			touch({
				...latest,
				skill_verifications: {
					...(latest.skill_verifications ?? {}),
					[skillCode]: {
						status,
						reviewed_at: new Date().toISOString(),
						reviewed_by: actor,
						notes: notes ?? null,
						credential_reference: credentialReference ?? null
					}
				}
			})
		);
	}

	async setCheckedIn(
		id: string,
		checkedIn: boolean,
		shelterCode: string | null
	): Promise<Volunteer> {
		const latest = await this.repo.get<Volunteer>(id);
		if (!latest) throw new Error(`ไม่พบข้อมูลอาสาสมัคร: ${id}`);
		return this.save(
			touch({
				...latest,
				checked_in: checkedIn,
				current_shelter_code: checkedIn ? (shelterCode ?? latest.current_shelter_code) : null
			})
		);
	}
}

let singleton: VolunteerRepository | null = null;
let singletonDbName: string | null = null;

export function volunteerRepository(): VolunteerRepository {
	const currentDb = getShelterDb();
	if (!singleton || singletonDbName !== currentDb) {
		singleton = new VolunteerRemoteRepository(currentDb);
		singletonDbName = currentDb;
	}
	return singleton;
}

/**
 * Repository bound to one named shelter rather than the active one. Only for the cross-shelter
 * write a platform-wide operator makes: user management links a `_users` account to a volunteer
 * profile in the shelter *the form selected*, which for an SA is not necessarily the shelter the
 * sidebar is currently viewing (CR-096 §2.4). Pass nothing for the active shelter.
 */
export function volunteerRepositoryFor(shelterCode?: string | null): VolunteerRepository {
	if (!shelterCode) return volunteerRepository();
	const db = `shelter_${shelterCode.toLowerCase()}`;
	if (db === getShelterDb()) return volunteerRepository();
	return new VolunteerRemoteRepository(db);
}

/** Test-only constructor that bypasses the `getShelterDb()` singleton. */
export function createVolunteerRepositoryForTest(dbName: string): VolunteerRemoteRepository {
	return new VolunteerRemoteRepository(dbName);
}

/** Test-only: force `volunteerRepository()` to rebuild against the current mocked store. */
export function clearVolunteerRepositoryCache(): void {
	singleton = null;
	singletonDbName = null;
}
