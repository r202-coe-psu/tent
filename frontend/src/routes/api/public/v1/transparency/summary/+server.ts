import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listShelterMasters, migrate } from '$lib/server/shelters.admin';
import { adminRaw } from '$lib/server/couch-admin';
import { checkViewDeployment } from '$lib/features/shelters/server/view-version-guard';
import {
	countVulnerableFromBirthYearRows,
	sumOccupancyFromStatusRows
} from '$lib/features/public-portal/server';

// In-memory read-model cache (T-35)
let cachedSummary: Record<string, unknown> | null = null;
let lastFetchTime = 0;

export const GET: RequestHandler = async ({ setHeaders }) => {
	// Cache the response for 60 seconds on the client and CDN to mitigate N+1 query load
	setHeaders({
		'Cache-Control': 'public, max-age=60, s-maxage=60'
	});

	const now = Date.now();
	lastFetchTime = 0; // FORCE REFRESH

	// Poll DB / update read-model if older than 10 mins (600,000 ms)
	if (!cachedSummary || now - lastFetchTime > 600000) {
		try {
			const masters = await listShelterMasters();

			let totalOpen = 0;

			const activeShelters = masters.map(migrate).filter((m) => {
				let mappedStatus = 'CLOSED';
				if (m.operation_status === 'active') mappedStatus = 'OPEN';
				else if (m.operation_status === 'full_capacity') mappedStatus = 'FULL';
				else if (m.operation_status === 'standby') mappedStatus = 'PREPARE';

				if (mappedStatus === 'OPEN' || mappedStatus === 'FULL') {
					totalOpen++;
					return true;
				}
				return false;
			});

			// Fetch real occupancy and demographics concurrently for all active shelters
			const shelterPromises = activeShelters.map(async (m) => {
				let occ: number | null = null;
				let vuln: number | null = null;
				const db = `shelter_${m.code.toLowerCase()}`;
				try {
					const deployment = await checkViewDeployment(db, adminRaw);
					if (deployment.state !== 'current') {
						throw new Error(`Dashboard design for ${db} is ${deployment.state}`);
					}

					const [occRes, ageRes] = await Promise.all([
						adminRaw(`/${db}/_design/app/_view/occupancy?group=true`, 'GET'),
						adminRaw(`/${db}/_design/app/_view/demographics_by_age?group=true`, 'GET')
					]);
					if (occRes.status === 404 || ageRes.status === 404) {
						throw new Error('Dashboard design is not deployed');
					}
					if (occRes.status >= 400 || ageRes.status >= 400) {
						throw new Error('Dashboard view query failed');
					}
					occ = 0;
					if (
						occRes.status === 200 &&
						occRes.data &&
						(occRes.data as Record<string, unknown>).rows
					) {
						// active + pre_registered (CR-070 D-BOOK-OCC=C) — a web booking
						// holds the seat immediately, so the public number must move too.
						occ = sumOccupancyFromStatusRows((occRes.data as Record<string, unknown>).rows);
					}

					if (
						ageRes.status === 200 &&
						ageRes.data &&
						(ageRes.data as Record<string, unknown>).rows
					) {
						vuln = countVulnerableFromBirthYearRows((ageRes.data as Record<string, unknown>).rows);
					}
				} catch (e) {
					// ignore fallback error
					void e;
				}
				return { occ, vuln };
			});

			const results = await Promise.all(shelterPromises);
			const totalOccupancy = results.every((result) => result.occ !== null)
				? results.reduce((sum, current) => sum + (current.occ ?? 0), 0)
				: null;
			const totalVulnerable = results.every((result) => result.vuln !== null)
				? results.reduce((sum, current) => sum + (current.vuln ?? 0), 0)
				: null;

			cachedSummary = {
				shelters_total: masters.length,
				shelters_open: totalOpen,
				occupancy_total: totalOccupancy,
				vulnerable_count: totalVulnerable
			};
			lastFetchTime = now;
		} catch (e) {
			// ignore fallback error
			void e;
		}
	}

	const isStale = now - lastFetchTime > 1800000; // > 30 mins stale threshold (OP-7)

	return json({
		summary: cachedSummary || {
			shelters_total: 0,
			shelters_open: 0,
			occupancy_total: null,
			vulnerable_count: null
		},
		lastUpdated: lastFetchTime || now,
		isStale: isStale || cachedSummary === null,
		flags: {
			public_metrics_occupancy: true,
			public_metrics_vulnerable: true,
			emergency_mode: true
		}
	});
};
