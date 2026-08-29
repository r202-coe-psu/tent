import {
	createScannerDraftDoc,
	isScannerDevice,
	isScannerDraft,
	SCANNER_CATALOG_DB,
	SCANNER_SCHEMA_V,
	type CreatedScannerDevice,
	type ScannerDevice,
	type ScannerDeviceInput,
	type ScannerDraft,
	type SmartCardData
} from '../domain/scanner.schema';
import { catalogDoc, now } from '$lib/db/model';
import { createRemoteRepository, type Repository } from '$lib/db/repository';
import { getShelterDb } from '$lib/db/shelter';

/** Generate random hex token */
export function generateRandomSecret(length = 32): string {
	const array = new Uint8Array(length);
	if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
		crypto.getRandomValues(array);
	} else {
		for (let i = 0; i < length; i++) {
			array[i] = Math.floor(Math.random() * 256);
		}
	}
	return 'sk_scan_' + Array.from(array, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** Compute SHA-256 hash string from plaintext */
export async function hashSecret(secret: string): Promise<string> {
	if (typeof crypto !== 'undefined' && crypto.subtle) {
		const encoder = new TextEncoder();
		const data = encoder.encode(secret);
		const hashBuffer = await crypto.subtle.digest('SHA-256', data);
		const hashArray = Array.from(new Uint8Array(hashBuffer));
		return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
	}
	// Fallback for non-subtle environments
	return 'hash_' + secret;
}

export class ScannerRemoteRepository {
	private readonly catalogRepo: Repository;

	constructor(
		private readonly catalogDb: string = SCANNER_CATALOG_DB,
		catalogRepository?: Repository
	) {
		this.catalogRepo = catalogRepository ?? createRemoteRepository(catalogDb);
	}

	// ---------------------------------------------------------------- Device Management

	async listDevices(): Promise<ScannerDevice[]> {
		return this.catalogRepo.allByType<ScannerDevice>('scanner_device', isScannerDevice);
	}

	async getDevice(id: string): Promise<ScannerDevice | null> {
		return this.catalogRepo.get<ScannerDevice>(id);
	}

	async getDeviceByDeviceId(deviceId: string): Promise<ScannerDevice | null> {
		const devices = await this.listDevices();
		return devices.find((d) => d.device_id === deviceId) ?? null;
	}

	async createDevice(
		input: ScannerDeviceInput,
		createdBy: string = 'system'
	): Promise<CreatedScannerDevice> {
		const existing = await this.getDeviceByDeviceId(input.device_id);
		if (existing) {
			throw new Error(`Device ID "${input.device_id}" มีอยู่ในระบบแล้ว`);
		}

		const plaintextSecret = generateRandomSecret(24);
		const secretHash = await hashSecret(plaintextSecret);
		const secretPrefix = plaintextSecret.slice(0, 16) + '...';

		const doc = catalogDoc<
			'scanner_device',
			Omit<
				ScannerDevice,
				'_id' | '_rev' | 'type' | 'schema_v' | 'created_at' | 'updated_at' | 'created_by'
			>
		>(
			'scanner_device',
			SCANNER_SCHEMA_V,
			{
				device_id: input.device_id,
				name: input.name,
				shelter_code: input.shelter_code,
				station_name: input.station_name,
				secret: plaintextSecret,
				secret_hash: secretHash,
				secret_prefix: secretPrefix,
				status: input.status,
				last_seen_at: null
			},
			createdBy
		);

		await this.catalogRepo.put(doc);

		return {
			...doc,
			plaintext_secret: plaintextSecret
		};
	}

	async updateDevice(
		id: string,
		patch: Partial<
			Pick<ScannerDevice, 'name' | 'shelter_code' | 'station_name' | 'status' | 'last_seen_at'>
		>
	): Promise<ScannerDevice> {
		const existing = await this.getDevice(id);
		if (!existing) {
			throw new Error(`Device "${id}" not found`);
		}

		const updated: ScannerDevice = {
			...existing,
			...patch,
			updated_at: now()
		};

		return this.catalogRepo.put(updated);
	}

	async deleteDevice(id: string): Promise<void> {
		const existing = await this.getDevice(id);
		if (existing) {
			await this.catalogRepo.remove(existing);
		}
	}

	// ---------------------------------------------------------------- Draft Scan Management

	private getShelterRepo(shelterCode?: string): Repository {
		const db = shelterCode ? `shelter_${shelterCode.toLowerCase()}` : getShelterDb();
		return createRemoteRepository(db);
	}

	async listPendingDrafts(shelterCode?: string): Promise<ScannerDraft[]> {
		const repo = this.getShelterRepo(shelterCode);
		const drafts = await repo.allByType<ScannerDraft>('scanner_draft', isScannerDraft);
		const nowTs = new Date().getTime();

		return drafts
			.filter(
				(d) => d.status === 'pending' && (!d.expires_at || new Date(d.expires_at).getTime() > nowTs)
			)
			.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
	}

	async getDraft(id: string, shelterCode?: string): Promise<ScannerDraft | null> {
		const repo = this.getShelterRepo(shelterCode);
		return repo.get<ScannerDraft>(id);
	}

	async saveDraft(
		shelterCode: string,
		deviceId: string,
		stationName: string,
		cardData: SmartCardData,
		expiryHours = 24
	): Promise<ScannerDraft> {
		const repo = this.getShelterRepo(shelterCode);
		const draftDoc = createScannerDraftDoc(
			shelterCode,
			deviceId,
			stationName,
			cardData,
			expiryHours
		);
		return repo.put(draftDoc);
	}

	async claimDraft(id: string, claimedBy: string, shelterCode?: string): Promise<ScannerDraft> {
		const repo = this.getShelterRepo(shelterCode);
		const draft = await repo.get<ScannerDraft>(id);
		if (!draft) {
			throw new Error(`Draft "${id}" not found`);
		}
		if (draft.status === 'claimed') {
			return draft;
		}

		const updated: ScannerDraft = {
			...draft,
			status: 'claimed',
			claimed_at: now(),
			claimed_by: claimedBy,
			updated_at: now()
		};

		return repo.put(updated);
	}
}

export const scannerRepository = new ScannerRemoteRepository();
