<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { browser } from '$app/environment';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import {
		useEvacuees,
		useHouseholds,
		useCreateHousehold,
		useUpdateEvacuee,
		useUpdateHousehold,
		peopleRepository
	} from '../index';
	import type { Evacuee, Household, PetGroup, HouseholdVehicle } from '../domain/people';
	import { useMasterData } from '$lib/features/master-data';
	import { toast } from 'svelte-sonner';
	import QRCode from 'qrcode';
	import { Html5Qrcode } from 'html5-qrcode';

	// Sub-components
	import HouseholdPostArrivalHead from './household-post-arrival-head.svelte';
	import HouseholdPostArrivalMembers from './household-post-arrival-members.svelte';
	import HouseholdPostArrivalSummary from './household-post-arrival-summary.svelte';
	import EvacueeSelectZone from './evacuee-select-zone.svelte';

	// Icons
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Scan from '@lucide/svelte/icons/scan';
	import CameraOff from '@lucide/svelte/icons/camera-off';

	// UI Component Library
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import EvacueePetAssetVehicle from './evacuee-pet-asset-vehicle.svelte';
	import { Combobox } from '$lib/components/ui/combobox/index.js';
	import {
		useProvinces,
		useDistricts,
		useSubdistricts
	} from '$lib/features/shelters/application/queries';

	const STORAGE_KEY = 'smart_shelter_post_arrival_wizard_state';

	interface SavedWizardState {
		step: 1 | 2 | 3 | 4 | 5 | 6;
		selectedHead: Evacuee | null;
		selectedMembers: Evacuee[];
		createdHousehold: Household | null;
		qrUrl: string | null;
		addressForm: {
			addressNo: string;
			villageNo: string;
			subdistrict: string;
			district: string;
			province: string;
			postalCode: string;
			municipalityZone: string;
			community: string;
			notes: string;
		};
		petsList: PetGroup[];
		vehicleRows: HouseholdVehicle[];
		assetDescription: string;
	}

	function loadSavedState(): SavedWizardState | null {
		if (!browser) return null;
		try {
			const saved = sessionStorage.getItem(STORAGE_KEY);
			if (saved) {
				sessionStorage.removeItem(STORAGE_KEY);
				return JSON.parse(saved) as SavedWizardState;
			}
		} catch (e) {
			console.error('Failed to load saved wizard state', e);
		}
		return null;
	}

	const savedState = loadSavedState();

	// --- Step Tracking ---
	let step = $state<1 | 2 | 3 | 4 | 5 | 6>(savedState?.step ?? 1);
	let isSubmitting = $state(false);

	// --- Queries and Mutations ---
	const createHouseholdMutation = useCreateHousehold();
	const updateHouseholdMutation = useUpdateHousehold();
	const updateEvacueeMutation = useUpdateEvacuee();

	const evacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	const municipalityZoneQuery = useMasterData(() => 'municipality_zone');
	const communityQuery = useMasterData(() => 'community');

	const municipalityZoneItems = $derived(
		(municipalityZoneQuery.data?.items ?? []).map((z) => ({ value: z.code, label: z.label }))
	);
	const communityItems = $derived(
		(communityQuery.data?.items ?? []).map((c) => ({ value: c.code, label: c.label }))
	);

	const allEvacuees = $derived(evacueesQuery.data ?? []);
	const allHouseholds = $derived(householdsQuery.data ?? []);

	// --- State variables ---
	let selectedHead = $state<Evacuee | null>(savedState?.selectedHead ?? null);
	let selectedMembers = $state<Evacuee[]>(savedState?.selectedMembers ?? []);
	let createdHousehold = $state<Household | null>(savedState?.createdHousehold ?? null);
	let qrUrl = $state<string | null>(savedState?.qrUrl ?? null);

	function handleViewProfile(id: string) {
		const stateToSave = {
			step,
			selectedHead,
			selectedMembers,
			createdHousehold,
			qrUrl,
			addressForm,
			petsList,
			vehicleRows,
			assetDescription
		};
		if (browser) {
			try {
				sessionStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
			} catch (e) {
				console.error('Failed to save wizard state', e);
			}
		}
		goto(
			resolve(
				`/back-office/evacuee-management/edit/-evacuee/${id}?from=/back-office/households/new?path=c`
			)
		);
	}

	let showScanner = $state(false);
	let scannerTarget = $state<'head' | 'member'>('head');
	let cameraError = $state<string | null>(null);

	function cameraAttachment(node: HTMLDivElement) {
		const html5QrCode = new Html5Qrcode(node.id);

		html5QrCode
			.start(
				{ facingMode: 'environment' },
				{
					fps: 10,
					qrbox: (width, height) => {
						const minDimension = Math.min(width, height);
						const qrboxSize = Math.floor(minDimension * 0.7);
						return {
							width: qrboxSize,
							height: qrboxSize
						};
					}
				},
				(decodedText) => {
					const scannedValue = decodedText.trim();
					if (scannedValue) {
						if (typeof navigator !== 'undefined' && navigator.vibrate) {
							navigator.vibrate(100);
						}
						handleScanResult(scannedValue);
					}
				},
				() => {}
			)
			.catch(() => {
				cameraError = 'ไม่สามารถเข้าถึงกล้องได้ โปรดตรวจสอบการอนุญาตใช้งานกล้อง';
			});

		return () => {
			if (html5QrCode.isScanning) {
				html5QrCode.stop().catch(() => {});
			}
		};
	}

	function handleScanResult(scannedId: string) {
		const evac = allEvacuees.find((e) => e._id === scannedId);
		if (!evac) {
			toast.error('ไม่พบผู้ประสบภัยที่ตรงกับรหัส QR นี้');
			return;
		}

		// Double check duplicate active household with other members
		const conflict = checkEvacueeHhConflict(evac);
		if (conflict.conflicted) {
			toast.error(
				`ไม่สามารถเพิ่มได้ เนื่องจาก ${evac.first_name} ${evac.last_name} สังกัดครัวเรือน "${conflict.label}" ที่ยังมีสมาชิกอื่นอยู่`
			);
			return;
		}

		if (scannerTarget === 'head') {
			selectedHead = evac;
			if (!selectedMembers.some((m) => m._id === evac._id)) {
				selectedMembers = [...selectedMembers, evac];
			}
		} else {
			if (selectedMembers.some((m) => m._id === evac._id)) {
				toast.error('ผู้ประสบภัยรายนี้ถูกเพิ่มเข้าครัวเรือนเรียบร้อยแล้ว');
				return;
			}
			selectedMembers = [...selectedMembers, evac];
			toast.success(`เพิ่ม ${evac.first_name} เข้าสมาชิกแล้ว`);
		}

		// Close scanner modal
		showScanner = false;
	}

	function checkEvacueeHhConflict(evacuee: Evacuee): { conflicted: boolean; label?: string } {
		if (!evacuee.household_id) return { conflicted: false };
		const hh = allHouseholds.find((h) => h._id === evacuee.household_id);
		if (!hh || hh.status === 'cancelled' || hh.status === 'checked_out') {
			return { conflicted: false };
		}
		const otherMembers = allEvacuees.filter(
			(e) => e.household_id === evacuee.household_id && e._id !== evacuee._id
		);
		if (otherMembers.length > 0) {
			return { conflicted: true, label: hh.label };
		}
		return { conflicted: false };
	}

	$effect(() => {
		if (createdHousehold?._id) {
			QRCode.toDataURL(
				createdHousehold._id,
				{
					margin: 0,
					width: 180,
					color: {
						dark: '#000000',
						light: '#ffffff'
					}
				},
				(err, url) => {
					if (err) {
						console.error(err);
						return;
					}
					qrUrl = url;
				}
			);
		}
	});

	// --- Step 3: Address Form ---
	let addressForm = $state({
		addressNo: savedState?.addressForm?.addressNo ?? '',
		villageNo: savedState?.addressForm?.villageNo ?? '',
		subdistrict: savedState?.addressForm?.subdistrict ?? '',
		district: savedState?.addressForm?.district ?? '',
		province: savedState?.addressForm?.province ?? '',
		postalCode: savedState?.addressForm?.postalCode ?? '',
		municipalityZone: savedState?.addressForm?.municipalityZone ?? '',
		community: savedState?.addressForm?.community ?? '',
		notes: savedState?.addressForm?.notes ?? ''
	});

	const provincesQuery = useProvinces();
	const districtsQuery = useDistricts(() => addressForm.province || null);
	const subdistrictsQuery = useSubdistricts(
		() => addressForm.province || null,
		() => addressForm.district || null
	);

	const provinceItems = $derived((provincesQuery.data ?? []).map((p) => ({ value: p, label: p })));
	const districtItems = $derived((districtsQuery.data ?? []).map((d) => ({ value: d, label: d })));
	const subdistrictItems = $derived(
		(subdistrictsQuery.data ?? []).map((s) => ({ value: s.subdistrict, label: s.subdistrict }))
	);

	function selectProvince(value: string | null) {
		addressForm.province = value ?? '';
		addressForm.district = '';
		addressForm.subdistrict = '';
		addressForm.postalCode = '';
	}

	function selectDistrict(value: string | null) {
		addressForm.district = value ?? '';
		addressForm.subdistrict = '';
		addressForm.postalCode = '';
	}

	function selectSubdistrict(value: string | null) {
		addressForm.subdistrict = value ?? '';
		const match = (subdistrictsQuery.data ?? []).find((s) => s.subdistrict === value);
		addressForm.postalCode = match ? String(match.zipcode) : '';
	}

	let petsList = $state<PetGroup[]>(savedState?.petsList ?? []);
	let vehicleRows = $state<HouseholdVehicle[]>(savedState?.vehicleRows ?? []);
	let assetDescription = $state(savedState?.assetDescription ?? '');

	const householdLabel = $derived(
		selectedHead ? `ครอบครัว${selectedHead.first_name} ${selectedHead.last_name}` : 'ครอบครัวใหม่'
	);

	// --- Save / Group Action ---
	async function handleSaveGrouping(zone: string) {
		if (isSubmitting) return;

		if (!selectedHead) {
			toast.error('กรุณาระบุหัวหน้าครัวเรือน');
			return;
		}

		if (
			!addressForm.addressNo.trim() ||
			!addressForm.subdistrict.trim() ||
			!addressForm.district.trim() ||
			!addressForm.province.trim()
		) {
			toast.error('กรุณากรอกข้อมูลที่อยู่ให้ครบถ้วน (บ้านเลขที่, ตำบล, อำเภอ, จังหวัด)');
			return;
		}

		isSubmitting = true;

		try {
			const ctx = {
				shelterCode: getShelterCode(),
				createdBy: authStore.user?.name ?? 'staff'
			};

			const selectedMemberIds = selectedMembers.map((m) => m._id);

			// 1. Double check validation conflicts
			for (const evacId of selectedMemberIds) {
				const evac = allEvacuees.find((e) => e._id === evacId);
				if (evac) {
					const conflict = checkEvacueeHhConflict(evac);
					if (conflict.conflicted) {
						throw new Error(
							`${evac.first_name} ${evac.last_name} สังกัดครัวเรือน "${conflict.label}" ที่ยังมีสมาชิกอื่นอยู่`
						);
					}
				}
			}

			// 2. Create Household in 'checked_in' state (Path C)
			const householdInput = {
				label: householdLabel.trim(),
				head_evacuee_id: selectedHead._id,
				status: 'checked_in' as const,
				checkout_destination: null,
				municipality_zone: addressForm.municipalityZone || null,
				community: addressForm.community || null,
				pets: petsList,
				vehicles: vehicleRows,
				assets: assetDescription.trim()
					? { description: assetDescription.trim(), image_url: null }
					: null,
				notes: addressForm.notes.trim() || undefined,
				address_no: addressForm.addressNo.trim() || null,
				village_no: addressForm.villageNo.trim() || null,
				subdistrict: addressForm.subdistrict.trim() || null,
				district: addressForm.district.trim() || null,
				province: addressForm.province.trim() || null,
				postal_code: addressForm.postalCode.trim() || null
			};

			const hhDoc = await createHouseholdMutation.mutateAsync({
				input: householdInput,
				ctx
			});

			createdHousehold = hhDoc;

			// 3. Link all selected members to the new household and assign zone
			const oldHouseholdIds: string[] = [];
			for (const evac of selectedMembers) {
				if (evac.household_id && !oldHouseholdIds.includes(evac.household_id)) {
					oldHouseholdIds.push(evac.household_id);
				}

				const updatedEvac: Evacuee = {
					...evac,
					household_id: hhDoc._id,
					current_stay: {
						...(evac.current_stay ?? {}),
						zone: zone || null
					}
				};

				const res = await updateEvacueeMutation.mutateAsync(updatedEvac);
				if (evac._id === selectedHead._id) {
					selectedHead = res;
				}
				selectedMembers = selectedMembers.map((m) => (m._id === evac._id ? res : m));
			}

			// 4. Soft-delete / Cancel old households that have become empty
			for (const oldHhId of oldHouseholdIds) {
				const remaining = allEvacuees.filter(
					(e) => e.household_id === oldHhId && !selectedMemberIds.includes(e._id)
				);
				if (remaining.length === 0) {
					const freshHh = await peopleRepository().getHousehold(oldHhId);
					if (freshHh && freshHh.status !== 'cancelled' && freshHh.status !== 'checked_out') {
						await updateHouseholdMutation.mutateAsync({
							...freshHh,
							status: 'cancelled'
						});
					}
				}
			}

			toast.success(`จัดกลุ่มครัวเรือน "${hhDoc.label}" สำเร็จ`);
			step = 6;
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			toast.error(`เกิดข้อผิดพลาดในการบันทึก: ${msg}`);
		} finally {
			isSubmitting = false;
		}
	}
