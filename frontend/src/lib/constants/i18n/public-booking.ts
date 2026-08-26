export const PUBLIC_BOOKING_I18N = {
	th: {
		modalTitleTicket: 'ใบจองเข้าศูนย์พักพิง',
		modalTitleBook: 'จองเข้าศูนย์พักพิงล่วงหน้า',
		modalDescTicket: 'กรุณาบันทึกหรือพิมพ์ใบจองนี้ไว้แสดงที่ประตูศูนย์',
		modalDescBook:
			'กันที่ไว้ก่อนเดินทาง ลดเวลารอที่หน้าประตู และช่วยให้ศูนย์เตรียมอาหารและเครื่องนอนได้ตรงจำนวน',
		loadError: 'โหลดรายชื่อศูนย์พักพิงไม่สำเร็จ กรุณาลองใหม่อีกครั้ง',
		loadingShelters: 'กำลังโหลดรายชื่อศูนย์พักพิง…'
	},
	en: {
		modalTitleTicket: 'Shelter Booking Ticket',
		modalTitleBook: 'Advance Shelter Booking',
		modalDescTicket: 'Please save or print this ticket to present at the shelter entrance',
		modalDescBook:
			'Reserve a spot before traveling to reduce wait times and help the shelter prepare enough food and bedding',
		loadError: 'Failed to load shelters. Please try again.',
		loadingShelters: 'Loading shelters...'
	}
} as const;
