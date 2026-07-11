<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	interface Props {
		title: string;
		description: string;
		icon: Component<Record<string, unknown>>;
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
	class="flex h-full flex-col gap-4 rounded-2xl border border-border/50 bg-card p-6 shadow-sm transition-shadow hover:shadow-md"
>
	<div class=" flex items-start justify-between gap-2">
		<div class="flex h-10 w-10 items-center justify-center rounded-xl {iconClass}">
			<IconComponent class="size-7" />
		</div>
		{#if badge}
			<span class="w-fit rounded-full px-2.5 py-1 text-[9px] font-bold {badgeClass} text-center">
				<!-- eslint-disable-next-line svelte/no-at-html-tags -->
				{@html badge}
			</span>
		{/if}
	</div>
	<h3 class="w-full text-sm font-bold text-card-foreground">
		<!-- eslint-disable-next-line svelte/no-at-html-tags -->
		{@html title}
	</h3>

	<p class="mb-6 text-[11px] leading-relaxed text-muted-foreground">{description}</p>

	<div class="mt-auto flex flex-col gap-3">
		{@render children?.()}
	</div>
</div>
