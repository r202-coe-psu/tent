import { adminRaw, ServiceError } from '$lib/server/couch-admin';
import {
	createKioskBannerGroup,
	groupOf,
	isDuplicateGroupName,
	type KioskBannerGroupContext,
	type KioskBannerGroupDoc,
	type KioskBannerGroupInput
} from '$lib/features/kiosk-banners';
import { scannerDeviceRepository } from '$lib/server/scanners/device-repository';
import { GroupNotFoundError, listBannersForShelter } from './kiosk-banner.server';

/** Group doc plus the `device_id` of every kiosk of its shelter that is fed from it. */
export type KioskBannerGroupRecord = KioskBannerGroupDoc & { device_ids: string[] };

const REGISTRY_DB = 'registry';
const LIST_LIMIT = 200;

const docPath = (id: string): string => `/${REGISTRY_DB}/${encodeURIComponent(id)}`;

function couchDetail(data: unknown): string {
	const d = (data as { reason?: string; error?: string } | null) ?? {};
	return d.reason ?? d.error ?? 'unknown';
}

/** Served by the registry `(type, shelter_code)` Mango index. */
async function findGroupDocs(shelterCode: string): Promise<KioskBannerGroupDoc[]> {
	const res = await adminRaw(`/${REGISTRY_DB}/_find`, 'POST', {
		selector: { type: 'kiosk_banner_group', shelter_code: shelterCode },
		limit: LIST_LIMIT
	});
	if (res.status >= 400) {
		throw new ServiceError(
			'INTERNAL',
			`Could not list banner groups (${res.status}): ${couchDetail(res.data)}`
		);
	}
	return (res.data as { docs: KioskBannerGroupDoc[] }).docs;
}

export async function listGroups(shelterCode: string): Promise<KioskBannerGroupRecord[]> {
	const [groups, devices] = await Promise.all([
		findGroupDocs(shelterCode),
		scannerDeviceRepository.listDevices([shelterCode])
	]);
	return groups.map((group) => ({
		...group,
		device_ids: devices.filter((d) => d.banner_group_id === group._id).map((d) => d.device_id)
	}));
}

/** The group doc, or null when the id is missing or is not a banner group. */
export async function readGroupDoc(id: string): Promise<KioskBannerGroupDoc | null> {
	const res = await adminRaw(docPath(id), 'GET');
	if (res.status === 404) return null;
	if (res.status >= 400) {
		throw new ServiceError('INTERNAL', `Could not read banner group ${id} (${res.status})`);
	}
	const doc = res.data as KioskBannerGroupDoc;
	return doc.type === 'kiosk_banner_group' ? doc : null;
}

export async function getGroup(id: string): Promise<KioskBannerGroupRecord | null> {
	const group = await readGroupDoc(id);
	if (!group) return null;
	const devices = await scannerDeviceRepository.listDevices([group.shelter_code]);
	return {
		...group,
		device_ids: devices.filter((d) => d.banner_group_id === group._id).map((d) => d.device_id)
	};
}

function assertDevicesInShelter(devices: { device_id: string }[], deviceIds: string[]): void {
	const known = new Set(devices.map((d) => d.device_id));
	if (deviceIds.some((id) => !known.has(id))) {
		throw new ServiceError('VALIDATION', 'อุปกรณ์ไม่ได้อยู่ในศูนย์ของกลุ่มนี้');
	}
}

const DUPLICATE_NAME_MESSAGE = 'ชื่อกลุ่มซ้ำกับกลุ่มอื่นในศูนย์นี้';
const STALE_GROUP_MESSAGE = 'มีผู้อื่นแก้ไขกลุ่มนี้ โปรดโหลดใหม่';

async function putGroupDoc(doc: KioskBannerGroupDoc): Promise<KioskBannerGroupDoc> {
	const res = await adminRaw(docPath(doc._id), 'PUT', doc);
	if (res.status === 409) {
		throw new ServiceError('CONFLICT', STALE_GROUP_MESSAGE);
	}
	if (res.status >= 400) {
		throw new ServiceError(
			'INTERNAL',
			`Could not save banner group ${doc._id} (${res.status}): ${couchDetail(res.data)}`
		);
	}
	return { ...doc, _rev: (res.data as { rev: string }).rev };
}

