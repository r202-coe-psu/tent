/**
 * Staging ops: stock, campaigns, donations, purchases for SH001–SH003.
 */
import { now, type AuthorContext } from '$lib/db/model';
import {
	createCampaign,
	createPurchase,
	createStockLedger,
	createWalkInDonation,
	keyPurchaseReceipt
} from '$lib/features/operations/domain/operations';
import { createFuelCylinder } from '$lib/features/kitchen/domain/kitchen';
import { createGasLedgerEntry } from '$lib/features/kitchen/domain/gas-ledger';
import { shelterDbName } from '$lib/server/shelter-access-design';
import { prefixRangeEnd } from '../t31-seed-support';
import { bulkDocs, couchReq } from './couch';
import { ITEM, SH001_CODE, SH002_CODE, SH003_CODE } from './types';

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

function scale(code: string, hi: number, mid: number, lo: number): string {
	if (code === SH001_CODE) return String(hi);
	if (code === SH002_CODE) return String(mid);
	return String(lo);
}

export async function seedStagingOps(): Promise<void> {
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

		const purchases = [
			createPurchase(
				{
					vendor: 'บริษัท สยามค้าส่ง จำกัด',
					po_ref: `PO-ST-${code}-0001`,
					items: [
						{ item_id: ITEM.rice, qty: '100', unit: 'kg' },
						{ item_id: ITEM.soap, qty: '60', unit: 'bar' }
					],
					note: 'จัดซื้อรอบ staging seed'
				},
				ctx
			)
		].map((doc, i) => ({
			...doc,
			_id: `purchase:seed-st:${code.toLowerCase()}:${i}`
		}));

		const purchaseReceipts = keyPurchaseReceipt(
			purchases[0],
			[{ item_id: ITEM.rice, qty: '100', unit: 'kg' }],
			ctx
		).map((doc, i) => ({
			...doc,
			_id: `stock_ledger:seed-st:${code.toLowerCase()}:pr-${i}`
		}));

		// Demo scenario for the catalog "ปรับแต่งแล้ว" (override) flow: SH001 customizes the
		// central item_master:rice by adding a shelter-specific bulk-sack conversion unit.
		const itemMasterOverrides =
			code === SH001_CODE
				? [
						{
							_id: 'item_master:rice',
							type: 'item_master',
							schema_v: 4,
							created_at: now(),
							updated_at: now(),
							created_by: 'seed',
							name: 'ข้าวสาร',
							category: 'item_category:food',
							base_unit: 'kg',
							sku: 'SKU-RICE-01',
							dietary: ['HALAL'],
							conversions: [{ uom_name: 'กระสอบ', multiplier: '50', barcode: '' }],
							distribution_type: 'recurring',
							type_class: 'CONSUMABLE',
							shelter_code: code,
							override: true
						}
					]
				: [];

		// CR-120 §7.2 — 3 independent LPG cylinders for SH001.
		// Seeded balances: LPG-01 = 15 kg, LPG-02 = 12 kg, LPG-03 = 0 kg.
		const fuelCylinders =
			code === SH001_CODE
				? [
						createFuelCylinder(
							{
								item_master_id: 'item_master:lpg_15kg',
								cylinder_code: 'LPG-01',
								name: 'ถังแก๊สหลัก 1',
								capacity_kg: '15',
								burn_rate_kg_per_hour: '0.5',
								time_multiplier: '1',
								deactivated: false
							},
							ctx
						),
						createFuelCylinder(
							{
								item_master_id: 'item_master:lpg_15kg',
								cylinder_code: 'LPG-02',
								name: 'ถังแก๊สหลัก 2',
								capacity_kg: '15',
								burn_rate_kg_per_hour: '0.5',
								time_multiplier: '1',
								deactivated: false
							},
							ctx
						),
						createFuelCylinder(
							{
								item_master_id: 'item_master:lpg_15kg',
								cylinder_code: 'LPG-03',
								name: 'ถังแก๊สสำรอง',
								capacity_kg: '15',
								burn_rate_kg_per_hour: '0.5',
								time_multiplier: '1',
								deactivated: false
							},
							ctx
						)
					]
				: [];
		const gasLedgerEntries =
			code === SH001_CODE
				? [
						// LPG-01: no ledger delta, remaining = capacity = 15 kg.
						// LPG-02: +5 refill -8 consumption, remaining = 12 kg.
						createGasLedgerEntry(
							{ cylinder_id: fuelCylinders[1]._id, qty_kg: '5', reason: 'refill', ref_id: null },
							ctx
						),
						createGasLedgerEntry(
							{
								cylinder_id: fuelCylinders[1]._id,
								qty_kg: '-8',
								reason: 'consumption',
								ref_id: null
							},
							ctx
						),
						// LPG-03: -15 consumption, remaining = 0 kg.
						createGasLedgerEntry(
							{
								cylinder_id: fuelCylinders[2]._id,
								qty_kg: '-15',
								reason: 'consumption',
								ref_id: null
							},
							ctx
						)
					]
				: [];

		await bulkDocs(db, [
			...stockEntries,
			...campaigns,
			...donations,
			...purchases,
			...purchaseReceipts,
			...itemMasterOverrides,
			...fuelCylinders,
			...gasLedgerEntries
		]);
		console.log(
			`  ✓ ${db}: ${stockEntries.length} stock, ${campaigns.length} campaigns, ${donations.length} donations, ${purchases.length} purchases${itemMasterOverrides.length ? `, ${itemMasterOverrides.length} item_master override` : ''}${fuelCylinders.length ? `, ${fuelCylinders.length} fuel_cylinder` : ''}`
		);
	}
}
