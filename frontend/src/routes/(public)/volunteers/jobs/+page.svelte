<script lang="ts">
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import Ticket from '@lucide/svelte/icons/ticket';
	import Lock from '@lucide/svelte/icons/lock';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import { PublicPageShell } from '$lib/features/public-portal';
	import { languageStore } from '$lib/stores/language.svelte';
	import { jobsI18n } from '$lib/features/volunteers/i18n/jobs.i18n';
	import {
		VolunteerPublicJobBoard as JobBoard,
		VolunteerTicketSearch as TicketSearch
	} from '$lib/features/volunteers';

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
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
</svelte:head>

<!-- Full-width hero band, laid out like the landing page's: centred copy on the domain colour. -->
<header
	class="bg-domain-volunteer-strong px-4 pt-10 pb-12 text-center text-white sm:px-6 sm:pt-14 sm:pb-16 lg:px-8"
>
	<div class="mx-auto max-w-4xl">
		<span
			class="inline-flex items-center gap-2 rounded-full border border-white/25 bg-white/10 px-3 py-1.5 text-xs font-semibold tracking-wider text-white/90 uppercase"
		>
			<UserPlus class="h-4 w-4" aria-hidden="true" />
			{t.heroBadge}
		</span>
		<h1 class="mt-4 text-2xl font-extrabold tracking-tight text-white sm:text-3xl lg:text-4xl">
			{t.heroTitle}
		</h1>
		<p class="mx-auto mt-3 max-w-2xl text-base text-white/85 sm:text-lg">
			{t.heroDescription}
		</p>
	</div>
</header>

<PublicPageShell class="flex min-h-full flex-col space-y-8 lg:px-8" maxWidth="max-w-7xl">
	<!-- Top Navigation Tabs -->
	<div class="mb-2 flex flex-col justify-between gap-4 md:flex-row md:items-center">
		<div
			class="flex w-full flex-col gap-1 rounded-[20px] border border-border/80 bg-white p-1.5 shadow-sm sm:flex-row sm:items-center sm:gap-0 md:w-auto"
		>
			<button
				class="flex w-full shrink-0 items-center justify-center gap-2.5 rounded-2xl px-6 py-3 text-sm font-bold shadow-sm transition-transform active:scale-[0.98] sm:w-auto {activeTab ===
				'jobs'
					? 'bg-domain-volunteer-strong text-white'
					: 'bg-transparent text-domain-volunteer-strong hover:bg-muted/50'}"
				onclick={() => (activeTab = 'jobs')}
			>
				<Briefcase class="h-4.5 w-4.5" />
				{t.tabJobBoard}
			</button>
			<button
				class="flex w-full shrink-0 items-center justify-center gap-2.5 rounded-2xl px-6 py-3 text-sm font-bold transition-colors active:scale-[0.98] sm:w-auto {activeTab ===
				'ticket'
					? 'bg-domain-volunteer-strong text-white shadow-sm'
					: 'bg-transparent text-domain-volunteer-strong hover:bg-muted/50'}"
				onclick={() => (activeTab = 'ticket')}
			>
				<Ticket class="h-4.5 w-4.5" />
				{t.tabFindTicket}
			</button>
		</div>
		<a
			href={resolve('/volunteer/portal')}
			class="flex w-full shrink-0 items-center justify-center gap-2.5 rounded-[20px] bg-domain-volunteer-strong px-7 py-4 text-sm font-bold text-white shadow-sm transition-all hover:bg-domain-volunteer-strong/90 active:scale-[0.98] md:w-auto"
		>
			<Lock class="h-4 w-4 text-domain-volunteer-border" />
			{t.portalLink}
		</a>
	</div>

	<!-- TAB 1: Job Board -->
	{#if activeTab === 'jobs'}
		<JobBoard initialShelter={page.url.searchParams.get('shelter')} />
	{/if}

	<!-- TAB 2: Ticket Search -->
	{#if activeTab === 'ticket'}
		<TicketSearch />
	{/if}
</PublicPageShell>
