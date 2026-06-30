<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	interface Props {
		title: string;
		description: string;
		icon: Component<any>;
		iconClass?: string;
		badge?: string;
		badgeClass?: string;
		children?: Snippet;
	}

	let {
		title,
		description,
		icon: IconComponent,
		iconClass = 'bg-primary-muted text-primary',
		badge,
		badgeClass = '',
		children
	}: Props = $props();
</script>

<div
	class="flex h-full flex-col rounded-2xl border border-border/50 bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
>
	<div class="mb-4 flex h-10 w-10 items-center justify-center rounded-xl {iconClass}">
		<IconComponent class="h-5 w-5" />
	</div>

	<div class="mb-2 flex items-start justify-between gap-2">
		<h3 class="text-sm leading-snug font-bold text-slate-800" style="word-break: break-word;">
			{@html title}
		</h3>
		{#if badge}
			<span class="shrink-0 rounded-full px-2.5 py-1 text-[9px] font-bold {badgeClass} text-center">
				{@html badge}
			</span>
		{/if}
	</div>

	<p class="mb-6 text-[11px] leading-relaxed text-slate-500">{description}</p>

	<div class="mt-auto flex flex-col gap-2">
		{@render children?.()}
	</div>
</div>
