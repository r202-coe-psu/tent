import type { PageServerLoad } from './$types';
import { adminRaw } from '$lib/server/couch-admin';

export const load: PageServerLoad = async ({ setHeaders }) => {
	// Cache the response for 60 seconds on the client and CDN
	setHeaders({
		'Cache-Control': 'public, max-age=60, s-maxage=60'
	});

	const { status, data } = await adminRaw('/registry/config:public_portal', 'GET');
	
	let faqs: any[] = [];
	
	if (status === 200 && data && (data as any).faqs && (data as any).faqs.public) {
		faqs = (data as any).faqs.public
			.filter((f: any) => f.is_published)
			.sort((a: any, b: any) => a.order - b.order);
	}

	return {
		faqs
	};
};
