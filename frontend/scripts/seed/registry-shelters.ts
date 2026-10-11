/**
 * Staging shelter registry (SH001–SH004) + DB provisioning.
 */
import { createHash } from 'node:crypto';
import { shelterCodeSchema, now } from '$lib/db/model';
import { ulid } from '$lib/db/ulid';
import { deployShelterViewsFn } from '$lib/features/shelters/server/deploy';
import {
	buildValidateDocUpdate,
	REFERRAL_MANGO_INDEXES,
	KIOSK_LOOKUP_MANGO_INDEXES,
	shelterDbName
} from '$lib/server/shelter-access-design';
import { buildRegistryDesignDoc, REGISTRY_DESIGN_ID } from '$lib/server/registry-design';
import { couchReq, ensureDb, putDoc, PUBLIC_WRITER_NAMES, setSecurity } from './couch';
import {
	ALL_VG_KEYS,
	masterCode,
	masterCodes,
	SH001_CODE,
	SH002_CODE,
	SH003_CODE,
	SH004_CODE,
	type MasterLookup
} from './types';

/**
 * Registry masters for staging. Admission policies include the full VG set used
 * by volume generators so chips resolve in registration.
 */
export const REGISTRY_SHELTERS = [
	{
		code: SH001_CODE,
		name: 'ศูนย์อพยพศูนย์กีฬามหาวิทยาลัยสงขลานครินทร์',
		location: {
			lat: 7.010027132382802,
			lng: 100.50024358303605,
			address: '15 ถ.กาญจนวนิช ต.คอหงส์ อ.หาดใหญ่ จ.สงขลา 90110'
		},
		province: 'สงขลา',
		district: 'หาดใหญ่',
		subdistrict: 'คอหงส์',
		shelter_type_key: 'sports_centre',
		area_type: 'indoor',
		capacity: 500,
		zones: [
			{ code: 'Z1', name: 'อาคารยิมเนเซียม 1', capacity: 200, area_m2: 500, type: 'general' },
			{ code: 'Z2', name: 'อาคารยิมเนเซียม 2', capacity: 150, area_m2: 350, type: 'family' },
			{ code: 'Z3', name: 'โซนดูแลกลุ่มเปราะบาง', capacity: 100, area_m2: 200, type: 'vulnerable' },
			{ code: 'Z4', name: 'โซนสัตว์เลี้ยง', capacity: 50, area_m2: 150, type: 'pet' }
		],
		area_m2: 1200,
		facilities: {
			toilets_female: 10,
			toilets_male: 8,
			toilets_accessible: 4,
			showers: 12,
			car_toilet_supported: 2,
			water_points: 8,
			handwashing_stations: 12
		},
		utilities: {
			power_source: 'city_grid',
			water_source: 'city_water',
			communications: ['cellular', 'vhf_radio']
		},
		common_areas: {
			central_kitchen: true,
			parking_capacity: 50
		},
		key_personnel: {
			eoc_liaison: {
				name: 'ดร.สมศักดิ์ วิจิตรการ (ผู้จัดการศูนย์)',
				phone: '074-282000 ต่อ 101'
			}
		},
		contact: {
			name: 'ดร.สมศักดิ์ วิจิตรการ (ผู้จัดการศูนย์)',
			phone: '074-282000 ต่อ 101'
		},
		risk: {
			entrance_description:
				'ถ.กาญจนวนิช ประตู 10 ม.อ. (สัญจรสะดวก รถทุกชนิดเข้าได้ ไม่มีน้ำท่วมขัง)',
			elevation_m: 18,
			constraints: 'พื้นที่ยกสูง ปลอดภัยจากน้ำหลากในระดับวิกฤต'
		},
		admission_policy: {
			pet_policy: {
				policy: 'conditional',
				categories: [{ category: 'small_general' }, { category: 'large_dog' }]
			},
			supported_vulnerable_group_keys: [...ALL_VG_KEYS]
		}
	},
	{
		code: SH002_CODE,
		name: 'ศูนย์อพยพสำนักงานเทศบาลนครหาดใหญ่',
		location: {
			lat: 7.015427802879699,
			lng: 100.47291623646029,
			address: '445 ถ.เพชรเกษม ต.หาดใหญ่ อ.หาดใหญ่ จ.สงขลา 90110'
		},
		province: 'สงขลา',
		district: 'หาดใหญ่',
		subdistrict: 'หาดใหญ่',
		shelter_type_key: 'government_building',
		area_type: 'indoor',
		capacity: 400,
		zones: [
			{ code: 'Z1', name: 'ห้องประชุมใหญ่ชั้น 1', capacity: 250, area_m2: 250, type: 'general' },
			{ code: 'Z2', name: 'ห้องดูแลพิเศษ', capacity: 150, area_m2: 150, type: 'vulnerable' }
		],
		area_m2: 400,
		facilities: {
			toilets_female: 6,
			toilets_male: 4,
			toilets_accessible: 2,
			showers: 6,
			car_toilet_supported: 1,
			water_points: 4,
			handwashing_stations: 6
		},
		utilities: {
			power_source: 'city_grid',
			water_source: 'city_water',
			communications: ['cellular']
		},
		common_areas: {
			central_kitchen: true,
			parking_capacity: 30
		},
		contact: {
			name: 'นายอดิศร สุขสมบูรณ์ (หัวหน้าฝ่ายป้องกันและบรรเทาสาธารณภัย)',
			phone: '074-200000'
		},
		risk: {
			entrance_description: 'ถ.เพชรเกษม ด้านหน้าเทศบาลนครหาดใหญ่',
			elevation_m: 12,
			constraints: null
		},
		admission_policy: {
			pet_policy: { policy: 'not_allowed' },
			supported_vulnerable_group_keys: [...ALL_VG_KEYS]
		}
	},
	{
		code: SH003_CODE,
		name: 'ศูนย์อพยพสำนักงานเทศบาลเมืองบ้านพรุ',
		location: {
			lat: 6.948086391528152,
			lng: 100.47963181135452,
			address: '1 ถ.กาญจนวนิช ต.บ้านพรุ อ.หาดใหญ่ จ.สงขลา 90250'
		},
		province: 'สงขลา',
		district: 'หาดใหญ่',
		subdistrict: 'บ้านพรุ',
		shelter_type_key: 'community_hall',
		area_type: 'hybrid',
		capacity: 250,
		zones: [
			{ code: 'Z1', name: 'โซนรวม', capacity: 150, area_m2: 200, type: 'general' },
			{ code: 'Z2', name: 'โซนสัตว์เลี้ยง', capacity: 100, area_m2: 200, type: 'pet' }
		],
		area_m2: 400,
		facilities: {
			toilets_female: 4,
			toilets_male: 4,
			toilets_accessible: 1,
			showers: 4,
			car_toilet_supported: 0,
			water_points: 3,
			handwashing_stations: 4
		},
		utilities: {
			power_source: 'city_grid',
			water_source: 'city_water',
			communications: ['cellular']
		},
		common_areas: {
			central_kitchen: false,
			parking_capacity: 20
		},
		contact: {
			name: 'นายธีระพล พรหมประสิทธิ์',
			phone: '074-291111'
		},
		risk: {
			entrance_description: 'ถ.กาญจนวนิช สายเก่า',
			elevation_m: 15,
			constraints: null
		},
		admission_policy: {
			pet_policy: {
				policy: 'conditional',
				categories: [{ category: 'small_general' }]
			},
			supported_vulnerable_group_keys: [...ALL_VG_KEYS]
		}
	},
	{
		code: SH004_CODE,
		name: 'บ้านพี่เลี้ยงชุมชนคอหงส์',
		site_kind: 'host_house',
		location: {
			lat: 7.006114303226103,
			lng: 100.4967812435841,
			address: '88 ซอย 5 บ้านทุ่ง ต.คอหงส์ อ.หาดใหญ่ จ.สงขลา 90110'
		},
		province: 'สงขลา',
		district: 'หาดใหญ่',
		subdistrict: 'คอหงส์',
		shelter_type_key: 'community_hall',
		area_type: 'indoor',
		capacity: 8,
		zones: [{ code: 'Z1', name: 'ห้องพักรวม', capacity: 8, area_m2: 60, type: 'general' }],
		area_m2: 60,
		facilities: {
			toilets_female: 1,
			toilets_male: 1,
			toilets_accessible: 0,
			showers: 1,
			car_toilet_supported: 0,
			water_points: 1,
			handwashing_stations: 1
		},
		utilities: {
			power_source: 'city_grid',
			water_source: 'city_water',
			communications: ['cellular']
		},
		common_areas: {
			central_kitchen: false,
			parking_capacity: 2
		},
		contact: {
			name: 'นางวรรณา ใจดี (เจ้าของบ้านพี่เลี้ยง)',
			phone: '086-123-4567'
		},
		risk: {
			entrance_description: 'ซอย 5 เข้าจาก ถ.กาญจนวนิช 100 เมตร',
			elevation_m: 16,
			constraints: null
		},
		admission_policy: {
			pet_policy: { policy: 'not_allowed' },
			supported_vulnerable_group_keys: ['elderly_dependent', 'young_child', 'infant']
		}
	}
] as const;

