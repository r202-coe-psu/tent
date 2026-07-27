<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import type { Evacuee, StayStatus } from '$lib/features/people';

	interface StatusConfig {
		label: string;
		colorClass: string;
		dotClass: string;
	}

	let {
		show,
		evacuee,
		statusConfig,
		onClose,
		onUpdateStatus
	}: {
		show: boolean;
		evacuee: Evacuee;
		statusConfig: Partial<Record<StayStatus, StatusConfig>>;
		onClose: () => void;
		onUpdateStatus: (status: StayStatus) => Promise<void>;
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
					แก้ไขสถานะการพักพิง (Stay status)
				</h3>
				<button
					onclick={onClose}
					class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
				>
					<X class="size-5" />
				</button>
			</div>

			<div class="space-y-2">
				{#each Object.entries(statusConfig).filter(([statusKey]) => statusKey !== 'cancelled') as [statusKey, cfg] (statusKey)}
					<button
						onclick={() => onUpdateStatus(statusKey as StayStatus)}
						class="flex w-full cursor-pointer items-center justify-between rounded-xl border border-border p-3.5 font-semibold transition-all hover:border-primary hover:bg-slate-50 dark:hover:bg-slate-900 {evacuee
							.current_stay.status === statusKey
							? 'border-primary bg-primary/5 text-primary'
							: 'bg-background'}"
					>
						<div class="flex items-center gap-2">
							<span class="size-2 rounded-full {cfg.dotClass}"></span>
							<span class="text-sm">{cfg.label}</span>
						</div>
						{#if evacuee.current_stay.status === statusKey}
							<CheckCircle class="size-5 shrink-0 text-primary" />
						{/if}
					</button>
				{/each}
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
