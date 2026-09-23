<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import X from '@lucide/svelte/icons/x';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import { resolveStatusChangeAction, type Evacuee, type StayStatus } from '$lib/features/people';
	import ModalEscapeListener from '../shared/modal-escape-listener.svelte';

	interface StatusConfig {
		label: string;
		colorClass: string;
		dotClass: string;
	}

	/** Manual picker targets only — transferred / terminal / intake statuses are excluded. */
	const MANUAL_STATUS_OPTIONS: readonly StayStatus[] = [
		'active',
		'room_confirmed',
		'temporary_leave',
		'checked_out'
	];

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
		onUpdateStatus: (status: StayStatus, reason?: string) => Promise<void>;
	} = $props();

	// Pending choice + reason reset when this instance mounts (parent remounts on
	// open / evacuee id change via `{#key}`).
	let pendingStatus = $state<StayStatus>(untrack(() => evacuee.current_stay.status));
	let reason = $state('');
	let saving = $state(false);

	const selectableOptions = $derived(
		MANUAL_STATUS_OPTIONS.flatMap((statusKey) => {
			const reachable =
				statusKey === evacuee.current_stay.status ||
				resolveStatusChangeAction(evacuee.current_stay.status, statusKey) !== null;
			const cfg = statusConfig[statusKey];
			if (!reachable || !cfg) return [];
			return [[statusKey, cfg] as const];
		})
	);

	const needsReason = $derived(
		pendingStatus === 'temporary_leave' || pendingStatus === 'checked_out'
	);

	const confirmDisabled = $derived(saving || pendingStatus === evacuee.current_stay.status);

	function selectStatus(statusKey: StayStatus) {
		if (saving) return;
		pendingStatus = statusKey;
		if (statusKey !== 'temporary_leave' && statusKey !== 'checked_out') {
			reason = '';
		}
	}

	async function handleConfirm() {
		if (confirmDisabled) return;
		if (needsReason && !reason.trim()) {
			toast.error(
				pendingStatus === 'checked_out'
					? 'การเช็คเอาท์ต้องระบุเหตุผลหรือหมายเหตุ'
					: 'การออกชั่วคราวต้องระบุเหตุผล'
			);
			return;
		}
		saving = true;
		try {
			await onUpdateStatus(pendingStatus, needsReason ? reason.trim() : undefined);
		} finally {
			saving = false;
		}
	}
</script>

{#if show}
	<ModalEscapeListener open={show} onEscape={onClose} />
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
					type="button"
					onclick={onClose}
					disabled={saving}
					class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
				>
					<X class="size-5" />
				</button>
			</div>

			<div class="space-y-2" role="radiogroup" aria-label="สถานะการพักพิง">
				{#each selectableOptions as [statusKey, cfg] (statusKey)}
					<button
						type="button"
						role="radio"
						aria-checked={pendingStatus === statusKey}
						onclick={() => selectStatus(statusKey)}
						disabled={saving}
						class="flex w-full cursor-pointer items-center justify-between rounded-xl border p-3.5 font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60 {pendingStatus ===
						statusKey
							? 'border-primary bg-primary/5 text-primary'
							: 'border-border bg-background hover:border-primary hover:bg-slate-50 dark:hover:bg-slate-900'}"
					>
						<div class="flex items-center gap-2">
							<span class="size-2 rounded-full {cfg.dotClass}"></span>
							<span class="text-sm">{cfg.label}</span>
						</div>
						{#if pendingStatus === statusKey}
							<CheckCircle class="size-5 shrink-0 text-primary" />
						{/if}
					</button>
				{/each}
			</div>

			{#if needsReason}
				<div class="space-y-1.5">
					<label for="evacuee-status-reason" class="text-xs font-semibold text-foreground">
						เหตุผล <span class="text-destructive">*</span>
					</label>
					<textarea
						id="evacuee-status-reason"
						bind:value={reason}
						disabled={saving}
						rows={3}
						placeholder="ระบุเหตุผล เช่น กลับบ้านชั่วคราว / ย้ายออก"
						class="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none disabled:opacity-60"
					></textarea>
				</div>
			{/if}

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
					{saving ? 'กำลังบันทึก...' : 'ยืนยัน'}
				</button>
			</div>
		</div>
	</div>
{/if}
