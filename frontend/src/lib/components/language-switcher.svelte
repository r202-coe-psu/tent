<script lang="ts">
	import { languageStore, type LanguageCode } from '$lib/stores/language.svelte';
	import { cn } from '$lib/utils/shadcn';

	let {
		class: className = ''
	}: {
		class?: string;
	} = $props();

	const languages: { code: LanguageCode; label: string; flag: string; title: string }[] = [
		{ code: 'th', label: 'TH', flag: '🇹🇭', title: 'ภาษาไทย (Thai)' },
		{ code: 'en', label: 'EN', flag: '🇬🇧', title: 'English (อังกฤษ)' }
	];

	function selectLanguage(code: LanguageCode) {
		languageStore.setLanguage(code);
	}
</script>

<div
	role="group"
	aria-label="Language selection"
	class={cn(
		'inline-flex items-center rounded-lg border border-border/80 bg-muted/50 p-0.5 text-xs font-medium shadow-2xs select-none',
		className
	)}
>
	{#each languages as lang (lang.code)}
		{@const isActive = languageStore.current === lang.code}
		<button
			type="button"
			onclick={() => selectLanguage(lang.code)}
			title={lang.title}
			aria-pressed={isActive}
			class={cn(
				'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium transition-all focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none active:scale-95',
				isActive
					? 'bg-background font-bold text-foreground shadow-xs'
					: 'text-muted-foreground hover:bg-background/40 hover:text-foreground'
			)}
		>
			<span class="text-sm leading-none">{lang.flag}</span>
			<span class="tracking-wide uppercase">{lang.label}</span>
		</button>
	{/each}
</div>
