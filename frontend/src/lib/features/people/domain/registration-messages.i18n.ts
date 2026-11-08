/**
 * English mirror of the registration validation messages.
 *
 * The Zod schemas (`people.ts`, `unified-registration.ts`) and the public registration route carry
 * Thai `message`s. Those stay the canonical text — server / back-office paths and existing tests
 * depend on them — so the form translates at the edge instead: Thai in, text for the selected
 * language out. Unknown messages (and anything already localized by the form itself) pass through.
 *
 * Messages with interpolated values are matched by pattern rather than listed one by one.
 */
import type { LanguageCode } from '$lib/utils/language';

const EN_BY_THAI_MESSAGE: Readonly<Record<string, string>> = {
	// Member identity
	กรุณากรอกชื่อ: 'Please enter a first name',
	เพศไม่ถูกต้อง: 'Invalid gender',
	กรุณากรอกเบอร์โทรศัพท์: 'Please enter a phone number',
	'เบอร์โทรต้องเป็นตัวเลข 10 หลัก ขึ้นต้นด้วย 0': 'Phone number must be 10 digits starting with 0',
	'กรุณากรอกปีเกิด 4 หลัก': 'Please enter a 4-digit birth year',
	อายุต้องไม่ติดลบ: 'Age must not be negative',
	อายุไม่ตรงกับปีเกิด: 'Age does not match the birth year',
	กรุณาเลือกประเทศ: 'Please select a country',
	กรุณาระบุศาสนา: 'Please specify the religion',
	กรุณาเลือกศาสนา: 'Please select a religion',

	// ID document
	'เลขประจำตัวประชาชนต้องมี 13 หลัก': 'National ID must be 13 digits',
	'เลขบัตรประชาชนไม่ถูกต้อง (ตรวจสอบหลักสุดท้ายอีกครั้ง)':
		'National ID is not valid (check the last digit again)',
	'เลขที่พาสปอร์ตต้องไม่เกิน 9 ตัวอักษร': 'Passport number must be at most 9 characters',
	กรุณากรอกเลขประจำตัวหรือเลขที่เอกสาร: 'Please enter the ID or document number',

	// Emergency contact
	กรุณากรอกข้อมูลผู้ติดต่อฉุกเฉิน: 'Please enter the emergency contact details',
	'กรุณากรอกชื่อ-นามสกุลผู้ติดต่อฉุกเฉิน': 'Please enter the emergency contact full name',
	กรุณากรอกเบอร์ติดต่อฉุกเฉิน: 'Please enter the emergency contact phone number',
	'กรุณากรอกเบอร์ติดต่อฉุกเฉินให้ครบ 10 หลัก':
		'Please enter the emergency contact phone number (10 digits)',
	กรุณาระบุความสัมพันธ์ของผู้ติดต่อฉุกเฉิน:
		'Please specify your relationship to the emergency contact',

	// Household address
	'กรุณากรอกบ้านเลขที่ จังหวัด อำเภอ และตำบล':
		'Please enter the house number, province, district and subdistrict',
	ที่พักแบบไร้บ้านเลขที่ต้องมีจุดสังเกตหรือที่ตั้งครบ:
		'A residence without a house number needs a landmark or a complete location',
	'ครัวเรือนไร้บ้านต้องมีบ้านเลขที่ หรือจุดสังเกต หรือที่อยู่ภูมิศาสตร์ครบ':
		'A homeless household needs a house number, a landmark or a complete geographic address',
	กรุณากรอกชื่อหอพัก: 'Please enter the dormitory name',
	กรุณากรอกเลขห้อง: 'Please enter the room number',

	// Pets
	กรุณาระบุชนิดสัตว์เมื่อเลือกอื่นๆ: 'Please specify the type of animal when choosing Other',

	// Batch
	'ต้องมีสมาชิกอย่างน้อย 1 คน': 'At least 1 member is required',
	'ลงทะเบียนได้สูงสุด 20 คนต่อครั้ง': 'You can register at most 20 people at a time',
	'ระบุได้เพียง join_household_id หรือ join_match_token อย่างใดอย่างหนึ่ง':
		'Provide only one of join_household_id or join_match_token',

	// Public registration route (`/api/public/v1/registrations`)
	กรุณาระบุศูนย์พักพิง: 'Please select a shelter',
	'กรุณากรอกเบอร์โทรศัพท์ 10 หลักของผู้ติดต่อหลัก':
		'Please enter a 10-digit phone number for the primary contact',
	'กรุณากรอกเบอร์ให้ครบ 10 หลัก หรือเว้นว่าง / เลือกไม่มีเบอร์':
		'Please enter all 10 digits, or leave it blank / tick "No phone number"'
};

const EN_PATTERNS: readonly [RegExp, (...groups: string[]) => string][] = [
	[
		/^สัตว์เลี้ยงรวมได้ไม่เกิน (\d+) ตัวต่อครอบครัว$/,
		(max) => `A household can have at most ${max} animals in total`
	],
	[/^อายุต้องไม่เกิน (\d+) ปี$/, (max) => `Age must not exceed ${max} years`],
	[
		/^เลขที่บัตรต้องไม่เกิน (\d+) ตัวอักษร$/,
		(max) => `Card number must be at most ${max} characters`
	],
	[
		/^ปีเกิด \(พ\.ศ\.\) ต้องอยู่ระหว่าง (\d+)–(\d+)$/,
		(from, to) => `Birth year (B.E.) must be between ${from} and ${to}`
	]
];

/**
 * `message` for the selected language. Thai returns the input unchanged; English maps the
 * canonical Thai text, falling back to the input when there is no mirror.
 */
export function localizeRegistrationMessage(message: string, lang: LanguageCode): string {
	if (lang !== 'en') return message;
	const exact = EN_BY_THAI_MESSAGE[message];
	if (exact) return exact;
	for (const [pattern, build] of EN_PATTERNS) {
		const match = pattern.exec(message);
		if (match) return build(...match.slice(1));
	}
	return message;
}
