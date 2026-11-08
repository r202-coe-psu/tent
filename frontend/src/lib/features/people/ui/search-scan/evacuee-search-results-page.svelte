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
	import { useShelter } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { SEARCH_SCAN_I18N } from '../_constants/search-scan.i18n';

	const t = $derived(getTranslation(SEARCH_SCAN_I18N, langState.current).searchResults);

	const query = $derived(page.url.searchParams.get('q') ?? '');

	const searchQuery = useSearchEvacuees(
		() => query,
		() => !!query
	);
	const searchResults = $derived(searchQuery.data ?? []);
	const isSearching = $derived(searchQuery.isFetching);
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const shelterZones = $derived(shelterQuery.data?.zones ?? []);

	function newSearch() {
		goto(resolve('/onsite/search-edit'));
	}

	function viewEvacuee(id: string) {
		const from = `${page.url.pathname}${page.url.search}`;
		goto(resolve(`/onsite/people/evacuee-profile-view/${id}?from=${encodeURIComponent(from)}`));
	}
</script>

<svelte:head>
	<title>{t.documentTitle}</title>
</svelte:head>

<div class="mx-auto w-full max-w-2xl px-4 py-8">
	<div class="mb-6 flex items-center gap-4">
		<Button
			variant="secondary"
			size="icon"
			onclick={newSearch}
			class="h-10 w-10 rounded-full"
			title={t.back}
		>
			<ArrowLeft class="size-5" />
		</Button>
		<div>
			<h1 class="text-xl font-bold text-foreground md:text-2xl">{t.heading}</h1>
			<p class="mt-0.5 text-xs font-semibold text-muted-foreground">{t.subtitle}</p>
		</div>
	</div>

	<Card.Root class="rounded-3xl border-border shadow-sm">
		<Card.Content class="px-6 py-6">
			{#if isSearching}
				<div class="flex flex-col items-center gap-3 py-16 text-center">
					<Loader2 class="size-6 animate-spin text-primary" />
					<p class="text-sm font-medium text-muted-foreground">{t.searching}</p>
				</div>
			{:else}
				<div class="mb-5 flex items-start justify-between gap-3 border-b border-border pb-4">
					<div>
						<h3 class="text-base font-bold text-foreground">
							{#if searchResults.length > 0}
								{t.foundTitle(searchResults.length)}
							{:else}
								{t.notFoundTitle}
							{/if}
						</h3>
						<p class="mt-0.5 text-xs text-muted-foreground">
							{t.queryLabel} <span class="font-bold text-primary">"{query}"</span>
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
						{t.newSearch}
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
											{t.idLine(maskNationalId(evacuee.person_id?.number))}
										</p>
									</div>
								</div>
								<div
									class="mt-3 flex items-center justify-between gap-2 border-t border-border pt-3"
								>
									<p class="truncate text-xs text-muted-foreground">
										{t.zoneLine(zoneLabel(evacuee.current_stay.zone, shelterZones))}
									</p>
									<Button
										type="button"
										size="sm"
										onclick={() => viewEvacuee(evacuee._id)}
										class="shrink-0 gap-1 rounded-full font-bold"
									>
										{t.viewAndEdit}
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
							{t.notFoundBody}
						</p>
					</div>
				{/if}
			{/if}
		</Card.Content>
	</Card.Root>
</div>
