import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw, serviceError, ServiceError } from '$lib/server/couch-admin';
import { openNeeds, type Donation, type DonationCampaign } from '$lib/features/operations/domain/operations';

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

export const GET: RequestHandler = async () => {
	try {
		// 1. ดึงข้อมูลศูนย์พักพิงทั้งหมดจากฐานข้อมูล registry
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

		// 2. ดึงข้อมูลรายการสิ่งของสนับสนุนทั้งหมดจากฐานข้อมูล catalog
		const resCatalog = await adminRaw('/catalog/_all_docs?include_docs=true', 'GET');
		const catalogRows =
			resCatalog.status === 200
				? ((resCatalog.data as { rows?: { id: string; doc: SupplyItem }[] })?.rows ?? [])
				: [];
		const itemMap = new Map<string, { name: string; unit: string }>();
		for (const row of catalogRows) {
			if (row.id.startsWith('item:') && row.doc) {
				itemMap.set(row.doc._id, {
					name: row.doc.name,
					unit: row.doc.unit
				});
			}
		}

		// 3. สำหรับแต่ละศูนย์พักพิงที่เปิดอยู่ ทำการดึงข้อมูลแคมเปญและยอดบริจาคที่เกิดขึ้นจริงเพื่อนำมาคำนวณความต้องการคงเหลือ
		const result = [];
		for (const shelter of openShelters) {
			const dbName = `shelter_${shelter.code.toLowerCase()}`;

			// ดึงข้อมูลแคมเปญบริจาค
			const resCampaigns = await adminRaw(
				`/${dbName}/_all_docs?include_docs=true&startkey="donation_campaign:"&endkey="donation_campaign:￰"`,
				'GET'
			);
			if (resCampaigns.status >= 400 && resCampaigns.status !== 404) {
				continue; // ข้ามศูนย์นี้หากฐานข้อมูลยังไม่พร้อมใช้งานหรือเกิดข้อผิดพลาด
			}
			const campaignRows =
				(resCampaigns.data as { rows?: { doc: DonationCampaign }[] })?.rows ?? [];
			const activeCampaigns = campaignRows
				.map((r) => r.doc)
				.filter((c) => c && c.type === 'donation_campaign' && c.status === 'open');

			// ดึงข้อมูลประวัติการจองบริจาค
			const resDonations = await adminRaw(
				`/${dbName}/_all_docs?include_docs=true&startkey="donation:"&endkey="donation:￰"`,
				'GET'
			);
			const donationRows = (resDonations.data as { rows?: { doc: Donation }[] })?.rows ?? [];
			const activeDonations = donationRows
				.map((r) => r.doc)
				.filter((d) => d && d.type === 'donation');

			// คำนวณหาความต้องการคงเหลือ (open needs) และยุบรวมความต้องการของแต่ละแคมเปญเพื่อป้องกันข้อมูลซ้ำ
			const needsMap = new Map<string, { item_id: string; name: string; qty_needed: number; unit: string }>();
			for (const campaign of activeCampaigns) {
				const openCampaignNeeds = openNeeds(campaign, activeDonations);
				for (const need of openCampaignNeeds) {
					const itemDetails = itemMap.get(need.item_id);
					const existing = needsMap.get(need.item_id);
					if (existing) {
						existing.qty_needed += need.qty_target;
					} else {
						needsMap.set(need.item_id, {
							item_id: need.item_id,
							name: itemDetails?.name ?? need.item_id,
							qty_needed: need.qty_target,
							unit: itemDetails?.unit ?? need.unit
						});
					}
				}
			}
			const shelterNeeds = Array.from(needsMap.values());

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
