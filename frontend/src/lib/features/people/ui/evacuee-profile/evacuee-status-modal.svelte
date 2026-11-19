<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import X from '@lucide/svelte/icons/x';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import { resolveStatusChangeAction, type Evacuee, type StayStatus } from '$lib/features/people';
	import { getTranslation } from '$lib/utils/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { EVACUEE_PROFILE_MODALS_I18N } from '../_constants/evacuee-profile-modals.i18n';
	import ModalEscapeListener from '../shared/modal-escape-listener.svelte';

	interface StatusConfig {
		label: string;
		colorClass: string;
		dotClass: string;
	}

	/**
	 * Picker targets for everyone: the normal forward statuses only — transferred / terminal
	 * statuses and the intake statuses are excluded.
	 */
	const MANUAL_STATUS_OPTIONS: readonly StayStatus[] = [
		'pre_registered',
		'arriving',
		'active',
		'room_confirmed',
		'temporary_leave',
		'checked_out'
	];

	/**
	 * Manual override picker (`canRevert`, shelter manager / system admin, CR-262 A1): every stay
	 * status, whatever the current one is. Targets with no normal action resolve to `revert_status`.
	 */
	const OVERRIDE_STATUS_OPTIONS: readonly StayStatus[] = [
		'pre_registered',
		'kiosk_registered',
		'arriving',
		'active',
		'room_confirmed',
		'temporary_leave',
		'transferred',
		'checked_out',
		'deceased',
		'cancelled'
	];

	let {
		show,
		evacuee,
		statusConfig,
		canRevert = false,
		onClose,
		onUpdateStatus
	}: {
		show: boolean;
		evacuee: Evacuee;
		statusConfig: Partial<Record<StayStatus, StatusConfig>>;
		/** Allow manual override (`revert_status`) targets — shelter_manager / system_admin only. */
		canRevert?: boolean;
		onClose: () => void;
		onUpdateStatus: (status: StayStatus, reason?: string) => Promise<void>;
	} = $props();

	const t = $derived(getTranslation(EVACUEE_PROFILE_MODALS_I18N, langState.current).status);

	// Pending choice + reason reset when this instance mounts (parent remounts on
	// open / evacuee id change via `{#key}`).
	let pendingStatus = $state<StayStatus>(untrack(() => evacuee.current_stay.status));
	let reason = $state('');
	let saving = $state(false);

	const selectableOptions = $derived(
		(canRevert ? OVERRIDE_STATUS_OPTIONS : MANUAL_STATUS_OPTIONS).flatMap((statusKey) => {
			const action = resolveStatusChangeAction(evacuee.current_stay.status, statusKey);
			const reachable =
				statusKey === evacuee.current_stay.status ||
				(action !== null && (action !== 'revert_status' || canRevert));
			const cfg = statusConfig[statusKey];
			if (!reachable || !cfg) return [];
			return [[statusKey, cfg] as const];
		})
	);

	function requiresReason(status: StayStatus): boolean {
		return (
			status === 'temporary_leave' ||
			status === 'checked_out' ||
			resolveStatusChangeAction(evacuee.current_stay.status, status) === 'revert_status'
		);
	}

	const needsReason = $derived(requiresReason(pendingStatus));
	const isRevert = $derived(
		resolveStatusChangeAction(evacuee.current_stay.status, pendingStatus) === 'revert_status'
	);

	const confirmDisabled = $derived(saving || pendingStatus === evacuee.current_stay.status);

	function selectStatus(statusKey: StayStatus) {
		if (saving) return;
		pendingStatus = statusKey;
		if (!requiresReason(statusKey)) {
			reason = '';
		}
	}

	async function handleConfirm() {
		if (confirmDisabled) return;
		if (needsReason && !reason.trim()) {
			toast.error(
				isRevert
					? t.revertReasonRequired
					: pendingStatus === 'checked_out'
						? t.checkedOutReasonRequired
						: t.leaveReasonRequired
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
		class="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/40 backdrop-blur-xs sm:items-center sm:p-4"
	>
		<div
			class="flex max-h-[90dvh] w-full animate-in flex-col rounded-t-3xl border border-border bg-card shadow-xl duration-150 zoom-in-95 fade-in sm:max-h-[calc(100dvh-2rem)] sm:max-w-xl sm:rounded-3xl"
		>
			<div
				class="flex shrink-0 items-center justify-between border-b border-border px-5 py-3.5 sm:px-6"
			>
				<h3 class="text-lg font-bold text-slate-900 dark:text-slate-50">
					{t.title}
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

			<div class="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 py-4 sm:px-6">
				<div class="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label={t.groupAria}>
					{#each selectableOptions as [statusKey, cfg] (statusKey)}
						<button
							type="button"
							role="radio"
							aria-checked={pendingStatus === statusKey}
							onclick={() => selectStatus(statusKey)}
							disabled={saving}
							class="flex min-h-11 w-full cursor-pointer items-center justify-between gap-2 rounded-xl border px-3 py-2.5 text-left font-semibold transition-all disabled:cursor-not-allowed disabled:opacity-60 {pendingStatus ===
							statusKey
								? 'border-primary bg-primary/5 text-primary'
								: 'border-border bg-background hover:border-primary hover:bg-slate-50 dark:hover:bg-slate-900'}"
						>
							<div class="flex min-w-0 items-center gap-2">
								<span class="size-2 shrink-0 rounded-full {cfg.dotClass}"></span>
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
							{t.reason} <span class="text-destructive">*</span>
						</label>
						<textarea
							id="evacuee-status-reason"
							bind:value={reason}
							disabled={saving}
							rows={3}
							placeholder={isRevert ? t.revertReasonPlaceholder : t.reasonPlaceholder}
							class="w-full resize-y rounded-xl border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 focus-visible:outline-none disabled:opacity-60"
						></textarea>
					</div>
				{/if}
			</div>

			<div
				class="flex shrink-0 gap-2 border-t border-border px-5 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:justify-end sm:px-6 sm:pb-3"
			>
				<button
					type="button"
					onclick={onClose}
					disabled={saving}
					class="h-11 flex-1 cursor-pointer rounded-xl border border-border bg-background px-4 text-sm font-semibold text-slate-800 transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50 sm:h-9 sm:flex-none sm:text-xs dark:text-slate-200"
				>
					{t.cancel}
				</button>
				<button
					type="button"
					onclick={handleConfirm}
					disabled={confirmDisabled}
					class="h-11 flex-1 cursor-pointer rounded-xl bg-primary px-4 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:pointer-events-none disabled:opacity-50 sm:h-9 sm:flex-none sm:text-xs"
				>
					{saving ? t.saving : t.confirm}
				</button>
			</div>
		</div>
	</div>
{/if}
