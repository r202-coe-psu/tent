import crypto from 'node:crypto';
import type { ShelterMaster } from '../src/lib/features/shelters/server';

const COUCHDB_URL = 'http://localhost:5984';

async function couchReq(method: string, path: string, body?: unknown) {
	const res = await fetch(`${COUCHDB_URL}${path}`, {
		method,
		headers: {
			'Content-Type': 'application/json',
			Authorization: 'Basic ' + Buffer.from('admin:password').toString('base64')
		},
		body: body ? JSON.stringify(body) : undefined
	});
	const data = await res.json().catch(() => ({}));
	return { status: res.status, data };
}

const mockProvinces = ['Bangkok', 'Chiang Mai', 'Phuket', 'Khon Kaen', 'Songkhla'];
const mockDistricts = ['Muang', 'Bang Kapi', 'Phra Nakhon', 'Thalang', 'Hat Yai'];
const mockCapabilities: {
	pet: 'no_pets' | 'conditional';
	car: 'none' | 'available';
	wheel: number;
}[] = [
	{ pet: 'no_pets', car: 'none', wheel: 0 },
	{ pet: 'conditional', car: 'available', wheel: 1 },
	{ pet: 'no_pets', car: 'available', wheel: 2 }
];

async function seed() {
	console.log('Seeding mock search shelters...');
	const docs: ShelterMaster[] = [];

	for (let i = 0; i < 20; i++) {
		const prov = mockProvinces[i % mockProvinces.length];
		const dist = mockDistricts[i % mockDistricts.length];
		const cap = mockCapabilities[i % mockCapabilities.length];

		const shelter: ShelterMaster = {
			_id: `shelter:${crypto.randomUUID()}`,
			type: 'shelter',
			schema_v: 4,
			code: `MOCK${i.toString().padStart(3, '0')}`,
			name: `Mock Shelter ${i} - ${prov}`,
			operation_status: i % 5 === 0 ? 'full_capacity' : 'active',
			shelter_type: 'ศูนย์พักพิง/อพยพ',
			capacity: 100 + i * 10,
			location: {
				address: `${dist}, ${prov}`,
				lat: 13.0 + i * 0.1,
				lng: 100.0 + i * 0.1
			},
			province: prov,
			district: dist,
			subdistrict: 'Mock Subdistrict',
			admission_policy: {
				supported_vulnerable_groups: [],
				pet_policy: {
					policy: cap.pet,
					categories:
						cap.pet === 'conditional'
							? [{ category: 'small_general' as const, conditions: [] }]
							: []
				}
			},
			parking_policy: {
				availability: cap.car,
				supported_vehicles: cap.car === 'available' ? [{ type: 'car' }] : [],
				rules: []
			},
			common_areas: {
				parking_capacity: cap.car === 'available' ? 50 : 0,
				sub_storage: []
			},
			facilities: {
				toilets_accessible: cap.wheel
			},
			utilities: {
				communications: i % 2 === 0 ? ['wifi'] : []
			},
			created_at: new Date().toISOString(),
			updated_at: new Date().toISOString()
		};
		docs.push(shelter);
	}

	const res = await couchReq('POST', '/registry/_bulk_docs', { docs });
	if (res.status === 201) {
		console.log(`Successfully inserted ${docs.length} mock shelters.`);
	} else {
		console.error('Failed:', res);
	}
}

seed();
