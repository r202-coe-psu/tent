<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import { EVACUEE_PROFILE_I18N, EvacueeProfileView } from '$lib/features/people';
	import { getTranslation } from '$lib/utils/i18n';
	import { langState } from '$lib/states/i18n.svelte';

	let { data } = $props();

	const t = $derived(getTranslation(EVACUEE_PROFILE_I18N, langState.current).page);
</script>

<svelte:head>
	<title>{t.documentTitle}</title>
</svelte:head>

<div class="mx-auto w-full max-w-7xl min-w-0 space-y-6 p-4 md:p-6">
	<button
		onclick={() => {
			const from = page.url.searchParams.get('from');
			goto(resolve((from?.trim() || '/onsite/people') as '/onsite/people'));
		}}
		class="mb-4 inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
	>
		<ArrowLeft class="size-4" />
		<span>{t.back}</span>
	</button>

	<h1
		class="min-w-0 text-2xl font-bold tracking-tight break-words text-slate-900 md:text-3xl dark:text-slate-50"
	>
		{t.heading}
	</h1>

	<EvacueeProfileView evacueeId={data.id} />
</div>
