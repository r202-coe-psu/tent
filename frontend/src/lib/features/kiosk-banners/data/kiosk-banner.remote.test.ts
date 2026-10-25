import { afterEach, describe, expect, it, vi } from 'vitest';
import type { KioskBannerInput } from '../domain/kiosk-banner';
import { KioskBannerApiError } from './kiosk-banner.repository';
import {
	kioskBannerGroupRemoteRepository as groupRepo,
	kioskBannerRemoteRepository as repo
} from './kiosk-banner.remote';

const fetchMock = vi.fn<typeof fetch>();
vi.stubGlobal('fetch', fetchMock);

const BASE = '/api/back-office/kiosk-banners';

const summary = {
	_id: 'kiosk_banner:01J',
	_rev: '1-abc',
	type: 'kiosk_banner',
	schema_v: 1,
	shelter_code: 'SH-01',
	title: 'ประกาศ',
	caption: null,
	order: 1,
	duration_sec: 10,
	start_at: '2026-10-14T17:00:00.000Z',
	end_at: '2026-10-20T17:00:00.000Z',
	status: 'active',
	created_at: '2026-10-14T00:00:00.000Z',
	updated_at: '2026-10-14T00:00:00.000Z',
	created_by: 'Somchai',
	image_content_type: 'image/png'
};

const input: KioskBannerInput = {
	group_id: 'kiosk_banner_group:A',
	title: 'ประกาศ',
	caption: null,
	duration_sec: 10,
	start_at: '2026-10-14T17:00:00.000Z',
	end_at: '2026-10-20T17:00:00.000Z',
	status: 'active',
	screen_type: 'portrait'
};
const image = { content_type: 'image/png', data_base64: 'iVBORw==' };

function respond(status: number, body?: unknown): Response {
	return new Response(body === undefined ? null : JSON.stringify(body), {
		status,
		headers: { 'content-type': 'application/json' }
	});
}

const lastCall = () => {
	const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit | undefined];
	return { url, init: init ?? {} };
};

afterEach(() => fetchMock.mockReset());

describe('list', () => {
	it('GETs the shelter and view as query params and parses the rows', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, [summary]));
		const rows = await repo.list('SH-01', 'expired');
		const { url, init } = lastCall();
		expect(url).toBe(`${BASE}?shelter_code=SH-01&view=expired`);
		expect(init.method ?? 'GET').toBe('GET');
		expect(init.cache).toBe('no-store');
		expect(rows).toHaveLength(1);
		expect(rows[0]._rev).toBe('1-abc');
		expect(rows[0].image_content_type).toBe('image/png');
	});

	it('keeps screen_type on parsed rows; a legacy row has none', async () => {
		fetchMock.mockResolvedValueOnce(
			respond(200, [{ ...summary, screen_type: 'portrait' }, summary])
		);
		const rows = await repo.list('SH-01', 'current');
		expect(rows[0].screen_type).toBe('portrait');
		expect(rows[1].screen_type).toBeUndefined();
	});

	it('encodes the shelter code', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, []));
		await repo.list('SH 01&x', 'current');
		expect(lastCall().url).toBe(`${BASE}?shelter_code=SH%2001%26x&view=current`);
	});

	it('rejects a malformed payload', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, [{ _id: 'kiosk_banner:1' }]));
		await expect(repo.list('SH-01', 'current')).rejects.toThrow();
	});
});

describe('get', () => {
	it('GETs the encoded id', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, summary));
		const banner = await repo.get('kiosk_banner:01J');
		expect(lastCall().url).toBe(`${BASE}/kiosk_banner%3A01J`);
		expect(banner._id).toBe('kiosk_banner:01J');
	});
});

describe('create', () => {
	it('POSTs fields + image with shelter_code only in the query', async () => {
		fetchMock.mockResolvedValueOnce(respond(201, summary));
		const created = await repo.create('SH-01', input, image);
		const { url, init } = lastCall();
		expect(url).toBe(`${BASE}?shelter_code=SH-01`);
		expect(init.method).toBe('POST');
		expect(new Headers(init.headers).get('content-type')).toBe('application/json');
		const body = JSON.parse(init.body as string);
		expect(body).toEqual({ ...input, image });
		expect(body.screen_type).toBe('portrait');
		expect(body).not.toHaveProperty('shelter_code');
		expect(created._rev).toBe('1-abc');
	});
});

describe('update', () => {
	it('PUTs _rev + fields + image', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, summary));
		await repo.update('kiosk_banner:01J', '1-abc', input, image);
		const { url, init } = lastCall();
		expect(url).toBe(`${BASE}/kiosk_banner%3A01J`);
		expect(init.method).toBe('PUT');
		const body = JSON.parse(init.body as string);
		expect(body).toEqual({ _rev: '1-abc', ...input, image });
		expect(body.screen_type).toBe('portrait');
	});

	it('omits image when none is replaced', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, summary));
		await repo.update('kiosk_banner:01J', '1-abc', input);
		const body = JSON.parse(lastCall().init.body as string);
		expect(body).toEqual({ _rev: '1-abc', ...input });
		expect(body).not.toHaveProperty('image');
	});
});

