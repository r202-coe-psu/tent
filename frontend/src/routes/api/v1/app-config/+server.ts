import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
	APP_CONFIG_DEFAULTS,
	APP_CONFIG_DOC_ID,
	appConfigSchema,
	readAppConfig,
	type AppConfig
} from '$lib/features/shared';
import { adminRaw, authorizeUserWrite, serviceError, ServiceError } from '$lib/server/couch-admin';

export const prerender = false;

const DOC_PATH = `/registry/${encodeURIComponent(APP_CONFIG_DOC_ID)}`;

async function requireSystemAdmin(cookie: string | null) {
	const caller = await authorizeUserWrite(cookie);
	if (!caller.isSA) {
		throw new ServiceError('FORBIDDEN', 'Only system admins can manage app config');
	}
	return caller;
}

type ConfigDoc = AppConfig & {
	_id: string;
	_rev?: string;
	type: 'config';
	schema_v?: number;
	created_at?: string;
	updated_at?: string;
	created_by?: string;
	updated_by?: string;
};

async function loadConfigDoc(): Promise<{ status: number; doc: ConfigDoc | null }> {
	const { status, data } = await adminRaw(DOC_PATH, 'GET');
	if (status === 404) {
		return { status, doc: null };
	}
	if (status !== 200 || !data || typeof data !== 'object') {
		return { status, doc: null };
	}
	const raw = data as Record<string, unknown>;
	const settled = readAppConfig(raw);
	return {
		status,
		doc: {
			_id: APP_CONFIG_DOC_ID,
			_rev: typeof raw._rev === 'string' ? raw._rev : undefined,
			type: 'config',
			schema_v: typeof raw.schema_v === 'number' ? raw.schema_v : 1,
			created_at: typeof raw.created_at === 'string' ? raw.created_at : undefined,
			updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
			created_by: typeof raw.created_by === 'string' ? raw.created_by : undefined,
			updated_by: typeof raw.updated_by === 'string' ? raw.updated_by : undefined,
			...settled
		}
	};
}

/** GET — SA-only read of config:app (settled defaults). */
export const GET: RequestHandler = async ({ request }) => {
	try {
		await requireSystemAdmin(request.headers.get('cookie'));
		const { status, doc } = await loadConfigDoc();
		if (status === 404 || !doc) {
			return json({ config: APP_CONFIG_DEFAULTS, exists: false });
		}
		if (status !== 200) {
			throw new ServiceError('INTERNAL', `Failed to load app config (${status})`);
		}
		const config = readAppConfig(doc);
		return json({ config, exists: true, rev: doc._rev ?? null });
	} catch (e) {
		return serviceError(e);
	}
};

const patchSchema = appConfigSchema.pick({ recaptcha_enabled: true }).partial();

/** PUT { recaptcha_enabled? } — SA-only merge into config:app. */
export const PUT: RequestHandler = async ({ request }) => {
	try {
		const caller = await requireSystemAdmin(request.headers.get('cookie'));
		const body = await request.json().catch(() => null);
		const parsed = patchSchema.safeParse(body);
		if (!parsed.success) {
			throw new ServiceError('VALIDATION', 'Invalid app config payload');
		}
		if (Object.keys(parsed.data).length === 0) {
			throw new ServiceError('VALIDATION', 'No fields to update');
		}

		const { status, doc } = await loadConfigDoc();
		const now = new Date().toISOString();
		const base: ConfigDoc =
			status === 200 && doc
				? doc
				: {
						_id: APP_CONFIG_DOC_ID,
						type: 'config',
						schema_v: 1,
						created_at: now,
						created_by: caller.name,
						...APP_CONFIG_DEFAULTS
					};

		const next: ConfigDoc = {
			...base,
			...parsed.data,
			_id: APP_CONFIG_DOC_ID,
			type: 'config',
			updated_at: now,
			updated_by: caller.name
		};

		const putRes = await adminRaw(DOC_PATH, 'PUT', next);
		if (putRes.status !== 201 && putRes.status !== 200) {
			throw new ServiceError('INTERNAL', `Failed to save app config (${putRes.status})`);
		}

		const config = readAppConfig(next);
		return json({ config, ok: true });
	} catch (e) {
		return serviceError(e);
	}
};
