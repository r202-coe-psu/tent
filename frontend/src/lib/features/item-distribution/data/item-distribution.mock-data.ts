import type {
	CatalogItem,
	ReadyStockItem,
	RequisitionTicket,
	Recipient,
	DistributionLog
} from '../domain/item-distribution';

/**
 * Static UI mock — no CouchDB doc backs these yet. Returns a fresh array per
 * call so each DistributionStore instance (and each test) gets its own copy
 * instead of sharing mutated module state (see meal-distribution.mock-data.ts).
 */
export function createMockCatalogItems(): CatalogItem[] {
	return [
		{
			id: 'item-001',
			name: 'เสื้อกั๊กสะท้อนแสง',
			category: 'เครื่องแต่งกาย/อุปกรณ์ปฏิบัติงาน',
			unit: 'ตัว',
			typeClass: 'EQUIPMENT',
			defaultMode: 'borrow_return'
		},
		{
			id: 'item-002',
			name: 'ผ้าห่มนวมกันหนาว',
			category: 'เครื่องนอน',
			unit: 'ผืน',
			typeClass: 'DURABLE',
			defaultMode: 'borrow_return'
		},
		{
			id: 'item-003',
			name: 'ถุงยังชีพฉุกเฉิน (Relief Bag)',
			category: 'สิ่งของอุปโภคบริโภค',
			unit: 'ชุด',
			typeClass: 'CONSUMABLE',
			defaultMode: 'permanent'
		},
		{
			id: 'item-004',
			name: 'น้ำดื่มสะอาด 1.5 ลิตร (แพ็ค 6)',
			category: 'เครื่องดื่ม',
			unit: 'แพ็ค',
			typeClass: 'CONSUMABLE',
			defaultMode: 'permanent'
		},
		{
			id: 'item-005',
			name: 'ไฟฉาย LED ชาร์จไฟได้',
			category: 'อุปกรณ์ส่องสว่าง',
			unit: 'เครื่อง',
			typeClass: 'EQUIPMENT',
			defaultMode: 'borrow_return'
		},
		{
			id: 'item-006',
			name: 'ยาสามัญประจำบ้าน (ชุดปฐมพยาบาล)',
			category: 'เวชภัณฑ์',
			unit: 'กล่อง',
			typeClass: 'CONSUMABLE',
			defaultMode: 'permanent'
		},
		{
			id: 'item-007',
			name: 'ผ้าอนามัย (แพ็ค)',
			category: 'สุขอนามัย',
			unit: 'แพ็ค',
			typeClass: 'CONSUMABLE',
			defaultMode: 'permanent'
		},
		{
			id: 'item-008',
			name: 'ผ้าอ้อมสำเร็จรูป (ไซส์ L)',
			category: 'สุขอนามัย',
			unit: 'แพ็ค',
			typeClass: 'CONSUMABLE',
			defaultMode: 'permanent'
		},
		{
			id: 'item-009',
			name: 'วิทยุสื่อสาร ว.แดง (Handheld Radio)',
			category: 'การสื่อสาร',
			unit: 'เครื่อง',
			typeClass: 'EQUIPMENT',
			defaultMode: 'borrow_return'
		},
		{
			id: 'item-010',
			name: 'รองเท้าบูทยาง',
			category: 'เครื่องแต่งกาย/อุปกรณ์ปฏิบัติงาน',
			unit: 'คู่',
			typeClass: 'CONSUMABLE',
			defaultMode: 'permanent'
		}
	];
}

