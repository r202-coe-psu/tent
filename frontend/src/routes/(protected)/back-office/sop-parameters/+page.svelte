<script lang="ts">
	import type { SopMaster, SopOverride, SopRatioKey, SopTabType } from '$lib/features/sop-ratios';
	import {
		useSopProfiles,
		useActiveSopOverride,
		useSetOverrideInactive,
		useCreateInitialOverride,
		SopTypeList,
		SopRatioTab,
		SopSingleEditModal,
		AlertThresholdStub,
		VersionHistoryDrawer
	} from '$lib/features/sop-ratios';

	import { backofficeState } from '$lib/stores/backoffice.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin } from '$lib/auth/roles';
	import { toast } from 'svelte-sonner';

	// Tab and context state
	let activeTab = $state<SopTabType>('sphere_standard');
	let activeContext = $state<'master' | 'override'>('master');

	// Modal / Drawer state
	let modalOpen = $state(false);
	let editingProfile = $state<SopMaster | SopOverride | null>(null);
	let editingKey = $state<SopRatioKey | null>(null);
	let historyProfile = $state<SopMaster | SopOverride | null>(null);

	// Queries
	const masterQuery = useSopProfiles();
	const activeMaster = $derived(
		masterQuery.data != null && masterQuery.data.length > 0
			? [...masterQuery.data].sort((a, b) => b.version - a.version)[0]
			: null
	);

	const shelterCode = $derived(backofficeState.selectedShelter);
	const overrideQuery = useActiveSopOverride(() => shelterCode);
	const activeOverride = $derived(overrideQuery.data ?? null);

	const activeProfile = $derived(activeContext === 'master' ? activeMaster : activeOverride);
	// Mutations
	const setInactiveMutation = useSetOverrideInactive(() => shelterCode);
	const initialOverrideMutation = useCreateInitialOverride(() => shelterCode);

	const disabled = $derived(setInactiveMutation.isPending || initialOverrideMutation.isPending);

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));

	// Automatically revert context to master if no shelter is selected
	$effect(() => {
		if (!shelterCode && activeContext === 'override') {
			activeContext = 'master';
		}
	});

	async function createInitialOverride() {
		console.log('[SOP Override] createInitialOverride clicked!', { activeMaster, shelterCode });
		if (!activeMaster || !shelterCode) {
			toast.error('ไม่สามารถสร้างค่าปรับแต่งได้ เนื่องจากยังโหลดค่ามาตรฐาน EOC ไม่สำเร็จ');
			return;
		}
		await initialOverrideMutation.mutateAsync({
			name: activeMaster.name,
			ratios: activeMaster.ratios,
			ctx: {
				shelterCode,
				createdBy: authStore.user?.name ?? 'unknown',
				base_profile_id: activeMaster._id
			}
		});
		activeContext = 'override';
	}

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
			activeContext = 'master';
		}
	}

	function handleEditItem(key: SopRatioKey) {
		if (!activeProfile) {
			toast.error('ไม่สามารถแก้ไขพารามิเตอร์ได้ เนื่องจากยังโหลดข้อมูล SOP ไม่สำเร็จ');
			return;
		}
		editingProfile = activeProfile;
		editingKey = key;
		modalOpen = true;
	}

	function handleCloseModal() {
		editingProfile = null;
		editingKey = null;
	}

	function handleViewHistory() {
		historyProfile = activeProfile;
	}
</script>

<svelte:head>
	<title>พารามิเตอร์ SOP มาตรฐาน — SmartShelter</title>
	<meta name="description" content="จัดการค่า SOP ratio มาตรฐานและการปรับแต่งเฉพาะศูนย์พักพิง" />
</svelte:head>

<div class="mx-auto w-full max-w-6xl space-y-4 p-4 sm:p-6">
	<header>
		<h1 class="text-2xl font-semibold tracking-tight">ตั้งค่าพารามิเตอร์และกฎเกณฑ์</h1>
		<p class="mt-1 text-sm text-muted-foreground">
			กำหนดพารามิเตอร์ SOP มาตรฐาน (Sphere Standard) สำหรับการคำนวณทรัพยากร
			และค่าปรับแต่งเฉพาะศูนย์พักพิง
		</p>
	</header>

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr] lg:gap-6">
		<SopTypeList bind:activeTab />

		{#if activeTab === 'sphere_standard'}
			{#if masterQuery.isLoading || (shelterCode && overrideQuery.isLoading)}
				<div class="flex h-64 items-center justify-center rounded-xl border bg-card p-6 shadow-sm">
					<div
						class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-primary"
					></div>
				</div>
			{:else}
				<SopRatioTab
					profile={activeProfile}
					bind:activeContext
					hasOverride={!!activeOverride}
					{isSA}
					{shelterCode}
					{disabled}
					onEditItem={handleEditItem}
					onCreateOverride={createInitialOverride}
					onDeactivateOverride={deactivateOverride}
					onViewHistory={handleViewHistory}
				/>
			{/if}
		{:else if activeTab === 'alert_threshold'}
			<AlertThresholdStub />
		{/if}
	</div>
</div>

{#if modalOpen && editingProfile && editingKey}
	<SopSingleEditModal
		bind:open={modalOpen}
		profile={editingProfile}
		ratioKey={editingKey}
		onClose={handleCloseModal}
	/>
{/if}

{#if historyProfile}
	<VersionHistoryDrawer
		profile={historyProfile}
		{activeMaster}
		onClose={() => {
			historyProfile = null;
		}}
	/>
{/if}
