import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	ServiceError,
	serviceOrHttpError,
	requireShelterScopeOrSA,
	requireShelterManagerOrSA
} from '$lib/server/couch-admin';
import {
	updateShelterSchema,
	EMPTY_ADMISSION_POLICY,
	EMPTY_LUGGAGE_POLICY,
	EMPTY_PARKING_POLICY,
	DEFAULT_SHELTER_FEATURE_FLAGS,
	DEFAULT_SITE_KIND,
	resolveOperationStatus,
	type ShelterMaster,
	validateSiteKindChange
} from '$lib/features/shelters/server';
import { readMasterDoc } from '$lib/server/master-data-server';
import { findMasterByCode, migrate, nowIso, updateMaster } from '$lib/server/shelters.admin';

export const prerender = false;

export const GET: RequestHandler = async ({ request, params }) => {
	const code = params.code;
	if (!code) return error(400, { message: 'Missing code' });

	try {
		await requireShelterScopeOrSA(request.headers.get('cookie'), code);

		const master = await findMasterByCode(code);
		if (!master) return error(404, { message: `Shelter "${code}" not found` });

		const migrated = migrate(master);
		return json({
			code: migrated.code,
			_rev: migrated._rev,
			name: migrated.name,
			site_kind: migrated.site_kind ?? DEFAULT_SITE_KIND,
			db: `shelter_${migrated.code.toLowerCase()}`,
			operation_status: migrated.operation_status ?? 'standby',
			capacity: migrated.capacity ?? 0,
			shelter_type: migrated.shelter_type ?? null,
			floor_count: migrated.floor_count ?? null,
			project_level: migrated.project_level ?? null,
			location: migrated.location ?? {},
			contact: migrated.contact ?? {},
			municipality_zone: migrated.municipality_zone ?? null,
			community: migrated.community ?? null,
			address_no: migrated.address_no ?? null,
			village_no: migrated.village_no ?? null,
			subdistrict: migrated.subdistrict ?? null,
			district: migrated.district ?? null,
			province: migrated.province ?? null,
			postal_code: migrated.postal_code ?? null,
			key_personnel: migrated.key_personnel ?? null,
			area_m2: migrated.area_m2 ?? null,
			area_type: migrated.area_type ?? null,
			facilities: migrated.facilities ?? {},
			common_areas: migrated.common_areas ?? { sub_storage: [] },
			utilities: migrated.utilities ?? { communications: [] },
			risk: migrated.risk ?? {},
			zones: migrated.zones ?? [],
			food_distribution_points: migrated.food_distribution_points ?? [],
			admission_policy: migrated.admission_policy ?? EMPTY_ADMISSION_POLICY,
			luggage_policy: migrated.luggage_policy ?? EMPTY_LUGGAGE_POLICY,
			parking_policy: migrated.parking_policy ?? EMPTY_PARKING_POLICY,
			feature_flags: migrated.feature_flags ?? { ...DEFAULT_SHELTER_FEATURE_FLAGS },
			created_at: migrated.created_at ?? '',
			updated_at: migrated.updated_at ?? ''
		});
	} catch (e) {
		return serviceOrHttpError(e);
	}
};

export const PATCH: RequestHandler = async ({ request, params }) => {
	const code = params.code;
	if (!code) return error(400, { message: 'Missing code' });

	try {
		await requireShelterManagerOrSA(request.headers.get('cookie'), code);

		const body = (await request.json().catch(() => ({}))) as unknown;
		const input = updateShelterSchema.parse(body);
		// zod 4 `.partial()` still fills field `.default()`s, so a body without
		// `operation_status` or `feature_flags` would reset them; patch only what was sent.
		const sent = body !== null && typeof body === 'object' ? body : {};
		const patch: Record<string, unknown> = Object.fromEntries(
			Object.entries(input).filter(([key]) => key in sent)
		);
		// `updateShelterSchema` strips `_rev`; read it raw. It is a precondition, never part of the patch.
		const rev = (sent as { _rev?: unknown })._rev;
		if (typeof rev !== 'string' || rev === '') {
			throw new ServiceError('VALIDATION', 'ต้องระบุ _rev ของข้อมูลศูนย์ที่อ่านมา');
		}
		// `commonAreasSchema.sub_storage` defaults to [] and PATCH replaces `common_areas` wholesale,
		// so decide from the raw body whether the form sent the storage points at all.
		const rawCommonAreas = (sent as { common_areas?: unknown }).common_areas;
		const sentSubStorage =
			rawCommonAreas !== null &&
			typeof rawCommonAreas === 'object' &&
			'sub_storage' in rawCommonAreas;

		const siteKindItems = input.site_kind ? ((await readMasterDoc('site_kind'))?.items ?? []) : [];

		// updateMaster re-reads the doc + retries 409s internally
		// (skill: couchdb-pouchdb-bestpractices §3) and owns `closed_at`.
		await updateMaster(code, (current) => {
			// Optimistic concurrency: re-checked against the fresh doc on every updateMaster retry.
			if (current._rev !== rev) {
				throw new ServiceError(
					'CONFLICT',
					'ข้อมูลศูนย์ถูกแก้ไขโดยผู้อื่น กรุณาโหลดใหม่แล้วลองอีกครั้ง'
				);
			}
			// CR-219 FR-22: closing must go through the close route, which checks people out first.
			// A save that keeps an already-closed shelter closed is fine.
			if (patch.operation_status === 'closed' && resolveOperationStatus(current) !== 'closed') {
				error(400, {
					message: 'ปิดศูนย์ต้องทำผ่าน POST /api/back-office/shelter/[code]/close'
				});
			}
			if (input.site_kind) {
				// FR-8: compared with the stored kind of the doc being written, so a retry sees the winner's value.
				const siteKindError = validateSiteKindChange(
					input.site_kind,
					siteKindItems,
					current.site_kind
				);
				if (siteKindError) throw new ServiceError('VALIDATION', siteKindError);
			}
			const next: Record<string, unknown> = { ...patch, updated_at: nowIso() };
			if (input.common_areas && !sentSubStorage) {
				// Keep the points added elsewhere (e.g. via /storage-points) since the form loaded.
				next.common_areas = {
					...input.common_areas,
					sub_storage: current.common_areas?.sub_storage ?? []
				};
			}
			return { patch: next as Partial<ShelterMaster> };
		});

		return json({ ok: true, code });
	} catch (e) {
		// The guard's 403 / the close-block 400 keep their status (CR-219 FR-22).
		return serviceOrHttpError(e);
	}
};
