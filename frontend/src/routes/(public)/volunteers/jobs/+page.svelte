<script lang="ts">
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import Ticket from '@lucide/svelte/icons/ticket';
	import Lock from '@lucide/svelte/icons/lock';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { goto } from '$app/navigation';
	import { PublicHeroMetrics, PublicPageShell } from '$lib/features/public-portal';
	import LanguageSwitcher from '$lib/components/language-switcher.svelte';
	import { languageStore } from '$lib/stores/language.svelte';
	import { jobsI18n } from '$lib/features/volunteers/i18n/jobs.i18n';
	import JobBoard from '$lib/features/volunteers/components/JobBoard.svelte';
	import TicketSearch from '$lib/features/volunteers/components/TicketSearch.svelte';

	let activeTab = $state<'jobs' | 'ticket'>('jobs');
	const t = $derived(jobsI18n[languageStore.current]);

	$effect(() => {
		const tabParam = page.url.searchParams.get('tab');
		if (tabParam === 'ticket' || tabParam === 'find') {
			activeTab = 'ticket';
		} else if (tabParam === 'jobs') {
			activeTab = 'jobs';
		}
	});

	function handleSearchTicket(query: string) {
		const token = query.trim();
		if (token) {
			goto(`/volunteer/ticket/${encodeURIComponent(token)}`);
		}
	}
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
</svelte:head>

<PublicPageShell class="space-y-8">
	<!-- Top Bar with Language Switcher -->
	<div class="flex items-center justify-end">
		<LanguageSwitcher />
	</div>

	<PublicHeroMetrics
		title={t.heroTitle}
		description={t.heroDescription}
		badgeText={t.heroBadge}
		badgeIcon={UserPlus}
		showLivePing={false}
		bgClass="bg-primary-dark"
		showSearch={false}
	/>

	<!-- Top Navigation Tabs -->
	<div class="mb-2 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div
			class="flex w-full flex-col gap-1 rounded-[20px] border border-border/80 bg-white p-1.5 shadow-sm sm:flex-row sm:items-center sm:gap-0 md:w-auto"
		>
			<button
				class="flex w-full shrink-0 items-center justify-center gap-2.5 rounded-2xl px-6 py-3 text-sm font-bold shadow-sm transition-transform active:scale-[0.98] sm:w-auto {activeTab ===
				'jobs'
					? 'bg-primary text-white'
					: 'bg-transparent text-primary hover:bg-muted/50'}"
				onclick={() => (activeTab = 'jobs')}
			>
				<Briefcase class="h-4.5 w-4.5" />
				{t.tabJobBoard}
			</button>
			<button
				class="flex w-full shrink-0 items-center justify-center gap-2.5 rounded-2xl px-6 py-3 text-sm font-bold transition-colors active:scale-[0.98] sm:w-auto {activeTab ===
				'ticket'
					? 'bg-primary text-white shadow-sm'
					: 'bg-transparent text-primary hover:bg-muted/50'}"
				onclick={() => (activeTab = 'ticket')}
			>
				<Ticket class="h-4.5 w-4.5" />
				{t.tabFindTicket}
			</button>
		</div>
		<a
			href={resolve('/volunteer/portal')}
			class="hover:bg-opacity-90 flex w-full shrink-0 items-center justify-center gap-2.5 rounded-[20px] bg-primary px-7 py-4 text-sm font-bold text-white shadow-sm transition-all active:scale-[0.98] md:w-auto"
		>
			<Lock class="h-4 w-4 text-warning" />
			{t.portalLink}
		</a>
	</div>

	<!-- TAB 1: Job Board -->
	{#if activeTab === 'jobs'}
		<JobBoard />
	{/if}

	<!-- TAB 2: Ticket Search -->
	{#if activeTab === 'ticket'}
		<TicketSearch onSearch={handleSearchTicket} />
	{/if}
</PublicPageShell>
