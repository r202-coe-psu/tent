<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	interface Props {
		title: string;
		description: string;
		icon: Component<{ class?: string }>;
		iconClass?: string;
		cardClass?: string;
		align?: 'left' | 'center';
		badge?: string;
		badgeClass?: string;
		children?: Snippet;
	}

	let {
		title,
		description,
		icon: IconComponent,
		iconClass = 'bg-sky-50 text-[#0284C7] border border-sky-100',
		cardClass = 'border-2 border-slate-200/80 hover:border-slate-300',
		align = 'center',
		badge,
		badgeClass = '',
		children
	}: Props = $props();
</script>

<div
	class="group flex h-full flex-col justify-between rounded-2xl bg-white p-6 shadow-2xs transition-all duration-200 hover:shadow-xs {cardClass}"
>
	<div class={align === 'center' ? 'flex flex-col items-center text-center' : ''}>
		<div
			class={align === 'center'
				? 'flex items-center justify-center'
				: 'flex items-center justify-between gap-2'}
		>
			<div
				class="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-transform duration-200 group-hover:scale-105 {iconClass}"
			>
				<IconComponent class="h-6 w-6" />
			</div>
			{#if badge && align === 'left'}
				<span
					class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold {badgeClass}"
				>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html badge}
				</span>
			{/if}
		</div>

		{#if badge && align === 'center'}
			<div class="mt-2">
				<span
					class="inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold {badgeClass}"
				>
					<!-- eslint-disable-next-line svelte/no-at-html-tags -->
					{@html badge}
				</span>
			</div>
		{/if}

		<h3 class="mt-4 text-base font-bold tracking-tight text-slate-900 transition-colors sm:text-lg">
			<!-- eslint-disable-next-line svelte/no-at-html-tags -->
			{@html title}
		</h3>

		<p class="mt-2 text-xs leading-relaxed text-slate-500 sm:text-sm">{description}</p>
	</div>

	<div class="mt-6 flex flex-col gap-2.5 border-t border-slate-100 pt-4">
		{@render children?.()}
	</div>
</div>
