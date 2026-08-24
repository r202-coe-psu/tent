<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import type { PendingDonationRow } from '$lib/features/donations';

	let {
		open = false,
		request,
		saving = false,
		onclose,
		onConfirm
	}: {
		open: boolean;
		request: PendingDonationRow | null;
		saving?: boolean;
		onclose: () => void;
		onConfirm: (bookingRef: string, reason: string) => void;
	} = $props();

	let reason = $state('');
	let error = $state('');

	$effect(() => {
		if (open) {
			reason = '';
			error = '';
		}
	});

	function handleSubmit() {
		if (!request?.booking_ref) return;
		if (!reason.trim()) {
			error = 'กรุณาระบุเหตุผลในการปฏิเสธคำขอ';
			return;
		}
		if (reason.trim().length > 500) {
			error = 'เหตุผลมีความยาวเกิน 500 ตัวอักษร';
			return;
		}
		onConfirm(request.booking_ref, reason.trim());
	}
</script>

{#if open && request}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex animate-in items-center justify-center bg-black/50 p-4 backdrop-blur-xs duration-150 fade-in"
		onclick={onclose}
	>
		<div
			class="relative flex w-full max-w-lg animate-in flex-col rounded-2xl border border-border bg-card text-foreground shadow-2xl duration-200 zoom-in-95"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="flex items-center justify-between border-b border-border p-5">
				<div class="flex items-center gap-2">
					<div class="flex h-9 w-9 items-center justify-center rounded-xl bg-red-100 text-red-600 dark:bg-red-950/50 dark:text-red-400">
						<AlertCircle class="h-5 w-5" />
					</div>
					<div>
						<h3 class="text-base font-bold text-foreground">ปฏิเสธคำขอรับบริจาค</h3>
						<p class="text-xs text-muted-foreground">รหัสอ้างอิง: {request.booking_ref}</p>
					</div>
				</div>
				<button
					type="button"
					onclick={onclose}
					class="cursor-pointer rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<X class="h-5 w-5" />
				</button>
			</div>

			<div class="space-y-4 p-5">
				<p class="text-xs text-muted-foreground">
					คุณต้องการปฏิเสธคำขอรับบริจาคจาก <strong class="text-foreground">{request.donor_name || 'ผู้บริจาค'}</strong> หรือไม่? กรุณาระบุเหตุผลเพื่อบันทึกในประวัติการตรวจสอบ
				</p>

				<div class="space-y-1.5">
					<label for="reject-reason-input" class="text-xs font-bold text-foreground">
						เหตุผลในการปฏิเสธ <span class="text-red-500">*</span>
					</label>
					<textarea
						id="reject-reason-input"
						rows="3"
						placeholder="เช่น สิ่งของไม่ตรงกับเกณฑ์รับบริจาค, เกินขีดความสามารถในการจัดเก็บ..."
						bind:value={reason}
						oninput={() => (error = '')}
						class="w-full rounded-xl border p-3 text-xs text-foreground outline-hidden focus:ring-1 {error
							? 'border-red-500 bg-red-50/50 focus:border-red-500 focus:ring-red-500 dark:bg-red-950/20'
							: 'border-border bg-muted/20 focus:border-primary focus:ring-primary'}"
					></textarea>
					{#if error}
						<p class="text-xs font-bold text-red-600 dark:text-red-400">{error}</p>
					{/if}
				</div>
			</div>

			<div class="flex items-center justify-end gap-2 border-t border-border bg-muted/10 p-4">
				<button
					type="button"
					onclick={onclose}
					disabled={saving}
					class="cursor-pointer rounded-xl bg-muted px-4 py-2 text-xs font-bold text-foreground transition-colors hover:bg-muted/80 disabled:opacity-50"
				>
					ยกเลิก
				</button>
				<button
					type="button"
					onclick={handleSubmit}
					disabled={saving}
					class="cursor-pointer rounded-xl bg-red-600 px-4 py-2 text-xs font-bold text-white transition-colors hover:bg-red-700 disabled:opacity-50"
				>
					{saving ? 'กำลังบันทึก...' : 'ยืนยันปฏิเสธคำขอ'}
				</button>
			</div>
		</div>
	</div>
{/if}
