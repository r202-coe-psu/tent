<script lang="ts">
	import { page } from '$app/state';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { KIOSK_SCANNER_I18N } from '../scanner.i18n';
	import {
		KioskBackButton,
		KioskCardInsertScene,
		KioskCheckInWizard,
		KioskReaderPointer
	} from '$lib/features/kiosk';

	const t = $derived(getTranslation(KIOSK_SCANNER_I18N, languageStore.current));
	const backUrl = $derived(`/kiosk${page.url.search}`);
</script>

<svelte:head>
	<title>{t.waiting.pageTitle} — {t.pageSuffix}</title>
</svelte:head>

<section
	class="waiting-page mx-auto flex w-full max-w-3xl flex-1 flex-col gap-3"
	aria-labelledby="waiting-title"
>
	<KioskCheckInWizard currentStep={2} />
	<div class="flex justify-start">
		<KioskBackButton href={backUrl} />
	</div>

	<div
		class="flex flex-1 flex-col justify-center gap-4 pb-28 kiosk-portrait:gap-6 kiosk-portrait:pb-96 kiosk-compact:gap-2 kiosk-compact:pb-0"
	>
		<header class="text-center">
			<h1
				id="waiting-title"
				class="text-2xl font-extrabold tracking-tight text-[#0A2647] sm:text-3xl kiosk-portrait:text-4xl"
			>
				{t.waiting.title}
			</h1>
			<p class="mt-1 text-base font-semibold text-slate-700 kiosk-portrait:text-xl">
				{t.waiting.hint}
			</p>
		</header>

		<main class="flex w-full flex-col items-center">
			<KioskCardInsertScene />

			<div
				class="waiting-status mt-4 flex min-h-12 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 text-base font-semibold text-slate-700 kiosk-portrait:mt-6 kiosk-portrait:min-h-16 kiosk-portrait:gap-3 kiosk-portrait:rounded-2xl kiosk-portrait:px-7 kiosk-portrait:text-xl"
				role="status"
				aria-live="polite"
			>
				<span
					class="h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-[#0A2647] motion-reduce:animate-none kiosk-portrait:h-6 kiosk-portrait:w-6 kiosk-portrait:border-3"
					aria-hidden="true"
				></span>
				{t.waiting.status}
			</div>
		</main>
	</div>
</section>

<KioskReaderPointer side="left" label={t.waiting.slot} />

<style>
	@media (max-height: 650px) {
		.waiting-page {
			gap: 0.25rem;
		}

		.waiting-status {
			margin-top: 0.5rem;
			min-height: 2.75rem;
		}
	}
</style>
