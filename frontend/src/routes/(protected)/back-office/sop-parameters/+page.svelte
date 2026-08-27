<script lang="ts">
	import type { SopMaster, SopOverride } from '$lib/features/sop-ratios';
	import {
		useAllMasterProfiles,
		useActiveSopOverride,
		useSetOverrideInactive,
		useCreateInitialOverride,
		useSetMasterActive,
		createProfileSlug,
		useFoodSphereStandards,
		useRequirementGroups,
		useReplenishmentPolicies
	} from '$lib/features/sop-ratios';
	import {
		SopTypeList,
		SopRatioTab,
		SopEditForm,
		AlertThresholdEditor,
		VersionHistoryDrawer,
		DeactivateConfirmDialog,
		FoodSphereStandardTab,
		RequirementGroupTab,
		ReplenishmentPolicyTab,
		type SopTabType
	} from '$lib/features/sop-ratios/components';

	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { authStore } from '$lib/stores/auth.svelte';
	import { isSystemAdmin, isShelterManager, shelterCodeFromRoles } from '$lib/auth/roles';
	import { toast } from 'svelte-sonner';
	import ConsoleBanner from '$lib/components/console-banner.svelte';

	// Tab and context state
	let activeTab = $state<SopTabType>('sphere_standard');
	let activeContext = $state<'master' | 'override'>('master');

	// Modal / Drawer state
	let bulkEditOpen = $state(false);
	let createMasterOpen = $state(false);
	let deactivateConfirmOpen = $state(false);
	let historyProfile = $state<SopMaster | SopOverride | null>(null);
	let selectedMasterSlug = $state('');
	let viewedMasterVersion = $state<SopMaster | null>(null);

	// Queries
	const masterQuery = useAllMasterProfiles();
	const activeMaster = $derived(masterQuery.data?.find((profile) => profile.active) ?? null);
	const activeMasterSlug = $derived(
		activeMaster ? (activeMaster.slug ?? createProfileSlug(activeMaster.name)) : ''
	);
	const effectiveSelectedMasterSlug = $derived(selectedMasterSlug || activeMasterSlug);
	const selectedMaster = $derived(
		masterQuery.data?.find(
			(profile) => (profile.slug ?? createProfileSlug(profile.name)) === effectiveSelectedMasterSlug
		) ??
			activeMaster ??
			null
	);

	const shelterCode = $derived(shelterStore.selectedShelterCode ?? '');
	const overrideQuery = useActiveSopOverride(() => shelterCode);
	const activeOverride = $derived(overrideQuery.data ?? null);

	// Food Sphere & Replenishment queries for badge counts
	const foodSphereQuery = useFoodSphereStandards(() => shelterCode);
	const reqGroupQuery = useRequirementGroups(() => shelterCode);
	const replenishmentQuery = useReplenishmentPolicies(() => shelterCode);

	const effectiveActiveContext = $derived(shelterCode ? activeContext : 'master');
	const viewedProfile = $derived(
		viewedMasterVersion &&
			(viewedMasterVersion.slug ?? createProfileSlug(viewedMasterVersion.name)) ===
				effectiveSelectedMasterSlug
			? viewedMasterVersion
			: null
	);
	const activeProfile = $derived(
		effectiveActiveContext === 'master' ? (viewedProfile ?? selectedMaster) : activeOverride
	);

	// Mutations
	const setInactiveMutation = useSetOverrideInactive(() => shelterCode);
	const initialOverrideMutation = useCreateInitialOverride(() => shelterCode);
	const setMasterActiveMutation = useSetMasterActive();

	const disabled = $derived(
		setInactiveMutation.isPending ||
			initialOverrideMutation.isPending ||
			setMasterActiveMutation.isPending
	);

	const roles = $derived(authStore.user?.roles ?? []);
	const isSA = $derived(isSystemAdmin(roles));
	const canEditOverride = $derived(
		isSA || (isShelterManager(roles) && shelterCodeFromRoles(roles) === shelterCode)
	);

	async function createInitialOverride() {
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

	function deactivateOverride() {
		if (!activeOverride) return;
		deactivateConfirmOpen = true;
	}

	async function handleConfirmDeactivate() {
		if (!activeOverride) return;
		await setInactiveMutation.mutateAsync({
			id: activeOverride._id,
			ctx: { shelterCode, createdBy: authStore.user?.name ?? 'unknown' }
		});
		activeContext = 'master';
	}

	function handleEditAll() {
		if (!activeProfile) {
			toast.error('ไม่สามารถแก้ไขพารามิเตอร์ได้ เนื่องจากยังโหลดข้อมูล SOP ไม่สำเร็จ');
			return;
		}
		bulkEditOpen = true;
	}

	function handleViewHistory() {
		historyProfile = activeProfile;
	}

	async function setMasterActive() {
		if (!selectedMaster) {
			toast.error('ไม่พบ Master Profile ที่เลือก');
			return;
		}
		if (selectedMaster.active) return;
		const createdBy = authStore.user?.name ?? 'unknown';
		await setMasterActiveMutation.mutateAsync({ id: selectedMaster._id, createdBy });
	}

	function selectMaster(event: Event) {
		selectedMasterSlug = (event.currentTarget as HTMLSelectElement).value;
		viewedMasterVersion = null;
	}
</script>

<svelte:head>
	<title>พารามิเตอร์ SOP มาตรฐาน — SmartShelter</title>
	<meta name="description" content="จัดการค่า SOP ratio มาตรฐานและการปรับแต่งเฉพาะศูนย์พักพิง" />
</svelte:head>

<main class="container mx-auto space-y-4 px-4 py-6">
	<ConsoleBanner
		title="5. พารามิเตอร์มาตรฐานและกฎเกณฑ์ (SOP Parameters & Rules)"
		description="กำหนดพารามิเตอร์ SOP มาตรฐาน (Sphere Standard) สำหรับการคำนวณทรัพยากร และค่าปรับแต่งเฉพาะศูนย์พักพิง"
	/>

	{#if isSA && !masterQuery.isLoading && (masterQuery.data ?? []).length === 0 && activeTab === 'sphere_standard'}
		<div class="rounded-xl border border-dashed p-6 text-center">
			<p class="font-semibold">ยังไม่มี Master SOP Profile</p>
			<button
				class="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
				onclick={() => (createMasterOpen = true)}>สร้าง Master Profile แรก</button
			>
		</div>
	{/if}

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr] lg:gap-6">
		<SopTypeList
			bind:activeTab
			foodSphereCount={foodSphereQuery.data?.length ?? 14}
			reqGroupCount={reqGroupQuery.data?.length ?? 3}
			replenishmentCount={replenishmentQuery.data?.length ?? 3}
			sphereCount={20}
			alertCount={8}
		/>

		{#if activeTab === 'food_sphere_standard'}
			<FoodSphereStandardTab {shelterCode} {isSA} {canEditOverride} />
		{:else if activeTab === 'requirement_group'}
			<RequirementGroupTab {shelterCode} {isSA} {canEditOverride} />
		{:else if activeTab === 'replenishment_policy'}
			<ReplenishmentPolicyTab {shelterCode} {isSA} {canEditOverride} />
		{:else if activeTab === 'sphere_standard'}
			{#if masterQuery.isLoading || (shelterCode && overrideQuery.isLoading)}
				<div
					class="flex min-h-160 items-center justify-center rounded-xl border bg-card p-6 shadow-sm"
				>
					<div
						class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-primary"
					></div>
				</div>
			{:else}
				<!-- Keep the master toolbar and ratios panel in the same grid column. -->
				<div class="flex min-w-0 flex-col gap-3">
					{#if isSA}
						<div class="flex flex-wrap items-center gap-2">
							<label for="master-profile" class="text-sm font-semibold">Master Profile</label>
							<select
								id="master-profile"
								value={effectiveSelectedMasterSlug}
								onchange={selectMaster}
								class="rounded-md border bg-background px-3 py-2 text-sm"
							>
								{#each masterQuery.data ?? [] as profile (profile._id)}
									<option value={profile.slug ?? createProfileSlug(profile.name)}
										>{profile.active ? '[ใช้งาน] ' : ''}{profile.name} (v{profile.version})</option
									>
								{/each}
							</select>
							<button
								class="rounded-md border px-3 py-2 text-sm font-semibold"
								onclick={() => (createMasterOpen = true)}>สร้าง Master Profile</button
							>
							{#if selectedMaster}
								<button
									type="button"
									class="rounded-md border px-3 py-2 text-sm font-semibold disabled:opacity-50"
									disabled={disabled || selectedMaster.active}
									onclick={setMasterActive}
								>
									{selectedMaster.active ? 'กำลังใช้งาน' : 'ตั้งเป็น Master หลัก'}
								</button>
							{/if}
						</div>
					{/if}
					<SopRatioTab
						profile={activeProfile}
						bind:activeContext
						hasOverride={!!activeOverride}
						{isSA}
						{canEditOverride}
						{shelterCode}
						{disabled}
						onEditAll={handleEditAll}
						onCreateOverride={createInitialOverride}
						onDeactivateOverride={deactivateOverride}
						onViewHistory={handleViewHistory}
					/>
				</div>
			{/if}
		{:else if activeTab === 'alert_threshold'}
			<AlertThresholdEditor />
		{/if}
	</div>
</main>

{#if bulkEditOpen && activeProfile}
	<SopEditForm profile={activeProfile} onClose={() => (bulkEditOpen = false)} />
{/if}

{#if createMasterOpen}
	<SopEditForm mode="create" onClose={() => (createMasterOpen = false)} />
{/if}

{#if historyProfile}
	<VersionHistoryDrawer
		profile={historyProfile}
		{activeMaster}
		{isSA}
		onViewVersion={(profile) => {
			if (profile.type === 'sop_profile') {
				viewedMasterVersion = profile;
				activeContext = 'master';
			}
		}}
		onClose={() => {
			historyProfile = null;
		}}
	/>
{/if}

<DeactivateConfirmDialog
	bind:open={deactivateConfirmOpen}
	{shelterCode}
	onConfirm={handleConfirmDeactivate}
	isPending={setInactiveMutation.isPending}
/>
