<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import X from '@lucide/svelte/icons/x';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import type { MealPeriod } from '../../domain/food-supplies';

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

	const mealLabels: Record<MealPeriod, string> = {
		breakfast: 'เช้า',
		lunch: 'กลางวัน',
		dinner: 'เย็น',
		snack: 'อาหารว่าง'
	};

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

{#if open}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4 backdrop-blur-xs"
		role="dialog"
		aria-modal="true"
		aria-labelledby="meal-warning-title"
	>
		<div
			class="flex max-h-[90vh] w-full max-w-md flex-col overflow-y-auto rounded-2xl border border-amber-200 bg-white p-6 shadow-xl transition-all"
		>
			<!-- Dialog Header -->
			<div class="flex items-start justify-between">
				<div class="flex items-center gap-3">
					<div
						class="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600 shadow-2xs"
					>
						<AlertTriangle class="h-5 w-5" />
					</div>
					<div>
						<h2 id="meal-warning-title" class="text-base font-bold text-slate-900">
							แจ้งเตือน: ได้รับอาหารมื้อนี้แล้ว
						</h2>
						<p class="text-xs text-slate-500">ตรวจสอบสิทธิ์การรับอาหาร</p>
					</div>
				</div>

				<button
					type="button"
					onclick={handleCancel}
					class="rounded-full p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
					aria-label="ปิดหน้าต่าง"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<!-- Warning Body -->
			<div class="mt-4 space-y-3">
				<div
					class="rounded-xl border border-amber-200/80 bg-amber-50/60 p-3 text-xs text-amber-950"
				>
					<p>
						ผู้ประสบภัย <strong>{recipientLabel}</strong> ได้รับอาหารมื้อ
						<strong class="text-amber-800">{mealLabels[meal] || meal}</strong> ในรอบวันแล้ว
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
					ต้องระบุเหตุผลในการ Override
				</p>

				<!-- Confirmation & Reason Form -->
				<div class="space-y-3 pt-2">
					<label
						class="flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-800"
					>
						<Checkbox bind:checked={isConfirmed} />
						<span>ยืนยันแจกซ้ำเป็นกรณีพิเศษ (Override)</span>
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

			<!-- Dialog Actions -->
			<div
				class="mt-6 flex flex-wrap items-center justify-end gap-2 border-t border-slate-100 pt-4"
			>
				<button
					type="button"
					onclick={handleCancel}
					class="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-50"
				>
					ยกเลิก
				</button>
				<button
					type="button"
					onclick={handleConfirm}
					class="rounded-xl border border-amber-600 bg-amber-600 px-4 py-2 text-xs font-semibold text-white shadow-2xs hover:bg-amber-700"
				>
					บันทึกแจกซ้ำแบบมีเหตุผล
				</button>
			</div>
		</div>
	</div>
{/if}
