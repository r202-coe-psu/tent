export const EVACUEE_REGISTRATION_I18N = {
	th: {
		sections: {
			ewar: 'ประเมินอาการ (EWAR)',
			identity: 'ข้อมูลประจำตัว',
			medical: 'สุขภาพ',
			special: 'กลุ่มเปราะบาง'
		},
		photo: {
			header: 'ภาพถ่ายใบหน้า (Face Recognition)',
			label: 'ภาพถ่ายใบหน้า (Face Recognition)',
			add: 'เพิ่มรูปภาพ',
			desc: 'ใช้สำหรับระบบจดจำใบหน้าและค้นหาตัวตน',
			btnTake: 'ถ่ายภาพ',
			btnChange: 'เปลี่ยนรูปภาพ',
			btnDelete: 'ลบรูปภาพ',
			previewAlt: 'ภาพถ่ายใบหน้า',
			toastSuccess: 'อัปโหลดรูปภาพสำเร็จ',
			toastFailed: 'อัปโหลดรูปภาพล้มเหลว สามารถลงทะเบียนต่อได้โดยไม่มีรูป',
			uploadFailed: 'อัปโหลดรูปภาพล้มเหลว สามารถลงทะเบียนต่อได้โดยไม่มีรูป'
		},
		cardType: {
			label: 'ประเภทบัตร',
			selectPlaceholder: '— เลือก —',
			options: {
				national_id: 'เลขประจำตัวประชาชน (Thai National ID)',
				passport: 'หนังสือเดินทาง (Passport)',
				pink_card: 'บัตรประจำตัวคนซึ่งไม่มีสัญชาติไทย (Pink Card)',
				other: 'อื่นๆ (Other)'
			}
		},
		idNumber: {
			labels: {
				national_id: 'เลขประจำตัวประชาชน',
				passport: 'เลขที่พาสปอร์ต',
				pink_card: 'เลขประจำตัวคนซึ่งไม่มีสัญชาติไทย',
				other: 'เลขหมายบัตร'
			},
			placeholders: {
				national_id: 'X-XXXX-XXXXX-XX-X',
				passport: 'Passport Number',
				other: 'หมายเลขบัตร'
			}
		},
		personal: {
			header: 'ข้อมูลประจำตัว (Identity)',
			firstName: {
				label: 'ชื่อ',
				placeholder: 'ชื่อ'
			},
			lastName: {
				label: 'นามสกุล',
				placeholder: 'นามสกุล'
			},
			nickname: {
				label: 'ชื่อเล่น',
				placeholder: 'ชื่อเล่น (ถ้ามี)'
			},
			birthYear: {
				label: 'ปีเกิด (พ.ศ.)',
				placeholder: 'เช่น 2530'
			},
			age: {
				label: 'อายุ (ปี)'
			},
			gender: {
				label: 'เพศ',
				selectPlaceholder: '— เลือก —',
				options: {
					male: 'ชาย (Male)',
					female: 'หญิง (Female)',
					other: 'อื่นๆ (Other)'
				}
			},
			phone: {
				label: 'เบอร์โทรศัพท์ยืนยันตัวตน',
				placeholder: '08X-XXX-XXXX',
				noPhone: 'ไม่มีเบอร์โทร'
			},
			country: {
				label: 'ประเทศ',
				placeholder: 'เลือกประเทศ...',
				searchPlaceholder: 'ค้นหาประเทศ...',
				emptyText: 'ไม่พบประเทศ'
			},
			religion: {
				label: 'ศาสนา',
				selectPlaceholder: '— เลือก —',
				options: {
					buddhist: 'พุทธ (Buddhism)',
					muslim: 'อิสลาม (Islam)',
					christian: 'คริสต์ (Christianity)',
					other: 'อื่นๆ (Other)',
					unknown: 'ไม่ระบุ (Unknown)'
				}
			}
		},
		medical: {
			header: 'โรคประจำตัว & ข้อมูลสุขภาพ',
			fieldNoneLabel: 'ไม่มี',
			conditions: {
				label: 'โรคประจำตัว',
				placeholder: 'เช่น เบาหวาน, ความดัน'
			},
			medications: {
				label: 'ยาที่ใช้ประจำ',
				placeholder: 'เช่น ยาลดความดัน, ยาเบาหวาน'
			},
			allergies: {
				label: 'ประวัติการแพ้ (ยา/อาหาร)',
				placeholder: 'เช่น แพ้เพนิซิลลิน, อาหารทะเล, ถั่ว'
			}
		},
		specialNeeds: {
			label: 'แท็กกลุ่มเปราะบางและความต้องการพิเศษ',
			notVulnerableLabel: 'ไม่เป็นกลุ่มเปราะบาง',
			note: {
				label: 'ความต้องการพิเศษ (ถ้ามี)',
				placeholder: 'เช่น ผู้ป่วยที่ต้องรับยาเฉพาะทาง หรือต้องการการดูแลพิเศษ'
			}
		},
		emergencyContact: {
			header: 'ข้อมูลติดต่อฉุกเฉิน (Emergency Contact)',
			name: {
				label: 'ชื่อ-นามสกุล บุคคลติดต่อฉุกเฉิน',
				placeholder: 'ชื่อนามสกุล ญาติ/ผู้ใกล้ชิด'
			},
			phone: {
				label: 'เบอร์ติดต่อฉุกเฉิน',
				placeholder: '08X-XXX-XXXX'
			},
			defaultRelation: 'ญาติ/ผู้ใกล้ชิด'
		},
		sos: {
			title: 'ส่งต่อผู้ป่วยฉุกเฉิน',
			badge: '(SOS ESCALATE)',
			description: 'ระบบจะแจ้งเตือนไปยังแผนงควบคุมของผู้ว่าฯ และ รพ. สนามทันที'
		},
		actions: {
			next: 'ถัดไป →',
			back: 'ย้อนกลับ'
		},
		validation: {
			nationalIdLength: 'เลขประจำตัวประชาชนต้องมี 13 หลัก',
			phoneRequired: 'กรุณากรอกเบอร์โทรศัพท์ 10 หลัก หรือเลือก "ไม่มีเบอร์โทร"',
			emergencyPhoneLength: 'เบอร์ติดต่อฉุกเฉินต้องมี 10 หลัก',
			formIncomplete: 'กรุณากรอกข้อมูลให้ถูกต้องและครบถ้วน',
			summaryTitle: 'ยังมีข้อมูลที่ต้องกรอกหรือแก้ไข',
			birthYearNumeric: 'กรุณากรอกปีเกิดเป็นตัวเลข',
			birthYearFuture: 'ปีเกิด (พ.ศ.) ต้องไม่เป็นปีในอนาคต',
			birthYearMin: (minYear: number) => `ปีเกิด (พ.ศ.) ต้องมากกว่า ${minYear}`,
			ageNumeric: 'กรุณากรอกอายุเป็นตัวเลข',
			ageMax: (maxAge: number) => `อายุต้องไม่เกิน ${maxAge} ปี`
		}
	},
	en: {
		sections: {
			ewar: 'Symptom Assessment (EWAR)',
			identity: 'Identity',
			medical: 'Health',
			special: 'Vulnerable Groups'
		},
		photo: {
			header: 'Face Photo (Face Recognition)',
			label: 'Face Photo (Face Recognition)',
			add: 'Add Photo',
			desc: 'Used for face recognition and identity search',
			btnTake: 'Take Photo',
			btnChange: 'Change Photo',
			btnDelete: 'Delete Photo',
			previewAlt: 'Face photo',
			toastSuccess: 'Photo uploaded successfully',
			toastFailed: 'Photo upload failed. You can proceed without a photo.',
			uploadFailed: 'Photo upload failed. You can proceed without a photo.'
		},
		cardType: {
			label: 'Card Type',
			selectPlaceholder: '— Select —',
			options: {
				national_id: 'Thai National ID',
				passport: 'Passport',
				pink_card: 'Non-Thai ID Card (Pink Card)',
				other: 'Other'
			}
		},
		idNumber: {
			labels: {
				national_id: 'Thai National ID Number',
				passport: 'Passport Number',
				pink_card: 'Non-Thai ID Card Number',
				other: 'Card Number'
			},
			placeholders: {
				national_id: 'X-XXXX-XXXXX-XX-X',
				passport: 'Passport Number',
				other: 'Card Number'
			}
		},
		personal: {
			header: 'Personal Information (Identity)',
			firstName: {
				label: 'First Name',
				placeholder: 'First Name'
			},
			lastName: {
				label: 'Last Name',
				placeholder: 'Last Name'
			},
			nickname: {
				label: 'Nickname',
				placeholder: 'Nickname (optional)'
			},
			birthYear: {
				label: 'Birth Year (B.E.)',
				placeholder: 'e.g. 2530'
			},
			age: {
				label: 'Age (Years)'
			},
			gender: {
				label: 'Gender',
				selectPlaceholder: '— Select —',
				options: {
					male: 'Male',
					female: 'Female',
					other: 'Other'
				}
			},
			phone: {
				label: 'Phone Number',
				placeholder: '08X-XXX-XXXX',
				noPhone: 'No phone number'
			},
			country: {
				label: 'Country',
				placeholder: 'Select country...',
				searchPlaceholder: 'Search country...',
				emptyText: 'No country found'
			},
			religion: {
				label: 'Religion',
				selectPlaceholder: '— Select —',
				options: {
					buddhist: 'Buddhism',
					muslim: 'Islam',
					christian: 'Christianity',
					other: 'Other',
					unknown: 'Not Specified'
				}
			}
		},
		medical: {
			header: 'Medical Conditions & Health Information',
			fieldNoneLabel: 'None',
			conditions: {
				label: 'Medical Conditions',
				placeholder: 'e.g. Diabetes, Hypertension'
			},
			medications: {
				label: 'Current Medications',
				placeholder: 'e.g. Blood pressure medicine'
			},
			allergies: {
				label: 'Allergies (Medications / Food)',
				placeholder: 'e.g. Penicillin, Seafood, Nuts'
			}
		},
		specialNeeds: {
			label: 'Vulnerable Groups & Special Needs',
			notVulnerableLabel: 'Not a vulnerable group',
			note: {
				label: 'Special Needs Note (if any)',
				placeholder: 'e.g. Patients requiring specific medication or special care'
			}
		},
		emergencyContact: {
			header: 'Emergency Contact Information',
			name: {
				label: 'Emergency Contact Name',
				placeholder: 'Full name of relative / contact person'
			},
			phone: {
				label: 'Emergency Contact Phone',
				placeholder: '08X-XXX-XXXX'
			},
			defaultRelation: 'Relative / Close person'
		},
		sos: {
			title: 'Emergency Patient Escalation',
			badge: '(SOS ESCALATE)',
			description: 'The system will immediately notify the command center and field hospital'
		},
		actions: {
			next: 'Next →',
			back: 'Back'
		},
		validation: {
			nationalIdLength: 'Thai National ID must be 13 digits',
			phoneRequired: 'Please enter a 10-digit phone number or check "No phone number"',
			emergencyPhoneLength: 'Emergency contact phone must be 10 digits',
			formIncomplete: 'Please fill in all required fields accurately',
			summaryTitle: 'Some fields need to be completed or corrected',
			birthYearNumeric: 'Birth year must be a numeric value',
			birthYearFuture: 'Birth year (B.E.) cannot be in the future',
			birthYearMin: (minYear: number) => `Birth year (B.E.) must be greater than ${minYear}`,
			ageNumeric: 'Age must be a numeric value',
			ageMax: (maxAge: number) => `Age cannot exceed ${maxAge} years`
		}
	}
} as const;

export type EvacueeRegistrationI18n = typeof EVACUEE_REGISTRATION_I18N;
export type EvacueeRegistrationTranslations =
	EvacueeRegistrationI18n[keyof EvacueeRegistrationI18n];
