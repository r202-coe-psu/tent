export type TargetGroup = 'evacuee' | 'volunteer';

export type DistributionMode = 'permanent' | 'borrow_return';

export type RequisitionStatus =
	'pending_approval' | 'distributing' | 'completed' | 'partially_returned' | 'cancelled';

export interface CatalogItem {
	id: string;
	name: string;
	category: string;
	unit: string;
	typeClass: 'CONSUMABLE' | 'DURABLE' | 'EQUIPMENT';
	defaultMode: DistributionMode;
}

export interface ReadyStockItem {
	id: string;
	item_id: string;
	name: string;
	category: string;
	totalQuantity: number;
	availableQuantity: number;
	distributedQuantity: number;
	damagedQuantity: number;
	unit: string;
	location: string;
	mode: DistributionMode;
}

export interface RequisitionItem {
	item_id: string;
	name: string;
	quantity: number;
	unit: string;
	distributed_qty: number;
	damaged_qty: number;
	returned_qty: number;
}

export interface RequisitionTicket {
	ticket_code: string;
	hub_id: string;
	hub_name: string;
	target_group: TargetGroup;
	distribution_mode: DistributionMode;
	items: RequisitionItem[];
	total_requested: number;
	total_distributed: number;
	total_damaged: number;
	total_returned: number;
	status: RequisitionStatus;
	created_at: string;
	reason: string;
	requested_by: string;
}

export interface Recipient {
	id: string;
	name: string;
	type: TargetGroup;
	room?: string;
	role?: string;
	idCard: string;
}

export interface DistributionLog {
	id: string;
	ticket_code: string;
	recipient_name: string;
	item_name: string;
	quantity: number;
	unit: string;
	timestamp: string;
	status: 'completed' | 'borrowed' | 'returned';
}

/** Thai Buddhist-era timestamp label (`1 ก.ย. 69 21:23`) used across requisition/log records. */
export function formatDistributionTimestamp(date: Date = new Date()): string {
	const day = date.getDate();
	const month = THAI_SHORT_MONTHS[date.getMonth()];
	const buddhistYearShort = String((date.getFullYear() + 543) % 100).padStart(2, '0');
	const hours = String(date.getHours()).padStart(2, '0');
	const minutes = String(date.getMinutes()).padStart(2, '0');
	return `${day} ${month} ${buddhistYearShort} ${hours}:${minutes}`;
}

const THAI_SHORT_MONTHS = [
	'ม.ค.',
	'ก.พ.',
	'มี.ค.',
	'เม.ย.',
	'พ.ค.',
	'มิ.ย.',
	'ก.ค.',
	'ส.ค.',
	'ก.ย.',
	'ต.ค.',
	'พ.ย.',
	'ธ.ค.'
] as const;
