import type {
	MealDistributionDay,
	MealDistributionSession,
	MealDistributionTransaction,
	MealRecipient
} from '../domain/meal-distribution';
import { todayIsoDate } from '../domain/meal-distribution';

/**
 * Static UI mock — no CouchDB doc backs these yet (T-14 prototype). Returns a
 * fresh array per call so each MealsStore instance (and each test) gets its
 * own copy instead of sharing mutated module state.
 */
export function createMockMealSessions(): MealDistributionSession[] {
	return [
		{
			id: 'breakfast',
			timeRange: '06:00 - 09:00 น.',
			status: 'closed',
			targetTotal: 120,
			menus: [
				{
					id: 'm-bf-01',
					title: 'ข้าวต้มหมูสับเห็ดหอม + ไข่ลวก',
					batchCode: 'BATCH-BREAKFAST-01',
					cookTime: '14:41 น.',
					target: 120,
					served: 120,
					tags: ['Everyone', 'ปกติ'],
					status: 'closed'
				}
			]
		},
		{
			id: 'lunch',
			timeRange: '11:30 - 14:00 น.',
			status: 'open',
			targetTotal: 250,
			menus: [
				{
					id: 'm-lh-01',
					title: 'ข้าวสวย + ไข่ต้ม (มาตรฐานผู้ประสบภัย)',
					batchCode: 'BATCH-LUNCH-01',
					cookTime: '19:26 น.',
					target: 150,
					served: 0,
					tags: ['Everyone', 'ปกติ'],
					status: 'ready'
				},
				{
					id: 'm-lh-02',
					title: 'ข้าวหมกไก่ (ฮาลาล / ครัวมุสลิม)',
					batchCode: 'BATCH-LUNCH-02',
					cookTime: '19:21 น.',
					target: 45,
					served: 0,
					tags: ['Halal', 'อิสลาม'],
					status: 'ready'
				},
				{
					id: 'm-lh-03',
					title: 'โจ๊กไข่ตุ๋นหมูบด (กลุ่มเปราะบาง / เด็ก / ผู้สูงอายุ)',
					batchCode: 'BATCH-LUNCH-03',
					cookTime: '19:31 น.',
					target: 30,
					served: 0,
					tags: ['กลุ่มเปราะบาง', 'เด็กเล็ก', 'ผู้สูงอายุ'],
					status: 'ready'
				},
				{
					id: 'm-lh-04',
					title: 'ผัดผักรวมเต้าหู้เห็ดหอม (เจ / มังสวิรัติ)',
					batchCode: 'BATCH-LUNCH-04',
					cookTime: '19:36 น.',
					target: 25,
					served: 0,
					tags: ['มังสวิรัติ', 'เจ'],
					status: 'ready'
				}
			]
		},
		{
			id: 'dinner',
			timeRange: '17:00 - 19:30 น.',
			status: 'open',
			targetTotal: 160,
			menus: [
				{
					id: 'm-dn-01',
					title: 'แกงมัสหมั่นไก่ + ข้าวสวย',
					batchCode: 'BATCH-DINNER-01',
					cookTime: '16:45 น.',
					target: 100,
					served: 0,
					tags: ['Halal', 'อิสลาม'],
					status: 'ready'
				},
				{
					id: 'm-dn-02',
					title: 'แกงจืดไข่น้ำหมูสับ + ข้าวสวย',
					batchCode: 'BATCH-DINNER-02',
					cookTime: '17:00 น.',
					target: 60,
					served: 0,
					tags: ['Everyone', 'ปกติ'],
					status: 'ready'
				}
			]
		},
		{
			id: 'snack',
			timeRange: '14:30 - 16:00 น.',
			status: 'open',
			targetTotal: 80,
			menus: [
				{
					id: 'm-sn-01',
					title: 'นมกล่องรสจืด + คุกกี้ธัญพืช',
					batchCode: 'BATCH-SNACK-01',
					cookTime: '14:00 น.',
					target: 80,
					served: 0,
					tags: ['Everyone', 'เด็กเล็ก'],
					status: 'ready'
				}
			]
		}
	];
}

