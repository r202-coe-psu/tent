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
	getGroup,
	listGroups,
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
		adminRawMock.mockResolvedValueOnce({ status: 200, data: groupDoc(GROUP_A, 'ทั่วไป') });
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
			.mockResolvedValueOnce({ status: 201, data: { ok: true, id: 'x', rev: '1-new' } });
		listDevicesMock.mockResolvedValue([device('kiosk-1', null), device('kiosk-2', GROUP_B)]);

		const record = await createGroup(
			{ name: 'ทั่วไป', description: 'ทุกจอ' },
			['kiosk-1'],
			CTX,
			NOW
		);

		const [path, method, body] = adminRawMock.mock.calls[1];
		expect(method).toBe('PUT');
		expect(path).toBe(`/registry/${encodeURIComponent(record._id)}`);
		expect(body).toMatchObject({
			_id: record._id,
			type: 'kiosk_banner_group',
			schema_v: 1,
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
