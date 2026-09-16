<script lang="ts">
	import type { Component, Snippet } from 'svelte';
	import type { HTMLButtonAttributes, HTMLAnchorAttributes } from 'svelte/elements';
	import ChevronRight from '@lucide/svelte/icons/chevron-right';

	type ColorScheme = 'primary' | 'destructive' | 'amber' | 'emerald' | 'sky';
	type Variant = 'solid' | 'subtle' | 'outline';

	interface Props {
		variant?: Variant;
		colorScheme?: ColorScheme;
		disabled?: boolean;
		href?: string;
		icon?: Component<{ class?: string }>;
		class?: string;
		children: Snippet;
	}

	let {
		variant = 'solid',
		colorScheme = 'primary',
		disabled = false,
		href,
		icon: CustomIcon,
		class: customClass = '',
		children,
		...rest
	}: Props & HTMLButtonAttributes & HTMLAnchorAttributes = $props();

	const baseClasses =
		'group/btn flex min-h-11 w-full items-center justify-between gap-2 rounded-xl text-left text-xs sm:text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 active:scale-[0.99]';

	const ringClasses: Record<ColorScheme, string> = {
		primary: 'focus-visible:ring-slate-900',
		destructive: 'focus-visible:ring-red-600',
		amber: 'focus-visible:ring-orange-600',
		emerald: 'focus-visible:ring-emerald-600',
		sky: 'focus-visible:ring-sky-600'
	};

	const solidVariants: Record<ColorScheme, string> = {
		primary:
			'bg-[#0A2647] text-white hover:bg-[#051930] px-4 py-2.5 shadow-2xs hover:shadow-xs font-bold',
		destructive:
			'bg-red-600 text-white hover:bg-red-700 px-4 py-2.5 shadow-2xs hover:shadow-xs font-bold',
		amber:
			'bg-[#EA580C] text-white hover:bg-orange-700 px-4 py-2.5 shadow-2xs hover:shadow-xs font-bold',
		emerald:
			'bg-[#059669] text-white hover:bg-emerald-700 px-4 py-2.5 shadow-2xs hover:shadow-xs font-bold',
		sky: 'bg-[#0284C7] text-white hover:bg-[#0369a1] px-4 py-2.5 shadow-2xs hover:shadow-xs font-bold'
	};

	const subtleVariants: Record<ColorScheme, string> = {
		primary:
			'bg-slate-100/90 border border-slate-200/80 text-slate-800 hover:bg-slate-200/80 px-4 py-2.5',
		destructive: 'bg-red-50 border border-red-100/80 text-red-600 hover:bg-red-100 px-4 py-2.5',
		amber: 'bg-amber-50 border border-amber-100/80 text-amber-800 hover:bg-amber-100 px-4 py-2.5',
		emerald:
			'bg-emerald-50 border border-emerald-100/80 text-emerald-800 hover:bg-emerald-100 px-4 py-2.5',
		sky: 'bg-sky-50 border border-sky-100/80 text-[#0A2647] hover:bg-sky-100 px-4 py-2.5'
	};

	const outlineVariant =
		'bg-white border border-slate-200 text-slate-700 hover:bg-slate-50 hover:text-slate-900 hover:border-slate-300 px-4 py-2.5 shadow-2xs';

	function getVariantClass(): string {
		if (variant === 'outline') return outlineVariant;
		if (variant === 'subtle') return subtleVariants[colorScheme];
		return solidVariants[colorScheme];
	}

	function getIconClass(): string {
		if (variant === 'solid') return 'text-white/80';
		if (variant === 'outline') return 'text-slate-400';
		switch (colorScheme) {
			case 'destructive':
				return 'text-red-500';
			case 'amber':
				return 'text-amber-600';
			case 'emerald':
				return 'text-emerald-600';
			case 'sky':
				return 'text-sky-600';
			default:
				return 'text-slate-500';
		}
	}

	const disabledClasses = 'opacity-50 cursor-not-allowed pointer-events-none grayscale';
</script>

{#if href && !disabled}
	<a
		{href}
		class="{baseClasses} {ringClasses[colorScheme]} {getVariantClass()} {customClass}"
		{...rest}
	>
		<span class="truncate">{@render children()}</span>
		{#if CustomIcon}
			<CustomIcon
				class="h-4 w-4 shrink-0 transition-transform duration-200 group-hover/btn:translate-x-0.5 {getIconClass()}"
			/>
		{:else}
			<ChevronRight
				class="h-4 w-4 shrink-0 transition-transform duration-200 group-hover/btn:translate-x-1 {getIconClass()}"
			/>
		{/if}
	</a>
{:else}
	<button
		{disabled}
		class="{baseClasses} {ringClasses[colorScheme]} {getVariantClass()} {disabled
			? disabledClasses
			: ''} {customClass}"
		{...rest}
	>
		<span class="truncate">{@render children()}</span>
		{#if CustomIcon}
			<CustomIcon
				class="h-4 w-4 shrink-0 transition-transform duration-200 group-hover/btn:translate-x-0.5 {getIconClass()}"
			/>
		{:else}
			<ChevronRight
				class="h-4 w-4 shrink-0 transition-transform duration-200 group-hover/btn:translate-x-1 {getIconClass()}"
			/>
		{/if}
	</button>
{/if}
