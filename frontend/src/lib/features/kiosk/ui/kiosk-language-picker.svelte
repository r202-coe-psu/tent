<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Globe from '@lucide/svelte/icons/globe';
	import Info from '@lucide/svelte/icons/info';
	import { languageStore, type LanguageCode } from '$lib/stores/language.svelte';
	import { kioskLanguageSession } from '../application/kiosk-language-session.svelte';
	import type { KioskContextQuery } from '../domain/display-context';
	import { KIOSK_HOME_PATH } from '../domain/identity-method';
	import { KIOSK_LANGUAGE_I18N as T } from './_constants/kiosk-language.i18n';
	import KioskFlag from './kiosk-flag.svelte';

	interface Props {
		contextQuery: KioskContextQuery;
	}

	let { contextQuery }: Props = $props();

	const options = [
		{ code: 'th', ...T.thai },
		{ code: 'en', ...T.english }
	] as const satisfies readonly { code: LanguageCode }[];

	function choose(code: LanguageCode) {
		languageStore.setLanguage(code);
		kioskLanguageSession.markChosen();
		void goto(resolve(`${KIOSK_HOME_PATH}${contextQuery}`));
	}
</script>

<section
	class="mx-auto flex w-full max-w-5xl flex-col items-center gap-6 pt-6 kiosk-portrait:gap-12 kiosk-portrait:pt-40 kiosk-compact:gap-3 kiosk-compact:pt-1"
	aria-labelledby="language-title"
>
	<div class="flex flex-col items-center gap-4 kiosk-portrait:gap-8 kiosk-compact:gap-2">
		<div
			class="flex size-20 items-center justify-center rounded-2xl bg-[#0A2647] text-white kiosk-portrait:size-32 kiosk-compact:size-14 kiosk-compact:rounded-xl"
			aria-hidden="true"
		>
			<Globe class="size-10 kiosk-portrait:size-16 kiosk-compact:size-7" />
		</div>
		<header
			class="flex flex-col items-center text-center kiosk-compact:flex-row kiosk-compact:gap-3"
		>
			<h1
				id="language-title"
				class="text-[36px] leading-tight font-extrabold text-[#0A2647] kiosk-portrait:text-[52px] kiosk-compact:text-[28px]"
			>
				{T.heading}
			</h1>
			<span class="hidden text-[28px] text-slate-400 kiosk-compact:inline" aria-hidden="true"
				>/</span
			>
			<p
				class="text-[22px] font-medium text-slate-700 kiosk-portrait:text-[34px] kiosk-compact:text-[22px]"
			>
				{T.subheading}
			</p>
		</header>
	</div>

	<div
		class="grid w-full grid-cols-2 gap-4 kiosk-portrait:grid-cols-1 kiosk-portrait:gap-6 kiosk-compact:gap-3"
	>
		{#each options as option (option.code)}
			<button
				type="button"
				data-language={option.code}
				onclick={() => choose(option.code)}
				class="group flex min-h-[220px] flex-col items-center justify-center gap-3 rounded-2xl border-2 border-slate-300 bg-white p-4 text-slate-900 shadow-2xs transition-colors duration-100 select-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none active:border-[#0A2647] active:bg-[#0A2647] active:text-white kiosk-portrait:min-h-[200px] kiosk-portrait:gap-4 kiosk-compact:min-h-[230px] kiosk-compact:gap-2"
			>
				<KioskFlag
					code={option.code}
					class="h-[64px] w-[96px] rounded-md border border-slate-200 kiosk-portrait:h-[72px] kiosk-portrait:w-[108px] kiosk-compact:h-[56px] kiosk-compact:w-[84px]"
				/>
				<span
					class="text-[40px] leading-tight font-extrabold kiosk-portrait:text-[48px] kiosk-compact:text-[34px]"
					>{option.title}</span
				>
				<span
					class="text-[20px] leading-snug text-slate-600 group-active:text-white kiosk-portrait:text-[24px] kiosk-compact:text-[17px]"
					>{option.hint}</span
				>
			</button>
		{/each}
	</div>

	<div
		class="flex items-start gap-3 text-slate-700 kiosk-portrait:gap-4 kiosk-compact:items-center kiosk-compact:gap-2"
	>
		<Info
			class="mt-1 size-5 shrink-0 text-[#0A2647] kiosk-portrait:size-7 kiosk-compact:mt-0 kiosk-compact:size-4"
			aria-hidden="true"
		/>
		<p
			class="text-[17px] leading-snug kiosk-portrait:text-[24px] kiosk-compact:text-[14px] kiosk-compact:leading-tight"
		>
			<span class="block">{T.helpTh}</span>
			<span class="block text-slate-600">{T.helpEn}</span>
		</p>
	</div>
</section>
