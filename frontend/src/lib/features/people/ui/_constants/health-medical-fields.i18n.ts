const th = {
	careTrackLabel: 'แนวทางดูแล (Care Track)',
	careTrackNormalLabel: 'ดูแลตามปกติ (Normal)',
	careTrackNormalDesc: 'ไม่มีภาวะเร่งด่วน จัดกลุ่มการดูแลตามปกติ',
	careTrackFastLabel: 'Fast track',
	careTrackFastDesc: 'มีภาวะเร่งด่วนหรือต้องการการติดตามอย่างใกล้ชิด',
	conditionsLabel: 'โรคประจำตัว',
	conditionsPlaceholder: 'เลือกหรือพิมพ์ เช่น เบาหวาน, โรคหัวใจ',
	conditionsSearch: 'ค้นหาโรคประจำตัว...',
	conditionsListLabel: 'โรคประจำตัวที่เลือก',
	medicationsLabel: 'ยาที่ใช้ประจำ',
	medicationsPlaceholder: 'เช่น ยาลดความดัน, อินซูลิน',
	allergiesLabel: 'ประวัติการแพ้',
	allergiesPlaceholder: 'เลือกหรือพิมพ์ เช่น อาหารทะเล, เพนิซิลลิน',
	allergiesSearch: 'ค้นหาสิ่งที่แพ้...',
	generalSymptomsLabel: 'อาการและข้อสังเกต',
	generalSymptomsPlaceholder:
		'กรอกอาการทั่วไป เช่น ปวดศีรษะ เวียนศีรษะ ปวดเมื่อยตัว อ่อนเพลีย บาดแผล ฯลฯ (เว้นว่างได้ถ้าไม่มีอาการ)'
};

const en: typeof th = {
	careTrackLabel: 'Care Track',
	careTrackNormalLabel: 'Normal care',
	careTrackNormalDesc: 'No urgent condition; standard care grouping',
	careTrackFastLabel: 'Fast track',
	careTrackFastDesc: 'Urgent condition or needs close monitoring',
	conditionsLabel: 'Chronic conditions',
	conditionsPlaceholder: 'Select or type, e.g. diabetes, heart disease',
	conditionsSearch: 'Search chronic conditions...',
	conditionsListLabel: 'Selected chronic conditions',
	medicationsLabel: 'Regular medications',
	medicationsPlaceholder: 'e.g. antihypertensives, insulin',
	allergiesLabel: 'Allergies',
	allergiesPlaceholder: 'Select or type, e.g. seafood, penicillin',
	allergiesSearch: 'Search allergens...',
	generalSymptomsLabel: 'Symptoms and observations',
	generalSymptomsPlaceholder:
		'Enter general symptoms, e.g. headache, dizziness, body aches, fatigue, wounds (leave blank if none)'
};

export const HEALTH_MEDICAL_FIELDS_I18N = { th, en };
