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
	createKioskEvacueeFromCard,
	isEvacuee,
	type Evacuee,
	type CardSnapshot
} from '$lib/features/people/domain/people';

import { hashSecret } from './data/scanner.remote';

export { hashSecret, smartCardDataSchema };
export type { ScannerDevice, SmartCardData };

export type ProcessCardResult =
	| { status: 'created_pre_registered'; evacuee: Evacuee; message: string }
	| { status: 'already_pre_registered'; evacuee: Evacuee; error: string; message: string }
	| { status: 'already_active'; evacuee: Evacuee; error: string; message: string }
	| { status: 'already_temporary_leave'; evacuee: Evacuee; error: string; message: string }
	| { status: 'previously_stayed'; evacuee: Evacuee; error: string; message: string }
	| { status: 'deceased_record'; evacuee: Evacuee; error: string; message: string };

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
	 * Process card scan:
	 * 1. If person does not exist -> Create evacuee doc in shelter DB with status=pre_registered, registered_via=kiosk, card_snapshot
	 * 2. If person exists:
	 *    - active: Return already_active notice (409)
	 *    - temporary_leave: Return already_temporary_leave notice (409)
	 *    - pre_registered: Return already_pre_registered notice (409)
	 *    - checked_out / transferred: Return previously_stayed notice (409) so staff can re-admit using existing doc
	 *    - deceased: Return deceased_record rejection (409)
	 *    - cancelled: Reactivate existing doc back to pre_registered with updated card_snapshot (200)
	 */
	async processCardScan(
		shelterCode: string,
		deviceId: string,
		stationName: string,
		cardData: SmartCardData
	): Promise<ProcessCardResult> {
		const dbName = `shelter_${shelterCode.toLowerCase()}`;

		// Find if citizen ID already exists in this shelter
		const cleanCitizenId = cardData.citizen_id.replace(/\D/g, '');
		const findRes = await adminFetch<{ docs: Evacuee[] }>(`/${dbName}/_find`, {
			method: 'POST',
			body: JSON.stringify({
				selector: {
					type: 'evacuee',
					$or: [{ 'person_id.number': cardData.citizen_id }, { 'person_id.number': cleanCitizenId }]
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

			// 1. If already active in shelter
			if (stayStatus === 'active') {
				return {
					status: 'already_active',
					evacuee: existing,
					error: 'ท่านได้เช็คอินเข้าพักในศูนย์แล้ว',
					message: 'ท่านได้เช็คอินเข้าพักในศูนย์แล้ว'
				};
			}

			// 2. If on temporary leave
			if (stayStatus === 'temporary_leave') {
				return {
					status: 'already_temporary_leave',
					evacuee: existing,
					error: 'ท่านอยู่ในสถานะออกชั่วคราว กรุณาติดต่อเจ้าหน้าที่เพื่อบันทึกการกลับเข้าศูนย์',
					message: 'ท่านอยู่ในสถานะออกชั่วคราว กรุณาติดต่อเจ้าหน้าที่เพื่อบันทึกการกลับเข้าศูนย์'
				};
			}

			// 3. If pre_registered already exists -> overwrite personal data from card, preserve household
			if (stayStatus === 'pre_registered') {
				let updatedEvacuee = existing;
				try {
					const enriched: Evacuee = {
						...existing,
						first_name: cardSnapshot.first_name_th || existing.first_name,
						last_name: cardSnapshot.last_name_th || existing.last_name,
						gender: cardSnapshot.gender || existing.gender,
						birth_year: birthYearBE ?? existing.birth_year,
						age: calculatedAge ?? existing.age,
						card_snapshot: cardSnapshot,
						photo: cardSnapshot.photo_base64 || existing.photo || null,
						// Preserve household from previous registration
						household_id: existing.household_id,
						updated_at: now()
					};
					const putRes = await adminFetch<{ ok: boolean; rev: string }>(
						`/${dbName}/${encodeURIComponent(existing._id)}`,
						{
							method: 'PUT',
							body: JSON.stringify(enriched)
						}
					);
					if (putRes.ok) {
						updatedEvacuee = { ...enriched, _rev: putRes.rev };
					}
				} catch (enrichErr) {
					console.warn(
						'[Scanner Server] Could not overwrite pre_registered evacuee with card data:',
						enrichErr
					);
				}

				return {
					status: 'already_pre_registered',
					evacuee: updatedEvacuee,
					error: 'ท่านมีข้อมูลในระบบแล้ว กรุณาไปพบเจ้าหน้าที่',
					message: 'ท่านมีข้อมูลในระบบแล้ว กรุณาไปพบเจ้าหน้าที่'
				};
			}

			// 4. If previously checked out or transferred -> notify that historical record exists
			if (stayStatus === 'checked_out' || stayStatus === 'transferred') {
				return {
					status: 'previously_stayed',
					evacuee: existing,
					error:
						stayStatus === 'transferred'
							? 'ท่านมีประวัติการย้ายศูนย์พักพิง กรุณาไปพบเจ้าหน้าที่เพื่อรับเข้าพักใหม่'
							: 'ท่านเคยมีประวัติการเข้าพักในศูนย์แล้ว กรุณาไปพบเจ้าหน้าที่เพื่อรับเข้าพักใหม่',
					message:
						stayStatus === 'transferred'
							? 'ท่านมีประวัติการย้ายศูนย์พักพิง กรุณาไปพบเจ้าหน้าที่เพื่อรับเข้าพักใหม่'
							: 'ท่านเคยมีประวัติการเข้าพักในศูนย์แล้ว กรุณาไปพบเจ้าหน้าที่เพื่อรับเข้าพักใหม่'
				};
			}

			// 5. If deceased -> reject (terminal state)
			if (stayStatus === 'deceased') {
				return {
					status: 'deceased_record',
					evacuee: existing,
					error: 'ข้อมูลบุคคลนี้มีสถานะเสียชีวิตในระบบ กรุณาติดต่อเจ้าหน้าที่',
					message: 'ข้อมูลบุคคลนี้มีสถานะเสียชีวิตในระบบ กรุณาติดต่อเจ้าหน้าที่'
				};
			}

			// 6. If cancelled -> reactivate existing doc to pre_registered with updated snapshot to avoid duplicate doc
			if (stayStatus === 'cancelled') {
				const updated: Evacuee = {
					...existing,
					card_snapshot: cardSnapshot,
					registered_via: 'kiosk',
					current_stay: {
						status: 'pre_registered',
						zone: null,
						since: now()
					},
					updated_at: now()
				};

				await adminFetch(`/${dbName}/${encodeURIComponent(existing._id)}`, {
					method: 'PUT',
					body: JSON.stringify(updated)
				});

				return {
					status: 'created_pre_registered',
					evacuee: updated,
					message: 'อ่านบัตรสำเร็จ กรุณาไปพบเจ้าหน้าที่เพื่อคัดกรองและยืนยันข้อมูล'
				};
			}
		}

		// New person -> create pre_registered evacuee directly
		const ctx = {
			shelterCode,
			createdBy: `scanner:${deviceId}`
		};

		const kioskEvacuee = createKioskEvacueeFromCard(cardSnapshot, ctx);

		await adminFetch(`/${dbName}/${encodeURIComponent(kioskEvacuee._id)}`, {
			method: 'PUT',
			body: JSON.stringify(kioskEvacuee)
		});

		return {
			status: 'created_pre_registered',
			evacuee: kioskEvacuee,
			message: 'อ่านบัตรสำเร็จ กรุณาไปพบเจ้าหน้าที่เพื่อคัดกรองและยืนยันข้อมูล'
		};
	}
}

export const scannerServerRepository = new ScannerServerRepository();
