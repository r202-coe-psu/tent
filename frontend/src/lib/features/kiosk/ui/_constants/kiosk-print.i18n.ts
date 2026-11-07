/** Print status and the print-QR chooser. Printed label content is not here: printouts stay Thai. */
const th = {
	status: {
		printingTitle: 'กำลังพิมพ์ QR Code',
		printingBody: (count: number) => `${count} ดวง · กรุณารอรับที่ช่องพิมพ์`,
		doneTitle: 'พิมพ์เสร็จแล้ว',
		doneBody: (count: number) => `รับ QR Code ${count} ดวงที่ช่องพิมพ์`
	},
	chooser: {
		pageTitle: 'พิมพ์ QR — SmartShelter Kiosk',
		heading: 'พิมพ์ QR',
		subheading: 'เลือกประเภทผู้ที่ต้องการพิมพ์',
		groupLabel: 'ประเภทผู้ที่ต้องการพิมพ์ QR',
		evacuee: { title: 'ผู้พักพิง', description: 'ผู้ที่ลงทะเบียนเข้าพักในศูนย์' },
		volunteer: { title: 'จิตอาสา', description: 'พิมพ์บัตร QR จิตอาสาด้วยเบอร์โทร' }
	}
};

const en: typeof th = {
	status: {
		printingTitle: 'Printing your QR Code',
		printingBody: (count: number) =>
			`${count} ${count === 1 ? 'label' : 'labels'} · please wait at the print slot`,
		doneTitle: 'Printing finished',
		doneBody: (count: number) =>
			`Take your ${count} QR Code ${count === 1 ? 'label' : 'labels'} at the print slot`
	},
	chooser: {
		pageTitle: 'Print QR — SmartShelter Kiosk',
		heading: 'Print QR',
		subheading: 'Choose who the QR is for',
		groupLabel: 'Who to print a QR for',
		evacuee: { title: 'Shelter resident', description: 'People registered to stay at the shelter' },
		volunteer: { title: 'Volunteer', description: 'Print a volunteer QR card with a phone number' }
	}
};

export const KIOSK_PRINT_I18N = { th, en };