/** Yesterday's sessions, already fully served/closed — history for the "ทั้งหมด" (all) view. */
export function createMockYesterdaySessions(): MealDistributionSession[] {
	return [
		{
			id: 'breakfast',
			timeRange: '06:00 - 09:00 น.',
			status: 'closed',
			targetTotal: 110,
			menus: [
				{
					id: 'y-m-bf-01',
					title: 'ข้าวต้มปลา + ไข่ลวก',
					batchCode: 'BATCH-Y-BREAKFAST-01',
					cookTime: '05:50 น.',
					target: 110,
					served: 110,
					tags: ['Everyone', 'ปกติ'],
					status: 'closed'
				}
			]
		},
		{
			id: 'lunch',
			timeRange: '11:30 - 14:00 น.',
			status: 'closed',
			targetTotal: 230,
			menus: [
				{
					id: 'y-m-lh-01',
					title: 'ข้าวสวย + ผัดกะเพราไก่',
					batchCode: 'BATCH-Y-LUNCH-01',
					cookTime: '10:50 น.',
					target: 180,
					served: 180,
					tags: ['Everyone', 'ปกติ'],
					status: 'closed'
				},
				{
					id: 'y-m-lh-02',
					title: 'ข้าวหมกไก่ (ฮาลาล / ครัวมุสลิม)',
					batchCode: 'BATCH-Y-LUNCH-02',
					cookTime: '10:55 น.',
					target: 50,
					served: 48,
					tags: ['Halal', 'อิสลาม'],
					status: 'closed',
					closedNote: 'เหลือ 2 ที่ นำแจกจ่ายเจ้าหน้าที่ผู้ปฏิบัติงาน'
				}
			]
		},
		{
			id: 'dinner',
			timeRange: '17:00 - 19:30 น.',
			status: 'closed',
			targetTotal: 150,
			menus: [
				{
					id: 'y-m-dn-01',
					title: 'แกงจืดไข่น้ำหมูสับ + ข้าวสวย',
					batchCode: 'BATCH-Y-DINNER-01',
					cookTime: '16:40 น.',
					target: 150,
					served: 150,
					tags: ['Everyone', 'ปกติ'],
					status: 'closed'
				}
			]
		},
		{
			id: 'snack',
			timeRange: '14:30 - 16:00 น.',
			status: 'closed',
			targetTotal: 75,
			menus: [
				{
					id: 'y-m-sn-01',
					title: 'นมกล่องรสจืด + คุกกี้ธัญพืช',
					batchCode: 'BATCH-Y-SNACK-01',
					cookTime: '13:50 น.',
					target: 75,
					served: 75,
					tags: ['Everyone', 'เด็กเล็ก'],
					status: 'closed'
				}
			]
		}
	];
}

export function createMockMealDays(): MealDistributionDay[] {
	const today = new Date(`${todayIsoDate()}T00:00:00`);
	const yesterday = new Date(today);
	yesterday.setDate(yesterday.getDate() - 1);

	return [
		{ date: todayIsoDate(), sessions: createMockMealSessions() },
		{ date: yesterday.toISOString().slice(0, 10), sessions: createMockYesterdaySessions() }
	];
}

export function createMockRecipients(): MealRecipient[] {
	return [
		{
			id: 'EV-101',
			name: 'นายสมชาย รักดี',
			age: 45,
			nationalId: '1100200342121',
			phone: '081-234-5678',
			zone: 'A',
			bed: 'A-01',
			householdId: 'H-01',
			dietaryTags: ['ปกติ'],
			wristbandCode: 'WRISTBAND-EV-101'
		},
		{
			id: 'EV-102',
			name: 'นางสมศรี รักดี',
			age: 42,
			nationalId: '1100200342122',
			phone: '081-234-5678',
			zone: 'A',
			bed: 'A-02',
			householdId: 'H-01',
			dietaryTags: ['ปกติ'],
			wristbandCode: 'WRISTBAND-EV-102'
		},
		{
			id: 'EV-103',
			name: 'เด็กชายสมพงษ์ รักดี',
			age: 8,
			nationalId: '1100200342123',
			phone: '081-234-5678',
			zone: 'A',
			bed: 'A-03',
			householdId: 'H-01',
			dietaryTags: ['เด็กเล็ก'],
			wristbandCode: 'WRISTBAND-EV-103'
		},
		{
			id: 'EV-104',
			name: 'นายอับดุลเลาะห์ ยะลา',
			age: 65,
			nationalId: '1940100234112',
			phone: '089-987-6543',
			zone: 'B',
			bed: 'B-12',
			householdId: 'H-02',
			dietaryTags: ['ฮาลาล', 'อิสลาม'],
			wristbandCode: 'WRISTBAND-EV-104'
		},
		{
			id: 'EV-105',
			name: 'นางฟาติมะห์ ยะลา',
			age: 58,
			nationalId: '1940100234113',
			phone: '089-987-6543',
			zone: 'B',
			bed: 'B-13',
			householdId: 'H-02',
			dietaryTags: ['ฮาลาล', 'อิสลาม'],
			wristbandCode: 'WRISTBAND-EV-105'
		},
		{
			id: 'EV-106',
			name: 'นางสาวอลิสา สุวรรณ',
			age: 26,
			nationalId: '3100902384991',
			phone: '084-555-1234',
			zone: 'C',
			bed: 'C-04',
			householdId: null,
			dietaryTags: ['มังสวิรัติ', 'เจ'],
			wristbandCode: 'WRISTBAND-EV-106'
		},
		{
			id: 'EV-107',
			name: 'นายวิชัย ยืนหยัด',
			age: 72,
			nationalId: '3900200041234',
			phone: '086-444-9876',
			zone: 'A',
			bed: 'A-15',
			householdId: null,
			dietaryTags: ['ผู้สูงอายุ', 'กลุ่มเปราะบาง'],
			wristbandCode: 'WRISTBAND-EV-107'
		}
	];
}

