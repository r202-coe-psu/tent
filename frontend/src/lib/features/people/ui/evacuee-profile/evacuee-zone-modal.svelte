<script lang="ts">
	import { untrack } from 'svelte';
	import X from '@lucide/svelte/icons/x';
	import type { Evacuee, Screening } from '$lib/features/people';
	import ZoneSelectionFields from '../forms/zone-selection-fields.svelte';
	import ModalEscapeListener from '../shared/modal-escape-listener.svelte';

	interface Zone {
		code: string;
		name?: string;
		type?: string;
	}

	let {
		show,
		evacuee,
		screening = null,
		shelterZones,
		onClose,
		onUpdateZone
	}: {
		show: boolean;
		evacuee: Evacuee;
		screening?: Screening | null;
		shelterZones: Zone[];
		onClose: () => void;
		onUpdateZone: (zoneCode: string) => Promise<void>;
	} = $props();

	let selectedZone = $state(untrack(() => evacuee.current_stay.zone ?? ''));
	let saving = $state(false);

	$effect(() => {
		if (show) {
			selectedZone = untrack(() => evacuee.current_stay.zone ?? '');
			saving = false;
		}
	});

	const confirmDisabled = $derived(
		saving || !selectedZone || selectedZone === (evacuee.current_stay.zone ?? '')
	);

	function handleSelectZone(zoneCode: string) {
		if (saving) return;
		selectedZone = zoneCode;
	}

	async function handleConfirm() {
		if (confirmDisabled) return;
		saving = true;
		try {
			await onUpdateZone(selectedZone);
		} finally {
			saving = false;
		}
	}
</script>

{#if show}
	<ModalEscapeListener open={show} disabled={saving} onEscape={onClose} />
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
	>
		<div
			class="w-full max-w-md animate-in space-y-4 rounded-2xl border border-border bg-card p-6 shadow-xl duration-150 zoom-in-95 fade-in"
		>
			<div class="flex items-center justify-between border-b border-border pb-2.5">
				<h3 class="text-lg font-bold text-slate-900 dark:text-slate-50">
					ย้ายโซนที่พัก (Change stay zone)
				</h3>
				<button
					type="button"
					onclick={onClose}
					disabled={saving}
					class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
				>
					<X class="size-5" />
				</button>
			</div>

			<div class="max-h-[360px] overflow-y-auto pr-1">
				<ZoneSelectionFields
					bind:selected_zone={selectedZone}
					shelter_zones={shelterZones}
					{evacuee}
					ewar_symptoms={screening?.symptoms}
					disabled={saving}
					onSelectZone={handleSelectZone}
				/>
			</div>

			<div class="flex justify-end gap-2 border-t border-border pt-3">
				<button
					type="button"
					onclick={onClose}
					disabled={saving}
					class="cursor-pointer rounded-xl border border-border bg-background px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50 dark:text-slate-200"
				>
					ยกเลิก
				</button>
				<button
					type="button"
					onclick={handleConfirm}
					disabled={confirmDisabled}
					class="cursor-pointer rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50"
				>
					{saving ? 'กำลังบันทึก...' : 'ยืนยันย้ายโซน'}
				</button>
			</div>
		</div>
	</div>
{/if}
