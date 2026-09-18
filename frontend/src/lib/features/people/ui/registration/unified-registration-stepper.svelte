<script lang="ts">
	import Check from '@lucide/svelte/icons/check';
	import Home from '@lucide/svelte/icons/home';
	import Users from '@lucide/svelte/icons/users';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import Package from '@lucide/svelte/icons/package';
	import type { Component } from 'svelte';

	export type StepperSection = {
		id: string;
		label: string;
		icon?: Component<{ class?: string }>;
	};

	let {
		sections,
		activeSection,
		onNavigate
	}: {
		sections: StepperSection[];
		activeSection: string;
		onNavigate: (id: string) => void;
	} = $props();

	function getShortTitle(id: string, fallback: string): string {
		switch (id) {
			case 'address':
				return 'ที่พักอาศัย';
			case 'members':
				return 'สมาชิก';
			case 'pets':
				return 'สัตว์เลี้ยง';
			case 'vehicles':
				return 'ยานพาหนะ';
			default:
				return fallback;
		}
	}

	function getSectionIcon(id: string): Component<{ class?: string }> {
		switch (id) {
			case 'address':
				return Home;
			case 'members':
				return Users;
			case 'pets':
				return PawPrint;
			case 'vehicles':
				return Package;
			default:
				return Home;
		}
	}

	const activeIndex = $derived(
		Math.max(
			0,
			sections.findIndex((s) => s.id === activeSection)
		)
	);
</script>

<nav aria-label="ขั้นตอนการลงทะเบียน" class="w-full">
	<div class="rounded-2xl border border-border/60 bg-card p-3 shadow-2xs sm:p-4">
		<ol class="flex items-center justify-between gap-1 sm:gap-3">
			{#each sections as section, index (section.id)}
				{@const isCurrent = section.id === activeSection}
				{@const isCompleted = index < activeIndex}
				{@const Icon = section.icon ?? getSectionIcon(section.id)}

				<li class="flex min-w-0 flex-1 items-center {index < sections.length - 1 ? 'w-full' : ''}">
					<button
						type="button"
						onclick={() => onNavigate(section.id)}
						class="group flex min-w-0 items-center gap-2 text-left transition-colors focus-visible:outline-none"
						aria-current={isCurrent ? 'step' : undefined}
					>
						<span
							class="flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold transition-all sm:size-8 {isCurrent
								? 'bg-primary text-primary-foreground shadow-2xs ring-3 ring-primary/20'
								: isCompleted
									? 'border border-primary/30 bg-primary/10 text-primary'
									: 'border border-border bg-muted/40 text-muted-foreground group-hover:bg-muted group-hover:text-foreground'}"
						>
							{#if isCompleted}
								<Check class="size-3.5 sm:size-4" />
							{:else}
								{index + 1}
							{/if}
						</span>

						<div class="min-w-0 flex-col">
							<span
								class="hidden text-3xs font-medium text-muted-foreground uppercase sm:block sm:text-2xs"
							>
								ขั้นตอนที่ {index + 1}
							</span>
							<span
								class="block truncate text-xs font-semibold {isCurrent
									? 'text-primary'
									: isCompleted
										? 'text-foreground'
										: 'text-muted-foreground group-hover:text-foreground'}"
							>
								{getShortTitle(section.id, section.label)}
							</span>
						</div>
					</button>

					{#if index < sections.length - 1}
						<div
							class="mx-2 h-0.5 flex-1 rounded-full transition-colors sm:mx-3 {isCompleted
								? 'bg-primary/40'
								: 'bg-border/60'}"
							aria-hidden="true"
						></div>
					{/if}
				</li>
			{/each}
		</ol>
	</div>
</nav>