</script>

<svelte:head>
	<title>จัดกลุ่มครัวเรือนหลังเข้าพัก (Path C) · SmartShelter</title>
</svelte:head>

<div class="mx-auto w-full max-w-7xl px-4 py-8 md:px-6">
	<!-- Top Navigation -->
	<div class="mb-6">
		<button
			type="button"
			class="inline-flex cursor-pointer items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground hover:underline"
			onclick={() => goto(resolve('/back-office/evacuee-management?tab=household'))}
		>
			<ArrowLeft class="size-4" />
			<span>กลับหน้ารายการครัวเรือนหลัก</span>
		</button>
		<h2 class="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-50">
			จัดกลุ่มครัวเรือนหลังเข้าพัก (Post-arrival grouping - Path C)
		</h2>
	</div>

	<!-- Step Progress Indicator -->
	<div class="mx-auto mb-8 flex max-w-5xl items-start">
		{#each [1, 2, 3, 4, 5, 6] as s (s)}
			<div class="flex flex-1 flex-col items-center gap-2">
				<div class="flex w-full items-center">
					<!-- left connector -->
					<div
						class="h-0.5 flex-1 transition-colors {s === 1
							? 'invisible'
							: step >= s
								? 'bg-green-500'
								: 'bg-border'}"
					></div>
					<!-- circle -->
					<div
						class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-bold transition-colors {step ===
						s
							? 'bg-primary text-primary-foreground ring-4 ring-primary/20'
							: step > s
								? 'bg-green-600 text-white'
								: 'bg-muted text-muted-foreground'}"
					>
						{step > s ? '✓' : s}
					</div>
					<!-- right connector -->
					<div
						class="h-0.5 flex-1 transition-colors {s === 6
							? 'invisible'
							: step > s
								? 'bg-green-500'
								: 'bg-border'}"
					></div>
				</div>
				<!-- label below -->
				<span
					class="hidden text-center text-xs leading-tight font-medium sm:block {step === s
						? 'font-semibold text-foreground'
						: step > s
							? 'text-green-700'
							: 'text-muted-foreground'}"
				>
					{s === 1
						? 'เลือกหัวหน้าครัวเรือน'
						: s === 2
							? 'เลือกสมาชิกครัวเรือน'
							: s === 3
								? 'ระบุที่อยู่ครัวเรือน'
								: s === 4
									? 'ทรัพย์สินและสัตว์เลี้ยง'
									: s === 5
										? 'เลือกโซนพักพิง'
										: 'จัดกลุ่มสำเร็จ & QR Code'}
				</span>
			</div>
		{/each}
	</div>

	<!-- ────────────────── STEP 1: Select Head ────────────────── -->
	{#if step === 1}
		<HouseholdPostArrivalHead
			bind:selectedHead
			{allHouseholds}
			{allEvacuees}
			onScanClick={() => {
				scannerTarget = 'head';
				cameraError = null;
				showScanner = true;
			}}
			onCancel={() => goto(resolve('/back-office/evacuee-management?tab=household'))}
			onNext={() => (step = 2)}
			onViewProfile={handleViewProfile}
		/>
	{/if}

	<!-- ────────────────── STEP 2: Add Members ────────────────── -->
	{#if step === 2}
		<HouseholdPostArrivalMembers
			{selectedHead}
			bind:selectedMembers
			{allHouseholds}
			{allEvacuees}
			onScanClick={() => {
				scannerTarget = 'member';
				cameraError = null;
				showScanner = true;
			}}
			onBack={() => (step = 1)}
			onNext={() => (step = 3)}
			onViewProfile={handleViewProfile}
		/>
	{/if}

	<!-- ────────────────── STEP 3: Household Address Form ────────────────── -->
	{#if step === 3}
		<div class="mx-auto w-full max-w-3xl space-y-6">
			<div class="space-y-2">
				<h3 class="text-lg font-bold text-foreground">3. ระบุข้อมูลที่อยู่ครัวเรือน</h3>
				<p class="text-sm text-muted-foreground">
					กรอกข้อมูลที่อยู่หลักตามภูมิลำเนา และข้อมูลโซนหรือชุมชนในศูนย์ของครัวเรือนนี้
				</p>
			</div>

			<!-- ข้อมูลครัวเรือนเบื้องต้น -->
			<div class="space-y-4 rounded-xl border border-border bg-card p-6 shadow-xs">
				<h4 class="text-base font-bold text-slate-800">ข้อมูลครัวเรือนเบื้องต้น</h4>
				<div class="space-y-4">
					<div class="space-y-1.5">
						<Label for="hh-label">ชื่อเรียกครัวเรือน</Label>
						<Input
							id="hh-label"
							value={householdLabel}
							disabled
							class="bg-muted text-muted-foreground"
						/>
					</div>

					<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
						<div class="space-y-1.5">
							<Label for="municipality-zone">เขตเทศบาล (Zone)</Label>
							<select
								id="municipality-zone"
								bind:value={addressForm.municipalityZone}
								class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
							>
								<option value="">-- ไม่ระบุ --</option>
								{#each municipalityZoneItems as mz (mz.value)}
									<option value={mz.value}>{mz.label}</option>
								{/each}
							</select>
						</div>
						<div class="space-y-1.5">
							<Label for="community">ชุมชนในศูนย์ (Community)</Label>
							<select
								id="community"
								bind:value={addressForm.community}
								class="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-50"
							>
								<option value="">-- ไม่ระบุ --</option>
								{#each communityItems as comm (comm.value)}
									<option value={comm.value}>{comm.label}</option>
								{/each}
							</select>
						</div>
					</div>
				</div>
			</div>

			<!-- ที่อยู่หลักตามภูมิลำเนา -->
			<div class="space-y-4 rounded-xl border border-border bg-card p-6 shadow-xs">
				<h4 class="text-base font-bold text-slate-800">ข้อมูลที่อยู่หลักตามภูมิลำเนา</h4>
				<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
					<div class="space-y-1.5">
						<Label for="address-no">บ้านเลขที่ <span class="text-destructive">*</span></Label>
						<Input
							id="address-no"
							placeholder="เช่น 12/34"
							bind:value={addressForm.addressNo}
							required
						/>
					</div>
					<div class="space-y-1.5">
						<Label for="village-no">หมู่ที่ / ซอย / ถนน</Label>
						<Input
							id="village-no"
							placeholder="เช่น หมู่ที่ 5"
							bind:value={addressForm.villageNo}
						/>
					</div>
					<div class="space-y-1.5">
						<Label>จังหวัด <span class="text-destructive">*</span></Label>
						<Combobox
							items={provinceItems}
							bind:value={() => addressForm.province, selectProvince}
							placeholder={provincesQuery.isLoading ? 'กำลังโหลด...' : 'เลือกจังหวัด...'}
							searchPlaceholder="ค้นหาจังหวัด..."
							emptyText="ไม่พบจังหวัด"
							disabled={provincesQuery.isLoading}
						/>
					</div>
					<div class="space-y-1.5">
						<Label>อำเภอ / เขต <span class="text-destructive">*</span></Label>
						<Combobox
							items={districtItems}
							bind:value={() => addressForm.district, selectDistrict}
							placeholder={!addressForm.province
								? 'เลือกจังหวัดก่อน'
								: districtsQuery.isLoading
									? 'กำลังโหลด...'
									: 'เลือกอำเภอ...'}
							searchPlaceholder="ค้นหาอำเภอ..."
							emptyText="ไม่พบอำเภอ"
							disabled={!addressForm.province || districtsQuery.isLoading}
						/>
					</div>
					<div class="space-y-1.5">
						<Label>ตำบล / แขวง <span class="text-destructive">*</span></Label>
						<Combobox
							items={subdistrictItems}
							bind:value={() => addressForm.subdistrict, selectSubdistrict}
							placeholder={!addressForm.district
								? 'เลือกอำเภอก่อน'
								: subdistrictsQuery.isLoading
									? 'กำลังโหลด...'
									: 'เลือกตำบล...'}
							searchPlaceholder="ค้นหาตำบล..."
							emptyText="ไม่พบตำบล"
							disabled={!addressForm.district || subdistrictsQuery.isLoading}
						/>
					</div>
					<div class="space-y-1.5">
						<Label for="postal-code">รหัสไปรษณีย์</Label>
						<Input
							id="postal-code"
							placeholder={!addressForm.subdistrict ? 'เลือกตำบลก่อน' : 'เช่น 90110'}
							disabled={!addressForm.subdistrict}
							bind:value={addressForm.postalCode}
						/>
					</div>
				</div>
			</div>

			<!-- บันทึกเพิ่มเติม -->
			<div class="space-y-4 rounded-xl border border-border bg-card p-6 shadow-xs">
				<Label for="notes" class="text-base font-bold text-slate-800">บันทึกเพิ่มเติม</Label>
				<Textarea
					id="notes"
					placeholder="ระบุหมายเหตุ หรือรายละเอียดอื่นๆ..."
					bind:value={addressForm.notes}
					class="min-h-[80px]"
				/>
			</div>

			<!-- Navigation -->
			<div class="mt-8 flex justify-between border-t border-border pt-4">
				<Button variant="outline" onclick={() => (step = 2)} class="h-11 px-8 font-semibold">
					ย้อนกลับ
				</Button>
				<Button
					onclick={() => {
						if (
							!addressForm.addressNo.trim() ||
							!addressForm.subdistrict.trim() ||
							!addressForm.district.trim() ||
							!addressForm.province.trim()
						) {
							toast.error('กรุณากรอกข้อมูลที่อยู่ให้ครบถ้วน (บ้านเลขที่, ตำบล, อำเภอ, จังหวัด)');
							return;
						}
						step = 4;
					}}
					class="h-11 bg-[#0d2240] px-8 font-semibold text-white hover:bg-[#1a3a5c]"
				>
					ถัดไป (ทรัพย์สินและสัตว์เลี้ยง) →
				</Button>
			</div>
		</div>
	{/if}

	<!-- ────────────────── STEP 4: Assets & Pets Form ────────────────── -->
	{#if step === 4}
		<div class="mx-auto w-full max-w-5xl">
			<EvacueePetAssetVehicle
				onBack={() => (step = 3)}
				onNext={(data) => {
					petsList = data.pets;
					assetDescription = data.assetDescription;
					vehicleRows = data.vehicles;
					step = 5;
				}}
			/>
		</div>
	{/if}

	<!-- ────────────────── STEP 5: Zone Selection ────────────────── -->
	{#if step === 5}
		<div class="mx-auto max-w-xl">
			<EvacueeSelectZone
				evacuee={selectedHead}
				onBack={() => (step = 4)}
				onSubmit={(zone) => {
					handleSaveGrouping(zone);
				}}
			/>
		</div>
	{/if}

	<!-- ────────────────── STEP 6: Success & Summary ────────────────── -->
	{#if step === 6 && createdHousehold}
		<HouseholdPostArrivalSummary
			{createdHousehold}
			{selectedHead}
			{selectedMembers}
			{qrUrl}
			onFinish={() => goto(resolve('/back-office/evacuee-management?tab=household'))}
		/>
	{/if}
</div>

{#if showScanner}
	<Dialog.Root
		open={showScanner}
		onOpenChange={(open) => {
			if (!open) showScanner = false;
		}}
	>
		<Dialog.Content class="flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl p-6">
			<Dialog.Header class="border-b pb-4">
				<Dialog.Title class="flex items-center gap-2 text-base font-black">
					<Scan class="size-5 text-emerald-500" />
					สแกนรหัส QR ประจำตัว
				</Dialog.Title>
			</Dialog.Header>

			<div class="my-6 flex flex-col items-center justify-center">
				<div
					class="relative flex aspect-square w-full max-w-[260px] items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50 dark:border-slate-800 dark:bg-slate-950"
				>
					{#if !cameraError}
						<div
							id="modal-qr-reader"
							class="h-full w-full overflow-hidden rounded-2xl [&_video]:h-full! [&_video]:w-full! [&_video]:rounded-2xl! [&_video]:bg-transparent! [&_video]:object-cover!"
							{@attach cameraAttachment}
						></div>

						<div class="pointer-events-none absolute inset-4">
							<div
								class="absolute top-0 left-0 h-6 w-6 rounded-tl-md border-t-4 border-l-4 border-emerald-500/80"
							></div>
							<div
								class="absolute top-0 right-0 h-6 w-6 rounded-tr-md border-t-4 border-r-4 border-emerald-500/80"
							></div>
							<div
								class="absolute bottom-0 left-0 h-6 w-6 rounded-bl-md border-b-4 border-l-4 border-emerald-500/80"
							></div>
							<div
								class="absolute right-0 bottom-0 h-6 w-6 rounded-br-md border-r-4 border-b-4 border-emerald-500/80"
							></div>
						</div>
					{:else}
						<div class="flex flex-col items-center justify-center p-6 text-center text-red-500">
							<CameraOff class="mb-3 size-12" />
							<p class="text-xs font-semibold">{cameraError}</p>
						</div>
					{/if}
				</div>
				<p class="mt-4 text-xs text-muted-foreground">
					ส่อง QR Code ที่สายรัดข้อมือหรือบัตรประจำตัวเพื่อเลือก
				</p>
			</div>

			<Dialog.Footer>
				<Button variant="outline" onclick={() => (showScanner = false)} class="w-full">
					ปิดกล้อง
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
