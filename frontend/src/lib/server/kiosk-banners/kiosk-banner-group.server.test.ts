import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('$lib/server/couch-admin', async (importOriginal) => ({
	...(await importOriginal<typeof import('$lib/server/couch-admin')>()),
	adminRaw: vi.fn()
}));
vi.mock('$lib/server/scanners/device-repository', () => ({
	scannerDeviceRepository: { listDevices: vi.fn(), setBannerGroup: vi.fn() }
}));
vi.mock('./kiosk-banner.server', async (importOriginal) => ({
	...(await importOriginal<typeof import('./kiosk-banner.server')>()),
	listBannersForShelter: vi.fn()
}));

import { adminRaw } from '$lib/server/couch-admin';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';
import type { KioskBannerGroupDoc } from '$lib/features/kiosk-banners';
import { GroupNotFoundError, listBannersForShelter } from './kiosk-banner.server';
import {
	createGroup,
	deleteGroup,
	ensureTvCode,
	findGroupByTvCode,
	getGroup,
	listGroups,
	rotateTvCode,
	setGroupDevices,
	updateGroup
} from './kiosk-banner-group.server';

const adminRawMock = vi.mocked(adminRaw);
type PersistedScannerDevice = Awaited<
	ReturnType<typeof scannerDeviceRepository.listDevices>
>[number];
const listDevicesMock = vi.mocked(scannerDeviceRepository.listDevices);
const setBannerGroupMock = vi.mocked(scannerDeviceRepository.setBannerGroup);
const listBannersMock = vi.mocked(listBannersForShelter);

const NOW = new Date('2026-10-15T03:00:00.000Z');
const GROUP_A = 'kiosk_banner_group:A';
const GROUP_B = 'kiosk_banner_group:B';

function groupDoc(id: string, name: string, overrides: Partial<KioskBannerGroupDoc> = {}) {
	return {
		_id: id,
		_rev: '1-a',
		type: 'kiosk_banner_group',
		schema_v: 1,
		shelter_code: 'SH1',
		name,
		description: null,
		created_at: '2026-10-01T00:00:00.000Z',
		updated_at: '2026-10-01T00:00:00.000Z',
		created_by: 'alice',
		...overrides
	} as KioskBannerGroupDoc;
}

function device(deviceId: string, groupId: string | null | undefined): PersistedScannerDevice {
	return {
		_id: `scanner_device:${deviceId}`,
		type: 'scanner_device',
		device_id: deviceId,
		shelter_code: 'SH1',
		banner_group_id: groupId
	} as unknown as PersistedScannerDevice;
}

beforeEach(() => {
	adminRawMock.mockReset();
	listDevicesMock.mockReset();
	setBannerGroupMock.mockReset();
	listBannersMock.mockReset();
});

describe('listGroups', () => {
	it("returns the shelter's groups, each with the device_ids of the kiosks fed from it", async () => {
		adminRawMock.mockResolvedValueOnce({
			status: 200,
			data: { docs: [groupDoc(GROUP_A, 'ทั่วไป'), groupDoc(GROUP_B, 'ผู้สูงอายุ')] }
		});
		listDevicesMock.mockResolvedValueOnce([
			device('kiosk-1', GROUP_A),
			device('kiosk-2', GROUP_B),
			device('kiosk-3', GROUP_A),
			device('kiosk-4', null),
			device('kiosk-5', undefined)
		]);

		const groups = await listGroups('SH1');

		expect(adminRawMock.mock.calls[0]).toEqual([
			'/registry/_find',
			'POST',
			expect.objectContaining({
				selector: { type: 'kiosk_banner_group', shelter_code: 'SH1' }
			})
		]);
		expect(listDevicesMock).toHaveBeenCalledWith(['SH1']);
		expect(groups.map((g) => [g._id, g.device_ids])).toEqual([
			[GROUP_A, ['kiosk-1', 'kiosk-3']],
			[GROUP_B, ['kiosk-2']]
		]);
	});
});