export async function createGroup(
	input: KioskBannerGroupInput,
	deviceIds: string[],
	ctx: KioskBannerGroupContext,
	now: Date = new Date()
): Promise<KioskBannerGroupRecord> {
	// Best effort: CouchDB has no unique constraint, so two concurrent creates can both pass.
	if (isDuplicateGroupName(await findGroupDocs(ctx.shelterCode), input.name)) {
		throw new ServiceError('CONFLICT', DUPLICATE_NAME_MESSAGE);
	}
	// Validate before saving so a bad device id does not leave an empty group behind.
	assertDevicesInShelter(await scannerDeviceRepository.listDevices([ctx.shelterCode]), deviceIds);
	const saved = await putGroupDoc(createKioskBannerGroup(input, ctx, now));
	return setGroupDevices(saved, deviceIds, ctx.createdBy);
}

export async function updateGroup(
	id: string,
	rev: string,
	input: KioskBannerGroupInput,
	now: Date = new Date()
): Promise<KioskBannerGroupRecord> {
	const current = await readGroupDoc(id);
	if (!current) throw new GroupNotFoundError(id);
	if (current._rev !== rev) {
		throw new ServiceError('CONFLICT', STALE_GROUP_MESSAGE);
	}
	if (isDuplicateGroupName(await findGroupDocs(current.shelter_code), input.name, id)) {
		throw new ServiceError('CONFLICT', DUPLICATE_NAME_MESSAGE);
	}
	const saved = await putGroupDoc({
		...current,
		name: input.name,
		description: input.description,
		updated_at: now.toISOString()
	});
	const devices = await scannerDeviceRepository.listDevices([saved.shelter_code]);
	return {
		...saved,
		device_ids: devices.filter((d) => d.banner_group_id === id).map((d) => d.device_id)
	};
}

export async function setGroupDevices(
	group: KioskBannerGroupDoc,
	deviceIds: string[],
	by: string
): Promise<KioskBannerGroupRecord> {
	const devices = await scannerDeviceRepository.listDevices([group.shelter_code]);
	assertDevicesInShelter(devices, deviceIds);
	const wanted = new Set(deviceIds);
	const toAdd = devices.filter((d) => wanted.has(d.device_id) && d.banner_group_id !== group._id);
	const toFree = devices.filter((d) => !wanted.has(d.device_id) && d.banner_group_id === group._id);
	if (toAdd.length) {
		await scannerDeviceRepository.setBannerGroup(
			toAdd.map((d) => d._id),
			group._id,
			by
		);
	}
	if (toFree.length) {
		await scannerDeviceRepository.setBannerGroup(
			toFree.map((d) => d._id),
			null,
			by
		);
	}
	return {
		...group,
		device_ids: devices.filter((d) => wanted.has(d.device_id)).map((d) => d.device_id)
	};
}

export async function deleteGroup(id: string, rev: string, by: string): Promise<void> {
	const group = await readGroupDoc(id);
	if (!group) throw new GroupNotFoundError(id);
	if (group._rev !== rev) {
		throw new ServiceError('CONFLICT', STALE_GROUP_MESSAGE);
	}
	const banners = await listBannersForShelter(group.shelter_code);
	if (banners.some((b) => groupOf(b) === id)) {
		throw new ServiceError('CONFLICT', 'ลบกลุ่มไม่ได้ ยังมีแบนเนอร์ในกลุ่ม');
	}
	// Delete first (FR-KBG-06): a failed delete leaves the group and its kiosks untouched, and a
	// kiosk left pointing at a deleted group simply gets an empty feed.
	const res = await adminRaw(`${docPath(id)}?rev=${encodeURIComponent(rev)}`, 'DELETE');
	if (res.status === 404) throw new GroupNotFoundError(id);
	if (res.status === 409) {
		throw new ServiceError('CONFLICT', STALE_GROUP_MESSAGE);
	}
	if (res.status >= 400) {
		throw new ServiceError(
			'INTERNAL',
			`Could not delete banner group ${id} (${res.status}): ${couchDetail(res.data)}`
		);
	}
	const devices = await scannerDeviceRepository.listDevices([group.shelter_code]);
	const members = devices.filter((d) => d.banner_group_id === id);
	if (members.length) {
		await scannerDeviceRepository.setBannerGroup(
			members.map((d) => d._id),
			null,
			by
		);
	}
}
