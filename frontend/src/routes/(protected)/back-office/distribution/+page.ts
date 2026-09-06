import { redirect } from '@sveltejs/kit';
import { resolve } from '$app/paths';
import {
	hasStaffCapability,
	isShelterManager,
	isSystemAdmin,
	isWarehouseStaff
} from '$lib/auth/roles';
import { requireAuth, LANDING_ROUTE } from '$lib/guards/auth';
import { authStore } from '$lib/stores/auth.svelte';
import type { PageLoad } from './$types';

export const load = (async ({ fetch }) => {
	await requireAuth(fetch);
	const roles = authStore.user?.roles ?? [];
	if (
		!isSystemAdmin(roles) &&
		!isShelterManager(roles) &&
		!isWarehouseStaff(roles) &&
		!hasStaffCapability(roles, 'registration_staff')
	) {
		throw redirect(302, resolve(LANDING_ROUTE));
	}
}) satisfies PageLoad;
