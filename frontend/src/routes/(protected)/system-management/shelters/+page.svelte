<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { spatial } from '$lib/tokens';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Upload from '@lucide/svelte/icons/upload';
	import {
		SITE_KIND_LABELS,
		ShelterList,
		useShelters,
		type ShelterSummary,
		type SiteKind
	} from '$lib/features/shelters';

	const PAGE_SIZE = 10;
	let currentPage = $state(1);
	let siteKindFilter = $state<SiteKind | 'all'>('all');

	const sheltersQuery = useShelters();
	const shelters = $derived(sheltersQuery.data ?? []);
	const filteredShelters = $derived(
		siteKindFilter === 'all'
			? shelters
			: shelters.filter((shelter) => shelter.site_kind === siteKindFilter)
	);
	const total = $derived(filteredShelters.length);
	const totalPages = $derived(Math.max(1, Math.ceil(total / PAGE_SIZE)));
	const clampedPage = $derived(Math.max(1, Math.min(currentPage, totalPages)));
	const pageShelters = $derived(
		filteredShelters.slice((clampedPage - 1) * PAGE_SIZE, clampedPage * PAGE_SIZE)
	);

	$effect(() => {
		const normalizedPage = Math.max(1, Math.min(currentPage, totalPages));
		if (currentPage !== normalizedPage) currentPage = normalizedPage;
	});

	function handleCreateNew() {
		const query = siteKindFilter === 'all' ? '' : `?site_kind=${siteKindFilter}`;
		goto(resolve(`/system-management/shelters/create${query}`));
	}

	function selectSiteKind(filter: SiteKind | 'all') {
		siteKindFilter = filter;
		currentPage = 1;
	}

	function handleEdit(shelter: ShelterSummary) {
		goto(resolve(`/system-management/shelters/edit/${encodeURIComponent(shelter.code)}`));
	}

	function handleImport() {
		goto(resolve('/system-management/shelters/import'));
	}
</script>

<svelte:head>
	<title>จัดการศูนย์พักพิง · SmartShelter</title>
</svelte:head>

<StaffPageShell
	title="จัดการศูนย์พักพิงและบ้านพี่เลี้ยง"
	description="รายชื่อสถานที่ทั้งหมดในระบบและสถานะความจุ"
>
	{#snippet actions()}
		<Button variant="outline" onclick={handleImport}>
			<Upload class="mr-2 h-4 w-4" /> นำเข้าจาก Excel
		</Button>
		<Button onclick={handleCreateNew} class="btn-primary-brand">
			<Plus class="mr-2 h-4 w-4" /> เพิ่มศูนย์พักพิงใหม่
		</Button>
	{/snippet}

	<div class="{spatial.container.staffPageCard} p-4 md:p-6">
		<div class="mb-4 flex flex-wrap gap-2" aria-label="กรองตามชนิดสถานที่">
			{#each [{ value: 'all' as const, label: 'ทั้งหมด' }, { value: 'evacuation_center' as const, label: SITE_KIND_LABELS.evacuation_center }, { value: 'host_house' as const, label: SITE_KIND_LABELS.host_house }] as option (option.value)}
				<button
					type="button"
					onclick={() => selectSiteKind(option.value)}
					aria-pressed={siteKindFilter === option.value}
					class={[
						'rounded-lg border px-3 py-2 text-sm font-medium transition',
						siteKindFilter === option.value
							? 'border-sky-200 bg-sky-50 font-semibold text-[#0A2647]'
							: 'border-slate-200/80 text-slate-600 hover:bg-slate-50 hover:text-slate-900'
					]}
				>
					{option.label}
				</button>
			{/each}
		</div>

		{#if sheltersQuery.isLoading}
			<p class="py-8 text-center text-sm text-muted-foreground">กำลังโหลด...</p>
		{:else if sheltersQuery.isError}
			<p class="py-8 text-center text-sm text-destructive">
				เกิดข้อผิดพลาด: {sheltersQuery.error?.message}
			</p>
		{:else}
			<ShelterList
				shelters={pageShelters}
				onedit={handleEdit}
				emptyLabel={siteKindFilter === 'host_house' ? 'บ้านพี่เลี้ยง' : 'ศูนย์พักพิง'}
			/>

			{#if totalPages > 1}
				<div class="mt-4 flex justify-center border-t border-slate-200/80 pt-4">
					<Pagination.Root
						bind:page={() => clampedPage, (p) => (currentPage = p)}
						count={total}
						perPage={PAGE_SIZE}
					>
						{#snippet children({ pages })}
							<Pagination.Content>
								<Pagination.Previous />
								{#each pages as p (p.key)}
									<Pagination.Item>
										{#if p.type === 'page'}
											<Pagination.Link page={p} isActive={p.value === clampedPage} />
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
</StaffPageShell>
