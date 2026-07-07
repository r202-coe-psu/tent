import { namedLocalDb } from '$lib/db/pouch';
import { createRepository, type Repository } from '$lib/db/repository';
import { isSystemAdmin, shelterCodeFromRoles } from '$lib/auth/roles';
import { authStore } from '$lib/stores/auth.svelte';
import {
	EMPTY_ADMISSION_POLICY,
	EMPTY_LUGGAGE_POLICY,
	EMPTY_PARKING_POLICY,
	isShelterMasterDoc,
	migrateShelterV2ToCurrent,
	type ShelterMaster
} from '../domain/schema';
import type { SheltersRepository, ShelterSummary } from './shelters.repository';

export const SHELTER_REGISTRY_DB = 'registry';

function shelterDbName(code: string): string {
	return `shelter_${code.toLowerCase()}`;
}

function masterToSummary(master: ShelterMaster): ShelterSummary {
	return {
		code: master.code,
		name: master.name,
		db: shelterDbName(master.code),
		operation_status: master.operation_status ?? 'standby',
		capacity: master.capacity ?? 0,
		shelter_type: master.shelter_type ?? null,
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
		admission_policy: master.admission_policy ?? { ...EMPTY_ADMISSION_POLICY },
		luggage_policy: master.luggage_policy ?? { ...EMPTY_LUGGAGE_POLICY },
		parking_policy: master.parking_policy ?? { ...EMPTY_PARKING_POLICY }
	};
}

function visibleShelters(all: ShelterSummary[]): ShelterSummary[] {
	const roles = authStore.user?.roles ?? [];
	if (isSystemAdmin(roles)) return all;
	const scope = shelterCodeFromRoles(roles);
	if (scope) return all.filter((s) => s.code === scope);
	return [];
}

export class SheltersPouchRepository implements SheltersRepository {
	private readonly repo: Repository;

	constructor(dbName: string = SHELTER_REGISTRY_DB) {
		this.repo = createRepository(namedLocalDb(dbName));
	}

	async listShelters(): Promise<ShelterSummary[]> {
		const masters = await this.repo.allByType('shelter', isShelterMasterDoc);
		const summaries = masters.map((m) => masterToSummary(migrateShelterV2ToCurrent(m)));
		return visibleShelters(summaries);
	}

	async getShelter(code: string): Promise<ShelterSummary> {
		const masters = await this.repo.allByType('shelter', isShelterMasterDoc);
		const match = masters.find((m) => m.code === code);
		if (!match) {
			throw new Error(`ไม่พบศูนย์พักพิง ${code}`);
		}
		const summary = masterToSummary(migrateShelterV2ToCurrent(match));
		const roles = authStore.user?.roles ?? [];
		if (!isSystemAdmin(roles)) {
			const scope = shelterCodeFromRoles(roles);
			if (!scope || scope !== code) {
				throw new Error('ไม่มีสิทธิ์เข้าถึงศูนย์พักพิงนี้');
			}
		}
		return summary;
	}
}

let singleton: SheltersRepository | null = null;

export function sheltersRepository(): SheltersRepository {
	if (!singleton) singleton = new SheltersPouchRepository();
	return singleton;
}
