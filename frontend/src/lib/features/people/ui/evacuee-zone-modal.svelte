<script lang="ts">
	import { untrack } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import type { Evacuee } from '$lib/features/people';
	import ZoneSelectionFields from './forms/zone-selection-fields.svelte';

	interface Zone {
		code: string;
		name?: string;
		type?: string;
	}

	let {
		show,
		evacuee,
		shelterZones,
		onClose,
		onUpdateZone
	}: {
		show: boolean;
		evacuee: Evacuee;
		shelterZones: Zone[];
		onClose: () => void;
		onUpdateZone: (zoneCode: string) => Promise<void>;
	} = $props();

	let selectedZone = $state(untrack(() => evacuee.current_stay.zone ?? ''));

	$effect(() => {
		if (show) {
			selectedZone = evacuee.current_stay.zone ?? '';
		}
	});

	async function handleSelectZone(zoneCode: string) {
		selectedZone = zoneCode;
		await onUpdateZone(zoneCode);
	}
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
	>
		<div
			class="w-full max-w-md animate-in space-y-4 rounded-3xl border border-border bg-card p-6 shadow-xl duration-150 zoom-in-95 fade-in"
		>
			<div class="flex items-center justify-between border-b border-border pb-2.5">
				<h3 class="text-lg font-bold text-slate-900 dark:text-slate-50">
					ย้ายโซนที่พัก (Change stay zone)
				</h3>
				<button
					onclick={onClose}
					class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
				>
					<X class="size-5" />
				</button>
			</div>

			<div class="max-h-[360px] overflow-y-auto pr-1">
				<ZoneSelectionFields
					bind:selected_zone={selectedZone}
					shelter_zones={shelterZones}
					{evacuee}
					onSelectZone={handleSelectZone}
				/>
			</div>

			<div class="flex justify-end gap-2 border-t border-border pt-3">
				<button
					onclick={onClose}
					class="cursor-pointer rounded-xl border border-border bg-background px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-muted dark:text-slate-200"
				>
					ยกเลิก
				</button>
			</div>
		</div>
	</div>
{/if}
