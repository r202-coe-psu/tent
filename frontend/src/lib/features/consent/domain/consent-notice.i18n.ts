/**
 * PDPA consent block copy (spec §3.1, §5). `CONSENT_COPY` is the Thai source of truth;
 * `CONSENT_BLOCK_I18N.en` mirrors it for the public pre-register language toggle. Each consent shows a short line;
 * `full` is the approved prototype text (D11), with C1 reworded for "everyone registered" (D18).
 * Bump CONSENT_NOTICE_VERSION whenever any consent wording changes.
 */

export const CONSENT_NOTICE_VERSION = '2026-11-04';

export const CONSENT_COPY = {
	heading: 'ข้อตกลงและนโยบายความเป็นส่วนตัว',
	intro: {
		before: 'อ่าน',
		term: 'ข้อตกลงการใช้งาน',
		and: 'และ',
		policy: 'นโยบายความเป็นส่วนตัว',
		after: ' แล้วกด「ยอมรับทั้งหมด」 หรือเลือกเฉพาะข้อที่ต้องการ',
		kiosk: 'กด「ยอมรับทั้งหมด」 หรือเลือกเฉพาะข้อที่ต้องการ'
	},
	acceptAll: 'ยอมรับทั้งหมด',
	acknowledgementHeading: 'ต้องรับทราบก่อนส่งข้อมูล',
	consentHeading: 'ความยินยอมเรื่องข้อมูล (มีผลกับทุกคนในการลงทะเบียนนี้)',
	main: {
		short: 'เข้าใจและยอมรับข้อตกลงและนโยบายความเป็นส่วนตัว',
		full: 'ข้าพเจ้ายินยอมให้ระบบเก็บรวบรวม ใช้ และเปิดเผยข้อมูลส่วนบุคคลของข้าพเจ้าและสมาชิกทุกคนที่ลงทะเบียนร่วมในครั้งนี้ เพื่อการลงทะเบียน การจัดสรรความช่วยเหลือ การรวมญาติ และการประสานงานกับหน่วยงานที่เกี่ยวข้อง'
	},
	health: {
		short: 'ให้เก็บข้อมูลสุขภาพ เพื่อประโยชน์ของผู้เข้าพักและส่งต่อการรักษา',
		full: 'ข้าพเจ้ายินยอมโดยชัดแจ้งให้เก็บรวบรวมและใช้ข้อมูลสุขภาพ เพื่อการดูแลกลุ่มเปราะบางและการส่งต่อการรักษาพยาบาล'
	},
	search: {
		short: 'อนุญาตให้ค้นหาชื่อและศูนย์ที่ท่านเข้าพักได้',
		full: 'ข้าพเจ้ายินยอมให้แสดงชื่อและศูนย์พักพิงที่ข้าพเจ้าพักอยู่ในระบบค้นหาญาติ เพื่อให้ญาติหรือผู้ติดต่อตามตัวได้'
	},
	verbal: {
		text: 'เจ้าหน้าที่อ่านข้อความให้ผู้ลงทะเบียนฟัง และบันทึกตามที่ตอบด้วยวาจา',
		staffLabel: 'เจ้าหน้าที่ผู้บันทึก'
	},
	showFull: 'ดูข้อความเต็ม',
	hideFull: 'ย่อ',
	healthDiscardWarning: 'ข้อมูลสุขภาพที่กรอกไว้จะไม่ถูกบันทึก',
	needMain: 'กรุณายอมรับข้อแรกก่อนบันทึก',
	actions: {
		confirm: 'ยืนยัน'
	},
	result: {
		title: 'บันทึกความยินยอมแล้ว',
		withdrawNote: 'ท่านถอนหรือเปลี่ยนความยินยอมได้ทุกเมื่อที่จุดลงทะเบียนของศูนย์'
	},
	summary: {
		mode: 'รูปแบบการลงทะเบียน',
		modeFull: 'บริการเต็มรูปแบบ',
		modeBasic: 'ช่วยเหลือขั้นพื้นฐาน',
		general: 'ข้อมูลทั่วไปและการประสานงาน',
		health: 'ข้อมูลสุขภาพ',
		search: 'แสดงในระบบค้นหาญาติ',
		verbal: 'บันทึกโดยเจ้าหน้าที่',
		time: 'เวลาที่บันทึก',
		ref: 'เลขอ้างอิงความยินยอม',
		yes: 'ยินยอม',
		no: 'ไม่ยินยอม',
		timeSuffix: 'น.'
	}
} as const;

type Widen<T> = { -readonly [K in keyof T]: T[K] extends string ? string : Widen<T[K]> };
export type ConsentCopy = Widen<typeof CONSENT_COPY>;

const CONSENT_COPY_EN: ConsentCopy = {
	heading: 'Terms and Privacy Policy',
	intro: {
		before: 'Read the ',
		term: 'Terms of Use',
		and: ' and ',
		policy: 'Privacy Policy',
		after: ', then press "Accept all" or choose only the items you agree to.',
		kiosk: 'Press "Accept all" or choose only the items you agree to.'
	},
	acceptAll: 'Accept all',
	acknowledgementHeading: 'Please acknowledge before submitting',
	consentHeading: 'Data consent (applies to everyone in this registration)',
	main: {
		short: 'I understand and accept the Terms and Privacy Policy',
		full: 'I consent to the system collecting, using and disclosing the personal data of myself and every member registered with me in this registration, for registration, allocation of assistance, family reunification and coordination with relevant agencies.'
	},
	health: {
		short: 'Allow health data to be collected, for the care of residents and medical referrals',
		full: 'I explicitly consent to the collection and use of health data for the care of vulnerable groups and for medical referrals.'
	},
	search: {
		short: 'Allow my name and shelter to be found in search',
		full: 'I consent to my name and the shelter where I am staying being shown in the family search system, so relatives or contacts can find me.'
	},
	verbal: {
		text: 'Staff read the notice aloud to the registrant and recorded the verbal answers.',
		staffLabel: 'Recorded by'
	},
	showFull: 'Show full text',
	hideFull: 'Collapse',
	healthDiscardWarning: 'The health information you entered will not be saved.',
	needMain: 'Please accept the first item before saving.',
	actions: {
		confirm: 'Confirm'
	},
	result: {
		title: 'Consent recorded',
		withdrawNote:
			'You can withdraw or change your consent at any time at the shelter registration desk.'
	},
	summary: {
		mode: 'Registration type',
		modeFull: 'Full service',
		modeBasic: 'Basic assistance',
		general: 'General data and coordination',
		health: 'Health data',
		search: 'Shown in family search',
		verbal: 'Recorded by staff',
		time: 'Recorded at',
		ref: 'Consent reference',
		yes: 'Consented',
		no: 'Not consented',
		timeSuffix: ''
	}
};

export const CONSENT_BLOCK_I18N: { th: ConsentCopy; en: ConsentCopy } = {
	th: CONSENT_COPY,
	en: CONSENT_COPY_EN
};
