/**
 * Staging ops: stock, campaigns, donations for SH001–SH003.
 */
import type { AuthorContext } from '$lib/db/model';
import {
	createCampaign,
	createStockLedger,
	createWalkInDonation
} from '$lib/features/operations/domain/operations';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { prefixRangeEnd } from '../t31-seed-support';
import { bulkDocs, couchReq } from './couch';
import { ITEM_NAME, SH001_CODE, SH002_CODE, SH003_CODE, type ItemKey } from './types';

async function hasOps(db: string): Promise<boolean> {
	const prefix = 'donation_campaign:seed-st:';
	const startkey = encodeURIComponent(JSON.stringify(prefix));
	const endkey = encodeURIComponent(JSON.stringify(prefixRangeEnd(prefix)));
	const { status, data } = await couchReq(
		'GET',
		`/${db}/_all_docs?startkey=${startkey}&endkey=${endkey}&limit=1`
	);
	if (status !== 200) return false;
	return ((data as { rows?: unknown[] }).rows ?? []).length > 0;
}

/**
 * `ITEM_NAME` → the catalog's `item_master` ids. Run after the master seed, which is what
 * creates them; fails loudly rather than writing stock or campaigns the catalog cannot
 * resolve.
 */
async function resolveItemIds(): Promise<Record<ItemKey, string>> {
	const names = Object.values(ITEM_NAME);
	const { status, data } = await couchReq('POST', '/catalog/_find', {
		selector: { type: 'item_master', name: { $in: names } },
		fields: ['_id', 'name'],
		limit: names.length * 2
	});
	if (status !== 200) throw new Error(`seed: catalog item lookup failed (HTTP ${status})`);
	const idByName = new Map(
		((data as { docs?: { _id: string; name: string }[] }).docs ?? []).map((d) => [d.name, d._id])
	);
	const ids = {} as Record<ItemKey, string>;
	for (const [key, name] of Object.entries(ITEM_NAME) as [ItemKey, string][]) {
		const id = idByName.get(name);
		if (!id)
			throw new Error(
				`seed: catalog has no item_master named "${name}" — run the master seed first`
			);
		ids[key] = id;
	}
	return ids;
}

function scale(code: string, hi: number, mid: number, lo: number): string {
	if (code === SH001_CODE) return String(hi);
	if (code === SH002_CODE) return String(mid);
	return String(lo);
}

export async function seedStagingOps(): Promise<void> {
	const ITEM = await resolveItemIds();
	for (const code of [SH001_CODE, SH002_CODE, SH003_CODE]) {
		const db = shelterDbName(code);
		const ctx: AuthorContext = { shelterCode: code, createdBy: 'seed' };

		if (await hasOps(db)) {
			console.log(`  ✓ ${db}: staging ops already present, skipping`);
			continue;
		}

		// Opening balance: stock put on the shelf with no source document, which is
		// `adjust` (schema.md §2.1, ref_id null) — the same reason the back-office
		// manual receive writes. `receive` now requires a meal_service / requisition /
		// distribution_log / bulk_return_pool ref (CR-121) and would be refused.
		const stockEntries = [
			createStockLedger(
				{
					item_id: ITEM.rice,
					qty: scale(code, 500, 300, 150),
					unit: 'kg',
					reason: 'adjust',
					ref_id: null
				},
				ctx
			),
			createStockLedger(
				{
					item_id: ITEM.water,
					qty: scale(code, 1200, 800, 400),
					unit: 'bottle',
					reason: 'adjust',
					ref_id: null
				},
				ctx
			),
			createStockLedger(
				{
					item_id: ITEM.paracetamol,
					qty: '2000',
					unit: 'tablet',
					reason: 'adjust',
					ref_id: null
				},
				ctx
			),
			createStockLedger(
				{ item_id: ITEM.soap, qty: '300', unit: 'bar', reason: 'adjust', ref_id: null },
				ctx
			),
			createStockLedger(
				{
					item_id: ITEM.blanket,
					qty: scale(code, 200, 120, 60),
					unit: 'piece',
					reason: 'adjust',
					ref_id: null
				},
				ctx
			),
			createStockLedger(
				{ item_id: ITEM.egg, qty: '3000', unit: 'piece', reason: 'adjust', ref_id: null },
				ctx
			),
			createStockLedger(
				{ item_id: ITEM.vegetable, qty: '200', unit: 'kg', reason: 'adjust', ref_id: null },
				ctx
			)
		].map((doc, i) => ({ ...doc, _id: `stock_ledger:seed-st:${code.toLowerCase()}:${i}` }));

		const campaigns = [
			{
				...createCampaign(
					{
						title: 'รับบริจาคอาหารและน้ำดื่ม',
						needs: [
							{
								item_id: ITEM.rice,
								qty_target: scale(code, 800, 500, 250),
								unit: 'kg'
							},
							{
								item_id: ITEM.water,
								qty_target: scale(code, 2000, 1200, 600),
								unit: 'bottle'
							}
						],
						notes: 'เปิดรับบริจาคเพื่อผู้ประสบภัยน้ำท่วม (staging seed)'
					},
					ctx
				),
				_id: `donation_campaign:seed-st:${code.toLowerCase()}:food`
			},
			{
				...createCampaign(
					{
						title: 'รับบริจาคของใช้ส่วนตัว',
						needs: [
							{ item_id: ITEM.soap, qty_target: '400', unit: 'bar' },
							{ item_id: ITEM.blanket, qty_target: '200', unit: 'piece' }
						]
					},
					ctx
				),
				_id: `donation_campaign:seed-st:${code.toLowerCase()}:hygiene`
			}
		];

		const donations = [
			createWalkInDonation(
				{
					donor: {
						name: 'บริษัท ซีพีเอฟ จำกัด',
						phone: '022222222',
						phone_hash: 'mock-hash-cpf'
					},
					kind: 'items',
					items: [{ item_id: ITEM.rice, qty: scale(code, 80, 40, 20), unit: 'kg' }],
					campaign_id: campaigns[0]._id,
					tracking_token_hash: `mock-track-${code}-001`
				},
				ctx
			),
			createWalkInDonation(
				{
					donor: { name: 'วัดท่าสะอ้าน', phone: null, phone_hash: 'mock-hash-wat' },
					kind: 'items',
					items: [
						{ item_id: ITEM.water, qty: scale(code, 200, 100, 50), unit: 'bottle' },
						{ item_id: ITEM.blanket, qty: '25', unit: 'piece' }
					],
					campaign_id: campaigns[0]._id,
					tracking_token_hash: `mock-track-${code}-002`
				},
				ctx
			)
		].map((doc, i) => ({
			...doc,
			_id: `donation:seed-st:${code.toLowerCase()}:${i}`
		}));

		await bulkDocs(db, [...stockEntries, ...campaigns, ...donations]);
		console.log(
			`  ✓ ${db}: ${stockEntries.length} stock, ${campaigns.length} campaigns, ${donations.length} donations`
		);
	}
}
