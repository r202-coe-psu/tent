<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import Clock from '@lucide/svelte/icons/clock';
	import Circle from '@lucide/svelte/icons/circle';
	import FilePenLine from '@lucide/svelte/icons/file-pen-line';
	import UserPlus from '@lucide/svelte/icons/user-plus';

	import {
		useEvacuees,
		useHouseholds,
		useMedicals,
		useScreenings,
		useMovements,
		useCreateMedical,
		usePatchMedical,
		useDeleteMedical,
		useCreateScreening,
		usePatchEvacuee,
		usePatchHousehold,
		isActiveHouseholdStatus
	} from '$lib/features/people';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import type {
		StayStatus,
		PetGroup,
		HouseholdVehicle,
		MovementAction
	} from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { useSaveImage } from '$lib/features/images';
	import { now } from '$lib/db/model';

	import EvacueeProfileHeaderCard from './evacuee-profile-header-card.svelte';
	import EvacueeProfileZoneCard from './evacuee-profile-zone-card.svelte';
	import EvacueeProfilePersonalCard from './evacuee-profile-personal-card.svelte';
	import EvacueeProfileEmergencyCard from './evacuee-profile-emergency-card.svelte';
	import EvacueeProfileHealthCard from './evacuee-profile-health-card.svelte';
	import EvacueeProfileHouseholdCard from './evacuee-profile-household-card.svelte';
	import EvacueeProfileAssetsCard from './evacuee-profile-assets-card.svelte';
	import EvacueeZoneModal from './evacuee-zone-modal.svelte';
	import EvacueeStatusModal from './evacuee-status-modal.svelte';
	import EvacueeQrModal from './evacuee-qr-modal.svelte';
	import EvacueeAddressModal from './evacuee-address-modal.svelte';
	import EvacueeAssetsModal from './evacuee-assets-modal.svelte';
	import EvacueePersonalModal, {
		type EvacueePersonalEditData
	} from './evacuee-personal-modal.svelte';
	import EvacueeEmergencyModal, {
		type EvacueeEmergencyEditData
	} from './evacuee-emergency-modal.svelte';
	import EvacueeHealthModal, { type EvacueeHealthEditData } from './evacuee-health-modal.svelte';
	import EvacueeHouseholdModal, {
		type EvacueeHouseholdEditData
	} from './evacuee-household-modal.svelte';

	let { evacueeId, readonly = false }: { evacueeId: string; readonly?: boolean } = $props();

	const statusConfig: Partial<
		Record<StayStatus, { label: string; colorClass: string; dotClass: string }>
	> = {
		active: {
			label: 'พักพิงในศูนย์ (Active)',
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
		temporary_leave: {
			label: 'ออกชั่วคราว (Temporary Leave)',
			colorClass:
				'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
			dotClass: 'bg-amber-500'
		},
		transferred: {
			label: 'ส่งต่อ / ย้ายศูนย์ (Transferred)',
			colorClass:
				'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800',
			dotClass: 'bg-purple-500'
		},
		checked_out: {
			label: 'ย้ายออก / กลับภูมิลำเนา (Checked-out)',
			colorClass:
				'bg-red-100 dark:bg-red-950 text-red-700 dark:text-red-300 border-red-200 dark:border-red-800',
			dotClass: 'bg-red-500'
		},
		deceased: {
			label: 'เสียชีวิต (Deceased)',
			colorClass:
				'bg-slate-200 dark:bg-slate-900 text-slate-900 dark:text-slate-100 border-slate-300 dark:border-slate-700',
			dotClass: 'bg-black'
		}
	};

	const evacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	const medicalsQuery = useMedicals();
	const screeningsQuery = useScreenings();
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const movementsQuery = useMovements();
	const patchEvacueeMutation = usePatchEvacuee();
	const patchHouseholdMutation = usePatchHousehold();
	const createMedicalMutation = useCreateMedical();
	const patchMedicalMutation = usePatchMedical();
	const deleteMedicalMutation = useDeleteMedical();
	const createScreeningMutation = useCreateScreening();
	const saveImageMutation = useSaveImage();

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
			? (screeningsQuery.data
					.filter((s) => s.evacuee_id === evacuee._id)
					.sort((a, b) =>
						(b.screened_at ?? b.created_at).localeCompare(a.screened_at ?? a.created_at)
					)[0] ?? null)
			: null
	);
	const shelterName = $derived(shelterQuery.data?.name ?? 'ศูนย์พักพิงชั่วคราว');
	const shelterZones = $derived(shelterQuery.data?.zones ?? []);
	const statusInfo = $derived(
		evacuee
			? (statusConfig[evacuee.current_stay.status] ?? {
					label: 'ลงทะเบียนล่วงหน้า (Pre-registered)',
					colorClass:
						'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
					dotClass: 'bg-blue-500'
				})
			: null
	);
	const familyMembers = $derived(
		evacuee && evacuee.household_id && evacueesQuery.data
			? evacueesQuery.data.filter(
					(e) => e.household_id === evacuee.household_id && e._id !== evacuee._id
				)
			: []
	);

	// Append-only movement stream for this evacuee, newest first (schema.md §1.1).
	const movements = $derived(
		evacuee && movementsQuery.data
			? movementsQuery.data
					.filter((m) => m.evacuee_id === evacuee._id)
					.sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
			: []
	);

	const movementLabels: Record<MovementAction, { dotClass: string; label: string }> = {
		check_in: { dotClass: 'fill-emerald-500 text-emerald-500', label: 'เช็คอิน (Check-in)' },
		check_out: {
			dotClass: 'fill-slate-400 text-slate-400',
			label: 'ย้ายออก/กลับภูมิลำเนา (Checked-out)'
		},
		transfer_in: { dotClass: 'fill-blue-500 text-blue-500', label: 'ย้ายเข้า (Transfer in)' },
		transfer_out: { dotClass: 'fill-violet-500 text-violet-500', label: 'ย้ายออก (Transfer out)' },
		leave_temporary: {
			dotClass: 'fill-amber-500 text-amber-500',
			label: 'ออกชั่วคราว (Temporary leave)'
		},
		return_from_leave: {
			dotClass: 'fill-emerald-500 text-emerald-500',
			label: 'กลับจากออกชั่วคราว (Return from leave)'
		},
		mark_deceased: {
			dotClass: 'fill-slate-950 text-slate-950 dark:fill-slate-100 dark:text-slate-100',
			label: 'เสียชีวิต (Deceased)'
		}
	};

	const isLoading = $derived(
		evacueesQuery.isLoading ||
			householdsQuery.isLoading ||
			medicalsQuery.isLoading ||
			screeningsQuery.isLoading
	);

	// Audit log — show a limited page of movements at a time, expand on demand
	const MOVEMENTS_PAGE_SIZE = 5;
	let visibleMovementsCount = $state(MOVEMENTS_PAGE_SIZE);

	$effect(() => {
		void evacueeId;
		visibleMovementsCount = MOVEMENTS_PAGE_SIZE;
	});

	const visibleMovements = $derived(movements.slice(0, visibleMovementsCount));
	const hasMoreMovements = $derived(movements.length > visibleMovementsCount);

	// Modal visibility state
	let showZoneModal = $state(false);
	let showStatusModal = $state(false);
	let showQrModal = $state(false);
	let showAddressModal = $state(false);
	let showAssetModal = $state(false);
	let showPersonalModal = $state(false);
	let showEmergencyModal = $state(false);
	let showHealthModal = $state(false);
	let showHouseholdModal = $state(false);

	async function updateZone(zoneCode: string) {
		if (!evacuee) return;
		try {
			await patchEvacueeMutation.mutateAsync({
				id: evacuee._id,
				patch: { current_stay: { ...evacuee.current_stay, zone: zoneCode, since: now() } }
			});
			toast.success(`ย้ายโซนเป็น ${zoneCode.toUpperCase()} เรียบร้อย`);
			showZoneModal = false;
		} catch (err: unknown) {
			toast.error(`ไม่สามารถย้ายโซนได้: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async function updateStatus(status: StayStatus) {
		if (!evacuee) return;
		try {
			await patchEvacueeMutation.mutateAsync({
				id: evacuee._id,
				patch: { current_stay: { ...evacuee.current_stay, status, since: now() } }
			});
			toast.success('อัปเดตสถานะการพักพิงเรียบร้อย');
			showStatusModal = false;
		} catch (err: unknown) {
			toast.error(`ไม่สามารถอัปเดตสถานะได้: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async function saveAddress(data: {
		addressNo: string;
		villageNo: string;
		subdistrict: string;
		district: string;
		province: string;
		postalCode: string;
	}) {
		if (!household) {
			toast.error('ไม่พบข้อมูลครัวเรือนสำหรับบันทึกที่อยู่');
			return;
		}
		try {
			await patchHouseholdMutation.mutateAsync({
				id: household._id,
				patch: {
					address_no: data.addressNo || null,
					village_no: data.villageNo || null,
					subdistrict: data.subdistrict || null,
					district: data.district || null,
					province: data.province || null,
					postal_code: data.postalCode || null
				}
			});
			toast.success('แก้ไขที่อยู่ครัวเรือนสำเร็จ');
			showAddressModal = false;
		} catch (err: unknown) {
			toast.error(`ไม่สามารถบันทึกที่อยู่ได้: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async function saveAssets(data: {
		vehicles: HouseholdVehicle[];
		valuables: string;
		pets: PetGroup[];
	}) {
		if (!household) {
			toast.error('ไม่พบข้อมูลครัวเรือนสำหรับบันทึกทรัพย์สิน');
			return;
		}
		try {
			await patchHouseholdMutation.mutateAsync({
				id: household._id,
				patch: {
					vehicles: data.vehicles,
					assets: data.valuables ? { description: data.valuables, image_url: null } : null,
					pets: data.pets.filter((p) => p.count > 0)
				}
			});
			toast.success('แก้ไขข้อมูลทรัพย์สินและสัตว์เลี้ยงสำเร็จ');
			showAssetModal = false;
		} catch (err: unknown) {
			toast.error(`ไม่สามารถบันทึกข้อมูลได้: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	async function savePersonal(data: EvacueePersonalEditData) {
		if (!evacuee) return;
		try {
			let photo = data.removePhoto ? null : evacuee.photo;
			if (data.photoFile) {
				const image = await saveImageMutation.mutateAsync({
					file: data.photoFile,
					ctx: {
						shelterCode: getShelterCode(),
						createdBy: authStore.user?.name ?? 'unknown'
					},
					caption: `${data.firstName} ${data.lastName}`
				});
				photo = image._id;
			}

			await patchEvacueeMutation.mutateAsync({
				id: evacuee._id,
				patch: {
					first_name: data.firstName,
					last_name: data.lastName,
					nickname: data.nickname || undefined,
					birth_year: data.birthYear,
					age: data.age,
					gender: data.gender,
					phone: data.phone,
					person_id: { cardType: data.cardType, number: data.cardNumber || undefined },
					country: data.country,
					religion: data.religion,
					photo
				}
			});
			toast.success('บันทึกข้อมูลส่วนบุคคลเรียบร้อย');
			showPersonalModal = false;
		} catch (err: unknown) {
			toast.error(
				`ไม่สามารถบันทึกข้อมูลส่วนบุคคลได้: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}

	async function saveEmergency(data: EvacueeEmergencyEditData) {
		if (!evacuee) return;
		try {
			await patchEvacueeMutation.mutateAsync({
				id: evacuee._id,
				patch: { emergency_contact: data.emergencyContact }
			});
			toast.success('บันทึกข้อมูลติดต่อฉุกเฉินเรียบร้อย');
			showEmergencyModal = false;
		} catch (err: unknown) {
			toast.error(
				`ไม่สามารถบันทึกข้อมูลติดต่อฉุกเฉินได้: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}

	async function saveHealth(data: EvacueeHealthEditData) {
		if (!evacuee) return;
		const medicalPatch = {
			blood_group: data.bloodGroup,
			conditions: data.conditions,
			medications: data.medications,
			allergies: data.allergies,
			track: data.careTrack,
			notes: data.medicalNotes || undefined
		};
		const medicalHasValues =
			data.conditions.length > 0 ||
			data.medications.length > 0 ||
			data.allergies.length > 0 ||
			data.medicalNotes.length > 0 ||
			data.bloodGroup !== 'unknown' ||
			data.careTrack === 'fast_track';
		const medicalChanged =
			!medical ||
			medical.blood_group !== data.bloodGroup ||
			JSON.stringify(medical.conditions) !== JSON.stringify(data.conditions) ||
			JSON.stringify(medical.medications) !== JSON.stringify(data.medications) ||
			JSON.stringify(medical.allergies) !== JSON.stringify(data.allergies) ||
			medical.track !== data.careTrack ||
			(medical.notes ?? '') !== data.medicalNotes;
		const specialNeedsChanged =
			JSON.stringify(evacuee.special_needs) !== JSON.stringify(data.specialNeeds);
		const nextSymptoms = data.ewarSymptoms;
		const screeningChanged =
			!screening ||
			JSON.stringify(screening.symptoms) !== JSON.stringify(nextSymptoms) ||
			screening.temperature_c !== data.temperatureC ||
			screening.needs_referral !== data.referral ||
			screening.track !== data.careTrack ||
			(screening.notes ?? '') !== data.screeningNotes;
		const screeningHasValues =
			nextSymptoms.length > 0 ||
			data.temperatureC !== null ||
			data.referral ||
			data.screeningNotes.length > 0;

		let patchedEvacuee = false;
		let patchedMedical = false;
		let createdMedicalId: string | null = null;
		try {
			if ((medical || medicalHasValues) && medicalChanged) {
				if (medical) {
					await patchMedicalMutation.mutateAsync({
						id: medical._id,
						patch: medicalPatch
					});
					patchedMedical = true;
				} else {
					const created = await createMedicalMutation.mutateAsync({
						input: { evacuee_id: evacuee._id, ...medicalPatch },
						ctx: {
							shelterCode: getShelterCode(),
							createdBy: authStore.user?.name ?? 'unknown'
						}
					});
					createdMedicalId = created._id;
				}
			}

			if (specialNeedsChanged) {
				await patchEvacueeMutation.mutateAsync({
					id: evacuee._id,
					patch: { special_needs: data.specialNeeds }
				});
				patchedEvacuee = true;
			}

			if (screeningChanged && (screening || screeningHasValues)) {
				await createScreeningMutation.mutateAsync({
					input: {
						evacuee_id: evacuee._id,
						symptoms: nextSymptoms,
						temperature_c: data.temperatureC,
						track: data.careTrack,
						needs_referral: data.referral,
						notes: data.screeningNotes || undefined
					},
					ctx: {
						shelterCode: getShelterCode(),
						createdBy: authStore.user?.name ?? 'unknown'
					}
				});
			}
			toast.success('บันทึกข้อมูลสุขภาพเรียบร้อย');
			showHealthModal = false;
		} catch (err: unknown) {
			const rollbacks: Promise<unknown>[] = [];
			if (patchedEvacuee) {
				rollbacks.push(
					patchEvacueeMutation.mutateAsync({
						id: evacuee._id,
						patch: { special_needs: evacuee.special_needs }
					})
				);
			}
			if (patchedMedical && medical) {
				rollbacks.push(
					patchMedicalMutation.mutateAsync({
						id: medical._id,
						patch: {
							blood_group: medical.blood_group,
							conditions: medical.conditions,
							medications: medical.medications,
							allergies: medical.allergies,
							track: medical.track,
							notes: medical.notes
						}
					})
				);
			}
			if (createdMedicalId) rollbacks.push(deleteMedicalMutation.mutateAsync(createdMedicalId));
			const rollbackResults = await Promise.allSettled(rollbacks);
			const rollbackFailed = rollbackResults.some((result) => result.status === 'rejected');
			toast.error(
				rollbackFailed
					? `บันทึกข้อมูลสุขภาพได้บางส่วน กรุณารีเฟรชและตรวจสอบอีกครั้ง: ${err instanceof Error ? err.message : String(err)}`
					: `ไม่สามารถบันทึกข้อมูลสุขภาพได้ ระบบคืนค่าการเปลี่ยนแปลงแล้ว: ${err instanceof Error ? err.message : String(err)}`
			);
		}
	}

	async function saveHousehold(data: EvacueeHouseholdEditData) {
		if (!evacuee) return;
		try {
			const previousHousehold = household;
			await patchEvacueeMutation.mutateAsync({
				id: evacuee._id,
				patch: { household_id: data.householdId }
			});
			if (
				previousHousehold &&
				previousHousehold.head_evacuee_id === evacuee._id &&
				(!data.setAsHead || data.householdId !== previousHousehold._id) &&
				(data.householdId === previousHousehold._id ||
					!isActiveHouseholdStatus(previousHousehold.status))
			) {
				await patchHouseholdMutation.mutateAsync({
					id: previousHousehold._id,
					patch: { head_evacuee_id: null }
				});
			}
			const targetHousehold = data.householdId
				? householdsQuery.data?.find((item) => item._id === data.householdId)
				: null;
			if (targetHousehold && data.setAsHead && targetHousehold.head_evacuee_id !== evacuee._id) {
				await patchHouseholdMutation.mutateAsync({
					id: targetHousehold._id,
					patch: { head_evacuee_id: evacuee._id }
				});
			}

			toast.success('บันทึกสังกัดครัวเรือนเรียบร้อย');
			showHouseholdModal = false;
		} catch (err: unknown) {
			toast.error(
				`ไม่สามารถบันทึกสังกัดครัวเรือนได้: ${err instanceof Error ? err.message : String(err)}`
			);
		}
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
		class="flex flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card py-20"
	>
		<div
			class="h-10 w-10 animate-spin rounded-full border-4 border-primary border-t-transparent"
		></div>
		<p class="text-sm font-medium text-muted-foreground">กำลังโหลดข้อมูลผู้พักพิง...</p>
	</div>
{:else if !evacuee}
	<div class="space-y-4 rounded-lg border border-border bg-card py-16 text-center">
		<p class="text-base font-semibold text-destructive">ไม่พบข้อมูลผู้พักพิงในระบบ</p>
		<button
			class="inline-flex cursor-pointer items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted"
			onclick={() => goto(resolve('/back-office/evacuee-management'))}
		>
			กลับหน้าหลัก
		</button>
	</div>
{:else}
	<div class="space-y-5">
		<!-- Header -->
		<EvacueeProfileHeaderCard
			{evacuee}
			{medical}
			{screening}
			{statusInfo}
			{readonly}
			onOpenProfileEdit={() => (showPersonalModal = true)}
			onOpenZoneModal={() => (showZoneModal = true)}
			onOpenStatusModal={() => (showStatusModal = true)}
			onOpenQrModal={() => (showQrModal = true)}
		/>

		<!-- Two-column body -->
		<div class="grid grid-cols-1 items-start gap-5 lg:grid-cols-12">
			<!-- Left column -->
			<div class="space-y-4 lg:col-span-5">
				<h2 class="px-1 text-sm font-bold text-foreground">ข้อมูลบุคคลและตำแหน่งพักพิง</h2>
				<EvacueeProfileZoneCard
					{evacuee}
					{shelterName}
					{readonly}
					onOpenEdit={() => (showZoneModal = true)}
				/>
				<EvacueeProfilePersonalCard
					{evacuee}
					{readonly}
					onOpenEdit={() => (showPersonalModal = true)}
				/>
				<EvacueeProfileEmergencyCard
					{evacuee}
					{readonly}
					onOpenEdit={() => (showEmergencyModal = true)}
				/>
			</div>

			<!-- Right column -->
			<div class="space-y-4 lg:col-span-7">
				<h2 class="px-1 text-sm font-bold text-foreground">สุขภาพ ครัวเรือน และทรัพย์สิน</h2>
				<EvacueeProfileHealthCard
					{evacuee}
					{medical}
					{screening}
					{readonly}
					onOpenEdit={() => (showHealthModal = true)}
				/>
				<EvacueeProfileHouseholdCard
					{evacuee}
					{household}
					{familyMembers}
					{readonly}
					onOpenHouseholdModal={() => (showHouseholdModal = true)}
					onOpenAddressModal={() => (showAddressModal = true)}
				/>
				<EvacueeProfileAssetsCard
					{household}
					{readonly}
					onOpenAssetModal={() => (showAssetModal = true)}
				/>
			</div>
		</div>

		<!-- Audit log — record metadata + movement events combined -->
		<section class="space-y-3 rounded-lg border border-border bg-card p-5">
			<div class="flex items-center gap-2.5 border-b border-border pb-2">
				<Clock class="size-4.5 text-primary" />
				<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">
					บันทึกการตรวจสอบ (Audit Log)
				</h3>
			</div>
			<ol class="space-y-2.5">
				{#if evacuee.updated_at && evacuee.updated_at !== evacuee.created_at}
					<li class="flex items-start gap-3 text-xs">
						<FilePenLine class="mt-0.5 size-4 text-blue-600" />
						<div class="flex-1 space-y-0.5">
							<div class="font-semibold text-foreground">แก้ไขข้อมูลล่าสุด (Updated)</div>
							<div class="text-muted-foreground">{formatDateTime(evacuee.updated_at)}</div>
						</div>
					</li>
				{/if}
				{#each visibleMovements as m (m._id)}
					<li class="flex items-start gap-3 text-xs">
						<Circle class="mt-1 size-3 {movementLabels[m.action].dotClass}" />
						<div class="flex-1 space-y-0.5">
							<div class="font-semibold text-foreground">
								{movementLabels[m.action].label}
								{#if m.zone}
									<span class="font-normal text-muted-foreground">
										· โซน {m.zone.toUpperCase()}
									</span>
								{/if}
							</div>
							<div class="text-muted-foreground">
								{formatDateTime(m.occurred_at)}
								{#if m.reason}
									· {m.reason}
								{/if}
							</div>
						</div>
					</li>
				{/each}
				{#if hasMoreMovements}
					<li>
						<button
							type="button"
							onclick={() => (visibleMovementsCount += MOVEMENTS_PAGE_SIZE)}
							class="cursor-pointer text-xs font-semibold text-primary transition-colors hover:text-primary/80"
						>
							โหลดเพิ่มเติม ({movements.length - visibleMovementsCount} รายการ)
						</button>
					</li>
				{/if}
				<li class="flex items-start gap-3 text-xs">
					<UserPlus class="mt-0.5 size-4 text-emerald-600" />
					<div class="flex-1 space-y-0.5">
						<div class="font-semibold text-foreground">ลงทะเบียนข้อมูล (Registered)</div>
						<div class="text-muted-foreground">
							{formatDateTime(evacuee.created_at)} · โดย {evacuee.created_by || 'system'}
						</div>
					</div>
				</li>
			</ol>
		</section>
	</div>

	<!-- Modals (edit mode only) -->
	{#if !readonly}
		<EvacueeZoneModal
			show={showZoneModal}
			{evacuee}
			{shelterZones}
			onClose={() => (showZoneModal = false)}
			onUpdateZone={updateZone}
		/>

		<EvacueeStatusModal
			show={showStatusModal}
			{evacuee}
			{statusConfig}
			onClose={() => (showStatusModal = false)}
			onUpdateStatus={updateStatus}
		/>

		<EvacueeQrModal show={showQrModal} {evacuee} onClose={() => (showQrModal = false)} />

		{#if showAddressModal && household}
			<EvacueeAddressModal
				show={showAddressModal}
				{household}
				onClose={() => (showAddressModal = false)}
				onSave={saveAddress}
			/>
		{/if}

		{#if showAssetModal && household}
			<EvacueeAssetsModal
				show={showAssetModal}
				{household}
				onClose={() => (showAssetModal = false)}
				onSave={saveAssets}
			/>
		{/if}

		{#if showPersonalModal}
			<EvacueePersonalModal
				show={showPersonalModal}
				{evacuee}
				onClose={() => (showPersonalModal = false)}
				onSave={savePersonal}
			/>
		{/if}

		{#if showEmergencyModal}
			<EvacueeEmergencyModal
				show={showEmergencyModal}
				{evacuee}
				onClose={() => (showEmergencyModal = false)}
				onSave={saveEmergency}
			/>
		{/if}

		{#if showHealthModal}
			<EvacueeHealthModal
				show={showHealthModal}
				{evacuee}
				{medical}
				{screening}
				onClose={() => (showHealthModal = false)}
				onSave={saveHealth}
			/>
		{/if}

		{#if showHouseholdModal}
			<EvacueeHouseholdModal
				show={showHouseholdModal}
				{evacuee}
				households={householdsQuery.data ?? []}
				onClose={() => (showHouseholdModal = false)}
				onSave={saveHousehold}
			/>
		{/if}
	{/if}
{/if}
