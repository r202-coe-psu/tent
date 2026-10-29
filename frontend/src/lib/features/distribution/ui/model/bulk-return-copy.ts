// Single source of truth for Bulk Return Pool copy so Back-office and Onsite never drift into
// different wording for the same underlying concept. Pure copy only — no I/O, no business logic.

export const BULK_RETURN_FEATURE_NAME = {
	title: 'กองรับคืนพัสดุ',
	subtitle: 'พัสดุที่รับเข้าคลังแล้ว แต่ยังรอจับคู่กับรายการยืมของผู้คืน'
} as const;

export const BULK_RETURN_ACCOUNTING_LABELS = {
	totalReceived: 'รับคืนแล้ว',
	claimed: 'จับคู่แล้ว',
	remaining: 'รอจับคู่',
	claimCount: 'รายการยืมที่จับคู่แล้ว'
} as const;

export const BULK_RETURN_ACCOUNTING_DESCRIPTIONS = {
	totalReceived: 'จำนวนพัสดุจริงที่เจ้าหน้าที่ตรวจนับและรับเข้าคลังแล้ว',
	claimed: 'จำนวนพัสดุคืนที่นำไปจับคู่กับรายการยืมของผู้คืนแล้ว',
	remaining: 'จำนวนพัสดุที่รับเข้าคลังแล้ว แต่ยังไม่ได้จับคู่กับรายการยืมของผู้คืน',
	claimCount:
		'จำนวนรายการยืมที่ใช้พัสดุจากกองนี้ในการยืนยันการคืน ตัวเลขนี้เป็นจำนวนรายการ ไม่ใช่จำนวนชิ้น'
} as const;

export const BULK_RETURN_STATUS_LABELS = {
	ACTIVE: 'พร้อมจับคู่',
	EXHAUSTED: 'จับคู่ครบแล้ว',
	CLOSED: 'ปิดกองแล้ว'
} as const;

export const BULK_RETURN_STATUS_DESCRIPTIONS = {
	ACTIVE: 'ยังมีพัสดุคืนในกองนี้ที่สามารถนำไปจับคู่กับรายการยืมได้',
	EXHAUSTED: 'พัสดุคืนทั้งหมดในกองนี้ถูกจับคู่กับรายการยืมครบแล้ว',
	CLOSED: 'กองนี้ถูกปิดและไม่สามารถนำไปจับคู่กับรายการยืมเพิ่มเติมได้'
} as const;

export const BULK_RETURN_POOL_EXPLANATION = {
	title: 'กองรับคืนพัสดุทำงานอย่างไร?',
	body: 'เมื่อเจ้าหน้าที่เก็บพัสดุคืนจากจุดรวมและตรวจนับแล้ว ระบบจะรับของเข้าคลังทันที แม้ยังไม่ทราบว่าเป็นของผู้ยืมรายใด\n\nภายหลัง เมื่อผู้ยืมแจ้งว่าได้คืนของไว้ที่กองรวม เจ้าหน้าที่สามารถจับคู่รายการยืมกับของคืนในกองนี้ได้ โดยไม่รับของเข้าคลังซ้ำ'
} as const;

export const BULK_RETURN_IMMUTABILITY_NOTE = 'เมื่อเปิดกองแล้ว จำนวนรับคืนจะไม่ถูกแก้ย้อนหลัง';

export const BULK_GATE_CLEAR_EXPLANATION = {
	title: 'จับคู่กับกองรับคืนคืออะไร?',
	body: 'ใช้เมื่อพัสดุของผู้ยืมถูกเก็บคืนเข้ากองรับคืนแล้ว แต่ยังไม่ได้ระบุว่าเป็นของผู้ยืมรายใด ระบบจะนำจำนวนจากกองนั้นมาปิดภาระยืมของรายการนี้ โดยไม่รับของเข้าคลังซ้ำ'
} as const;

