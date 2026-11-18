import type { AuditAction, AuditEntityType } from './audit-event';

export const AUDIT_ACTION_LABELS: Record<AuditAction, string> = {
	create: 'สร้าง',
	update: 'แก้ไข',
	delete: 'ลบ',
	status_change: 'เปลี่ยนสถานะ',
	other: 'อื่น ๆ'
};

export const AUDIT_ENTITY_LABELS: Record<AuditEntityType, string> = {
	shelter: 'ศูนย์พักพิง',
	user: 'ผู้ใช้งาน',
	master_data: 'ข้อมูลหลัก',
	api_key: 'API key',
	thirdparty_client: 'หน่วยงานภายนอก',
	item_category: 'หมวดสินค้า',
	item_master: 'สินค้า',
	recipe: 'สูตรอาหาร',
	unit_of_measure: 'หน่วยนับ',
	food_sphere_standard: 'มาตรฐาน Food Sphere',
	requirement_group: 'กลุ่มความต้องการ',
	replenishment_policy: 'นโยบายเติมสต็อก',
	evacuee: 'ผู้อพยพ',
	household: 'ครัวเรือน',
	medical: 'ข้อมูลการแพทย์'
};

const VERB_LABELS: Record<string, string> = {
	created: 'สร้าง',
	updated: 'แก้ไข',
	deleted: 'ลบ',
	status_changed: 'เปลี่ยนสถานะ'
};

const EVENT_LABELS: Record<string, string> = {
	'shelter.created': 'สร้างศูนย์',
	'shelter.updated': 'แก้ไขข้อมูลศูนย์',
	'shelter.closed': 'ปิดศูนย์',
	'shelter.zone_closed': 'ปิดโซน',
	'shelter.zone_reopened': 'เปิดโซนอีกครั้ง',
	'shelter.storage_point_changed': 'แก้ไขจุดเก็บของ',
	'shelter.imported': 'นำเข้าจาก Excel',
	'user.created': 'สร้างผู้ใช้',
	'user.updated': 'แก้ไขผู้ใช้',
	'user.roles_changed': 'เปลี่ยนสิทธิ์ผู้ใช้',
	'user.deleted': 'ลบผู้ใช้',
	'user.password_reset': 'รีเซ็ตรหัสผ่าน',
	'user.staff_card_rotated': 'หมุนบัตร QR เจ้าหน้าที่',
	'master_data.updated': 'แก้ไขข้อมูลหลัก',
	'api_key.created': 'สร้าง API key',
	'api_key.updated': 'แก้ไข API key',
	'api_key.revoked': 'เพิกถอน API key',
	'thirdparty_client.created': 'เพิ่มหน่วยงานภายนอก',
	'thirdparty_client.updated': 'แก้ไขหน่วยงานภายนอก',
	'thirdparty_client.deleted': 'ลบหน่วยงานภายนอก',
	'thirdparty_client.secret_viewed': 'เปิดดู secret ของหน่วยงานภายนอก',
	'audit.duplicate_override': 'ยืนยันรายการซ้ำ',
	'audit.privacy_change': 'เปลี่ยนการแสดงในระบบค้นหาญาติ',
	'audit.export': 'ส่งออกข้อมูล',
	'audit.retro_edit': 'แก้ไขย้อนหลัง',
	'audit.manual_adjust': 'ปรับยอดด้วยมือ',
	'audit.conflict_resolved': 'แก้ข้อมูลชนกัน',
	'audit.purge': 'ลบข้อมูลถาวร',
	'audit.created': 'สร้างรายการ',
	donor_contact_view: 'เปิดดูข้อมูลติดต่อผู้บริจาค'
};

export function auditEventLabel(event: string): string {
	if (EVENT_LABELS[event]) return EVENT_LABELS[event];
	if (event.startsWith('role_grant.'))
		return `สิทธิ์ชั่วคราว (${event.slice('role_grant.'.length)})`;
	const dot = event.lastIndexOf('.');
	const verb = VERB_LABELS[event.slice(dot + 1)];
	if (dot > 0 && verb) return `${verb}${auditEntityLabel(event.slice(0, dot))}`;
	return event;
}

export function auditEntityLabel(type: string): string {
	return (AUDIT_ENTITY_LABELS as Record<string, string>)[type] ?? type;
}

export function auditChangeValue(value: unknown): string {
	if (value === null || value === undefined || value === '') return '—';
	if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
	if (typeof value === 'boolean') return value ? 'ใช่' : 'ไม่ใช่';
	return String(value);
}
