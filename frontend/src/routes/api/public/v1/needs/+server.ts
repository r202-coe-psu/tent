import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { RequestHandler } from './$types';

const FASTAPI_BASE = env.PUBLIC_FASTAPI_PROXY || 'http://localhost:9000';

// T-60 / FR-017-14: needs board from MongoDB read model via FastAPI
export const GET: RequestHandler = async () => {
	try {
		const res = await fetch(`${FASTAPI_BASE}/public/v1/needs`);
		if (!res.ok) {
			return json([], { status: res.status });
		}
		const body = (await res.json()) as {
			shelters?: Array<{ code: string; name: string; needs: unknown[] }>;
		};
		return json(body.shelters ?? []);
	} catch {
		return json([], { status: 503 });
	}
};
