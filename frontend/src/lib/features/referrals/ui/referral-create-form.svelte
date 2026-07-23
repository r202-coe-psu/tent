<script lang="ts">
	import * as Card from '$lib/components/ui/card/index.js';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';

	import { type Referral, type ReferralInput } from '../domain/referral.schema';
	import { useCreateReferral } from '../application/queries';
	import RedactionBanner from './redaction-banner.svelte';
	import EvacueeSearchInput from './evacuee-search-input.svelte';
	import MedicalReferralForm from './medical-referral-form.svelte';
	import CapacityReferralForm from './capacity-referral-form.svelte';
	import ResourceReferralForm from './resource-referral-form.svelte';

	let {
		onCreated,
		onSuccess
	}: {
		onCreated?: (referralId: string) => void;
		onSuccess?: (doc: Referral) => void;
	} = $props();

	const queryClient = useQueryClient();
	const createMutation = useCreateReferral(queryClient);

	let evacuee_id = $state('');
	let selectedType = $state<'medical-emergency' | 'capacity' | 'resource'>('medical-emergency');
	let evacueeError = $state<string | undefined>(undefined);

	$effect(() => {
		if (evacuee_id) {
			evacueeError = undefined;
		}
	});

	async function handleSubmit(formData: ReferralInput) {
		if (!evacuee_id) {
			evacueeError = 'กรุณาเลือกผู้ประสบภัย';
			toast.error('กรุณาเลือกผู้ประสบภัย');
			return;
		}

		await toast.promise(createMutation.mutateAsync(formData), {
			loading: 'กำลังบันทึกรายการส่งต่อ...',
			success: (doc) => {
				onCreated?.(doc._id);
				onSuccess?.(doc);
				return 'สร้างรายการส่งต่อผู้ประสบภัยเรียบร้อยแล้ว';
			},
			error: (err) => (err instanceof Error ? err.message : 'เกิดข้อผิดพลาดในการบันทึก')
		});
	}
</script>

<div class="space-y-6">
	<!-- Warning Banner when Hospital destination is chosen -->
	{#if selectedType === 'medical-emergency'}
		<RedactionBanner />
	{/if}

	<Card.Root class="overflow-hidden border border-border/80 shadow-md">
		<Card.Header class="bg-muted/40 pb-4">
			<Card.Title class="text-xl font-bold"
				>สร้างรายการส่งต่อผู้ประสบภัย (New Referral Request)</Card.Title
			>
			<Card.Description
				>เลือกประเภทการส่งต่อและกรอกข้อมูลปลายทางให้ครบถ้วนก่อนส่งให้เจ้าหน้าที่</Card.Description
			>
		</Card.Header>
		<Card.Content class="space-y-6 p-6">
			<!-- Step 1: Select Referral Type -->
			<div class="space-y-3">
				<span class="text-sm font-semibold text-foreground"
					>1. เลือกประเภทการส่งต่อ (Referral Type) *</span
				>
				<div class="grid grid-cols-1 gap-3 md:grid-cols-3">
					<button
						type="button"
						onclick={() => (selectedType = 'medical-emergency')}
						class="flex cursor-pointer flex-col justify-between rounded-xl border-2 p-4 text-left shadow-xs transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]
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
						class="flex cursor-pointer flex-col justify-between rounded-xl border-2 p-4 text-left shadow-xs transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]
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
								โอนย้ายผู้ประสบภัยไปยังศูนย์พักพิงอื่นเนื่องจากศูนย์เดิมเต็ม
							</p>
						</div>
					</button>

					<button
						type="button"
						onclick={() => (selectedType = 'resource')}
						class="flex cursor-pointer flex-col justify-between rounded-xl border-2 p-4 text-left shadow-xs transition-all duration-200 hover:scale-[1.02] hover:shadow-md active:scale-[0.98]
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

			<!-- Step 2: Evacuee Selection (Shared Sub-component) -->
			<EvacueeSearchInput bind:value={evacuee_id} error={evacueeError} />

			<hr class="border-border/60" />

			<!-- Step 3 & 4: Type-Specific Form Component -->
			{#key selectedType}
				{#if selectedType === 'medical-emergency'}
					<MedicalReferralForm
						evacueeId={evacuee_id}
						onSubmit={handleSubmit}
						submitting={createMutation.isPending}
					/>
				{:else if selectedType === 'capacity'}
					<CapacityReferralForm
						evacueeId={evacuee_id}
						onSubmit={handleSubmit}
						submitting={createMutation.isPending}
					/>
				{:else if selectedType === 'resource'}
					<ResourceReferralForm
						evacueeId={evacuee_id}
						onSubmit={handleSubmit}
						submitting={createMutation.isPending}
					/>
				{/if}
			{/key}
		</Card.Content>
	</Card.Root>
</div>
