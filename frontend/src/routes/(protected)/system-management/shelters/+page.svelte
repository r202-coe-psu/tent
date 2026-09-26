<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { spatial } from '$lib/tokens';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Pagination from '$lib/components/ui/pagination/index.js';
	import Plus from '@lucide/svelte/icons/plus';
	import Upload from '@lucide/svelte/icons/upload';
	import Search from '@lucide/svelte/icons/search';
	import X from '@lucide/svelte/icons/x';
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
	let searchQuery = $state('');

	const sheltersQuery = useShelters();
	const shelters = $derived(sheltersQuery.data ?? []);
	const filteredShelters = $derived(
		shelters.filter((shelter) => {
			if (siteKindFilter !== 'all' && shelter.site_kind !== siteKindFilter) {
				return false;
			}
			const q = searchQuery.trim().toLowerCase();
			if (q) {
				const nameMatch = shelter.name?.toLowerCase().includes(q);
				const codeMatch = shelter.code?.toLowerCase().includes(q);
				const provMatch = shelter.province?.toLowerCase().includes(q);
				const distMatch = shelter.district?.toLowerCase().includes(q);
				const subdistMatch = shelter.subdistrict?.toLowerCase().includes(q);
				if (!nameMatch && !codeMatch && !provMatch && !distMatch && !subdistMatch) {
					return false;
				}
			}
			return true;
		})
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

	function handleSearchInput(e: Event) {
		searchQuery = (e.target as HTMLInputElement).value;
		currentPage = 1;
	}

	function clearSearch() {
		searchQuery = '';
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
		<Button
			variant="outline"
			size="sm"
			onclick={handleImport}
			class="h-8 gap-1.5 border-slate-200/80 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
		>
			<Upload class="size-3.5" /> นำเข้าจาก Excel
		</Button>
		<Button
			size="sm"
			onclick={handleCreateNew}
			class="btn-primary-brand h-8 gap-1.5 px-3 text-xs font-semibold"
		>
			<Plus class="size-3.5" /> เพิ่มศูนย์พักพิงใหม่
		</Button>
	{/snippet}

	<div class={spatial.container.staffPageCard}>
		<!-- Compact Toolbar: Search + Site Kind Filter + Counter -->
		<div
			class="flex flex-col gap-2.5 border-b border-slate-200/80 bg-white p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4"
		>
			<!-- Search Bar -->
			<div class="relative w-full sm:max-w-xs">
				<Search
					class="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-slate-400"
				/>
				<Input
					type="text"
					placeholder="ค้นหาชื่อ, รหัส, จังหวัด, อำเภอ..."
					value={searchQuery}
					oninput={handleSearchInput}
					class="h-8 rounded-lg border-slate-200/80 bg-slate-50/60 pr-7 pl-8 text-xs placeholder:text-slate-400 focus:bg-white"
				/>
				{#if searchQuery}
					<button
						type="button"
						onclick={clearSearch}
						class="absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-0.5 text-slate-400 hover:text-slate-600"
						aria-label="ล้างคำค้นหา"
					>
						<X class="size-3" />
					</button>
				{/if}
			</div>

			<!-- Segmented site kind filter & counter -->
			<div class="flex items-center justify-between gap-2.5 sm:justify-end">
				<div
					class="inline-flex rounded-lg border border-slate-200/80 bg-slate-50/70 p-0.5"
					role="tablist"
					aria-label="กรองตามชนิดสถานที่"
				>
					{#each [{ value: 'all' as const, label: 'ทั้งหมด' }, { value: 'evacuation_center' as const, label: SITE_KIND_LABELS.evacuation_center }, { value: 'host_house' as const, label: SITE_KIND_LABELS.host_house }] as option (option.value)}
						<button
							type="button"
							onclick={() => selectSiteKind(option.value)}
							role="tab"
							aria-selected={siteKindFilter === option.value}
							class={[
								'rounded-md px-2.5 py-1 text-xs font-medium transition-all',
								siteKindFilter === option.value
									? 'bg-white font-semibold text-[#0A2647] shadow-2xs'
									: 'text-slate-600 hover:text-slate-900'
							]}
						>
							{option.label}
						</button>
					{/each}
				</div>

				<span class="shrink-0 text-xs text-slate-500 tabular-nums">
					พบ <strong class="font-bold text-slate-800">{total}</strong> แห่ง
				</span>
			</div>
		</div>

		<!-- Table Content -->
		{#if sheltersQuery.isLoading}
			<div class="flex items-center justify-center py-12 text-xs text-slate-400">
				กำลังโหลดข้อมูล...
			</div>
		{:else if sheltersQuery.isError}
			<div class="p-6 text-center text-xs text-red-600">
				เกิดข้อผิดพลาด: {sheltersQuery.error?.message}
			</div>
		{:else}
			<ShelterList
				shelters={pageShelters}
				onedit={handleEdit}
				emptyLabel={siteKindFilter === 'host_house' ? 'บ้านพี่เลี้ยง' : 'ศูนย์พักพิง'}
			/>

			{#if totalPages > 1}
				<div
					class="flex flex-col gap-2 border-t border-slate-200/80 bg-slate-50/50 px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between"
				>
					<div class="text-xs text-slate-500 tabular-nums">
						แสดง {(clampedPage - 1) * PAGE_SIZE + 1} - {Math.min(clampedPage * PAGE_SIZE, total)} จาก
						{total} แห่ง
					</div>
					<Pagination.Root
						bind:page={() => clampedPage, (p) => (currentPage = p)}
						count={total}
						perPage={PAGE_SIZE}
					>
						{#snippet children({ pages })}
							<Pagination.Content>
								<Pagination.Previous class="h-7 text-xs" />
								{#each pages as p (p.key)}
									<Pagination.Item>
										{#if p.type === 'page'}
											<Pagination.Link
												page={p}
												isActive={p.value === clampedPage}
												class="h-7 min-w-7 text-xs"
											/>
										{:else}
											<Pagination.Ellipsis class="h-7 w-7 text-xs" />
										{/if}
									</Pagination.Item>
								{/each}
								<Pagination.Next class="h-7 text-xs" />
							</Pagination.Content>
						{/snippet}
					</Pagination.Root>
				</div>
			{/if}
		{/if}
	</div>
</StaffPageShell>
