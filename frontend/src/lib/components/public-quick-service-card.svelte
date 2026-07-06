<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	interface Props {
		title: string;
		description: string;
		icon: Component<Record<string, unknown>>;
		iconClass?: string;
		children?: Snippet;
	}

	let {
		title,
		description,
		icon: IconComponent,
		iconClass = 'bg-primary-muted text-primary',
		children
	}: Props = $props();
</script>

<div
	class="flex h-full flex-col rounded-2xl border border-border/50 bg-card p-5 shadow-[0_2px_10px_-3px_rgba(6,81,237,0.1)]"
>
	<div class="mb-5">
		<div class="flex h-10 w-10 items-center justify-center rounded-xl {iconClass}">
			<IconComponent class="h-5 w-5" />
		</div>
		<h3 class="mt-4 text-[15px] font-bold text-foreground">{title}</h3>
		<p class="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
	</div>

	<div class="mt-auto flex flex-col gap-2.5">
		{@render children?.()}
	</div>
</div>
