<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		number,
		title,
		description,
		tone = 'default',
		children
	}: {
		number?: number;
		title: string;
		description?: string;
		tone?: 'default' | 'fuel';
		children: Snippet;
	} = $props();

	const uid = $props.id();
	const headingId = `catalog-section-${uid}`;
</script>

<section
	aria-labelledby={headingId}
	class="space-y-5 rounded-2xl border p-5 sm:p-6 {tone === 'fuel'
		? 'border-amber-200/70 bg-amber-50/40 dark:border-amber-900/40 dark:bg-amber-950/20'
		: 'border-border/60 bg-muted/20'}"
>
	<div
		class="flex items-start gap-3 border-b pb-3 {tone === 'fuel'
			? 'border-amber-200/60 dark:border-amber-900/40'
			: 'border-border/40'}"
	>
		{#if number}
			<span
				aria-hidden="true"
				class="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white tabular-nums {tone ===
				'fuel'
					? 'bg-amber-600'
					: 'bg-[var(--brand-primary)]'}"
			>
				{number}
			</span>
		{/if}
		<div class="space-y-1">
			<h3 id={headingId} class="text-sm font-semibold text-foreground">{title}</h3>
			{#if description}
				<p class="text-xs text-muted-foreground">{description}</p>
			{/if}
		</div>
	</div>
	{@render children()}
</section>