async function deployRegistryDesign(): Promise<void> {
	const desired = buildRegistryDesignDoc();
	const existing = await couchReq('GET', `/registry/${REGISTRY_DESIGN_ID}`);
	const current =
		existing.status === 200
			? (existing.data as { _rev?: string; views?: Record<string, { map: string }> })
			: null;

	if (current && current.views?.by_code?.map === desired.views.by_code.map) {
		console.log('  ✓ registry: _design/app already current');
		return;
	}

	const { status } = await couchReq('PUT', `/registry/${REGISTRY_DESIGN_ID}`, {
		...desired,
		...(current?._rev ? { _rev: current._rev } : {})
	});
	if (status !== 201 && status !== 202) {
		throw new Error(`Cannot deploy registry _design/app (HTTP ${status})`);
	}
	console.log('  ✓ registry: _design/app (by_code view) deployed');
}

export async function seedRegistry(master: MasterLookup): Promise<void> {
	await ensureDb('registry');
	await setSecurity('registry', {
		admins: { names: [], roles: ['system_admin'] },
		members: {
			names: [],
			roles: ['shelter_manager', 'registration_staff', 'kitchen_staff', 'warehouse_staff']
		}
	});
	await deployRegistryDesign();

	const { status, data } = await couchReq('GET', '/registry/_all_docs?include_docs=true');
	const existingByCode = new Map<string, Record<string, unknown>>();
	if (status === 200) {
		const rows =
			(data as { rows?: { doc?: { type?: string; code?: string } & Record<string, unknown> }[] })
				.rows ?? [];
		for (const row of rows) {
			const doc = row.doc;
			if (doc?.type === 'shelter' && typeof doc.code === 'string') {
				existingByCode.set(doc.code, doc);
			}
		}
	}

	const ts = now();
	for (const shelter of REGISTRY_SHELTERS) {
		const existing = existingByCode.get(shelter.code);

		const extras: Record<string, unknown> = {
			shelter_type: masterCode(master, 'shelter_type', shelter.shelter_type_key)
		};
		if ('site_kind' in shelter) extras.site_kind = shelter.site_kind;
		if ('province' in shelter) extras.province = shelter.province;
		if ('district' in shelter) extras.district = shelter.district;
		if ('subdistrict' in shelter) extras.subdistrict = shelter.subdistrict;
		if ('area_type' in shelter) extras.area_type = shelter.area_type;
		if ('facilities' in shelter) extras.facilities = { ...shelter.facilities };
		if ('utilities' in shelter) extras.utilities = { ...shelter.utilities };
		if ('common_areas' in shelter) extras.common_areas = { ...shelter.common_areas };
		if ('key_personnel' in shelter) extras.key_personnel = { ...shelter.key_personnel };
		if ('contact' in shelter) extras.contact = { ...shelter.contact };
		if ('risk' in shelter) extras.risk = { ...shelter.risk };
		if ('admission_policy' in shelter) {
			const { supported_vulnerable_group_keys, ...policy } = shelter.admission_policy;
			extras.admission_policy = {
				...policy,
				supported_vulnerable_groups: masterCodes(
					master,
					'vulnerable_group',
					...supported_vulnerable_group_keys
				)
			};
		}

		if (existing) {
			await putDoc('registry', {
				...existing,
				name: shelter.name,
				location: { ...shelter.location },
				capacity: shelter.capacity,
				area_m2: shelter.area_m2,
				zones: shelter.zones.map((z) => ({ ...z })),
				updated_at: ts,
				...extras
			});
			console.log(
				`  ✓ registry: updated shelter ${shelter.code} (name + location + policies + details)`
			);
		} else {
			await putDoc('registry', {
				_id: `shelter:${ulid()}`,
				type: 'shelter',
				schema_v: 1,
				code: shelter.code,
				name: shelter.name,
				location: { ...shelter.location },
				status: 'open',
				capacity: shelter.capacity,
				zones: shelter.zones.map((z) => ({ ...z })),
				area_m2: shelter.area_m2,
				opened_at: ts,
				created_at: ts,
				updated_at: ts,
				created_by: 'seed',
				...extras
			});
			console.log(`  ✓ registry: 1 shelter master (${shelter.code})`);
		}
	}

	const testScannerSecret = process.env.SCANNER_SEED_SECRET?.trim();
	if (testScannerSecret) {
		if (!/^sk_scan_[0-9a-f]{64}$/.test(testScannerSecret)) {
			throw new Error('SCANNER_SEED_SECRET must use a generated scanner key format');
		}
		const testScannerDoc = {
			_id: 'scanner_device:kiosk-test',
			type: 'scanner_device',
			schema_v: 1,
			device_id: 'kiosk-test',
			name: 'Kiosk Test Scanner',
			shelter_code: SH001_CODE,
			station_name: 'จุดสแกน Kiosk ทดสอบ (Kiosk Test)',
			secret_hash: createHash('sha256').update(testScannerSecret).digest('hex'),
			secret_prefix: testScannerSecret.slice(0, 16) + '...',
			status: 'active',
			last_seen_at: null,
			created_at: ts,
			updated_at: ts,
			created_by: 'seed'
		};
		await putDoc('registry', testScannerDoc);
		console.log(`  ✓ registry: 1 scanner device (kiosk-test)`);
	} else {
		console.log('  - registry: scanner seed skipped; use System Management or SCANNER_SEED_SECRET');
	}
}

