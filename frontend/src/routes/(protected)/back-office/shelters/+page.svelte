<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Upload from '@lucide/svelte/icons/upload';
	import { ShelterList, useShelter, type ShelterSummary } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';

	// Back-office is a per-shelter workspace — show only the shelter the staff
	// is currently scoped/selected to, not the full system-wide registry.
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const shelters = $derived(shelterQuery.data ? [shelterQuery.data] : []);

	function handleCreateNew() {
		goto(resolve('/back-office/shelters/create'));
	}

	function handleEdit(shelter: ShelterSummary) {
		goto(resolve(`/back-office/shelters/edit/${encodeURIComponent(shelter.code)}`));
	}

	function handleImport() {
		goto(resolve('/back-office/shelters/import'));
	}
</script>

<svelte:head>
	<title>จัดการศูนย์พักพิง · SmartShelter</title>
</svelte:head>

<div class="flex w-full flex-1 flex-col gap-6 p-6">
	<!-- Page heading -->
	<div class="flex flex-wrap items-end justify-between gap-4">
		<div>
			<h2 class="text-2xl font-bold tracking-tight text-foreground">
				จัดการศูนย์พักพิง (Shelters)
			</h2>
			<p class="mt-1 text-sm text-muted-foreground">ข้อมูลศูนย์พักพิงปัจจุบันและสถานะความจุ</p>
		</div>
		<div class="flex flex-wrap gap-2">
			<Button variant="outline" onclick={handleImport}>
				<Upload class="mr-2 h-4 w-4" /> นำเข้าจาก Excel
			</Button>
			<Button onclick={handleCreateNew}>
				<Plus class="mr-2 h-4 w-4" /> เพิ่มศูนย์พักพิงใหม่
			</Button>
		</div>
	</div>

	<!-- Current shelter card (rounding matches the shelter form sections) -->
	<div class="rounded-2xl border border-shelter-border bg-card p-4 shadow-sm md:p-6">
		{#if shelterQuery.isLoading}
			<p class="py-8 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
		{:else if shelterQuery.isError}
			<p class="py-8 text-center text-sm text-destructive">
				เกิดข้อผิดพลาด: {shelterQuery.error?.message}
			</p>
		{:else}
			<ShelterList {shelters} onedit={handleEdit} />
		{/if}
	</div>
</div>
