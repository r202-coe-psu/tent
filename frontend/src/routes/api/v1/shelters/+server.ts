import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { adminRaw } from '$lib/server/couch-admin';

export const GET: RequestHandler = async () => {
	try {
		const res = await adminRaw(`/registry/_all_docs?include_docs=true`, 'GET');
		if (res.status === 404) return json([]);
		if (res.status >= 400) return json({ error: 'Database fetch failed' }, { status: 500 });
		
		const rows = (res.data as any)?.rows ?? [];
		const masters = rows.filter((r: any) => r.id.startsWith('shelter:') && r.doc).map((r: any) => r.doc);
		
		const list = masters
            .filter((m: any) => m.status === 'open' || m.status === 'active')
            .map((m: any) => ({
                code: m.code,
                name: m.name,
                status: m.status,
                capacity: m.capacity ?? 0
		    }));
            
		return json(list);
	} catch (e) {
		console.error('Failed to list shelters:', e);
		return json({ error: 'Internal server error' }, { status: 500 });
	}
};