async function deployShelterAccessDesign(db: string, shelterCode: string): Promise<void> {
	const ddocId = '_design/access';
	const { status: getStatus, data: existingDdoc } = await couchReq(
		'GET',
		`/${db}/${encodeURIComponent(ddocId)}`
	);
	const rev = getStatus === 200 ? (existingDdoc as { _rev: string })._rev : undefined;
	const { status, data } = await couchReq('PUT', `/${db}/${encodeURIComponent(ddocId)}`, {
		_id: ddocId,
		...(rev ? { _rev: rev } : {}),
		validate_doc_update: buildValidateDocUpdate(shelterCode)
	});
	if (status >= 400) {
		const detail = (data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`Cannot deploy _design/access to "${db}" (HTTP ${status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}
	console.log(`  ✓ ${db}: _design/access deployed (referral whitelist)`);
}

async function deployMangoIndexes(db: string): Promise<void> {
	for (const def of REFERRAL_MANGO_INDEXES) {
		const { status, data } = await couchReq('POST', `/${db}/_index`, def);
		if (status >= 400) {
			const detail = (data as { reason?: string; error?: string } | null) ?? {};
			throw new Error(
				`Cannot deploy Mango index "${def.name}" to "${db}" (HTTP ${status}): ${detail.reason ?? detail.error ?? 'unknown'}`
			);
		}
	}
	console.log(`  ✓ ${db}: referral Mango indexes deployed`);
}

async function deployKioskLookupMangoIndexes(db: string): Promise<void> {
	for (const def of KIOSK_LOOKUP_MANGO_INDEXES) {
		const { status, data } = await couchReq('POST', `/${db}/_index`, def);
		if (status >= 400) {
			const detail = (data as { reason?: string; error?: string } | null) ?? {};
			throw new Error(
				`Cannot deploy Mango index "${def.name}" to "${db}" (HTTP ${status}): ${detail.reason ?? detail.error ?? 'unknown'}`
			);
		}
	}
	console.log(`  ✓ ${db}: kiosk lookup Mango indexes deployed`);
}

async function listRegistryShelterCodes(): Promise<string[]> {
	const { status, data } = await couchReq('GET', '/registry/_all_docs?include_docs=true');
	if (status === 404) {
		throw new Error('Cannot provision shelter databases: registry DB does not exist');
	}
	if (status >= 400) {
		const detail = (data as { reason?: string; error?: string } | null) ?? {};
		throw new Error(
			`Cannot read registry for shelter provisioning (HTTP ${status}): ${detail.reason ?? detail.error ?? 'unknown'}`
		);
	}

	const rows =
		(data as { rows?: { id?: string; doc?: { type?: string; code?: unknown } }[] })?.rows ?? [];
	const codes = new Set<string>();

	for (const row of rows) {
		if (!row.id?.startsWith('shelter:') || row.doc?.type !== 'shelter') continue;
		const parsed = shelterCodeSchema.safeParse(row.doc.code);
		if (!parsed.success) {
			console.warn(`  ⚠ registry: skipping invalid shelter code "${String(row.doc.code)}"`);
			continue;
		}
		codes.add(parsed.data);
	}

	return [...codes].sort();
}

async function provisionShelterDb(shelterCode: string): Promise<void> {
	const code = shelterCodeSchema.parse(shelterCode);
	const db = shelterDbName(code);
	await ensureDb(db);
	await setSecurity(db, {
		admins: { names: [], roles: ['system_admin'] },
		members: { names: [...PUBLIC_WRITER_NAMES], roles: [`shelter:${code}`] }
	});
	await deployShelterViewsFn(db, (path, method, body) => couchReq(method, path, body));
	await deployShelterAccessDesign(db, code);
	await deployMangoIndexes(db);
	await deployKioskLookupMangoIndexes(db);
}

export async function provisionRegistryShelterDbs(): Promise<void> {
	const codes = await listRegistryShelterCodes();
	if (codes.length === 0) {
		console.log('  ⚠ registry: no shelter masters found to provision');
		return;
	}

	for (const shelterCode of codes) {
		console.log(`  → provisioning ${shelterCode} (${shelterDbName(shelterCode)})`);
		await provisionShelterDb(shelterCode);
	}
}
