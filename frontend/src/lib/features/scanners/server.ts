import { adminFetch, adminRaw } from '$lib/server/couch-admin';
import { now } from '$lib/db/model';
import {
	createScannerDraftDoc,
	isScannerDevice,
	isScannerDraft,
	SCANNER_CATALOG_DB,
	smartCardDataSchema,
	type ScannerDevice,
	type ScannerDraft,
	type SmartCardData
} from './domain/scanner.schema';
import { hashSecret } from './data/scanner.remote';

export { hashSecret, smartCardDataSchema };
export type { ScannerDevice, ScannerDraft, SmartCardData };

export class ScannerServerRepository {
	async getDeviceByDeviceId(deviceId: string): Promise<ScannerDevice | null> {
		const res = await adminFetch<{ docs: ScannerDevice[] }>(`/${SCANNER_CATALOG_DB}/_find`, {
			method: 'POST',
			body: JSON.stringify({
				selector: {
					type: 'scanner_device',
					device_id: deviceId
				}
			})
		}).catch(() => ({ docs: [] }));

		return res.docs.find((d) => isScannerDevice(d) && d.device_id === deviceId) ?? null;
	}

	async updateDeviceLastSeen(id: string): Promise<void> {
		const res = await adminRaw(`/${SCANNER_CATALOG_DB}/${encodeURIComponent(id)}`, 'GET');
		if (res.status === 200 && res.data && isScannerDevice(res.data)) {
			const updated: ScannerDevice = {
				...res.data,
				last_seen_at: now(),
				updated_at: now()
			};
			await adminRaw(`/${SCANNER_CATALOG_DB}/${encodeURIComponent(id)}`, 'PUT', updated);
		}
	}

	async saveDraft(
		shelterCode: string,
		deviceId: string,
		stationName: string,
		cardData: SmartCardData,
		expiryHours = 24
	): Promise<ScannerDraft> {
		const dbName = `shelter_${shelterCode.toLowerCase()}`;
		const draftDoc = createScannerDraftDoc(
			shelterCode,
			deviceId,
			stationName,
			cardData,
			expiryHours
		);

		await adminFetch(`/${dbName}/${encodeURIComponent(draftDoc._id)}`, {
			method: 'PUT',
			body: JSON.stringify(draftDoc)
		});

		return draftDoc;
	}

	async listPendingDrafts(shelterCode: string): Promise<ScannerDraft[]> {
		const dbName = `shelter_${shelterCode.toLowerCase()}`;
		const res = await adminFetch<{ docs: ScannerDraft[] }>(`/${dbName}/_find`, {
			method: 'POST',
			body: JSON.stringify({
				selector: {
					type: 'scanner_draft',
					status: 'pending'
				}
			})
		}).catch(() => ({ docs: [] }));

		const nowTs = new Date().getTime();
		return res.docs
			.filter(
				(d) => isScannerDraft(d) && (!d.expires_at || new Date(d.expires_at).getTime() > nowTs)
			)
			.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
	}

	async claimDraft(id: string, claimedBy: string, shelterCode: string): Promise<ScannerDraft> {
		const dbName = `shelter_${shelterCode.toLowerCase()}`;
		const res = await adminRaw(`/${dbName}/${encodeURIComponent(id)}`, 'GET');
		if (res.status !== 200 || !res.data || !isScannerDraft(res.data)) {
			throw new Error(`Draft "${id}" not found`);
		}

		const existing = res.data;
		if (existing.status === 'claimed') {
			return existing;
		}

		const updated: ScannerDraft = {
			...existing,
			status: 'claimed',
			claimed_at: now(),
			claimed_by: claimedBy,
			updated_at: now()
		};

		await adminFetch(`/${dbName}/${encodeURIComponent(id)}`, {
			method: 'PUT',
			body: JSON.stringify(updated)
		});

		return updated;
	}
}

export const scannerServerRepository = new ScannerServerRepository();