export function createMockReadyStockItems(): ReadyStockItem[] {
	return [
		{
			id: 'stock-001',
			item_id: 'item-003',
			name: 'ถุงยังชีพฉุกเฉิน (Relief Bag)',
			category: 'สิ่งของอุปโภคบริโภค',
			totalQuantity: 250,
			availableQuantity: 180,
			distributedQuantity: 70,
			damagedQuantity: 0,
			unit: 'ชุด',
			location: 'โซน A - คลังแจกจ่ายหน้างาน',
			mode: 'permanent'
		},
		{
			id: 'stock-002',
			item_id: 'item-004',
			name: 'น้ำดื่มสะอาด 1.5 ลิตร (แพ็ค 6)',
			category: 'เครื่องดื่ม',
			totalQuantity: 500,
			availableQuantity: 340,
			distributedQuantity: 160,
			damagedQuantity: 0,
			unit: 'แพ็ค',
			location: 'โซน A - คลังแจกจ่ายหน้างาน',
			mode: 'permanent'
		},
		{
			id: 'stock-003',
			item_id: 'item-001',
			name: 'เสื้อกั๊กสะท้อนแสง',
			category: 'เครื่องแต่งกาย/อุปกรณ์ปฏิบัติงาน',
			totalQuantity: 50,
			availableQuantity: 12,
			distributedQuantity: 35,
			damagedQuantity: 3,
			unit: 'ตัว',
			location: 'ห้องปฏิบัติการอาสาสมัคร',
			mode: 'borrow_return'
		},
		{
			id: 'stock-004',
			item_id: 'item-005',
			name: 'ไฟฉาย LED ชาร์จไฟได้',
			category: 'อุปกรณ์ส่องสว่าง',
			totalQuantity: 80,
			availableQuantity: 45,
			distributedQuantity: 30,
			damagedQuantity: 5,
			unit: 'เครื่อง',
			location: 'ศูนย์ประสานงาน',
			mode: 'borrow_return'
		},
		{
			id: 'stock-005',
			item_id: 'item-002',
			name: 'ผ้าห่มนวมกันหนาว',
			category: 'เครื่องนอน',
			totalQuantity: 300,
			availableQuantity: 210,
			distributedQuantity: 90,
			damagedQuantity: 0,
			unit: 'ผืน',
			location: 'อาคารอพยพ B',
			mode: 'borrow_return'
		},
		{
			id: 'stock-006',
			item_id: 'item-007',
			name: 'ผ้าอนามัย (แพ็ค)',
			category: 'สุขอนามัย',
			totalQuantity: 150,
			availableQuantity: 110,
			distributedQuantity: 40,
			damagedQuantity: 0,
			unit: 'แพ็ค',
			location: 'จุดบริการสุขอนามัย',
			mode: 'permanent'
		},
		{
			id: 'stock-007',
			item_id: 'item-010',
			name: 'รองเท้าบูทยาง',
			category: 'เครื่องแต่งกาย/อุปกรณ์ปฏิบัติงาน',
			totalQuantity: 100,
			availableQuantity: 45,
			distributedQuantity: 55,
			damagedQuantity: 0,
			unit: 'คู่',
			location: 'โซน B - จุดแจกจ่ายอุปกรณ์',
			mode: 'permanent'
		}
	];
}

