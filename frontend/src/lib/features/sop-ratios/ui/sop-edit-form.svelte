<script lang="ts">
	import {
		isSopMaster,
		type SopMaster,
		type SopOverride,
		SOP_RATIO_KEYS,
		type SopRatioKey,
		RATIO_LABELS,
		useCreateMasterVersion,
		useCreateOverrideVersion
	} from '$lib/features/sop-ratios';
	import { authStore } from '$lib/stores/auth.svelte';
	import Save from '@lucide/svelte/icons/save';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog';

	interface Props {
		profile: SopMaster | SopOverride;
		onClose: () => void;
	}

	const { profile, onClose }: Props = $props();

	const isMaster = $derived(isSopMaster(profile));

	const masterMutation = useCreateMasterVersion();
	const overrideMutation = useCreateOverrideVersion(() =>
		isMaster ? '' : (profile as SopOverride).shelter_code
	);

	// Local editable copy of ratios
	const getInitial = () => ({ ...profile.ratios });
	let ratios = $state<Partial<Record<SopRatioKey, number>>>(getInitial());
	let reason = $state('');

	const isSaving = $derived(masterMutation.isPending || overrideMutation.isPending);

	const hasAnyChange = $derived(
		SOP_RATIO_KEYS.some((key) => {
			const currentVal = ratios[key];
			const initialVal = profile.ratios[key];
			return currentVal !== undefined && Number(currentVal) !== Number(initialVal);
		})
	);

	async function handleSave() {
		if (!reason.trim()) return;

		try {
			const changes: Partial<Record<SopRatioKey, number>> = {};
			for (const key of SOP_RATIO_KEYS) {
				const currentVal = ratios[key];
				const initialVal = profile.ratios[key];
				if (currentVal !== undefined && Number(currentVal) !== Number(initialVal)) {
					changes[key] = Number(currentVal);
				}
			}

			if (isMaster) {
				await masterMutation.mutateAsync({
					prev: profile as SopMaster,
					changes,
					reason: reason.trim(),
					createdBy: authStore.user?.name ?? 'unknown'
				});
			} else {
				const override = profile as SopOverride;
				await overrideMutation.mutateAsync({
					prev: override,
					changes,
					reason: reason.trim(),
					ctx: {
						shelterCode: override.shelter_code,
						createdBy: authStore.user?.name ?? 'unknown'
					}
				});
			}
			onClose();
		} catch (err) {
			console.error('Failed to save bulk SOP parameters:', err);
			toast.error('ไม่สามารถบันทึกพารามิเตอร์ได้ — กรุณาลองใหม่อีกครั้ง');
		}
	}
</script>

<Dialog.Root
	open={true}
	onOpenChange={(open) => {
		if (!open) onClose();
	}}
>
	<Dialog.Content
		class="flex max-h-[90vh] w-full max-w-lg flex-col gap-0 overflow-hidden rounded-3xl border-none p-0"
	>
		<!-- Header -->
		<Dialog.Header class="border-b border-black/[0.06] px-6 py-5">
			<div>
				<p class="text-[11px] font-black tracking-wider text-brand uppercase">
					แก้ไข {isMaster ? 'Master' : 'Override'} SOP Profile
				</p>
				<Dialog.Title class="mt-0.5 text-xl font-bold text-slate-900">
					{profile.name}
				</Dialog.Title>
				<Dialog.Description class="mt-0.5 font-mono text-[12px] text-slate-400">
					v{profile.version} → v{profile.version + 1}
				</Dialog.Description>
			</div>
		</Dialog.Header>

		<!-- Form Body -->
		<div class="flex-1 space-y-4 overflow-y-auto px-6 pt-5 pb-10">
			{#each SOP_RATIO_KEYS as key (key)}
				{@const meta = RATIO_LABELS[key]}
				<div class="rounded-2xl border border-black/[0.06] bg-slate-50/60 p-4">
					<div class="mb-2 flex items-center justify-between">
						<div>
							<p class="text-[14px] font-bold text-slate-800">{meta?.label ?? key}</p>
							<p class="text-[11px] text-slate-500">{meta?.description ?? ''}</p>
						</div>
						<span
							class="rounded-full border border-black/[0.06] bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500 shadow-sm"
						>
							{meta?.unit}
						</span>
					</div>
					<label for={`ratio-input-${key}`} class="sr-only">{meta?.label ?? key}</label>
					<input
						id={`ratio-input-${key}`}
						type="number"
						step="0.001"
						min="0.001"
						bind:value={ratios[key]}
						class="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 font-mono text-[15px] font-semibold text-brand transition-colors outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
					/>
				</div>
			{/each}

			<!-- Reason field -->
			<div>
				<label for="reason-input" class="mb-1.5 block text-[13px] font-bold text-slate-700">
					เหตุผลในการแก้ไข <span class="text-red-500">*</span>
				</label>
				<textarea
					id="reason-input"
					bind:value={reason}
					placeholder="เช่น ปรับตามมติ EOC ประชุมวันที่ 4 ก.ค. 2568"
					rows={2}
					class="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-[14px] text-slate-700 transition-colors outline-none placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/15"
				></textarea>
				{#if !hasAnyChange}
					<p class="mt-1 text-[12px] font-medium text-amber-600">
						⚠️ ยังไม่มีข้อมูลพารามิเตอร์ใดเปลี่ยนแปลง
					</p>
				{/if}
			</div>
		</div>

		<Dialog.Footer
			class="mx-0 mb-0 flex items-center justify-end gap-3 border-t border-black/[0.06] px-6 py-4"
		>
			<button
				onclick={onClose}
				class="rounded-xl px-4 py-2 text-[14px] font-bold text-slate-600 transition-colors hover:bg-slate-100"
			>
				ยกเลิก
			</button>
			<button
				onclick={handleSave}
				disabled={isSaving || !reason.trim() || !hasAnyChange}
				class="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2 text-[14px] font-bold text-white shadow-sm transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
			>
				<Save size={15} />
				{isSaving ? 'กำลังบันทึก...' : 'บันทึกเวอร์ชันใหม่'}
			</button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
