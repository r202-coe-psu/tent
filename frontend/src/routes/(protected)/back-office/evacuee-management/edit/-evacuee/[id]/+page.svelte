<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';

	// Icons
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
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
		EWAR_SYMPTOM_GROUPS,
		getMunicipalityZoneLabel,
		getCommunityLabel
	} from '$lib/features/people';
	import type { SpecialNeed, StayStatus, PetGroup } from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { authStore } from '$lib/stores/auth.svelte';
	import { now } from '$lib/db/model';

	let { data } = $props();

	// Helper to resolve Thai status labels and class configurations
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

	// Fetch data
	const evacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	const medicalsQuery = useMedicals();
	const screeningsQuery = useScreenings();
	const shelterQuery = useShelter(() => SHELTER_CODE);

	// Mutations
	const updateEvacueeMutation = useUpdateEvacuee();
	const updateHouseholdMutation = useUpdateHousehold();

	// Resolved document entities
	const evacuee = $derived(
		evacueesQuery.data?.find((e) => e._id === data.id) ?? null
	);
	
	const household = $derived(
		evacuee && householdsQuery.data
			? householdsQuery.data.find((h) => h._id === evacuee.household_id) ?? null
			: null
	);

	const medical = $derived(
		evacuee && medicalsQuery.data
			? medicalsQuery.data.find((m) => m.evacuee_id === evacuee._id) ?? null
			: null
	);

	const screening = $derived(
		evacuee && screeningsQuery.data
			? screeningsQuery.data.find((s) => s.evacuee_id === evacuee._id) ?? null
			: null
	);

	const shelterName = $derived(
		shelterQuery.data?.name ?? 'ศูนย์พักพิงชั่วคราว'
	);

	const shelterZones = $derived(
		shelterQuery.data?.zones ?? []
	);

	const evacueesTotal = $derived(
		evacueesQuery.data?.length ?? 0
	);

	const statusInfo = $derived(
		evacuee ? (statusConfig[evacuee.current_stay.status] || statusConfig.registered) : null
	);

	// Family members
	const familyMembers = $derived(
		evacuee && evacuee.household_id && evacueesQuery.data
			? evacueesQuery.data.filter((e) => e.household_id === evacuee.household_id && e._id !== evacuee._id)
			: []
	);

	// UI Modals State
	let showZoneModal = $state(false);
	let showStatusModal = $state(false);
	let showQrModal = $state(false);
	let showAddressModal = $state(false);
	let showAssetModal = $state(false);

	// Address editing states
	let addressNo = $state('');
	let villageNo = $state('');
	let subdistrict = $state('');
	let district = $state('');
	let province = $state('');
	let postalCode = $state('');

	// Asset editing states
	let vehicleType = $state('none');
	let licensePlate = $state('');
	let valuables = $state('');
	let petsList = $state<PetGroup[]>([]);

	// Setup edit forms when modals open
	function openAddressModal() {
		if (household) {
			addressNo = household.address_no ?? '';
			villageNo = household.village_no ?? '';
			subdistrict = household.subdistrict ?? '';
			district = household.district ?? '';
			province = household.province ?? '';
			postalCode = household.postal_code ?? '';
		} else {
			addressNo = '';
			villageNo = '';
			subdistrict = '';
			district = '';
			province = '';
			postalCode = '';
		}
		showAddressModal = true;
	}

	function openAssetModal() {
		if (household) {
			// Parse vehicle/valuables from notes if JSON, or fall back to notes
			let notesObj = { vehicle: 'none', licensePlate: '', valuables: '', notes: '' };
			try {
				if (household.notes && household.notes.startsWith('{')) {
					notesObj = JSON.parse(household.notes);
				} else {
					notesObj.notes = household.notes || '';
				}
			} catch {
				notesObj.notes = household.notes || '';
			}

			vehicleType = notesObj.vehicle || 'none';
			licensePlate = notesObj.licensePlate || '';
			valuables = notesObj.valuables || notesObj.notes;
			petsList = household.pets ? JSON.parse(JSON.stringify(household.pets)) : [];
		} else {
			vehicleType = 'none';
			licensePlate = '';
			valuables = '';
			petsList = [];
		}
		showAssetModal = true;
	}

	// Update actions
	async function updateZone(zoneCode: string) {
		if (!evacuee) return;
		try {
			const updated = {
				...evacuee,
				current_stay: {
					...evacuee.current_stay,
					zone: zoneCode,
					since: now()
				}
			};
			await updateEvacueeMutation.mutateAsync(updated);
			toast.success(`ย้ายโซนเป็น ${zoneCode.toUpperCase()} เรียบร้อย`);
			showZoneModal = false;
		} catch (err: any) {
			toast.error(`ไม่สามารถย้ายโซนได้: ${err.message || err}`);
		}
	}

	async function updateStatus(status: StayStatus) {
		if (!evacuee) return;
		try {
			const updated = {
				...evacuee,
				current_stay: {
					...evacuee.current_stay,
					status,
					since: now()
				}
			};
			await updateEvacueeMutation.mutateAsync(updated);
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
			const updated = {
				...household,
				address_no: addressNo || null,
				village_no: villageNo || null,
				subdistrict: subdistrict || null,
				district: district || null,
				province: province || null,
				postal_code: postalCode || null
			};
			await updateHouseholdMutation.mutateAsync(updated);
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
			// Prepare notes block containing JSON structured notes for vehicle & valuables
			const notesObj = {
				vehicle: vehicleType,
				licensePlate: vehicleType !== 'none' ? licensePlate : '',
				valuables: valuables
			};

			const updated = {
				...household,
				notes: JSON.stringify(notesObj),
				pets: petsList.filter(p => p.count > 0)
			};
			await updateHouseholdMutation.mutateAsync(updated);
			toast.success('แก้ไขข้อมูลทรัพย์สินและสัตว์เลี้ยงสำเร็จ');
			showAssetModal = false;
		} catch (err: any) {
			toast.error(`ไม่สามารถบันทึกข้อมูลได้: ${err.message || err}`);
		}
	}

	// Add/Remove pet inputs inside modal
	function addPetRow() {
		petsList = [...petsList, { species: 'dog', count: 1, notes: '' }];
	}

	function removePetRow(index: number) {
		petsList = petsList.filter((_, i) => i !== index);
	}



	// Helper to match symptom IDs to their labels
	function getSymptomLabel(id: string): string {
		for (const g of EWAR_SYMPTOM_GROUPS) {
			const s = g.symptoms.find((sym: any) => sym.id === id);
			if (s) {
				return s.label;
			}
		}
		return id;
	}

	// Format Timestamp to display readable date/time
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

	// Parse custom asset fields from household notes
	const parsedAssets = $derived.by(() => {
		if (!household || !household.notes) return { vehicle: 'none', licensePlate: '', valuables: '' };
		try {
			if (household.notes.startsWith('{')) {
				return JSON.parse(household.notes);
			}
		} catch {}
		return { vehicle: 'none', licensePlate: '', valuables: household.notes || '' };
	});
