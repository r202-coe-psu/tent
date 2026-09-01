export const HOUSEHOLD_REGISTER_I18N = {
	th: {
		tabs: {
			person: 'ค้นหาด้วยบุคคล',
			address: 'ค้นหาด้วยที่อยู่'
		},
		personSearch: {
			label: 'เบอร์โทรศัพท์ หรือ เลขบัตรประจำตัวประชาชน',
			placeholder: '089-999-9999',
			btnSearch: 'ค้นหาครอบครัว',
			btnNew: 'ลงทะเบียนเป็นครอบครัวใหม่'
		},
		addressSearch: {
			addressNoLabel: 'บ้านเลขที่ / ซอย / ถนน',
			addressNoPlaceholder: 'พิมพ์ตัวเลขนำหน้า เช่น 12/3 หรือ 45',
			locationLabel: 'ค้นหา ตำบล / อำเภอ / รหัสไปรษณีย์',
			locationPlaceholder: 'พิมพ์เพื่อค้นหา เช่น บ้านพรุ หรือ 90250',
			locationLoading: 'กำลังโหลดข้อมูลที่อยู่...',
			btnSearch: 'ค้นหาครอบครัวจากที่อยู่ (Fuzzy Match)',
			errorLoading:
				'โหลดรายการที่อยู่ไม่สำเร็จ กรุณาลองใหม่ หรือกรอกที่อยู่เองตอนสร้างครอบครัวใหม่',
			toastError: 'โหลดรายการที่อยู่ไม่สำเร็จ — ค้นหาด้วยที่อยู่ยังใช้ไม่ได้ชั่วคราว',
			retry: 'ลองใหม่'
		},
		results: {
			foundCount: (count: number) => `🏡 พบ ${count} ครอบครัวที่ลงทะเบียนในระบบ`,
			headLabel: 'หัวหน้าครอบครัว:',
			memberCount: (count: number) => `${count} คน (กดดูรายชื่อเพิ่มเติม)`,
			addressLabel: 'ที่อยู่:',
			btnJoin: 'เลือกร่วมครอบครัวนี้',
			btnJoined: 'เข้าร่วมแล้ว',
			membersTitle: 'รายชื่อสมาชิกในครอบครัว:',
			noOtherMembers: 'ยังไม่มีสมาชิกอื่นในครอบครัวนี้',
			noId: 'ไม่มีข้อมูลระบุตัวตน',
			btnSeparateNew: 'หรือ ต้องการลงทะเบียนแยกเป็นครอบครัวใหม่ในที่อยู่นี้',
			selectedTitle: 'เลือกเข้าร่วมครอบครัว:',
			selectedNote: 'ผู้ประสบภัยรายนี้จะถูกเพิ่มเข้าไปในครอบครัวข้างต้น',
			btnCancelSelect: 'ยกเลิกการเลือก'
		},
		newForm: {
			title: 'ข้อมูลที่อยู่ครอบครัวใหม่',
			addressNoLabel: 'บ้านเลขที่',
			addressNoPlaceholder: 'เช่น 123/45',
			villageNoLabel: 'หมู่ที่ (ถ้ามี)',
			villageNoPlaceholder: 'เช่น 5',
			provinceLabel: 'จังหวัด',
			provinceSelect: '— เลือกจังหวัด —',
			provinceSearch: 'ค้นหาจังหวัด...',
			provinceEmpty: 'ไม่พบจังหวัด',
			districtLabel: 'อำเภอ / เขต',
			districtSelect: '— เลือกอำเภอ —',
			districtSearch: 'ค้นหาอำเภอ...',
			districtEmpty: 'ไม่พบอำเภอ',
			subdistrictLabel: 'ตำบล / แขวง',
			subdistrictSelect: '— เลือกตำบล —',
			subdistrictSearch: 'ค้นหาตำบล...',
			subdistrictEmpty: 'ไม่พบตำบล',
			postalCodeLabel: 'รหัสไปรษณีย์',
			postalCodePlaceholder: 'เช่น 10110',
			loading: 'กำลังโหลด...',
			btnSave: 'บันทึกข้อมูลครอบครัวใหม่',
			btnCancel: 'ยกเลิก'
		},
		notFound: {
			title: 'ไม่พบข้อมูลครอบครัวในระบบ',
			desc: 'ไม่พบครอบครัวที่ตรงกับเงื่อนไขการค้นหา คุณสามารถลงทะเบียนเป็นครอบครัวใหม่ได้',
			btnNew: 'ลงทะเบียนเป็นครอบครัวใหม่'
		},
		cardSuggested: {
			title: 'พบครัวเรือนเดิมที่มีที่อยู่ตรงกับบัตรประชาชน (Smart Card)',
			desc: 'โปรดสอบถามยืนยันกับผู้ประสบภัยว่าอาศัยอยู่ร่วมกับครัวเรือนนี้หรือไม่ หากใช่ให้กดปุ่ม "เลือกร่วมครอบครัวนี้" หรือหากเป็นคนละครอบครัว/แยกบ้าน ให้กดปุ่มด้านล่าง',
			btnSeparate: 'ไม่ใช่ / ลงทะเบียนแยกเป็นครอบครัวใหม่'
		}
	},
	en: {
		tabs: {
			person: 'Search by Person',
			address: 'Search by Address'
		},
		personSearch: {
			label: 'Phone Number or Thai National ID',
			placeholder: '089-999-9999',
			btnSearch: 'Search Household',
			btnNew: 'Register as New Household'
		},
		addressSearch: {
			addressNoLabel: 'House No. / Soi / Road',
			addressNoPlaceholder: 'e.g. 12/3 or 45',
			locationLabel: 'Search Subdistrict / District / Postal Code',
			locationPlaceholder: 'Search e.g. Ban Phru or 90250',
			locationLoading: 'Loading address data...',
			btnSearch: 'Search Household by Address (Fuzzy Match)',
			errorLoading: 'Failed to load address list. Please retry or enter address manually.',
			toastError: 'Failed to load address list — Address search is temporarily unavailable',
			retry: 'Retry'
		},
		results: {
			foundCount: (count: number) => `🏡 Found ${count} registered household(s)`,
			headLabel: 'Head of Household:',
			memberCount: (count: number) => `${count} person(s) (click to view details)`,
			addressLabel: 'Address:',
			btnJoin: 'Join this Household',
			btnJoined: 'Joined',
			membersTitle: 'Household Members:',
			noOtherMembers: 'No other members in this household yet',
			noId: 'No identification data',
			btnSeparateNew: 'Or register as a separate new household at this address',
			selectedTitle: 'Selected Household to Join:',
			selectedNote: 'This evacuee will be linked to the selected household above',
			btnCancelSelect: 'Cancel Selection'
		},
		newForm: {
			title: 'New Household Address Information',
			addressNoLabel: 'House No.',
			addressNoPlaceholder: 'e.g. 123/45',
			villageNoLabel: 'Village No. (if any)',
			villageNoPlaceholder: 'e.g. 5',
			provinceLabel: 'Province',
			provinceSelect: '— Select Province —',
			provinceSearch: 'Search province...',
			provinceEmpty: 'No province found',
			districtLabel: 'District',
			districtSelect: '— Select District —',
			districtSearch: 'Search district...',
			districtEmpty: 'No district found',
			subdistrictLabel: 'Subdistrict',
			subdistrictSelect: '— Select Subdistrict —',
			subdistrictSearch: 'Search subdistrict...',
			subdistrictEmpty: 'No subdistrict found',
			postalCodeLabel: 'Postal Code',
			postalCodePlaceholder: 'e.g. 10110',
			loading: 'Loading...',
			btnSave: 'Save New Household',
			btnCancel: 'Cancel'
		},
		notFound: {
			title: 'No Household Found',
			desc: 'No matching household found with the given criteria. You can register as a new household.',
			btnNew: 'Register as New Household'
		},
		cardSuggested: {
			title: 'Found existing household matching Smart Card address',
			desc: 'Please confirm with the evacuee if they reside with this household. If yes, click "Join this Household", or click the button below to register a separate new household.',
			btnSeparate: 'No / Register as New Household'
		}
	}
} as const;

export type HouseholdRegisterI18n = typeof HOUSEHOLD_REGISTER_I18N;
