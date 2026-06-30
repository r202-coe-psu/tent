import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async ({ params }) => {
	const { id } = params;

	// Mocking detailed shelter response specifically for the detailed page
	// ⚠️ Security/PII Fix: Not exposing real staff names/phones.
	
	const mockDetailedShelter = {
		id: id || 'S001',
		name: 'ศูนย์พักพิง เทศบาลนครหาดใหญ่ (โรงเรียนเทศบาล 2)',
		status: 'OPEN', // เปิดรับผู้อพยพ
		admin_type: 'ศูนย์บริหารส่วนท้องถิ่น',
		address: 'อปท. เทศบาลนครหาดใหญ่, สงขลา',
		capacity: {
			total: 250,
			available: 247
		},
		occupancy_rate: 1, // 1%
		building_status: 'อาคารปิด (ในร่ม)',
		geo: { lat: 7.0094, lng: 100.4735 }, // for google maps
		admission_policy: {
			pets: 'อนุญาต: สุนัขพันธุ์เล็ก, แมว (ต้องมีกรง)',
			vulnerable_groups: ['ผู้สูงอายุ', 'ผู้ใช้วีลแชร์', 'ผู้ป่วยติดเตียงระดับต้น']
		},
		travel: {
			route: 'ถนนลาดยาง 4 เลน เข้าออกสะดวก',
			altitude: '5 เมตร',
			flood_warning: 'ไม่มีปัญหาน้ำท่วมขัง'
		},
		facilities: {
			hygiene: {
				male: 15,
				female: 20,
				accessible: 3,
				shower: 10,
				mobile_toilet: 0
			},
			power: 'การไฟฟ้า',
			water: 'การประปา',
			comms: ['สัญญาณมือถือ', 'VHF'],
			kitchen: 'โรงครัวกลาง',
			parking: '100 คัน'
		},
		contact: {
			// ⚠️ FIX: Used generic EOC roles & hotlines instead of personal manager details
			manager: 'ส่วนกลางประสานงาน (EOC)',
			phone: '1669 / 1784'
		},
		faq: [
			{
				q: 'ขั้นตอนสมัครเปิดบ้านตัวเองเป็น \'บ้านพี่เลี้ยง\' ทำอย่างไร มีค่าตอบแทนไหม?',
				a: 'ผู้ที่มีพื้นที่จอดรถ พักพิง หรือมีห้องนอนประสงค์ว่างปลอดประภัย สามารถรับความจำนงผ่านระบบ \'ลงทะเบียนบ้านพี่เลี้ยง\' บนหน้าเว็บ ตัวแทนอาสาสมัคร EOC จะเข้าไปตรวจสอบมาตรฐานภัยพิบัติเพื่อทำการอนุมัติเปิดหมุดแผนที่ โดยไม่มีการเก็บค่าบริการแต่อย่างใดเพื่อร่วมสาธารณกุศลช่วยเหลือเกื้อกูลกัน'
			},
			{
				q: 'ศูนย์ผู้ประสบภัย SmartShelter มีระบบป้องกันความปลอดภัยของข้อมูลประชาชนอย่างไร?',
				a: 'ระบบ SmartShelter จัดเก็บข้อมูลตามมาตรฐาน PDPA พร้อมกับการจำกัดสิทธิ์การเข้าถึงแบบ Role-Based Access Control เพื่อให้มั่นใจว่าข้อมูลของคุณจะไม่ถูกเผยแพร่หรือรั่วไหล'
			},
			{
				q: 'สัตว์เลี้ยง เสบียงอาหารพิเศษ และวิทยุอุปกรณ์สื่อสารเคลื่อนย้ายมีแจกจ่ายเพิ่มที่พิกัดใด?',
				a: 'สอบถามจุดแจกจ่ายได้ที่เต็นท์อำนวยการหน้าศูนย์ หรือติดตามผ่านบอร์ดประกาศประชาสัมพันธ์ประจำวัน'
			},
			{
				q: 'นำสัตว์เลี้ยงมาได้ไหม?',
				a: 'ได้เฉพาะ สุนัขพันธุ์เล็ก, แมว (ต้องมีกรง) กรุณานำกรง/สายจูงมาด้วย'
			},
			{
				q: 'ที่จอดรถมีเพียงพอไหม?',
				a: 'มีลานจอดรองรับได้ประมาณ 100 คัน ขอความร่วมมือจอดอย่างเป็นระเบียบ'
			},
			{
				q: 'รถเล็กเข้าถึงได้ไหม?',
				a: 'เข้าได้ ทางเข้ามีลักษณะ ถนนลาดยาง 4 เลน เข้าออกสะดวก ปลอดภัยจากระดับน้ำท่วมด้วยการยกระดับ 5 เมตร'
			}
		]
	};

	return json({
		shelter: mockDetailedShelter
	});
};