// "รับของเข้ากอง" (add entries) — what is left to do after a save that did not finish everything.
export const ADD_ENTRY_COPY = {
	/** Appended to the MISSED_LOAN_WARNING sentence naming the items. */
	loanPendingWhere: 'ทำได้ที่หน้ากอง กด "ตัดยอดยืมที่ค้าง"',
	voided: (count: number) => `${count} รายการถูกยกเลิกไปแล้ว จึงไม่ได้ตัดยอดยืม`,
	loansReopened: (count: number) => `${count} รายการถูกเปิดยอดยืมกลับแล้ว จึงไม่ได้ตัดยอดยืม`,
	keptAtWrittenQty: (names: string) =>
		`บางรายการบันทึกไปแล้วด้วยจำนวนเดิม จึงคงจำนวนเดิมไว้: ${names}`,
	writtenLookupFailed:
		'ตรวจสอบรายการที่บันทึกไปแล้วไม่สำเร็จ จึงไม่ได้ปรับจำนวนของรายการที่เคยส่งไปแล้ว กรุณาลองใหม่อีกครั้ง',
	remainingClosed:
		'บางรายการยังไม่ได้บันทึก เพราะกองนี้ปิดรับของแล้ว กรุณาเลือกกองอื่นที่เปิดรับ แล้วกดบันทึกอีกครั้ง',
	remainingLocked:
		'บางรายการยังไม่ได้บันทึก เพราะกองนี้กำลังถูกส่งเข้าคลังหรือยกเลิกอยู่ กรุณารอสักครู่ แล้วกดบันทึกอีกครั้ง',
	remainingLoanPending:
		'บางรายการยังไม่ได้บันทึก เพราะระบบหยุดไว้ที่รายการที่ตัดยอดยืมไม่ทัน (กองกำลังถูกส่งเข้าคลังหรือยกเลิก) กรุณารอสักครู่ แล้วกดบันทึกอีกครั้ง',
	remainingNotAccepting:
		'บางรายการยังไม่ได้บันทึก เพราะกองนี้ไม่รับของแล้ว กรุณาเลือกกองอื่นที่เปิดรับ แล้วกดบันทึกอีกครั้ง'
} as const;

/** Toast when a `?pool=` deep link names a pool that is not in the loaded overview. */
export const BULK_RETURN_POOL_NOT_FOUND_TOAST = 'ไม่พบกองนี้ อาจถูกลบหรืออยู่ศูนย์อื่น';

/**
 * Shown on a closed-pool entry INSTEAD of the "reopen loans" button when an applied loan can no
 * longer be reverted (CR-193 §35). `label` is a closed-as label; `n` / `total` count applied refs.
 */
export const BULK_RETURN_REOPEN_BLOCKED_COPY = {
	labels: { lost: 'สูญหาย', waived: 'ยกเว้นการคืน', both: 'สูญหาย/ยกเว้นการคืน' },
	allClosed: (label: string) => `เปิดยอดยืมกลับไม่ได้ ยอดยืมถูกปิดเป็น${label}แล้ว`,
	someClosed: (n: number, total: number, label: string) =>
		`เปิดยอดยืมกลับไม่ได้ ยอดยืม ${n} จาก ${total} รายการถูกปิดเป็น${label}แล้ว`,
	allChanged: 'เปิดยอดยืมกลับไม่ได้ ยอดยืมเปลี่ยนไปแล้ว',
	someChanged: (n: number, total: number) =>
		`เปิดยอดยืมกลับไม่ได้ ยอดยืม ${n} จาก ${total} รายการเปลี่ยนไปแล้ว`
} as const;

export const RETURN_ACTION_HELP = {
	counter: 'ใช้เมื่อผู้ยืมนำพัสดุมาคืนกับเจ้าหน้าที่โดยตรง',
	nonPhysical: 'ใช้กรณีสูญหาย หรือได้รับอนุญาตให้ยกเว้นการคืน',
	bulk: 'ใช้เมื่อผู้ยืมนำของมาวางที่จุดรวม บันทึกเข้ากองรับคืน ระบบจะตัดยอดยืมของผู้ยืมรายนี้ให้ (เก่าสุดก่อน)'
} as const;
