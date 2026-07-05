<script lang="ts">
	import type { SopMaster, SopOverride } from '$lib/features/sop-ratios';
	import {
		useSopProfiles,
		useActiveSopOverride,
		useSetOverrideInactive,
		SOP_RATIO_KEYS,
		SopMasterTable,
		SopEditForm,
		VersionHistoryDrawer,
		RATIO_LABELS
	} from '$lib/features/sop-ratios';
	import { backofficeState } from '$lib/stores/backoffice.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin } from '$lib/auth/roles';
	import Calculator from '@lucide/svelte/icons/calculator';
	import Settings2 from '@lucide/svelte/icons/settings-2';
	import History from '@lucide/svelte/icons/history';
	import Pencil from '@lucide/svelte/icons/pencil';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import RotateCcw from '@lucide/svelte/icons/rotate-ccw';

	// Queries
	const masterQuery = useSopProfiles();
	const activeMaster = $derived(masterQuery.data?.[0] ?? null);

	const shelterCode = $derived(backofficeState.selectedShelter);
	const overrideQuery = useActiveSopOverride(() => shelterCode);
	const activeOverride = $derived(overrideQuery.data ?? null);

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));

	// Mutations
	const setInactiveMutation = useSetOverrideInactive(() => shelterCode);

	// Modal / Drawer state
	let editingMode = $state<'edit' | 'create_override'>('edit');
	let editingProfile = $state<SopMaster | SopOverride | null>(null);
	let historyProfile = $state<SopMaster | SopOverride | null>(null);

	async function deactivateOverride() {
		if (!activeOverride) return;
		if (
			confirm(
				`คุณต้องการยกเลิกค่าปรับแต่งและกลับไปใช้ค่ามาตรฐาน EOC สำหรับศูนย์ ${shelterCode} ใช่หรือไม่?`
			)
		) {
			await setInactiveMutation.mutateAsync({
				id: activeOverride._id,
				ctx: { shelterCode, createdBy: authStore.user?.name ?? 'unknown' }
			});
		}
	}
</script>

<svelte:head>
	<title>พารามิเตอร์ SOP มาตรฐาน — SmartShelter</title>
	<meta name="description" content="จัดการค่า SOP ratio มาตรฐานและการปรับแต่งเฉพาะศูนย์พักพิง" />
</svelte:head>

