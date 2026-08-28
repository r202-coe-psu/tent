<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Truck from '@lucide/svelte/icons/truck';
	import Calendar from '@lucide/svelte/icons/calendar';
	import Phone from '@lucide/svelte/icons/phone';
	import Check from '@lucide/svelte/icons/check';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import type { PendingDonationRow } from '$lib/features/donations';

	let {
		open = false,
		request,
		saving = false,
		onclose,
		onApprove,
		onReject
	}: {
		open: boolean;
		request: PendingDonationRow | null;
		saving?: boolean;
		onclose: () => void;
		onApprove: (bookingRef: string, memo: string) => void;
		onReject: (bookingRef: string, reason: string) => void;
	} = $props();

	let memo = $state('');
	let rejectReason = $state('');
	let showRejectReasonError = $state(false);

	$effect(() => {
		if (open) {
			memo = '';
			rejectReason = '';
			showRejectReasonError = false;
		}
	});

	function handleReject() {
		if (!request) return;
		if (!rejectReason.trim()) {
			showRejectReasonError = true;
			return;
		}
		onReject(request.booking_ref ?? '', rejectReason.trim());
	}
</script>

{#if open && request}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex animate-in items-center justify-center bg-black/40 p-4 backdrop-blur-xs duration-200 fade-in"
		onclick={onclose}
	>
		<div
			class="relative flex max-h-[95vh] w-full max-w-2xl animate-in flex-col rounded-3xl border border-border bg-card text-foreground shadow-2xl duration-200 zoom-in-95"
			onclick={(e) => e.stopPropagation()}
		>
			<!-- Modal Header -->
			<div
				class="flex items-start justify-between rounded-t-3xl border-b border-border/20 bg-blue-700 p-6 text-white"
			>
				<div>
					<div class="mb-2 flex items-center gap-2">
						<span class="rounded bg-amber-500 px-2 py-0.5 text-2xs font-extrabold text-black">
							รอการประเมิน
						</span>
						<span class="text-xs font-medium text-zinc-400">Ref: {request.booking_ref}</span>
					</div>
					<h3 class="text-lg font-bold text-white">{request.donor_name || 'ไม่ระบุชื่อ'}</h3>
				</div>
				<button
					type="button"
					onclick={onclose}
					class="cursor-pointer rounded-lg p-1.5 text-zinc-400 transition-colors hover:bg-zinc-800 hover:text-white"
				>
					<X class="h-5 w-5" />
				</button>
			</div>
			<!-- Modal Body (Scrollable) -->
			<div class="flex-1 space-y-6 overflow-y-auto p-6">
				<!-- Items -->
				<div class="space-y-2">
					<h5
						class="flex items-center gap-1.5 text-2xs font-extrabold tracking-wider text-muted-foreground uppercase"
					>
						<ClipboardList class="h-3.5 w-3.5" />
						รายการที่แจ้งบริจาค
					</h5>
					<div class="space-y-1.5 rounded-xl border border-border/40 bg-muted/60 p-4">
						{#each request.items as it, i (i)}
							<div class="flex items-center justify-between text-xs font-bold text-foreground">
								<span>{it.free_text ?? it.item_id ?? 'ไม่ระบุ'}</span>
								<span class="text-muted-foreground">{it.qty} {it.unit}</span>
							</div>
						{:else}
							<p class="text-xs text-muted-foreground">ไม่มีรายการสิ่งของ</p>
						{/each}
					</div>
				</div>
				<!-- Details grid -->
				<div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
					<div class="flex gap-3 rounded-xl border border-border bg-card p-4">
						<Truck class="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
						<div>
							<span class="text-2xs font-bold text-muted-foreground uppercase">วิธีจัดส่ง</span>
							<p class="mt-1 text-xs font-semibold text-foreground">
								{request.delivery_method ?? 'ไม่ระบุ'}
							</p>
						</div>
					</div>
					<div class="flex gap-3 rounded-xl border border-border bg-card p-4">
						<Calendar class="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
						<div>
							<span class="text-2xs font-bold text-muted-foreground uppercase">นัดหมาย/ETA</span>
							<p class="mt-1 text-xs font-semibold text-foreground">
								{request.slot
									? `${request.slot.date} ${request.slot.from}-${request.slot.to}`
									: (request.eta ?? 'ไม่ระบุ')}
							</p>
						</div>
					</div>
					<div class="flex gap-3 rounded-xl border border-border bg-card p-4 sm:col-span-2">
						<Phone class="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />
						<div>
							<span class="text-2xs font-bold text-muted-foreground uppercase"
								>ข้อมูลติดต่อผู้บริจาค</span
							>
							<p class="mt-1 text-xs font-semibold text-foreground">
								{request.donor_phone ?? 'ไม่ระบุเบอร์โทร'}
							</p>
						</div>
					</div>
				</div>
				<!-- Approve memo -->
				<div class="space-y-2">
					<label
						for="memo"
						class="text-2xs font-extrabold tracking-wider text-muted-foreground uppercase"
						>บันทึกความเห็นเจ้าหน้าที่ (ถ้ามี — ใช้ตอนอนุมัติ)</label
					>
					<textarea
						id="memo"
						rows="2"
						placeholder="เช่น ตรวจสอบเบื้องต้นแล้ว รอนัดหมายรับของ..."
						bind:value={memo}
						class="w-full rounded-xl border border-border bg-muted/20 px-3.5 py-2.5 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
					></textarea>
				</div>
				<!-- Reject reason -->
				<div class="space-y-2">
					<label
						for="reject-reason"
						class="text-2xs font-extrabold tracking-wider text-muted-foreground uppercase"
						>เหตุผลการปฏิเสธ (จำเป็นเมื่อกดปฏิเสธ)</label
					>
					<textarea
						id="reject-reason"
						rows="2"
						placeholder="ระบุเหตุผลที่ปฏิเสธคำขอนี้..."
						bind:value={rejectReason}
						oninput={() => (showRejectReasonError = false)}
						class="w-full rounded-xl border px-3.5 py-2.5 text-xs text-foreground outline-hidden focus:ring-1 {showRejectReasonError
							? 'border-red-500 bg-red-50 focus:border-red-500 focus:ring-red-500 dark:bg-red-950/20'
							: 'border-border bg-muted/20 focus:border-primary focus:ring-primary'}"
					></textarea>
					{#if showRejectReasonError}
						<p class="text-2xs font-bold text-red-600 dark:text-red-400">
							กรุณาระบุเหตุผลก่อนปฏิเสธคำขอ
						</p>
					{/if}
				</div>
			</div>
			<!-- Modal Footer -->
			<div
				class="flex flex-col items-stretch justify-between gap-3 rounded-b-3xl border-t border-border/60 bg-muted/10 p-4 sm:flex-row sm:items-center md:px-6"
			>
				<button
					onclick={() => request.booking_ref && onApprove(request.booking_ref, memo.trim())}
					disabled={saving}
					class="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 py-2.5 text-xs font-bold text-white transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none"
				>
					<Check class="h-4 w-4" />
					อนุมัติเข้าสู่การตรวจรับ
				</button>
				<div class="flex w-full items-center justify-end gap-2 sm:w-auto">
					<button
						onclick={handleReject}
						disabled={saving}
						class="inline-flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-red-200 px-4 py-2.5 text-xs font-bold text-red-600 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-60 sm:flex-none dark:hover:bg-red-950/20"
					>
						<AlertCircle class="h-4 w-4" />
						ปฏิเสธคำขอ
					</button>
					<button
						onclick={onclose}
						class="inline-flex flex-1 cursor-pointer items-center justify-center rounded-xl bg-muted px-4 py-2.5 text-xs font-bold text-foreground transition-colors hover:bg-muted/80 sm:flex-none"
					>
						ปิด
					</button>
				</div>
			</div>
		</div>
	</div>
{/if}
