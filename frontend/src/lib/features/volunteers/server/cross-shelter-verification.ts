import { canAccessVolunteerBackoffice } from '$lib/auth/roles';
import { ulid } from '$lib/db/ulid';
import { ServiceError, adminRaw, type Caller } from '$lib/server/couch-admin';
import { readEffectiveMasterDoc } from '$lib/server/master-data-server';
import { shelterDbName } from '$lib/server/shelter-access-design';
import type { CrossShelterMatch } from '../domain/cross-shelter-verification';
import {
	controlledSkillValues,
	resolveSkillOption,
	skillOptionsFromMaster
} from '../domain/skill-catalog';
import { isControlledSkill } from '../domain/skills';
import {
	identityVerificationStatus,
	isDirectlyVerified,
	skillVerificationStatus,
	type VerificationRecord
} from '../domain/verification';

export type { CrossShelterMatch };
export type CrossShelterVerifications = { matches: CrossShelterMatch[] };

type ProfileDoc = {
	type?: string;
	shelter_code?: string;
	status?: string;
	skills?: string[];
	phone_hash?: string | null;
	national_id_hash?: string | null;
	identity_verified?: boolean;
	identity_verification?: VerificationRecord | null;
	skill_verifications?: Record<string, VerificationRecord>;
};

type ShelterRef = { code: string; name: string };

const asString = (value: unknown): string => (typeof value === 'string' ? value.trim() : '');

/** Identity status of a raw profile; a missing `identity_verified` reads as false. */
const identityStatusOf = (doc: ProfileDoc) =>
	identityVerificationStatus({
		identity_verified: doc.identity_verified === true,
		identity_verification: doc.identity_verification
	});

const unavailable = (what: string, detail?: string) =>
	new ServiceError('DEPENDENCY_UNAVAILABLE', `อ่าน${what}ไม่สำเร็จ กรุณาลองใหม่`, detail);

/** Every shelter in the registry, closed and cancelled included (FR-2). No SH001 fallback: 503. */
async function registryShelters(): Promise<ShelterRef[]> {
	const res = await adminRaw('/registry/_all_docs?include_docs=true', 'GET').catch(() => null);
	const rows = (res?.data as { rows?: { doc?: Record<string, unknown> }[] } | null)?.rows;
	if (!res || res.status !== 200 || !Array.isArray(rows)) {
		throw unavailable('รายชื่อศูนย์', res ? `registry HTTP ${res.status}` : 'registry unreachable');
	}
	const shelters = new Map<string, ShelterRef>();
	for (const { doc } of rows) {
		if (doc?.type !== 'shelter' || typeof doc.code !== 'string') continue;
		const code = doc.code.toUpperCase();
		shelters.set(code, { code, name: typeof doc.name === 'string' ? doc.name : code });
	}
	return [...shelters.values()];
}

async function readProfile(shelterCode: string, volunteerId: string): Promise<ProfileDoc> {
	const res = await adminRaw(
		`/${shelterDbName(shelterCode)}/${encodeURIComponent(volunteerId)}`,
		'GET'
	).catch(() => null);
	if (!res) throw unavailable('ข้อมูลอาสาสมัคร');
	const doc = res.data as ProfileDoc | null;
	if (res.status === 404 || (res.status < 400 && doc?.type !== 'volunteer')) {
		throw new ServiceError('NOT_FOUND', 'ไม่พบข้อมูลอาสาสมัครในศูนย์นี้');
	}
	if (res.status >= 400 || !doc) throw unavailable('ข้อมูลอาสาสมัคร', `HTTP ${res.status}`);
	return doc;
}

/**
 * The controlled skills this profile asks for, as canonical codes, that this shelter has not yet
 * decided (FR-5): resolved against this shelter's effective `volunteer_skills`, as the dialog does.
 */
async function undecidedControlledSkills(
	shelterCode: string,
	profile: ProfileDoc
): Promise<string[]> {
	const master = await readEffectiveMasterDoc('volunteer_skills', shelterCode).catch(() => {
		throw unavailable('ทักษะมาตรฐาน');
	});
	const options = skillOptionsFromMaster(master?.items ?? []);
	const controlledValues = controlledSkillValues(options);
	const codes: string[] = [];
	for (const value of profile.skills ?? []) {
		const option = resolveSkillOption(value, options);
		if (!(option?.controlled || isControlledSkill(value, controlledValues))) continue;
		const code = option?.code ?? value;
		if (codes.includes(code) || skillVerificationStatus(profile, code) !== 'pending') continue;
		codes.push(code);
	}
	return codes;
}

/** The same person's active profiles in one shelter: both hashes match (FR-3). 404 = no DB. */
async function sameProfiles(
	shelterCode: string,
	hashes: { phone_hash: string; national_id_hash: string }
): Promise<ProfileDoc[] | null> {
	const res = await adminRaw(`/${shelterDbName(shelterCode)}/_find`, 'POST', {
		selector: { type: 'volunteer', ...hashes },
		fields: ['status', 'identity_verified', 'identity_verification', 'skill_verifications'],
		limit: 20
	}).catch(() => null);
	if (res?.status === 404) return null;
	if (!res || res.status >= 400) {
		throw unavailable(
			'ข้อมูลศูนย์อื่น',
			`${shelterCode}: ${res ? `HTTP ${res.status}` : 'unreachable'}`
		);
	}
	const docs = ((res.data as { docs?: ProfileDoc[] } | null)?.docs ?? []) as ProfileDoc[];
	return docs.filter((doc) => doc.status !== 'inactive');
}

