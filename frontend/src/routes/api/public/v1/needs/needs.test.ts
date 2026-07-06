import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from './+server';
import { adminRaw } from '$lib/server/couch-admin';

// จำลอง (Mock) การทำงานของ adminRaw client
vi.mock('$lib/server/couch-admin', () => ({
	adminRaw: vi.fn(),
	serviceError: vi.fn((e) => new Response(JSON.stringify({ error: e }), { status: 500 })),
	ServiceError: class ServiceError extends Error {
		constructor(
			public code: string,
			message: string
		) {
			super(message);
		}
	}
}));

describe('GET /api/public/v1/needs', () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it('returns shelter open needs without exposing donor PII', async () => {
		// จำลองข้อมูลฐานข้อมูล registry ที่มีศูนย์พักพิงที่กำลังเปิดอยู่
		const mockRegistryResponse = {
			status: 200,
			data: {
				rows: [
					{
						id: 'shelter:SH001',
						doc: {
							_id: 'shelter:SH001',
							type: 'shelter',
							code: 'SH001',
							name: 'Test Shelter 1',
							status: 'open',
							capacity: 100
						}
					}
				]
			}
		};

		// จำลองข้อมูลฐานข้อมูล catalog ที่มีรายการสิ่งของ
		const mockCatalogResponse = {
			status: 200,
			data: {
				rows: [
					{
						id: 'item:rice',
						doc: {
							_id: 'item:rice',
							type: 'supply_item',
							name: 'ข้าวสาร',
							category: 'food',
							unit: 'kg'
						}
					},
					{
						id: 'item:water',
						doc: {
							_id: 'item:water',
							type: 'supply_item',
							name: 'น้ำดื่ม',
							category: 'food',
							unit: 'bottle'
						}
					}
				]
			}
		};

		// จำลองแคมเปญบริจาคในศูนย์ SH001
		const mockCampaignsResponse = {
			status: 200,
			data: {
				rows: [
					{
						doc: {
							_id: 'donation_campaign:c1',
							type: 'donation_campaign',
							status: 'open',
							needs: [
								{
									item_id: 'item:rice',
									qty_target: 500,
									unit: 'kg'
								},
								{
									item_id: 'item:water',
									qty_target: 200,
									unit: 'bottle'
								}
							]
						}
					}
				]
			}
		};

		// จำลองข้อมูลประวัติการจองบริจาคในศูนย์ SH001 (บางรายการมีสถานะใช้งานได้ บางรายการยกเลิกหรือหมดอายุ)
		// ใส่ข้อมูลระบุตัวตน (PII) ของผู้บริจาค (เบอร์โทร, ไลน์, อีเมล) ไว้ในเอกสารจำลอง
		// เพื่อนำมาใช้ตรวจสอบว่าข้อมูลเหล่านี้จะไม่รั่วไหลออกไปทาง API
		const mockDonationsResponse = {
			status: 200,
			data: {
				rows: [
					{
						doc: {
							_id: 'donation:d1',
							type: 'donation',
							campaign_id: 'donation_campaign:c1',
							status: 'declared',
							donor_name: 'John Doe',
							donor_phone: '0812345678',
							donor_email: 'john@example.com',
							donor_line: 'johnline',
							items: [
								{ item_id: 'item:rice', qty: 100 },
								{ item_id: 'item:water', qty: 50 }
							]
						}
					},
					{
						doc: {
							_id: 'donation:d2',
							type: 'donation',
							campaign_id: 'donation_campaign:c1',
							status: 'cancelled', // Should be skipped in calculations
							donor_name: 'Jane Cancel',
							donor_phone: '0898765432',
							items: [{ item_id: 'item:rice', qty: 300 }]
						}
					}
				]
			}
		};

		// ตั้งค่าการจำลองพฤติกรรมของฟังก์ชัน adminRaw ในแต่ละคำขอตามลำดับ
		vi.mocked(adminRaw).mockImplementation(async (path: string) => {
			if (path.includes('/registry/_all_docs')) {
				return mockRegistryResponse;
			}
			if (path.includes('/catalog/_all_docs')) {
				return mockCatalogResponse;
			}
			if (
				path.includes('/shelter_sh001/_all_docs?include_docs=true&startkey="donation_campaign:"')
			) {
				return mockCampaignsResponse;
			}
			if (path.includes('/shelter_sh001/_all_docs?include_docs=true&startkey="donation:"')) {
				return mockDonationsResponse;
			}
			return { status: 404, data: null };
		});

		const response = await GET({} as Parameters<typeof GET>[0]);
		expect(response.status).toBe(200);

		const result = await response.json();
		expect(result).toBeInstanceOf(Array);
		expect(result).toHaveLength(1);

		const shelterInfo = result[0];
		expect(shelterInfo.code).toBe('SH001');
		expect(shelterInfo.name).toBe('Test Shelter 1');
		expect(shelterInfo.needs).toBeInstanceOf(Array);

		// ข้าวสาร เป้าหมาย: 500, บริจาคแล้ว: 100 (หักลบเฉพาะยอดที่ใช้งานอยู่ ยอดที่ยกเลิกจะไม่นำมาคำนวณ) ความต้องการคงเหลือ = 400
		const riceNeed = shelterInfo.needs.find((n: { item_id: string }) => n.item_id === 'item:rice');
		expect(riceNeed).toBeDefined();
		expect(riceNeed.qty_needed).toBe(400);
		expect(riceNeed.name).toBe('ข้าวสาร');
		expect(riceNeed.unit).toBe('kg');

		// น้ำดื่ม เป้าหมาย: 200, บริจาคแล้ว: 50 ความต้องการคงเหลือ = 150
		const waterNeed = shelterInfo.needs.find(
			(n: { item_id: string }) => n.item_id === 'item:water'
		);
		expect(waterNeed).toBeDefined();
		expect(waterNeed.qty_needed).toBe(150);

		// ตรวจสอบความปลอดภัย: ข้อมูลส่วนบุคคล (PII) ของผู้บริจาคทั้งหมดจะต้องไม่ปรากฏในข้อมูลผลลัพธ์ตอบกลับจาก API
		const stringifiedResponse = JSON.stringify(result);
		expect(stringifiedResponse).not.toContain('John Doe');
		expect(stringifiedResponse).not.toContain('0812345678');
		expect(stringifiedResponse).not.toContain('john@example.com');
		expect(stringifiedResponse).not.toContain('johnline');
		expect(stringifiedResponse).not.toContain('Jane Cancel');
		expect(stringifiedResponse).not.toContain('0898765432');
	});
});