describe('getGroup', () => {
	it('returns the group with its device_ids', async () => {
		adminRawMock.mockResolvedValueOnce({
			status: 200,
			data: groupDoc(GROUP_A, 'ทั่วไป', { schema_v: 2, tv_code: '123456' })
		});
		listDevicesMock.mockResolvedValueOnce([device('kiosk-1', GROUP_A), device('kiosk-2', GROUP_B)]);

		const group = await getGroup(GROUP_A);

		expect(adminRawMock.mock.calls[0].slice(0, 2)).toEqual([
			`/registry/${encodeURIComponent(GROUP_A)}`,
			'GET'
		]);
		expect(listDevicesMock).toHaveBeenCalledWith(['SH1']);
		expect(group).toMatchObject({ _id: GROUP_A, name: 'ทั่วไป', device_ids: ['kiosk-1'] });
	});

	it('returns null for a missing doc or a doc that is not a group', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 404, data: { error: 'not_found' } });
		expect(await getGroup(GROUP_A)).toBeNull();

		adminRawMock.mockResolvedValueOnce({
			status: 200,
			data: { _id: GROUP_A, type: 'kiosk_banner' }
		});
		expect(await getGroup(GROUP_A)).toBeNull();
		expect(listDevicesMock).not.toHaveBeenCalled();
	});
});

describe('setGroupDevices', () => {
	const group = groupDoc(GROUP_A, 'ทั่วไป');

	it('moves listed kiosks into the group, frees the unlisted ones and skips the already correct', async () => {
		listDevicesMock.mockResolvedValueOnce([
			device('kiosk-1', GROUP_A),
			device('kiosk-2', GROUP_A),
			device('kiosk-3', GROUP_B),
			device('kiosk-4', null)
		]);

		const record = await setGroupDevices(group, ['kiosk-2', 'kiosk-3'], 'sm-a');

		expect(setBannerGroupMock).toHaveBeenCalledTimes(2);
		expect(setBannerGroupMock).toHaveBeenCalledWith(['scanner_device:kiosk-3'], GROUP_A, 'sm-a');
		expect(setBannerGroupMock).toHaveBeenCalledWith(['scanner_device:kiosk-1'], null, 'sm-a');
		expect(record).toMatchObject({ _id: GROUP_A, device_ids: ['kiosk-2', 'kiosk-3'] });
	});

	it('rejects a device that is not in the group shelter with 422 and writes nothing', async () => {
		listDevicesMock.mockResolvedValueOnce([device('kiosk-1', null)]);

		await expect(setGroupDevices(group, ['kiosk-1', 'kiosk-other'], 'sm-a')).rejects.toMatchObject({
			name: 'ServiceError',
			code: 'VALIDATION'
		});
		expect(setBannerGroupMock).not.toHaveBeenCalled();
	});
});

const FOUND = (...docs: KioskBannerGroupDoc[]) => ({ status: 200, data: { docs } });
const CTX = { shelterCode: 'SH1', createdBy: 'alice' };
const DUPLICATE_NAME_MESSAGE = 'ชื่อกลุ่มซ้ำกับกลุ่มอื่นในศูนย์นี้';

