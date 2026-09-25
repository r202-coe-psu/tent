<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { EvacueeProfileView } from '$lib/features/people';
	import { shelterStore, persistSelectedShelter } from '$lib/stores/shelter.svelte';

	const shelter = $derived(page.params.shelter ?? '');
	const evacueeId = $derived(page.params.evacueeId ?? '');

	const shelterReady = $derived(
		!!shelter && (shelterStore.selectedShelterCode ?? '').toUpperCase() === shelter.toUpperCase()
	);

	// Sync workspace shelter from the URL before EvacueeProfileView queries CouchDB,
	// so the first paint never hits the previously selected shelter DB.
	$effect.pre(() => {
		const code = shelter.trim();
		if (!code) return;
		const current = shelterStore.selectedShelterCode ?? '';
		if (current.toUpperCase() === code.toUpperCase()) return;
		shelterStore.selectedShelterCode = code;
		persistSelectedShelter(code);
	});
</script>

<svelte:head>
	<title>ข้อมูลผู้พักพิง · Pre-registration · SmartShelter</title>
</svelte:head>

<StaffPageShell title="ข้อมูลผู้พักพิง" maxWidth="7xl">
	{#snippet actions()}
		<button
			onclick={() => goto(resolve('/system-management/pre-registrations'))}
			class="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
		>
			<ArrowLeft class="size-4" />
			<span>ย้อนกลับ</span>
		</button>
	{/snippet}

	{#if shelterReady && evacueeId}
		<EvacueeProfileView {evacueeId} />
	{/if}
</StaffPageShell>
