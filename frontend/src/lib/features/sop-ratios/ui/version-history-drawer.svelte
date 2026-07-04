<script lang="ts">
	import type { SopMaster } from '$lib/features/sop-ratios';
	import { useMasterVersionHistory } from '$lib/features/sop-ratios';
	import X from '@lucide/svelte/icons/x';
	import Clock from '@lucide/svelte/icons/clock';
	import User from '@lucide/svelte/icons/user';
	import Tag from '@lucide/svelte/icons/tag';

	interface Props {
		profile: SopMaster;
		onClose: () => void;
	}

	const { profile, onClose }: Props = $props();

	const historyQuery = useMasterVersionHistory(profile.name);

	function formatDate(iso: string) {
		return new Date(iso).toLocaleString('th-TH', {
			day: '2-digit',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

<!-- Backdrop -->
<div
	class="fixed inset-0 z-40 bg-black/30 backdrop-blur-sm"
	role="presentation"
	onclick={onClose}
></div>

<!-- Drawer from right -->
<div class="fixed inset-y-0 right-0 z-50 flex w-full max-w-md flex-col bg-white shadow-2xl">
	<!-- Header -->
	<div class="flex items-start justify-between border-b border-black/[0.06] px-6 py-5">
		<div>
			<p class="text-[11px] font-black uppercase tracking-wider text-[#013365]">
				ประวัติการแก้ไข
			</p>
			<h3 class="mt-0.5 text-lg font-bold text-slate-900">{profile.name}</h3>
		</div>
		<button
			onclick={onClose}
			class="rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600"
		>
			<X size={18} />
		</button>
	</div>

	<!-- Timeline -->
	<div class="flex-1 overflow-y-auto px-6 py-5">
		{#if historyQuery.isLoading}
			<div class="flex items-center justify-center py-16 text-slate-400">
				<div class="flex flex-col items-center gap-3">
					<div class="h-7 w-7 animate-spin rounded-full border-2 border-slate-200 border-t-[#013365]"></div>
					<p class="text-sm font-medium">กำลังโหลดประวัติ...</p>
				</div>
			</div>
		{:else if historyQuery.isError}
			<p class="py-8 text-center text-sm text-red-500">โหลดข้อมูลไม่สำเร็จ</p>
		{:else if (historyQuery.data ?? []).length === 0}
			<p class="py-12 text-center text-sm font-medium text-slate-400">ยังไม่มีประวัติการแก้ไข</p>
		{:else}
			<ol class="relative border-l-2 border-slate-100 pl-6 space-y-6">
				{#each historyQuery.data ?? [] as version (version._id)}
					<li class="relative">
						<!-- Timeline dot -->
						<span
							class="absolute -left-[29px] flex h-4 w-4 items-center justify-center rounded-full border-2 {version.active
								? 'border-[#013365] bg-[#013365]'
								: 'border-slate-300 bg-white'}"
						>
							{#if version.active}
								<span class="h-1.5 w-1.5 rounded-full bg-white"></span>
							{/if}
						</span>

						<div class="rounded-2xl border border-black/[0.06] bg-white p-4 shadow-sm">
							<div class="mb-2 flex items-center justify-between">
								<span
									class="rounded-full px-2.5 py-0.5 font-mono text-[12px] font-bold {version.active
										? 'bg-[#013365]/10 text-[#013365]'
										: 'bg-slate-100 text-slate-500'}"
								>
									v{version.version}
									{#if version.active}&nbsp;• ปัจจุบัน{/if}
								</span>
							</div>

							<!-- Ratios snapshot -->
							<div class="mt-2 grid grid-cols-3 gap-2">
								{#each Object.entries(version.ratios) as [k, v] (k)}
									<div class="rounded-lg bg-slate-50 px-2 py-1.5 text-center">
										<p class="font-mono text-[13px] font-bold text-[#013365]">{v}</p>
										<p class="text-[10px] text-slate-500">{k.split('_')[0]}</p>
									</div>
								{/each}
							</div>

							<div class="mt-3 space-y-1 border-t border-black/[0.04] pt-3">
								<p class="flex items-center gap-1.5 text-[12px] text-slate-500">
									<User size={12} />
									{version.created_by}
								</p>
								<p class="flex items-center gap-1.5 text-[12px] text-slate-500">
									<Clock size={12} />
									{formatDate(version.updated_at)}
								</p>
							</div>
						</div>
					</li>
				{/each}
			</ol>
		{/if}
	</div>
</div>
