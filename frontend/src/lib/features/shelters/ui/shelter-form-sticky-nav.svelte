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
	<div class="mx-auto max-w-7xl">
		<div class="flex flex-col gap-2.5">
			{#if sections.length > 0}
				<nav aria-label={ariaLabel} class="w-full min-w-0">
					<DropdownMenu.Root>
						<DropdownMenu.Trigger
							aria-label={ariaLabel}
							class="flex h-11 w-full min-w-0 cursor-pointer items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2 text-sm font-semibold text-slate-800 shadow-2xs transition-colors hover:border-slate-300 hover:bg-slate-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
						>
							<div class="flex min-w-0 flex-1 items-center gap-2">
								{#if activeNavItem}
									{@const ActiveIcon = activeNavItem.icon}
									<ActiveIcon class="size-4 shrink-0 text-[#0A2647]" />
									<span class="truncate text-left">{activeNavItem.label}</span>
									{#if activeHasError}
										<AlertCircle class="size-4 shrink-0 text-red-600" aria-hidden="true" />
										<span class="sr-only">มีส่วนที่ต้องแก้ไข</span>
									{/if}
								{/if}
							</div>
							<ChevronUp class="size-4 shrink-0 text-slate-400" />
						</DropdownMenu.Trigger>
						<DropdownMenu.Content
							side="top"
							align="start"
							class="max-h-72 w-(--bits-floating-anchor-width) min-w-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-lg"
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
										class="min-h-11 cursor-pointer gap-2.5 rounded-lg py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 focus:bg-slate-50"
									>
										<Icon class="size-4 shrink-0" />
										<span class="min-w-0 flex-1">{section.label}</span>
										{#if hasError}
											<AlertCircle class="size-3.5 shrink-0 text-red-600" aria-hidden="true" />
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
				<div class="w-full min-w-0">
					<Button
						type="submit"
						form="shelter-form"
						disabled={savePending || saveDisabled}
						class="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#0A2647] text-sm font-semibold text-white shadow-2xs transition hover:bg-[#051930] active:scale-[0.98]"
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
	</div>
</div>
