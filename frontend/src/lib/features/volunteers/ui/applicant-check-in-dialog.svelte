<script lang="ts">
	/**
	 * Check-in or check-out confirmation for one shift assignment (applicants tab #840, roster
	 * tab #1089). `mode` picks which; both work the same way.
	 *
	 * Two ways to confirm, neither of which writes until staff pick it:
	 *   - scan the volunteer's own QR (digital pass / role card) — saves with `method: 'qr'`,
	 *     but only when the scan resolves to THIS assignment's volunteer;
	 *   - confirm without a scan — `manual_override`, which the repository only accepts with a
	 *     reason, so the reason is required here too.
	 *
	 * Self-contained on purpose (owns its mutations and toasts) so any row that can offer a
	 * check-in or check-out action can drop it in.
	 */
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import IdCard from '@lucide/svelte/icons/id-card';
	import LogIn from '@lucide/svelte/icons/log-in';
	import LogOut from '@lucide/svelte/icons/log-out';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { formatThaiDateTime } from '$lib/utils/date';
	import { lookupVolunteerByScanCode, useCheckIn, useCheckOut } from '../application/queries';
	import { matchCheckInScan } from '../domain/check-in-scan-match';
	import type { CheckInMethod, ShiftAssignment } from '../domain/shift-assignment.schema';
	import type { Volunteer } from '../domain/volunteer.schema';
	import VolunteerScannerCard from './volunteer-scanner-card.svelte';

	let {
		open = $bindable(false),
		mode = 'check_in',
		assignment,
		volunteer = null,
		personName,
		shiftLabel
	}: {
		open?: boolean;
		/** Check in (default) or check out; the wording and the mutation follow it. */
		mode?: 'check_in' | 'check_out';
		/** The assignment being checked into or out of; its `volunteer_id` is who a scan must belong to. */
		assignment: ShiftAssignment;
		/** Roster profile, for the volunteer code shown as a double-check. */
		volunteer?: Volunteer | null;
		personName: string;
		/** e.g. `2026-09-05 · 08:00 - 16:00 น.` — formatted by the caller. */
		shiftLabel: string;
	} = $props();

	const queryClient = useQueryClient();
	const checkInMutation = useCheckIn(queryClient);
	const checkOutMutation = useCheckOut(queryClient);
	const mutation = $derived(mode === 'check_out' ? checkOutMutation : checkInMutation);
	const reasonId = $props.id();

	const COPY = {
		check_in: {
			title: 'เช็คอินเข้างาน',
			description: 'ยืนยันตัวอาสาสมัครด้วยการสแกน QR หรือเช็คอินแทนพร้อมเหตุผล',
			done: 'เช็คอินเข้างาน',
			failed: 'เช็คอินไม่สำเร็จ',
			manualHint: 'สแกนไม่ได้? เช็คอินโดยไม่สแกนต้องระบุเหตุผล',
			manualLabel: 'เหตุผลที่เช็คอินโดยไม่สแกน',
			manualSection: 'เช็คอินโดยไม่สแกน',
			confirm: 'ยืนยันเช็คอิน'
		},
		check_out: {
			title: 'เช็คเอาต์ออกงาน',
			description: 'ยืนยันตัวอาสาสมัครด้วยการสแกน QR หรือเช็คเอาต์แทนพร้อมเหตุผล',
			done: 'เช็คเอาต์ออกงาน',
			failed: 'เช็คเอาต์ไม่สำเร็จ',
			manualHint: 'สแกนไม่ได้? เช็คเอาต์โดยไม่สแกนต้องระบุเหตุผล',
			manualLabel: 'เหตุผลที่เช็คเอาต์โดยไม่สแกน',
			manualSection: 'เช็คเอาต์โดยไม่สแกน',
			confirm: 'ยืนยันเช็คเอาต์'
		}
	} as const;
	const copy = $derived(COPY[mode]);

	let reason = $state('');
	let scanError = $state<string | null>(null);
	let resolving = $state(false);

	const busy = $derived(resolving || mutation.isPending);

	$effect(() => {
		if (!open) {
			reason = '';
			scanError = null;
		}
	});

	async function confirm(method: CheckInMethod, manualReason?: string) {
		try {
			await mutation.mutateAsync({ id: assignment._id, method, reason: manualReason });
			toast.success(`${copy.done} ${personName} แล้ว`);
			open = false;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : copy.failed);
		}
	}

	async function handleScan(raw: string) {
		if (busy) return;
		resolving = true;
		scanError = null;
		try {
			const scanned = await lookupVolunteerByScanCode(raw).catch(() => null);
			// Staff may have cancelled while the lookup ran; never write after that.
			if (!open) return;
			const result = matchCheckInScan(assignment.volunteer_id, scanned);
			if (result.kind === 'match') {
				await confirm('qr');
			} else if (result.kind === 'mismatch') {
				scanError = `QR นี้เป็นของ ${result.scannedName} (${result.scannedCode}) ไม่ใช่ ${personName}`;
			} else {
				scanError = `ไม่พบอาสาสมัครจาก QR นี้ — โปรดสแกน QR ของ ${personName}`;
			}
		} finally {
			resolving = false;
		}
	}

	function confirmManual() {
		const trimmed = reason.trim();
		if (!trimmed || busy) return;
		scanError = null;
		void confirm('manual_override', trimmed);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2">
				{#if mode === 'check_out'}
					<LogOut class="h-4.5 w-4.5 text-amber-600" />
				{:else}
					<LogIn class="h-4.5 w-4.5 text-emerald-600" />
				{/if}
				{copy.title}
			</Dialog.Title>
			<Dialog.Description>{copy.description}</Dialog.Description>
		</Dialog.Header>

		<div class="space-y-1 rounded-xl border border-border bg-muted/40 p-3 text-sm">
			<p class="font-bold break-words text-foreground">{personName}</p>
			{#if volunteer?.volunteer_code}
				<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
					<IdCard class="h-3.5 w-3.5" />
					รหัสอาสาสมัคร:
					<span class="font-mono font-bold text-foreground">{volunteer.volunteer_code}</span>
				</p>
			{/if}
			<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
				<CalendarClock class="h-3.5 w-3.5" />
				กะ: <span class="font-bold text-foreground">{shiftLabel}</span>
			</p>
			{#if mode === 'check_out' && assignment.check_in_at}
				<p class="flex items-center gap-1.5 text-xs text-muted-foreground">
					<LogIn class="h-3.5 w-3.5" />
					เช็คอินเมื่อ:
					<span class="font-bold text-foreground"
						>{formatThaiDateTime(assignment.check_in_at)} น.</span
					>
				</p>
			{/if}
		</div>

		<section class="space-y-2" aria-label="สแกน QR">
			<VolunteerScannerCard isProcessing={busy} onsubmit={handleScan} />
			{#if scanError}
				<p
					role="alert"
					class="flex items-start gap-1.5 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm font-medium text-rose-700"
				>
					<CircleAlert class="mt-0.5 h-4 w-4 shrink-0" />
					{scanError}
				</p>
			{/if}
		</section>

		<section class="space-y-2 border-t border-border pt-3" aria-label={copy.manualSection}>
			<p class="text-xs font-semibold text-muted-foreground">{copy.manualHint}</p>
			<div class="space-y-1.5">
				<Label for={reasonId} class="text-sm font-semibold">
					{copy.manualLabel} <span class="text-destructive">*</span>
				</Label>
				<Input
					id={reasonId}
					bind:value={reason}
					placeholder="เช่น อาสาสมัครลืมโทรศัพท์, กล้องสแกนขัดข้อง"
					autocomplete="off"
				/>
			</div>
		</section>

		<div class="flex justify-end gap-2">
			<Button variant="outline" disabled={mutation.isPending} onclick={() => (open = false)}>
				ยกเลิก
			</Button>
			<Button
				class={mode === 'check_out'
					? 'gap-1.5 bg-amber-500 text-white hover:bg-amber-600'
					: 'gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700'}
				disabled={!reason.trim() || busy}
				onclick={confirmManual}
			>
				{copy.confirm}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
