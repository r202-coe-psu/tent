import {
	publicConfigBodySchema,
	DEFAULT_PUBLIC_PORTAL_CONFIG,
	type PublicConfigBody
} from '$lib/features/public-portal';
import type { PageServerLoad, Actions } from './$types';
import { adminRaw, authorizeUserWrite, ServiceError } from '$lib/server/couch-admin';
import {
	preservedLogoFields,
	readPublicPortalConfig,
	type PublicPortalConfigRaw
} from '$lib/server/public-portal/footer-logos.server';
import { fail, error } from '@sveltejs/kit';

// We store the public configuration in the registry DB
const CONFIG_DOC_PATH = '/registry/config:public_portal';

export const load: PageServerLoad = async ({ request }) => {
	// Require SA or Manager to view this page
	try {
		await authorizeUserWrite(request.headers.get('cookie'));
	} catch (e) {
		if (e instanceof ServiceError) {
			throw error(e.code === 'UNAUTHENTICATED' ? 401 : 403, e.message);
		}
		throw error(500, 'Internal Server Error');
	}

	// Fetch existing config
	const existing = await readPublicPortalConfig();

	let initialData: PublicConfigBody = structuredClone(DEFAULT_PUBLIC_PORTAL_CONFIG);

	if (existing) {
		initialData = existing as unknown as typeof initialData;
		if (Array.isArray(initialData.faqs)) {
			initialData.faqs = {
				public: initialData.faqs as import('$lib/features/public-portal/domain/config').FaqItem[]
			};
		} else if (!initialData.faqs) {
			initialData.faqs = { public: [] };
		}
	}

	return {
		initialData,
		title: 'การตั้งค่า Public Portal (FAQ)'
	};
};

import { superValidate, message } from 'sveltekit-superforms/server';
import { zod4 } from 'sveltekit-superforms/adapters';

export const actions: Actions = {
	save: async ({ request }) => {
		let caller;
		try {
			caller = await authorizeUserWrite(request.headers.get('cookie'));
		} catch (e) {
			if (e instanceof ServiceError) {
				return fail(e.code === 'UNAUTHENTICATED' ? 401 : 403, { error: e.message });
			}
			throw error(500, 'Internal Server Error');
		}

		if (!caller.isSA) {
			return fail(403, { error: 'Requires System Admin privileges to edit global configuration' });
		}

		const form = await superValidate(request, zod4(publicConfigBodySchema), {
			id: 'publicConfigForm'
		});
		if (!form.valid) {
			return fail(400, { form });
		}

		let existingDoc:
			| (PublicPortalConfigRaw & { created_at?: string; created_by?: string; schema_v?: number })
			| null;
		try {
			existingDoc = await readPublicPortalConfig();
		} catch (e) {
			console.error('Failed to read config:', e);
			return message(form, 'เกิดข้อผิดพลาดในการบันทึกข้อมูล', { status: 500 });
		}
		const ts = new Date().toISOString();

		const docToSave = {
			_id: 'config:public_portal',
			type: 'config',
			schema_v: existingDoc?.schema_v ?? 1,
			created_at: existingDoc?.created_at ?? ts,
			updated_at: ts,
			created_by: existingDoc?.created_by ?? caller.name,
			...form.data,
			// Footer logos are managed by their own actions; a FAQ/social save must keep them (FR-10).
			...preservedLogoFields(existingDoc),
			...(existingDoc?._rev ? { _rev: existingDoc._rev } : {})
		};

		const { status: putStatus, data: putData } = await adminRaw(CONFIG_DOC_PATH, 'PUT', docToSave);

		if (putStatus !== 201 && putStatus !== 200) {
			console.error('Failed to save config:', putData);
			return message(form, 'เกิดข้อผิดพลาดในการบันทึกข้อมูล', { status: 500 });
		}

		return message(form, 'บันทึกการตั้งค่าเรียบร้อยแล้ว');
	}
};
