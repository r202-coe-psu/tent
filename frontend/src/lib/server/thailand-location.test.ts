import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildLocationDocs } from '$lib/features/locations';

// Fixtures are retained for write-path tests. Read-path tests exercise the
// bundled production JSON snapshot directly.
const ROWS = [
	{ province: 'B-Province', district: 'B-District', subdistrict: 'B-Sub', zipcode: 20000 },
	{ province: 'A-Province', district: 'A-District-2', subdistrict: 'A-Sub-2', zipcode: 10002 },
	{ province: 'A-Province', district: 'A-District-1', subdistrict: 'A-Sub-1', zipcode: 10001 },
	{ province: 'A-Province', district: 'A-District-1', subdistrict: 'A-Sub-1-Dup', zipcode: 10001 },
	// same district name reused under a different province — must not leak across provinces
	{ province: 'B-Province', district: 'A-District-1', subdistrict: 'B-Sub-2', zipcode: 20001 }
];

const { provinces, districts, subdistricts } = buildLocationDocs(ROWS);

const adminRaw = vi.fn();
vi.mock('./couch-admin', () => ({
	adminRaw: (...args: unknown[]) => adminRaw(...args),
	ServiceError: class ServiceError extends Error {
		code: string;
		constructor(code: string, message: string) {
			super(message);
			this.code = code;
		}
	}
}));

const {
	listProvinces,
	listDistricts,
	listSubdistricts,
	listAllLocations,
	lookupZipcode,
	createProvince,
	createDistrict,
	createSubdistrict,
	updateSubdistrictZipcode,
	deleteLocation
} = await import('./thailand-location');

beforeEach(() => {
	adminRaw.mockReset();
});

