<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import X from '@lucide/svelte/icons/x';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import type { MealPeriod } from '../../domain/food-supplies';
	import { getMealPeriodLabel } from '../model/ticket-status';

	interface Props {
		open: boolean;
		meal: MealPeriod;
		recipientLabel: string;
		priorDistributedAt?: string;
		onconfirm: (reason: string) => void;
		oncancel: () => void;
	}

	let {
		open = false,
		meal,
		recipientLabel,
		priorDistributedAt,
		onconfirm,
		oncancel
	}: Props = $props();

	let isConfirmed = $state(false);
	let overrideReason = $state('');
	let error = $state<string | null>(null);

	function handleConfirm() {
		const trimmed = overrideReason.trim();
		if (!isConfirmed) {
			error = 'กรุณากดยืนยันการแจกซ้ำเป็นกรณีพิเศษ';
			return;
		}
		if (trimmed.length < 3) {
			error = 'กรุณาระบุเหตุผลในการแจกซ้ำอย่างน้อย 3 ตัวอักษร';
			return;
		}

		error = null;
		onconfirm(trimmed);
	}

	function handleCancel() {
		error = null;
		isConfirmed = false;
		overrideReason = '';
		oncancel();
	}
</script>

<AlertDialog.Root
	{open}
	onOpenChange={(next) => {
		// Parent owns `open` (not bindable here) — any bits-ui-initiated close (Cancel,
		// which is the only default-close affordance since outside-click is ignored by
		// AlertDialog by default and Escape is explicitly blocked below) routes back
		// through the same cancel path the original hand-rolled modal used.
		if (!next) handleCancel();
	}}
>
	<AlertDialog.Content
		class="border border-amber-200 sm:max-w-md"
		onEscapeKeydown={(e) => e.preventDefault()}
	>
		<AlertDialog.Header>
			<div class="flex items-start justify-between gap-3">
				<div class="flex items-center gap-3">
					<div
						class="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600 shadow-2xs"
					>
						<AlertTriangle class="h-5 w-5" />
					</div>
					<div>
						<AlertDialog.Title class="text-base font-bold text-slate-900">
							แจ้งเตือน: ได้รับอาหารมื้อนี้แล้ว
						</AlertDialog.Title>
						<AlertDialog.Description class="text-xs text-slate-500">
							ตรวจสอบสิทธิ์การรับอาหาร
						</AlertDialog.Description>
					</div>
				</div>

				<!-- Header close affordance — AlertDialog.Cancel is already a native close
					 button, so its default click routes through the same onOpenChange →
					 handleCancel() path as the footer Cancel. No onclick added here. -->
				<AlertDialog.Cancel
					class="h-auto shrink-0 rounded-full border-0 bg-transparent p-1 text-slate-400 shadow-none hover:bg-slate-100 hover:text-slate-600"
					aria-label="ปิด"
					title="ปิด"
				>
					<X class="h-4 w-4" />
				</AlertDialog.Cancel>
			</div>
		</AlertDialog.Header>

		<!-- Warning Body -->
		<div class="space-y-3">
			<div class="rounded-xl border border-amber-200/80 bg-amber-50/60 p-3 text-xs text-amber-950">
				<p>
					ผู้ประสบภัย <strong>{recipientLabel}</strong> ได้รับอาหารมื้อ
					<strong class="text-amber-800">{getMealPeriodLabel(meal)}</strong> ในรอบวันแล้ว
				</p>
				{#if priorDistributedAt}
					<p class="mt-1 text-2xs text-amber-700">
						(เวลาที่รับล่าสุด: {new Date(priorDistributedAt).toLocaleTimeString('th-TH', {
							hour: '2-digit',
							minute: '2-digit'
						})} น.)
					</p>
				{/if}
			</div>

			<p class="text-xs text-slate-600">
				ระบบควบคุมการแจกอาหารจำกัด 1 มื้อ ต่อ 1 คน ในรอบวัน หากต้องการแจกซ้ำเป็นกรณีพิเศษ
				ต้องระบุเหตุผลประกอบ
			</p>

			<!-- Confirmation & Reason Form -->
			<div class="space-y-3 pt-2">
				<label class="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-800">
					<Checkbox bind:checked={isConfirmed} />
					<span>ยืนยันแจกซ้ำเป็นกรณีพิเศษ</span>
				</label>

				<div>
					<label
						for="override-reason-input"
						class="mb-1 block text-2xs font-bold text-slate-700 uppercase"
					>
						เหตุผลในการแจกซ้ำ <span class="text-red-500">*</span>
					</label>
					<Textarea
						id="override-reason-input"
						bind:value={overrideReason}
						rows={2}
						placeholder="เช่น มาขอรับแทนสมาชิกในครอบครัวที่ป่วยติดเตียง, อาหารเดิมหกเสียหาย..."
						class="w-full text-xs shadow-2xs placeholder:text-slate-400"
					/>
				</div>

				{#if error}
					<p class="text-2xs font-semibold text-red-600">{error}</p>
				{/if}
			</div>
		</div>

		<AlertDialog.Footer>
			<AlertDialog.Cancel class="text-xs font-semibold">ยกเลิก</AlertDialog.Cancel>
			<AlertDialog.Action
				class="border border-amber-600 bg-amber-600 text-xs font-semibold text-white hover:bg-amber-700"
				onclick={(e) => {
					// Never let Action's default auto-close fire before validation runs —
					// the dialog must stay open on a validation error, exactly as before.
					e.preventDefault();
					handleConfirm();
				}}
			>
				บันทึกแจกซ้ำแบบมีเหตุผล
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
