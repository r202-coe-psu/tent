import { superValidate, message } from 'sveltekit-superforms';
import { zod4 } from 'sveltekit-superforms/adapters';
import { publicConfigBodySchema } from '$lib/features/public-portal';
import type { PageServerLoad, Actions } from './$types';
import { adminRaw, authorizeUserWrite, ServiceError } from '$lib/server/couch-admin';
import { fail, error } from '@sveltejs/kit';

// We store the public configuration in the registry DB
const CONFIG_DOC_PATH = '/registry/config:public_portal';

export const load: PageServerLoad = async ({ request }) => {
	// Require SA or Manager to view this page (or adapt based on your specific RBAC)
	try {
		await authorizeUserWrite(request.headers.get('cookie'));
	} catch (e) {
		if (e instanceof ServiceError) {
			throw error(e.code === 'UNAUTHENTICATED' ? 401 : 403, e.message);
		}
		throw error(500, 'Internal Server Error');
	}

	// Fetch existing config
	const { status, data } = await adminRaw(CONFIG_DOC_PATH, 'GET');

	let initialData = {
		line_oa_url: '',
		facebook_url: '',
		faqs: {
			public: [
				{
					id: '1',
					question: 'วิธีการลงทะเบียนผู้ประสบภัยต้องทำอย่างไร?',
					answer: 'สามารถลงทะเบียนได้ที่ศูนย์พักพิง หรือให้ญาติลงทะเบียนผ่านระบบนี้ล่วงหน้าได้',
					is_published: true,
					order: 0
				}
			]
		}
	};

	if (status === 200 && data) {
		initialData = data as typeof initialData;
	}

	const form = await superValidate(initialData, zod4(publicConfigBodySchema));

	return {
		form,
		title: 'การตั้งค่า Public Portal (FAQ)'
	};
};

export const actions: Actions = {
	default: async ({ request }) => {
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

		const form = await superValidate(request, zod4(publicConfigBodySchema));
		if (!form.valid) {
			return fail(400, { form });
		}

		// Read existing to get _rev
		const { status: getStatus, data: existingData } = await adminRaw(CONFIG_DOC_PATH, 'GET');
		const existingDoc = getStatus === 200 ? (existingData as { _rev?: string; created_at?: string; created_by?: string; schema_v?: number }) : null;
		const ts = new Date().toISOString();
		const existingBase = existingDoc;
		
		const docToSave = {
			_id: 'config:public_portal',
			type: 'config',
			schema_v: existingBase?.schema_v ?? 1,
			created_at: existingBase?.created_at ?? ts,
			updated_at: ts,
			created_by: existingBase?.created_by ?? caller.name,
			...form.data,
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
