<script lang="ts">
	import type { Component } from 'svelte';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import OctagonAlert from '@lucide/svelte/icons/octagon-alert';
	import Info from '@lucide/svelte/icons/info';
	import { cn } from '$lib/utils/shadcn.js';
	import type { BannerVariant } from '$lib/features/shared';

	interface Props {
		message: string;
		variant: BannerVariant;
		/** Pinned to the bottom of the viewport; the settings preview renders it in flow. */
		fixed?: boolean;
	}

	let { message, variant, fixed = true }: Props = $props();

	// Soft style: tinted surface + dark text + top rule. An icon pairs with the colour.
	const VARIANTS: Record<BannerVariant, { classes: string; icon: Component }> = {
		success: {
			classes: 'border-emerald-200/80 bg-emerald-50 text-emerald-800',
			icon: CheckCircle2
		},
		warning: { classes: 'border-amber-200/80 bg-amber-50 text-amber-800', icon: TriangleAlert },
		destructive: { classes: 'border-red-200/80 bg-red-50 text-red-800', icon: OctagonAlert },
		info: { classes: 'border-sky-200/80 bg-sky-50 text-sky-800', icon: Info }
	};

	const current = $derived(VARIANTS[variant]);
	const Icon = $derived(current.icon);
</script>

<div
	class={cn(
		'flex items-center justify-center gap-2 border-t px-3 text-center text-base font-medium tracking-wide',
		fixed ? 'fixed inset-x-0 bottom-0 z-50 h-[var(--testing-banner-height)]' : 'h-[1.625rem]',
		current.classes
	)}
	role="status"
>
	<Icon class="size-4 shrink-0" aria-hidden="true" />
	<span class="truncate" title={message}>{message}</span>
</div>
