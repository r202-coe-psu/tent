import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, serviceError, ServiceError } from '$lib/server/couch-admin';
import type { Donation, DonationCampaign } from '$lib/features/operations';
import { computeNeeds } from '$lib/features/donations';
import { fetchDocs } from '$lib/server/donation-docs';
import { qtyGte, qtyLte } from '$lib/utils/qty';

interface ShelterMaster {
	_id: string;
	type: 'shelter';
	code: string;
	name: string;
	status: string;
	capacity: number;
}

interface SupplyItem {
	_id: string;
	type: 'supply_item';
	name: string;
	category: string;
	unit: string;
}

// T-60 ขั้น 1 (DN-4): needs board — aggregate ความต้องการคงเหลือทุกศูนย์จาก view needs_open
// (campaign qty_target − donations). คืนเฉพาะ aggregate ไม่มี PII ของผู้บริจาค
//
// ⚠️ BREAKING CHANGE: renamed from /api/v1/needs → /api/public/v1/needs
// Any external consumer must update their endpoint. See release notes.
export const GET: RequestHandler = async () => {
	try {
		// 1. ดึงรายชื่อศูนย์ที่เปิดอยู่จาก registry
		const resRegistry = await adminRaw('/registry/_all_docs?include_docs=true', 'GET');
		if (resRegistry.status === 404) {
			return json([]);
		}
		if (resRegistry.status >= 400) {
			throw new ServiceError('INTERNAL', 'Could not read registry');
		}
		const registryRows =
			(resRegistry.data as { rows?: { id: string; doc: ShelterMaster }[] })?.rows ?? [];
		const openShelters = registryRows
			.filter((r) => r.id.startsWith('shelter:') && r.doc && r.doc.status === 'open')
			.map((r) => r.doc);

		// 2. ดึง catalog เพื่อ map item_id → ชื่อ/หน่วย
		const resCatalog = await adminRaw('/catalog/_all_docs?include_docs=true', 'GET');
		const catalogRows =
			resCatalog.status === 200
				? ((resCatalog.data as { rows?: { id: string; doc: SupplyItem }[] })?.rows ?? [])
				: [];
		const itemMap = new Map<string, { name: string; unit: string }>();
		for (const row of catalogRows) {
			if (row.id.startsWith('item:') && row.doc) {
				itemMap.set(row.doc._id, { name: row.doc.name, unit: row.doc.unit });
			}
		}

		// 3. แต่ละศูนย์ — คำนวณ open needs จาก shared computeNeeds
		const result = [];
		for (const shelter of openShelters) {
			const dbName = `shelter_${shelter.code.toLowerCase()}`;

			const [activeCampaigns, activeDonations] = await Promise.all([
				fetchDocs<DonationCampaign>(dbName, 'donation_campaign:').then((docs) =>
					docs.filter((c) => c && c.type === 'donation_campaign' && c.status === 'open')
				),
				fetchDocs<Donation>(dbName, 'donation:').then((docs) =>
					docs.filter((d) => d && d.type === 'donation')
				)
			]);

			const { remaining } = computeNeeds(activeCampaigns, activeDonations);

			// DN-4: "ขาด N" = max(0, needs_open); "งดรับ" เมื่อ needs_open ≤ 0
			const shelterNeeds = Array.from(remaining.entries()).map(([itemId, qtyOpen]) => {
				const itemDetails = itemMap.get(itemId);
				return {
					item_id: itemId,
					name: itemDetails?.name ?? itemId,
					qty_needed: qtyGte(qtyOpen, 0) ? qtyOpen : '0',
					unit: itemDetails?.unit ?? 'unit',
					status: qtyLte(qtyOpen, 0) ? ('closed' as const) : ('open' as const)
				};
			});

			result.push({
				code: shelter.code,
				name: shelter.name,
				needs: shelterNeeds
			});
		}

		return json(result);
	} catch (e) {
		return serviceError(e);
	}
};
