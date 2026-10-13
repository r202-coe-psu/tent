<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	/**
	 * The header strip at the top of a back-office board card (the stock-donations tabs).
	 * Each tab used to style its own — 16px titles beside a 20px one, 10px descriptions,
	 * a blue icon here and a sky one there — so the tabs did not read as one page.
	 */
	let {
		icon: Icon,
		title,
		description,
		actions
	}: {
		icon: Component<{ class?: string }>;
		title: string;
		description?: string;
		actions?: Snippet;
	} = $props();
</script>

<div
	class="flex flex-col justify-between gap-4 border-b border-slate-200/80 bg-white p-4 sm:p-6 lg:flex-row lg:items-center"
>
	<div class="flex min-w-0 items-start gap-3">
		<span
			class="inline-flex shrink-0 rounded-xl border border-blue-200 bg-blue-50 p-2 text-blue-600"
			aria-hidden="true"
		>
			<Icon class="h-5 w-5" />
		</span>
		<div class="min-w-0 space-y-1">
			<h2 class="text-lg font-bold text-slate-900 sm:text-xl">{title}</h2>
			{#if description}
				<p class="text-sm leading-relaxed text-slate-500">{description}</p>
			{/if}
		</div>
	</div>
	{#if actions}
		<div class="flex shrink-0 flex-col gap-3 sm:flex-row sm:items-center">
			{@render actions()}
		</div>
	{/if}
</div>