/** What one other shelter checked in person, limited to what this shelter still needs (FR-4, FR-5). */
function matchFrom(
	shelter: ShelterRef,
	profiles: readonly ProfileDoc[],
	wantIdentity: boolean,
	wantSkills: readonly string[]
): CrossShelterMatch | null {
	let identity: CrossShelterMatch['identity'] = null;
	const skills = new Map<string, string | null>();
	for (const source of profiles) {
		const record = source.identity_verification;
		// A legacy profile verified by the flag alone (no record) was still checked there.
		const direct = record ? isDirectlyVerified(record) : identityStatusOf(source) === 'verified';
		if (wantIdentity && !identity && direct)
			identity = { reviewed_at: record?.reviewed_at ?? null };
		for (const code of wantSkills) {
			const skill = source.skill_verifications?.[code];
			if (!skills.has(code) && isDirectlyVerified(skill))
				skills.set(code, skill?.reviewed_at ?? null);
		}
	}
	if (!identity && skills.size === 0) return null;
	return {
		shelter_code: shelter.code,
		shelter_name: shelter.name,
		identity,
		skills: [...skills].map(([code, reviewed_at]) => ({ code, reviewed_at }))
	};
}

const AUDIT_WRITE_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One `audit` per completed search in the asking shelter (FR-16): who searched, for which
 * profile, how many matches and shelters — never the other shelters' names, hashes or `_id`s.
 * A failed write is retried on the same `_id`, then logged; the answer still goes out.
 */
async function auditSearch(input: {
	shelter_code: string;
	volunteer_id: string;
	actor: string;
	match_count: number;
	shelters_searched: number;
}): Promise<void> {
	const now = new Date().toISOString();
	const context = {
		actor: input.actor,
		shelter_code: input.shelter_code,
		match_count: input.match_count,
		shelters_searched: input.shelters_searched
	};
	const doc = {
		_id: `audit:${ulid()}`,
		type: 'audit',
		schema_v: 1,
		shelter_code: input.shelter_code,
		created_at: now,
		updated_at: now,
		created_by: input.actor,
		action: 'other',
		target_type: 'volunteer',
		target_id: input.volunteer_id,
		reason: 'cross_shelter_verification.search',
		context,
		occurred_at: now
	};
	const path = `/${shelterDbName(input.shelter_code)}/${encodeURIComponent(doc._id)}`;
	let lastError: unknown = null;
	for (let attempt = 1; attempt <= AUDIT_WRITE_ATTEMPTS; attempt++) {
		try {
			const res = await adminRaw(path, 'PUT', doc);
			if (res.status < 400 || res.status === 409) return;
			lastError = `HTTP ${res.status}`;
		} catch (error) {
			lastError = error;
		}
		if (attempt < AUDIT_WRITE_ATTEMPTS) await sleep(150 * attempt);
	}
	console.error('[cross-shelter-verification] audit not written', {
		target_id: doc.target_id,
		reason: doc.reason,
		context,
		occurred_at: now,
		error: lastError
	});
}

/**
 * Other shelters' in-person identity and controlled-skill results for the same person as a
 * profile of the caller's shelter (CR-228): shown in the qualification dialog for staff to accept
 * one by one, never applied by themselves. Reads every shelter DB with the admin credential, so the
 * role is checked first (FR-1) and the answer carries only the fields of FR-4.
 */
export async function findCrossShelterVerifications(
	caller: Pick<Caller, 'name' | 'roles'>,
	input: { shelter_code: unknown; volunteer_id: unknown }
): Promise<CrossShelterVerifications> {
	const shelterCode = asString(input.shelter_code).toUpperCase();
	const volunteerId = asString(input.volunteer_id);
	if (!shelterCode || !volunteerId) {
		throw new ServiceError('VALIDATION', 'shelter_code and volunteer_id are required');
	}
	if (!canAccessVolunteerBackoffice(caller.roles, shelterCode)) {
		throw new ServiceError('FORBIDDEN', 'Requires volunteer back-office access in this shelter');
	}

	const profile = await readProfile(shelterCode, volunteerId);
	const phone_hash = profile.phone_hash ?? '';
	const national_id_hash = profile.national_id_hash ?? '';
	const wantIdentity = identityStatusOf(profile) === 'pending';
	const searchable = profile.status !== 'inactive' && phone_hash !== '' && national_id_hash !== '';
	const wantSkills = searchable ? await undecidedControlledSkills(shelterCode, profile) : [];

	const matches: CrossShelterMatch[] = [];
	let sheltersSearched = 0;
	if (searchable && (wantIdentity || wantSkills.length > 0)) {
		const others = (await registryShelters()).filter((s) => s.code !== shelterCode);
		const results = await Promise.all(
			others.map(async (shelter) => ({
				shelter,
				profiles: await sameProfiles(shelter.code, { phone_hash, national_id_hash })
			}))
		);
		for (const { shelter, profiles } of results) {
			if (profiles === null) continue; // no DB any more: skipped, not searched
			sheltersSearched += 1;
			const match = matchFrom(shelter, profiles, wantIdentity, wantSkills);
			if (match) matches.push(match);
		}
	}

	await auditSearch({
		shelter_code: shelterCode,
		volunteer_id: volunteerId,
		actor: caller.name ?? '',
		match_count: matches.length,
		shelters_searched: sheltersSearched
	});
	return { matches };
}
