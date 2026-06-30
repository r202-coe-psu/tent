import { namedLocalDb } from '$lib/db/pouch';
import { createRepository } from '$lib/db/repository';
import { SHELTER_DB } from '$lib/db/shelter';
import { isSopRatioProfile, type SopRatioProfile } from '../domain/sop-ratio';
import type { SopRatioRepository } from './sop-ratio.repository';

class SopRatioPouchRepository implements SopRatioRepository {
	private readonly repo = createRepository(namedLocalDb(SHELTER_DB));

	async getActiveProfile(): Promise<SopRatioProfile | null> {
		const all = await this.repo.allByType('sop_profile', isSopRatioProfile);
		return all.find((p) => p.active) ?? null;
	}

	listProfiles(): Promise<SopRatioProfile[]> {
		return this.repo.allByType('sop_profile', isSopRatioProfile);
	}
}

let singleton: SopRatioRepository | null = null;

export function sopRatioRepository(): SopRatioRepository {
	if (!singleton) singleton = new SopRatioPouchRepository();
	return singleton;
}
