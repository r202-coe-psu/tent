<script lang="ts">
	import type { SopMaster } from '$lib/features/sop-ratios';
	import { SOP_RATIO_KEYS, useCreateMasterVersion } from '$lib/features/sop-ratios';
	import { authStore } from '$lib/stores/auth.svelte';
	import X from '@lucide/svelte/icons/x';
	import Save from '@lucide/svelte/icons/save';

	interface Props {
		profile: SopMaster;
		onClose: () => void;
	}

	const { profile, onClose }: Props = $props();

	const mutation = useCreateMasterVersion();

	// Local editable copy of ratios
	let ratios = $state({ ...profile.ratios });
	let reason = $state('');

	const RATIO_LABELS: Record<string, { label: string; unit: string; description: string }> = {
		water_l_per_person_day: {
			label: 'น้ำดื่ม',
			unit: 'ลิตร/คน/วัน',
			description: 'ปริมาณน้ำดื่มมาตรฐานต่อคนต่อวัน (Sphere Standard: 15 L)'
		},
		rice_g_per_person_meal: {
			label: 'ข้าว',
			unit: 'กรัม/คน/มื้อ',
			description: 'ปริมาณข้าวต่อคนต่อมื้อ'
		},
		toilet_per_person: {
			label: 'ห้องน้ำ',
			unit: 'ห้อง/คน',
			description: 'อัตราส่วนห้องน้ำต่อจำนวนผู้พักพิง (Sphere Standard: 1:20)'
		}
	};

	const isSaving = $derived(mutation.isPending);

	async function handleSave() {
		if (!reason.trim()) return;
		await mutation.mutateAsync({
			prev: profile,
			changes: ratios,
			reason: reason.trim(),
			ctx: { createdBy: authStore.user?.name ?? 'unknown' }
		});
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
	<div class="w-full max-w-lg rounded-3xl bg-white shadow-2xl">
		<!-- Header -->
		<div class="flex items-start justify-between border-b border-black/[0.06] px-6 py-5">
			<div>
				<p class="text-[11px] font-black uppercase tracking-wider text-[#013365]">
					แก้ไข Master SOP Profile
				</p>
				<h3 class="mt-0.5 text-xl font-bold text-slate-900">{profile.name}</h3>
				<p class="mt-0.5 font-mono text-[12px] text-slate-400">v{profile.version} → v{profile.version + 1}</p>
			</div>
			<button
				onclick={onClose}
				class="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
			>
				<X size={18} />
			</button>
		</div>

		<!-- Form Body -->
		<div class="space-y-4 px-6 py-5">
			{#each SOP_RATIO_KEYS as key (key)}
				{@const meta = RATIO_LABELS[key]}
				<div class="rounded-2xl border border-black/[0.06] bg-slate-50/60 p-4">
					<div class="mb-2 flex items-center justify-between">
						<div>
							<p class="text-[14px] font-bold text-slate-800">{meta?.label ?? key}</p>
							<p class="text-[11px] text-slate-500">{meta?.description ?? ''}</p>
						</div>
						<span class="rounded-full bg-white px-2.5 py-1 text-[11px] font-bold text-slate-500 shadow-sm border border-black/[0.06]">
							{meta?.unit}
						</span>
					</div>
					<input
						type="number"
						step="0.001"
						min="0.001"
						bind:value={ratios[key]}
						class="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-[15px] font-mono font-semibold text-[#013365] outline-none transition-colors focus:border-[#013365] focus:ring-2 focus:ring-[#013365]/15"
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
					class="w-full rounded-xl border border-black/10 bg-white px-4 py-2.5 text-[14px] text-slate-700 outline-none transition-colors focus:border-[#013365] focus:ring-2 focus:ring-[#013365]/15 placeholder:text-slate-400"
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
