<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { resolve } from '$app/paths';
	import Moon from '@lucide/svelte/icons/moon';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import {
		abandonWalkIn,
		buildKioskContextQuery,
		getKioskDisplayContext,
		KioskDeviceInfo,
		KioskServiceWatch,
		readKioskDisplayQuery,
		readKioskServiceOpen
	} from '$lib/features/kiosk';
	import { KIOSK_CLOSED_LANGUAGE_OPTIONS, KIOSK_CLOSED_PAGE_I18N } from './closed-page.i18n';

	const t = $derived(getTranslation(KIOSK_CLOSED_PAGE_I18N, languageStore.current));
	const query = $derived(readKioskDisplayQuery(page.url.searchParams));
	const contextQuery = $derived(buildKioskContextQuery(query));
	const displayContext = $derived(getKioskDisplayContext(query, languageStore.current));

	// The layout gate can land here mid walk-in, past the page that would have cleared it.
	onMount(() => abandonWalkIn());

	// Staff reopen the kiosk from the admin app; the device finds out here, without anyone touching it.
	$effect(() => {
		const search = contextQuery;
		const watch = new KioskServiceWatch({
			readServiceOpen: () => readKioskServiceOpen(fetch),
			until: 'open',
			onChange: () => void goto(resolve(`/kiosk${search}`), { replaceState: true })
		});
		watch.start();
		return () => watch.stop();
	});
</script>

<svelte:head>
	<title>{t.pageTitle} — SmartShelter Kiosk</title>
</svelte:head>

<section
	class="mx-auto flex w-full max-w-3xl flex-1 flex-col items-center justify-center gap-6 text-center kiosk-portrait:gap-10"
	aria-labelledby="kiosk-closed-title"
>
	<div
		class="flex size-20 items-center justify-center rounded-2xl bg-[#0A2647] text-white kiosk-portrait:size-32 kiosk-compact:size-14"
		aria-hidden="true"
	>
		<Moon class="size-10 kiosk-portrait:size-16 kiosk-compact:size-7" />
	</div>
	<h1
		id="kiosk-closed-title"
		data-testid="kiosk-closed-title"
		class="text-[36px] leading-tight font-extrabold text-[#0A2647] kiosk-portrait:text-[52px] kiosk-compact:text-[28px]"
	>
		{t.title}
	</h1>
	<p
		data-testid="kiosk-closed-body"
		class="text-[22px] leading-snug font-medium text-slate-700 kiosk-portrait:text-[34px] kiosk-compact:text-[18px]"
	>
		{t.body}
	</p>
	<p
		data-testid="kiosk-closed-place"
		class="text-[18px] font-semibold text-slate-600 kiosk-portrait:text-[26px] kiosk-compact:text-[15px]"
	>
		{displayContext.shelterName} · {displayContext.stationName}
	</p>

	<div class="flex gap-3" role="group" aria-label={t.languageGroupAria}>
		{#each KIOSK_CLOSED_LANGUAGE_OPTIONS as option (option.code)}
			<button
				type="button"
				data-language={option.code}
				aria-pressed={languageStore.current === option.code}
				onclick={() => languageStore.setLanguage(option.code)}
				class="min-h-12 min-w-28 rounded-lg border-2 border-slate-300 bg-white px-4 text-lg font-bold text-[#0A2647] select-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none active:bg-slate-100 aria-pressed:border-[#0A2647] aria-pressed:bg-[#0A2647] aria-pressed:text-white kiosk-portrait:min-h-16 kiosk-portrait:text-2xl"
			>
				{option.label}
			</button>
		{/each}
	</div>
</section>
<KioskDeviceInfo />
