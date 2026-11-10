<script lang="ts">
	import { page } from '$app/state';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { KIOSK_SCANNER_I18N } from '../scanner.i18n';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import {
		KioskBackButton,
		KioskBusyStatus,
		KioskCheckInWizard,
		KioskNoticePanel
	} from '$lib/features/kiosk';

	const t = $derived(getTranslation(KIOSK_SCANNER_I18N, languageStore.current));
	const backUrl = $derived(`/kiosk${page.url.search}`);
</script>

<svelte:head>
	<title>{t.reading.pageTitle} — {t.pageSuffix}</title>
</svelte:head>

<main class="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-4 px-1">
	<KioskCheckInWizard currentStep={2} />
	<div class="flex justify-start">
		<KioskBackButton href={backUrl} />
	</div>

	<KioskNoticePanel tone="info" icon={CreditCard} headingTag="h1" title={t.reading.title}>
		<KioskBusyStatus>{t.reading.wait}</KioskBusyStatus>
		<p
			class="flex items-center justify-center gap-2 text-base font-medium text-slate-600 kiosk-portrait:text-xl"
		>
			<ShieldCheck
				class="size-5 shrink-0 text-[#0A2647] kiosk-portrait:size-7"
				aria-hidden="true"
			/>{t.reading.privacy}
		</p>
	</KioskNoticePanel>
</main>