// Breakfast is modeled as already fully served before the kiosk opens (mock only).
export const MOCK_BREAKFAST_PRE_SERVED = 120;

export function createMockHistoricalTransactions(): MealDistributionTransaction[] {
	return [
		{
			id: 'TX-HIST-01',
			recipientId: 'EV-101',
			recipientName: 'นายสมชาย รักดี',
			bed: 'A-01',
			menuId: 'm-bf-01',
			menuTitle: 'ข้าวต้มหมูสับเห็ดหอม + ไข่ลวก',
			time: '07:15 น.',
			portions: 1
		},
		{
			id: 'TX-HIST-02',
			recipientId: 'EV-102',
			recipientName: 'นางสมศรี รักดี',
			bed: 'A-02',
			menuId: 'm-bf-01',
			menuTitle: 'ข้าวต้มหมูสับเห็ดหอม + ไข่ลวก',
			time: '07:18 น.',
			portions: 1
		},
		{
			id: 'TX-HIST-03',
			recipientId: 'EV-103',
			recipientName: 'เด็กชายสมพงษ์ รักดี',
			bed: 'A-03',
			menuId: 'm-bf-01',
			menuTitle: 'ข้าวต้มหมูสับเห็ดหอม + ไข่ลวก',
			time: '07:20 น.',
			portions: 1
		},
		{
			id: 'TX-HIST-04',
			recipientId: 'EV-104',
			recipientName: 'นายอับดุลเลาะห์ ยะลา',
			bed: 'B-12',
			menuId: 'm-bf-01',
			menuTitle: 'ข้าวต้มหมูสับเห็ดหอม + ไข่ลวก',
			time: '07:35 น.',
			portions: 2
		},
		{
			id: 'TX-HIST-05',
			recipientId: 'EV-106',
			recipientName: 'นางสาวอลิสา สุวรรณ',
			bed: 'C-04',
			menuId: 'm-bf-01',
			menuTitle: 'ข้าวต้มหมูสับเห็ดหอม + ไข่ลวก',
			time: '07:42 น.',
			portions: 1
		},
		{
			id: 'TX-HIST-06',
			recipientId: 'EV-107',
			recipientName: 'นายวิชัย ยืนหยัด',
			bed: 'A-15',
			menuId: 'm-bf-01',
			menuTitle: 'ข้าวต้มหมูสับเห็ดหอม + ไข่ลวก',
			time: '08:05 น.',
			portions: 1
		},
		{
			id: 'TX-HIST-07',
			recipientId: 'EV-104',
			recipientName: 'นายอับดุลเลาะห์ ยะลา',
			bed: 'B-12',
			menuId: 'y-m-lh-02',
			menuTitle: 'ข้าวหมกไก่ (ฮาลาล / ครัวมุสลิม)',
			time: '12:15 น.',
			portions: 1
		},
		{
			id: 'TX-HIST-08',
			recipientId: 'EV-105',
			recipientName: 'นางฟาติมะห์ ยะลา',
			bed: 'B-13',
			menuId: 'y-m-lh-02',
			menuTitle: 'ข้าวหมกไก่ (ฮาลาล / ครัวมุสลิม)',
			time: '12:18 น.',
			portions: 1
		}
	];
}