describe('createGroup', () => {
	it('saves the group doc with its rev and puts the listed kiosks into it', async () => {
		adminRawMock
			.mockResolvedValueOnce(FOUND(groupDoc(GROUP_B, 'ผู้สูงอายุ')))
			.mockResolvedValueOnce(FOUND())
			.mockResolvedValueOnce({ status: 201, data: { ok: true, id: 'x', rev: '1-new' } });
		listDevicesMock.mockResolvedValue([device('kiosk-1', null), device('kiosk-2', GROUP_B)]);

		const record = await createGroup(
			{ name: 'ทั่วไป', description: 'ทุกจอ' },
			['kiosk-1'],
			CTX,
			NOW
		);

		const [path, method, body] = adminRawMock.mock.calls[2];
		expect(method).toBe('PUT');
		expect(path).toBe(`/registry/${encodeURIComponent(record._id)}`);
		expect(body).toMatchObject({
			_id: record._id,
			type: 'kiosk_banner_group',
			schema_v: 2,
			tv_code: expect.stringMatching(/^[0-9]{6}$/),
			shelter_code: 'SH1',
			name: 'ทั่วไป',
			description: 'ทุกจอ',
			created_by: 'alice',
			created_at: NOW.toISOString()
		});
		expect(record).toMatchObject({ _rev: '1-new', name: 'ทั่วไป', device_ids: ['kiosk-1'] });
		expect(setBannerGroupMock).toHaveBeenCalledWith(
			['scanner_device:kiosk-1'],
			record._id,
			'alice'
		);
	});

	it('rejects a name already used in the shelter with 409 and writes nothing', async () => {
		adminRawMock.mockResolvedValueOnce(FOUND(groupDoc(GROUP_B, ' ผู้สูงอายุ ')));

		await expect(
			createGroup({ name: 'ผู้สูงอายุ', description: null }, [], CTX, NOW)
		).rejects.toMatchObject({ code: 'CONFLICT', message: DUPLICATE_NAME_MESSAGE });
		expect(adminRawMock).toHaveBeenCalledTimes(1);
		expect(setBannerGroupMock).not.toHaveBeenCalled();
	});
});

describe('createGroup tv code', () => {
	const taken = groupDoc(GROUP_B, 'ผู้สูงอายุ', {
		schema_v: 2,
		tv_code: '111111',
		shelter_code: 'SH9'
	} as Partial<KioskBannerGroupDoc>);

	it('draws a new code when the first one is already taken', async () => {
		const generate = vi.fn().mockReturnValueOnce('111111').mockReturnValueOnce('222222');
		adminRawMock
			.mockResolvedValueOnce(FOUND())
			.mockResolvedValueOnce(FOUND(taken))
			.mockResolvedValueOnce(FOUND())
			.mockResolvedValueOnce({ status: 201, data: { ok: true, rev: '1-new' } });
		listDevicesMock.mockResolvedValue([]);

		const record = await createGroup({ name: 'ทั่วไป', description: null }, [], CTX, NOW, {
			generateTvCode: generate
		});

		expect(adminRawMock.mock.calls[1][2]).toMatchObject({
			selector: { type: 'kiosk_banner_group', tv_code: '111111' }
		});
		expect(adminRawMock.mock.calls[3][2]).toMatchObject({ tv_code: '222222' });
		expect(record).toMatchObject({ tv_code: '222222' });
	});

	it('gives up with an error after 10 taken codes and writes nothing', async () => {
		const generate = vi.fn(() => '111111');
		adminRawMock.mockResolvedValueOnce(FOUND());
		adminRawMock.mockResolvedValue(FOUND(taken));
		listDevicesMock.mockResolvedValue([]);

		await expect(
			createGroup({ name: 'ทั่วไป', description: null }, [], CTX, NOW, {
				generateTvCode: generate
			})
		).rejects.toMatchObject({ name: 'ServiceError', code: 'INTERNAL' });
		expect(generate).toHaveBeenCalledTimes(10);
		expect(adminRawMock.mock.calls.filter(([, method]) => method === 'PUT')).toHaveLength(0);
	});
});

