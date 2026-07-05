<script lang="ts">
	import type { SopMaster } from '$lib/features/sop-ratios';
	import { SOP_RATIO_KEYS, RATIO_LABELS } from '$lib/features/sop-ratios';
	import History from '@lucide/svelte/icons/history';
	import Pencil from '@lucide/svelte/icons/pencil';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';

	interface Props {
		profiles: SopMaster[];
		onViewHistory: (profile: SopMaster) => void;
		onEdit?: (profile: SopMaster) => void;
	}

	const { profiles, onViewHistory, onEdit }: Props = $props();

	// Only show the latest active version per profile name
	const activeProfiles = $derived(
		profiles.filter((p) => p.active).sort((a, b) => b.version - a.version)
	);
</script>

<div class="flex flex-col gap-6">
	{#each activeProfiles as profile (profile._id)}
		<div
			class="flex flex-col overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-sm"
		>
			<!-- Header -->
			<div
				class="flex items-center justify-between border-b border-black/[0.06] bg-slate-50 px-5 py-4"
			>
				<div class="flex items-center gap-3">
					<span
						class="inline-flex items-center gap-1.5 rounded-full bg-[#013365] px-2.5 py-1 text-[11px] font-bold text-white shadow-sm"
					>
						<ShieldAlert size={12} />
						ใช้งานอยู่
					</span>
					<div>
						<h3 class="font-bold text-slate-900">
							{profile.name}
							<span class="ml-1 font-mono text-xs text-slate-500">v{profile.version}</span>
						</h3>
						<p class="font-mono text-[11px] text-slate-400">{profile._id}</p>
					</div>
				</div>
			</div>

			<!-- Grid of Ratios with Scroll (max-h-96) -->
			<div class="max-h-96 overflow-y-auto p-5">
				<div class="grid grid-cols-2 gap-4 md:grid-cols-3">
					{#each SOP_RATIO_KEYS as key (key)}
						<div
							class="rounded-xl border border-black/5 bg-slate-50/50 p-3 shadow-sm transition-colors hover:bg-slate-50"
						>
							<p class="text-[11px] text-slate-500">
								{RATIO_LABELS[key]?.label ?? key}
								{#if RATIO_LABELS[key]?.unit}
									<span class="text-[10px] opacity-70">({RATIO_LABELS[key].unit})</span>
								{/if}
							</p>
							<p class="mt-1 font-mono text-lg font-bold text-[#013365]">
								{profile.ratios[key]}
							</p>
						</div>
					{/each}
				</div>
			</div>

			<!-- Footer Actions -->
			<div
				class="flex items-center justify-end gap-2 border-t border-black/5 bg-slate-50/50 px-5 py-4"
			>
				<button
					onclick={() => onViewHistory(profile)}
					class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
				>
					<History size={13} />
					ประวัติ
				</button>
				{#if onEdit}
					<button
						onclick={() => onEdit(profile)}
						class="inline-flex items-center gap-1.5 rounded-lg bg-[#013365] px-3 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-[#002244]"
					>
						<Pencil size={13} />
						แก้ไข
					</button>
				{/if}
			</div>
		</div>
	{/each}

	{#if activeProfiles.length === 0}
		<div
			class="flex flex-col justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center shadow-sm"
		>
			<ShieldAlert size={40} class="mx-auto mb-3 text-slate-300" />
			<p class="font-medium text-slate-500">📭 ยังไม่มีโปรไฟล์ SOP ในระบบ</p>
		</div>
	{/if}
</div>
