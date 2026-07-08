import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw } from '$lib/server/couch-admin';
import {
	migrateShelterV2ToCurrent,
	type ShelterMaster,
	type ShelterMasterV2
} from '$lib/features/shelters/server';

export const GET: RequestHandler = async ({ params, setHeaders }) => {
	// Cache the response for 60 seconds on the client and CDN to mitigate N+1 query load
	setHeaders({
		'Cache-Control': 'public, max-age=60, s-maxage=60'
	});
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
		geo: { lat: 7.009425, lng: 100.473531 }, // for google maps
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
				q: "ขั้นตอนสมัครเปิดบ้านตัวเองเป็น 'บ้านพี่เลี้ยง' ทำอย่างไร มีค่าตอบแทนไหม?",
				a: "ผู้ที่มีพื้นที่จอดรถ พักพิง หรือมีห้องนอนประสงค์ว่างปลอดประภัย สามารถรับความจำนงผ่านระบบ 'ลงทะเบียนบ้านพี่เลี้ยง' บนหน้าเว็บ ตัวแทนอาสาสมัคร EOC จะเข้าไปตรวจสอบมาตรฐานภัยพิบัติเพื่อทำการอนุมัติเปิดหมุดแผนที่ โดยไม่มีการเก็บค่าบริการแต่อย่างใดเพื่อร่วมสาธารณกุศลช่วยเหลือเกื้อกูลกัน"
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

	try {
		const res = await adminRaw(`/registry/${encodeURIComponent(id)}`, 'GET');
		if (res.status === 200 && res.data) {
			const m = migrateShelterV2ToCurrent(res.data as ShelterMasterV2 | ShelterMaster);

			let mappedStatus = 'CLOSED';
			if (m.operation_status === 'active') mappedStatus = 'OPEN';
			else if (m.operation_status === 'full_capacity') mappedStatus = 'FULL';
			else if (m.operation_status === 'standby') mappedStatus = 'PREPARE';

			// Real Occupancy
			let occupancy = 0;
			if (mappedStatus === 'OPEN' || mappedStatus === 'FULL') {
				try {
					const occRes = await adminRaw(
						`/shelter_${m.code.toLowerCase()}/_design/app/_view/occupancy?group=true`,
						'GET'
					);
					if (
						occRes.status === 200 &&
						occRes.data &&
						(occRes.data as Record<string, unknown>).rows
					) {
						const rows = (occRes.data as Record<string, unknown>).rows as Array<{
							key: string;
							value: unknown;
						}>;
						const checkedInRow = rows.find((r) => r.key === 'checked_in');
						if (checkedInRow) {
							occupancy = checkedInRow.value as number;
						}
					}
				} catch (err) {
					console.error(`Failed to fetch occupancy for shelter_${m.code.toLowerCase()}`, err);
				}
			}

			mockDetailedShelter.name = m.name;
			mockDetailedShelter.address = m.location?.address || mockDetailedShelter.address;
			mockDetailedShelter.status = mappedStatus;
			mockDetailedShelter.admin_type = m.shelter_type || 'ศูนย์พักพิง/อพยพ';
			mockDetailedShelter.building_status = m.area_type || 'อาคารปิด (ในร่ม)';

			if (m.location?.lat && m.location?.lng) {
				mockDetailedShelter.geo = {
					lat: m.location.lat,
					lng: m.location.lng
				};
			}

			mockDetailedShelter.capacity.total = m.capacity || mockDetailedShelter.capacity.total;
			mockDetailedShelter.capacity.available = Math.max(
				0,
				mockDetailedShelter.capacity.total - occupancy
			);
			mockDetailedShelter.occupancy_rate =
				mockDetailedShelter.capacity.total > 0
					? Math.round((occupancy / mockDetailedShelter.capacity.total) * 100)
					: 0;

			// Facilities mapping
			mockDetailedShelter.facilities.hygiene.male = m.facilities?.toilets_male || 0;
			mockDetailedShelter.facilities.hygiene.female = m.facilities?.toilets_female || 0;
			mockDetailedShelter.facilities.hygiene.accessible = m.facilities?.toilets_accessible || 0;
			mockDetailedShelter.facilities.hygiene.shower = m.facilities?.showers || 0;
			mockDetailedShelter.facilities.hygiene.mobile_toilet =
				m.facilities?.car_toilet_supported || 0;
			mockDetailedShelter.facilities.parking = (m.common_areas?.parking_capacity || 0) + ' คัน';
			mockDetailedShelter.facilities.kitchen = m.common_areas?.central_kitchen
				? 'โรงครัวกลาง'
				: 'ไม่มีโรงครัว';

			// Utilities
			mockDetailedShelter.facilities.power =
				m.utilities?.power_source === 'generator'
					? 'เครื่องปั่นไฟ'
					: m.utilities?.power_source === 'solar'
						? 'โซลาร์เซลล์'
						: 'การไฟฟ้า';
			mockDetailedShelter.facilities.water =
				m.utilities?.water_source === 'groundwater'
					? 'น้ำบาดาล'
					: m.utilities?.water_source === 'water_tank'
						? 'รถบรรทุกน้ำ'
						: 'การประปา';

			const commsMap: Record<string, string> = {
				cellular: 'สัญญาณมือถือ',
				wifi: 'Wi-Fi',
				vhf_radio: 'VHF'
			};
			if (m.utilities?.communications?.length) {
				mockDetailedShelter.facilities.comms = m.utilities.communications.map(
					(c) => commsMap[c] || c
				);
			}

			// Risk & Travel
			mockDetailedShelter.travel.altitude = m.risk?.elevation_m
				? m.risk.elevation_m + ' เมตร'
				: 'อยู่ระหว่างประเมินพื้นที่';
			mockDetailedShelter.travel.route =
				m.risk?.entrance_description || 'อยู่ระหว่างประเมินพื้นที่';
			mockDetailedShelter.travel.flood_warning = m.risk?.constraints || 'อยู่ระหว่างประเมินพื้นที่';

			// Admission Policy
			const vulnerableGroups = [...(m.admission_policy?.supported_vulnerable_groups || [])];
			if (vulnerableGroups.length === 0) {
				if (m.zones?.some((z) => z.type === 'vulnerable'))
					vulnerableGroups.push('กลุ่มเปราะบางทั่วไป');
				if (m.zones?.some((z) => z.type === 'quarantine'))
					vulnerableGroups.push('ผู้ป่วยแยกกักโรค');
				if ((m.facilities?.toilets_accessible ?? 0) > 0) vulnerableGroups.push('ผู้ใช้วีลแชร์');
			}
			mockDetailedShelter.admission_policy.vulnerable_groups =
				vulnerableGroups.length > 0 ? vulnerableGroups : ['ไม่มีโซนเฉพาะ'];

			let petStatus = 'ไม่อนุญาต';
			if (m.admission_policy?.pet_policy?.policy === 'conditional') {
				const cats = (m.admission_policy.pet_policy.categories || []).map(
					(c: { category: string }) => {
						if (c.category === 'small_general') return 'สัตว์เล็กทั่วไป';
						if (c.category === 'large_dog') return 'สุนัขพันธุ์ใหญ่';
						if (c.category === 'livestock') return 'ปศุสัตว์';
						return c.category;
					}
				);
				petStatus = `อนุญาตแบบมีเงื่อนไข (${cats.join(', ')})`;
			} else if (m.zones?.some((z) => z.type === 'pet')) {
				petStatus = 'อนุญาต (มีโซนสัตว์เลี้ยง)';
			}
			mockDetailedShelter.admission_policy.pets = petStatus;

			// Contact Info
			const eoc = m.key_personnel?.eoc_liaison;
			if (eoc?.name || eoc?.phone) {
				mockDetailedShelter.contact.manager = eoc?.name || 'เจ้าหน้าที่ประสานงาน (EOC)';
				mockDetailedShelter.contact.phone = eoc?.phone || '1669 / 1784';
			}

			// Dynamic FAQ
			const dynamicFaq = [];
			dynamicFaq.push({
				q: "ขั้นตอนสมัครเปิดบ้านตัวเองเป็น 'บ้านพี่เลี้ยง' ทำอย่างไร มีค่าตอบแทนไหม?",
				a: "ผู้ที่มีพื้นที่จอดรถ พักพิง หรือมีห้องนอนประสงค์ว่างปลอดประภัย สามารถรับความจำนงผ่านระบบ 'ลงทะเบียนบ้านพี่เลี้ยง' บนหน้าเว็บ ตัวแทนอาสาสมัคร EOC จะเข้าไปตรวจสอบมาตรฐานภัยพิบัติเพื่อทำการอนุมัติเปิดหมุดแผนที่ โดยไม่มีการเก็บค่าบริการแต่อย่างใดเพื่อร่วมสาธารณกุศลช่วยเหลือเกื้อกูลกัน"
			});
			dynamicFaq.push({
				q: 'ศูนย์ผู้ประสบภัย SmartShelter มีระบบป้องกันความปลอดภัยของข้อมูลประชาชนอย่างไร?',
				a: 'ระบบ SmartShelter จัดเก็บข้อมูลตามมาตรฐาน PDPA พร้อมกับการจำกัดสิทธิ์การเข้าถึงแบบ Role-Based Access Control เพื่อให้มั่นใจว่าข้อมูลของคุณจะไม่ถูกเผยแพร่หรือรั่วไหล'
			});
			dynamicFaq.push({
				q: 'สัตว์เลี้ยง เสบียงอาหารพิเศษ และวิทยุอุปกรณ์สื่อสารเคลื่อนย้ายมีแจกจ่ายเพิ่มที่พิกัดใด?',
				a: 'สอบถามจุดแจกจ่ายได้ที่เต็นท์อำนวยการหน้าศูนย์ หรือติดตามผ่านบอร์ดประกาศประชาสัมพันธ์ประจำวัน'
			});
			dynamicFaq.push({
				q: 'นำสัตว์เลี้ยงมาได้ไหม?',
				a: petStatus
			});

			let parkingAnswer = 'ไม่มีข้อมูลที่จอดรถ';
			if (m.parking_policy?.availability === 'available') {
				parkingAnswer = `มีลานจอดรองรับได้ประมาณ ${m.common_areas?.parking_capacity || 0} คัน`;
				if (m.parking_policy.supported_vehicles?.length) {
					parkingAnswer += ` (รองรับ: ${m.parking_policy.supported_vehicles.map((v: { type: string }) => v.type).join(', ')})`;
				}
			} else if (m.parking_policy?.availability === 'none') {
				parkingAnswer = 'ไม่มีพื้นที่จอดรถให้บริการ';
			} else {
				parkingAnswer = `มีลานจอดรองรับได้ประมาณ ${m.common_areas?.parking_capacity || 0} คัน ขอความร่วมมือจอดอย่างเป็นระเบียบ`;
			}
			dynamicFaq.push({
				q: 'ที่จอดรถมีเพียงพอไหม?',
				a: parkingAnswer
			});

			if (m.luggage_policy?.limitation) {
				let luggageAnswer =
					m.luggage_policy.limitation === 'no_limit'
						? 'นำสัมภาระมาได้ไม่จำกัด'
						: 'จำกัดจำนวนสัมภาระ';
				if (m.luggage_policy.max_per_family) {
					luggageAnswer += ` (สูงสุด ${m.luggage_policy.max_per_family} ชิ้น/ครอบครัว)`;
				}
				dynamicFaq.push({
					q: 'นำสัมภาระ/ของมีค่ามาได้แค่ไหน?',
					a: luggageAnswer
				});
			}

			dynamicFaq.push({
				q: 'รถเล็กเข้าถึงได้ไหม?',
				a: `ทางเข้ามีลักษณะ: ${mockDetailedShelter.travel.route} | ข้อจำกัด: ${mockDetailedShelter.travel.flood_warning}`
			});

			mockDetailedShelter.faq = dynamicFaq;
		}
	} catch (e) {
		console.error('Error fetching shelter detail:', e);
	}

	return json({
		shelter: mockDetailedShelter
	});
};