describe('rotateTvCode', () => {
	const v2 = groupDoc(GROUP_A, 'ทั่วไป', {
		_rev: '2-b',
		schema_v: 2,
		tv_code: '111111'
	} as Partial<KioskBannerGroupDoc>);

	it('writes a fresh unused code, different from the current one, and returns the updated group', async () => {
		// The generator repeats the current code first: it counts as taken, so a new draw follows.
		const generate = vi.fn().mockReturnValueOnce('111111').mockReturnValueOnce('333333');
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: v2 })
			.mockResolvedValueOnce(FOUND(v2))
			.mockResolvedValueOnce(FOUND())
			.mockResolvedValueOnce({ status: 201, data: { ok: true, rev: '3-c' } });
		listDevicesMock.mockResolvedValueOnce([device('kiosk-1', GROUP_A)]);

		const record = await rotateTvCode(GROUP_A, NOW, { generateTvCode: generate });

		const [path, method, body] = adminRawMock.mock.calls[3];
		expect(path).toBe(`/registry/${encodeURIComponent(GROUP_A)}`);
		expect(method).toBe('PUT');
		expect(body).toEqual({
			...v2,
			schema_v: 2,
			tv_code: '333333',
			updated_at: NOW.toISOString()
		});
		expect(record).toMatchObject({
			_rev: '3-c',
			tv_code: '333333',
			updated_at: NOW.toISOString(),
			device_ids: ['kiosk-1']
		});
	});

	it('upgrades a v1 group to schema_v 2 while rotating', async () => {
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: groupDoc(GROUP_A, 'ทั่วไป') })
			.mockResolvedValueOnce(FOUND())
			.mockResolvedValueOnce({ status: 201, data: { ok: true, rev: '2-b' } });
		listDevicesMock.mockResolvedValueOnce([]);

		const record = await rotateTvCode(GROUP_A, NOW, { generateTvCode: () => '444444' });

		expect(adminRawMock.mock.calls[2][2]).toMatchObject({ schema_v: 2, tv_code: '444444' });
		expect(record).toMatchObject({ schema_v: 2, tv_code: '444444' });
	});

	it('throws GroupNotFoundError for a missing group', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 404, data: { error: 'not_found' } });

		await expect(rotateTvCode(GROUP_A, NOW)).rejects.toBeInstanceOf(GroupNotFoundError);
	});
});

describe('ensureTvCode', () => {
	it('writes a v1 group back as schema_v 2 with a fresh unused code and returns it', async () => {
		const v1 = groupDoc(GROUP_A, 'ทั่วไป');
		adminRawMock
			.mockResolvedValueOnce(FOUND())
			.mockResolvedValueOnce({ status: 201, data: { ok: true, rev: '2-b' } });

		const group = await ensureTvCode(v1, { generateTvCode: () => '555555' });

		const [path, method, body] = adminRawMock.mock.calls[1];
		expect(path).toBe(`/registry/${encodeURIComponent(GROUP_A)}`);
		expect(method).toBe('PUT');
		expect(body).toEqual({ ...v1, schema_v: 2, tv_code: '555555' });
		expect(group).toEqual({ ...v1, schema_v: 2, tv_code: '555555', _rev: '2-b' });
	});

	it('returns a v2 group unchanged without touching CouchDB', async () => {
		const v2 = groupDoc(GROUP_A, 'ทั่วไป', {
			schema_v: 2,
			tv_code: '111111'
		} as Partial<KioskBannerGroupDoc>);

		expect(await ensureTvCode(v2)).toBe(v2);
		expect(adminRawMock).not.toHaveBeenCalled();
	});
});

describe('getGroup backfill', () => {
	it('gives a v1 group its tv_code when it is read', async () => {
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: groupDoc(GROUP_A, 'ทั่วไป') })
			.mockResolvedValueOnce(FOUND())
			.mockResolvedValueOnce({ status: 201, data: { ok: true, rev: '2-b' } });
		listDevicesMock.mockResolvedValueOnce([device('kiosk-1', GROUP_A)]);

		const group = await getGroup(GROUP_A);

		expect(group).toMatchObject({
			_rev: '2-b',
			schema_v: 2,
			tv_code: expect.stringMatching(/^[0-9]{6}$/),
			device_ids: ['kiosk-1']
		});
		expect(adminRawMock.mock.calls[2][1]).toBe('PUT');
	});
});

describe('createGroup with an unknown kiosk', () => {
	it('rejects with 422 before saving, so no empty group is left behind', async () => {
		adminRawMock
			.mockResolvedValueOnce(FOUND())
			.mockResolvedValueOnce({ status: 201, data: { ok: true, rev: '1-new' } });
		listDevicesMock.mockResolvedValue([device('kiosk-1', null)]);

		await expect(
			createGroup({ name: 'ทั่วไป', description: null }, ['kiosk-other'], CTX, NOW)
		).rejects.toMatchObject({ code: 'VALIDATION' });
		expect(adminRawMock.mock.calls.filter(([, method]) => method === 'PUT')).toHaveLength(0);
	});
});