export function createMockRequisitions(): RequisitionTicket[] {
	return [
		{
			ticket_code: 'TKT-DIST-51421',
			hub_id: 'hub-psu-01',
			hub_name: 'มหาวิทยาลัยสงขลานครินทร์ (ศูนย์อพยพหลักระดับจังหวัด)',
			target_group: 'volunteer',
			distribution_mode: 'permanent',
			items: [
				{
					item_id: 'item-010',
					name: 'รองเท้าบูทยาง',
					quantity: 9,
					unit: 'คู่',
					distributed_qty: 9,
					damaged_qty: 0,
					returned_qty: 0
				}
			],
			total_requested: 9,
			total_distributed: 9,
			total_damaged: 0,
			total_returned: 0,
			status: 'pending_approval',
			created_at: '1 ก.ย. 69 20:07',
			reason: 'คำร้องขอเบิกพัสดุเพื่อแจกจ่ายช่วยเหลืออาสาสมัคร [โหมด: แจกจ่ายขาด] (1 รายการ)',
			requested_by: 'คุณ (เจ้าหน้าที่แจกจ่ายหน้างาน)'
		},
		{
			ticket_code: 'TKT-DIST-23261',
			hub_id: 'hub-psu-01',
			hub_name: 'มหาวิทยาลัยสงขลานครินทร์ (ศูนย์อพยพหลักระดับจังหวัด)',
			target_group: 'volunteer',
			distribution_mode: 'borrow_return',
			items: [
				{
					item_id: 'item-001',
					name: 'เสื้อกั๊กสะท้อนแสง',
					quantity: 1,
					unit: 'ตัว',
					distributed_qty: 1,
					damaged_qty: 0,
					returned_qty: 0
				}
			],
			total_requested: 1,
			total_distributed: 1,
			total_damaged: 0,
			total_returned: 0,
			status: 'pending_approval',
			created_at: '1 ก.ย. 69 21:23',
			reason: 'ขอเบิกเสื้อกั๊กสะท้อนแสงเพิ่มเติมสำหรับเจ้าหน้าที่คัดกรองบริเวณหน้าประตู 1',
			requested_by: 'นายสมชาย ใจดี (หัวหน้าอาสาสมัคร)'
		},
		{
			ticket_code: 'TKT-DIST-23260',
			hub_id: 'hub-psu-01',
			hub_name: 'มหาวิทยาลัยสงขลานครินทร์ (ศูนย์อพยพหลักระดับจังหวัด)',
			target_group: 'evacuee',
			distribution_mode: 'permanent',
			items: [
				{
					item_id: 'item-003',
					name: 'ถุงยังชีพฉุกเฉิน (Relief Bag)',
					quantity: 100,
					unit: 'ชุด',
					distributed_qty: 100,
					damaged_qty: 0,
					returned_qty: 0
				},
				{
					item_id: 'item-004',
					name: 'น้ำดื่มสะอาด 1.5 ลิตร (แพ็ค 6)',
					quantity: 200,
					unit: 'แพ็ค',
					distributed_qty: 200,
					damaged_qty: 0,
					returned_qty: 0
				}
			],
			total_requested: 300,
			total_distributed: 300,
			total_damaged: 0,
			total_returned: 0,
			status: 'completed',
			created_at: '1 ก.ย. 69 18:10',
			reason: 'แจกจ่ายให้ผู้พักพิงเข้าใหม่ในอาคาร A และ B',
			requested_by: 'นางสาววิภา รักดี (ผู้ดูแลอาคาร A)'
		},
		{
			ticket_code: 'TKT-DIST-23259',
			hub_id: 'hub-psu-01',
			hub_name: 'มหาวิทยาลัยสงขลานครินทร์ (ศูนย์อพยพหลักระดับจังหวัด)',
			target_group: 'volunteer',
			distribution_mode: 'borrow_return',
			items: [
				{
					item_id: 'item-009',
					name: 'วิทยุสื่อสาร ว.แดง',
					quantity: 10,
					unit: 'เครื่อง',
					distributed_qty: 10,
					damaged_qty: 1,
					returned_qty: 9
				},
				{
					item_id: 'item-005',
					name: 'ไฟฉาย LED ชาร์จไฟได้',
					quantity: 15,
					unit: 'เครื่อง',
					distributed_qty: 15,
					damaged_qty: 0,
					returned_qty: 12
				}
			],
			total_requested: 25,
			total_distributed: 25,
			total_damaged: 1,
			total_returned: 21,
			status: 'partially_returned',
			created_at: '1 ก.ย. 69 14:45',
			reason: 'ใช้สำหรับทีมกู้ภัยและลาดตระเวนรอบศูนย์พักพิงช่วงกลางคืน',
			requested_by: 'นายกิตติศักดิ์ พรหมดี'
		},
		{
			ticket_code: 'TKT-DIST-23258',
			hub_id: 'hub-psu-01',
			hub_name: 'มหาวิทยาลัยสงขลานครินทร์ (ศูนย์อพยพหลักระดับจังหวัด)',
			target_group: 'evacuee',
			distribution_mode: 'permanent',
			items: [
				{
					item_id: 'item-008',
					name: 'ผ้าอ้อมสำเร็จรูป (ไซส์ L)',
					quantity: 50,
					unit: 'แพ็ค',
					distributed_qty: 25,
					damaged_qty: 0,
					returned_qty: 0
				},
				{
					item_id: 'item-007',
					name: 'ผ้าอนามัย (แพ็ค)',
					quantity: 80,
					unit: 'แพ็ค',
					distributed_qty: 40,
					damaged_qty: 0,
					returned_qty: 0
				}
			],
			total_requested: 130,
			total_distributed: 65,
			total_damaged: 0,
			total_returned: 0,
			status: 'distributing',
			created_at: '1 ก.ย. 69 10:15',
			reason: 'สำรองแจกจ่ายผู้สูงอายุและสตรีในศูนย์พักพิง',
			requested_by: 'พยาบาลวิชาชีพ สุจิตรา'
		}
	];
}

export function createMockRecipients(): Recipient[] {
	return [
		{
			id: 'REG-001',
			name: 'นายสมหมาย มีสุข',
			type: 'evacuee',
			room: 'อาคาร A-102',
			idCard: '1-9099-00123-45-6'
		},
		{
			id: 'REG-002',
			name: 'นางสาวพรทิพย์ สว่างวงศ์',
			type: 'evacuee',
			room: 'อาคาร B-205',
			idCard: '3-9001-00882-11-2'
		},
		{
			id: 'VOL-001',
			name: 'นายธีรเดช สายชล',
			type: 'volunteer',
			role: 'กู้ภัย/ลาดตระเวน',
			idCard: '1-1002-00334-99-0'
		},
		{
			id: 'VOL-002',
			name: 'นางสาวอนันยา บุญมี',
			type: 'volunteer',
			role: 'คัดกรองจุดลงทะเบียน',
			idCard: '5-9002-00441-22-1'
		}
	];
}

export function createMockDistributionLogs(): DistributionLog[] {
	return [
		{
			id: 'LOG-001',
			ticket_code: 'TKT-DIST-23260',
			recipient_name: 'นายสมหมาย มีสุข',
			item_name: 'ถุงยังชีพฉุกเฉิน (Relief Bag)',
			quantity: 1,
			unit: 'ชุด',
			timestamp: '1 ก.ย. 69 19:05',
			status: 'completed'
		},
		{
			id: 'LOG-002',
			ticket_code: 'TKT-DIST-23259',
			recipient_name: 'นายธีรเดช สายชล',
			item_name: 'วิทยุสื่อสาร ว.แดง',
			quantity: 1,
			unit: 'เครื่อง',
			timestamp: '1 ก.ย. 69 15:00',
			status: 'borrowed'
		}
	];
}
