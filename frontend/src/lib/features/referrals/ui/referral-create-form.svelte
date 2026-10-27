<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';

	import { type Referral, type ReferralInput } from '../domain/referral.schema';
	import type { ReferralBatchFailure, ReferralSubmitIntent } from '../data/referral.repository';
	import { useCreateReferralBatch } from '../application/queries';
	import { useEvacuees } from '$lib/features/people';
	import { formatEvacueeFullName, getEvacueeSelectionError } from './referral.ui-helpers';
	import RedactionBanner from './redaction-banner.svelte';
	import EvacueePickerTable from './evacuee-picker-table.svelte';
	import MedicalReferralForm from './medical-referral-form.svelte';
	import CapacityReferralForm from './capacity-referral-form.svelte';
	import ResourceReferralForm from './resource-referral-form.svelte';
	import ReferralConfirmDialog from './referral-confirm-dialog.svelte';

	let {
		onBatchDone
	}: {
		onBatchDone?: (result: { created: Referral[]; failed: ReferralBatchFailure[] }) => void;
	} = $props();

	const queryClient = useQueryClient();
	const batchMutation = useCreateReferralBatch(queryClient);
	const evacueesQuery = useEvacuees();

	type PendingSend = {
		formData: ReferralInput;
		intent: ReferralSubmitIntent;
		evacueeIds: string[];
	};
	/** Set when a "ส่งข้อมูล" submit awaits confirmation; kept after close so the dialog stays mounted. */
	let pendingSend = $state.raw<PendingSend | null>(null);
	let sendConfirmOpen = $state(false);
	// Resolved at render time so names fill in once the evacuee list has loaded.
	const pendingNames = $derived(pendingSend ? namesFor(pendingSend.evacueeIds) : []);

	let selectedIds = $state<string[]>([]);
	let selectedType = $state<'medical-emergency' | 'capacity' | 'resource'>('medical-emergency');
	let selectionAttempted = $state(false);

	const evacueeError = $derived(
		selectionAttempted ? getEvacueeSelectionError(selectedIds) : undefined
	);

	const formEvacueeId = $derived(selectedIds[0] ?? '');

	// Superforms skips onUpdate → handleSubmit when evacuee_id is empty (schema fails first),
	// so an empty selection never reaches handleSubmit. This runs on every submit attempt
	// (draft or send) in the capture phase, before superforms' listener on the <form>.
	function handleSubmitAttempt() {
		const error = getEvacueeSelectionError(selectedIds);
		if (!error) return;
		selectionAttempted = true;
		toast.error(error);
	}

	function namesFor(ids: string[]): string[] {
		return ids.map((id) => {
			const found = evacueesQuery.data?.find((e) => e._id === id);
			return found ? formatEvacueeFullName(found) : id;
		});
	}

	async function handleSubmit(formData: ReferralInput, intent: ReferralSubmitIntent) {
		const selectionError = getEvacueeSelectionError(selectedIds);
		if (selectionError) {
			selectionAttempted = true;
			toast.error(selectionError);
			return;
		}

		selectionAttempted = false;
		if (intent === 'send') {
			// Sending moves referrals out of draft, so confirm first. Snapshot the selection now.
			const evacueeIds = [...selectedIds];
			pendingSend = { formData, intent, evacueeIds };
			sendConfirmOpen = true;
			return;
		}
		await submitBatch(formData, intent, [...selectedIds]);
	}

	function confirmPendingSend() {
		const request = pendingSend;
		if (!request) return;
		return submitBatch(request.formData, request.intent, request.evacueeIds);
	}

	async function submitBatch(
		formData: ReferralInput,
		intent: ReferralSubmitIntent,
		evacueeIds: string[]
	) {
		const actionLabel = intent === 'send' ? 'สร้างและส่ง' : 'บันทึกร่าง';
		const mutation = batchMutation.mutateAsync({
			template: formData,
			evacueeIds,
			intent
		});

		try {
			void toast.promise(mutation, {
				loading: `กำลัง${actionLabel} ${evacueeIds.length} รายการ...`,
				success: (res) => {
					if (res.failed.length === 0) {
						return intent === 'send'
							? `ส่งข้อมูลสำเร็จ ${res.created.length} รายการ`
							: `บันทึกร่างสำเร็จ ${res.created.length} รายการ`;
					}
					if (res.created.length === 0) {
						return `สร้างไม่สำเร็จทั้ง ${res.failed.length} รายการ`;
					}
					return `สำเร็จบางส่วน: สร้างได้ ${res.created.length} / ล้มเหลว ${res.failed.length}`;
				},
				error: (err) => (err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึก')
			});

			const result = await mutation;
			onBatchDone?.(result);
		} catch {
			// toast.promise already surfaced the error
		}
	}
</script>

<div class="space-y-6">
	{#if selectedType === 'medical-emergency'}
		<RedactionBanner />
	{/if}

	<Card.Root class="border border-border/80 shadow-md">
		<Card.Header class="rounded-t-xl bg-muted/40 pb-4">
			<Card.Title class="text-xl font-bold"
				>สร้างรายการส่งต่อผู้เข้าพัก (New Referral Request)</Card.Title
			>
			<Card.Description
				>เลือกผู้เข้าพักได้หลายคน — ระบบจะสร้าง 1 ใบต่อคนด้วยข้อมูลปลายทางชุดเดียวกัน</Card.Description
			>
		</Card.Header>
		<Card.Content class="space-y-6 p-4 md:p-6">
			<div class="space-y-3">
				<span class="text-sm font-semibold text-foreground"
					>1. เลือกประเภทการส่งต่อ (Referral Type) <span class="text-red-600">*</span></span
				>
				<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
					<button
						type="button"
						onclick={() => (selectedType = 'medical-emergency')}
						class="flex min-h-11 cursor-pointer flex-col justify-between rounded-xl border-2 p-4 text-left shadow-xs transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]
						{selectedType === 'medical-emergency'
							? 'border-red-500 bg-red-50/50 dark:bg-red-950/20'
							: 'border-border/60 hover:border-border'}"
					>
						<div>
							<div class="flex items-center justify-between">
								<span class="font-bold text-red-600 dark:text-red-400">ส่งต่อทางการแพทย์</span>
								<span class="text-xs font-semibold uppercase opacity-60">Medical</span>
							</div>
							<p class="mt-1 text-xs text-muted-foreground">
								ส่งตัวผู้ป่วย/ผู้บาดเจ็บไปยังโรงพยาบาลหรือคลินิก (จำกัดสิทธิ์ข้อมูล FR-48)
							</p>
						</div>
					</button>

					<button
						type="button"
						onclick={() => (selectedType = 'capacity')}
						class="flex min-h-11 cursor-pointer flex-col justify-between rounded-xl border-2 p-4 text-left shadow-xs transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]
						{selectedType === 'capacity'
							? 'border-purple-500 bg-purple-50/50 dark:bg-purple-950/20'
							: 'border-border/60 hover:border-border'}"
					>
						<div>
							<div class="flex items-center justify-between">
								<span class="font-bold text-purple-600 dark:text-purple-400">ย้ายศูนย์พักพิง</span>
								<span class="text-xs font-semibold uppercase opacity-60">Capacity</span>
							</div>
							<p class="mt-1 text-xs text-muted-foreground">
								โอนย้ายผู้เข้าพักไปยังศูนย์พักพิงอื่นเนื่องจากศูนย์เดิมเต็ม
							</p>
						</div>
					</button>

					<button
						type="button"
						onclick={() => (selectedType = 'resource')}
						class="flex min-h-11 cursor-pointer flex-col justify-between rounded-xl border-2 p-4 text-left shadow-xs transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]
						{selectedType === 'resource'
							? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20'
							: 'border-border/60 hover:border-border'}"
					>
						<div>
							<div class="flex items-center justify-between">
								<span class="font-bold text-blue-600 dark:text-blue-400">ขอสนับสนุนทรัพยากร</span>
								<span class="text-xs font-semibold uppercase opacity-60">Resource</span>
							</div>
							<p class="mt-1 text-xs text-muted-foreground">
								ขอสนับสนุนสิ่งของ ยา เครื่องอุปโภคบริโภค จากองค์กรภายนอก
							</p>
						</div>
					</button>
				</div>
			</div>

			<hr class="border-border/60" />

			<EvacueePickerTable bind:selectedIds error={evacueeError} />

			<hr class="border-border/60" />

			<div class="contents" onsubmitcapture={handleSubmitAttempt}>
				{#key selectedType}
					{#if selectedType === 'medical-emergency'}
						<MedicalReferralForm
							evacueeId={formEvacueeId}
							onSubmit={handleSubmit}
							submitting={batchMutation.isPending}
						/>
					{:else if selectedType === 'capacity'}
						<CapacityReferralForm
							evacueeId={formEvacueeId}
							onSubmit={handleSubmit}
							submitting={batchMutation.isPending}
						/>
					{:else if selectedType === 'resource'}
						<ResourceReferralForm
							evacueeId={formEvacueeId}
							onSubmit={handleSubmit}
							submitting={batchMutation.isPending}
						/>
					{/if}
				{/key}
			</div>
		</Card.Content>
	</Card.Root>
	{#if pendingSend}
		<ReferralConfirmDialog
			bind:open={sendConfirmOpen}
			title="ยืนยันการสร้างและส่งข้อมูล"
			names={pendingNames}
			count={pendingSend.evacueeIds.length}
			confirmLabel={`สร้างและส่ง ${pendingSend.evacueeIds.length} รายการ`}
			pending={batchMutation.isPending}
			onConfirm={confirmPendingSend}
		/>
	{/if}
</div>
