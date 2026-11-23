const th = {
	reasonLabel: 'เหตุผล',
	other: 'อื่นๆ',
	detailLabel: 'รายละเอียดเพิ่มเติม',
	optional: '(ไม่บังคับ)',
	detailPlaceholder: 'เช่น ที่อยู่ปลายทาง หรือชื่อสถานพยาบาล',
	choiceRequired: 'กรุณาเลือกเหตุผล 1 ข้อ',
	detailRequired: 'กรุณาระบุรายละเอียดเมื่อเลือก "อื่นๆ"'
};

const en: typeof th = {
	reasonLabel: 'Reason',
	other: 'Other',
	detailLabel: 'More details',
	optional: '(optional)',
	detailPlaceholder: 'e.g. destination address or facility name',
	choiceRequired: 'Pick one reason',
	detailRequired: 'Add details when you pick "Other"'
};

export const CHECKOUT_REASON_I18N = { th, en };
