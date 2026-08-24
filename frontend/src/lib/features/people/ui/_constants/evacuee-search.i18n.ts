export const EVACUEE_SEARCH_I18N = {
	th: {
		placeholder: 'เลขบัตรประชาชน / เบอร์โทร / ชื่อ-นามสกุล',
		btnNewRegister: 'ลงทะเบียนใหม่',
		btnRegisterInstead: 'ลงทะเบียนใหม่แทน',
		searching: 'กำลังค้นหา...',
		errorTitle: 'ค้นหาไม่สำเร็จ',
		errorDesc: 'เกิดข้อผิดพลาดในการค้นหา กรุณาลองใหม่อีกครั้ง',
		retry: 'ลองใหม่',
		foundTitle: (count: number) => `พบข้อมูลในระบบ ${count} ราย`,
		statusLabel: 'สถานะ:',
		statusLabels: {
			pre_registered: 'ลงทะเบียนล่วงหน้า (ยังไม่เช็คอิน)',
			active: 'เช็คอินเข้าพักแล้ว',
			temporary_leave: 'ออกชั่วคราว',
			transferred: 'ย้ายศูนย์พักพิงแล้ว',
			checked_out: 'ย้ายออก/กลับภูมิลำเนาแล้ว',
			deceased: 'เสียชีวิต',
			cancelled: 'ยกเลิกการลงทะเบียนล่วงหน้า'
		},
		btnViewEdit: 'ดู / แก้ไข',
		notFoundTitle: 'ไม่พบข้อมูลในระบบ',
		notFoundDesc: 'ผู้ประสบภัยรายนี้ยังไม่เคยลงทะเบียน กรุณาดำเนินการลงทะเบียนใหม่'
	},
	en: {
		placeholder: 'National ID / Phone / Full Name',
		btnNewRegister: 'New Registration',
		btnRegisterInstead: 'Register as New Instead',
		searching: 'Searching...',
		errorTitle: 'Search Failed',
		errorDesc: 'An error occurred while searching. Please try again.',
		retry: 'Retry',
		foundTitle: (count: number) => `Found ${count} record(s) in system`,
		statusLabel: 'Status:',
		statusLabels: {
			pre_registered: 'Pre-registered (Not Checked In)',
			active: 'Checked In',
			temporary_leave: 'Temporary Leave',
			transferred: 'Transferred',
			checked_out: 'Checked Out / Returned Home',
			deceased: 'Deceased',
			cancelled: 'Cancelled'
		},
		btnViewEdit: 'View / Edit',
		notFoundTitle: 'No Records Found',
		notFoundDesc:
			'This evacuee has not been registered yet. Please proceed with a new registration.'
	}
} as const;

export type EvacueeSearchI18n = typeof EVACUEE_SEARCH_I18N;
