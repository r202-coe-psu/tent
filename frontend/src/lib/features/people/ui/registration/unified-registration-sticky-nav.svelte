<script lang="ts">
	import type { Component } from 'svelte';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';
	import * as Sheet from '$lib/components/ui/sheet/index.js';

	export type UnifiedFormNavItem = {
		id: string;
		label: string;
		icon: Component<{ class?: string }>;
	};

	let {
		sections,
		activeSection,
		ariaLabel,
		compact = false,
		onNavigate
	}: {
		sections: UnifiedFormNavItem[];
		activeSection: string;
		ariaLabel: string;
		compact?: boolean;
		onNavigate: (id: string) => void;
	} = $props();

	const activeNavItem = $derived(
		sections.find((section) => section.id === activeSection) ?? sections[0]
	);

	let sheetOpen = $state(false);

	const compactTriggerClass =
		'touch-target inline-flex h-11 shrink-0 cursor-pointer items-center justify-center gap-1 rounded-xl border border-border bg-card px-2.5 text-foreground shadow-2xs transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none';

	const fullTriggerClass =
		'touch-target flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl border border-border bg-card px-3 py-2 text-sm font-semibold text-foreground shadow-2xs transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none';

	function navigateTo(id: string) {
		onNavigate(id);
		sheetOpen = false;
	}
</script>

<nav aria-label={ariaLabel}>
	{#if compact}
		<!-- Mobile bottom chrome: bottom sheet instead of a floating center dropdown -->
		<Sheet.Root bind:open={sheetOpen}>
			<Sheet.Trigger aria-label={ariaLabel} class={compactTriggerClass}>
				{#if activeNavItem}
					{@const ActiveIcon = activeNavItem.icon}
					<ActiveIcon class="size-4 shrink-0 text-primary" />
				{/if}
				<ChevronUp class="size-3.5 shrink-0 text-muted-foreground" />
			</Sheet.Trigger>
			<Sheet.Content side="bottom" class="max-h-[70dvh] gap-0 rounded-t-2xl p-0">
				<Sheet.Header class="border-b border-border px-4 py-3 text-left">
					<Sheet.Title class="text-base font-semibold">{ariaLabel}</Sheet.Title>
				</Sheet.Header>
				<div
					class="flex flex-col gap-1 overflow-y-auto px-3 py-3 pb-[max(1rem,env(safe-area-inset-bottom))]"
				>
					{#each sections as section (section.id)}
						{@const Icon = section.icon}
						<button
							type="button"
							class="touch-target flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition-colors {section.id ===
							activeSection
								? 'bg-primary-muted text-primary'
								: 'text-foreground hover:bg-muted/60'}"
							aria-current={section.id === activeSection ? 'true' : undefined}
							onclick={() => navigateTo(section.id)}
						>
							<Icon class="size-4 shrink-0" />
							<span class="min-w-0 flex-1 truncate">{section.label}</span>
						</button>
					{/each}
				</div>
			</Sheet.Content>
		</Sheet.Root>
	{:else}
		<DropdownMenu.Root>
			<DropdownMenu.Trigger aria-label={ariaLabel} class={fullTriggerClass}>
				{#if activeNavItem}
					{@const ActiveIcon = activeNavItem.icon}
					<ActiveIcon class="size-4 shrink-0 text-primary" />
					<span class="min-w-0 flex-1 truncate text-left">{activeNavItem.label}</span>
				{/if}
				<ChevronUp class="size-3.5 shrink-0 text-muted-foreground" />
			</DropdownMenu.Trigger>
			<DropdownMenu.Content
				side="top"
				align="start"
				class="w-(--bits-floating-anchor-width) min-w-56"
			>
				<DropdownMenu.RadioGroup
					value={activeSection}
					onValueChange={(id) => {
						if (id) onNavigate(id);
					}}
				>
					{#each sections as section (section.id)}
						{@const Icon = section.icon}
						<DropdownMenu.RadioItem
							value={section.id}
							class="touch-target min-h-11 cursor-pointer gap-2 py-2.5 text-sm font-semibold"
						>
							<Icon class="size-4 shrink-0" />
							{section.label}
						</DropdownMenu.RadioItem>
					{/each}
				</DropdownMenu.RadioGroup>
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	{/if}
</nav>
