<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	let {
		id,
		title,
		description,
		badge,
		icon: Icon,
		bodyClass = '',
		actions,
		children
	}: {
		id: string;
		title: string;
		description?: string;
		badge?: string | number | null;
		icon: Component<{ class?: string }>;
		/** Extra classes on the body card (omit card when empty for member lists). */
		bodyClass?: string;
		actions?: Snippet;
		children: Snippet;
	} = $props();
</script>

<section {id} class="unified-reg-scroll-mt space-y-3">
	<div class="unified-reg-section-header">
		<div class="flex items-center gap-2.5">
			<Icon class="size-5 text-primary" />
			<div>
				<div class="flex items-center gap-2">
					<h2 class="text-base font-bold text-foreground">{title}</h2>
					{#if badge !== undefined && badge !== null && badge !== ''}
						<span
							class="inline-flex items-center rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"
						>
							{badge}
						</span>
					{/if}
				</div>
				{#if description}
					<p class="text-xs text-muted-foreground">{description}</p>
				{/if}
			</div>
		</div>
		{#if actions}
			<div class="flex flex-wrap items-center gap-1.5">
				{@render actions()}
			</div>
		{/if}
	</div>

	{#if bodyClass === 'none'}
		{@render children()}
	{:else}
		<div class="form-section-card {bodyClass}">
			{@render children()}
		</div>
	{/if}
</section>
