<script lang="ts">
	import type { Snippet } from 'svelte';
	import { cn } from '$lib/utils/shadcn.js';
	import { spatial, typography } from '$lib/tokens';

	const maxWidthClass = {
		full: '',
		'7xl': 'mx-auto max-w-7xl',
		'6xl': 'mx-auto max-w-6xl',
		'3xl': 'mx-auto max-w-3xl'
	} as const;

	let {
		title,
		description,
		maxWidth = 'full',
		class: className = '',
		meta,
		actions,
		children
	}: {
		title: string;
		description?: string;
		maxWidth?: keyof typeof maxWidthClass;
		class?: string;
		meta?: Snippet;
		actions?: Snippet;
		children: Snippet;
	} = $props();
</script>

<main class={cn(spatial.container.staffPage, maxWidthClass[maxWidth], className)}>
	<header
		class={cn(
			'flex flex-col gap-4',
			actions ? 'sm:flex-row sm:items-start sm:justify-between' : undefined
		)}
	>
		<div class="min-w-0 space-y-2">
			<h1 class={typography.scale.h1Staff.classes}>{title}</h1>
			{#if description}
				<p class="text-base text-slate-600">{description}</p>
			{/if}
			{#if meta}
				<div>{@render meta()}</div>
			{/if}
		</div>
		{#if actions}
			<div class="flex shrink-0 flex-wrap items-center gap-2">
				{@render actions()}
			</div>
		{/if}
	</header>

	{@render children()}
</main>
