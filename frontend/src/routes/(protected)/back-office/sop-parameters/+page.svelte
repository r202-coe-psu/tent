<script lang="ts">
	import type { SopMaster } from '$lib/features/sop-ratios';
	import { useActiveSopRatio } from '$lib/features/sop-ratios';
	import SopMasterTable from '$lib/features/sop-ratios/ui/sop-master-table.svelte';
	import SopEditForm from '$lib/features/sop-ratios/ui/sop-edit-form.svelte';
	import VersionHistoryDrawer from '$lib/features/sop-ratios/ui/version-history-drawer.svelte';
	import Calculator from '@lucide/svelte/icons/calculator';

	// Fetch current active profile for display context
	const activeQuery = useActiveSopRatio();

	// Modal / Drawer state
	let editingProfile = $state<SopMaster | null>(null);
	let historyProfile = $state<SopMaster | null>(null);

	// Cast to SopMaster | null — on this page we only manage master profiles
	const activeMaster = $derived(() => {
		const d = activeQuery.data;
		if (d && d.type === 'sop_profile') return d as SopMaster;
		return null;
	});
</script>

<svelte:head>
	<title>พารามิเตอร์ SOP มาตรฐาน — SmartShelter</title>
	<meta name="description" content="จัดการค่า SOP ratio มาตรฐานสำหรับการคำนวณทรัพยากรในศูนย์พักพิง" />
</svelte:head>

<div class="space-y-6">
	<!-- Premium header card -->
	<div
		class="relative overflow-hidden rounded-3xl border border-indigo-900 bg-[#013365] p-6 text-white shadow-md md:p-8"
	>
		<div
			class="pointer-events-none absolute right-0 top-0 h-64 w-64 rounded-full bg-white/5 blur-3xl"
		></div>
		<div class="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
			<div>
				<span
					class="rounded-md border border-white/20 bg-white/10 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-blue-300"
				>
					ศูนย์จัดการฐานข้อมูลหลังบ้าน (Backend Master Console)
				</span>
				<h1 class="mt-2.5 text-2xl font-extrabold tracking-tight text-slate-100 md:text-3xl">
					3. พารามิเตอร์มาตรฐานและกฎเกณฑ์
				</h1>
				<p class="mt-1 max-w-xl text-xs font-medium text-slate-400">
					กำหนดอัตราส่วน SOP มาตรฐาน (Sphere Standard) สำหรับการคำนวณทรัพยากรในศูนย์พักพิง EOC
				</p>
			</div>
			<!-- Active profile badge -->
			{#if activeMaster()}
				<div class="shrink-0 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 backdrop-blur-sm">
					<p class="text-[10px] font-bold uppercase tracking-wider text-blue-300">
						โปรไฟล์ที่ใช้อยู่
					</p>
					<p class="mt-0.5 flex items-center gap-1.5 font-semibold text-white">
						<Calculator size={14} class="text-blue-300" />
						{activeMaster()?.name}
					</p>
					<p class="mt-0.5 font-mono text-[11px] text-blue-300/70">
						v{activeMaster()?.version}
					</p>
				</div>
			{/if}
		</div>
	</div>

	<!-- Content area -->
	<div class="rounded-3xl border border-black/[0.05] bg-white p-6 shadow-sm">
		<div class="mb-5 flex items-center justify-between">
			<div>
				<h2 class="text-lg font-bold text-slate-900">ตัวคูณมาตรฐานดำรงชีพ (Sphere Standard)</h2>
				<p class="mt-0.5 text-sm text-slate-500">
					ค่ามาตรฐาน SOP ratio ที่ใช้เป็น baseline สำหรับทุกศูนย์พักพิง
				</p>
			</div>
		</div>

		{#if activeQuery.isLoading}
			<div class="flex items-center justify-center py-20">
				<div class="flex flex-col items-center gap-3 text-slate-400">
					<div
						class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-[#013365]"
					></div>
					<p class="text-sm font-medium">กำลังโหลดข้อมูล...</p>
				</div>
			</div>
		{:else if activeQuery.isError}
			<div class="rounded-2xl border border-red-100 bg-red-50 p-6 text-center">
				<p class="font-medium text-red-600">โหลดข้อมูลไม่สำเร็จ กรุณารีเฟรชหน้า</p>
			</div>
		{:else if activeMaster()}
			<SopMasterTable
				profiles={[activeMaster()!]}
				onEdit={(p) => (editingProfile = p)}
				onViewHistory={(p) => (historyProfile = p)}
			/>
		{:else}
			<div
				class="rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-12 text-center"
			>
				<Calculator size={40} class="mx-auto mb-3 text-slate-300" />
				<p class="font-medium text-slate-500">ยังไม่มีโปรไฟล์ SOP ที่ใช้งานอยู่</p>
				<p class="mt-1 text-sm text-slate-400">กรุณาติดต่อผู้ดูแลระบบเพื่อเพิ่มข้อมูล seed</p>
			</div>
		{/if}
	</div>
</div>

<!-- Edit Form Modal -->
{#if editingProfile}
	<SopEditForm profile={editingProfile} onClose={() => (editingProfile = null)} />
{/if}

<!-- Version History Drawer -->
{#if historyProfile}
	<VersionHistoryDrawer profile={historyProfile} onClose={() => (historyProfile = null)} />
{/if}
