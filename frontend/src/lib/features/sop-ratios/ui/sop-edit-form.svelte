<script lang="ts">
	import {
		isSopMaster,
		type SopMaster,
		type SopOverride,
		SOP_RATIO_KEYS,
		type SopRatioKey,
		RATIO_LABELS,
		useCreateMasterVersion,
		useCreateOverrideVersion,
		useCreateInitialOverride
	} from '$lib/features/sop-ratios';
	import { authStore } from '$lib/stores/auth.svelte';
	import X from '@lucide/svelte/icons/x';
	import Save from '@lucide/svelte/icons/save';

	interface Props {
		mode?: 'edit' | 'create_override';
		profile?: SopMaster | SopOverride;
		baseMasterProfile?: SopMaster;
		shelterCode?: string;
		onClose: () => void;
	}

	const { mode = 'edit', profile, baseMasterProfile, shelterCode = '', onClose }: Props = $props();

	const isMaster = $derived(profile ? isSopMaster(profile) : false);

	const masterMutation = useCreateMasterVersion();
	const overrideMutation = useCreateOverrideVersion(() =>
		isMaster ? '' : (profile as SopOverride)?.shelter_code
	);
	const initialOverrideMutation = useCreateInitialOverride(() => shelterCode);

	// Local editable copy of ratios
	// svelte-ignore state_referenced_locally
	const initialRatios =
		mode === 'edit' && profile ? profile.ratios : (baseMasterProfile?.ratios ?? {});
	let ratios = $state<Partial<Record<SopRatioKey, number>>>({ ...initialRatios });
	// svelte-ignore state_referenced_locally
	let reason = $state(mode === 'create_override' ? 'สร้างค่าปรับแต่งเฉพาะศูนย์ครั้งแรก' : '');

	const isSaving = $derived(
		masterMutation.isPending || overrideMutation.isPending || initialOverrideMutation.isPending
	);

	async function handleSave() {
		if (!reason.trim()) return;

		if (mode === 'create_override' && baseMasterProfile && shelterCode) {
			await initialOverrideMutation.mutateAsync({
				name: baseMasterProfile.name,
				ratios: ratios as Record<string, number>,
				ctx: {
					shelterCode,
					createdBy: authStore.user?.name ?? 'unknown',
					base_profile_id: baseMasterProfile._id
				}
			});
		} else if (mode === 'edit' && profile) {
			if (isMaster) {
				await masterMutation.mutateAsync({
					prev: profile as SopMaster,
					changes: ratios,
					reason: reason.trim(),
					createdBy: authStore.user?.name ?? 'unknown'
				});
			} else {
				const override = profile as SopOverride;
				await overrideMutation.mutateAsync({
					prev: override,
					changes: ratios,
					reason: reason.trim(),
					ctx: {
						shelterCode: override.shelter_code,
						createdBy: authStore.user?.name ?? 'unknown'
					}
				});
			}
		}
		onClose();
	}
</script>

<!-- Backdrop -->
<div
	class="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
	role="presentation"
	onclick={onClose}
></div>

<!-- Modal -->
<div class="fixed inset-0 z-50 flex items-center justify-center p-4">
	<div
		class="flex max-h-[90vh] w-full max-w-lg flex-col overflow-hidden rounded-3xl bg-white shadow-2xl"
	>
		<!-- Header -->
		<div class="flex items-start justify-between border-b border-black/[0.06] px-6 py-5">
			<div>
				<p class="text-[11px] font-black tracking-wider text-[#013365] uppercase">
					{#if mode === 'create_override'}
						สร้างค่าปรับแต่งเฉพาะศูนย์
					{:else}
						แก้ไข {isMaster ? 'Master' : 'Override'} SOP Profile
					{/if}
				</p>
				<h3 class="mt-0.5 text-xl font-bold text-slate-900">
					{mode === 'create_override' ? baseMasterProfile?.name : profile?.name}
				</h3>
				{#if mode === 'edit' && profile}
					<p class="mt-0.5 font-mono text-[12px] text-slate-400">
						v{profile.version} → v{profile.version + 1}
					</p>
				{:else}
					<p class="mt-0.5 font-mono text-[12px] text-slate-400">New Version 1</p>
				{/if}
			</div>
			<button
				onclick={onClose}
				class="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
			>
				<X size={18} />
			</button>
		</div>

		<!-- Form Body -->
		<div class="flex-1 space-y-4 overflow-y-auto px-6 py-5">
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
					<input
						type="number"
						step="0.001"
						min="0.001"
						bind:value={ratios[key]}
						class="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 font-mono text-[15px] font-semibold text-[#013365] transition-colors outline-none focus:border-[#013365] focus:ring-2 focus:ring-[#013365]/15"
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
					class="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-[14px] text-slate-700 transition-colors outline-none placeholder:text-slate-400 focus:border-[#013365] focus:ring-2 focus:ring-[#013365]/15"
				></textarea>
			</div>
		</div>

		<!-- Footer -->
		<div class="flex items-center justify-end gap-3 border-t border-black/[0.06] px-6 py-4">
			<button
				onclick={onClose}
				class="rounded-xl px-4 py-2 text-[14px] font-bold text-slate-600 transition-colors hover:bg-slate-100"
			>
				ยกเลิก
			</button>
			<button
				onclick={handleSave}
				disabled={isSaving || !reason.trim()}
				class="inline-flex items-center gap-2 rounded-xl bg-[#013365] px-5 py-2 text-[14px] font-bold text-white shadow-sm transition-colors hover:bg-[#002244] disabled:cursor-not-allowed disabled:opacity-50"
			>
				<Save size={15} />
				{isSaving ? 'กำลังบันทึก...' : 'บันทึกเวอร์ชันใหม่'}
			</button>
		</div>
	</div>
</div>
