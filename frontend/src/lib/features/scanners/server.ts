import { adminFetch, adminRaw } from '$lib/server/couch-admin';
import { now } from '$lib/db/model';
import {
	createScannerDraftDoc,
	isScannerDevice,
	isScannerDraft,
	SCANNER_REGISTRY_DB,
	smartCardDataSchema,
	type ScannerDevice,
	type ScannerDraft,
	type SmartCardData
} from './domain/scanner.schema';
import {
	createDraftEvacueeFromCard,
	isEvacuee,
	type Evacuee,
	type CardSnapshot
} from '$lib/features/people/domain/people';

import { hashSecret } from './data/scanner.remote';

export { hashSecret, smartCardDataSchema };
export type { ScannerDevice, ScannerDraft, SmartCardData };

export type ProcessCardResult =
	| { status: 'created_draft'; evacuee: Evacuee; message: string }
	| { status: 'attached_to_preregistered'; evacuee: Evacuee; message: string }
	| { status: 'duplicate_draft'; evacuee: Evacuee; error: string; message: string }
	| { status: 'already_active'; evacuee: Evacuee; error: string; message: string };

export class ScannerServerRepository {
	async getDeviceByDeviceId(deviceId: string): Promise<ScannerDevice | null> {
		const res = await adminFetch<{ docs: ScannerDevice[] }>(`/${SCANNER_REGISTRY_DB}/_find`, {
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
		const res = await adminRaw(`/${SCANNER_REGISTRY_DB}/${encodeURIComponent(id)}`, 'GET');
		if (res.status === 200 && res.data && isScannerDevice(res.data)) {
			const updated: ScannerDevice = {
				...res.data,
				last_seen_at: now(),
				updated_at: now()
			};
			await adminRaw(`/${SCANNER_REGISTRY_DB}/${encodeURIComponent(id)}`, 'PUT', updated);
		}
	}

	async processCardScan(
		shelterCode: string,
		deviceId: string,
		stationName: string,
		cardData: SmartCardData,
		expiryHours = 24
	): Promise<ProcessCardResult> {
		const dbName = `shelter_${shelterCode.toLowerCase()}`;
		const cid = cardData.citizen_id;

		// Query existing evacuee by citizen_id
		const res = await adminFetch<{ docs: Evacuee[] }>(`/${dbName}/_find`, {
			method: 'POST',
			body: JSON.stringify({
				selector: {
					type: 'evacuee',
					'person_id.number': cid
				}
			})
		}).catch(() => ({ docs: [] }));

		const existing = res.docs.find(
			(d) =>
				isEvacuee(d) &&
				d.person_id?.number === cid &&
				d.current_stay.status !== 'cancelled' &&
				d.current_stay.status !== 'deceased'
		);

		const birthYearBE = cardData.birth_year_ce ? cardData.birth_year_ce + 543 : undefined;
		const currentYearBE = new Date().getFullYear() + 543;
		const calculatedAge =
			cardData.age !== null && cardData.age !== undefined
				? cardData.age
				: birthYearBE !== undefined
					? Math.max(0, currentYearBE - birthYearBE)
					: undefined;

		const cardSnapshot: CardSnapshot = {
			citizen_id: cardData.citizen_id,
			title_th: cardData.title_th || undefined,
			first_name_th: cardData.first_name_th || undefined,
			last_name_th: cardData.last_name_th || undefined,
			gender: cardData.gender,
			birth_date: cardData.birth_date || undefined,
			birth_year_ce: cardData.birth_year_ce || undefined,
			age: calculatedAge,
			address_no: cardData.address_no || undefined,
			village_no: cardData.village_no || undefined,
			lane: cardData.lane || undefined,
			road: cardData.road || undefined,
			subdistrict: cardData.subdistrict || undefined,
			district: cardData.district || undefined,
			province: cardData.province || undefined,
			photo_base64: cardData.photo_base64 || undefined,
			scanned_at: now(),
			device_id: deviceId,
			station_name: stationName,
			expires_at: new Date(Date.now() + expiryHours * 60 * 60 * 1000).toISOString()
		};

		if (existing) {
			const stayStatus = existing.current_stay.status;

			if (stayStatus === 'draft') {
				return {
					status: 'duplicate_draft',
					evacuee: existing,
					error: 'ท่านได้เคยเสียบบัตรเพื่อบันทึกข้อมูลแล้ว',
					message: 'ท่านได้เคยเสียบบัตรเพื่อบันทึกข้อมูลแล้ว'
				};
			}

			if (stayStatus === 'active') {
				return {
					status: 'already_active',
					evacuee: existing,
					error: 'ท่านได้เช็คอินเข้าพักในศูนย์แล้ว',
					message: 'ท่านได้เช็คอินเข้าพักในศูนย์แล้ว'
				};
			}

			if (stayStatus === 'pre_registered') {
				// Overwrite evacuee personal details from authoritative card data
				const updated: Evacuee = {
					...existing,
					first_name: cardData.first_name_th || existing.first_name,
					last_name: cardData.last_name_th || existing.last_name,
					gender:
						cardData.gender === 'male' ||
						cardData.gender === 'female' ||
						cardData.gender === 'other'
							? cardData.gender
							: existing.gender,
					birth_year: birthYearBE ?? existing.birth_year,
					age: calculatedAge ?? existing.age,
					person_id: {
						cardType: 'national_id',
						number: cardData.citizen_id
					},
					photo: cardData.photo_base64 || existing.photo || null,
					card_snapshot: cardSnapshot,
					updated_at: now()
				};

				await adminFetch(`/${dbName}/${encodeURIComponent(existing._id)}`, {
					method: 'PUT',
					body: JSON.stringify(updated)
				});

				return {
					status: 'attached_to_preregistered',
					evacuee: updated,
					message:
						'อ่านบัตรสำเร็จ พบข้อมูลการจองล่วงหน้าและอัปเดตข้อมูลจากบัตรแล้ว กรุณาไปพบเจ้าหน้าที่เพื่อคัดกรอง'
				};
			}
		}

		// New person -> create draft evacuee
		const ctx = {
			shelterCode,
			createdBy: `scanner:${deviceId}`
		};

		const draftEvacuee = createDraftEvacueeFromCard(cardSnapshot, ctx);

		await adminFetch(`/${dbName}/${encodeURIComponent(draftEvacuee._id)}`, {
			method: 'PUT',
			body: JSON.stringify(draftEvacuee)
		});

		return {
			status: 'created_draft',
			evacuee: draftEvacuee,
			message: 'อ่านบัตรสำเร็จ กรุณาไปพบเจ้าหน้าที่เพื่อคัดกรองและยืนยันข้อมูล'
		};
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
