<script lang="ts">
	import Search from '@lucide/svelte/icons/search';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Button from '$lib/components/ui/button/button.svelte';
	import type { Component } from 'svelte';

	import { getTranslation } from '$lib/utils/i18n';
	import { PUBLIC_HERO_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';

	let {
		title,
		description,
		badgeText,
		badgeIcon: BadgeIcon = null,
		showLivePing = true,
		bgClass = 'bg-primary',
		showSearch = true,
		expectMetrics = false,
		summary,
		flags,
		lastUpdated,
		isStale
	}: {
		title?: string;
		description?: string;
		badgeText?: string;
		badgeIcon?: Component | null;
		showLivePing?: boolean;
		bgClass?: string;
		showSearch?: boolean;
		/** When true, log to console if metrics props are incomplete (hero still renders). */
		expectMetrics?: boolean;

		summary?: {
			shelters_open: number;
			shelters_total: number;
			occupancy_total: number | null;
			vulnerable_count: number | null;
		};
		flags?: { public_metrics_occupancy: boolean; public_metrics_vulnerable: boolean };
		lastUpdated?: number;
		isStale?: boolean;
	} = $props();

	import { goto } from '$app/navigation';

	let searchQuery = $state('');

	const t = $derived(getTranslation(PUBLIC_HERO_I18N, langState.current));

	let displayTitle = $derived(title ?? t.defaultTitle);
	let displayDescription = $derived(description ?? t.defaultDesc);
	let displayBadgeText = $derived(badgeText ?? t.defaultBadge);

	const metricsPanel = $derived.by(() => {
		if (summary == null || flags == null || lastUpdated === undefined || isStale === undefined) {
			return null;
		}
		return { summary, flags, lastUpdated, isStale };
	});

	$effect(() => {
		if (!expectMetrics || metricsPanel != null) return;

		const missing: string[] = [];
		if (summary == null) missing.push('summary');
		if (flags == null) missing.push('flags');
		if (lastUpdated === undefined) missing.push('lastUpdated');
		if (isStale === undefined) missing.push('isStale');

		console.error(`[PublicHeroMetrics] metrics panel hidden — missing: ${missing.join(', ')}`);
	});

	function handleSearch() {
		if (searchQuery.trim()) {
			goto(`/search?q=${encodeURIComponent(searchQuery.trim())}`);
		}
	}

	function handleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') handleSearch();
	}
</script>

<div class="relative overflow-hidden rounded-2xl {bgClass} p-8 text-white shadow-sm lg:p-12">
	<div
		class="absolute inset-0 opacity-10"
		style="background-image: radial-gradient(#fff 1px, transparent 1px); background-size: 24px 24px;"
	></div>
	<div class="relative flex flex-col gap-10 md:flex-row md:items-center md:justify-between">
		<!-- Text Content -->
		<div class="flex min-w-0 flex-1 flex-col justify-center">
			<div
				class="mb-4 inline-flex w-fit items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3 py-1.5 text-xs font-semibold tracking-wider text-white/90 uppercase backdrop-blur-sm"
			>
				{#if showLivePing}
					<span class="relative flex h-2 w-2">
						<span
							class="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75"
						></span>
						<span class="relative inline-flex h-2 w-2 rounded-full bg-success"></span>
					</span>
				{/if}
				{#if BadgeIcon}
					<BadgeIcon class="h-4 w-4" />
				{/if}
				{displayBadgeText}
			</div>
			<h1
				class="mb-4 text-3xl leading-tight font-bold tracking-tight text-white md:text-4xl lg:text-5xl"
			>
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html displayTitle}
			</h1>
			<p class="max-w-2xl text-base text-white/80 md:text-lg {showSearch ? 'mb-8' : ''}">
				{displayDescription}
			</p>

			{#if showSearch}
				<div
					class="mt-2 flex w-full max-w-xl flex-col justify-between gap-2 rounded-xl bg-white p-2 sm:flex-row sm:items-center md:max-w-4xl"
				>
					<div class="relative flex w-full flex-1 items-center gap-3 pl-2">
						<Search class="text-bold size-5 shrink-0 text-muted-foreground" />
						<input
							type="text"
							bind:value={searchQuery}
							onkeydown={handleKeydown}
							placeholder={t.searchPlaceholder}
							class="h-10 w-full bg-transparent text-sm text-foreground placeholder-muted-foreground outline-none"
						/>
					</div>
					<Button
						onclick={handleSearch}
						class="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-lg bg-primary-strong px-6 py-2 text-xs font-bold text-white transition-colors hover:bg-primary"
					>
						{t.searchBtn}
					</Button>
				</div>
			{/if}
		</div>

		<!-- Metrics Panel -->
		{#if metricsPanel}
			<div class="flex w-full shrink-0 flex-col justify-center md:w-auto md:max-w-sm">
				<div class="relative rounded-2xl border border-border bg-card p-6 shadow-sm">
					<!-- Stale Warning -->
					{#if metricsPanel.isStale}
						<div
							class="absolute -top-3 right-6 flex items-center gap-1 rounded-full border-2 border-white bg-warning px-3 py-1 text-2xs font-bold text-white shadow-sm"
						>
							<AlertCircle class="h-3 w-3" />
							{t.staleWarning}
						</div>
					{/if}

					<div class=" flex items-center justify-between border-b border-border/50 pb-4">
						<h3 class="text-xs font-bold tracking-wider text-card-foreground uppercase">
							{t.currentStatus}
						</h3>
						<span class="text-2xs text-muted-foreground"
							>{t.lastUpdated}: {new Date(metricsPanel.lastUpdated).toLocaleTimeString(
								langState.current === 'th' ? 'th-TH' : 'en-US'
							)}</span
						>
					</div>

					<div class="mt-4 grid grid-cols-2 gap-4">
						<!-- Metric 1 -->
						<div
							class="flex flex-col justify-center rounded-xl border border-border/50 bg-muted/30 p-4"
						>
							<span class="mb-2 text-xs font-semibold text-muted-foreground">{t.sheltersReady}</span
							>
							<div class="flex items-baseline gap-1">
								<span class="text-3xl font-bold text-card-foreground"
									>{metricsPanel.summary.shelters_open}</span
								>
								<span class="text-sm font-medium text-muted-foreground"
									>/{metricsPanel.summary.shelters_total} {t.sheltersUnit}</span
								>
							</div>
						</div>

						<!-- Metric 2 (Occupancy) -->
						{#if metricsPanel.flags.public_metrics_occupancy}
							<div
								class="flex flex-col justify-center rounded-xl border border-border/50 bg-muted/30 p-4"
							>
								<span class="mb-2 text-xs font-semibold text-muted-foreground">{t.victimsSafe}</span
								>
								<div class="flex items-baseline gap-1">
									<span class="text-3xl font-bold text-card-foreground"
										>{metricsPanel.summary.occupancy_total ?? '-'}</span
									>
									<span class="text-sm font-medium text-muted-foreground">{t.victimsUnit}</span>
								</div>
							</div>
						{/if}
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
