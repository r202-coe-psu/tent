<script lang="ts">
	import type { SopMaster, SopOverride } from '$lib/features/sop-ratios';
	import {
		useAllMasterProfiles,
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
		FoodSphereStandardTab,
		RequirementGroupTab,
		ReplenishmentPolicyTab,
		type SopTabType
	} from '$lib/features/sop-ratios/components';

	import { authStore } from '$lib/stores/auth.svelte';
	import { toast } from 'svelte-sonner';
	import ConsoleBanner from '$lib/components/console-banner.svelte';

	// Global Baseline context — never shelter-scoped
	const shelterCode = '';
	const isSA = true;
	const canEditOverride = false;

	// Tab state — default to sphere_standard per commit 88357d28
	let activeTab = $state<SopTabType>('sphere_standard');

	// Modal / Drawer state
	let bulkEditOpen = $state(false);
	let createMasterOpen = $state(false);
	let historyProfile = $state<SopMaster | SopOverride | null>(null);
	let selectedMasterSlug = $state('');
	let viewedMasterVersion = $state<SopMaster | null>(null);

	// Queries (shelterCode = '' → reads catalog DB directly, SPHERE_BASELINE)
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

	// Badge counts (master baseline)
	const foodSphereQuery = useFoodSphereStandards(() => shelterCode);
	const reqGroupQuery = useRequirementGroups(() => shelterCode);
	const replenishmentQuery = useReplenishmentPolicies(() => shelterCode);

	// In Global Baseline context activeContext is always 'master'
	let activeContext = $state<'master' | 'override'>('master');
	const viewedProfile = $derived(
		viewedMasterVersion &&
			(viewedMasterVersion.slug ?? createProfileSlug(viewedMasterVersion.name)) ===
				effectiveSelectedMasterSlug
			? viewedMasterVersion
			: null
	);
	const activeProfile = $derived(viewedProfile ?? selectedMaster);

	const setMasterActiveMutation = useSetMasterActive();
	const disabled = $derived(setMasterActiveMutation.isPending);

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
</script>

<svelte:head>
	<title>พารามิเตอร์ระบบส่วนกลาง — SmartShelter</title>
	<meta
		name="description"
		content="จัดการพารามิเตอร์มาตรฐานระดับระบบ (Global Master Baseline) สำหรับการคำนวณทรัพยากร"
	/>
</svelte:head>

<main class="container mx-auto space-y-4 px-4 py-6">
	<ConsoleBanner
		title="4. พารามิเตอร์ระบบส่วนกลาง (Global Master Parameters)"
		description="จัดการพารามิเตอร์ SOP มาตรฐาน (Sphere Standard) ระดับระบบ — เขียนลงฐานข้อมูลกลาง catalog ทั้งหมด ไม่ผูกกับศูนย์พักพิงใด"
	/>

	{#if !masterQuery.isLoading && (masterQuery.data ?? []).length === 0 && activeTab === 'sphere_standard'}
		<div class="rounded-xl border border-dashed p-6 text-center">
			<p class="font-semibold">ยังไม่มี Master SOP Profile</p>
			<button
				class="mt-3 rounded-lg bg-brand px-4 py-2 text-sm font-semibold text-white"
				onclick={() => (createMasterOpen = true)}>สร้าง Master Profile แรก</button
			>
		</div>
	{/if}

	<div class="grid grid-cols-1 gap-4 lg:grid-cols-[320px_minmax(0,1fr)] lg:gap-6">
		<SopTypeList
			bind:activeTab
			foodSphereCount={foodSphereQuery.data ? foodSphereQuery.data.length : 0}
			reqGroupCount={reqGroupQuery.data ? reqGroupQuery.data.length : 0}
			replenishmentCount={replenishmentQuery.data ? replenishmentQuery.data.length : 0}
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
			{#if masterQuery.isLoading}
				<div
					class="flex min-h-160 items-center justify-center rounded-xl border bg-card p-6 shadow-sm"
				>
					<div
						class="h-8 w-8 animate-spin rounded-full border-2 border-slate-200 border-t-primary"
					></div>
				</div>
			{:else}
				<div class="flex min-w-0 flex-col gap-3">
					<!-- Master Profile selector & actions (SA always) -->
					<div class="flex flex-wrap items-center gap-2">
						<label for="master-profile-sm" class="text-sm font-semibold">Master Profile</label>
						<select
							id="master-profile-sm"
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
					<SopRatioTab
						profile={activeProfile}
						bind:activeContext
						hasOverride={false}
						{isSA}
						{canEditOverride}
						{shelterCode}
						{disabled}
						onEditAll={handleEditAll}
						onCreateOverride={() => {}}
						onDeactivateOverride={() => {}}
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
