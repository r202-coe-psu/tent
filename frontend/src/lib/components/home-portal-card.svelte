<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	type Accent = 'brand' | 'neutral' | 'accent-purple' | 'muted' | 'danger' | 'success';

	interface Props {
		icon: Component<{ class?: string; size?: number }>;
		title: string;
		description: string;
		accent?: Accent;
		badge?: string;
		badgeVariant?: 'primary' | 'success' | 'neutral';
		actions?: Snippet;
		href?: string;
		disabled?: boolean;
		class?: string;
	}

	let {
		icon: Icon,
		title,
		description,
		accent = 'neutral',
		badge,
		badgeVariant,
		actions,
		href,
		disabled = false,
		class: className = ''
	}: Props = $props();

	const iconWrapperClass = $derived(
		{
			brand: 'bg-primary-muted text-primary',
			neutral: 'bg-muted text-muted-foreground',
			'accent-purple': 'bg-accent-purple-muted text-accent-purple',
			muted: 'bg-muted text-foreground',
			danger: 'bg-danger-muted text-danger',
			success: 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'
		}[accent]
	);

	const badgeClass = $derived(
		{
			primary: 'bg-primary-muted text-primary-strong',
			success: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300',
			neutral: 'bg-muted text-muted-foreground'
		}[badgeVariant ?? (accent === 'success' ? 'success' : 'primary')]
	);

	const cardBorderClass = $derived(
		accent === 'danger' ? 'border-2 border-danger-border' : 'border border-border'
	);
</script>

{#if href && !disabled}
	<a
		{href}
		class="group relative flex min-h-[320px] flex-col items-start rounded-2xl {cardBorderClass} cursor-pointer bg-card p-6 pt-10 shadow-[0_4px_20px_rgba(0,0,0,0.03)] transition-all hover:-translate-y-1 hover:shadow-md {className}"
	>
		{#if badge}
			<div
				class="absolute top-0 right-0 rounded-tr-2xl rounded-bl-xl {badgeClass} px-3 py-1 text-2xs font-bold"
			>
				{badge}
			</div>
		{/if}

		<div
			class="mt-2 mb-6 flex h-12 w-12 items-center justify-center rounded-xl text-xl {iconWrapperClass} transition-colors group-hover:bg-primary-muted group-hover:text-primary"
		>
			<Icon class="size-5" />
		</div>

		<h2 class="mb-4 text-xl font-bold text-foreground">{title}</h2>
		<p class="flex-1 text-sm leading-relaxed text-muted-foreground">
			{description}
		</p>

		{#if actions}
			<div class="mt-6 flex items-center gap-2">
				{@render actions()}
			</div>
		{/if}
	</a>
{:else}
	<div
		aria-disabled={disabled || undefined}
		class="group relative flex min-h-[320px] flex-col items-start rounded-2xl {cardBorderClass} bg-card p-6 pt-10 shadow-[0_4px_20px_rgba(0,0,0,0.03)] transition-all {disabled
			? 'cursor-not-allowed opacity-60'
			: ''} {className}"
	>
		{#if badge}
			<div
				class="absolute top-0 right-0 rounded-tr-2xl rounded-bl-xl {badgeClass} px-3 py-1 text-2xs font-bold"
			>
				{badge}
			</div>
		{/if}

		<div
			class="mt-2 mb-6 flex h-12 w-12 items-center justify-center rounded-xl text-xl {iconWrapperClass} transition-colors"
		>
			<Icon class="size-5" />
		</div>

		<h2 class="mb-4 text-xl font-bold text-foreground">{title}</h2>
		<p class="flex-1 text-sm leading-relaxed text-muted-foreground">
			{description}
		</p>

		{#if actions}
			<div class="mt-6 flex items-center gap-2">
				{@render actions()}
			</div>
		{/if}
	</div>
{/if}