describe('updateGroup', () => {
	const current = groupDoc(GROUP_A, 'ทั่วไป', { _rev: '2-b', description: 'เดิม' });
	const other = groupDoc(GROUP_B, 'ผู้สูงอายุ');

	it('rewrites name and description under the current rev and keeps shelter and created_*', async () => {
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: current })
			.mockResolvedValueOnce(FOUND(current, other))
			.mockResolvedValueOnce({ status: 201, data: { ok: true, rev: '3-c' } });
		listDevicesMock.mockResolvedValueOnce([device('kiosk-1', GROUP_A)]);

		const record = await updateGroup(
			GROUP_A,
			'2-b',
			{ name: 'ทั่วไป (ใหม่)', description: null },
			NOW
		);

		const [path, method, body] = adminRawMock.mock.calls[2];
		expect(path).toBe(`/registry/${encodeURIComponent(GROUP_A)}`);
		expect(method).toBe('PUT');
		expect(body).toEqual({
			...current,
			name: 'ทั่วไป (ใหม่)',
			description: null,
			updated_at: NOW.toISOString()
		});
		expect(record).toMatchObject({
			_rev: '3-c',
			name: 'ทั่วไป (ใหม่)',
			shelter_code: 'SH1',
			created_by: 'alice',
			device_ids: ['kiosk-1']
		});
	});

	it('keeps its own name without a duplicate conflict', async () => {
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: current })
			.mockResolvedValueOnce(FOUND(current, other))
			.mockResolvedValueOnce({ status: 201, data: { ok: true, rev: '3-c' } });
		listDevicesMock.mockResolvedValueOnce([]);

		await expect(
			updateGroup(GROUP_A, '2-b', { name: ' ทั่วไป ', description: 'ใหม่' }, NOW)
		).resolves.toMatchObject({ _rev: '3-c' });
	});

	it('rejects a stale rev with 409 and writes nothing', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 200, data: current });

		await expect(
			updateGroup(GROUP_A, '1-old', { name: 'ใหม่', description: null }, NOW)
		).rejects.toMatchObject({ code: 'CONFLICT' });
		expect(adminRawMock).toHaveBeenCalledTimes(1);
	});

	it("rejects another group's name with 409 and writes nothing", async () => {
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: current })
			.mockResolvedValueOnce(FOUND(current, other));

		await expect(
			updateGroup(GROUP_A, '2-b', { name: 'ผู้สูงอายุ', description: null }, NOW)
		).rejects.toMatchObject({ code: 'CONFLICT', message: DUPLICATE_NAME_MESSAGE });
		expect(adminRawMock.mock.calls.filter(([, method]) => method === 'PUT')).toHaveLength(0);
	});

	it('throws GroupNotFoundError for a missing group', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 404, data: { error: 'not_found' } });

		await expect(
			updateGroup(GROUP_A, '2-b', { name: 'ใหม่', description: null }, NOW)
		).rejects.toBeInstanceOf(GroupNotFoundError);
	});
});

