const th = {
	title: 'เลือกรายการจากคิวกลาง',
	registeredAt: 'ลงทะเบียนเมื่อ',
	openMembers: 'สมาชิกที่ยัง open',
	selectAria: (name: string) => `เลือก ${name}`,
	openPets: 'สัตว์เลี้ยงที่ยัง open',
	selectedPrefix: 'เลือกแล้ว',
	unitPeople: 'คน',
	unitPets: 'สัตว์',
	unselectedRemain: 'ที่ไม่ติ๊กยังคง open ในคิวกลาง',
	reviewButton: 'ตรวจสอบรายละเอียด →'
};

const en: typeof th = {
	title: 'Select entries from the central queue',
	registeredAt: 'Registered',
	openMembers: 'Members still open',
	selectAria: (name: string) => `Select ${name}`,
	openPets: 'Pets still open',
	selectedPrefix: 'Selected',
	unitPeople: 'people',
	unitPets: 'pets',
	unselectedRemain: 'unchecked entries stay open in the central queue',
	reviewButton: 'Review details →'
};

export const CLAIM_DIALOG_I18N = { th, en };
