/**
 * Language-picker strings. Bilingual on purpose: the picker (and the top-bar button that opens it)
 * must read in both languages at once, whatever language is currently selected.
 */
export const KIOSK_LANGUAGE_I18N = {
	heading: 'เลือกภาษา',
	subheading: 'Choose your language',
	thai: { title: 'ภาษาไทย', hint: 'แตะเพื่อเริ่มลงทะเบียน', flagLabel: 'Thai flag' },
	english: { title: 'English', hint: 'Tap to start registration', flagLabel: 'UK flag' },
	helpTh: 'ไม่มีบัตรประชาชนไทย หรือต้องการความช่วยเหลือ? ติดต่อเจ้าหน้าที่ Station 1',
	helpEn: 'No Thai ID or need help? Please go to staff at Station 1',
	shellButton: { label: 'ภาษา / Language', ariaLabel: 'เปลี่ยนภาษา / Change language' }
} as const;