describe('deleteGroup', () => {
	const current = groupDoc(GROUP_A, 'ทั่วไป', { _rev: '2-b' });
	const banner = (id: string, groupId: string | undefined, endAt = '2099-01-01T00:00:00.000Z') =>
		({ _id: id, group_id: groupId, end_at: endAt }) as never;
	const deletes = () => adminRawMock.mock.calls.filter(([, method]) => method === 'DELETE');

	it('deletes the doc under the given rev, then frees its kiosks', async () => {
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: current })
			.mockResolvedValueOnce({ status: 200, data: { ok: true } });
		listBannersMock.mockResolvedValueOnce([
			banner('kiosk_banner:1', GROUP_B),
			banner('kiosk_banner:2', undefined)
		]);
		listDevicesMock.mockResolvedValueOnce([
			device('kiosk-1', GROUP_A),
			device('kiosk-2', GROUP_B),
			device('kiosk-3', GROUP_A)
		]);

		await deleteGroup(GROUP_A, '2-b', 'sm-a');

		expect(listBannersMock).toHaveBeenCalledWith('SH1');
		expect(setBannerGroupMock).toHaveBeenCalledWith(
			['scanner_device:kiosk-1', 'scanner_device:kiosk-3'],
			null,
			'sm-a'
		);
		expect(adminRawMock.mock.calls[1].slice(0, 2)).toEqual([
			`/registry/${encodeURIComponent(GROUP_A)}?rev=2-b`,
			'DELETE'
		]);
		expect(adminRawMock.mock.invocationCallOrder[1]).toBeLessThan(
			setBannerGroupMock.mock.invocationCallOrder[0]
		);
	});

	it('leaves every kiosk in the group when the delete is rejected as stale', async () => {
		adminRawMock
			.mockResolvedValueOnce({ status: 200, data: current })
			.mockResolvedValueOnce({ status: 409, data: { error: 'conflict' } });
		listBannersMock.mockResolvedValueOnce([]);
		listDevicesMock.mockResolvedValueOnce([device('kiosk-1', GROUP_A)]);

		await expect(deleteGroup(GROUP_A, '2-b', 'sm-a')).rejects.toMatchObject({
			code: 'CONFLICT'
		});
		expect(setBannerGroupMock).not.toHaveBeenCalled();
	});

	it('refuses while any banner, even an expired one, still belongs to the group', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 200, data: current });
		listBannersMock.mockResolvedValueOnce([
			banner('kiosk_banner:1', GROUP_A, '2020-01-01T00:00:00.000Z')
		]);

		await expect(deleteGroup(GROUP_A, '2-b', 'sm-a')).rejects.toMatchObject({
			code: 'CONFLICT',
			message: 'ลบกลุ่มไม่ได้ ยังมีแบนเนอร์ในกลุ่ม'
		});
		expect(setBannerGroupMock).not.toHaveBeenCalled();
		expect(deletes()).toHaveLength(0);
	});

	it('refuses a stale rev before touching any kiosk', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 200, data: current });

		await expect(deleteGroup(GROUP_A, '1-old', 'sm-a')).rejects.toMatchObject({
			code: 'CONFLICT'
		});
		expect(setBannerGroupMock).not.toHaveBeenCalled();
		expect(deletes()).toHaveLength(0);
	});

	it('throws GroupNotFoundError for a missing group', async () => {
		adminRawMock.mockResolvedValueOnce({ status: 404, data: { error: 'not_found' } });

		await expect(deleteGroup(GROUP_A, '2-b', 'sm-a')).rejects.toBeInstanceOf(GroupNotFoundError);
	});
});

describe('findGroupByTvCode', () => {
	it('returns the group whose tv_code matches, whatever its shelter, or null when none does', async () => {
		const other = groupDoc(GROUP_B, 'ผู้สูงอายุ', {
			schema_v: 2,
			tv_code: '123456',
			shelter_code: 'SH9'
		} as Partial<KioskBannerGroupDoc>);
		adminRawMock.mockResolvedValueOnce(FOUND(other));

		expect(await findGroupByTvCode('123456')).toEqual(other);
		expect(adminRawMock.mock.calls[0]).toEqual([
			'/registry/_find',
			'POST',
			expect.objectContaining({
				selector: { type: 'kiosk_banner_group', tv_code: '123456' }
			})
		]);

		adminRawMock.mockResolvedValueOnce(FOUND());
		expect(await findGroupByTvCode('654321')).toBeNull();
	});

	it('returns null for a malformed code without querying CouchDB', async () => {
		for (const bad of ['', '12345', '1234567', 'abcdef', '12 456']) {
			expect(await findGroupByTvCode(bad)).toBeNull();
		}
		expect(adminRawMock).not.toHaveBeenCalled();
	});
});
