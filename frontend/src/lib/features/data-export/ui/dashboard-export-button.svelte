<script lang="ts">
	import { toast } from 'svelte-sonner';
	import Download from '@lucide/svelte/icons/download';
	import Loader2 from '@lucide/svelte/icons/loader-circle';
	import { Button } from '$lib/components/ui/button';
	import { canAccessManagerPages } from '$lib/auth/roles';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		useDashboardDemographics,
		useDashboardOccupancy,
		useDashboardRegistrations,
		useDashboardStationTimes
	} from '$lib/features/dashboard';
	import { useShelter } from '$lib/features/shelters';
	import { exportDashboard } from '../application/export-dashboard';

	let {
		shelterCode,
		params
	}: {
		shelterCode: string;
		/** The `from` / `to` of the range on screen — same keys as the cards, so the cache is shared. */
		params: { from?: string; to?: string };
	} = $props();

	// Same hooks and keys as the dashboard cards, so this reads their cached data and fetches nothing
	// extra (CR-232 FR-3). Each query keeps its own loading/error state for FR-50.
	const occupancy = useDashboardOccupancy(() => shelterCode);
	const demographics = useDashboardDemographics(() => shelterCode);
	const registrations = useDashboardRegistrations(
		() => shelterCode,
		() => params.from,
		() => params.to
	);
	const stationTimes = useDashboardStationTimes(
		() => shelterCode,
		() => params.from,
		() => params.to
	);
	const shelter = useShelter(() => shelterCode);

	// FR-2: SA + shelter_manager of this shelter only — not registration_staff.
	const allowed = $derived(canAccessManagerPages(authStore.user?.roles ?? [], shelterCode));

	const ready = $derived(
		!!occupancy.data &&
			!!demographics.data &&
			!!registrations.data &&
			!!stationTimes.data &&
			// A kept-previous-range placeholder is not the range the user picked (FR-50).
			!registrations.isPlaceholderData &&
			!stationTimes.isPlaceholderData &&
			!occupancy.isError &&
			!demographics.isError &&
			!registrations.isError &&
			!stationTimes.isError
	);

	let exporting = $state(false);

	async function onExport() {
		if (!ready || exporting) return;
		const data = {
			occupancy: occupancy.data!,
			demographics: demographics.data!,
			registrations: registrations.data!,
			stationTimes: stationTimes.data!
		};
		exporting = true;
		try {
			const filename = await exportDashboard(data, {
				code: shelterCode,
				name: shelter.data?.name
			});
			toast.success(`Export สำเร็จ: ${filename}`);
		} catch {
			toast.error('Export ไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
		} finally {
			exporting = false;
		}
	}
</script>

{#if allowed}
	<Button variant="outline" disabled={!ready || exporting} onclick={onExport}>
		{#if exporting}
			<Loader2 class="h-4 w-4 animate-spin" />
		{:else}
			<Download class="h-4 w-4" />
		{/if}
		Export Excel
	</Button>
{/if}