</script>

<svelte:head>
	<title>{evacuee ? `${evacuee.first_name} ${evacuee.last_name}` : 'ข้อมูลผู้ประสบภัย'} · SmartShelter</title>
</svelte:head>

<div class="mx-auto w-full max-w-7xl p-4 md:p-6 space-y-6">
	<!-- Top Navigation -->
	<div>
		<button
			onclick={() => goto(resolve('/back-office/evacuee-management'))}
			class="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground mb-4 transition-colors cursor-pointer"
		>
			<ArrowLeft class="size-4" />
			<span>กลับไปหน้ารายชื่อหลัก</span>
		</button>

		<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
			<div>
				<h1 class="text-2xl md:text-3xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
					ทะเบียนผู้พักพิง (Evacuee Registry)
				</h1>
				<p class="text-xs text-muted-foreground mt-1">
					จำนวนผู้พักพิงในระบบทั้งหมด
					<span class="rounded bg-primary/10 px-1.5 py-0.5 font-bold text-primary">
						{evacueesTotal} คน
					</span>
				</p>
			</div>
			<button
				class="inline-flex items-center justify-center rounded-xl bg-slate-950 dark:bg-slate-50 text-slate-50 dark:text-slate-950 font-semibold text-sm px-4 py-2 hover:bg-slate-800 dark:hover:bg-slate-200 transition-colors gap-2 cursor-pointer shadow-sm"
				onclick={() => goto(resolve('/onsite/people'))}
			>
				<Plus class="size-4" />
				<span>เริ่มลงทะเบียน</span>
			</button>
		</div>
	</div>

	{#if evacueesQuery.isLoading || householdsQuery.isLoading || medicalsQuery.isLoading || screeningsQuery.isLoading}
		<div class="flex flex-col items-center justify-center py-20 gap-3 border border-border bg-card rounded-3xl shadow-sm">
			<div class="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent"></div>
			<p class="text-sm text-muted-foreground font-medium">กำลังโหลดข้อมูลผู้พักพิง...</p>
		</div>
	{:else if !evacuee}
		<div class="py-16 text-center border border-border bg-card rounded-3xl shadow-sm space-y-4">
			<p class="text-base text-destructive font-semibold">ไม่พบข้อมูลผู้พักพิงในระบบ</p>
			<button
				class="inline-flex items-center justify-center rounded-xl border border-border bg-background px-4 py-2 text-sm font-semibold hover:bg-muted transition-colors cursor-pointer"
				onclick={() => goto(resolve('/back-office/evacuee-management'))}
			>
				กลับหน้าหลัก
			</button>
		</div>
	{:else}
		<!-- Main Profile Header Card -->
		<div class="bg-card rounded-3xl border border-border p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
			<div class="flex flex-wrap items-center gap-4">
				<!-- Photo Placeholder -->
				<div class="w-20 h-20 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex flex-col items-center justify-center rounded-2xl text-[10px] font-semibold text-slate-400 select-none shrink-0 shadow-inner">
					<span>No Photo</span>
				</div>

				<!-- Evacuee Info -->
				<div class="space-y-1">
					<h2 class="text-2xl font-bold text-slate-900 dark:text-slate-50">
						{evacuee.first_name} {evacuee.last_name}
					</h2>
					<p class="font-mono text-xs tracking-wider text-muted-foreground bg-muted px-2 py-0.5 rounded-md inline-block">
						NATIONAL ID: {evacuee.person_id?.number || '—'}
					</p>

					<!-- Health and Vulnerability Chips -->
					<div class="flex flex-wrap items-center gap-2 mt-2">
						<!-- Illness Chip -->
						{#if (medical && (medical.conditions.length > 0 || medical.notes)) || (screening && screening.symptoms.length > 0) || medical?.track === 'fast_track'}
							<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-red-50 dark:bg-red-950/40 text-red-600 dark:text-red-400 border border-red-100 dark:border-red-900/30">
								<span class="size-1.5 rounded-full bg-red-500"></span>
								มีอาการป่วย/เฝ้าระวัง
							</span>
						{/if}

						<!-- Vulnerability Chip -->
						{#if evacuee.special_needs && evacuee.special_needs.length > 0}
							<span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/30">
								<span class="size-1.5 rounded-full bg-amber-500"></span>
								กลุ่มเปราะบาง
							</span>
						{/if}
					</div>
				</div>
			</div>

			<!-- Header Actions -->
			<div class="flex flex-wrap items-center gap-3 w-full md:w-auto shrink-0 border-t border-border pt-4 md:pt-0 md:border-none">
				<!-- Change Zone Button -->
				<button
					class="inline-flex items-center justify-center rounded-xl border border-amber-400 hover:bg-amber-50 dark:hover:bg-amber-950/30 text-amber-700 dark:text-amber-400 font-semibold text-sm px-4 py-2 transition-colors cursor-pointer bg-transparent"
					onclick={() => (showZoneModal = true)}
				>
					ย้ายโซน (Change Zone)
				</button>

				<!-- Stay Status Pill Button -->
				<button
					class="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border font-semibold text-sm transition-all hover:brightness-95 cursor-pointer shadow-sm {statusInfo?.colorClass}"
					onclick={() => (showStatusModal = true)}
				>
					<span class="size-1.5 rounded-full {statusInfo?.dotClass}"></span>
					<span>{statusInfo?.label}</span>
					<Pencil class="size-3.5 opacity-60 ml-0.5" />
				</button>

				<!-- Print QR Button -->
				<button
					class="inline-flex items-center justify-center rounded-xl border border-border bg-background hover:bg-muted text-slate-800 dark:text-slate-200 font-semibold text-sm px-4 py-2 transition-colors gap-2 cursor-pointer shadow-sm"
					onclick={() => (showQrModal = true)}
				>
					<Printer class="size-4 opacity-75" />
					<span>พิมพ์ QR</span>
				</button>
			</div>
		</div>

		<!-- Body Information Details: Two columns -->
		<div class="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
			
			<!-- Left Column: Zone coordinates, Personal info, Emergency contact -->
			<div class="lg:col-span-5 space-y-6">
				
				<!-- Card 1: Location and shelter coordinates -->
				<div class="bg-card rounded-3xl border border-border p-6 shadow-sm space-y-4">
					<div class="flex items-center gap-2.5 pb-2 border-b border-border">
						<MapPin class="size-4.5 text-primary" />
						<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">
							พิกัดโซนและศูนย์พักพิง
						</h3>
					</div>
					<div class="space-y-3.5">
						<div>
							<span class="text-xs text-muted-foreground block font-medium">ศูนย์อพยพ:</span>
							<span class="text-sm font-bold text-slate-800 dark:text-slate-200 mt-0.5 block">
								{shelterName}
							</span>
						</div>
						
						<div class="grid grid-cols-2 gap-4">
							<div>
								<span class="text-xs text-muted-foreground block font-medium">โซนพักอาศัย:</span>
								<span class="inline-block mt-1 px-3 py-1 text-xs font-bold bg-blue-50 dark:bg-blue-950/40 text-blue-600 dark:text-blue-400 rounded-lg border border-blue-100 dark:border-blue-900/30">
									Zone: {zoneLabel(evacuee.current_stay.zone)}
								</span>
							</div>
							<div>
								<span class="text-xs text-muted-foreground block font-medium">หมายเลขเตียง/จุดพัก:</span>
								<span class="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-1 block">
									-
								</span>
							</div>
						</div>
					</div>
				</div>

				<!-- Card 2: Personal Details -->
				<div class="bg-card rounded-3xl border border-border p-6 shadow-sm space-y-4">
					<div class="flex items-center gap-2.5 pb-2 border-b border-border">
						<User class="size-4.5 text-primary" />
						<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">
							ข้อมูลส่วนบุคคล
						</h3>
					</div>
					<div class="grid grid-cols-2 gap-y-4 gap-x-2">
						<div>
							<span class="text-xs text-muted-foreground block font-medium">เพศ</span>
							<span class="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">
								{evacuee.gender === 'male' ? 'Male' : evacuee.gender === 'female' ? 'Female' : 'Other'}
							</span>
						</div>
						<div>
							<span class="text-xs text-muted-foreground block font-medium">อายุ</span>
							<span class="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">
								{evacuee.birth_year ? `${new Date().getFullYear() + 543 - evacuee.birth_year} ปี` : 'ไม่ระบุ'}
							</span>
						</div>
						<div>
							<span class="text-xs text-muted-foreground block font-medium">สัญชาติ</span>
							<span class="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">
								{evacuee.country === 'THAILAND' ? 'ไทย' : evacuee.country}
							</span>
						</div>
						<div>
							<span class="text-xs text-muted-foreground block font-medium">ศาสนา</span>
							<span class="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">
								{evacuee.religion === 'buddhist' ? 'พุทธ' : evacuee.religion === 'muslim' ? 'อิสลาม' : evacuee.religion === 'christian' ? 'คริสต์' : 'ไม่ระบุ'}
							</span>
						</div>
						<div class="col-span-2 border-t border-border/50 pt-3">
							<span class="text-xs text-muted-foreground block font-medium">เบอร์โทรศัพท์</span>
							<span class="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">
								{evacuee.phone || 'ไม่มีเบอร์ติดต่อ'}
							</span>
						</div>
					</div>
				</div>

				<!-- Card 3: Emergency Contact -->
				<div class="bg-amber-50/40 dark:bg-amber-950/10 rounded-3xl border border-amber-100 dark:border-amber-900/30 p-6 shadow-sm space-y-4">
					<div class="flex items-center gap-2.5 pb-2 border-b border-amber-200/50 dark:border-amber-900/20">
						<ShieldAlert class="size-4.5 text-amber-600 dark:text-amber-500" />
						<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">
							ข้อมูลติดต่อฉุกเฉิน
						</h3>
					</div>
					<div class="space-y-3.5">
						<div>
							<span class="text-xs text-muted-foreground block font-medium">ญาติ / ผู้ติดต่อ:</span>
							<span class="text-sm font-bold text-slate-800 dark:text-slate-200 mt-0.5 block">
								{evacuee.emergency_contact?.name || 'ไม่ระบุบุคคล'}
							</span>
						</div>
						<div>
							<span class="text-xs text-muted-foreground block font-medium">เบอร์โทรศัพท์ฉุกเฉิน:</span>
							<span class="text-sm font-bold mt-0.5 block {evacuee.emergency_contact?.phone ? 'text-slate-800 dark:text-slate-200' : 'text-red-500 dark:text-red-400 font-semibold'}">
								{evacuee.emergency_contact?.phone || 'ไม่ระบุ'}
							</span>
						</div>
					</div>
				</div>

			</div>

			<!-- Right Column: Health details, Household structure, Assets/Pets -->
			<div class="lg:col-span-7 space-y-6">
				
				<!-- Card 1: Health & Vulnerability (Pink Theme Border/Header) -->
				<div class="bg-card rounded-3xl border border-red-100 dark:border-red-950/50 overflow-hidden shadow-sm">
					<!-- Red/Pink Styled Header -->
					<div class="bg-red-50/60 dark:bg-red-950/20 border-b border-red-100/50 dark:border-red-950/30 p-4 px-6 flex items-center gap-2.5">
						<Stethoscope class="size-5 text-red-600 dark:text-red-500" />
						<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">
							ข้อมูลสุขภาพ และ ความเปราะบาง (Health & Vulnerability)
						</h3>
					</div>

					<div class="p-6 grid grid-cols-1 md:grid-cols-12 gap-6">
						<!-- Left section: Symptoms & Medical Details -->
						<div class="md:col-span-7 space-y-4">
							<div>
								<span class="text-xs text-muted-foreground block font-semibold text-red-600 dark:text-red-400">อาการป่วยแรกรับ:</span>
								<div class="mt-1.5 p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-sm font-semibold text-slate-800 dark:text-slate-200">
									{#if screening && screening.symptoms.length > 0}
										<div class="flex flex-col gap-1">
											{#each screening.symptoms as sym}
												<span>• {getSymptomLabel(sym)}</span>
											{/each}
										</div>
									{:else if medical && medical.conditions.length > 0}
										<div class="flex flex-col gap-1">
											{#each medical.conditions as cond}
												<span>• {cond}</span>
											{/each}
										</div>
									{:else}
										<span class="text-muted-foreground font-normal">ไม่มีอาการป่วยแรกรับ</span>
									{/if}
								</div>
							</div>

							<div class="grid grid-cols-2 gap-4">
								<div>
									<span class="text-xs text-muted-foreground block font-medium">โรคประจำตัว:</span>
									<span class="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1 block">
										{medical?.conditions?.join(', ') || 'ไม่มี'}
									</span>
								</div>
								<div>
									<span class="text-xs text-muted-foreground block font-medium">ความเสี่ยงแพร่เชื้อ:</span>
									{#if (screening && screening.symptoms.includes('acute_respiratory')) || (medical?.notes?.includes('กักโรค') || medical?.notes?.includes('แพร่เชื้อ'))}
										<span class="inline-block mt-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-900">
											ควรแยกกักโรค
										</span>
									{:else}
										<span class="text-sm font-semibold text-slate-500 mt-1 block">
											ไม่มีความเสี่ยง
										</span>
									{/if}
								</div>
							</div>

							<div class="grid grid-cols-2 gap-4 border-t border-border/40 pt-3">
								<div>
									<span class="text-xs text-muted-foreground block font-medium">แพ้ยา:</span>
									<span class="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">
										{#if medical && medical.medications && medical.medications.length > 0}
											{medical.medications.join(', ')}
										{:else}
											ไม่ระบุประวัติ
										{/if}
									</span>
								</div>
								<div>
									<span class="text-xs text-muted-foreground block font-medium">แพ้อาหาร:</span>
									<span class="text-sm font-semibold text-slate-800 dark:text-slate-200 mt-0.5 block">
										{#if medical && medical.allergies && medical.allergies.length > 0}
											{medical.allergies.join(', ')}
										{:else}
											ไม่ระบุประวัติ
										{/if}
									</span>
								</div>
							</div>

							<div class="border-t border-border/40 pt-3">
								<span class="text-xs text-muted-foreground block font-medium">บันทึกของพยาบาล:</span>
								<div class="mt-1.5 p-3 rounded-2xl bg-blue-50/50 dark:bg-blue-950/20 border border-blue-100/50 dark:border-blue-900/20 text-xs font-semibold text-blue-800 dark:text-blue-300">
									{medical?.notes || screening?.notes || 'ไม่มีบันทึกทางพยาบาล'}
								</div>
							</div>
						</div>

						<!-- Right section: Vulnerability classification -->
						<div class="md:col-span-5 border-t md:border-t-0 md:border-l border-border/50 pt-4 md:pt-0 md:pl-6 space-y-4">
							<div>
								<span class="text-xs text-muted-foreground block font-medium">กลุ่มเปราะบาง:</span>
								<div class="flex flex-wrap gap-1.5 mt-2">
									{#if evacuee.special_needs && evacuee.special_needs.length > 0}
										{#each evacuee.special_needs as need}
											{@const chip = SPECIAL_NEED_CHIPS[need as SpecialNeed]}
											<span class="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-xs font-semibold">
												<span>{chip.emoji}</span>
												<span>{chip.label}</span>
											</span>
										{/each}
									{:else}
										<span class="text-xs text-muted-foreground italic">ทั่วไป (ไม่มีความเปราะบาง)</span>
									{/if}
								</div>
							</div>

							<div class="border-t border-border/40 pt-3">
								<span class="text-xs text-muted-foreground block font-medium">ความต้องการพิเศษ/ข้อแนะนำ:</span>
								<div class="mt-1.5 p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-xs font-medium text-slate-700 dark:text-slate-300">
									{#if evacuee.special_needs.includes('disabled')}
										ต้องการรถเข็น, เครื่องช่วยฟัง
									{:else if medical?.notes && medical.notes.includes('ต้องการ')}
										{medical.notes}
									{:else}
										ไม่มีข้อแนะนำพิเศษ
									{/if}
								</div>
							</div>

							{#if screening?.needs_referral}
								<div class="pt-2">
									<span class="inline-flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-bold bg-amber-50 dark:bg-amber-950 text-amber-700 dark:text-amber-400 border border-amber-200 dark:border-amber-900">
										🚨 สถานะส่งต่อ: Requested
									</span>
								</div>
							{/if}
						</div>
					</div>
				</div>

				<!-- Card 2: Head of Household family info -->
				<div class="bg-card rounded-3xl border border-border p-6 shadow-sm space-y-4">
					<div class="flex items-center justify-between pb-2 border-b border-border">
						<div class="flex items-center gap-2.5">
							<Home class="size-4.5 text-primary" />
							<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">
								หัวหน้าครอบครัว (Head of Household)
							</h3>
						</div>
					</div>

					<div class="space-y-4">
						<div class="flex items-center justify-between">
							<span class="text-xs text-muted-foreground font-medium">สถานะในครอบครัว:</span>
							{#if household && household.head_evacuee_id === evacuee._id}
								<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300">
									⭐ หัวหน้าครอบครัว
								</span>
							{:else}
								<span class="px-2.5 py-0.5 rounded-full text-xs font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
									สมาชิกครอบครัว
								</span>
							{/if}
						</div>

						<div>
							<span class="text-xs text-muted-foreground block font-medium">รายชื่อสมาชิกร่วมทาง:</span>
							<div class="mt-1.5 p-3 rounded-2xl border border-dashed border-slate-200 dark:border-slate-800 text-center">
								{#if familyMembers.length > 0}
									<div class="flex flex-wrap gap-1.5 justify-center">
										{#each familyMembers as m}
											<button
												onclick={() => goto(resolve(`/back-office/evacuee-management/edit/-evacuee/${m._id}`))}
												class="px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-xs font-semibold text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors cursor-pointer"
											>
												{m.first_name} {m.last_name}
											</button>
										{/each}
									</div>
								{:else}
									<span class="text-xs text-muted-foreground italic">
										เดินทางคนเดียว / ไม่ได้ระบุสมาชิกในกลุ่ม
									</span>
								{/if}
							</div>
						</div>

						<div class="border-t border-border/40 pt-3 space-y-2">
							<div class="flex items-center justify-between">
								<span class="text-xs text-muted-foreground font-medium">ที่อยู่ครอบครัว:</span>
								{#if household}
									<button
										onclick={openAddressModal}
										class="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer"
									>
										✏️ แก้ไขที่อยู่ครอบครัว
									</button>
								{/if}
							</div>
							<div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 text-xs text-slate-700 dark:text-slate-300 font-medium">
								{#if household && (household.address_no || household.subdistrict || household.district || household.province)}
									{household.address_no || ''}
									{household.village_no ? `หมู่ที่ ${household.village_no}` : ''}
									{household.subdistrict ? `ต.${household.subdistrict}` : ''}
									{household.district ? `อ.${household.district}` : ''}
									{household.province ? `จ.${household.province}` : ''}
									{household.postal_code || ''}
								{:else}
									<span class="text-muted-foreground italic">ไม่มีที่อยู่จัดเก็บ</span>
								{/if}
							</div>
						</div>
					</div>
				</div>

				<!-- Card 3: Assets, vehicles and pets -->
				<div class="bg-card rounded-3xl border border-border p-6 shadow-sm space-y-4">
					<div class="flex items-center justify-between pb-2 border-b border-border">
						<div class="flex items-center gap-2.5">
							<Car class="size-4.5 text-primary" />
							<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">
								ทรัพย์สิน ยานพาหนะ และสัตว์เลี้ยง
							</h3>
						</div>
						{#if household}
							<button
								onclick={openAssetModal}
								class="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
							>
								<Pencil class="size-4" />
							</button>
						{/if}
					</div>

					<div class="grid grid-cols-1 md:grid-cols-3 gap-6 items-stretch">
						<!-- Vehicle Column -->
						<div class="space-y-1.5 flex flex-col justify-between">
							<span class="text-xs text-muted-foreground font-semibold">ยานพาหนะ:</span>
							<div class="flex-1 mt-1 p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 flex flex-col justify-center gap-1.5 min-h-[70px]">
								{#if parsedAssets.vehicle && parsedAssets.vehicle !== 'none'}
									<span class="text-xs font-bold text-slate-700 dark:text-slate-300">
										🚗 {parsedAssets.vehicle === 'car' ? 'รถยนต์' : parsedAssets.vehicle === 'motorcycle' ? 'จักรยานยนต์' : 'อื่นๆ'}
									</span>
									{#if parsedAssets.licensePlate}
										<span class="text-xs text-slate-900 dark:text-slate-100 font-bold">
											ทะเบียน: {parsedAssets.licensePlate}
										</span>
									{/if}
								{:else}
									<span class="text-xs text-muted-foreground italic">ไม่มี</span>
								{/if}
							</div>
						</div>

						<!-- Valuables Column -->
						<div class="space-y-1.5 flex flex-col justify-between">
							<span class="text-xs text-muted-foreground font-semibold">สัมภาระ/สิ่งของมีค่า:</span>
							<div class="flex-1 mt-1 p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 flex items-center min-h-[70px]">
								{#if parsedAssets.valuables}
									<span class="text-xs font-medium italic text-slate-600 dark:text-slate-400">
										{parsedAssets.valuables}
									</span>
								{:else}
									<span class="text-xs text-muted-foreground italic">ไม่มี</span>
								{/if}
							</div>
						</div>

						<!-- Pets Column -->
						<div class="space-y-1.5 flex flex-col justify-between">
							<span class="text-xs text-muted-foreground font-semibold">สัตว์เลี้ยง:</span>
							<div class="flex-1 mt-1 flex flex-col justify-center min-h-[70px] gap-1.5">
								{#if household && household.pets && household.pets.length > 0}
									{#each household.pets as pet}
										{@const petEmoji = pet.species === 'dog' ? '🐶' : pet.species === 'cat' ? '🐱' : pet.species === 'bird' ? '🐦' : '🐾'}
										{@const speciesLabel = pet.species === 'dog' ? 'สุนัข' : pet.species === 'cat' ? 'แมว' : pet.species === 'bird' ? 'นก' : 'อื่นๆ'}
										<div class="p-2.5 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-100 dark:border-amber-900/30 flex flex-col gap-1">
											<div class="flex items-center justify-between text-[11px] font-bold text-amber-800 dark:text-amber-400">
												<span>{petEmoji} {speciesLabel}</span>
												<span class="bg-amber-100 dark:bg-amber-950 px-1.5 py-0.5 rounded text-[9px]">
													{pet.count} ตัว
												</span>
											</div>
											{#if pet.notes}
												<span class="text-[9px] text-green-700 dark:text-green-400 font-bold flex items-center gap-0.5 mt-0.5">
													✓ {pet.notes}
												</span>
											{/if}
										</div>
									{/each}
								{:else}
									<div class="p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800 flex items-center justify-center flex-1">
										<span class="text-xs text-muted-foreground italic">ไม่มี</span>
									</div>
								{/if}
							</div>
						</div>
					</div>
				</div>

			</div>
		</div>

		<!-- Footer Audit logs -->
		<div class="border-t border-border pt-6 flex flex-wrap items-center gap-6 text-xs text-muted-foreground font-medium">
			<div class="flex items-center gap-1.5">
				<Clock class="size-4 opacity-75" />
				<span>ประวัติการอัปเดตข้อมูล (Audit Log)</span>
			</div>
			<div class="flex flex-wrap gap-x-6 gap-y-2">
				<span>
					ลงทะเบียนเมื่อ: <strong class="text-foreground font-semibold">{formatDateTime(evacuee.created_at)}</strong> โดย {evacuee.created_by || 'system'}
				</span>
				{#if evacuee.updated_at && evacuee.updated_at !== evacuee.created_at}
					<span>
						แก้ไขล่าสุดเมื่อ: <strong class="text-foreground font-semibold">{formatDateTime(evacuee.updated_at)}</strong>
					</span>
				{/if}
			</div>
		</div>
	{/if}
</div>

<!-- Modal 1: Change Zone Dialog -->
{#if showZoneModal && evacuee}
	<div class="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4">
		<div class="bg-card border border-border w-full max-w-md rounded-3xl p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
			<div class="flex items-center justify-between border-b border-border pb-2.5">
				<h3 class="font-bold text-lg text-slate-900 dark:text-slate-50">ย้ายโซนที่พัก (Change stay zone)</h3>
				<button onclick={() => (showZoneModal = false)} class="p-1 text-muted-foreground hover:text-foreground rounded-lg transition-colors cursor-pointer">
					<X class="size-5" />
				</button>
			</div>
			
			<div class="space-y-2 max-h-[300px] overflow-y-auto pr-1">
				{#if shelterZones.length === 0}
					<p class="text-sm text-muted-foreground text-center py-4">ไม่พบรายการโซนในระบบ</p>
				{:else}
					{#each shelterZones as zone}
						<button
							onclick={() => updateZone(zone.code)}
							class="w-full text-left p-3.5 rounded-xl border border-border hover:border-primary hover:bg-slate-50 dark:hover:bg-slate-900 transition-all font-semibold flex items-center justify-between group cursor-pointer {evacuee.current_stay.zone === zone.code ? 'border-primary bg-primary/5 text-primary' : 'bg-background'}"
						>
							<div class="flex flex-col">
								<span class="text-sm">{zone.name || zone.code}</span>
								<span class="text-[10px] text-muted-foreground font-normal mt-0.5">Code: {zone.code.toUpperCase()} {zone.type ? `| Type: ${zone.type}` : ''}</span>
							</div>
							{#if evacuee.current_stay.zone === zone.code}
								<CheckCircle class="size-5 text-primary shrink-0" />
							{/if}
						</button>
					{/each}
				{/if}
			</div>

			<div class="flex justify-end gap-2 border-t border-border pt-3">
				<button onclick={() => (showZoneModal = false)} class="rounded-xl border border-border bg-background hover:bg-muted text-slate-800 dark:text-slate-200 font-semibold text-xs px-4 py-2 transition-colors cursor-pointer">
					ยกเลิก
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal 2: Stay Status Dialog -->
{#if showStatusModal && evacuee}
	<div class="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4">
		<div class="bg-card border border-border w-full max-w-md rounded-3xl p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
			<div class="flex items-center justify-between border-b border-border pb-2.5">
				<h3 class="font-bold text-lg text-slate-900 dark:text-slate-50">แก้ไขสถานะการพักพิง (Stay status)</h3>
				<button onclick={() => (showStatusModal = false)} class="p-1 text-muted-foreground hover:text-foreground rounded-lg transition-colors cursor-pointer">
					<X class="size-5" />
				</button>
			</div>

			<div class="space-y-2">
				{#each Object.entries(statusConfig) as [statusKey, cfg]}
					<button
						onclick={() => updateStatus(statusKey as StayStatus)}
						class="w-full text-left p-3.5 rounded-xl border border-border hover:border-primary hover:bg-slate-50 dark:hover:bg-slate-900 transition-all font-semibold flex items-center justify-between cursor-pointer {evacuee.current_stay.status === statusKey ? 'border-primary bg-primary/5 text-primary' : 'bg-background'}"
					>
						<div class="flex items-center gap-2">
							<span class="size-2 rounded-full {cfg.dotClass}"></span>
							<span class="text-sm">{cfg.label}</span>
						</div>
						{#if evacuee.current_stay.status === statusKey}
							<CheckCircle class="size-5 text-primary shrink-0" />
						{/if}
					</button>
				{/each}
			</div>

			<div class="flex justify-end gap-2 border-t border-border pt-3">
				<button onclick={() => (showStatusModal = false)} class="rounded-xl border border-border bg-background hover:bg-muted text-slate-800 dark:text-slate-200 font-semibold text-xs px-4 py-2 transition-colors cursor-pointer">
					ยกเลิก
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal 3: Print QR Card Overlay -->
{#if showQrModal && evacuee}
	<div class="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-center justify-center p-4">
		<div class="bg-card border border-border w-full max-w-sm rounded-3xl p-6 shadow-xl space-y-6 animate-in fade-in zoom-in-95 duration-150 text-center">
			
			<div class="flex justify-end">
				<button onclick={() => (showQrModal = false)} class="p-1 text-muted-foreground hover:text-foreground rounded-lg transition-colors cursor-pointer">
					<X class="size-5" />
				</button>
			</div>

			<!-- QR Identity Card Layout -->
			<div id="qr-identity-card" class="border-2 border-slate-900 dark:border-slate-100 rounded-2xl p-6 mx-auto bg-white text-slate-900 shadow-md max-w-[280px] space-y-4">
				<div class="border-b-2 border-slate-900 pb-2">
					<h4 class="font-bold text-xs uppercase tracking-widest text-slate-500">Smart Shelter ID Card</h4>
					<h3 class="font-bold text-base mt-0.5">บัตรประจำตัวผู้ประสบภัย</h3>
				</div>
				
				<!-- Mock Barcode / QR Box -->
				<div class="w-40 h-40 bg-slate-100 border border-slate-200 mx-auto rounded-lg flex items-center justify-center flex-col p-2 space-y-2">
					<svg xmlns="http://www.w3.org/2000/svg" class="size-28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16V21H16"/><path d="M21 16H16"/><path d="M9 3H13"/><path d="M21 9V13"/><path d="M9 21H13"/><path d="M3 9V13"/></svg>
					<span class="font-mono text-[9px] text-slate-500 tracking-wider">ID: {evacuee._id.split(':')[1] || evacuee._id}</span>
				</div>

				<div class="space-y-1 text-center">
					<h3 class="font-bold text-base text-slate-900">{evacuee.first_name} {evacuee.last_name}</h3>
					<p class="text-[10px] font-mono text-slate-500">ID CARD: {maskNationalId(evacuee.person_id?.number)}</p>
					{#if evacuee.current_stay.zone}
						<div class="inline-block px-2 py-0.5 bg-slate-900 text-white rounded text-[10px] font-bold uppercase tracking-wider mt-1.5">
							Zone: {evacuee.current_stay.zone.toUpperCase()}
						</div>
					{/if}
				</div>
			</div>

			<div class="flex justify-center gap-2 border-t border-border pt-4">
				<button onclick={() => window.print()} class="rounded-xl bg-primary hover:bg-primary/90 text-primary-foreground font-semibold text-xs px-4 py-2 transition-colors cursor-pointer shadow-sm flex items-center gap-1.5">
					<Printer class="size-4" />
					<span>สั่งพิมพ์บัตร</span>
				</button>
				<button onclick={() => (showQrModal = false)} class="rounded-xl border border-border bg-background hover:bg-muted text-slate-800 dark:text-slate-200 font-semibold text-xs px-4 py-2 transition-colors cursor-pointer">
					ปิดหน้าต่าง
				</button>
			</div>
		</div>
	</div>
{/if}

<!-- Modal 4: Edit Family Address Dialog -->
{#if showAddressModal && household}
	<div class="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4">
		<div class="bg-card border border-border w-full max-w-lg rounded-3xl p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
			<div class="flex items-center justify-between border-b border-border pb-2.5">
				<h3 class="font-bold text-lg text-slate-900 dark:text-slate-50">แก้ไขที่อยู่ครอบครัว (Family Address)</h3>
				<button onclick={() => (showAddressModal = false)} class="p-1 text-muted-foreground hover:text-foreground rounded-lg transition-colors cursor-pointer">
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

<!-- Modal 5: Edit Assets/Pets Dialog -->
{#if showAssetModal && household}
	<div class="fixed inset-0 z-50 bg-slate-950/40 backdrop-blur-xs flex items-center justify-center p-4">
		<div class="bg-card border border-border w-full max-w-xl rounded-3xl p-6 shadow-xl space-y-4 animate-in fade-in zoom-in-95 duration-150">
			<div class="flex items-center justify-between border-b border-border pb-2.5">
				<h3 class="font-bold text-lg text-slate-900 dark:text-slate-50">แก้ไขทรัพย์สินและสัตว์เลี้ยง (Assets & Pets)</h3>
				<button onclick={() => (showAssetModal = false)} class="p-1 text-muted-foreground hover:text-foreground rounded-lg transition-colors cursor-pointer">
					<X class="size-5" />
				</button>
			</div>

			<div class="space-y-4 max-h-[400px] overflow-y-auto pr-1">
				<!-- Vehicle Setup -->
				<div class="space-y-2 border-b border-border/50 pb-4">
					<h4 class="text-sm font-bold text-slate-800 dark:text-slate-200">ข้อมูลยานพาหนะ</h4>
					<div class="grid grid-cols-2 gap-4">
						<div class="space-y-1.5">
							<Label for="vehicle_type">ประเภทยานพาหนะ</Label>
							<Select.Root type="single" bind:value={vehicleType}>
								<Select.Trigger id="vehicle_type" class="h-9 w-full">
									{{ none: 'ไม่มี', car: 'รถยนต์', motorcycle: 'รถจักรยานยนต์', other: 'อื่นๆ' }[vehicleType] ?? '— เลือก —'}
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
								<Input id="license_plate" bind:value={licensePlate} placeholder="เช่น กง 4567 สงขลา" />
							</div>
						{/if}
					</div>
				</div>

				<!-- Valuables -->
				<div class="space-y-1.5 border-b border-border/50 pb-4">
					<Label for="valuables" class="text-sm font-bold">สัมภาระและสิ่งของมีค่า</Label>
					<textarea
						id="valuables"
						rows="2"
						class="flex min-h-[60px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none"
						bind:value={valuables}
						placeholder="เช่น กระเป๋าเดินทาง 2 ใบ, คอมพิวเตอร์โน้ตบุ๊ก 1 เครื่อง"
					></textarea>
				</div>

				<!-- Pets List -->
				<div class="space-y-3">
					<div class="flex items-center justify-between">
						<h4 class="text-sm font-bold text-slate-800 dark:text-slate-200">สัตว์เลี้ยงที่นำมาด้วย</h4>
						<button
							onclick={addPetRow}
							class="inline-flex items-center gap-1 text-xs text-primary font-bold hover:underline cursor-pointer"
						>
							<Plus class="size-3.5" />
							<span>เพิ่มชนิดสัตว์เลี้ยง</span>
						</button>
					</div>

					{#if petsList.length === 0}
						<p class="text-xs text-muted-foreground italic text-center py-4 bg-slate-50 dark:bg-slate-900 rounded-xl">ไม่มีสัตว์เลี้ยงที่ลงทะเบียนไว้</p>
					{:else}
						<div class="space-y-2.5">
							{#each petsList as pet, i}
								<div class="flex items-end gap-3 p-3 rounded-2xl bg-slate-50 dark:bg-slate-900 border border-slate-100 dark:border-slate-800">
									<div class="flex-1 grid grid-cols-3 gap-3">
										<div class="space-y-1">
											<Label for="pet_species_{i}" class="text-[10px]">ชนิดสัตว์</Label>
											<Select.Root type="single" bind:value={pet.species}>
												<Select.Trigger id="pet_species_{i}" class="h-8 text-xs">
													{{ dog: '🐶 สุนัข', cat: '🐱 แมว', bird: '🐦 นก', other: '🐾 อื่นๆ' }[pet.species]}
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

<style>
	/* Print specific overrides for the QR identity card modal */
	@media print {
		:global(body *) {
			visibility: hidden;
		}
		#qr-identity-card, #qr-identity-card * {
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
