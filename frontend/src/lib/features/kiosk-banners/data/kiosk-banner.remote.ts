import { z } from 'zod';
import type { KioskScreenType } from '$lib/features/shared/domain/kiosk-screen';
import type { KioskBannerInput } from '../domain/kiosk-banner';
import type { KioskBannerGroupInput } from '../domain/kiosk-banner-group';
import type { BannerImagePayload } from './kiosk-banner-file';
import {
	KioskBannerApiError,
	kioskBannerGroupSummarySchema,
	kioskBannerSummarySchema,
	type KioskBannerGroupRepository,
	type KioskBannerRepository,
	type KioskBannerStatus,
	type KioskBannerView
} from './kiosk-banner.repository';

const BASE = '/api/back-office/kiosk-banners';

const itemPath = (id: string) => `${BASE}/${encodeURIComponent(id)}`;

function envelope(payload: unknown): { code: string; message: string } | null {
	const error = (payload as { error?: unknown } | null)?.error;
	if (!error || typeof error !== 'object') return null;
	const { code, message } = error as { code?: unknown; message?: unknown };
	return {
		code: typeof code === 'string' ? code : 'UNKNOWN',
		message: typeof message === 'string' ? message : ''
	};
}

async function failure(response: Response): Promise<KioskBannerApiError> {
	const payload: unknown = await response.json().catch(() => null);
	const parsed = envelope(payload);
	return new KioskBannerApiError(
		response.status,
		parsed?.code ?? 'UNKNOWN',
		parsed?.message || `คำขอไม่สำเร็จ (${response.status})`
	);
}

async function request(url: string, init: RequestInit = {}): Promise<Response> {
	const response = await fetch(url, { cache: 'no-store', ...init });
	if (!response.ok) throw await failure(response);
	return response;
}

const jsonInit = (method: string, body: unknown): RequestInit => ({
	method,
	headers: { 'content-type': 'application/json' },
	body: JSON.stringify(body)
});

const parseOne = async (response: Response) =>
	kioskBannerSummarySchema.parse(await response.json());

export const kioskBannerRemoteRepository: KioskBannerRepository = {
	async list(shelterCode: string, view: KioskBannerView) {
		const query = `shelter_code=${encodeURIComponent(shelterCode)}&view=${view}`;
		const response = await request(`${BASE}?${query}`);
		return z.array(kioskBannerSummarySchema).parse(await response.json());
	},

	async get(id: string) {
		return parseOne(await request(itemPath(id)));
	},

	async create(shelterCode: string, input: KioskBannerInput, image: BannerImagePayload) {
		const url = `${BASE}?shelter_code=${encodeURIComponent(shelterCode)}`;
		return parseOne(await request(url, jsonInit('POST', { ...input, image })));
	},

	async update(id: string, rev: string, input: KioskBannerInput, image?: BannerImagePayload) {
		const body = image ? { _rev: rev, ...input, image } : { _rev: rev, ...input };
		return parseOne(await request(itemPath(id), jsonInit('PUT', body)));
	},

	async setStatus(id: string, rev: string, status: KioskBannerStatus) {
		return parseOne(await request(itemPath(id), jsonInit('PATCH', { _rev: rev, status })));
	},

	async remove(id: string, rev: string) {
		await request(`${itemPath(id)}?rev=${encodeURIComponent(rev)}`, { method: 'DELETE' });
	},

	async reorder(
		shelterCode: string,
		slot: { groupId: string; screenType: KioskScreenType },
		items: { id: string; rev: string }[]
	) {
		const url = `${BASE}/order?shelter_code=${encodeURIComponent(shelterCode)}`;
		const body = {
			group_id: slot.groupId,
			screen_type: slot.screenType,
			items: items.map(({ id, rev }) => ({ id, _rev: rev }))
		};
		const response = await request(url, jsonInit('PUT', body));
		return z.array(kioskBannerSummarySchema).parse(await response.json());
	},

	imageUrl(id: string, rev?: string) {
		const url = `${itemPath(id)}/image`;
		return rev ? `${url}?v=${encodeURIComponent(rev)}` : url;
	}
};

const GROUP_BASE = '/api/back-office/kiosk-banner-groups';

const groupPath = (id: string) => `${GROUP_BASE}/${encodeURIComponent(id)}`;

const parseGroup = async (response: Response) =>
	kioskBannerGroupSummarySchema.parse(await response.json());

export const kioskBannerGroupRemoteRepository: KioskBannerGroupRepository = {
	async list(shelterCode: string) {
		const response = await request(`${GROUP_BASE}?shelter_code=${encodeURIComponent(shelterCode)}`);
		return z.array(kioskBannerGroupSummarySchema).parse(await response.json());
	},

	async get(id: string) {
		return parseGroup(await request(groupPath(id)));
	},

	async create(shelterCode: string, input: KioskBannerGroupInput, deviceIds: string[]) {
		const url = `${GROUP_BASE}?shelter_code=${encodeURIComponent(shelterCode)}`;
		return parseGroup(await request(url, jsonInit('POST', { ...input, device_ids: deviceIds })));
	},

	async update(id: string, rev: string, input: KioskBannerGroupInput) {
		return parseGroup(await request(groupPath(id), jsonInit('PUT', { _rev: rev, ...input })));
	},

	async remove(id: string, rev: string) {
		await request(`${groupPath(id)}?rev=${encodeURIComponent(rev)}`, { method: 'DELETE' });
	},

	async setDevices(id: string, deviceIds: string[]) {
		const url = `${groupPath(id)}/devices`;
		return parseGroup(await request(url, jsonInit('PUT', { device_ids: deviceIds })));
	}
};
