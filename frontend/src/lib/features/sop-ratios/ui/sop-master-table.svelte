<script lang="ts">
	import type { SopMaster } from '$lib/features/sop-ratios';
	import { SOP_RATIO_KEYS } from '$lib/features/sop-ratios';
	import { useCreateMasterVersion } from '$lib/features/sop-ratios';
	import { authStore } from '$lib/stores/auth.svelte';
	import History from '@lucide/svelte/icons/history';
	import Pencil from '@lucide/svelte/icons/pencil';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import XCircle from '@lucide/svelte/icons/x-circle';

	interface Props {
		profiles: SopMaster[];
		onViewHistory: (profile: SopMaster) => void;
		onEdit: (profile: SopMaster) => void;
	}

	const { profiles, onViewHistory, onEdit }: Props = $props();

	// Only show the latest active version per profile name
	const activeProfiles = $derived(
		profiles
			.filter((p) => p.active)
			.sort((a, b) => b.version - a.version)
	);

	const RATIO_LABELS: Record<string, string> = {
		water_l_per_person_day: 'น้ำ (ลิตร/คน/วัน)',
		rice_g_per_person_meal: 'ข้าว (กรัม/คน/มื้อ)',
		toilet_per_person: 'ห้องน้ำ (ต่อคน)'
	};
</script>

<div class="overflow-hidden rounded-2xl border border-black/[0.06] shadow-sm">
	<table class="w-full bg-white text-left text-sm">
		<thead class="border-b border-black/[0.06] bg-slate-50/80">
			<tr>
				<th class="px-5 py-3.5 text-[13px] font-bold text-slate-700">ชื่อโปรไฟล์</th>
				{#each SOP_RATIO_KEYS as key (key)}
					<th class="px-5 py-3.5 text-[13px] font-bold text-slate-700">
						{RATIO_LABELS[key] ?? key}
					</th>
				{/each}
				<th class="px-5 py-3.5 text-[13px] font-bold text-slate-700">เวอร์ชัน</th>
				<th class="px-5 py-3.5 text-[13px] font-bold text-slate-700">สถานะ</th>
				<th class="px-5 py-3.5 text-right text-[13px] font-bold text-slate-700">จัดการ</th>
			</tr>
		</thead>
		<tbody class="divide-y divide-black/[0.04]">
			{#each activeProfiles as profile (profile._id)}
				<tr class="transition-colors hover:bg-slate-50/60">
					<td class="px-5 py-4">
						<p class="font-semibold text-slate-900">{profile.name}</p>
						<p class="mt-0.5 font-mono text-[11px] text-slate-400">{profile._id}</p>
					</td>
					{#each SOP_RATIO_KEYS as key (key)}
						<td class="px-5 py-4">
							<span class="font-mono font-semibold text-[#013365]">
								{profile.ratios[key]}
							</span>
						</td>
					{/each}
					<td class="px-5 py-4">
						<span class="rounded-full bg-slate-100 px-2.5 py-1 font-mono text-[12px] font-bold text-slate-600">
							v{profile.version}
						</span>
					</td>
					<td class="px-5 py-4">
						{#if profile.active}
							<span class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[12px] font-bold text-emerald-700">
								<CheckCircle size={13} />
								ใช้งานอยู่
							</span>
						{:else}
							<span class="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[12px] font-bold text-slate-500">
								<XCircle size={13} />
								ปิดใช้งาน
							</span>
						{/if}
					</td>
					<td class="px-5 py-4">
						<div class="flex items-center justify-end gap-2">
							<button
								onclick={() => onViewHistory(profile)}
								class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
								title="ดูประวัติ"
							>
								<History size={13} />
								ประวัติ
							</button>
							<button
								onclick={() => onEdit(profile)}
								class="inline-flex items-center gap-1.5 rounded-lg bg-[#013365] px-3 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-[#002244]"
							>
								<Pencil size={13} />
								แก้ไข
							</button>
						</div>
					</td>
				</tr>
			{/each}
			{#if activeProfiles.length === 0}
				<tr>
					<td
						colspan={SOP_RATIO_KEYS.length + 4}
						class="px-5 py-16 text-center text-[15px] font-medium text-slate-400"
					>
						📭 ยังไม่มีโปรไฟล์ SOP ในระบบ
					</td>
				</tr>
			{/if}
		</tbody>
	</table>
</div>
