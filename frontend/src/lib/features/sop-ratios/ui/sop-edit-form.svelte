<script lang="ts">
	import {
		isSopMaster,
		type SopMaster,
		type SopOverride,
		SOP_RATIO_KEYS,
		type SopRatioKey,
		RATIO_LABELS,
		sopProfileFormSchema,
		useCreateInitialMaster,
		useCreateMasterVersion,
		useCreateOverrideVersion
	} from '$lib/features/sop-ratios';
	import { authStore } from '$lib/stores/auth.svelte';
	import Save from '@lucide/svelte/icons/save';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { untrack } from 'svelte';

	interface Props {
		profile?: SopMaster | SopOverride;
		mode?: 'create' | 'edit';
		onClose: () => void;
	}

	const { profile = undefined, mode = 'edit', onClose }: Props = $props();

	const isCreating = $derived(mode === 'create');
	const isMaster = $derived(isCreating || (profile != null && isSopMaster(profile)));

	const initialMasterMutation = useCreateInitialMaster();
	const masterMutation = useCreateMasterVersion();
	const overrideMutation = useCreateOverrideVersion(() =>
		isMaster || !profile ? '' : (profile as SopOverride).shelter_code
	);

	// Superforms owns all editable values and exposes Zod field errors.
	const getInitial = () =>
		profile ? { ...profile.ratios } : Object.fromEntries(SOP_RATIO_KEYS.map((key) => [key, '1']));
	const initial = untrack(() => ({
		name: profile?.name ?? '',
		ratios: getInitial() as Record<SopRatioKey, string>,
		reason: ''
	}));
	const form = superForm(defaults(initial, zod4(sopProfileFormSchema)), {
		SPA: true,
		id: untrack(() => (profile ? `sop-edit-${profile._id}` : 'sop-create-master')),
		dataType: 'json',
		validators: zod4(sopProfileFormSchema),
		resetForm: false,
		onUpdate: async ({ form: validated }) => {
			if (!validated.valid) {
				toast.error('กรุณาตรวจสอบข้อมูลที่กรอกให้ถูกต้อง');
				return;
			}
			if (!isCreating && !validated.data.reason?.trim()) {
				toast.error('กรุณาระบุเหตุผลในการแก้ไข');
				return;
			}
			await saveValidated(validated.data);
		}
	});
	const { form: formData, errors: formErrors, submitting } = form;

	const isSaving = $derived(
		$submitting ||
			initialMasterMutation.isPending ||
			masterMutation.isPending ||
			overrideMutation.isPending
	);

	const hasAnyChange = $derived(
		SOP_RATIO_KEYS.some((key) => {
			const currentVal = $formData.ratios[key];
			const initialVal = profile?.ratios[key];
			return currentVal !== undefined && Number(currentVal) !== Number(initialVal);
		})
	);

	async function saveValidated(data: {
		name: string;
		ratios: Record<SopRatioKey, string>;
		reason?: string;
	}) {
		try {
			const changes: Partial<Record<SopRatioKey, string>> = {};
			for (const key of SOP_RATIO_KEYS) {
				const currentVal = data.ratios[key];
				const initialVal = profile?.ratios[key];
				if (currentVal !== undefined && Number(currentVal) !== Number(initialVal)) {
					changes[key] = String(currentVal);
				}
			}

			if (isCreating) {
				await initialMasterMutation.mutateAsync({
					name: data.name.trim(),
					ratios: data.ratios,
					createdBy: authStore.user?.name ?? 'unknown'
				});
			} else if (isMaster && profile) {
				await masterMutation.mutateAsync({
					prev: profile as SopMaster,
					changes,
					reason: data.reason?.trim() ?? '',
					createdBy: authStore.user?.name ?? 'unknown'
				});
			} else if (profile) {
				const override = profile as SopOverride;
				await overrideMutation.mutateAsync({
					prev: override,
					changes,
					reason: data.reason?.trim() ?? '',
					ctx: {
						shelterCode: override.shelter_code,
						createdBy: authStore.user?.name ?? 'unknown'
					}
				});
			}
			onClose();
		} catch {
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
		<form method="POST" use:form.enhance class="contents">
			<!-- Header -->
			<Dialog.Header class="border-b border-black/[0.06] px-6 py-5">
				<div>
					<p class="text-2xs font-black tracking-wider text-brand uppercase">
						{isCreating ? 'สร้าง' : 'แก้ไข'}
						{isMaster ? 'Master' : 'Override'} SOP Profile
					</p>
					<Dialog.Title class="mt-0.5 text-xl font-bold text-slate-900">
						{isCreating ? 'Master SOP Profile ใหม่' : profile?.name}
					</Dialog.Title>
				</div></Dialog.Header
			>

			<!-- Form Body -->
			<div class="flex-1 space-y-4 overflow-y-auto px-6 pt-5 pb-10">
				{#if isCreating}
					<div>
						<label for="profile-name" class="mb-1.5 block text-xs font-bold text-slate-700">
							ชื่อ Master Profile <span class="text-red-500">*</span>
						</label>
						<input
							id="profile-name"
							bind:value={$formData.name}
							maxlength="100"
							class="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm"
						/>
					</div>
				{/if}
				{#each SOP_RATIO_KEYS as key (key)}
					{@const meta = RATIO_LABELS[key]}
					<div class="rounded-2xl border border-black/[0.06] bg-slate-50/60 p-4">
						<div class="mb-2 flex items-center justify-between">
							<div>
								<p class="text-sm font-bold text-slate-800">{meta?.label ?? key}</p>
								<p class="text-2xs text-slate-500">{meta?.description ?? ''}</p>
							</div>
							<span
								class="rounded-full border border-black/[0.06] bg-white px-2.5 py-1 text-2xs font-bold text-slate-500 shadow-sm"
							>
								{meta?.unit}
							</span>
						</div>
						<label for={`ratio-input-${key}`} class="sr-only">{meta?.label ?? key}</label>
						<input
							id={`ratio-input-${key}`}
							type="number"
							step="any"
							min="0.001"
							value={$formData.ratios[key]}
							oninput={(e) => {
								const val = e.currentTarget.value;
								$formData.ratios[key] = val;
							}}
							class={[
								'w-full rounded-xl border bg-white px-4 py-2.5 font-mono text-sm font-semibold transition-colors outline-none',
								$formErrors.ratios?.[key]
									? 'border-red-500 text-red-600 focus:border-red-600 focus:ring-2 focus:ring-red-600/15'
									: 'border-black/10 text-brand focus:border-brand focus:ring-2 focus:ring-brand/15'
							]}
						/>
						{#if $formErrors.ratios?.[key]}
							<p class="mt-1.5 text-xs font-medium text-red-500">
								{$formErrors.ratios[key]}
							</p>
						{/if}
					</div>
				{/each}

				<!-- Reason field -->
				{#if !isCreating}<div>
						<label for="reason-input" class="mb-1.5 block text-xs font-bold text-slate-700">
							เหตุผลในการแก้ไข <span class="text-red-500">*</span>
						</label>
						<textarea
							id="reason-input"
							bind:value={$formData.reason}
							placeholder="เช่น ปรับตามมติ EOC ประชุมวันที่ 4 ก.ค. 2568"
							rows={2}
							class="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-sm text-slate-700 transition-colors outline-none placeholder:text-slate-400 focus:border-brand focus:ring-2 focus:ring-brand/15"
						></textarea>
						{#if !hasAnyChange}
							<p class="mt-1 text-xs font-medium text-amber-600">
								⚠️ ยังไม่มีข้อมูลพารามิเตอร์ใดเปลี่ยนแปลง
							</p>
						{/if}
					</div>{/if}
			</div>

			<Dialog.Footer
				class="mx-0 mb-0 flex items-center justify-end gap-3 border-t border-black/[0.06] px-6 py-4"
			>
				<button
					type="button"
					onclick={onClose}
					class="rounded-xl px-4 py-2 text-sm font-bold text-slate-600 transition-colors hover:bg-slate-100"
				>
					ยกเลิก
				</button>
				<button
					type="submit"
					disabled={isSaving ||
						(isCreating ? !$formData.name.trim() : !$formData.reason?.trim() || !hasAnyChange)}
					class="inline-flex items-center gap-2 rounded-xl bg-brand px-5 py-2 text-sm font-bold text-white shadow-sm transition-colors hover:bg-brand-hover disabled:cursor-not-allowed disabled:opacity-50"
				>
					<Save size={15} />
					{isSaving ? 'กำลังบันทึก...' : isCreating ? 'สร้าง Profile' : 'บันทึกเวอร์ชันใหม่'}
				</button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
