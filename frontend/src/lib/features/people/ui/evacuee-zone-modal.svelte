<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import type { Evacuee } from '$lib/features/people';

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

			<div class="max-h-[300px] space-y-2 overflow-y-auto pr-1">
				{#if shelterZones.length === 0}
					<p class="py-4 text-center text-sm text-muted-foreground">ไม่พบรายการโซนในระบบ</p>
				{:else}
					{#each shelterZones as zone (zone.code)}
						<button
							onclick={() => onUpdateZone(zone.code)}
							class="group flex w-full cursor-pointer items-center justify-between rounded-xl border border-border p-3.5 font-semibold transition-all hover:border-primary hover:bg-slate-50 dark:hover:bg-slate-900 {evacuee
								.current_stay.zone === zone.code
								? 'border-primary bg-primary/5 text-primary'
								: 'bg-background'}"
						>
							<div class="flex flex-col">
								<span class="text-sm">{zone.name || zone.code}</span>
								<span class="mt-0.5 text-[10px] font-normal text-muted-foreground">
									Code: {zone.code.toUpperCase()}
									{zone.type ? `| Type: ${zone.type}` : ''}
								</span>
							</div>
							{#if evacuee.current_stay.zone === zone.code}
								<CheckCircle class="size-5 shrink-0 text-primary" />
							{/if}
						</button>
					{/each}
				{/if}
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