describe('setStatus', () => {
	it('PATCHes _rev and status only', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, { ...summary, status: 'inactive' }));
		const banner = await repo.setStatus('kiosk_banner:01J', '1-abc', 'inactive');
		const { url, init } = lastCall();
		expect(url).toBe(`${BASE}/kiosk_banner%3A01J`);
		expect(init.method).toBe('PATCH');
		expect(JSON.parse(init.body as string)).toEqual({ _rev: '1-abc', status: 'inactive' });
		expect(banner.status).toBe('inactive');
	});
});

describe('remove', () => {
	it('DELETEs with rev in the query and accepts 204', async () => {
		fetchMock.mockResolvedValueOnce(respond(204));
		await expect(repo.remove('kiosk_banner:01J', '1-abc')).resolves.toBeUndefined();
		const { url, init } = lastCall();
		expect(url).toBe(`${BASE}/kiosk_banner%3A01J?rev=1-abc`);
		expect(init.method).toBe('DELETE');
	});
});

describe('reorder', () => {
	it('PUTs the slot (group and screen type) and mapped items to the order route and parses the rows', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, [summary]));
		const rows = await repo.reorder(
			'SH 01',
			{ groupId: 'kiosk_banner_group:A', screenType: 'portrait' },
			[
				{ id: 'kiosk_banner:01J', rev: '1-abc' },
				{ id: 'kiosk_banner:02K', rev: '3-def' }
			]
		);
		const { url, init } = lastCall();
		expect(url).toBe(`${BASE}/order?shelter_code=SH%2001`);
		expect(init.method).toBe('PUT');
		expect(new Headers(init.headers).get('content-type')).toBe('application/json');
		expect(JSON.parse(init.body as string)).toEqual({
			group_id: 'kiosk_banner_group:A',
			screen_type: 'portrait',
			items: [
				{ id: 'kiosk_banner:01J', _rev: '1-abc' },
				{ id: 'kiosk_banner:02K', _rev: '3-def' }
			]
		});
		expect(rows).toHaveLength(1);
		expect(rows[0]._rev).toBe('1-abc');
	});

	it('rejects a 409 with KioskBannerApiError', async () => {
		fetchMock.mockResolvedValueOnce(
			respond(409, { error: { code: 'CONFLICT', message: 'List changed' } })
		);
		const error = await repo
			.reorder('SH-01', { groupId: 'kiosk_banner_group:A', screenType: 'compact' }, [])
			.catch((e) => e);
		expect(error).toBeInstanceOf(KioskBannerApiError);
		expect(error).toMatchObject({ status: 409, code: 'CONFLICT' });
	});
});

describe('imageUrl', () => {
	it('points at the image route', () => {
		expect(repo.imageUrl('kiosk_banner:01J')).toBe(`${BASE}/kiosk_banner%3A01J/image`);
	});

	it('appends the rev as a cache buster', () => {
		expect(repo.imageUrl('kiosk_banner:01J', '2-def')).toBe(
			`${BASE}/kiosk_banner%3A01J/image?v=2-def`
		);
	});
});

describe('errors', () => {
	it.each([
		[409, 'CONFLICT', 'Document update conflict'],
		[422, 'VALIDATION', 'รูปภาพต้องมีขนาดไม่เกิน 2 MB'],
		[404, 'NOT_FOUND', 'Banner not found'],
		[403, 'FORBIDDEN', 'Not a shelter_manager'],
		[401, 'UNAUTHORIZED', 'Unauthorized']
	])(
		'maps %i to KioskBannerApiError with status, code and message',
		async (status, code, message) => {
			fetchMock.mockResolvedValueOnce(respond(status, { error: { code, message } }));
			const error = await repo.setStatus('kiosk_banner:01J', '1-abc', 'active').catch((e) => e);
			expect(error).toBeInstanceOf(KioskBannerApiError);
			expect(error).toMatchObject({ status, code, message });
		}
	);

	it('applies to every method, including DELETE', async () => {
		fetchMock.mockResolvedValueOnce(
			respond(409, { error: { code: 'CONFLICT', message: 'Document update conflict' } })
		);
		await expect(repo.remove('kiosk_banner:01J', '1-old')).rejects.toMatchObject({
			status: 409,
			code: 'CONFLICT'
		});
	});

	it('falls back to a generic code and message for a non-envelope body', async () => {
		fetchMock.mockResolvedValueOnce(new Response('<html>bad gateway</html>', { status: 502 }));
		const error = await repo.get('kiosk_banner:01J').catch((e) => e);
		expect(error).toBeInstanceOf(KioskBannerApiError);
		expect(error.status).toBe(502);
		expect(error.code).toBe('UNKNOWN');
		expect(error.message).toBeTruthy();
	});
});

