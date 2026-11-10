/**
 * Language-picker strings. Bilingual on purpose: the picker (and the top-bar button that opens it)
 * must read in both languages at once, whatever language is currently selected.
 */
export const KIOSK_LANGUAGE_I18N = {
	heading: 'เลือกภาษา',
	subheading: 'Choose your language',
	thai: { title: 'ภาษาไทย', hint: 'แตะเพื่อเริ่ม' },
	english: { title: 'English', hint: 'Tap to start' },
	helpTh: 'ไม่มีบัตรประชาชนไทย หรือต้องการความช่วยเหลือ? ติดต่อเจ้าหน้าที่',
	helpEn: 'No Thai ID or need help? Please ask a staff member',
	shellButton: { label: 'ภาษา / Language', ariaLabel: 'เปลี่ยนภาษา / Change language' }
} as const;
