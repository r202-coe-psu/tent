<script lang="ts">
	import { toast } from 'svelte-sonner';
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import Clock from '@lucide/svelte/icons/clock';
	import Circle from '@lucide/svelte/icons/circle';
	import FilePenLine from '@lucide/svelte/icons/file-pen-line';
	import UserPlus from '@lucide/svelte/icons/user-plus';

	import {
		useEvacuee,
		useHousehold,
		useHouseholdMembers,
		useHouseholds,
		useMedicalByEvacuee,
		useScreeningsByEvacuee,
		useEvacueeQrPrints,
		vulnerabilityMarker,
		useMovementsByEvacuee,
		useCreateMedical,
		usePatchMedical,
		useDeleteMedical,
		useCreateScreening,
		usePatchEvacuee,
		usePatchHousehold,
		useChangeEvacueeZone,
		useCheckInEvacuee,
		useCheckOutEvacuee,
		useConfirmRoom,
		useRecordMovement,
		resolveStatusChangeAction,
		normalizeCheckoutRemark,
		statusChangeHandlerKind,
		canChangeEvacueeZone,
		formatPersonName,
		movementReasonLabel,
		zoneLabel
	} from '$lib/features/people';
	import {
		hasStaffCapability,
		isShelterManager,
		isSystemAdmin,
		shelterCodeFromRoles
	} from '$lib/auth/roles';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { formatDisplayDateTime } from '$lib/utils/date';
	import type {
		Evacuee,
		StayStatus,
		PetGroup,
		HouseholdVehicle,
		MovementAction
	} from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { useSaveImage } from '$lib/features/images';
	import { now } from '$lib/db/model';
	import { getTranslation } from '$lib/utils/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { EVACUEE_PROFILE_I18N } from '../_constants/evacuee-profile.i18n';
	import LoadingScreen from '$lib/components/loading-screen.svelte';

	import EvacueeProfileIdentityRail from './evacuee-profile-identity-rail.svelte';
	import EvacueeProfileMobileDock from './evacuee-profile-mobile-dock.svelte';
	import EvacueeProfileActionsSheet from './evacuee-profile-actions-sheet.svelte';
	import EvacueeProfileHealthCard from './evacuee-profile-health-card.svelte';
	import EvacueeProfileHouseholdCard from './evacuee-profile-household-card.svelte';
	import EvacueeProfileAssetsCard from './evacuee-profile-assets-card.svelte';
	import EvacueeProfilePrivacyCard from './evacuee-profile-privacy-card.svelte';
	import EvacueeZoneModal from './evacuee-zone-modal.svelte';
	import EvacueeStatusModal from './evacuee-status-modal.svelte';
	import EvacueeQrModal from './evacuee-qr-modal.svelte';
	import EvacueeQrStaleAlert from './evacuee-qr-stale-alert.svelte';
	import EvacueeHandoverSlipModal from './evacuee-handover-slip-modal.svelte';
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

	const t = $derived(getTranslation(EVACUEE_PROFILE_I18N, langState.current).view);

	const canEditProfile = $derived.by(() => {
		if (readonly || !authStore.user) return false;
		const roles = authStore.user.roles;
		if (isSystemAdmin(roles)) return true;

		const scopedShelter = shelterCodeFromRoles(roles);
		const currentShelter = (shelterStore.selectedShelterCode ?? getShelterCode()).toUpperCase();
		return (
			!!scopedShelter &&
			scopedShelter.toUpperCase() === currentShelter &&
			(isShelterManager(roles) || hasStaffCapability(roles, 'registration_staff'))
		);
	});
	const profileReadonly = $derived(readonly || !canEditProfile);

	const STATUS_STYLE: Record<StayStatus, { colorClass: string; dotClass: string }> = {
		active: {
			colorClass:
				'bg-green-100 dark:bg-green-950 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800',
			dotClass: 'bg-green-500'
		},
		room_confirmed: {
			colorClass:
				'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-200 border-emerald-200 dark:border-emerald-800',
			dotClass: 'bg-emerald-600'
		},
		pre_registered: {
			colorClass:
				'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800',
			dotClass: 'bg-blue-500'
		},
		kiosk_registered: {
			colorClass: 'bg-amber-50 text-amber-900 border-amber-200',
			dotClass: 'bg-amber-500'
		},
		arriving: {
			colorClass:
				'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
			dotClass: 'bg-amber-500'
		},
		temporary_leave: {
			colorClass:
				'bg-amber-100 dark:bg-amber-950 text-amber-700 dark:text-amber-300 border-amber-200 dark:border-amber-800',
			dotClass: 'bg-amber-500'
		},
		transferred: {
			colorClass:
				'bg-purple-100 dark:bg-purple-950 text-purple-700 dark:text-purple-300 border-purple-200 dark:border-purple-800',
			dotClass: 'bg-purple-500'
		},
		checked_out: {
			colorClass:
				'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-700',
			dotClass: 'bg-slate-400'
		},
		deceased: {
			colorClass:
				'bg-slate-200 dark:bg-slate-900 text-slate-900 dark:text-slate-100 border-slate-300 dark:border-slate-700',
			dotClass: 'bg-black'
		},
		cancelled: {
			colorClass:
				'bg-slate-100 dark:bg-slate-950 text-slate-500 dark:text-slate-400 border-slate-200 dark:border-slate-800',
			dotClass: 'bg-slate-400'
		}
	};

	/** Style (language-neutral) + label (staff language) for one stay status. */
	function statusEntry(status: StayStatus) {
		return { ...t.status[status], ...STATUS_STYLE[status] };
	}

	const statusConfig = $derived.by(() => {
		const config: Partial<
			Record<
				StayStatus,
				{ label: string; shortLabel: string; colorClass: string; dotClass: string }
			>
		> = {};
		for (const status of Object.keys(STATUS_STYLE) as StayStatus[]) {
			config[status] = statusEntry(status);
		}
		return config;
	});

	const evacueeQuery = useEvacuee(() => evacueeId);
	// Declared before any hook below that reads it in a getter — those hooks'
	// createQuery() options run eagerly at call time, not lazily on first access,
	// so referencing `evacuee` before this line throws a TDZ ReferenceError.
	const evacuee = $derived(evacueeQuery.data ?? null);
	const householdQuery = useHousehold(
		() => evacuee?.household_id ?? '',
		() => !!evacuee?.household_id
	);
	// Full household list is only needed by the "change household" picker modal,
	// but EvacueeHouseholdModal reads it synchronously on mount (its initial
	// `setAsHead` computation), so it must already be loaded by then — keep this
	// eager rather than gating it on the modal being open.
	const householdsQuery = useHouseholds();
	const householdMembersQuery = useHouseholdMembers(
		() => evacuee?.household_id ?? undefined,
		() => !!evacuee?.household_id
	);
	const medicalQuery = useMedicalByEvacuee(() => evacueeId);
	const screeningsQuery = useScreeningsByEvacuee(() => evacueeId);
	// Silent on error: the warning is advisory, the profile works without it (#1301).
	const qrPrintsQuery = useEvacueeQrPrints(() => evacueeId);
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const movementsQuery = useMovementsByEvacuee(() => evacueeId);
	const patchEvacueeMutation = usePatchEvacuee();
	const changeZoneMutation = useChangeEvacueeZone();
	const patchHouseholdMutation = usePatchHousehold();
	const checkInMutation = useCheckInEvacuee();
	const checkOutMutation = useCheckOutEvacuee();
	const confirmRoomMutation = useConfirmRoom();
	const recordMovementMutation = useRecordMovement();
	const createMedicalMutation = useCreateMedical();
	const patchMedicalMutation = usePatchMedical();
	const deleteMedicalMutation = useDeleteMedical();
	const createScreeningMutation = useCreateScreening();
	const saveImageMutation = useSaveImage();

	const household = $derived(householdQuery.data ?? null);
	const medical = $derived(medicalQuery.data ?? null);
	const screening = $derived(
		screeningsQuery.data
			? (screeningsQuery.data
					.slice()
					.sort((a, b) =>
						(b.screened_at ?? b.created_at).localeCompare(a.screened_at ?? a.created_at)
					)[0] ?? null)
			: null
	);
	const shelterName = $derived(shelterQuery.data?.name ?? t.defaultShelterName);
	const shelterZones = $derived(shelterQuery.data?.zones ?? []);
	const statusInfo = $derived(
		evacuee ? (statusConfig[evacuee.current_stay.status] ?? statusEntry('pre_registered')) : null
	);
	const householdMembers = $derived.by(() => {
		if (!evacuee?.household_id || !householdMembersQuery.data) return [];
		const headId = household?.head_evacuee_id ?? null;
		return householdMembersQuery.data.slice().sort((a, b) => {
			if (headId) {
				if (a._id === headId) return -1;
				if (b._id === headId) return 1;
			}
			return formatPersonName(a).localeCompare(formatPersonName(b), 'th');
		});
	});

	function viewHouseholdMember(id: string) {
		if (id === evacueeId) return;
		const pathname = page.url.pathname;
		if (pathname.includes('/onsite/')) {
			const existingFrom = page.url.searchParams.get('from');
			const parentPath = pathname.replace(/\/evacuee-profile-view\/[^/]+$/, '');
			const from = existingFrom || parentPath || '/onsite/people';
			goto(
				resolve(
					`/onsite/people/evacuee-profile-view/${id}?from=${encodeURIComponent(from)}` as `/onsite/people/evacuee-profile-view/${string}`
				)
			);
			return;
		}
		if (pathname.includes('/system-management/pre-registrations/evacuee/')) {
			const shelterCode =
				page.params.shelter ??
				pathname.match(/\/system-management\/pre-registrations\/evacuee\/([^/]+)\//)?.[1] ??
				shelterStore.selectedShelterCode ??
				getShelterCode();
			goto(
				resolve(
					`/system-management/pre-registrations/evacuee/${shelterCode}/${id}` as `/system-management/pre-registrations/evacuee/${string}/${string}`
				)
			);
			return;
		}
		goto(resolve(`/back-office/evacuee-management/edit/evacuee/${id}`));
	}

	// Append-only movement stream for this evacuee, newest first (schema.md §1.1).
	const movements = $derived(
		movementsQuery.data
			? movementsQuery.data.slice().sort((a, b) => b.occurred_at.localeCompare(a.occurred_at))
			: []
	);

	const MOVEMENT_DOT_CLASS: Record<MovementAction, string> = {
		check_in: 'fill-emerald-500 text-emerald-500',
		check_out: 'fill-slate-400 text-slate-400',
		confirm_room: 'fill-emerald-600 text-emerald-600',
		transfer_in: 'fill-blue-500 text-blue-500',
		transfer_out: 'fill-violet-500 text-violet-500',
		leave_temporary: 'fill-amber-500 text-amber-500',
		return_from_leave: 'fill-emerald-500 text-emerald-500',
		mark_deceased: 'fill-slate-950 text-slate-950 dark:fill-slate-100 dark:text-slate-100',
		zone_change: 'fill-amber-600 text-amber-600'
	};

	const isLoading = $derived(
		evacueeQuery.isLoading ||
			householdQuery.isLoading ||
			householdMembersQuery.isLoading ||
			medicalQuery.isLoading ||
			screeningsQuery.isLoading ||
			movementsQuery.isLoading ||
			shelterQuery.isLoading
	);

	// Audit log — show a limited page of movements at a time, expand on demand
	const MOVEMENTS_PAGE_SIZE = 5;
	let visibleCountByEvacueeId = $state<Record<string, number>>({});

	const visibleMovementsCount = $derived(visibleCountByEvacueeId[evacueeId] ?? MOVEMENTS_PAGE_SIZE);
	const visibleMovements = $derived(movements.slice(0, visibleMovementsCount));
	const hasMoreMovements = $derived(movements.length > visibleMovementsCount);

	function loadMoreMovements() {
		visibleCountByEvacueeId = {
			...visibleCountByEvacueeId,
			[evacueeId]: visibleMovementsCount + MOVEMENTS_PAGE_SIZE
		};
	}

	function getAuthorContext() {
		const createdBy = authStore.user?.name?.trim();
		if (!createdBy) {
			throw new Error(t.noCurrentUser);
		}
		return { shelterCode: getShelterCode(), createdBy };
	}

	// Modal / sheet visibility state
	let showActionsSheet = $state(false);
	let showZoneModal = $state(false);
	let showStatusModal = $state(false);
	let showQrModal = $state(false);
	let showHandoverSlip = $state(false);
	let showAddressModal = $state(false);
	let showAssetModal = $state(false);
	let showPersonalModal = $state(false);
	let showEmergencyModal = $state(false);
	let showHealthModal = $state(false);
	let showHouseholdModal = $state(false);

	/** Mobile: reveal compact action dock after the top identity header leaves the viewport. */
	let showMobileDock = $state(false);

	function observeMobileIdentityHeader(): import('svelte/attachments').Attachment {
		return (node) => {
			if (typeof IntersectionObserver === 'undefined') return;

			const mq = window.matchMedia('(max-width: 1023px)');
			let observer: IntersectionObserver | null = null;

			const sync = () => {
				observer?.disconnect();
				observer = null;
				if (!mq.matches) {
					showMobileDock = false;
					return;
				}
				observer = new IntersectionObserver(
					([entry]) => {
						showMobileDock = entry ? !entry.isIntersecting : false;
					},
					{ root: null, threshold: 0, rootMargin: '0px' }
				);
				observer.observe(node);
			};

			sync();
			mq.addEventListener('change', sync);
			return () => {
				mq.removeEventListener('change', sync);
				observer?.disconnect();
				showMobileDock = false;
			};
		};
	}

	async function updateZone(zoneCode: string) {
		if (!evacuee) return;
		try {
			if (canChangeEvacueeZone(evacuee)) {
				await changeZoneMutation.mutateAsync({
					evacuee,
					ctx: getAuthorContext(),
					zone: zoneCode
				});
			} else {
				await patchEvacueeMutation.mutateAsync({
					id: evacuee._id,
					patch: { current_stay: { ...evacuee.current_stay, zone: zoneCode, since: now() } }
				});
			}
			toast.success(t.zoneMoved(zoneLabel(zoneCode, shelterZones)));
			showZoneModal = false;
		} catch (err: unknown) {
			toast.error(t.zoneMoveFailed(errorDetail(err)));
		}
	}

	// Status changes go through the movement stream — current_stay is only a
	// snapshot of it (schema.md §1.1) — so every transition here records a
	// movement doc instead of patching current_stay directly.
	async function updateStatus(status: StayStatus, reason?: string) {
		if (!evacuee) return;
		try {
			const action = resolveStatusChangeAction(evacuee.current_stay.status, status);
			if (!action) {
				showStatusModal = false;
				return;
			}
			const ctx = getAuthorContext();
			const kind = statusChangeHandlerKind(action);
			if (kind === 'check_in') {
				const zone = evacuee.current_stay.zone?.trim();
				if (!zone) {
					toast.error(t.checkInNeedsZone);
					showStatusModal = false;
					showZoneModal = true;
					return;
				}
				await checkInMutation.mutateAsync({ evacuee, ctx, zone });
			} else if (kind === 'check_out') {
				const normalized = normalizeCheckoutRemark(reason);
				await checkOutMutation.mutateAsync({ evacuee, ctx, reason: normalized });
			} else if (kind === 'confirm_room') {
				await confirmRoomMutation.mutateAsync({ evacuee, ctx });
			} else if (action !== 'check_in' && action !== 'check_out' && action !== 'confirm_room') {
				if (action === 'leave_temporary') {
					const trimmed = (reason ?? '').trim();
					if (!trimmed) {
						toast.error(t.leaveNeedsReason);
						return;
					}
					await recordMovementMutation.mutateAsync({
						evacuee,
						action,
						ctx,
						reason: trimmed
					});
				} else {
					await recordMovementMutation.mutateAsync({ evacuee, action, ctx });
				}
			}
			toast.success(t.statusUpdated);
			showStatusModal = false;
		} catch (err: unknown) {
			toast.error(t.statusUpdateFailed(errorDetail(err)));
		}
	}

	async function saveAddress(data: {
		addressNo: string;
		villageNo: string;
		subdistrict: string;
		district: string;
		province: string;
		postalCode: string;
		municipalityZone: string;
		community: string;
	}) {
		if (!household) {
			toast.error(t.noHouseholdForAddress);
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
					postal_code: data.postalCode || null,
					municipality_zone: data.municipalityZone || null,
					community: data.community || null
				}
			});
			toast.success(t.addressSaved);
			showAddressModal = false;
		} catch (err: unknown) {
			toast.error(t.addressSaveFailed(errorDetail(err)));
		}
	}

	async function saveAssets(data: {
		vehicles: HouseholdVehicle[];
		valuables: string;
		pets: PetGroup[];
	}) {
		if (!household) {
			toast.error(t.noHouseholdForAssets);
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
			toast.success(t.assetsSaved);
			showAssetModal = false;
		} catch (err: unknown) {
			toast.error(t.assetsSaveFailed(errorDetail(err)));
		}
	}

	async function savePersonal(data: EvacueePersonalEditData) {
		if (!evacuee) return;
		try {
			await authStore.ensureInitialized();
			let photo = data.removePhoto ? null : evacuee.photo;
			if (data.photoFile) {
				const actor = getAuthorContext();
				const image = await saveImageMutation.mutateAsync({
					file: data.photoFile,
					ctx: actor,
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
					religion_other: data.religion === 'other' ? data.religionOther || null : null,
					photo
				}
			});
			toast.success(t.personalSaved);
			showPersonalModal = false;
		} catch (err: unknown) {
			toast.error(t.personalSaveFailed(errorDetail(err)));
		}
	}

	async function saveEmergency(data: EvacueeEmergencyEditData) {
		if (!evacuee) return;
		try {
			await patchEvacueeMutation.mutateAsync({
				id: evacuee._id,
				patch: { emergency_contact: data.emergencyContact }
			});
			toast.success(t.emergencySaved);
			showEmergencyModal = false;
		} catch (err: unknown) {
			toast.error(t.emergencySaveFailed(errorDetail(err)));
		}
	}

	async function saveHealth(data: EvacueeHealthEditData) {
		if (!evacuee) return;
		const medicalPatch = {
			conditions: data.conditions,
			medications: data.medications,
			allergies: data.allergies,
			track: data.careTrack
		};
		const medicalHasValues =
			data.conditions.length > 0 ||
			data.medications.length > 0 ||
			data.allergies.length > 0 ||
			data.careTrack === 'fast_track';
		const medicalChanged =
			!medical ||
			JSON.stringify(medical.conditions) !== JSON.stringify(data.conditions) ||
			JSON.stringify(medical.medications) !== JSON.stringify(data.medications) ||
			JSON.stringify(medical.allergies) !== JSON.stringify(data.allergies) ||
			medical.track !== data.careTrack;

		const currentVulnerableGroups = evacuee.vulnerable_groups ?? [];
		const currentSpecialNeeds = evacuee.special_needs ?? [];
		const vulnerableGroupsChanged =
			JSON.stringify([...currentVulnerableGroups].sort()) !==
			JSON.stringify([...data.vulnerableGroups].sort());
		const specialNeedsChanged =
			JSON.stringify([...currentSpecialNeeds].sort()) !==
			JSON.stringify([...data.specialNeeds].sort());
		const evacueeNeedsPatch = vulnerableGroupsChanged || specialNeedsChanged;

		const nextSymptoms = data.ewarSymptoms;
		const nextNotes = (data.generalSymptoms || data.screeningNotes || '').trim();
		const currentNotes = (screening?.notes || '').trim();
		const screeningChanged =
			!screening ||
			JSON.stringify([...(screening.symptoms ?? [])].sort()) !==
				JSON.stringify([...nextSymptoms].sort()) ||
			screening.track !== data.careTrack ||
			currentNotes !== nextNotes;
		const screeningHasValues =
			nextSymptoms.length > 0 || nextNotes.length > 0 || data.careTrack === 'fast_track';

		let patchedEvacuee = false;
		let patchedMedical = false;
		let createdMedicalId: string | null = null;
		let actor: ReturnType<typeof getAuthorContext> | null = null;
		const getActor = () => (actor ??= getAuthorContext());
		try {
			await authStore.ensureInitialized();
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
						ctx: getActor()
					});
					createdMedicalId = created._id;
				}
			}

			if (evacueeNeedsPatch) {
				const evacueePatch: Partial<Evacuee> = {};
				if (vulnerableGroupsChanged) evacueePatch.vulnerable_groups = data.vulnerableGroups;
				if (specialNeedsChanged) evacueePatch.special_needs = data.specialNeeds;
				await patchEvacueeMutation.mutateAsync({
					id: evacuee._id,
					patch: evacueePatch
				});
				patchedEvacuee = true;
			}

			if (screeningChanged && (screening || screeningHasValues)) {
				await createScreeningMutation.mutateAsync({
					input: {
						evacuee_id: evacuee._id,
						symptoms: nextSymptoms,
						track: data.careTrack,
						notes: nextNotes || undefined
					},
					ctx: getActor()
				});
			}
			toast.success(t.healthSaved);
			showHealthModal = false;
		} catch (err: unknown) {
			const rollbacks: Promise<unknown>[] = [];
			if (patchedEvacuee) {
				rollbacks.push(
					patchEvacueeMutation.mutateAsync({
						id: evacuee._id,
						patch: {
							vulnerable_groups: evacuee.vulnerable_groups,
							special_needs: evacuee.special_needs
						}
					})
				);
			}
			if (patchedMedical && medical) {
				rollbacks.push(
					patchMedicalMutation.mutateAsync({
						id: medical._id,
						patch: {
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
					? t.healthPartiallySaved(errorDetail(err))
					: t.healthRolledBack(errorDetail(err))
			);
		}
	}

	async function saveHousehold(data: EvacueeHouseholdEditData) {
		if (!evacuee) return;
		try {
			await patchEvacueeMutation.mutateAsync({
				id: evacuee._id,
				patch: { household_id: data.householdId }
			});
			const targetHousehold = data.householdId
				? householdsQuery.data?.find((item) => item._id === data.householdId)
				: null;
			if (targetHousehold && data.setAsHead && targetHousehold.head_evacuee_id !== evacuee._id) {
				await patchHouseholdMutation.mutateAsync({
					id: targetHousehold._id,
					patch: { head_evacuee_id: evacuee._id }
				});
			}

			toast.success(t.householdSaved);
			showHouseholdModal = false;
		} catch (err: unknown) {
			toast.error(t.householdSaveFailed(errorDetail(err)));
		}
	}

	function errorDetail(err: unknown): string {
		return err instanceof Error ? err.message : String(err);
	}

	function formatDateTime(ts: string | number | undefined): string {
		if (!ts) return t.unspecified;
		const formatted = formatDisplayDateTime(String(ts), langState.current);
		return formatted || String(ts);
	}
</script>

{#if isLoading}
	<LoadingScreen message={t.loading} />
{:else if !evacuee}
	<div class="space-y-4 rounded-lg border border-border bg-card py-16 text-center">
		<p class="text-base font-semibold text-destructive">{t.notFound}</p>
		<button
			class="inline-flex cursor-pointer items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-semibold transition-colors hover:bg-muted"
			onclick={() => {
				const pathname = page.url.pathname;
				if (pathname.includes('/system-management/pre-registrations')) {
					goto(resolve('/system-management/pre-registrations'));
					return;
				}
				goto(resolve('/back-office/evacuee-management'));
			}}
		>
			{t.backHome}
		</button>
	</div>
{:else}
	<div
		class="min-w-0 space-y-5 lg:pb-0 {showMobileDock
			? 'pb-[calc(5rem+env(safe-area-inset-bottom,0px))]'
			: 'pb-0'}"
	>
		<!-- Mobile top identity header (scroll sentinel for dock reveal) -->
		<div class="min-w-0 lg:hidden" {@attach observeMobileIdentityHeader()}>
			<EvacueeProfileIdentityRail
				{evacuee}
				{medical}
				{screening}
				{shelterName}
				{statusInfo}
				readonly={profileReadonly}
				variant="compact"
				onOpenZoneModal={() => (showZoneModal = true)}
				onOpenStatusModal={() => (showStatusModal = true)}
				onOpenQrModal={() => (showQrModal = true)}
				onOpenHandoverSlip={() => (showHandoverSlip = true)}
				onOpenPersonalEdit={() => (showPersonalModal = true)}
				onOpenEmergencyEdit={() => (showEmergencyModal = true)}
			/>
		</div>

		{#if qrPrintsQuery.data && screeningsQuery.data}
			<EvacueeQrStaleAlert
				current={vulnerabilityMarker(evacuee, screeningsQuery.data)}
				prints={qrPrintsQuery.data}
				onReprint={() => (showQrModal = true)}
			/>
		{/if}

		<div class="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)]">
			<!-- Desktop sticky identity rail — cell must stretch (no items-start) so sticky has room -->
			<div class="hidden min-w-0 lg:block">
				<EvacueeProfileIdentityRail
					{evacuee}
					{medical}
					{screening}
					{shelterName}
					{statusInfo}
					readonly={profileReadonly}
					onOpenZoneModal={() => (showZoneModal = true)}
					onOpenStatusModal={() => (showStatusModal = true)}
					onOpenQrModal={() => (showQrModal = true)}
					onOpenHandoverSlip={() => (showHandoverSlip = true)}
					onOpenPersonalEdit={() => (showPersonalModal = true)}
					onOpenEmergencyEdit={() => (showEmergencyModal = true)}
				/>
			</div>

			<!-- Scroll content: Health / Household / Assets / Audit -->
			<div class="min-w-0 space-y-4">
				<div class="space-y-4">
					<EvacueeProfileHealthCard
						{evacuee}
						{medical}
						{screening}
						readonly={profileReadonly}
						onOpenEdit={() => (showHealthModal = true)}
					/>
				</div>
				<EvacueeProfilePrivacyCard {evacuee} readonly={profileReadonly} {getAuthorContext} />
				<div class="space-y-4">
					<EvacueeProfileHouseholdCard
						{evacuee}
						{household}
						members={householdMembers}
						readonly={profileReadonly}
						onOpenHouseholdModal={() => (showHouseholdModal = true)}
						onOpenAddressModal={() => (showAddressModal = true)}
						onViewMember={viewHouseholdMember}
					/>
					<EvacueeProfileAssetsCard
						{household}
						readonly={profileReadonly}
						onOpenAssetModal={() => (showAssetModal = true)}
					/>
				</div>

				<!-- Audit log — record metadata + movement events combined -->
				<section class="min-w-0 space-y-3 rounded-lg border border-border bg-card p-5">
					<div class="flex items-center gap-2.5 border-b border-border pb-2">
						<Clock class="size-4.5 shrink-0 text-primary" />
						<h3 class="min-w-0 text-sm font-bold break-words text-slate-900 dark:text-slate-50">
							{t.auditLog}
						</h3>
					</div>
					<ol class="min-w-0 space-y-2.5">
						{#if evacuee.updated_at && evacuee.updated_at !== evacuee.created_at}
							<li class="flex items-start gap-3 text-xs">
								<FilePenLine class="mt-0.5 size-4 shrink-0 text-blue-600" />
								<div class="min-w-0 flex-1 space-y-0.5">
									<div class="font-semibold break-words text-foreground">
										{t.updated}
									</div>
									<div class="text-muted-foreground">{formatDateTime(evacuee.updated_at)}</div>
								</div>
							</li>
						{/if}
						{#each visibleMovements as m (m._id)}
							<li class="flex items-start gap-3 text-xs">
								<Circle class="mt-1 size-3 shrink-0 {MOVEMENT_DOT_CLASS[m.action]}" />
								<div class="min-w-0 flex-1 space-y-0.5">
									<div class="font-semibold break-words text-foreground">
										{t.movement[m.action]}
										{#if m.zone}
											<span class="font-normal text-muted-foreground">
												· {t.movementZone(zoneLabel(m.zone, shelterZones))}
											</span>
										{/if}
									</div>
									<div class="break-words text-muted-foreground">
										{formatDateTime(m.occurred_at)}
										{#if m.reason}
											· {movementReasonLabel(m.reason, langState.current)}
										{/if}
									</div>
								</div>
							</li>
						{/each}
						{#if hasMoreMovements}
							<li>
								<button
									type="button"
									onclick={loadMoreMovements}
									class="cursor-pointer text-xs font-semibold text-primary transition-colors hover:text-primary/80"
								>
									{t.loadMore(movements.length - visibleMovementsCount)}
								</button>
							</li>
						{/if}
						<li class="flex items-start gap-3 text-xs">
							<UserPlus class="mt-0.5 size-4 shrink-0 text-emerald-600" />
							<div class="min-w-0 flex-1 space-y-0.5">
								<div class="font-semibold break-words text-foreground">
									{t.registered}
								</div>
								<div class="break-words text-muted-foreground">
									{formatDateTime(evacuee.created_at)} · {t.registeredBy(
										evacuee.created_by || 'system'
									)}
								</div>
							</div>
						</li>
					</ol>
				</section>
			</div>
		</div>
	</div>

	<EvacueeProfileMobileDock
		visible={showMobileDock}
		readonly={profileReadonly}
		onOpenZoneModal={() => (showZoneModal = true)}
		onOpenActions={() => (showActionsSheet = true)}
	/>

	<EvacueeProfileActionsSheet
		bind:open={showActionsSheet}
		{evacuee}
		{medical}
		{screening}
		{statusInfo}
		readonly={profileReadonly}
		onOpenZoneModal={() => (showZoneModal = true)}
		onOpenStatusModal={() => (showStatusModal = true)}
		onOpenQrModal={() => (showQrModal = true)}
		onOpenHandoverSlip={() => (showHandoverSlip = true)}
	/>

	<!-- Modals (edit mode only) -->
	{#if !profileReadonly}
		<EvacueeZoneModal
			show={showZoneModal}
			{evacuee}
			{screening}
			{shelterZones}
			onClose={() => (showZoneModal = false)}
			onUpdateZone={updateZone}
		/>

		{#if showStatusModal}
			{#key evacuee._id}
				<EvacueeStatusModal
					show={true}
					{evacuee}
					{statusConfig}
					onClose={() => (showStatusModal = false)}
					onUpdateStatus={updateStatus}
				/>
			{/key}
		{/if}

		<EvacueeQrModal show={showQrModal} {evacuee} onClose={() => (showQrModal = false)} />

		{#if showHandoverSlip}
			<EvacueeHandoverSlipModal
				show={showHandoverSlip}
				{evacuee}
				symptoms={screening?.symptoms ?? []}
				onClose={() => (showHandoverSlip = false)}
			/>
		{/if}

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
