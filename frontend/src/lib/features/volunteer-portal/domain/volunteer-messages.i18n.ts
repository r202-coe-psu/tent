/**
 * English mirror of the volunteer portal's validation messages.
 *
 * The Zod schemas in `volunteer.ts` (and the shared Thai mobile rule they reuse) carry Thai
 * `message`s. Those stay the canonical text — the BFF routes and existing tests depend on them —
 * so the UI translates at the edge: Thai in, text for the selected language out. Unknown messages
 * (user input echoed back, a server message we do not know) pass through unchanged.
 *
 * Messages with an interpolated value are matched by pattern rather than listed one by one.
 */
import type { LanguageCode } from '$lib/stores/language.svelte';

const EN_BY_THAI_MESSAGE: Readonly<Record<string, string>> = {
	// Apply form
	กรุณากรอกชื่อ: 'Please enter a first name',
	กรุณาระบุชื่อ: 'Please enter a first name',
	กรุณาระบุนามสกุล: 'Please enter a last name',
	ข้อมูลไม่ถูกต้อง: 'Invalid data',
	กรุณากรอกนามสกุล: 'Please enter a last name',
	กรุณากรอกเบอร์โทรศัพท์: 'Please enter a phone number',
	กรุณาระบุเบอร์โทรศัพท์: 'Please enter a phone number',
	'เบอร์โทรต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0': 'Phone number must be 10 digits starting with 0',
	เบอร์โทรศัพท์ไม่ถูกต้อง: 'Invalid phone number',
	เลขประจำตัวประชาชนไม่ถูกต้อง: 'Invalid national ID number',
	อีเมลไม่ถูกต้อง: 'Invalid email address',
	กรุณาเลือกกะ: 'Please select a shift',
	'รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)': 'Invalid date format (YYYY-MM-DD)',

	// Dispatch response code
	กรุณากรอกรหัสที่เจ้าหน้าที่แจ้ง: 'Please enter the code the staff gave you',
	รหัสไม่ถูกต้อง: 'Invalid code',

	// API error codes (`ERROR_COPY` in data/volunteer-api.ts)
	'ไม่พบงานอาสาสมัครนี้ อาจถูกปิดรับสมัครไปแล้ว':
		'This volunteer job was not found. It may already be closed for applications',
	งานอาสาสมัครนี้ปิดรับสมัครแล้ว: 'This volunteer job is closed for applications',
	'งานอาสาสมัครนี้เต็มแล้ว กรุณาเลือกกะหรืองานอาสาสมัครอื่น':
		'This volunteer job is full. Please pick another shift or job',
	'กะนี้เต็มแล้ว กรุณาเลือกกะหรืองานอาสาสมัครอื่น':
		'This shift is full. Please pick another shift or job',
	'กะนี้สิ้นสุดแล้ว ปิดรับสมัคร กรุณาเลือกกะอื่น':
		'This shift has ended and is closed for applications. Please pick another shift',
	'ไม่พบกะงานนี้ หรือกะนี้ไม่ใช่ของคุณ': 'This shift was not found, or it is not yours',
	กรุณาเลือกกะที่ต้องการสมัคร: 'Please select the shift you want to apply for',
	'ไม่สามารถระบุกะงานที่ต้องการได้ กรุณาเลือกกะใหม่อีกครั้ง':
		'We could not tell which shift you meant. Please select the shift again',
	'งานอาสาสมัครนี้กำลังเตรียมระบบรับสมัคร กรุณาลองใหม่อีกครั้งภายหลัง':
		'Applications for this volunteer job are still being set up. Please try again later',
	'ระบบรับสมัครขัดข้องชั่วคราว กรุณาลองใหม่ภายหลังหรือแจ้งเจ้าหน้าที่':
		'The application system is temporarily unavailable. Please try again later or tell the staff',
	'เบอร์นี้สมัครงานอาสาสมัครนี้ไว้แล้ว — เปิดดูตั๋วเดิมได้จาก "ค้นหาตั๋วของฉัน"':
		'This number has already applied for this volunteer job. Open the existing ticket from "Find my ticket"',
	คุณได้สมัครงานอาสาสมัครนี้ไว้แล้ว: 'You have already applied for this volunteer job',
	'พบข้อมูล volunteer มากกว่าหนึ่ง profile กรุณาติดต่อเจ้าหน้าที่':
		'More than one volunteer profile was found. Please contact the staff',
	คุณมีกะงานอื่นที่เวลาทับซ้อนกัน: 'You have another shift that overlaps in time',
	'ไม่สามารถบันทึกข้อมูลได้ กรุณาลองใหม่อีกครั้ง': 'Could not save the data. Please try again',
	'ไม่สามารถบันทึกใบสมัครได้ กรุณาลองใหม่อีกครั้ง':
		'Could not save the application. Please try again',
	'ตรวจสอบข้อมูลก่อนสมัครไม่สำเร็จ กรุณาลองใหม่อีกครั้ง':
		'Could not check your details before applying. Please try again',
	'ไม่พบโปรไฟล์ของคุณในระบบ — ลองจองงานอาสาสมัครสักงานก่อน':
		'Your profile was not found. Try booking a volunteer job first',
	'บันทึกโปรไฟล์ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง': 'Could not save your profile. Please try again',
	'ไม่สามารถยืนยันว่าไม่ใช่บอทได้ กรุณารีเฟรชหน้าแล้วลองใหม่':
		'We could not confirm you are not a bot. Please refresh the page and try again',
	'ไม่ผ่านการตรวจสอบ reCAPTCHA กรุณาลองใหม่อีกครั้ง':
		'The reCAPTCHA check failed. Please try again',
	'ไม่พบงานอาสาสมัครนี้ หรือรหัสไม่ถูกต้อง กรุณาตรวจสอบกับเจ้าหน้าที่':
		'This volunteer job was not found, or the code is wrong. Please check with the staff',
	งานอาสาสมัครนี้ถูกตอบไปแล้ว: 'This volunteer job has already been answered',
	กะนี้ยังไม่อยู่ในสถานะที่เช็คอินได้: 'This shift cannot be checked in to yet',
	'กะนี้ยังไม่ได้เช็คอิน หรือเช็คเอาต์ไปแล้ว':
		'This shift is not checked in, or is already checked out',
	กะนี้ถอนหรือขอลาไม่ได้แล้ว: 'This shift can no longer be withdrawn or taken leave from',
	'ดำเนินการกับกะงานไม่สำเร็จ กรุณาลองใหม่อีกครั้ง':
		'Could not complete the shift action. Please try again',
	'ไม่พบตั๋วนี้ กรุณาตรวจสอบลิงก์อีกครั้ง':
		'This ticket was not found. Please check the link again',
	ตั๋วนี้ยกเลิกไม่ได้แล้ว: 'This ticket can no longer be cancelled',
	'กะนี้เริ่มไปแล้ว ยกเลิกการสมัครไม่ได้':
		'This shift has already started, so it cannot be cancelled',
	'ยกเลิกการสมัครไม่สำเร็จ กรุณาลองใหม่อีกครั้ง':
		'Could not cancel the application. Please try again',
	'ส่งคำขอถี่เกินไป กรุณารอสักครู่แล้วลองใหม่':
		'Too many requests. Please wait a moment and try again',
	'ไม่พบเบอร์โทรศัพท์นี้ในระบบอาสาสมัคร กรุณาตรวจสอบเบอร์ที่ใช้สมัครอีกครั้ง':
		'This phone number was not found in the volunteer system. Please check the number you applied with',
	'ไม่สามารถตรวจสอบสิทธิ์ใช้งานระบบได้ กรุณาลองใหม่อีกครั้ง':
		'Could not check your system access. Please try again',
	'ไม่สามารถตรวจสอบข้อมูลจิตอาสาได้ กรุณาลองใหม่อีกครั้ง':
		'Could not check your volunteer details. Please try again',
	'ไม่พบข้อมูล role card ของอาสาสมัคร': 'The volunteer role card was not found',
	'ไม่สามารถสร้าง QR Role Card ได้ กรุณาลองใหม่อีกครั้ง':
		'Could not create the QR role card. Please try again',

	// Fallbacks for a call that failed with no code and no message of its own
	ไม่สามารถเปิดตั๋วนี้ได้: 'Could not open this ticket',
	ค้นหาตั๋วไม่สำเร็จ: 'Ticket search failed',
	ยกเลิกการสมัครไม่สำเร็จ: 'Could not cancel the application',
	ไม่สามารถโหลดตารางงานได้: 'Could not load the schedule',
	ไม่สามารถตรวจสอบสิทธิ์ใช้งานระบบได้: 'Could not check your system access',
	ตอบรับงานอาสาสมัครไม่สำเร็จ: 'Could not respond to the volunteer job',
	ดำเนินการกับกะงานไม่สำเร็จ: 'Could not complete the shift action',
	ไม่สามารถโหลดกระดานงานอาสาได้: 'Could not load the volunteer job board',
	ส่งใบสมัครไม่สำเร็จ: 'Could not send the application',
	ไม่สามารถโหลดโปรไฟล์ได้: 'Could not load your profile',
	ไม่สามารถตรวจสอบข้อมูลจิตอาสาได้: 'Could not check your volunteer details',
	'ไม่สามารถสร้าง QR Role Card ได้': 'Could not create the QR role card',
	บันทึกโปรไฟล์ไม่สำเร็จ: 'Could not save your profile',
	ไม่สามารถโหลดรายการทักษะได้: 'Could not load the skill list'
};

/** Messages that embed a number: Thai pattern in, English builder out. */
const EN_BY_THAI_PATTERN: ReadonlyArray<readonly [RegExp, (...groups: string[]) => string]> = [
	[
		/^เลือกได้ไม่เกิน (\d+) กะต่อครั้ง$/,
		(max) => `You can pick at most ${max} shifts per application`
	],
	[/^คำขอไม่สำเร็จ \((\d+)\)$/, (status) => `Request failed (${status})`],
	[/^เลือกทักษะได้สูงสุด (\d+) รายการ$/, (max) => `You can pick at most ${max} skills`]
];

/** The message as the selected language reads it; Thai (and anything unknown) comes back as is. */
export function localizeVolunteerMessage(message: string, language: LanguageCode): string {
	if (language !== 'en') return message;
	const exact = EN_BY_THAI_MESSAGE[message];
	if (exact !== undefined) return exact;
	for (const [pattern, build] of EN_BY_THAI_PATTERN) {
		const match = pattern.exec(message);
		if (match) return build(...match.slice(1));
	}
	return message;
}
