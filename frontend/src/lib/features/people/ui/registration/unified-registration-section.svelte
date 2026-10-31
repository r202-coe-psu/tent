<script lang="ts">
	import type { Component, Snippet } from 'svelte';

	type SectionBadge = {
		text: string;
		/** `primary` = accent (new/adding); `muted` = already registered. */
		tone?: 'primary' | 'muted';
	};

	let {
		id,
		title,
		description,
		badge,
		badges,
		icon: Icon,
		bodyClass = '',
		tone = 'blue',
		mobileSurface = 'light',
		actions,
		children
	}: {
		id: string;
		title: string;
		description?: string;
		/** Single badge (legacy). Prefer `badges` when showing more than one. */
		badge?: string | number | null;
		badges?: SectionBadge[];
		icon: Component<{ class?: string }>;
		/** Extra classes on the body card (omit card when empty for member lists). */
		bodyClass?: string;
		tone?: 'blue' | 'teal' | 'violet';
		/** Mobile band surface inside `.unified-reg-bleed` (public pre-register). */
		mobileSurface?: 'light' | 'dark';
		actions?: Snippet;
		children: Snippet;
	} = $props();

	const resolvedBadges = $derived.by((): SectionBadge[] => {
		if (badges && badges.length > 0) return badges;
		if (badge !== undefined && badge !== null && badge !== '') {
			return [{ text: String(badge), tone: 'primary' }];
		}
		return [];
	});
</script>

<section
	{id}
	data-surface={mobileSurface}
	class="unified-reg-band unified-reg-scroll-mt space-y-3 rounded-2xl border p-4 shadow-2xs sm:p-5 {tone ===
	'teal'
		? 'border-teal-200 bg-teal-50/70'
		: tone === 'violet'
			? 'border-violet-200 bg-violet-50/70'
			: 'border-sky-200 bg-sky-50/70'}"
>
	<div class="unified-reg-section-header">
		<div class="unified-reg-section-header-main">
			<Icon class="mt-0.5 size-5 shrink-0 text-primary" />
			<div class="min-w-0 flex-1 space-y-1.5">
				<div class="flex flex-wrap items-center gap-x-2 gap-y-1.5">
					<h2 class="text-base leading-snug font-bold text-foreground sm:text-[1.05rem]">
						{title}
					</h2>
					{#each resolvedBadges as item (item.text)}
						<span
							class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums {item.tone ===
							'muted'
								? 'border border-border bg-muted/60 text-muted-foreground'
								: 'border border-primary/20 bg-primary/10 text-primary'}"
						>
							{item.text}
						</span>
					{/each}
				</div>
				{#if description}
					<p class="text-xs leading-relaxed text-muted-foreground sm:text-[0.8125rem]">
						{description}
					</p>
				{/if}
			</div>
		</div>
		{#if actions}
			<div class="unified-reg-section-header-actions">
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
