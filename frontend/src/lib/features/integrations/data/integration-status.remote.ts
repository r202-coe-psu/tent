/**
 * Browser → BFF health-gate read (draft CR — referral M5 §2, central warehouse M6 §4).
 * The browser never talks to FastAPI or the partner systems.
 */
import { getShelterCode } from '$lib/db/shelter';
import type { IntegrationStatus } from '../domain/integration-status';

export async function fetchIntegrationStatus(): Promise<IntegrationStatus> {
	const qs = new URLSearchParams({ shelter_code: getShelterCode() });
	const res = await fetch(`/api/back-office/integrations/status?${qs}`, {
		credentials: 'include',
		headers: { Accept: 'application/json' }
	});
	if (!res.ok) throw new Error(`ตรวจสอบสถานะระบบกลางไม่สำเร็จ (${res.status})`);
	return (await res.json()) as IntegrationStatus;
}
