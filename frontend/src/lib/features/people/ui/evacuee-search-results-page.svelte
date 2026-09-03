<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';
	import Users from '@lucide/svelte/icons/users';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import { useSearchEvacuees, maskNationalId, zoneLabel } from '$lib/features/people';

	const query = $derived(page.url.searchParams.get('q') ?? '');

	const searchQuery = useSearchEvacuees(
		() => query,
		() => !!query
	);
	const searchResults = $derived(searchQuery.data ?? []);
	const isSearching = $derived(searchQuery.isFetching);

	function newSearch() {
		goto(resolve('/onsite/search-edit'));
	}

	function viewEvacuee(id: string) {
		const from = `${page.url.pathname}${page.url.search}`;
		goto(resolve(`/onsite/people/evacuee-profile-view/${id}?from=${encodeURIComponent(from)}`));
	}
</script>

<div class="mx-auto w-full max-w-2xl px-4 py-8">
	<div class="mb-6 flex items-center gap-4">
		<Button
			variant="secondary"
			size="icon"
			onclick={newSearch}
			class="h-10 w-10 rounded-full"
			title="กลับ"
		>
			<ArrowLeft class="size-5" />
		</Button>
		<div>
			<h1 class="text-xl font-bold text-foreground md:text-2xl">ผลการค้นหาผู้พักพิง</h1>
			<p class="mt-0.5 text-xs font-semibold text-muted-foreground">Search Results</p>
		</div>
	</div>

	<Card.Root class="rounded-3xl border-border shadow-sm">
		<Card.Content class="px-6 py-6">
			{#if isSearching}
				<div class="flex flex-col items-center gap-3 py-16 text-center">
					<Loader2 class="size-6 animate-spin text-primary" />
					<p class="text-sm font-medium text-muted-foreground">กำลังค้นหาข้อมูล...</p>
				</div>
			{:else}
				<div class="mb-5 flex items-start justify-between gap-3 border-b border-border pb-4">
					<div>
						<h3 class="text-base font-bold text-foreground">
							{#if searchResults.length > 0}
								พบข้อมูลผู้พักพิงที่ตรงกัน ({searchResults.length} รายการ)
							{:else}
								ไม่พบข้อมูลผู้พักพิงที่ตรงกัน
							{/if}
						</h3>
						<p class="mt-0.5 text-xs text-muted-foreground">
							คำค้นหา: <span class="font-bold text-primary">"{query}"</span>
						</p>
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						onclick={newSearch}
						class="shrink-0 gap-1.5 rounded-full"
					>
						<RotateCcw class="size-3.5" />
						ค้นหาใหม่
					</Button>
				</div>

				{#if searchResults.length > 0}
					<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
						{#each searchResults as evacuee (evacuee._id)}
							<div class="rounded-2xl border border-border bg-card p-4">
								<div class="flex min-w-0 items-center gap-3">
									<div
										class="flex size-11 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground"
									>
										<Users class="size-5" />
									</div>
									<div class="min-w-0 flex-1">
										<p class="truncate text-sm font-bold text-foreground">
											{evacuee.first_name}
											{evacuee.last_name}
										</p>
										<p class="mt-0.5 truncate text-xs text-muted-foreground">
											ID: {maskNationalId(evacuee.person_id?.number)}
										</p>
									</div>
								</div>
								<div
									class="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3"
								>
									<p class="truncate text-xs text-muted-foreground">
										Zone {zoneLabel(evacuee.current_stay.zone)}
									</p>
									<Button
										type="button"
										size="sm"
										onclick={() => viewEvacuee(evacuee._id)}
										class="shrink-0 gap-1 rounded-full font-bold"
									>
										ดูข้อมูลและแก้ไข
										<ChevronRight class="size-3.5" />
									</Button>
								</div>
							</div>
						{/each}
					</div>
				{:else}
					<div class="flex items-center gap-2.5 rounded-2xl border border-border bg-muted/30 p-4">
						<CircleAlert class="size-5 shrink-0 text-destructive" />
						<p class="text-sm font-semibold text-foreground">
							ไม่พบข้อมูลผู้พักพิงที่ตรงกับคำค้นหานี้ กรุณาตรวจสอบคำค้นหาอีกครั้ง
						</p>
					</div>
				{/if}
			{/if}
		</Card.Content>
	</Card.Root>
</div>
