const th = {
	personalCard: {
		title: 'ข้อมูลส่วนบุคคล',
		editAria: 'แก้ไขข้อมูลส่วนบุคคล',
		fullName: 'ชื่อ - นามสกุล',
		nickname: 'ชื่อเล่น',
		idDocument: 'เอกสารยืนยันตัวตน',
		documentNumber: 'เลขที่เอกสาร',
		gender: 'เพศ',
		age: 'อายุ',
		birthYear: 'ปีเกิด',
		nationality: 'สัญชาติ',
		religion: 'ศาสนา',
		phone: 'เบอร์โทรศัพท์',
		unspecified: 'ไม่ระบุ',
		noPhone: 'ไม่มีเบอร์ติดต่อ',
		ageYears: (years: number) => `${years} ปี`,
		beYear: (year: number) => `พ.ศ. ${year}`,
		documents: {
			national_id: 'บัตรประชาชน',
			passport: 'หนังสือเดินทาง',
			pink_card: 'บัตรชมพู',
			other: 'เอกสารอื่นๆ',
			anonymous: 'บัตรไม่ระบุตัวตน'
		} as Record<string, string>,
		religions: {
			buddhist: 'พุทธ',
			muslim: 'อิสลาม',
			christian: 'คริสต์',
			other: 'อื่นๆ'
		} as Record<string, string>
	},
	assetsCard: {
		title: 'สิ่งที่นำมาด้วย',
		editAria: 'แก้ไขทรัพย์สิน ยานพาหนะ และสัตว์เลี้ยง',
		noHousehold: 'ยังไม่มีข้อมูลครัวเรือนสำหรับแสดงทรัพย์สิน',
		noItems: 'ไม่มีรายการ',
		vehicles: 'ยานพาหนะ',
		licensePlate: (plate: string) => `ทะเบียน: ${plate}`,
		pets: 'สัตว์เลี้ยง',
		hasCage: 'มีกรง',
		valuables: 'สัมภาระ / สิ่งของมีค่า',
		vehicleTypes: {
			car: 'รถยนต์',
			motorcycle: 'จักรยานยนต์',
			other: 'อื่นๆ'
		} as Record<string, string>
	},
	emergencyCard: {
		title: 'ข้อมูลติดต่อฉุกเฉิน',
		editAria: 'แก้ไขข้อมูลติดต่อฉุกเฉิน',
		contactName: 'ญาติ / ผู้ติดต่อ:',
		contactPhone: 'เบอร์โทรศัพท์ฉุกเฉิน:',
		relation: 'ความสัมพันธ์:',
		noContactName: 'ไม่ระบุบุคคล',
		noPhone: 'ไม่ระบุ'
	}
};

const en: typeof th = {
	personalCard: {
		title: 'Personal information',
		editAria: 'Edit personal information',
		fullName: 'Full name',
		nickname: 'Nickname',
		idDocument: 'ID document',
		documentNumber: 'Document number',
		gender: 'Gender',
		age: 'Age',
		birthYear: 'Year of birth',
		nationality: 'Nationality',
		religion: 'Religion',
		phone: 'Phone number',
		unspecified: 'Not specified',
		noPhone: 'No contact number',
		ageYears: (years: number) => `${years} yrs`,
		beYear: (year: number) => `C.E. ${year - 543}`,
		documents: {
			national_id: 'National ID card',
			passport: 'Passport',
			pink_card: 'Pink card',
			other: 'Other document',
			anonymous: 'Anonymous ID card'
		},
		religions: {
			buddhist: 'Buddhist',
			muslim: 'Muslim',
			christian: 'Christian',
			other: 'Other'
		}
	},
	assetsCard: {
		title: 'Belongings brought',
		editAria: 'Edit belongings, vehicles and pets',
		noHousehold: 'No household data to show belongings for yet',
		noItems: 'No items',
		vehicles: 'Vehicles',
		licensePlate: (plate: string) => `Plate: ${plate}`,
		pets: 'Pets',
		hasCage: 'Has a cage',
		valuables: 'Luggage / valuables',
		vehicleTypes: {
			car: 'Car',
			motorcycle: 'Motorcycle',
			other: 'Other'
		}
	},
	emergencyCard: {
		title: 'Emergency contact',
		editAria: 'Edit emergency contact',
		contactName: 'Relative / contact person:',
		contactPhone: 'Emergency phone number:',
		relation: 'Relationship:',
		noContactName: 'No contact person specified',
		noPhone: 'Not specified'
	}
};

export const EVACUEE_PROFILE_I18N = { th, en };