describe('banner groups', () => {
	const GROUP_BASE = '/api/back-office/kiosk-banner-groups';
	const group = {
		_id: 'kiosk_banner_group:01G',
		_rev: '1-g',
		type: 'kiosk_banner_group',
		schema_v: 1,
		shelter_code: 'SH-01',
		name: 'ล็อบบี้',
		description: null,
		created_at: '2026-10-14T00:00:00.000Z',
		updated_at: '2026-10-14T00:00:00.000Z',
		created_by: 'Somchai',
		device_ids: ['scanner_device:1', 'scanner_device:2']
	};
	const groupPutJson = { 'content-type': 'application/json' };

	it('list GETs the encoded shelter code and parses the summaries with their devices', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, [group]));
		const rows = await groupRepo.list('SH 01&x');
		const { url, init } = lastCall();
		expect(url).toBe(`${GROUP_BASE}?shelter_code=SH%2001%26x`);
		expect(init.method ?? 'GET').toBe('GET');
		expect(init.cache).toBe('no-store');
		expect(rows[0]._rev).toBe('1-g');
		expect(rows[0].device_ids).toEqual(['scanner_device:1', 'scanner_device:2']);
	});

	it('list rejects a row without device_ids', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, [{ ...group, device_ids: undefined }]));
		await expect(groupRepo.list('SH-01')).rejects.toThrow();
	});

	it('get GETs the encoded id', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, group));
		const got = await groupRepo.get('kiosk_banner_group:01G');
		expect(lastCall().url).toBe(`${GROUP_BASE}/kiosk_banner_group%3A01G`);
		expect(got.name).toBe('ล็อบบี้');
	});

	it('create POSTs name, description and device_ids with shelter_code in the query', async () => {
		fetchMock.mockResolvedValueOnce(respond(201, group));
		const created = await groupRepo.create('SH-01', { name: 'ล็อบบี้', description: 'ชั้น 1' }, [
			'scanner_device:1'
		]);
		const { url, init } = lastCall();
		expect(url).toBe(`${GROUP_BASE}?shelter_code=SH-01`);
		expect(init.method).toBe('POST');
		expect(init.headers).toEqual(groupPutJson);
		expect(JSON.parse(init.body as string)).toEqual({
			name: 'ล็อบบี้',
			description: 'ชั้น 1',
			device_ids: ['scanner_device:1']
		});
		expect(created._id).toBe('kiosk_banner_group:01G');
	});

	it('update PUTs _rev with name and description', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, group));
		await groupRepo.update('kiosk_banner_group:01G', '1-g', { name: 'ล็อบบี้ 2' });
		const { url, init } = lastCall();
		expect(url).toBe(`${GROUP_BASE}/kiosk_banner_group%3A01G`);
		expect(init.method).toBe('PUT');
		expect(JSON.parse(init.body as string)).toEqual({ _rev: '1-g', name: 'ล็อบบี้ 2' });
	});

	it('remove DELETEs with rev in the query and accepts 204', async () => {
		fetchMock.mockResolvedValueOnce(respond(204));
		await expect(groupRepo.remove('kiosk_banner_group:01G', '1-g')).resolves.toBeUndefined();
		const { url, init } = lastCall();
		expect(url).toBe(`${GROUP_BASE}/kiosk_banner_group%3A01G?rev=1-g`);
		expect(init.method).toBe('DELETE');
	});

	it('remove surfaces the server message when the group still has banners (409)', async () => {
		const message = 'ลบกลุ่มไม่ได้ เพราะยังมีแบนเนอร์อยู่';
		fetchMock.mockResolvedValueOnce(respond(409, { error: { code: 'CONFLICT', message } }));
		const error = await groupRepo.remove('kiosk_banner_group:01G', '1-g').catch((e) => e);
		expect(error).toBeInstanceOf(KioskBannerApiError);
		expect(error).toMatchObject({ status: 409, code: 'CONFLICT', message });
	});

	it('setDevices PUTs device_ids to the devices sub-route and parses the summary', async () => {
		fetchMock.mockResolvedValueOnce(respond(200, { ...group, device_ids: ['scanner_device:3'] }));
		const updated = await groupRepo.setDevices('kiosk_banner_group:01G', ['scanner_device:3']);
		const { url, init } = lastCall();
		expect(url).toBe(`${GROUP_BASE}/kiosk_banner_group%3A01G/devices`);
		expect(init.method).toBe('PUT');
		expect(JSON.parse(init.body as string)).toEqual({ device_ids: ['scanner_device:3'] });
		expect(updated.device_ids).toEqual(['scanner_device:3']);
	});
});