describe('listProvinces', () => {
	it('returns all 77 deduped provinces from the bundled JSON, sorted', async () => {
		const result = await listProvinces();
		expect(result).toHaveLength(77);
		expect(result).toContain('สงขลา');
		// สงขลา is pinned to the top; the remainder stays in Thai alphabetical order.
		const rest = result.slice(1);
		expect(rest).toEqual([...rest].sort((a, b) => a.localeCompare(b, 'th')));
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('pins สงขลา as the first choice', async () => {
		expect((await listProvinces())[0]).toBe('สงขลา');
	});
});

describe('listDistricts', () => {
	it('returns districts for the given province from the bundled JSON', async () => {
		const result = await listDistricts('สงขลา');
		expect(result).toContain('หาดใหญ่');
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('pins หาดใหญ่ as the first choice within สงขลา', async () => {
		expect((await listDistricts('สงขลา'))[0]).toBe('หาดใหญ่');
	});

	it('leaves other provinces in plain alphabetical order', async () => {
		const result = await listDistricts('ปัตตานี');
		expect(result).toEqual([...result].sort((a, b) => a.localeCompare(b, 'th')));
	});

	it('returns an empty array for an unknown province', async () => {
		expect(await listDistricts('Nonexistent')).toEqual([]);
	});
});

describe('listSubdistricts', () => {
	it('returns subdistrict + zipcode pairs for the given province/district', async () => {
		const result = await listSubdistricts('สงขลา', 'หาดใหญ่');
		expect(result).toContainEqual({ subdistrict: 'คอหงส์', zipcode: 90110 });
		expect(adminRaw).not.toHaveBeenCalled();
	});

	it('returns an empty array for an unknown province/district combination', async () => {
		expect(await listSubdistricts('A-Province', 'Nonexistent')).toEqual([]);
	});
});

describe('listAllLocations', () => {
	it('lists สงขลา/หาดใหญ่ rows first', async () => {
		const all = await listAllLocations();
		expect(all[0].province).toBe('สงขลา');
		expect(all[0].district).toBe('หาดใหญ่');
	});

	it('returns all 7,426 locations from the bundled JSON', async () => {
		const all = await listAllLocations();
		expect(all).toHaveLength(7426);
		expect(all).toContainEqual({
			province: 'สงขลา',
			district: 'หาดใหญ่',
			subdistrict: 'คอหงส์',
			zipcode: 90110
		});
		expect(adminRaw).not.toHaveBeenCalled();
	});
});

describe('createProvince', () => {
	it('PUTs a new province doc', async () => {
		adminRaw.mockResolvedValueOnce({ status: 201, data: { ok: true } });
		await createProvince('C-Province', 'sa');
		const [path, method] = adminRaw.mock.calls[0];
		expect(method).toBe('PUT');
		expect(path).toContain(encodeURIComponent('location_province:C-Province'));
	});

	it('rejects when the province already exists (409)', async () => {
		adminRaw.mockResolvedValueOnce({ status: 409, data: { error: 'conflict' } });
		await expect(createProvince('A-Province', 'sa')).rejects.toThrow(/มีอยู่แล้ว/);
	});

	it('rejects a blank name without touching CouchDB', async () => {
		await expect(createProvince('   ', 'sa')).rejects.toThrow(/ต้องระบุ/);
		expect(adminRaw).not.toHaveBeenCalled();
	});
});

describe('createDistrict', () => {
	it('rejects when the parent province is missing', async () => {
		adminRaw.mockResolvedValueOnce({ status: 404, data: {} }); // parent GET
		await expect(createDistrict('Nope', 'X', 'sa')).rejects.toThrow(/ไม่พบจังหวัด/);
	});

	it('creates when the parent exists', async () => {
		adminRaw
			.mockResolvedValueOnce({ status: 200, data: provinces[0] }) // parent GET
			.mockResolvedValueOnce({ status: 201, data: { ok: true } }); // PUT
		await createDistrict('A-Province', 'New-District', 'sa');
		expect(adminRaw.mock.calls[1][1]).toBe('PUT');
	});
});

describe('createSubdistrict', () => {
	it('rejects an out-of-range zipcode', async () => {
		await expect(createSubdistrict('A-Province', 'A-District-1', 'X', 999, 'sa')).rejects.toThrow(
			/รหัสไปรษณีย์/
		);
	});

	it('creates a valid subdistrict under an existing district', async () => {
		adminRaw
			.mockResolvedValueOnce({ status: 200, data: districts[0] }) // parent GET
			.mockResolvedValueOnce({ status: 201, data: { ok: true } }); // PUT
		await createSubdistrict('A-Province', 'A-District-1', 'New-Sub', 10001, 'sa');
		expect(adminRaw.mock.calls[1][1]).toBe('PUT');
	});
});

describe('updateSubdistrictZipcode', () => {
	it('rejects a non-subdistrict id', async () => {
		await expect(updateSubdistrictZipcode('location_province:A-Province', 10000)).rejects.toThrow(
			/เฉพาะระดับตำบล/
		);
	});

	it('reads then PUTs the updated zipcode', async () => {
		const sub = subdistricts[0];
		adminRaw
			.mockResolvedValueOnce({ status: 200, data: { ...sub, _rev: '1-x' } })
			.mockResolvedValueOnce({ status: 201, data: { rev: '2-y' } });
		await updateSubdistrictZipcode(sub._id, 10999);
		const putBody = adminRaw.mock.calls[1][2] as { zipcode: number };
		expect(putBody.zipcode).toBe(10999);
	});
});

describe('deleteLocation', () => {
	it('refuses to delete a province that still has districts', async () => {
		adminRaw.mockResolvedValueOnce({ status: 200, data: { docs: [districts[0]] } }); // _find child
		await expect(deleteLocation('location_province:A-Province')).rejects.toThrow(/ยังมีอำเภอ/);
	});

	it('deletes a childless province', async () => {
		adminRaw
			.mockResolvedValueOnce({ status: 200, data: { docs: [] } }) // _find child → none
			.mockResolvedValueOnce({ status: 200, data: { _id: 'x', _rev: '1-a' } }) // GET for rev
			.mockResolvedValueOnce({ status: 200, data: { ok: true } }); // DELETE
		await deleteLocation('location_province:Empty');
		expect(adminRaw.mock.calls[2][1]).toBe('DELETE');
	});

	it('deletes a subdistrict without a child check', async () => {
		adminRaw
			.mockResolvedValueOnce({ status: 200, data: { _id: 'x', _rev: '1-a' } }) // GET for rev
			.mockResolvedValueOnce({ status: 200, data: { ok: true } }); // DELETE
		await deleteLocation('location_subdistrict:A-Province:A-District-1:A-Sub-1');
		expect(adminRaw.mock.calls[0][1]).toBe('GET');
		expect(adminRaw.mock.calls[1][1]).toBe('DELETE');
	});
});

describe('lookupZipcode', () => {
	it('matches exact province, district, and subdistrict', () => {
		expect(lookupZipcode('สงขลา', 'หาดใหญ่', 'คอหงส์')).toBe('90110');
		expect(lookupZipcode('กรุงเทพมหานคร', 'บางนา', 'บางนา')).toBe('10260');
	});

	it('strips Thai administrative prefixes (จ., จังหวัด, อ., อำเภอ, เขต, ต., ตำบล, แขวง)', () => {
		expect(lookupZipcode('จังหวัดสงขลา', 'อำเภอหาดใหญ่', 'ตำบลคอหงส์')).toBe('90110');
		expect(lookupZipcode('กรุงเทพมหานคร', 'เขตบางนา', 'แขวงบางนา')).toBe('10260');
	});

	it('handles partial / substring district matches within province', () => {
		expect(lookupZipcode('สงขลา', 'เมือง', 'บ่อยาง')).toBe('90000');
		expect(lookupZipcode('สงขลา', 'เมืองสงขลา', 'บ่อยาง')).toBe('90000');
	});

	it('returns null when subdistrict or province is missing', () => {
		expect(lookupZipcode(null, 'หาดใหญ่', 'คอหงส์')).toBeNull();
		expect(lookupZipcode('สงขลา', 'หาดใหญ่', null)).toBeNull();
	});

	it('returns null on ambiguous subdistrict names across multiple districts with different zipcodes when district is omitted or mismatched', () => {
		// แขวงบางจาก in Bangkok exists in เขตพระโขนง (10260) and เขตภาษีเจริญ (10160)
		// When district is unknown or invalid, returning an arbitrary zipcode is dangerous and must return null
		expect(lookupZipcode('กรุงเทพมหานคร', 'เขตไม่ถูกต้อง', 'บางจาก')).toBeNull();
		expect(lookupZipcode('กรุงเทพมหานคร', null, 'บางจาก')).toBeNull();
	});

	it('returns correct zipcode when district is explicitly specified for ambiguous subdistricts', () => {
		expect(lookupZipcode('กรุงเทพมหานคร', 'พระโขนง', 'บางจาก')).toBe('10260');
		expect(lookupZipcode('กรุงเทพมหานคร', 'ภาษีเจริญ', 'บางจาก')).toBe('10160');
	});
});
