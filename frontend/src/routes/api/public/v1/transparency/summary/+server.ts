import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { fastapiBaseUrl, fastapiServiceHeaders } from '$lib/server/fastapi';

/**
 * GET /api/public/v1/transparency/summary → FastAPI Mongo aggregate.
 *
 * Public landing metrics must share the same source as `/shelters`
 * (public_shelters + public_persons) — not CouchDB admin views.
 */
export const GET: RequestHandler = async ({ fetch, setHeaders }) => {
	setHeaders({
		'Cache-Control': 'public, max-age=60, s-maxage=60'
	});

	try {
		const res = await fetch(`${fastapiBaseUrl()}/public/v1/transparency/summary`, {
			headers: fastapiServiceHeaders()
		});
		const payload = (await res.json().catch(() => null)) as {
			summary?: {
				shelters_total?: number;
				shelters_open?: number;
				occupancy_total?: number | null;
				vulnerable_count?: number | null;
			};
			last_updated?: string;
			is_stale?: boolean;
			flags?: Record<string, boolean>;
		} | null;

		if (!res.ok || !payload?.summary) {
			return json(
				{
					summary: {
						shelters_total: 0,
						shelters_open: 0,
						occupancy_total: null,
						vulnerable_count: null
					},
					lastUpdated: Date.now(),
					isStale: true,
					flags: {
						public_metrics_occupancy: true,
						public_metrics_vulnerable: true,
						emergency_mode: false
					}
				},
				{ status: res.ok ? 200 : res.status >= 400 ? res.status : 503 }
			);
		}

		const lastUpdatedMs = payload.last_updated ? Date.parse(payload.last_updated) : Date.now();

		return json({
			summary: {
				shelters_total: payload.summary.shelters_total ?? 0,
				shelters_open: payload.summary.shelters_open ?? 0,
				occupancy_total: payload.summary.occupancy_total ?? null,
				vulnerable_count: payload.summary.vulnerable_count ?? null
			},
			lastUpdated: Number.isFinite(lastUpdatedMs) ? lastUpdatedMs : Date.now(),
			isStale: Boolean(payload.is_stale),
			flags: {
				public_metrics_occupancy: payload.flags?.public_metrics_occupancy ?? true,
				public_metrics_vulnerable: payload.flags?.public_metrics_vulnerable ?? true,
				emergency_mode: payload.flags?.emergency_mode ?? true
			}
		});
	} catch {
		return json(
			{
				summary: {
					shelters_total: 0,
					shelters_open: 0,
					occupancy_total: null,
					vulnerable_count: null
				},
				lastUpdated: Date.now(),
				isStale: true,
				flags: {
					public_metrics_occupancy: true,
					public_metrics_vulnerable: true,
					emergency_mode: false
				}
			},
			{ status: 503 }
		);
	}
};
