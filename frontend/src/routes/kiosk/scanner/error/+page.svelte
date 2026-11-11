<script lang="ts">
	import { page } from '$app/state';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { KIOSK_SCANNER_I18N } from '../scanner.i18n';
	import AlertOctagon from '@lucide/svelte/icons/alert-octagon';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import {
		KioskBackButton,
		KioskCheckInWizard,
		KioskInlineAlert,
		KioskNoticePanel
	} from '$lib/features/kiosk';

	const t = $derived(getTranslation(KIOSK_SCANNER_I18N, languageStore.current));
	const steps = $derived(t.error.steps);
	const homeUrl = $derived(`/kiosk${page.url.search}`);
	const errorMsg = $derived(page.url.searchParams.get('error_msg') || t.error.fallbackMessage);
</script>

<svelte:head>
	<title>{t.error.pageTitle} — {t.pageSuffix}</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4">
	<KioskCheckInWizard currentStep={2} />
	<div class="flex justify-start">
		<KioskBackButton href={homeUrl} />
	</div>

	<KioskNoticePanel tone="critical" icon={AlertOctagon} headingTag="h1" title={t.error.title}>
		<p class="font-semibold text-red-900" role="alert">{errorMsg}</p>
		<ol
			class="mx-auto space-y-3 pt-2 text-left kiosk-portrait:space-y-4 kiosk-portrait:pt-4 kiosk-compact:space-y-1.5 kiosk-compact:pt-0"
			aria-label={t.error.stepsLabel}
		>
			{#each steps as step, i (step.title)}
				<li class="flex items-start gap-3 kiosk-portrait:gap-4">
					<span
						class="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#0A2647] text-lg font-bold text-white tabular-nums kiosk-portrait:size-12 kiosk-portrait:text-2xl kiosk-compact:size-7 kiosk-compact:text-base"
						aria-hidden="true">{i + 1}</span
					>
					<div class="min-w-0 pt-0.5 kiosk-portrait:pt-1.5">
						<p class="font-bold text-slate-900">{step.title}</p>
						<p class="mt-0.5 text-base text-slate-600 kiosk-portrait:text-xl kiosk-compact:text-sm">
							{step.hint}
						</p>
					</div>
				</li>
			{/each}
		</ol>
		<KioskInlineAlert tone="warning" icon={UserCheck}>{t.error.help}</KioskInlineAlert>
	</KioskNoticePanel>
</section>