<div class="space-y-6 p-4 md:p-6 lg:p-8">
	<!-- Premium header card -->
	<div
		class="relative overflow-hidden rounded-3xl border border-indigo-900 bg-[#013365] p-6 text-white shadow-md md:p-8"
	>
		<div
			class="pointer-events-none absolute top-0 right-0 h-64 w-64 rounded-full bg-white/5 blur-3xl"
		></div>
		<div class="relative flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
			<div>
				<span
					class="rounded-md border border-white/20 bg-white/10 px-2.5 py-1 font-mono text-[10px] font-bold tracking-wider text-blue-300 uppercase"
				>
					ศูนย์จัดการฐานข้อมูลหลังบ้าน (Backend Master Console)
				</span>
				<h1 class="mt-2.5 text-2xl font-extrabold tracking-tight text-slate-100 md:text-3xl">
					พารามิเตอร์และกฎเกณฑ์การคำนวณ
				</h1>
				<p class="mt-1 max-w-xl text-xs font-medium text-slate-400">
					กำหนดอัตราส่วน SOP มาตรฐาน (Sphere Standard) สำหรับการคำนวณทรัพยากร
					และค่าปรับแต่งเฉพาะศูนย์
				</p>
			</div>
		</div>
	</div>

	<!-- Master SOP Baseline Panel -->
	<div class="flex flex-col rounded-3xl border border-black/[0.05] bg-white p-6 shadow-sm">
		<div class="mb-5 flex items-center justify-between">
			<div>
				<h2 class="text-lg font-bold text-slate-900">ค่าพารามิเตอร์มาตรฐาน EOC</h2>
				<p class="mt-0.5 text-sm text-slate-500">ค่า baseline กลางสำหรับอ้างอิงในทุกศูนย์พักพิง</p>
			</div>
			{#if !isSA}
				<span
					class="flex items-center gap-1.5 rounded-full border border-black/5 bg-slate-100 px-3 py-1 text-[11px] font-bold text-slate-500"
				>
					<ShieldAlert size={12} /> Read-only
				</span>
			{/if}
		</div>

		<div class="flex-1">
			{#if masterQuery.isLoading}
				<div class="flex items-center justify-center py-12">
					<div
						class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-[#013365]"
					></div>
				</div>
			{:else if masterQuery.isError}
				<div class="rounded-2xl border border-red-100 bg-red-50 p-6 text-center">
					<p class="font-medium text-red-600">โหลดข้อมูลไม่สำเร็จ กรุณารีเฟรชหน้า</p>
				</div>
			{:else if activeMaster}
				<SopMasterTable
					profiles={[activeMaster]}
					onEdit={isSA
						? (p) => {
								editingMode = 'edit';
								editingProfile = p;
							}
						: undefined}
					onViewHistory={(p) => (historyProfile = p)}
				/>
			{:else}
				<div
					class="flex flex-col justify-center rounded-2xl border border-dashed border-slate-200 bg-slate-50/50 p-12 text-center"
				>
					<Calculator size={40} class="mx-auto mb-3 text-slate-300" />
					<p class="font-medium text-slate-500">ยังไม่มีโปรไฟล์ SOP มาตรฐาน</p>
				</div>
			{/if}
		</div>
	</div>

	<!-- Shelter Override Panel -->
	<div class="flex flex-col rounded-3xl border border-black/[0.05] bg-slate-50 p-6 shadow-sm">
		<div class="mb-5 flex items-start justify-between">
			<div>
				<h2 class="text-lg font-bold text-slate-900">ค่าปรับแต่งเฉพาะศูนย์พักพิง</h2>
				<p class="mt-0.5 text-sm text-slate-500">
					ตั้งค่าตัวคูณแยกสำหรับศูนย์ <strong class="text-slate-800"
						>{shelterCode || 'ไม่ได้เลือกศูนย์'}</strong
					>
				</p>
			</div>
		</div>

		<div class="flex-1">
			{#if !shelterCode}
				<div
					class="flex flex-col justify-center rounded-2xl border border-dashed border-slate-200 bg-white p-12 text-center"
				>
					<Settings2 size={40} class="mx-auto mb-3 text-slate-300" />
					<p class="font-medium text-slate-500">
						กรุณาเลือกศูนย์พักพิงในแถบด้านบนเพื่อดูค่าปรับแต่ง
					</p>
				</div>
			{:else if overrideQuery.isLoading || masterQuery.isLoading}
				<div class="flex items-center justify-center py-12">
					<div
						class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-[#013365]"
					></div>
				</div>
			{:else if activeOverride}
				<!-- Active Override Display -->
				<div
					class="flex flex-col overflow-hidden rounded-2xl border border-amber-500/20 bg-amber-500/5 shadow-sm"
				>
					<div
						class="flex items-center justify-between border-b border-amber-500/10 bg-amber-500/10 px-5 py-3"
					>
						<span
							class="inline-flex items-center gap-1.5 rounded-full bg-amber-500 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm"
						>
							<Settings2 size={12} />
							ใช้ค่าปรับแต่งเฉพาะศูนย์
						</span>
						<span class="font-mono text-[11px] font-bold text-amber-700"
							>v{activeOverride.version}</span
						>
					</div>

					<div class="max-h-96 flex-1 overflow-y-auto p-5">
						<div class="grid grid-cols-2 gap-4 md:grid-cols-3">
							{#each SOP_RATIO_KEYS as key (key)}
								<div class="rounded-xl border border-black/5 bg-white p-3 shadow-sm">
									<p class="text-[11px] text-slate-500">
										{RATIO_LABELS[key]?.label ?? key}
										{#if RATIO_LABELS[key]?.unit}
											<span class="text-[10px] opacity-70">({RATIO_LABELS[key].unit})</span>
										{/if}
									</p>
									<p class="mt-1 font-mono text-lg font-bold text-amber-700">
										{activeOverride.ratios[key]}
									</p>
								</div>
							{/each}
						</div>
					</div>

					<div
						class="flex items-center justify-between border-t border-black/5 bg-white/50 px-5 py-4"
					>
						<button
							onclick={deactivateOverride}
							disabled={setInactiveMutation.isPending}
							class="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-[12px] font-bold text-red-600 transition-colors hover:bg-red-100 disabled:opacity-50"
						>
							<RotateCcw size={13} />
							ยกเลิกค่าปรับแต่ง
						</button>
						<div class="flex items-center gap-2">
							<button
								onclick={() => (historyProfile = activeOverride)}
								class="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[12px] font-bold text-slate-600 transition-colors hover:border-slate-300 hover:bg-slate-50"
							>
								<History size={13} />
								ประวัติ
							</button>
							<button
								onclick={() => {
									editingMode = 'edit';
									editingProfile = activeOverride;
								}}
								class="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-[12px] font-bold text-white transition-colors hover:bg-amber-600"
							>
								<Pencil size={13} />
								แก้ไข
							</button>
						</div>
					</div>
				</div>
			{:else}
				<!-- No Override (Fallback to Master) -->
				<div
					class="flex flex-col overflow-hidden rounded-2xl border border-[#013365]/20 bg-white shadow-sm"
				>
					<div
						class="flex items-center justify-between border-b border-[#013365]/10 bg-[#013365]/5 px-5 py-3"
					>
						<span
							class="inline-flex items-center gap-1.5 rounded-full bg-[#013365] px-2.5 py-1 text-[11px] font-bold text-white shadow-sm"
						>
							<ShieldAlert size={12} />
							ใช้ค่ามาตรฐาน EOC
						</span>
					</div>

					<div class="flex flex-1 items-center justify-center p-5 text-center">
						<div>
							<Calculator size={32} class="mx-auto mb-3 text-slate-300" />
							<p class="text-sm font-medium text-slate-600">
								ศูนย์พักพิงนี้ใช้งานอัตราส่วนมาตรฐานกลาง
							</p>
							<p class="mt-1 text-[12px] text-slate-400">ยังไม่มีการปรับแต่งตัวคูณเฉพาะศูนย์</p>
						</div>
					</div>

					{#if activeMaster}
						<div
							class="flex items-center justify-center border-t border-black/5 bg-slate-50 px-5 py-4"
						>
							<button
								onclick={() => {
									editingMode = 'create_override';
									editingProfile = null; // Will use activeMaster as base
								}}
								class="inline-flex items-center gap-1.5 rounded-xl bg-amber-500 px-4 py-2 text-[13px] font-bold text-white shadow-sm transition-colors hover:bg-amber-600"
							>
								<Settings2 size={14} />
								สร้างค่าปรับแต่งเฉพาะศูนย์
							</button>
						</div>
					{/if}
				</div>
			{/if}
		</div>
	</div>
</div>

<!-- Edit Form Modal -->
{#if editingMode === 'edit' && editingProfile}
	<SopEditForm mode="edit" profile={editingProfile} onClose={() => (editingProfile = null)} />
{:else if editingMode === 'create_override' && activeMaster}
	<SopEditForm
		mode="create_override"
		baseMasterProfile={activeMaster}
		{shelterCode}
		onClose={() => {
			editingMode = 'edit'; // reset
		}}
	/>
{/if}

<!-- Version History Drawer -->
{#if historyProfile}
	<VersionHistoryDrawer profile={historyProfile} onClose={() => (historyProfile = null)} />
{/if}
