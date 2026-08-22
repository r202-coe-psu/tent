<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import User from '@lucide/svelte/icons/user';
	import Users from '@lucide/svelte/icons/users';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Clock from '@lucide/svelte/icons/clock';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import Button from '$lib/components/ui/button/button.svelte';
	import { page } from '$app/state';
	import { onMount } from 'svelte';
	import {
		familySearch,
		searchResultKey,
		PublicHeroMetrics,
		PublicPageShell,
		StayStatusChip,
		type FamilySearchResult
	} from '$lib/features/public-portal';

	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_SEARCH_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';

	let query = $state('');
	let isLoading = $state(false);
	let results = $state<FamilySearchResult[] | null>(null);
	let error = $state('');

	let currentPage = $state(1);
	const itemsPerPage = 5;

	const t = $derived(getTranslation(PUBLIC_SEARCH_I18N, langState.current));

	let paginatedResults = $derived(
		results ? results.slice((currentPage - 1) * itemsPerPage, currentPage * itemsPerPage) : null
	);
	let totalPages = $derived(results ? Math.ceil(results.length / itemsPerPage) : 0);

	onMount(() => {
		const q = page.url.searchParams.get('q');
		if (q) {
			query = q;
			performSearch();
		}
	});

	async function performSearch() {
		if (query.length < 3) {
			error = t.errorMinChars;
			return;
		}
		isLoading = true;
		error = '';
		results = null;

		try {
			const data = await familySearch(query);
			results = data.results;
			currentPage = 1;
		} catch (e) {
			error = e instanceof Error ? e.message : t.errorConnect;
		} finally {
			isLoading = false;
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') performSearch();
	}

	function formatDateTime(isoString: string) {
		if (!isoString) return t.notSpecifiedTime;
		return (
			new Date(isoString).toLocaleString(langState.current === 'th' ? 'th-TH' : 'en-US') +
			(langState.current === 'th' ? ' น.' : '')
		);
	}

	function genderLabel(gender: string | null | undefined) {
		if (gender === 'male') return t.genderMale;
		if (gender === 'female') return t.genderFemale;
		return t.genderOther;
	}
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
</svelte:head>

<PublicPageShell class="space-y-8">
	<PublicHeroMetrics
		title={t.heroTitle}
		description={t.heroDesc}
		badgeText={t.heroBadge}
		badgeIcon={Search}
		showLivePing={false}
		bgClass="bg-primary-dark"
		showSearch={false}
	/>

	<!-- Search Box -->
	<div class="rounded-2xl border border-border bg-card p-6 shadow-sm">
		<h2 class="mb-2 text-center text-xl font-bold">{t.searchBoxTitle}</h2>
		<p class="mb-6 text-center text-sm text-muted-foreground">
			{t.searchBoxDesc}
		</p>

		<!-- Input -->
		<div class="flex flex-col gap-3 sm:flex-row">
			<div
				class="relative flex flex-1 items-center gap-3 rounded-xl border border-border bg-muted/50 px-4"
			>
				<Search class="h-5 w-5 text-muted-foreground/80" />
				<input
					type="text"
					bind:value={query}
					onkeydown={handleKeydown}
					placeholder={t.searchPlaceholder}
					class="h-12 w-full bg-transparent outline-none"
				/>
			</div>
			<Button
				onclick={performSearch}
				disabled={isLoading}
				class="h-12 min-w-30 rounded-xl bg-primary text-white hover:bg-primary-dark"
			>
				{#if isLoading}
					{t.searchingBtn}
				{:else}
					{t.searchBtn}
				{/if}
			</Button>
		</div>

		{#if error}
			<p class="mt-3 text-center text-sm text-danger">{error}</p>
		{/if}
	</div>

	<!-- Results -->
	{#if results !== null}
		{#if results.length > 0}
			<div>
				<div
					class="mb-4 flex items-center gap-2 rounded-lg bg-muted p-3 text-sm font-semibold text-foreground/90"
				>
					<CheckCircle class="h-5 w-5 text-primary" />
					{t.foundResults}
					{results.length}
					{t.itemsCount}
				</div>

				<div class="flex flex-col gap-6">
					{#each paginatedResults ?? [] as person, i (searchResultKey(person, (currentPage - 1) * itemsPerPage + i))}
						<div class="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
							<!-- Card Header -->
							<div
								class="items-start justify-between space-y-1 border-b border-border/50 p-5 md:flex"
							>
								<div>
									<div class="items-center gap-3 space-y-1 md:flex">
										<h3 class="text-xl font-bold text-foreground">
											{person.name || t.unnamed}
										</h3>
										{#if person.family_members && person.family_members.length > 0}
											<span
												class="rounded-md bg-primary/20 px-2 py-0.5 text-xs font-bold text-primary"
												>{t.withFamily}</span
											>
										{:else}
											<span
												class="rounded-md bg-muted px-2 py-0.5 text-xs font-bold text-muted-foreground"
												>{t.alone}</span
											>
										{/if}
									</div>
									<div class="mt-2 gap-4 text-sm text-muted-foreground md:flex">
										<p>ID: <span class="font-mono">{person.national_id || '-'}</span></p>
										<p>เพศ: {genderLabel(person.gender)}</p>
									</div>
								</div>

								<!-- Real stay status, labelled exactly as the backoffice labels it (CR-080). -->
								<StayStatusChip status={person.status} />
							</div>

							<!-- Card Body -->
							<div class="grid grid-cols-1 gap-6 bg-muted/50 p-5 sm:grid-cols-2">
								<div class="flex gap-3">
									<MapPin class="mt-0.5 h-5 w-5 text-muted-foreground/80" />
									<div>
										<div class="text-xs text-muted-foreground">{t.stayingAt}</div>
										<div class="font-medium text-foreground">{person.shelter_name || '-'}</div>
									</div>
								</div>
								<div class="flex gap-3">
									<MapPin class="mt-0.5 h-5 w-5 text-muted-foreground/80" />
									<div>
										<div class="text-xs text-muted-foreground">{t.origin}</div>
										<div class="font-medium text-foreground">{person.origin_address || '-'}</div>
									</div>
								</div>
								<div class="flex gap-3">
									<Clock class="mt-0.5 h-5 w-5 text-muted-foreground/80" />
									<div>
										<div class="text-xs text-muted-foreground">{t.checkinTime}</div>
										<div class="font-medium text-foreground">
											{person.checked_in_at ? formatDateTime(person.checked_in_at) : '-'}
										</div>
									</div>
								</div>
								<div class="flex gap-3">
									<User class="mt-0.5 h-5 w-5 text-muted-foreground/80" />
									<div>
										<div class="text-xs text-muted-foreground">{t.careZone}</div>
										<div class="font-medium text-foreground">{person.care_zone || '-'}</div>
									</div>
								</div>
							</div>

							{#if person.family_members && person.family_members.length > 0}
								<!--
									Open by default: someone searching for a relative wants the rest of
									the household on screen without a second click — that is usually the
									answer they came for ("did the whole family make it?").
								-->
								<details open class="group border-t border-border/50 p-5">
									<summary
										class="mb-4 flex cursor-pointer list-none items-center gap-2 font-bold text-foreground/90 transition-colors hover:text-primary"
									>
										<Users class="h-5 w-5" />
										{t.familyInfo} ({person.family_members.length}
										{t.people})
										<span
											class="ml-auto text-xs font-normal text-muted-foreground group-open:hidden"
											>{t.clickToView}</span
										>
										<span
											class="ml-auto hidden text-xs font-normal text-muted-foreground group-open:inline"
											>{t.hide}</span
										>
									</summary>
									<div class="mt-4 flex flex-col gap-3">
										{#each person.family_members as member, i (i)}
											<div
												class="flex flex-col justify-between gap-2 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-center"
											>
												<div>
													<div class="font-bold text-foreground">
														{member.name || '-'}
													</div>
												</div>
												<StayStatusChip
													status={member.status}
													detail={member.shelter_name || null}
													size="sm"
												/>
											</div>
										{/each}
									</div>
								</details>
							{/if}
						</div>
					{/each}
				</div>

				<!-- Pagination -->
				{#if totalPages > 1}
					<div class="mt-8 flex items-center justify-center gap-4">
						<Button
							variant="outline"
							disabled={currentPage === 1}
							onclick={() => currentPage--}
							class="rounded-lg"
						>
							{t.prevBtn}
						</Button>
						<span class="text-sm font-bold text-muted-foreground">
							{t.page}
							{currentPage}
							{t.of}
							{totalPages}
						</span>
						<Button
							variant="outline"
							disabled={currentPage === totalPages}
							onclick={() => currentPage++}
							class="rounded-lg"
						>
							{t.nextBtn}
						</Button>
					</div>
				{/if}
			</div>
		{:else}
			<div
				class="rounded-2xl border border-dashed border-border bg-muted/50 p-12 text-center text-muted-foreground"
			>
				<div
					class="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-card p-4 shadow-sm"
				>
					<Search class="size-10 text-muted-foreground" />
				</div>
				<h3 class="mb-2 text-lg font-bold text-foreground/90">{t.noResultsTitle}</h3>
				<p class="text-sm">{t.noResultsDesc}</p>
			</div>
		{/if}
	{:else}
		<div
			class="rounded-2xl border border-dashed border-border bg-muted/50 p-12 text-center text-muted-foreground"
		>
			<div
				class="mx-auto mb-4 flex size-20 items-center justify-center rounded-full bg-card p-4 shadow-sm"
			>
				<Search class="size-10 text-muted-foreground" />
			</div>
			<h3 class="mb-2 text-lg font-bold text-foreground/90">{t.startSearchTitle}</h3>
			<p class="text-sm">
				{t.startSearchDesc}
			</p>
		</div>
	{/if}
</PublicPageShell>
