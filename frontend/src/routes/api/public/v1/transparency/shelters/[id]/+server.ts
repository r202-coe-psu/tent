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

			const detailedShelter = {
				id: id,
				name: m.name || 'ไม่มีชื่อศูนย์พักพิง',
				status: mappedStatus,
				admin_type: m.shelter_type || 'ไม่ระบุประเภท',
				address: m.location?.address || 'ไม่ระบุที่อยู่',
				capacity: {
					total: m.capacity || 0,
					available: Math.max(0, (m.capacity || 0) - occupancy)
				},
				occupancy_rate:
					(m.capacity || 0) > 0 ? Math.round((occupancy / (m.capacity || 1)) * 100) : 0,
				building_status:
					m.area_type === 'indoor'
						? 'อาคารปิด (ในร่ม)'
						: m.area_type === 'outdoor'
							? 'ลานเปิด (กลางแจ้ง)'
							: m.area_type === 'hybrid'
								? 'ผสมผสาน (มีทั้งในร่มและกลางแจ้ง)'
								: 'ไม่ระบุ',
				geo:
					m.location?.lat && m.location?.lng ? { lat: m.location.lat, lng: m.location.lng } : null,
				admission_policy: {
					pets: '',
					vulnerable_groups: [] as string[]
				},
				travel: {
					route: m.risk?.entrance_description || 'ไม่มีข้อมูล',
					altitude: m.risk?.elevation_m ? `${m.risk.elevation_m} เมตร` : 'ไม่มีข้อมูล',
					flood_warning: m.risk?.constraints
				},
				facilities: {
					hygiene: {
						male: m.facilities?.toilets_male || 0,
						female: m.facilities?.toilets_female || 0,
						accessible: m.facilities?.toilets_accessible || 0,
						shower: m.facilities?.showers || 0,
						mobile_toilet: m.facilities?.car_toilet_supported || 0
					},
					power:
						m.utilities?.power_source === 'generator'
							? 'เครื่องปั่นไฟ'
							: m.utilities?.power_source === 'solar'
								? 'โซลาร์เซลล์'
								: m.utilities?.power_source === 'city_grid'
									? 'การไฟฟ้า'
									: 'ไม่มีข้อมูล',
					water:
						m.utilities?.water_source === 'groundwater'
							? 'น้ำบาดาล'
							: m.utilities?.water_source === 'water_tank'
								? 'รถบรรทุกน้ำ'
								: m.utilities?.water_source === 'city_water'
									? 'การประปา'
									: 'ไม่มีข้อมูล',
					comms: [] as string[],
					kitchen: m.common_areas?.central_kitchen ? 'โรงครัวกลาง' : 'ไม่มีโรงครัว',
					parking: (m.common_areas?.parking_capacity || 0) + ' คัน'
				},
				contact: {
					manager: m.key_personnel?.eoc_liaison?.name || 'เจ้าหน้าที่ประสานงาน',
					phone: m.key_personnel?.eoc_liaison?.phone || 'ไม่มีข้อมูลติดต่อ'
				},
				faq: [] as { q: string; a: string }[]
			};

			const vulnerableGroups = [...(m.admission_policy?.supported_vulnerable_groups || [])];
			if (vulnerableGroups.length === 0) {
				if (m.zones?.some((z) => z.type === 'vulnerable'))
					vulnerableGroups.push('กลุ่มเปราะบางทั่วไป');
				if (m.zones?.some((z) => z.type === 'quarantine'))
					vulnerableGroups.push('ผู้ป่วยแยกกักโรค');
				if ((m.facilities?.toilets_accessible ?? 0) > 0) vulnerableGroups.push('ผู้ใช้วีลแชร์');
			}
			detailedShelter.admission_policy.vulnerable_groups =
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
			detailedShelter.admission_policy.pets = petStatus;

			const commsMap: Record<string, string> = {
				cellular: 'สัญญาณมือถือ',
				wifi: 'Wi-Fi',
				vhf_radio: 'VHF'
			};
			if (m.utilities?.communications?.length) {
				detailedShelter.facilities.comms = m.utilities.communications.map((c) => commsMap[c] || c);
			}

			detailedShelter.faq = [];

			return json({
				shelter: detailedShelter
			});
		}
	} catch (e) {
		console.error('Error fetching shelter detail:', e);
	}

	return json({ error: 'Shelter not found' }, { status: 404 });
};
