<script lang="ts">
	import { languageStore } from '$lib/stores/language.svelte';
	import { cn } from '$lib/utils/shadcn';

	let {
		class: className = ''
	}: {
		class?: string;
	} = $props();

	const isThai = $derived(languageStore.current === 'th');

	// Accessible name starts with the visible text (WCAG 2.5.3) and names the target language in
	// that language, so a reader who only knows it can still find the way back.
	const label = $derived(isThai ? 'TH — Switch to English' : 'EN — เปลี่ยนเป็นภาษาไทย');

	function toggleLanguage() {
		languageStore.setLanguage(isThai ? 'en' : 'th');
	}
</script>

<!-- One pill that shows the current language and flips TH ⇄ EN (the public navbar's look). -->
<button
	type="button"
	onclick={toggleLanguage}
	aria-label={label}
	title={label}
	class={cn(
		'inline-flex min-h-8 min-w-11 cursor-pointer items-center justify-center rounded-full border border-slate-300 bg-white px-3 py-1 text-xs font-bold text-[#0A2647] shadow-2xs transition-all select-none hover:border-slate-400 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-95',
		className
	)}
>
	{isThai ? 'TH' : 'EN'}
</button>
