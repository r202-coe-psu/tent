<script lang="ts">
	import type { Component } from 'svelte';
	import ChevronUp from '@lucide/svelte/icons/chevron-up';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Save from '@lucide/svelte/icons/save';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu/index.js';

	export type ShelterFormNavItem = {
		id: string;
		label: string;
		icon: Component<{ class?: string }>;
	};

	let {
		sections,
		activeSection,
		sectionsWithErrors,
		ariaLabel,
		onNavigate,
		showSave = true,
		savePending = false,
		saveDisabled = false
	}: {
		sections: ShelterFormNavItem[];
		activeSection: string;
		sectionsWithErrors: Set<string> | string[];
		ariaLabel: string;
		onNavigate: (id: string) => void;
		showSave?: boolean;
		savePending?: boolean;
		saveDisabled?: boolean;
	} = $props();

	const activeNavItem = $derived(
		sections.find((section) => section.id === activeSection) ?? sections[0]
	);

	const activeHasError = $derived(sectionHasError(activeSection));

	function sectionHasError(id: string): boolean {
		if (sectionsWithErrors instanceof Set) return sectionsWithErrors.has(id);
		return sectionsWithErrors.includes(id);
	}
</script>

<!--
  Mobile-only bottom chrome: section jump + Save.
  Desktop Save lives in the sticky title bar (shelter-form-page).
  Fixed (not end-of-form sticky) so Save stays reachable while scrolling a long form —
  same always-visible approach as registration-shell's bottom save bar.
-->
<div class="shelter-form-bottom-chrome md:hidden">
	{#if sections.length > 0}
		<nav aria-label={ariaLabel}>
			<DropdownMenu.Root>
				<DropdownMenu.Trigger
					aria-label={ariaLabel}
					class="touch-target flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl border border-shelter-border bg-card px-3 py-2 text-sm font-semibold text-foreground shadow-2xs transition-colors hover:border-primary/40 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
				>
					{#if activeNavItem}
						{@const ActiveIcon = activeNavItem.icon}
						<ActiveIcon class="size-4 shrink-0" />
						<span class="min-w-0 flex-1 truncate text-left">{activeNavItem.label}</span>
						{#if activeHasError}
							<AlertCircle class="size-4 shrink-0 text-destructive" aria-hidden="true" />
							<span class="sr-only">มีส่วนที่ต้องแก้ไข</span>
						{/if}
					{/if}
					<ChevronUp class="size-4 shrink-0 text-muted-foreground" />
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
							{@const hasError = sectionHasError(section.id)}
							<DropdownMenu.RadioItem
								value={section.id}
								class="touch-target min-h-11 cursor-pointer gap-2 py-2.5 text-sm font-semibold"
							>
								<Icon class="size-4 shrink-0" />
								<span class="min-w-0 flex-1">{section.label}</span>
								{#if hasError}
									<AlertCircle class="size-3.5 shrink-0 text-destructive" aria-hidden="true" />
									<span class="sr-only">มีข้อมูลที่ต้องแก้ไข</span>
								{/if}
							</DropdownMenu.RadioItem>
						{/each}
					</DropdownMenu.RadioGroup>
				</DropdownMenu.Content>
			</DropdownMenu.Root>
		</nav>
	{/if}

	{#if showSave}
		<div class="flex items-center justify-end">
			<Button
				type="submit"
				form="shelter-form"
				disabled={savePending || saveDisabled}
				class="h-11 w-full gap-2 rounded-xl text-base font-semibold shadow-xs sm:w-auto sm:min-w-56 sm:px-8"
			>
				{#if savePending}
					<Loader2 class="size-4 animate-spin" />
					<span>กำลังบันทึก...</span>
				{:else}
					<Save class="size-4" />
					<span>บันทึกข้อมูล</span>
				{/if}
			</Button>
		</div>
	{/if}
</div>
