import { createRemoteRepository, type Repository } from '$lib/db/repository';
import {
	isSystemAdmin,
	isShelterManager,
	hasShelterScope,
	shelterCodesFromRoles
} from '$lib/auth/roles';
import { authStore } from '$lib/stores/auth.svelte';
import {
	EMPTY_ADMISSION_POLICY,
	EMPTY_LUGGAGE_POLICY,
	EMPTY_PARKING_POLICY,
	DEFAULT_SHELTER_FEATURE_FLAGS,
	DEFAULT_SITE_KIND,
	isShelterAcceptingReferrals,
	isShelterMasterDoc,
	migrateShelterV2ToCurrent,
	type ShelterMaster
} from '../domain/schema';
import { uniqueByShelterCode } from '../domain/unique-code';
import type { SheltersRepository, ShelterSummary, ShelterBasic } from './shelters.repository';

export const SHELTER_REGISTRY_DB = 'registry';

function shelterDbName(code: string): string {
	return `shelter_${code.toLowerCase()}`;
}

function masterToBasic(master: ShelterMaster): ShelterBasic {
	return {
		code: master.code,
		name: master.name,
		site_kind: master.site_kind ?? DEFAULT_SITE_KIND,
		operation_status: master.operation_status ?? 'standby',
		is_external: master.is_external === true,
		capacity: master.capacity ?? 0,
		province: master.province ?? null,
		accepts_referrals: isShelterAcceptingReferrals(master)
	};
}

function masterToSummary(master: ShelterMaster): ShelterSummary {
	return {
		code: master.code,
		_rev: master._rev,
		name: master.name,
		site_kind: master.site_kind ?? DEFAULT_SITE_KIND,
		db: shelterDbName(master.code),
		operation_status: master.operation_status ?? 'standby',
		is_external: master.is_external === true,
		external_url: master.external_url ?? null,
		capacity: master.capacity ?? 0,
		shelter_type: master.shelter_type ?? null,
		floor_count: master.floor_count ?? null,
		project_level: master.project_level ?? null,
		location: master.location ?? {},
		contact: master.contact ?? {},
		municipality_zone: master.municipality_zone ?? null,
		community: master.community ?? null,
		address_no: master.address_no ?? null,
		village_no: master.village_no ?? null,
		subdistrict: master.subdistrict ?? null,
		district: master.district ?? null,
		province: master.province ?? null,
		postal_code: master.postal_code ?? null,
		key_personnel: master.key_personnel ?? null,
		area_m2: master.area_m2 ?? null,
		area_type: master.area_type ?? null,
		facilities: master.facilities ?? {},
		common_areas: master.common_areas ?? { sub_storage: [] },
		utilities: {
			communications: master.utilities?.communications ?? [],
			vhf_channel: master.utilities?.vhf_channel ?? null,
			power_source: master.utilities?.power_source,
			water_source: master.utilities?.water_source
		},
		risk: master.risk ?? {},
		zones: master.zones ?? [],
		food_distribution_points: master.food_distribution_points ?? [],
		parking_points: master.parking_points ?? [],
		admission_policy: master.admission_policy ?? { ...EMPTY_ADMISSION_POLICY },
		luggage_policy: master.luggage_policy ?? { ...EMPTY_LUGGAGE_POLICY },
		parking_policy: master.parking_policy ?? { ...EMPTY_PARKING_POLICY },
		feature_flags: master.feature_flags ?? { ...DEFAULT_SHELTER_FEATURE_FLAGS },
		created_at: master.created_at ?? '',
		updated_at: master.updated_at ?? '',
		created_by: master.created_by ?? null,
		updated_by: master.updated_by ?? null
	};
}

/**
 * Shelters a caller may see: SA sees all; everyone else sees every shelter they hold a
 * `shelter:{code}` role for (not just the first), so a multi-shelter manager can switch.
 */
export function visibleShelters<T extends { code: string }>(
	roles: readonly string[],
	all: readonly T[]
): T[] {
	if (isSystemAdmin(roles)) return [...all];
	const codes = new Set(shelterCodesFromRoles(roles));
	return all.filter((s) => codes.has(s.code));
}

/** Basic (search) list: a shelter manager keeps the wider view, as before. */
export function visibleSheltersBasic<T extends { code: string }>(
	roles: readonly string[],
	all: readonly T[]
): T[] {
	if (isShelterManager(roles)) return [...all];
	return visibleShelters(roles, all);
}

export class SheltersRemoteRepository implements SheltersRepository {
	private readonly repo: Repository;

	constructor(dbName: string = SHELTER_REGISTRY_DB) {
		this.repo = createRemoteRepository(dbName);
	}

	async listShelters(): Promise<ShelterSummary[]> {
		const masters = await this.repo.allByType('shelter', isShelterMasterDoc);
		const summaries = masters.map((m) => masterToSummary(migrateShelterV2ToCurrent(m)));
		return visibleShelters(authStore.user?.roles ?? [], uniqueByShelterCode(summaries));
	}

	async searchShelters(): Promise<ShelterBasic[]> {
		const masters = await this.repo.allByType('shelter', isShelterMasterDoc);
		const basics = masters.map((m) => masterToBasic(migrateShelterV2ToCurrent(m)));
		return visibleSheltersBasic(authStore.user?.roles ?? [], uniqueByShelterCode(basics));
	}

	async getShelter(code: string): Promise<ShelterSummary> {
		const masters = await this.repo.allByType('shelter', isShelterMasterDoc);
		const match = masters.find((m) => m.code === code);
		if (!match) {
			throw new Error(`ไม่พบศูนย์พักพิง ${code}`);
		}
		const summary = masterToSummary(migrateShelterV2ToCurrent(match));
		const roles = authStore.user?.roles ?? [];
		if (!isSystemAdmin(roles) && !hasShelterScope(roles, code)) {
			throw new Error('ไม่มีสิทธิ์เข้าถึงศูนย์พักพิงนี้');
		}
		return summary;
	}
}

let singleton: SheltersRepository | null = null;

export function sheltersRepository(): SheltersRepository {
	if (!singleton) singleton = new SheltersRemoteRepository();
	return singleton;
}
