import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, serviceError, ServiceError } from '$lib/server/couch-admin';
import type { Donation, DonationCampaign } from '$lib/features/operations';

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

		// 3. แต่ละศูนย์ — คำนวณ open needs จาก campaign + donations จริง
		const result = [];
		for (const shelter of openShelters) {
			const dbName = `shelter_${shelter.code.toLowerCase()}`;

			const resCampaigns = await adminRaw(
				`/${dbName}/_all_docs?include_docs=true&startkey="donation_campaign:"&endkey="donation_campaign:￰"`,
				'GET'
			);
			if (resCampaigns.status >= 400 && resCampaigns.status !== 404) {
				continue; // ข้ามศูนย์ที่ db ยังไม่พร้อม
			}
			const campaignRows =
				(resCampaigns.data as { rows?: { doc: DonationCampaign }[] })?.rows ?? [];
			const activeCampaigns = campaignRows
				.map((r) => r.doc)
				.filter((c) => c && c.type === 'donation_campaign' && c.status === 'open');

			const resDonations = await adminRaw(
				`/${dbName}/_all_docs?include_docs=true&startkey="donation:"&endkey="donation:￰"`,
				'GET'
			);
			const donationRows = (resDonations.data as { rows?: { doc: Donation }[] })?.rows ?? [];
			const activeDonations = donationRows
				.map((r) => r.doc)
				.filter((d) => d && d.type === 'donation');

			// ยุบรวมความต้องการของแต่ละแคมเปญด้วย Map (กันไอเทมซ้ำ)
			const needsMap = new Map<
				string,
				{ item_id: string; name: string; qty_needed: number; unit: string }
			>();
			for (const campaign of activeCampaigns) {
				// covered = ยอดที่บริจาคแล้ว (declared/received) ต่อ item ของ campaign นี้
				const covered = new Map<string, number>();
				for (const don of activeDonations) {
					if (don.campaign_id !== campaign._id) continue;
					if (don.status === 'expired' || don.status === 'cancelled') continue;
					for (const it of don.items ?? []) {
						if (!it.item_id) continue;
						covered.set(it.item_id, (covered.get(it.item_id) ?? 0) + it.qty);
					}
				}
				// remaining = target − covered (เก็บไว้แม้ ≤ 0 เพื่อให้ UI แสดง "งดรับ" — DN-4)
				for (const need of campaign.needs) {
					const remaining = need.qty_target - (covered.get(need.item_id) ?? 0);
					const existing = needsMap.get(need.item_id);
					if (existing) {
						existing.qty_needed += remaining;
					} else {
						const itemDetails = itemMap.get(need.item_id);
						needsMap.set(need.item_id, {
							item_id: need.item_id,
							name: itemDetails?.name ?? need.item_id,
							qty_needed: remaining,
							unit: itemDetails?.unit ?? need.unit
						});
					}
				}
			}

			// DN-4: "ขาด N" = max(0, needs_open); "งดรับ" เมื่อ needs_open ≤ 0
			const shelterNeeds = Array.from(needsMap.values()).map((n) => ({
				...n,
				qty_needed: Math.max(0, n.qty_needed),
				status: n.qty_needed <= 0 ? ('closed' as const) : ('open' as const)
			}));

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
