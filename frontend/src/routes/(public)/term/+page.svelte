<script lang="ts">
	import { PublicPageShell } from '$lib/features/public-portal';
	import { PUBLIC_TERM_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { getTranslation } from '$lib/utils/i18n';

	const t = $derived(getTranslation(PUBLIC_TERM_I18N, langState.current));
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
</svelte:head>

<PublicPageShell maxWidth="max-w-3xl" class="py-10 sm:py-12">
	<article
		class="rounded-2xl border border-slate-200/80 bg-white px-6 py-8 text-[#0A2647] sm:px-8 sm:py-10"
	>
		<header class="mb-8 space-y-3 border-b border-slate-200/80 pb-6">
			<p class="text-xs font-medium tracking-wide text-slate-500 uppercase">
				{t.ownerLine}
			</p>
			<h1 class="text-2xl font-bold tracking-tight sm:text-3xl">{t.title}</h1>
			<p class="text-sm leading-relaxed text-slate-600 sm:text-base">{t.intro}</p>
		</header>

		<ol class="space-y-6">
			{#each t.sections as section, index (section.id)}
				<li class="space-y-2">
					<h2 class="text-base font-semibold tracking-tight sm:text-lg">
						<span class="mr-1.5 text-slate-400">{index + 1}.</span>
						{section.title}
					</h2>
					<p class="text-sm leading-relaxed text-slate-600 sm:text-[0.9375rem]">{section.body}</p>
				</li>
			{/each}
		</ol>

		<p
			class="mt-8 border-t border-slate-200/80 pt-6 text-sm leading-relaxed text-slate-600 sm:text-[0.9375rem]"
		>
			{t.closing}
		</p>
	</article>
</PublicPageShell>
