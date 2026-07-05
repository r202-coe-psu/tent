import type { SopRatioKey } from './sop-ratio';

export const RATIO_LABELS: Record<
	SopRatioKey,
	{ label: string; unit: string; description: string }
> = {
	water_l_per_person_day: {
		label: 'น้ำ (รวม)',
		unit: 'ลิตร/คน/วัน',
		description: 'ปริมาณน้ำรวมต่อคนต่อวัน (Sphere: 15L)'
	},
	drinking_water_l_per_person_day: {
		label: 'น้ำดื่ม',
		unit: 'ลิตร/คน/วัน',
		description: 'ปริมาณน้ำดื่มเพื่อการบริโภค (Sphere: 2.5-3L)'
	},
	cooking_water_l_per_person_day: {
		label: 'น้ำสำหรับทำอาหาร',
		unit: 'ลิตร/คน/วัน',
		description: 'ปริมาณน้ำสำหรับประกอบอาหาร (Sphere: 2-3L)'
	},
	hygiene_water_l_per_person_day: {
		label: 'น้ำสำหรับสุขอนามัย',
		unit: 'ลิตร/คน/วัน',
		description: 'ปริมาณน้ำสำหรับชำระล้างและซักผ้า (Sphere: 6-7L)'
	},
	kcal_per_adult_day: {
		label: 'พลังงาน',
		unit: 'kcal/คน/วัน',
		description: 'พลังงานที่ต้องการต่อวัน (Sphere: 2100 kcal)'
	},
	people_per_tap: {
		label: 'ก๊อกน้ำ',
		unit: 'คน/จุด',
		description: 'อัตราส่วนคนต่อก๊อกน้ำ (Sphere: 250 คน/จุด)'
	},
	people_per_handpump: {
		label: 'ปั๊มน้ำมือโยก',
		unit: 'คน/จุด',
		description: 'อัตราส่วนคนต่อปั๊มน้ำมือโยก (Sphere: 500 คน/จุด)'
	},
	people_per_open_well: {
		label: 'บ่อน้ำเปิด',
		unit: 'คน/จุด',
		description: 'อัตราส่วนคนต่อบ่อน้ำเปิด (Sphere: 400 คน/จุด)'
	},
	people_per_laundry: {
		label: 'จุดซักล้าง',
		unit: 'คน/จุด',
		description: 'อัตราส่วนคนต่อจุดซักล้าง (Sphere: 100 คน/จุด)'
	},
	people_per_bathing: {
		label: 'ห้องอาบน้ำ',
		unit: 'คน/ห้อง',
		description: 'อัตราส่วนคนต่อห้องอาบน้ำ (Sphere: 50 คน/ห้อง)'
	},
	people_per_toilet_female: {
		label: 'ห้องน้ำหญิง',
		unit: 'คน/ห้อง',
		description: 'อัตราส่วนหญิงต่อห้องน้ำ (Sphere: 20 คน/ห้อง)'
	},
	people_per_toilet_male: {
		label: 'ห้องน้ำชาย',
		unit: 'คน/ห้อง',
		description: 'อัตราส่วนชายต่อห้องน้ำ (Sphere: 35 คน/ห้อง)'
	},
	people_per_dining_point_adult: {
		label: 'จุดรับอาหารผู้ใหญ่',
		unit: 'คน/จุด',
		description: 'อัตราส่วนผู้ใหญ่ต่อจุดรับอาหาร'
	},
	people_per_dining_point_child: {
		label: 'จุดรับอาหารเด็ก',
		unit: 'คน/จุด',
		description: 'อัตราส่วนเด็กต่อจุดรับอาหาร'
	},
	m2_per_person_living: {
		label: 'พื้นที่พักพิง (ร้อน)',
		unit: 'ตร.ม./คน',
		description: 'พื้นที่พักพิงต่อคนสำหรับอากาศร้อน (Sphere: 3.5 ตร.ม.)'
	},
	m2_per_person_living_cold: {
		label: 'พื้นที่พักพิง (หนาว)',
		unit: 'ตร.ม./คน',
		description: 'พื้นที่พักพิงต่อคนสำหรับอากาศหนาว (Sphere: 4.5 ตร.ม.)'
	},
	m2_per_person_total: {
		label: 'พื้นที่รวม',
		unit: 'ตร.ม./คน',
		description: 'พื้นที่ค่ายรวมต่อคน (Sphere: 45 ตร.ม.)'
	},
	max_waterpoint_distance_m: {
		label: 'ระยะทางไปแหล่งน้ำ',
		unit: 'เมตร',
		description: 'ระยะทางสูงสุดไปแหล่งน้ำ (Sphere: 500 เมตร)'
	},
	max_queue_minutes: {
		label: 'เวลารอคิว',
		unit: 'นาที',
		description: 'เวลารอคิวสูงสุดที่แหล่งน้ำ (Sphere: 15 นาที)'
	},
	people_per_volunteer: {
		label: 'อาสาสมัคร',
		unit: 'คน/อาสา 1 คน',
		description: 'อัตราส่วนผู้พักพิงต่ออาสาสมัคร 1 คน'
	}
};
