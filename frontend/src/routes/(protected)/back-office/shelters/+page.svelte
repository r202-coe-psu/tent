<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Upload from '@lucide/svelte/icons/upload';
	import { ShelterList, useShelters, type ShelterSummary } from '$lib/features/shelters';

	const PAGE_SIZE = 10;
	let currentPage = $state(1);

	const sheltersQuery = useShelters();
	const shelters = $derived(sheltersQuery.data ?? []);
	const total = $derived(shelters.length);
	const totalPages = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));
	const pageShelters = $derived(
		shelters.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
	);

	// Clamp back to the last valid page if the list shrinks (e.g. after a delete).
	$effect(() => {
		if (currentPage > totalPages) currentPage = totalPages;
	});

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
			<p class="mt-1 text-sm text-muted-foreground">
				รายชื่อศูนย์พักพิงทั้งหมดในระบบและสถานะความจุ
			</p>
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

	<!-- List card (rounding matches the shelter form sections) -->
	<div class="rounded-2xl border border-shelter-border bg-card p-4 shadow-sm md:p-6">
		{#if sheltersQuery.isLoading}
			<p class="py-8 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
		{:else if sheltersQuery.isError}
			<p class="py-8 text-center text-sm text-destructive">
				เกิดข้อผิดพลาด: {sheltersQuery.error?.message}
			</p>
		{:else}
			<ShelterList shelters={pageShelters} onedit={handleEdit} />

			{#if totalPages > 1}
				<div class="mt-4 flex justify-center border-t border-shelter-border pt-4">
					<Pagination.Root bind:page={currentPage} count={total} perPage={PAGE_SIZE}>
						{#snippet children({ pages })}
							<Pagination.Content>
								<Pagination.Previous />
								{#each pages as p (p.key)}
									<Pagination.Item>
										{#if p.type === 'page'}
											<Pagination.Link page={p} isActive={p.value === currentPage} />
										{:else}
											<Pagination.Ellipsis />
										{/if}
									</Pagination.Item>
								{/each}
								<Pagination.Next />
							</Pagination.Content>
						{/snippet}
					</Pagination.Root>
				</div>
			{/if}
		{/if}
	</div>
</div>
