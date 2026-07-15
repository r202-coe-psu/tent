<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Clock from '@lucide/svelte/icons/clock';
	import X from '@lucide/svelte/icons/x';

	// Svelte-shadcn
	import { Button } from '$lib/components/ui/button/index.js';

	// Queries & mutations
	import { useEvacuees, useHouseholds, useUpdateHousehold, useUpdateEvacuee } from '../index';
	import type { Evacuee, PetGroup, HouseholdVehicle, HouseholdStatus } from '../domain/people';
	import { getShelterCode } from '$lib/db/shelter';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { useShelter } from '$lib/features/shelters';
	import { now } from '$lib/db/model';

	// Sub-components
	import HouseholdProfileHeaderCard from './household-profile-header-card.svelte';
	import HouseholdProfileHeadCard from './household-profile-head-card.svelte';
	import HouseholdProfileMembersCard from './household-profile-members-card.svelte';
	import HouseholdProfileAddressCard from './household-profile-address-card.svelte';
	import HouseholdProfileAssetsCard from './household-profile-assets-card.svelte';

	// Modals
	import EvacueeAddressModal from './evacuee-address-modal.svelte';
	import EvacueeAssetsModal from './evacuee-assets-modal.svelte';
	import HouseholdQrModal from './household-qr-modal.svelte';
	import HouseholdHeadModal from './household-head-modal.svelte';
	import HouseholdMembersModal from './household-members-modal.svelte';
	import EvacueeZoneModal from './evacuee-zone-modal.svelte';

	let { householdId }: { householdId: string } = $props();

	// Tanstack queries
	const evacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	const updateHouseholdMutation = useUpdateHousehold();
	const updateEvacueeMutation = useUpdateEvacuee();

	// Derived data
	const allEvacuees = $derived(evacueesQuery.data ?? []);
	const allHouseholds = $derived(householdsQuery.data ?? []);
	const household = $derived(allHouseholds.find((h) => h._id === householdId) ?? null);
	const members = $derived(allEvacuees.filter((e) => e.household_id === householdId));
	const head = $derived(allEvacuees.find((e) => e._id === household?.head_evacuee_id) ?? null);

	const isLoading = $derived(evacueesQuery.isLoading || householdsQuery.isLoading);

	// Modal controls
	let showStatusModal = $state(false);
	let showMembersModal = $state(false);
	let showHeadModal = $state(false);
	let showQrModal = $state(false);
	let showAddressModal = $state(false);
	let showAssetsModal = $state(false);
	let showZoneModal = $state(false);

	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const shelterZones = $derived(shelterQuery.data?.zones ?? []);
	const headOrFirstMember = $derived(head ?? members[0] ?? null);

	const statusConfig = {
		checked_in: {
			label: 'อยู่ในศูนย์ (Checked-in)',
			colorClass:
				'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800',
			dotClass: 'bg-green-500'
		},
		pre_registered: {
			label: 'ลงทะเบียนล่วงหน้า (Pre-registered)',
			colorClass:
				'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
			dotClass: 'bg-blue-500'
		},
		arriving: {
			label: 'กำลังเดินทาง (Arriving)',
			colorClass:
				'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
			dotClass: 'bg-amber-500'
		},
		checked_out: {
			label: 'ย้ายออก / กลับภูมิลำเนา (Checked-out)',
			colorClass:
				'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800',
			dotClass: 'bg-red-500'
		},
		cancelled: {
			label: 'ยกเลิกการจอง (Cancelled)',
			colorClass:
				'bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800',
			dotClass: 'bg-slate-400'
		}
	} satisfies Record<HouseholdStatus, { label: string; colorClass: string; dotClass: string }>;

	// Actions
	async function saveAddress(data: {
		addressNo: string;
		villageNo: string;
		subdistrict: string;
		district: string;
		province: string;
		postalCode: string;
	}) {
		if (!household) return;
		try {
			await updateHouseholdMutation.mutateAsync({
				...household,
				address_no: data.addressNo || null,
				village_no: data.villageNo || null,
				subdistrict: data.subdistrict || null,
				district: data.district || null,
				province: data.province || null,
				postal_code: data.postalCode || null
			});
			toast.success('แก้ไขที่อยู่สำเร็จ');
			showAddressModal = false;
		} catch (e: unknown) {
			toast.error(`เกิดข้อผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	async function saveAssets(data: {
		vehicles: HouseholdVehicle[];
		valuables: string;
		pets: PetGroup[];
	}) {
		if (!household) return;
		try {
			await updateHouseholdMutation.mutateAsync({
				...household,
				vehicles: data.vehicles,
				assets: data.valuables.trim()
					? { description: data.valuables.trim(), image_url: null }
					: null,
				pets: data.pets
			});
			toast.success('แก้ไขข้อมูลทรัพย์สินและสัตว์เลี้ยงสำเร็จ');
			showAssetsModal = false;
		} catch (e: unknown) {
			toast.error(`เกิดข้อผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	async function updateHouseholdZone(zoneCode: string) {
		if (members.length === 0) {
			toast.error('ไม่พบสมาชิกในครัวเรือนนี้เพื่อย้ายโซน');
			return;
		}
		try {
			// Update stay zone for all family members
			const promises = members.map((m) =>
				updateEvacueeMutation.mutateAsync({
					...m,
					current_stay: { ...m.current_stay, zone: zoneCode, since: now() }
				})
			);
			await Promise.all(promises);

			toast.success(
				`ย้ายโซนสมาชิกทั้ง ${members.length} คนเป็น ${zoneCode.toUpperCase()} เรียบร้อย`
			);
			showZoneModal = false;
		} catch (err: unknown) {
			toast.error(`ไม่สามารถย้ายโซนได้: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async function saveStatus(status: HouseholdStatus) {
		if (!household) return;
		try {
			await updateHouseholdMutation.mutateAsync({
				...household,
				status
			});
			toast.success(`เปลี่ยนสถานะครัวเรือนสำเร็จ`);
			showStatusModal = false;
		} catch (e: unknown) {
			toast.error(`เกิดข้อผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	async function addMemberToHousehold(evacuee: Evacuee) {
		if (!household) return;
		try {
			await updateEvacueeMutation.mutateAsync({
				...evacuee,
				household_id: household._id
			});
			toast.success(`เพิ่ม ${evacuee.first_name} เข้าครัวเรือนเรียบร้อย`);
		} catch (e: unknown) {
			toast.error(`เกิดข้อผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	async function removeMemberFromHousehold(evacuee: Evacuee) {
		if (!household) return;
		if (household.head_evacuee_id === evacuee._id) {
			toast.error('ไม่สามารถลบหัวหน้าครัวเรือนออกได้ กรุณาเปลี่ยนหัวหน้าครัวเรือนก่อน');
			return;
		}
		try {
			await updateEvacueeMutation.mutateAsync({
				...evacuee,
				household_id: null
			});
			toast.success(`ลบ ${evacuee.first_name} ออกจากครัวเรือนเรียบร้อย`);
		} catch (e: unknown) {
			toast.error(`เกิดข้อผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	async function selectNewHead(evacueeId: string) {
		if (!household) return;
		try {
			await updateHouseholdMutation.mutateAsync({
				...household,
				head_evacuee_id: evacueeId
			});
			toast.success('เปลี่ยนหัวหน้าครัวเรือนสำเร็จ');
			showHeadModal = false;
		} catch (e: unknown) {
			toast.error(`เกิดข้อผิดพลาด: ${e instanceof Error ? e.message : String(e)}`);
		}
	}

	function handleViewEvacueeProfile(id: string) {
		goto(
			resolve(
				`/back-office/evacuee-management/edit/-evacuee/${id}?from=/back-office/households/edit/${householdId}`
			)
		);
	}

	function formatDateTime(ts: string | number | undefined): string {
		if (!ts) return 'ไม่ระบุ';
		const d = new Date(ts);
		if (isNaN(d.getTime())) return String(ts);
		return d.toLocaleString('th-TH', {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

{#if isLoading}
	<div
		class="flex flex-col items-center justify-center gap-3 rounded-3xl border border-border bg-card py-20 shadow-sm"
	>
		<div
			class="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent"
		></div>
		<p class="text-sm font-medium text-muted-foreground">กำลังโหลดข้อมูลครัวเรือน...</p>
	</div>
{:else if !household}
	<div class="space-y-4 rounded-3xl border border-border bg-card py-16 text-center shadow-sm">
		<p class="text-base font-semibold text-destructive">ไม่พบข้อมูลครัวเรือนนี้ในระบบ</p>
		<button
			class="inline-flex cursor-pointer items-center justify-center rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted"
			onclick={() => goto(resolve('/back-office/evacuee-management?tab=household'))}
		>
			กลับหน้าหลัก
		</button>
	</div>
{:else}
	<div class="space-y-6">
		<!-- Header -->
		<HouseholdProfileHeaderCard
			{household}
			{statusConfig}
			onOpenStatusModal={() => (showStatusModal = true)}
			onOpenQrModal={() => (showQrModal = true)}
			onOpenZoneModal={() => (showZoneModal = true)}
		/>

		<!-- Grid Layout -->
		<div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
			<!-- Left column -->
			<div class="space-y-6 lg:col-span-6">
				<HouseholdProfileHeadCard
					{head}
					onOpenHeadModal={() => (showHeadModal = true)}
					onViewProfile={handleViewEvacueeProfile}
				/>
				<HouseholdProfileMembersCard
					{household}
					{members}
					onOpenMembersModal={() => (showMembersModal = true)}
					onRemoveMember={removeMemberFromHousehold}
					onViewProfile={handleViewEvacueeProfile}
				/>
			</div>

			<!-- Right column -->
			<div class="space-y-6 lg:col-span-6">
				<HouseholdProfileAddressCard
					{household}
					onOpenAddressModal={() => (showAddressModal = true)}
				/>
				<HouseholdProfileAssetsCard
					{household}
					onOpenAssetsModal={() => (showAssetsModal = true)}
				/>
			</div>
		</div>

		<!-- Audit log -->
		<div class="space-y-3 rounded-3xl border border-border bg-card p-6 shadow-sm">
			<div class="flex items-center gap-2.5 border-b border-border pb-2">
				<Clock class="size-4.5 text-primary" />
				<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">
					บันทึกการตรวจสอบ (Audit Log)
				</h3>
			</div>
			<ol class="space-y-2.5 text-xs text-slate-600 dark:text-slate-400">
				<li class="flex items-start gap-3">
					<span class="mt-0.5 text-sm">📝</span>
					<div class="flex-1 space-y-0.5">
						<div class="font-semibold text-foreground">ลงทะเบียนครัวเรือนสำเร็จ (Created)</div>
						<div class="text-muted-foreground">
							{formatDateTime(household.created_at)} · โดย {household.created_by || 'system'}
						</div>
					</div>
				</li>
				{#if household.updated_at && household.updated_at !== household.created_at}
					<li class="flex items-start gap-3">
						<span class="mt-0.5 text-sm">✏️</span>
						<div class="flex-1 space-y-0.5">
							<div class="font-semibold text-foreground">แก้ไขข้อมูลล่าสุด (Updated)</div>
							<div class="text-muted-foreground">{formatDateTime(household.updated_at)}</div>
						</div>
					</li>
				{/if}
			</ol>
		</div>
	</div>

	<!-- Modals -->
	{#if showAddressModal}
		<EvacueeAddressModal
			show={showAddressModal}
			{household}
			onClose={() => (showAddressModal = false)}
			onSave={saveAddress}
		/>
	{/if}

	{#if showAssetsModal}
		<EvacueeAssetsModal
			show={showAssetsModal}
			{household}
			onClose={() => (showAssetsModal = false)}
			onSave={saveAssets}
		/>
	{/if}

	{#if showQrModal}
		<HouseholdQrModal
			show={showQrModal}
			{household}
			selectedHead={head}
			allMembers={members}
			onClose={() => (showQrModal = false)}
		/>
	{/if}

	{#if showZoneModal && headOrFirstMember}
		<EvacueeZoneModal
			show={showZoneModal}
			evacuee={headOrFirstMember}
			{shelterZones}
			onClose={() => (showZoneModal = false)}
			onUpdateZone={updateHouseholdZone}
		/>
	{/if}

	{#if showStatusModal}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
		>
			<div
				class="w-full max-w-sm animate-in space-y-4 rounded-3xl border border-border bg-card p-6 shadow-xl duration-150 zoom-in-95 fade-in"
			>
				<div class="flex items-center justify-between border-b border-border pb-2.5">
					<h3 class="text-base font-bold text-slate-900 dark:text-slate-50">
						เปลี่ยนสถานะครอบครัว (Change Family Status)
					</h3>
					<button
						onclick={() => (showStatusModal = false)}
						class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
					>
						<X class="size-5" />
					</button>
				</div>

				<div class="grid grid-cols-1 gap-2 py-2">
					{#each Object.entries(statusConfig).filter(([key]) => key !== 'cancelled') as [key, config] (key)}
						<button
							type="button"
							class="flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-border p-3 text-left transition-colors hover:bg-slate-50 dark:hover:bg-slate-900"
							onclick={() => saveStatus(key as HouseholdStatus)}
						>
							<span class="h-3.5 w-3.5 rounded-full border {config.dotClass}"></span>
							<span class="text-sm font-semibold text-slate-800 dark:text-slate-200">
								{config.label}
							</span>
						</button>
					{/each}
				</div>

				<div class="flex justify-end gap-2 border-t border-border pt-4">
					<Button variant="outline" onclick={() => (showStatusModal = false)} class="w-full">
						ยกเลิก
					</Button>
				</div>
			</div>
		</div>
	{/if}

	{#if showHeadModal}
		<HouseholdHeadModal
			show={showHeadModal}
			{household}
			{members}
			onClose={() => (showHeadModal = false)}
			onSelectNewHead={selectNewHead}
		/>
	{/if}

	{#if showMembersModal}
		<HouseholdMembersModal
			show={showMembersModal}
			{household}
			{members}
			{allEvacuees}
			{allHouseholds}
			onClose={() => (showMembersModal = false)}
			onAddMember={addMemberToHousehold}
			onRemoveMember={removeMemberFromHousehold}
		/>
	{/if}
{/if}
