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
	}
};

export const EVACUEE_PROFILE_I18N = { th, en };
