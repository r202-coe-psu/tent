import { adminFetch } from '$lib/server/couch-admin';
import { now } from '$lib/db/model';
import { lookupZipcode } from '$lib/server/thailand-location';
import {
	isScannerDevice,
	SCANNER_REGISTRY_DB,
	smartCardDataSchema,
	type ScannerDevice,
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
export type { ScannerDevice, SmartCardData };

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

		return res.docs.find((d) => isScannerDevice(d) && d.device_id === deviceId) || null;
	}

	async updateDeviceLastSeen(id: string): Promise<void> {
		const res = await adminFetch<ScannerDevice>(
			`/${SCANNER_REGISTRY_DB}/${encodeURIComponent(id)}`
		);
		if (!res || !isScannerDevice(res)) return;

		const updated: ScannerDevice = {
			...res,
			last_seen_at: now(),
			updated_at: now()
		};

		await adminFetch(`/${SCANNER_REGISTRY_DB}/${encodeURIComponent(id)}`, {
			method: 'PUT',
			body: JSON.stringify(updated)
		});
	}

	/**
	 * Process card scan according to CR-097:
	 * 1. If person does not exist -> Create draft evacuee doc in shelter DB with card_snapshot
	 * 2. If person exists with pre_registered -> Overwrite personal data with authoritative card data and attach card_snapshot
	 * 3. If person exists with draft -> Return duplicate_draft warning
	 * 4. If person exists with active -> Return already_active notice
	 */
	async processCardScan(
		shelterCode: string,
		deviceId: string,
		stationName: string,
		cardData: SmartCardData
	): Promise<ProcessCardResult> {
		const dbName = `shelter_${shelterCode.toLowerCase()}`;

		// Find if citizen ID already exists in this shelter
		const findRes = await adminFetch<{ docs: Evacuee[] }>(`/${dbName}/_find`, {
			method: 'POST',
			body: JSON.stringify({
				selector: {
					type: 'evacuee',
					'person_id.number': cardData.citizen_id
				}
			})
		}).catch(() => ({ docs: [] }));

		const existing = findRes.docs.find(isEvacuee);

		// Resolve postal code automatically if missing from card data
		let autoPostalCode: string | null = cardData.postal_code || null;
		if (!autoPostalCode && (cardData.subdistrict || cardData.district || cardData.province)) {
			autoPostalCode = lookupZipcode(cardData.province, cardData.district, cardData.subdistrict);
		}

		const birthYearBE = cardData.birth_year_ce ? cardData.birth_year_ce + 543 : undefined;
		const currentYearBE = new Date().getFullYear() + 543;
		const calculatedAge =
			typeof cardData.age === 'number'
				? cardData.age
				: birthYearBE !== undefined
					? Math.max(0, currentYearBE - birthYearBE)
					: undefined;

		// Prepare snapshot
		const cardSnapshot: CardSnapshot = {
			citizen_id: cardData.citizen_id,
			title_th: cardData.title_th || undefined,
			first_name_th: cardData.first_name_th || undefined,
			last_name_th: cardData.last_name_th || undefined,
			gender: cardData.gender || undefined,
			birth_date: cardData.birth_date || undefined,
			birth_year_ce: cardData.birth_year_ce ?? undefined,
			age: calculatedAge,
			address_no: cardData.address_no || undefined,
			village_no: cardData.village_no || undefined,
			lane: cardData.lane || undefined,
			road: cardData.road || undefined,
			subdistrict: cardData.subdistrict || undefined,
			district: cardData.district || undefined,
			province: cardData.province || undefined,
			postal_code: autoPostalCode || undefined,
			photo_base64: cardData.photo_base64 || undefined,
			scanned_at: now(),
			device_id: deviceId,
			station_name: stationName || undefined,
			expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()
		};

		if (existing) {
			const stayStatus = existing.current_stay?.status;

			// If already active in shelter
			if (stayStatus === 'active') {
				return {
					status: 'already_active',
					evacuee: existing,
					error: 'ท่านได้เช็คอินเข้าพักในศูนย์แล้ว',
					message: 'ท่านได้เช็คอินเข้าพักในศูนย์แล้ว'
				};
			}

			// If draft already exists -> duplicate scan warning
			if (stayStatus === 'draft') {
				return {
					status: 'duplicate_draft',
					evacuee: existing,
					error: 'ท่านได้เคยเสียบบัตรเพื่อบันทึกข้อมูลแล้ว',
					message: 'ท่านได้เคยเสียบบัตรเพื่อบันทึกข้อมูลแล้ว'
				};
			}

			// If pre_registered -> overwrite personal info with authoritative card data
			if (stayStatus === 'pre_registered') {
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
}

export const scannerServerRepository = new ScannerServerRepository();
