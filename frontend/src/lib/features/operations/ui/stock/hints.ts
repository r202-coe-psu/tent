/** Why a stock action is disabled. Shown by `DisabledReason` (tooltip + screen-reader text). */
export const DISTRIBUTE_FORBIDDEN_HINT =
	'ต้องมีสิทธิ์เจ้าหน้าที่คลัง (warehouse_staff) หรือผู้จัดการศูนย์ (shelter_manager) จึงจะเบิกจ่ายได้';

export const OFFLINE_HINT = 'เซสชันหมดอายุ — เข้าสู่ระบบใหม่เพื่อบันทึก';

/** Why "รวมของที่กำลังมา" is off while a storage point is filtered (#1153 FR-18). */
export const INCOMING_NO_STORAGE_HINT = 'ของที่กำลังมายังไม่มีที่เก็บ';

/** Why "รวมของที่กำลังมา" is off while "ซื้อเอง" is on: incoming goods are not self-purchased. */
export const INCOMING_SELF_PURCHASED_HINT = 'ของที่กำลังมายังไม่นับเป็นของที่ซื้อเอง';

/** The incoming read failed: the stock numbers shown are in-stock only. */
export const INCOMING_LOAD_FAILED_HINT =
	'โหลดของที่กำลังมาไม่สำเร็จ ตัวเลขที่เห็นเป็นยอดในคลังเท่านั้น';
export const INCOMING_FORBIDDEN_HINT = 'บัญชีนี้ไม่มีสิทธิ์ดูของที่กำลังมา';
