<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	import MapPin from '@lucide/svelte/icons/map-pin';
	import User from '@lucide/svelte/icons/user';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Stethoscope from '@lucide/svelte/icons/stethoscope';
	import Home from '@lucide/svelte/icons/home';
	import Car from '@lucide/svelte/icons/car';
	import Clock from '@lucide/svelte/icons/clock';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Printer from '@lucide/svelte/icons/printer';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import X from '@lucide/svelte/icons/x';
	import Plus from '@lucide/svelte/icons/plus';

	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Select from '$lib/components/ui/select/index.js';

	import {
		useEvacuees,
		useHouseholds,
		useMedicals,
		useScreenings,
		useUpdateEvacuee,
		useUpdateHousehold,
		SHELTER_CODE,
		maskNationalId,
		zoneLabel,
		SPECIAL_NEED_CHIPS,
		EWAR_SYMPTOM_GROUPS
	} from '$lib/features/people';
	import type { SpecialNeed, StayStatus, PetGroup } from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { now } from '$lib/db/model';

	let { evacueeId, readonly = false }: { evacueeId: string; readonly?: boolean } = $props();

	const statusConfig: Record<StayStatus, { label: string; colorClass: string; dotClass: string }> = {
		checked_in: {
			label: 'พักพิงในศูนย์ (Active)',
			colorClass: 'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800',
			dotClass: 'bg-green-500'
		},
		registered: {
			label: 'ลงทะเบียนแล้ว (Registered)',
			colorClass: 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
			dotClass: 'bg-blue-500'
		},
		checked_out: {
			label: 'ออกจากศูนย์แล้ว (Checked Out)',
			colorClass: 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 border-gray-200 dark:border-gray-700',
			dotClass: 'bg-gray-400'
		},
		transferred: {
			label: 'ส่งต่อแล้ว (Transferred)',
			colorClass: 'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800',
			dotClass: 'bg-purple-500'
		}
	};

	const evacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	const medicalsQuery = useMedicals();
	const screeningsQuery = useScreenings();
	const shelterQuery = useShelter(() => SHELTER_CODE);
	const updateEvacueeMutation = useUpdateEvacuee();
	const updateHouseholdMutation = useUpdateHousehold();

	const evacuee = $derived(evacueesQuery.data?.find((e) => e._id === evacueeId) ?? null);
	const household = $derived(
		evacuee && householdsQuery.data
			? (householdsQuery.data.find((h) => h._id === evacuee.household_id) ?? null)
			: null
	);
	const medical = $derived(
		evacuee && medicalsQuery.data
			? (medicalsQuery.data.find((m) => m.evacuee_id === evacuee._id) ?? null)
			: null
	);
	const screening = $derived(
		evacuee && screeningsQuery.data
			? (screeningsQuery.data.find((s) => s.evacuee_id === evacuee._id) ?? null)
			: null
	);
	const shelterName = $derived(shelterQuery.data?.name ?? 'ศูนย์พักพิงชั่วคราว');
	const shelterZones = $derived(shelterQuery.data?.zones ?? []);
	const statusInfo = $derived(
		evacuee ? (statusConfig[evacuee.current_stay.status] ?? statusConfig.registered) : null
	);
	const familyMembers = $derived(
		evacuee && evacuee.household_id && evacueesQuery.data
			? evacueesQuery.data.filter(
					(e) => e.household_id === evacuee.household_id && e._id !== evacuee._id
				)
			: []
	);
	const parsedAssets = $derived.by(() => {
		if (!household?.notes) return { vehicle: 'none', licensePlate: '', valuables: '' };
		try {
			if (household.notes.startsWith('{')) return JSON.parse(household.notes);
		} catch {}
		return { vehicle: 'none', licensePlate: '', valuables: household.notes };
	});

	const isLoading = $derived(
		evacueesQuery.isLoading ||
			householdsQuery.isLoading ||
			medicalsQuery.isLoading ||
			screeningsQuery.isLoading
	);

	// Modal state (only relevant when !readonly)
	let showZoneModal = $state(false);
	let showStatusModal = $state(false);
	let showQrModal = $state(false);
	let showAddressModal = $state(false);
	let showAssetModal = $state(false);

	// Address form state
	let addressNo = $state('');
	let villageNo = $state('');
	let subdistrict = $state('');
	let district = $state('');
	let province = $state('');
	let postalCode = $state('');

	// Asset form state
	let vehicleType = $state('none');
	let licensePlate = $state('');
	let valuables = $state('');
	let petsList = $state<PetGroup[]>([]);

	function openAddressModal() {
		addressNo = household?.address_no ?? '';
		villageNo = household?.village_no ?? '';
		subdistrict = household?.subdistrict ?? '';
		district = household?.district ?? '';
		province = household?.province ?? '';
		postalCode = household?.postal_code ?? '';
		showAddressModal = true;
	}

	function openAssetModal() {
		let notesObj = { vehicle: 'none', licensePlate: '', valuables: '', notes: '' };
		try {
			if (household?.notes?.startsWith('{')) {
				notesObj = JSON.parse(household.notes);
			} else {
				notesObj.notes = household?.notes || '';
			}
		} catch {
			notesObj.notes = household?.notes || '';
		}
		vehicleType = notesObj.vehicle || 'none';
		licensePlate = notesObj.licensePlate || '';
		valuables = notesObj.valuables || notesObj.notes;
		petsList = household?.pets ? JSON.parse(JSON.stringify(household.pets)) : [];
		showAssetModal = true;
	}

	async function updateZone(zoneCode: string) {
		if (!evacuee) return;
		try {
			await updateEvacueeMutation.mutateAsync({
				...evacuee,
				current_stay: { ...evacuee.current_stay, zone: zoneCode, since: now() }
			});
			toast.success(`ย้ายโซนเป็น ${zoneCode.toUpperCase()} เรียบร้อย`);
			showZoneModal = false;
		} catch (err: any) {
			toast.error(`ไม่สามารถย้ายโซนได้: ${err.message || err}`);
		}
	}

	async function updateStatus(status: StayStatus) {
		if (!evacuee) return;
		try {
			await updateEvacueeMutation.mutateAsync({
				...evacuee,
				current_stay: { ...evacuee.current_stay, status, since: now() }
			});
			toast.success('อัปเดตสถานะการพักพิงเรียบร้อย');
			showStatusModal = false;
		} catch (err: any) {
			toast.error(`ไม่สามารถอัปเดตสถานะได้: ${err.message || err}`);
		}
	}

	async function saveAddress() {
		if (!household) {
			toast.error('ไม่พบข้อมูลครัวเรือนสำหรับบันทึกที่อยู่');
			return;
		}
		try {
			await updateHouseholdMutation.mutateAsync({
				...household,
				address_no: addressNo || null,
				village_no: villageNo || null,
				subdistrict: subdistrict || null,
				district: district || null,
				province: province || null,
				postal_code: postalCode || null
			});
			toast.success('แก้ไขที่อยู่ครัวเรือนสำเร็จ');
			showAddressModal = false;
		} catch (err: any) {
			toast.error(`ไม่สามารถบันทึกที่อยู่ได้: ${err.message || err}`);
		}
	}

	async function saveAssets() {
		if (!household) {
			toast.error('ไม่พบข้อมูลครัวเรือนสำหรับบันทึกทรัพย์สิน');
			return;
		}
		try {
			await updateHouseholdMutation.mutateAsync({
				...household,
				notes: JSON.stringify({
					vehicle: vehicleType,
					licensePlate: vehicleType !== 'none' ? licensePlate : '',
					valuables
				}),
				pets: petsList.filter((p) => p.count > 0)
			});
			toast.success('แก้ไขข้อมูลทรัพย์สินและสัตว์เลี้ยงสำเร็จ');
			showAssetModal = false;
		} catch (err: any) {
			toast.error(`ไม่สามารถบันทึกข้อมูลได้: ${err.message || err}`);
		}
	}

	function addPetRow() {
		petsList = [...petsList, { species: 'dog', count: 1, notes: '' }];
	}
	function removePetRow(index: number) {
		petsList = petsList.filter((_, i) => i !== index);
	}

	function getSymptomLabel(id: string): string {
		for (const g of EWAR_SYMPTOM_GROUPS) {
			const s = g.symptoms.find((sym) => sym.id === id);
			if (s) return s.label;
		}
		return id;
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
		<p class="text-sm font-medium text-muted-foreground">กำลังโหลดข้อมูลผู้พักพิง...</p>
	</div>
{:else if !evacuee}
	<div
		class="space-y-4 rounded-3xl border border-border bg-card py-16 text-center shadow-sm"
	>
		<p class="text-base font-semibold text-destructive">ไม่พบข้อมูลผู้พักพิงในระบบ</p>
		<button
			class="inline-flex cursor-pointer items-center justify-center rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted"
			onclick={() => goto(resolve('/back-office/evacuee-management'))}
		>
			กลับหน้าหลัก
		</button>
	</div>
{:else}
	<div class="space-y-6">
		<!-- Profile Header Card -->
		<div
			class="flex flex-col items-start justify-between gap-6 rounded-3xl border border-border bg-card p-6 shadow-sm md:flex-row md:items-center"
		>
			<div class="flex flex-wrap items-center gap-4">
				<div
					class="flex h-20 w-20 shrink-0 select-none flex-col items-center justify-center rounded-2xl border border-slate-200 bg-slate-100 text-[10px] font-semibold text-slate-400 shadow-inner dark:border-slate-700 dark:bg-slate-800"
				>
					<span>No Photo</span>
				</div>

				<div class="space-y-1">
					<h2 class="text-2xl font-bold text-slate-900 dark:text-slate-50">
						{evacuee.first_name}
						{evacuee.last_name}
					</h2>
					<p
						class="inline-block rounded-md bg-muted px-2 py-0.5 font-mono text-xs tracking-wider text-muted-foreground"
					>
						NATIONAL ID: {evacuee.person_id?.number || '—'}
					</p>

					<div class="mt-2 flex flex-wrap items-center gap-2">
						{#if (medical && (medical.conditions.length > 0 || medical.notes)) || (screening && screening.symptoms.length > 0) || medical?.track === 'fast_track'}
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-red-100 bg-red-50 px-2.5 py-0.5 text-xs font-semibold text-red-600 dark:border-red-900/30 dark:bg-red-950/40 dark:text-red-400"
							>
								<span class="size-1.5 rounded-full bg-red-500"></span>
								มีอาการป่วย/เฝ้าระวัง
							</span>
						{/if}
						{#if evacuee.special_needs && evacuee.special_needs.length > 0}
							<span
								class="inline-flex items-center gap-1.5 rounded-full border border-amber-100 bg-amber-50 px-2.5 py-0.5 text-xs font-semibold text-amber-600 dark:border-amber-900/30 dark:bg-amber-950/40 dark:text-amber-400"
							>
								<span class="size-1.5 rounded-full bg-amber-500"></span>
								กลุ่มเปราะบาง
							</span>
						{/if}
					</div>
				</div>
			</div>

			<div
				class="flex w-full flex-wrap items-center gap-3 border-t border-border pt-4 md:w-auto md:shrink-0 md:border-none md:pt-0"
			>
				{#if !readonly}
					<button
						class="inline-flex cursor-pointer items-center justify-center rounded-xl border border-amber-400 bg-transparent px-4 py-2 text-sm font-semibold text-amber-700 transition-colors hover:bg-amber-50 dark:text-amber-400 dark:hover:bg-amber-950/30"
						onclick={() => (showZoneModal = true)}
					>
						ย้ายโซน (Change Zone)
					</button>

					<button
						class="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold shadow-sm transition-all hover:brightness-95 {statusInfo?.colorClass}"
						onclick={() => (showStatusModal = true)}
					>
						<span class="size-1.5 rounded-full {statusInfo?.dotClass}"></span>
						<span>{statusInfo?.label}</span>
						<Pencil class="ml-0.5 size-3.5 opacity-60" />
					</button>

					<button
						class="inline-flex cursor-pointer items-center justify-center gap-2 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-muted dark:text-slate-200"
						onclick={() => (showQrModal = true)}
					>
						<Printer class="size-4 opacity-75" />
						<span>พิมพ์ QR</span>
					</button>
				{:else}
					<span
						class="inline-flex items-center gap-1.5 rounded-xl border px-3 py-2 text-sm font-semibold {statusInfo?.colorClass}"
					>
						<span class="size-1.5 rounded-full {statusInfo?.dotClass}"></span>
						<span>{statusInfo?.label}</span>
					</span>

					<button
						class="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold text-slate-800 shadow-sm transition-colors hover:bg-muted dark:text-slate-200"
						onclick={() =>
							goto(resolve(`/back-office/evacuee-management/edit/-evacuee/${evacuee._id}`))}
					>
						<ExternalLink class="size-4 opacity-75" />
						<span>ดูข้อมูลเต็ม / แก้ไข</span>
					</button>
				{/if}
			</div>
		</div>

		<!-- Two-column body -->
		<div class="grid grid-cols-1 items-start gap-6 lg:grid-cols-12">
			<!-- Left column -->
			<div class="space-y-6 lg:col-span-5">
				<!-- Card: Zone & Shelter -->
				<div class="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-sm">
					<div class="flex items-center gap-2.5 border-b border-border pb-2">
						<MapPin class="size-4.5 text-primary" />
						<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">
							พิกัดโซนและศูนย์พักพิง
						</h3>
					</div>
					<div class="space-y-3.5">
						<div>
							<span class="block text-xs font-medium text-muted-foreground">ศูนย์อพยพ:</span>
							<span class="mt-0.5 block text-sm font-bold text-slate-800 dark:text-slate-200">
								{shelterName}
							</span>
						</div>
						<div class="grid grid-cols-2 gap-4">
							<div>
								<span class="block text-xs font-medium text-muted-foreground">โซนพักอาศัย:</span>
								<span
									class="mt-1 inline-block rounded-lg border border-blue-100 bg-blue-50 px-3 py-1 text-xs font-bold text-blue-600 dark:border-blue-900/30 dark:bg-blue-950/40 dark:text-blue-400"
								>
									Zone: {zoneLabel(evacuee.current_stay.zone)}
								</span>
							</div>
							<div>
								<span class="block text-xs font-medium text-muted-foreground"
									>หมายเลขเตียง/จุดพัก:</span
								>
								<span class="mt-1 block text-sm font-semibold text-slate-800 dark:text-slate-200">
									-
								</span>
							</div>
						</div>
					</div>
				</div>

				<!-- Card: Personal Details -->
				<div class="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-sm">
					<div class="flex items-center gap-2.5 border-b border-border pb-2">
						<User class="size-4.5 text-primary" />
						<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">ข้อมูลส่วนบุคคล</h3>
					</div>
					<div class="grid grid-cols-2 gap-x-2 gap-y-4">
						<div>
							<span class="block text-xs font-medium text-muted-foreground">เพศ</span>
							<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
								{evacuee.gender === 'male'
									? 'Male'
									: evacuee.gender === 'female'
										? 'Female'
										: 'Other'}
							</span>
						</div>
						<div>
							<span class="block text-xs font-medium text-muted-foreground">อายุ</span>
							<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
								{evacuee.birth_year
									? `${new Date().getFullYear() + 543 - evacuee.birth_year} ปี`
									: 'ไม่ระบุ'}
							</span>
						</div>
						<div>
							<span class="block text-xs font-medium text-muted-foreground">สัญชาติ</span>
							<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
								{evacuee.country === 'THAILAND' ? 'ไทย' : evacuee.country}
							</span>
						</div>
						<div>
							<span class="block text-xs font-medium text-muted-foreground">ศาสนา</span>
							<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
								{evacuee.religion === 'buddhist'
									? 'พุทธ'
									: evacuee.religion === 'muslim'
										? 'อิสลาม'
										: evacuee.religion === 'christian'
											? 'คริสต์'
											: 'ไม่ระบุ'}
							</span>
						</div>
						<div class="col-span-2 border-t border-border/50 pt-3">
							<span class="block text-xs font-medium text-muted-foreground">เบอร์โทรศัพท์</span>
							<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
								{evacuee.phone || 'ไม่มีเบอร์ติดต่อ'}
							</span>
						</div>
					</div>
				</div>

				<!-- Card: Emergency Contact -->
				<div
					class="space-y-4 rounded-3xl border border-amber-100 bg-amber-50/40 p-6 shadow-sm dark:border-amber-900/30 dark:bg-amber-950/10"
				>
					<div
						class="flex items-center gap-2.5 border-b border-amber-200/50 pb-2 dark:border-amber-900/20"
					>
						<ShieldAlert class="size-4.5 text-amber-600 dark:text-amber-500" />
						<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">ข้อมูลติดต่อฉุกเฉิน</h3>
					</div>
					<div class="space-y-3.5">
						<div>
							<span class="block text-xs font-medium text-muted-foreground">ญาติ / ผู้ติดต่อ:</span>
							<span class="mt-0.5 block text-sm font-bold text-slate-800 dark:text-slate-200">
								{evacuee.emergency_contact?.name || 'ไม่ระบุบุคคล'}
							</span>
						</div>
						<div>
							<span class="block text-xs font-medium text-muted-foreground"
								>เบอร์โทรศัพท์ฉุกเฉิน:</span
							>
							<span
								class="mt-0.5 block text-sm font-bold {evacuee.emergency_contact?.phone
									? 'text-slate-800 dark:text-slate-200'
									: 'font-semibold text-red-500 dark:text-red-400'}"
							>
								{evacuee.emergency_contact?.phone || 'ไม่ระบุ'}
							</span>
						</div>
					</div>
				</div>
			</div>

			<!-- Right column -->
			<div class="space-y-6 lg:col-span-7">
				<!-- Card: Health & Vulnerability -->
				<div
					class="overflow-hidden rounded-3xl border border-red-100 bg-card shadow-sm dark:border-red-950/50"
				>
					<div
						class="flex items-center gap-2.5 border-b border-red-100/50 bg-red-50/60 p-4 px-6 dark:border-red-950/30 dark:bg-red-950/20"
					>
						<Stethoscope class="size-5 text-red-600 dark:text-red-500" />
						<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">
							ข้อมูลสุขภาพ และ ความเปราะบาง (Health &amp; Vulnerability)
						</h3>
					</div>

					<div class="grid grid-cols-1 gap-6 p-6 md:grid-cols-12">
						<div class="space-y-4 md:col-span-7">
							<div>
								<span class="block text-xs font-semibold text-red-600 dark:text-red-400"
									>อาการป่วยแรกรับ:</span
								>
								<div
									class="mt-1.5 rounded-2xl border border-slate-100 bg-slate-50 p-3 text-sm font-semibold text-slate-800 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-200"
								>
									{#if screening && screening.symptoms.length > 0}
										<div class="flex flex-col gap-1">
											{#each screening.symptoms as sym (sym)}
												<span>• {getSymptomLabel(sym)}</span>
											{/each}
										</div>
									{:else if medical && medical.conditions.length > 0}
										<div class="flex flex-col gap-1">
											{#each medical.conditions as cond (cond)}
												<span>• {cond}</span>
											{/each}
										</div>
									{:else}
										<span class="font-normal text-muted-foreground">ไม่มีอาการป่วยแรกรับ</span>
									{/if}
								</div>
							</div>

							<div class="grid grid-cols-2 gap-4">
								<div>
									<span class="block text-xs font-medium text-muted-foreground">โรคประจำตัว:</span>
									<span
										class="mt-1 block text-sm font-bold text-slate-800 dark:text-slate-200"
									>
										{medical?.conditions?.join(', ') || 'ไม่มี'}
									</span>
								</div>
								<div>
									<span class="block text-xs font-medium text-muted-foreground"
										>ความเสี่ยงแพร่เชื้อ:</span
									>
									{#if (screening && screening.symptoms.includes('acute_respiratory')) || medical?.notes?.includes('กักโรค') || medical?.notes?.includes('แพร่เชื้อ')}
										<span
											class="mt-1.5 inline-block rounded-full border border-red-200 bg-red-100 px-2.5 py-0.5 text-[10px] font-bold text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-400"
										>
											ควรแยกกักโรค
										</span>
									{:else}
										<span class="mt-1 block text-sm font-semibold text-slate-500">ไม่มีความเสี่ยง</span>
									{/if}
								</div>
							</div>

							<div class="grid grid-cols-2 gap-4 border-t border-border/40 pt-3">
								<div>
									<span class="block text-xs font-medium text-muted-foreground">แพ้ยา:</span>
									<span
										class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200"
									>
										{#if medical && medical.medications && medical.medications.length > 0}
											{medical.medications.join(', ')}
										{:else}
											ไม่ระบุประวัติ
										{/if}
									</span>
								</div>
								<div>
									<span class="block text-xs font-medium text-muted-foreground">แพ้อาหาร:</span>
									<span
										class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200"
									>
										{#if medical && medical.allergies && medical.allergies.length > 0}
											{medical.allergies.join(', ')}
										{:else}
											ไม่ระบุประวัติ
										{/if}
									</span>
								</div>
							</div>

							<div class="border-t border-border/40 pt-3">
								<span class="block text-xs font-medium text-muted-foreground"
									>บันทึกของพยาบาล:</span
								>
								<div
									class="mt-1.5 rounded-2xl border border-blue-100/50 bg-blue-50/50 p-3 text-xs font-semibold text-blue-800 dark:border-blue-900/20 dark:bg-blue-950/20 dark:text-blue-300"
								>
									{medical?.notes || screening?.notes || 'ไม่มีบันทึกทางพยาบาล'}
								</div>
							</div>
						</div>

						<div
							class="space-y-4 border-t pt-4 md:col-span-5 md:border-l md:border-t-0 md:pl-6 md:pt-0"
						>
							<div>
								<span class="block text-xs font-medium text-muted-foreground">กลุ่มเปราะบาง:</span>
								<div class="mt-2 flex flex-wrap gap-1.5">
									{#if evacuee.special_needs && evacuee.special_needs.length > 0}
										{#each evacuee.special_needs as need (need)}
											{@const chip = SPECIAL_NEED_CHIPS[need as SpecialNeed]}
											<span
												class="inline-flex items-center gap-1 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-800 dark:bg-amber-950 dark:text-amber-300"
											>
												<span>{chip.emoji}</span>
												<span>{chip.label}</span>
											</span>
										{/each}
									{:else}
										<span class="text-xs italic text-muted-foreground"
											>ทั่วไป (ไม่มีความเปราะบาง)</span
										>
									{/if}
								</div>
							</div>

							<div class="border-t border-border/40 pt-3">
								<span class="block text-xs font-medium text-muted-foreground"
									>ความต้องการพิเศษ/ข้อแนะนำ:</span
								>
								<div
									class="mt-1.5 rounded-2xl border border-slate-100 bg-slate-50 p-3 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
								>
									{#if evacuee.special_needs.includes('disabled')}
										ต้องการรถเข็น, เครื่องช่วยฟัง
									{:else if medical?.notes?.includes('ต้องการ')}
										{medical.notes}
									{:else}
										ไม่มีข้อแนะนำพิเศษ
									{/if}
								</div>
							</div>

							{#if screening?.needs_referral}
								<div class="pt-2">
									<span
										class="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-bold text-amber-700 dark:border-amber-900 dark:bg-amber-950 dark:text-amber-400"
									>
										🚨 สถานะส่งต่อ: Requested
									</span>
								</div>
							{/if}
						</div>
					</div>
				</div>

				<!-- Card: Household -->
				<div class="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-sm">
					<div class="flex items-center justify-between border-b border-border pb-2">
						<div class="flex items-center gap-2.5">
							<Home class="size-4.5 text-primary" />
							<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">
								หัวหน้าครอบครัว (Head of Household)
							</h3>
						</div>
					</div>

					<div class="space-y-4">
						<div class="flex items-center justify-between">
							<span class="text-xs font-medium text-muted-foreground">สถานะในครอบครัว:</span>
							{#if household && household.head_evacuee_id === evacuee._id}
								<span
									class="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-bold text-blue-700 dark:bg-blue-950 dark:text-blue-300"
								>
									⭐ หัวหน้าครอบครัว
								</span>
							{:else}
								<span
									class="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-bold text-slate-600 dark:bg-slate-800 dark:text-slate-400"
								>
									สมาชิกครอบครัว
								</span>
							{/if}
						</div>

						<div>
							<span class="block text-xs font-medium text-muted-foreground"
								>รายชื่อสมาชิกร่วมทาง:</span
							>
							<div
								class="mt-1.5 rounded-2xl border border-dashed border-slate-200 p-3 text-center dark:border-slate-800"
							>
								{#if familyMembers.length > 0}
									<div class="flex flex-wrap justify-center gap-1.5">
										{#each familyMembers as m (m._id)}
											<button
												onclick={() =>
													goto(
														resolve(
															`/back-office/evacuee-management/edit/-evacuee/${m._id}`
														)
													)}
												class="cursor-pointer rounded border border-slate-200 bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-slate-200 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
											>
												{m.first_name}
												{m.last_name}
											</button>
										{/each}
									</div>
								{:else}
									<span class="text-xs italic text-muted-foreground">
										เดินทางคนเดียว / ไม่ได้ระบุสมาชิกในกลุ่ม
									</span>
								{/if}
							</div>
						</div>

						<div class="space-y-2 border-t border-border/40 pt-3">
							<div class="flex items-center justify-between">
								<span class="text-xs font-medium text-muted-foreground">ที่อยู่ครอบครัว:</span>
								{#if household && !readonly}
									<button
										onclick={openAddressModal}
										class="inline-flex cursor-pointer items-center gap-1 text-xs font-semibold text-blue-600 hover:underline dark:text-blue-400"
									>
										✏️ แก้ไขที่อยู่ครอบครัว
									</button>
								{/if}
							</div>
							<div
								class="rounded-2xl border border-slate-100 bg-slate-50 p-3 text-xs font-medium text-slate-700 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300"
							>
								{#if household && (household.address_no || household.subdistrict || household.district || household.province)}
									{household.address_no || ''}
									{household.village_no ? `หมู่ที่ ${household.village_no}` : ''}
									{household.subdistrict ? `ต.${household.subdistrict}` : ''}
									{household.district ? `อ.${household.district}` : ''}
									{household.province ? `จ.${household.province}` : ''}
									{household.postal_code || ''}
								{:else}
									<span class="italic text-muted-foreground">ไม่มีที่อยู่จัดเก็บ</span>
								{/if}
							</div>
						</div>
					</div>
				</div>

				<!-- Card: Assets / Pets -->
				<div class="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-sm">
					<div class="flex items-center justify-between border-b border-border pb-2">
						<div class="flex items-center gap-2.5">
							<Car class="size-4.5 text-primary" />
							<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">
								ทรัพย์สิน ยานพาหนะ และสัตว์เลี้ยง
							</h3>
						</div>
						{#if household && !readonly}
							<button
								onclick={openAssetModal}
								class="cursor-pointer text-muted-foreground transition-colors hover:text-foreground"
							>
								<Pencil class="size-4" />
							</button>
						{/if}
					</div>

					<div class="grid grid-cols-1 items-stretch gap-6 md:grid-cols-3">
						<div class="flex flex-col justify-between space-y-1.5">
							<span class="text-xs font-semibold text-muted-foreground">ยานพาหนะ:</span>
							<div
								class="flex min-h-[70px] flex-1 flex-col justify-center gap-1.5 rounded-2xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900"
							>
								{#if parsedAssets.vehicle && parsedAssets.vehicle !== 'none'}
									<span class="text-xs font-bold text-slate-700 dark:text-slate-300">
										🚗 {parsedAssets.vehicle === 'car'
											? 'รถยนต์'
											: parsedAssets.vehicle === 'motorcycle'
												? 'จักรยานยนต์'
												: 'อื่นๆ'}
									</span>
									{#if parsedAssets.licensePlate}
										<span class="text-xs font-bold text-slate-900 dark:text-slate-100">
											ทะเบียน: {parsedAssets.licensePlate}
										</span>
									{/if}
								{:else}
									<span class="text-xs italic text-muted-foreground">ไม่มี</span>
								{/if}
							</div>
						</div>

						<div class="flex flex-col justify-between space-y-1.5">
							<span class="text-xs font-semibold text-muted-foreground">สัมภาระ/สิ่งของมีค่า:</span>
							<div
								class="flex min-h-[70px] flex-1 items-center rounded-2xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900"
							>
								{#if parsedAssets.valuables}
									<span class="text-xs font-medium italic text-slate-600 dark:text-slate-400">
										{parsedAssets.valuables}
									</span>
								{:else}
									<span class="text-xs italic text-muted-foreground">ไม่มี</span>
								{/if}
							</div>
						</div>

						<div class="flex flex-col justify-between space-y-1.5">
							<span class="text-xs font-semibold text-muted-foreground">สัตว์เลี้ยง:</span>
							<div class="flex min-h-[70px] flex-1 flex-col justify-center gap-1.5">
								{#if household && household.pets && household.pets.length > 0}
									{#each household.pets as pet (pet.species)}
										{@const petEmoji =
											pet.species === 'dog'
												? '🐶'
												: pet.species === 'cat'
													? '🐱'
													: pet.species === 'bird'
														? '🐦'
														: '🐾'}
										{@const speciesLabel =
											pet.species === 'dog'
												? 'สุนัข'
												: pet.species === 'cat'
													? 'แมว'
													: pet.species === 'bird'
														? 'นก'
														: 'อื่นๆ'}
										<div
											class="flex flex-col gap-1 rounded-2xl border border-amber-100 bg-amber-50/50 p-2.5 dark:border-amber-900/30 dark:bg-amber-950/20"
										>
											<div
												class="flex items-center justify-between text-[11px] font-bold text-amber-800 dark:text-amber-400"
											>
												<span>{petEmoji} {speciesLabel}</span>
												<span
													class="rounded bg-amber-100 px-1.5 py-0.5 text-[9px] dark:bg-amber-950"
												>
													{pet.count} ตัว
												</span>
											</div>
											{#if pet.notes}
												<span
													class="mt-0.5 flex items-center gap-0.5 text-[9px] font-bold text-green-700 dark:text-green-400"
													>✓ {pet.notes}</span
												>
											{/if}
										</div>
									{/each}
								{:else}
									<div
										class="flex flex-1 items-center justify-center rounded-2xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900"
									>
										<span class="text-xs italic text-muted-foreground">ไม่มี</span>
									</div>
								{/if}
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>

		<!-- Footer: Audit Log -->
		<div
			class="flex flex-wrap items-center gap-6 border-t border-border pt-6 text-xs font-medium text-muted-foreground"
		>
			<div class="flex items-center gap-1.5">
				<Clock class="size-4 opacity-75" />
				<span>ประวัติการอัปเดตข้อมูล (Audit Log)</span>
			</div>
			<div class="flex flex-wrap gap-x-6 gap-y-2">
				<span>
					ลงทะเบียนเมื่อ:
					<strong class="font-semibold text-foreground">{formatDateTime(evacuee.created_at)}</strong>
					โดย {evacuee.created_by || 'system'}
				</span>
				{#if evacuee.updated_at && evacuee.updated_at !== evacuee.created_at}
					<span>
						แก้ไขล่าสุดเมื่อ:
						<strong class="font-semibold text-foreground">{formatDateTime(evacuee.updated_at)}</strong>
					</span>
				{/if}
			</div>
		</div>
	</div>
{/if}

<!-- Modals (edit mode only) -->
{#if !readonly && evacuee}
	<!-- Modal 1: Change Zone -->
	{#if showZoneModal}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
		>
			<div
				class="w-full max-w-md animate-in space-y-4 rounded-3xl border border-border bg-card p-6 shadow-xl fade-in zoom-in-95 duration-150"
			>
				<div class="flex items-center justify-between border-b border-border pb-2.5">
					<h3 class="text-lg font-bold text-slate-900 dark:text-slate-50">
						ย้ายโซนที่พัก (Change stay zone)
					</h3>
					<button
						onclick={() => (showZoneModal = false)}
						class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
					>
						<X class="size-5" />
					</button>
				</div>

				<div class="max-h-[300px] space-y-2 overflow-y-auto pr-1">
					{#if shelterZones.length === 0}
						<p class="py-4 text-center text-sm text-muted-foreground">ไม่พบรายการโซนในระบบ</p>
					{:else}
						{#each shelterZones as zone (zone.code)}
							<button
								onclick={() => updateZone(zone.code)}
								class="group flex w-full cursor-pointer items-center justify-between rounded-xl border border-border p-3.5 font-semibold transition-all hover:border-primary hover:bg-slate-50 dark:hover:bg-slate-900 {evacuee.current_stay.zone === zone.code
									? 'border-primary bg-primary/5 text-primary'
									: 'bg-background'}"
							>
								<div class="flex flex-col">
									<span class="text-sm">{zone.name || zone.code}</span>
									<span class="mt-0.5 text-[10px] font-normal text-muted-foreground"
										>Code: {zone.code.toUpperCase()}
										{zone.type ? `| Type: ${zone.type}` : ''}</span
									>
								</div>
								{#if evacuee.current_stay.zone === zone.code}
									<CheckCircle class="size-5 shrink-0 text-primary" />
								{/if}
							</button>
						{/each}
					{/if}
				</div>

				<div class="flex justify-end gap-2 border-t border-border pt-3">
					<button
						onclick={() => (showZoneModal = false)}
						class="cursor-pointer rounded-xl border border-border bg-background px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-muted dark:text-slate-200"
					>
						ยกเลิก
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Modal 2: Stay Status -->
	{#if showStatusModal}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
		>
			<div
				class="w-full max-w-md animate-in space-y-4 rounded-3xl border border-border bg-card p-6 shadow-xl fade-in zoom-in-95 duration-150"
			>
				<div class="flex items-center justify-between border-b border-border pb-2.5">
					<h3 class="text-lg font-bold text-slate-900 dark:text-slate-50">
						แก้ไขสถานะการพักพิง (Stay status)
					</h3>
					<button
						onclick={() => (showStatusModal = false)}
						class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
					>
						<X class="size-5" />
					</button>
				</div>

				<div class="space-y-2">
					{#each Object.entries(statusConfig) as [statusKey, cfg] (statusKey)}
						<button
							onclick={() => updateStatus(statusKey as StayStatus)}
							class="flex w-full cursor-pointer items-center justify-between rounded-xl border border-border p-3.5 font-semibold transition-all hover:border-primary hover:bg-slate-50 dark:hover:bg-slate-900 {evacuee.current_stay.status === statusKey
								? 'border-primary bg-primary/5 text-primary'
								: 'bg-background'}"
						>
							<div class="flex items-center gap-2">
								<span class="size-2 rounded-full {cfg.dotClass}"></span>
								<span class="text-sm">{cfg.label}</span>
							</div>
							{#if evacuee.current_stay.status === statusKey}
								<CheckCircle class="size-5 shrink-0 text-primary" />
							{/if}
						</button>
					{/each}
				</div>

				<div class="flex justify-end gap-2 border-t border-border pt-3">
					<button
						onclick={() => (showStatusModal = false)}
						class="cursor-pointer rounded-xl border border-border bg-background px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-muted dark:text-slate-200"
					>
						ยกเลิก
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Modal 3: Print QR Card -->
	{#if showQrModal}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-xs"
		>
			<div
				class="w-full max-w-sm animate-in space-y-6 rounded-3xl border border-border bg-card p-6 text-center shadow-xl fade-in zoom-in-95 duration-150"
			>
				<div class="flex justify-end">
					<button
						onclick={() => (showQrModal = false)}
						class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
					>
						<X class="size-5" />
					</button>
				</div>

				<div
					id="qr-identity-card"
					class="mx-auto max-w-[280px] space-y-4 rounded-2xl border-2 border-slate-900 bg-white p-6 text-slate-900 shadow-md dark:border-slate-100"
				>
					<div class="border-b-2 border-slate-900 pb-2">
						<h4 class="text-xs font-bold uppercase tracking-widest text-slate-500">
							Smart Shelter ID Card
						</h4>
						<h3 class="mt-0.5 text-base font-bold">บัตรประจำตัวผู้ประสบภัย</h3>
					</div>
					<div
						class="mx-auto flex h-40 w-40 flex-col items-center justify-center space-y-2 rounded-lg border border-slate-200 bg-slate-100 p-2"
					>
						<svg
							xmlns="http://www.w3.org/2000/svg"
							class="size-28"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="1.5"
							stroke-linecap="round"
							stroke-linejoin="round"
							><rect width="5" height="5" x="3" y="3" rx="1" /><rect
								width="5"
								height="5"
								x="16"
								y="3"
								rx="1"
							/><rect width="5" height="5" x="3" y="16" rx="1" /><path
								d="M21 16V21H16"
							/><path d="M21 16H16" /><path d="M9 3H13" /><path d="M21 9V13" /><path
								d="M9 21H13"
							/><path d="M3 9V13" /></svg
						>
						<span class="font-mono text-[9px] tracking-wider text-slate-500"
							>ID: {evacuee._id.split(':')[1] || evacuee._id}</span
						>
					</div>
					<div class="space-y-1 text-center">
						<h3 class="text-base font-bold text-slate-900">
							{evacuee.first_name}
							{evacuee.last_name}
						</h3>
						<p class="font-mono text-[10px] text-slate-500">
							ID CARD: {maskNationalId(evacuee.person_id?.number)}
						</p>
						{#if evacuee.current_stay.zone}
							<div
								class="mt-1.5 inline-block rounded bg-slate-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white"
							>
								Zone: {evacuee.current_stay.zone.toUpperCase()}
							</div>
						{/if}
					</div>
				</div>

				<div class="flex justify-center gap-2 border-t border-border pt-4">
					<button
						onclick={() => window.print()}
						class="flex cursor-pointer items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90"
					>
						<Printer class="size-4" />
						<span>สั่งพิมพ์บัตร</span>
					</button>
					<button
						onclick={() => (showQrModal = false)}
						class="cursor-pointer rounded-xl border border-border bg-background px-4 py-2 text-xs font-semibold text-slate-800 transition-colors hover:bg-muted dark:text-slate-200"
					>
						ปิดหน้าต่าง
					</button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Modal 4: Edit Family Address -->
	{#if showAddressModal && household}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
		>
			<div
				class="w-full max-w-lg animate-in space-y-4 rounded-3xl border border-border bg-card p-6 shadow-xl fade-in zoom-in-95 duration-150"
			>
				<div class="flex items-center justify-between border-b border-border pb-2.5">
					<h3 class="text-lg font-bold text-slate-900 dark:text-slate-50">
						แก้ไขที่อยู่ครอบครัว (Family Address)
					</h3>
					<button
						onclick={() => (showAddressModal = false)}
						class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
					>
						<X class="size-5" />
					</button>
				</div>

				<div class="grid grid-cols-2 gap-4">
					<div class="space-y-1.5">
						<Label for="address_no">บ้านเลขที่</Label>
						<Input id="address_no" bind:value={addressNo} placeholder="เช่น 123/45" />
					</div>
					<div class="space-y-1.5">
						<Label for="village_no">หมู่ที่</Label>
						<Input id="village_no" bind:value={villageNo} placeholder="เช่น หมู่ 2" />
					</div>
					<div class="space-y-1.5">
						<Label for="subdistrict">ตำบล / แขวง</Label>
						<Input id="subdistrict" bind:value={subdistrict} placeholder="เช่น คลองเรียน" />
					</div>
					<div class="space-y-1.5">
						<Label for="district">อำเภอ / เขต</Label>
						<Input id="district" bind:value={district} placeholder="เช่น หาดใหญ่" />
					</div>
					<div class="space-y-1.5">
						<Label for="province">จังหวัด</Label>
						<Input id="province" bind:value={province} placeholder="เช่น สงขลา" />
					</div>
					<div class="space-y-1.5">
						<Label for="postal_code">รหัสไปรษณีย์</Label>
						<Input id="postal_code" bind:value={postalCode} placeholder="เช่น 90110" />
					</div>
				</div>

				<div class="flex justify-end gap-2 border-t border-border pt-4">
					<Button variant="outline" onclick={() => (showAddressModal = false)}>ยกเลิก</Button>
					<Button onclick={saveAddress}>บันทึกข้อมูล</Button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Modal 5: Edit Assets / Pets -->
	{#if showAssetModal && household}
		<div
			class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-xs"
		>
			<div
				class="w-full max-w-xl animate-in space-y-4 rounded-3xl border border-border bg-card p-6 shadow-xl fade-in zoom-in-95 duration-150"
			>
				<div class="flex items-center justify-between border-b border-border pb-2.5">
					<h3 class="text-lg font-bold text-slate-900 dark:text-slate-50">
						แก้ไขทรัพย์สินและสัตว์เลี้ยง (Assets &amp; Pets)
					</h3>
					<button
						onclick={() => (showAssetModal = false)}
						class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:text-foreground"
					>
						<X class="size-5" />
					</button>
				</div>

				<div class="max-h-[400px] space-y-4 overflow-y-auto pr-1">
					<div class="space-y-2 border-b border-border/50 pb-4">
						<h4 class="text-sm font-bold text-slate-800 dark:text-slate-200">ข้อมูลยานพาหนะ</h4>
						<div class="grid grid-cols-2 gap-4">
							<div class="space-y-1.5">
								<Label for="vehicle_type">ประเภทยานพาหนะ</Label>
								<Select.Root type="single" bind:value={vehicleType}>
									<Select.Trigger id="vehicle_type" class="h-9 w-full">
										{{ none: 'ไม่มี', car: 'รถยนต์', motorcycle: 'รถจักรยานยนต์', other: 'อื่นๆ' }[
											vehicleType
										] ?? '— เลือก —'}
									</Select.Trigger>
									<Select.Content>
										<Select.Item value="none" label="ไม่มี" />
										<Select.Item value="car" label="รถยนต์" />
										<Select.Item value="motorcycle" label="รถจักรยานยนต์" />
										<Select.Item value="other" label="อื่นๆ" />
									</Select.Content>
								</Select.Root>
							</div>
							{#if vehicleType !== 'none'}
								<div class="space-y-1.5">
									<Label for="license_plate">เลขทะเบียนรถ</Label>
									<Input
										id="license_plate"
										bind:value={licensePlate}
										placeholder="เช่น กง 4567 สงขลา"
									/>
								</div>
							{/if}
						</div>
					</div>

					<div class="space-y-1.5 border-b border-border/50 pb-4">
						<Label for="valuables" class="text-sm font-bold">สัมภาระและสิ่งของมีค่า</Label>
						<textarea
							id="valuables"
							rows="2"
							class="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
							bind:value={valuables}
							placeholder="เช่น กระเป๋าเดินทาง 2 ใบ, คอมพิวเตอร์โน้ตบุ๊ก 1 เครื่อง"
						></textarea>
					</div>

					<div class="space-y-3">
						<div class="flex items-center justify-between">
							<h4 class="text-sm font-bold text-slate-800 dark:text-slate-200">
								สัตว์เลี้ยงที่นำมาด้วย
							</h4>
							<button
								onclick={addPetRow}
								class="inline-flex cursor-pointer items-center gap-1 text-xs font-bold text-primary hover:underline"
							>
								<Plus class="size-3.5" />
								<span>เพิ่มชนิดสัตว์เลี้ยง</span>
							</button>
						</div>

						{#if petsList.length === 0}
							<p
								class="rounded-xl bg-slate-50 py-4 text-center text-xs italic text-muted-foreground dark:bg-slate-900"
							>
								ไม่มีสัตว์เลี้ยงที่ลงทะเบียนไว้
							</p>
						{:else}
							<div class="space-y-2.5">
								{#each petsList as pet, i (i)}
									<div
										class="flex items-end gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-800 dark:bg-slate-900"
									>
										<div class="grid flex-1 grid-cols-3 gap-3">
											<div class="space-y-1">
												<Label for="pet_species_{i}" class="text-[10px]">ชนิดสัตว์</Label>
												<Select.Root type="single" bind:value={pet.species}>
													<Select.Trigger id="pet_species_{i}" class="h-8 text-xs">
														{{ dog: '🐶 สุนัข', cat: '🐱 แมว', bird: '🐦 นก', other: '🐾 อื่นๆ' }[
															pet.species
														]}
													</Select.Trigger>
													<Select.Content>
														<Select.Item value="dog" label="🐶 สุนัข" />
														<Select.Item value="cat" label="🐱 แมว" />
														<Select.Item value="bird" label="🐦 นก" />
														<Select.Item value="other" label="🐾 อื่นๆ" />
													</Select.Content>
												</Select.Root>
											</div>
											<div class="space-y-1">
												<Label for="pet_count_{i}" class="text-[10px]">จำนวน (ตัว)</Label>
												<Input
													id="pet_count_{i}"
													type="number"
													min={1}
													class="h-8 text-xs"
													bind:value={pet.count}
												/>
											</div>
											<div class="space-y-1">
												<Label for="pet_notes_{i}" class="text-[10px]">หมายเหตุ</Label>
												<Input
													id="pet_notes_{i}"
													class="h-8 text-xs"
													bind:value={pet.notes}
													placeholder="เช่น นำกรงมาพร้อม"
												/>
											</div>
										</div>
										<Button
											type="button"
											variant="ghost"
											size="icon"
											onclick={() => removePetRow(i)}
											class="size-8 shrink-0 text-destructive hover:bg-destructive/10"
										>
											<X class="size-4" />
										</Button>
									</div>
								{/each}
							</div>
						{/if}
					</div>
				</div>

				<div class="flex justify-end gap-2 border-t border-border pt-4">
					<Button variant="outline" onclick={() => (showAssetModal = false)}>ยกเลิก</Button>
					<Button onclick={saveAssets}>บันทึกข้อมูล</Button>
				</div>
			</div>
		</div>
	{/if}
{/if}

<style>
	@media print {
		:global(body *) {
			visibility: hidden;
		}
		#qr-identity-card,
		#qr-identity-card * {
			visibility: visible;
		}
		#qr-identity-card {
			position: absolute;
			left: 50%;
			top: 50%;
			transform: translate(-50%, -50%) scale(1.5);
			border: 2px solid #000 !important;
			box-shadow: none !important;
			background-color: #fff !important;
			color: #000 !important;
		}
	}
</style>
