import { requireShelterScopeOrSA, adminRaw } from '$lib/server/couch-admin';
import { isShelterManager } from '$lib/auth/roles';
import { ReferralServerRepository } from '$lib/features/referrals/server/referral.server-repo';
import { render } from 'svelte/server';
import { ReferralList } from '$lib/features/referrals';
import type { RequestHandler } from './$types';
import type { ReferralStatus } from '$lib/features/referrals';

export const prerender = false;

export const GET: RequestHandler = async ({ request, url }) => {
	try {
		const cookie = request.headers.get('cookie');
		const caller = await requireShelterScopeOrSA(cookie);
		const allowed = caller.isSA || isShelterManager(caller.roles);
		if (!allowed) {
			return new Response('<p class="text-destructive">Unauthorized</p>', {
				status: 403,
				headers: { 'Content-Type': 'text/html; charset=utf-8' }
			});
		}

		let shelterCode = url.searchParams.get('shelter_code') || undefined;
		if (!caller.isSA) {
			shelterCode = caller.shelterCode || undefined;
		} else {
			shelterCode = shelterCode || 'SH001';
		}

		if (!shelterCode) {
			return new Response('<p class="text-destructive">Missing shelterCode</p>', {
				status: 400,
				headers: { 'Content-Type': 'text/html; charset=utf-8' }
			});
		}

		const search = url.searchParams.get('search') || '';
		const tab = (url.searchParams.get('tab') || 'all') as 'all' | ReferralStatus;
		const page = parseInt(url.searchParams.get('page') || '1', 10);
		const selectedId = url.searchParams.get('selectedId') || null;
		const pageSize = 5;

		// Fetch referrals using the server repository
		const repo = new ReferralServerRepository(`shelter_${shelterCode.toLowerCase()}`);
		const referrals = await repo.list({ status: tab !== 'all' ? tab : undefined });

		// Fetch evacuees from database
		const evacueesRes = await adminRaw(`/shelter_${shelterCode.toLowerCase()}/_find`, 'POST', {
			selector: { type: 'evacuee' }
		});
		const evacuees =
			evacueesRes.status === 200
				? (evacueesRes.data as { docs: Record<string, unknown>[] }).docs
				: [];

		// Server-side filter
		const getEvacueeName = (evacueeId: string) => {
			const evac = evacuees.find((e) => (e as Record<string, unknown>)._id === evacueeId) as
				{ first_name: string; last_name: string } | undefined;
			return evac ? `${evac.first_name} ${evac.last_name}` : 'ไม่พบชื่อผู้ประสบภัย';
		};

		let filtered = referrals;
		if (search.trim()) {
			const q = search.toLowerCase().trim();
			filtered = filtered.filter((r) => {
				const evacName = getEvacueeName(r.evacuee_id).toLowerCase();
				const orgName = r.to_org.name.toLowerCase();
				const evacId = r.evacuee_id.toLowerCase();
				return evacName.includes(q) || orgName.includes(q) || evacId.includes(q);
			});
		}

		const totalItems = filtered.length;
		const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
		const safePage = Math.max(1, Math.min(page, totalPages));
		const start = (safePage - 1) * pageSize;
		const paginated = filtered.slice(start, start + pageSize);

		const result = render(ReferralList, {
			props: {
				referrals: paginated,
				currentPage: safePage,
				activeTab: tab,
				searchQuery: search,
				totalItems,
				pageSize,
				evacuees,
				selectedId
			}
		});

		return new Response(result.html, {
			headers: {
				'Content-Type': 'text/html; charset=utf-8'
			}
		});
	} catch (e: unknown) {
		console.error('🔴 [Referral HTMX Fragment GET Error]:', e);
		const err = e as { status?: number; message?: string };
		const status = err.status || 500;
		const message = err.message || 'Internal Server Error';
		return new Response(`<p class="text-destructive">Error: ${message}</p>`, {
			status,
			headers: { 'Content-Type': 'text/html; charset=utf-8' }
		});
	}
};
