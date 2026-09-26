<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { SvelteMap } from 'svelte/reactivity';
	import { toast } from 'svelte-sonner';
	import { Html5Qrcode } from 'html5-qrcode';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Scan from '@lucide/svelte/icons/scan';
	import Search from '@lucide/svelte/icons/search';
	import Camera from '@lucide/svelte/icons/camera';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Clock from '@lucide/svelte/icons/clock';
	import Users from '@lucide/svelte/icons/users';
	import X from '@lucide/svelte/icons/x';
	import Check from '@lucide/svelte/icons/check';

	import PaginationControls from '$lib/components/pagination-controls.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Table from '$lib/components/ui/table';

	import {
		useEvacuees,
		useHouseholds,
		useScreenings,
		maskNationalId,
		matchesEvacueeSearch,
		formatPersonName,
		classifyZoningQueueTab,
		buildZoningPath,
		useConfirmRoom,
		useConfirmRoomForHousehold,
		useCheckInEvacuee,
		useChangeEvacueeZone,
		listPendingZoneArrivalConfirmations,
		lookupFederatedByScanCode,
		zoneLabel,
		ZoneSelectionFields,
		countPresentOccupantsByZone,
		canCheckInEvacuee,
		canConfirmRoom,
		canChangeEvacueeZone,
		isPendingZoneArrivalConfirmation,
		toggleId,
		selectRange,
		applyRowClickSelection,
		type Evacuee,
		type ZoningQueueTab
	} from '$lib/features/people';
	import {
		ClaimDialog,
		type UnassignedRegistrationSearchHit
	} from '$lib/features/unassigned-registration';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { useShelter } from '$lib/features/shelters';
	import { useMasterData } from '$lib/features/master-data';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { paginateItems } from '$lib/db/paginate';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';

	const PAGE_SIZE = 10;

	const allEvacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	const screeningsQuery = useScreenings();
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const shelterZones = $derived(shelterQuery.data?.zones ?? []);
	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');
	const confirmRoomMutation = useConfirmRoom();
	const confirmRoomHouseholdMutation = useConfirmRoomForHousehold();
	const checkInMutation = useCheckInEvacuee();
	const changeZoneMutation = useChangeEvacueeZone();
	const queryClient = useQueryClient();

	const enableMedical = $derived(
		shelterQuery.data?.feature_flags?.enable_medical_screening ?? false
	);
	const allEvacuees = $derived(allEvacueesQuery.data ?? []);
	const householdMap = $derived(new SvelteMap((householdsQuery.data ?? []).map((h) => [h._id, h])));
	const screenings = $derived(screeningsQuery.data ?? []);
	const screenedIds = $derived(new Set(screenings.map((s) => s.evacuee_id)));
	const ewarSymptomsByEvacuee = $derived.by(() => {
		const map = new SvelteMap<string, string[]>();
		const sorted = [...screenings].sort((a, b) =>
			(b.screened_at ?? b.created_at).localeCompare(a.screened_at ?? a.created_at)
		);
		for (const s of sorted) {
			if (s.symptoms && !map.has(s.evacuee_id)) {
				map.set(s.evacuee_id, s.symptoms);
			}
		}
		return map;
	});
	const occupantCounts = $derived(countPresentOccupantsByZone(allEvacuees));

	const SPECIAL_NEED_LABELS: Record<string, string> = {
		wheelchair: 'ใช้วีลแชร์',
		bedridden: 'ผู้ป่วยติดเตียง',
		oxygen: 'ใช้ออกซิเจน',
		pregnant: 'หญิงตั้งครรภ์',
		infant: 'ทารก/เด็กเล็ก',
		visual_impaired: 'ผู้พิการทางการมองเห็น',
		hearing_impaired: 'ผู้พิการทางการได้ยิน',
		high_dependency: 'มีภาวะพึ่งพิงสูง',
		elderly: 'ผู้สูงอายุ',
		chronic_illness: 'โรคเรื้อรัง',
		disabled: 'ผู้พิการ'
	};

	function getSpecialNeedLabel(need: string): string {
		const fromMaster = vulnerableGroupQuery.data?.items.find((i) => i.code === need)?.label;
		if (fromMaster) return fromMaster;
		return SPECIAL_NEED_LABELS[need] ?? need;
	}

	let searchQuery = $state('');
	let barcodeInput = $state('');
	let showCameraModal = $state(false);
	let cameraError = $state<string | null>(null);
	let activeTab = $state<ZoningQueueTab>('pending');
	let currentPage = $state(1);
	let claimOpen = $state(false);
	let claimHit = $state<UnassignedRegistrationSearchHit | null>(null);
	let lookupInFlight = $state(false);

	let selectedIds = $state<string[]>([]);
	let lastClickedIndex = $state<number | null>(null);
	let bulkZoneOpen = $state(false);
	let bulkZone = $state('');
	let bulkBusy = $state(false);
	/** Guards against bits-ui toggling the single box after a Shift range select. */
	let skipNextCheckboxChange = false;

	const pendingEvacuees = $derived(
		allEvacuees.filter(
			(e) =>
				classifyZoningQueueTab(e, {
					enableMedicalScreening: enableMedical,
					hasScreening: screenedIds.has(e._id)
				}) === 'pending'
		)
	);
	const awaitingConfirmEvacuees = $derived(
		listPendingZoneArrivalConfirmations(
			allEvacuees.filter(
				(e) =>
					classifyZoningQueueTab(e, {
						enableMedicalScreening: enableMedical,
						hasScreening: screenedIds.has(e._id)
					}) === 'awaiting_confirm'
			)
		)
	);
	const assignedEvacuees = $derived(
		allEvacuees.filter(
			(e) =>
				classifyZoningQueueTab(e, {
					enableMedicalScreening: enableMedical,
					hasScreening: screenedIds.has(e._id)
				}) === 'assigned'
		)
	);

	const tabEvacuees = $derived(
		activeTab === 'pending'
			? pendingEvacuees
			: activeTab === 'awaiting_confirm'
				? awaitingConfirmEvacuees
				: assignedEvacuees
	);

	const filteredQueue = $derived(
		tabEvacuees.filter((evacuee) => {
			const q = searchQuery.trim().toLowerCase();
			if (!q) return true;
			if (matchesEvacueeSearch(evacuee, q)) return true;
			const household = evacuee.household_id ? householdMap.get(evacuee.household_id) : undefined;
			if (household?.label?.toLowerCase().includes(q)) return true;
			return false;
		})
	);

	const pagedRows = $derived(paginateItems(filteredQueue, currentPage, PAGE_SIZE));
	const pageIds = $derived(pagedRows.items.map((e) => e._id));
	const allPageSelected = $derived(
		pageIds.length > 0 && pageIds.every((id) => selectedIds.includes(id))
	);
	const somePageSelected = $derived(
		pageIds.some((id) => selectedIds.includes(id)) && !allPageSelected
	);
	const selectedEvacuees = $derived(filteredQueue.filter((e) => selectedIds.includes(e._id)));

	$effect(() => {
		void [activeTab, searchQuery];
		currentPage = 1;
	});

	const isLoading = $derived(
		allEvacueesQuery.isPending ||
			screeningsQuery.isPending ||
			householdsQuery.isPending ||
			shelterQuery.isPending
	);

	function clearSelection() {
		selectedIds = [];
		lastClickedIndex = null;
	}

	function setActiveTab(tab: ZoningQueueTab) {
		if (tab === activeTab) return;
		activeTab = tab;
		clearSelection();
	}

	function openDetail(id: string) {
		goto(resolve(buildZoningPath(id) as `/onsite/zoning/${string}`));
	}

	function authorCtx() {
		return {
			shelterCode: getShelterCode(),
			createdBy: authStore.user?.name ?? 'unknown'
		};
	}

	function isSelected(id: string): boolean {
		return selectedIds.includes(id);
	}

	function applyModifierSelection(index: number, ctrl: boolean, shift: boolean) {
		const result = applyRowClickSelection({
			selected: selectedIds,
			ids: pageIds,
			index,
			lastIndex: lastClickedIndex,
			ctrl,
			shift
		});
		selectedIds = result.nextSelected;
		lastClickedIndex = result.nextLastIndex;
	}

	function onCheckboxChange(id: string, index: number, checked: boolean | 'indeterminate') {
		if (skipNextCheckboxChange) {
			skipNextCheckboxChange = false;
			return;
		}
		const currentlySelected = selectedIds.includes(id);
		if ((checked === true) !== currentlySelected) {
			selectedIds = toggleId(selectedIds, id);
		}
		lastClickedIndex = index;
	}

	/**
	 * Shift+click on the checkbox never reaches the row handler (stopPropagation).
	 * Handle range select on mousedown so preventDefault can cancel the single-box toggle.
	 */
	function onCheckboxMouseDown(e: MouseEvent, index: number) {
		e.stopPropagation();
		if (!e.shiftKey) return;
		e.preventDefault();
		skipNextCheckboxChange = true;
		applyModifierSelection(index, false, true);
		// Clear even if onCheckedChange never fires (mousedown cancelled the click).
		queueMicrotask(() => {
			skipNextCheckboxChange = false;
		});
	}

	function onCheckboxClick(e: MouseEvent) {
		e.stopPropagation();
	}

	function toggleSelectAll(checked: boolean | 'indeterminate') {
		if (checked === true) {
			if (pageIds.length === 0) return;
			const rangeIds = selectRange(pageIds, 0, pageIds.length - 1);
			selectedIds = [...new Set([...selectedIds, ...rangeIds])];
			lastClickedIndex = 0;
			return;
		}
		const view = new Set(pageIds);
		selectedIds = selectedIds.filter((id) => !view.has(id));
	}

	/**
	 * Modifier selection on mousedown: preventDefault blocks text-selection and the
	 * follow-up click (so we must apply selection here, not only in onclick).
	 */
	function onRowMouseDown(e: MouseEvent, index: number) {
		const ctrl = e.ctrlKey || e.metaKey;
		const shift = e.shiftKey;
		if (!ctrl && !shift) return;
		e.preventDefault();
		applyModifierSelection(index, ctrl, shift);
	}

	function onRowClick(e: MouseEvent, row: Evacuee) {
		const ctrl = e.ctrlKey || e.metaKey;
		const shift = e.shiftKey;
		if (ctrl || shift) {
			// Selection already applied in onRowMouseDown; never navigate.
			e.preventDefault();
			return;
		}
		openDetail(row._id);
	}

	function removeSucceededFromSelection(succeededIds: string[]) {
		if (succeededIds.length === 0) return;
		const done = new Set(succeededIds);
		selectedIds = selectedIds.filter((id) => !done.has(id));
		if (selectedIds.length === 0) lastClickedIndex = null;
	}

	function toastSettled(ok: number, failed: number, okLabel: string) {
		if (failed === 0) {
			toast.success(`${okLabel}สำเร็จ ${ok} คน`);
			return;
		}
		if (ok > 0) {
			toast.warning(`${okLabel}สำเร็จ ${ok} คน, ล้มเหลว ${failed} คน`);
			return;
		}
		toast.error(`${okLabel}ไม่สำเร็จ ${failed} คน`);
	}

	async function confirmOne(evacueeId: string) {
		const target = allEvacuees.find((e) => e._id === evacueeId);
		if (!target) return;
		try {
			await confirmRoomMutation.mutateAsync({ evacuee: target, ctx: authorCtx() });
			toast.success(`ยืนยันถึงโซน: ${formatPersonName(target)}`);
		} catch (err: unknown) {
			toast.error(err instanceof Error ? err.message : 'ยืนยันถึงโซนไม่สำเร็จ');
		}
	}

	async function confirmHousehold(householdId: string) {
		try {
			const confirmed = await confirmRoomHouseholdMutation.mutateAsync({
				householdId,
				evacuees: allEvacuees,
				ctx: authorCtx()
			});
			toast.success(`ยืนยันถึงโซนทั้งครัวเรือน ${confirmed.length} คน`);
		} catch (err: unknown) {
			toast.error(err instanceof Error ? err.message : 'ยืนยันถึงโซนไม่สำเร็จ');
		}
	}

	async function bulkConfirmSelected() {
		if (bulkBusy || selectedIds.length === 0) return;
		const targets = selectedEvacuees.filter(
			(e) => canConfirmRoom(e) && isPendingZoneArrivalConfirmation(e)
		);
		if (targets.length === 0) {
			toast.error('ไม่มีรายการที่รอยืนยันถึงโซนในชุดที่เลือก');
			return;
		}
		bulkBusy = true;
		try {
			const ctx = authorCtx();
			const results = await Promise.allSettled(
				targets.map((evacuee) => confirmRoomMutation.mutateAsync({ evacuee, ctx }))
			);
			const ok = results.filter((r) => r.status === 'fulfilled').length;
			const failed = results.length - ok;
			const succeededIds = targets
				.filter((_, i) => results[i]?.status === 'fulfilled')
				.map((e) => e._id);
			removeSucceededFromSelection(succeededIds);
			toastSettled(ok, failed, 'ยืนยันถึงโซน');
		} finally {
			bulkBusy = false;
		}
	}

	function openBulkZoneDialog() {
		if (selectedIds.length === 0) return;
		bulkZone = '';
		bulkZoneOpen = true;
	}

	async function bulkApplyZone() {
		const zone = bulkZone.trim();
		if (!zone) {
			toast.error('กรุณาเลือกโซนที่พัก');
			return;
		}
		if (bulkBusy || selectedIds.length === 0) return;

		const ctx = authorCtx();
		const isPendingTab = activeTab === 'pending';
		const targets = selectedEvacuees.filter((e) =>
			isPendingTab ? canCheckInEvacuee(e) : canChangeEvacueeZone(e)
		);
		if (targets.length === 0) {
			toast.error(
				isPendingTab
					? 'ไม่มีรายการที่พร้อมจัดโซนในชุดที่เลือก'
					: 'ไม่มีรายการที่ย้ายโซนได้ในชุดที่เลือก'
			);
			return;
		}

		bulkBusy = true;
		try {
			const results = await Promise.allSettled(
				targets.map((evacuee) =>
					isPendingTab
						? checkInMutation.mutateAsync({ evacuee, ctx, zone })
						: changeZoneMutation.mutateAsync({ evacuee, ctx, zone })
				)
			);
			const ok = results.filter((r) => r.status === 'fulfilled').length;
			const failed = results.length - ok;
			const succeededIds = targets
				.filter((_, i) => results[i]?.status === 'fulfilled')
				.map((e) => e._id);
			removeSucceededFromSelection(succeededIds);
			toastSettled(ok, failed, isPendingTab ? 'จัดโซน' : 'ย้ายโซน');
			if (ok > 0) bulkZoneOpen = false;
		} finally {
			bulkBusy = false;
		}
	}

	async function handleCodeInput(raw: string) {
		if (lookupInFlight) return;
		lookupInFlight = true;
		try {
			const result = await lookupFederatedByScanCode(queryClient, raw);
			if (!result) {
				toast.error('ไม่พบข้อมูลผู้ประสบภัยที่ตรงกับรหัสนี้');
				return;
			}
			barcodeInput = '';
			showCameraModal = false;
			if (result.source === 'couch') {
				toast.success(`พบผู้ประสบภัย: ${formatPersonName(result.evacuee)}`);
				openDetail(result.evacuee._id);
				return;
			}
			toast.success('พบคิวลงทะเบียนล่วงหน้า (คิวกลาง) — รับเข้าศูนย์ก่อนจัดโซน');
			claimHit = result.hit;
			claimOpen = true;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ค้นหาจากรหัสที่สแกนไม่สำเร็จ');
		} finally {
			lookupInFlight = false;
		}
	}

	function cameraAttachment(node: HTMLDivElement) {
		const html5QrCode = new Html5Qrcode(node.id);
		cameraError = null;

		html5QrCode
			.start(
				{ facingMode: 'environment' },
				{
					fps: 10,
					qrbox: (width, height) => {
						const minDimension = Math.min(width, height);
						const qrboxSize = Math.floor(minDimension * 0.7);
						return { width: qrboxSize, height: qrboxSize };
					}
				},
				(decodedText) => {
					if (decodedText) {
						if (typeof navigator !== 'undefined' && navigator.vibrate) {
							navigator.vibrate(100);
						}
						handleCodeInput(decodedText);
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

	function formatTimeOrDate(isoDate?: string | null): string {
		if (!isoDate) return '—';
		try {
			const d = new Date(isoDate);
			return (
				d.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) +
				' น. (' +
				d.toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }) +
				')'
			);
		} catch {
			return isoDate;
		}
	}

	const emptyPendingMessage = $derived(
		enableMedical
			? 'ยังไม่มีผู้พร้อมจัดโซน — ผู้ที่ลงทะเบียนแล้วต้องผ่านคัดกรองแพทย์ก่อน'
			: 'ยังไม่มีผู้พร้อมจัดโซน — เมื่อลงทะเบียนเสร็จจะปรากฏที่นี่'
	);
</script>

<svelte:head>
	<title>จัดสรรที่พัก (Station 3) | SmartShelter</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
	<header class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-3">
			<a
				href={resolve('/onsite')}
				class="inline-flex h-10 w-10 items-center justify-center rounded-full border border-slate-200/80 bg-white text-slate-600 shadow-2xs transition-colors hover:bg-slate-50"
				aria-label="กลับหน้าหลักระบบส่วนหน้า"
			>
				<ArrowLeft class="size-4" />
			</a>
			<div>
				<div class="flex items-center gap-2">
					<MapPin class="size-6 text-[#0A2647]" />
					<h1 class="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">จัดสรรที่พัก</h1>
					<Badge
						variant="outline"
						class="border-amber-200 bg-amber-50 font-semibold text-amber-900"
					>
						Station 3
					</Badge>
				</div>
				<p class="mt-0.5 text-xs text-slate-500">
					Zoning Desk — คิวพร้อมจัดโซน · รอยืนยันถึงโซน · ยืนยันแล้ว — ค้นหาหรือสแกน Handover /
					Person QR
				</p>
			</div>
		</div>
	</header>

	<Card.Root class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
		<div class="flex flex-col gap-3 md:flex-row md:items-center">
			<div class="relative flex-1">
				<Search
					class="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400"
				/>
				<Input
					type="text"
					placeholder="ค้นหาชื่อ, นามสกุล, เบอร์โทร, เลขบัตร..."
					bind:value={searchQuery}
					class="h-12 w-full rounded-xl bg-slate-50 pr-8 pl-11"
				/>
				{#if searchQuery}
					<button
						type="button"
						onclick={() => (searchQuery = '')}
						class="absolute top-1/2 right-2.5 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-700"
						title="ล้างคำค้นหา"
					>
						<X class="size-3.5" />
					</button>
				{/if}
			</div>

			<div class="flex items-center gap-2">
				<div class="relative min-w-[220px]">
					<Scan
						class="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400"
					/>
					<Input
						type="text"
						placeholder="สแกนรหัส / หมายเลขบัตร"
						bind:value={barcodeInput}
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								handleCodeInput(barcodeInput);
							}
						}}
						class="h-12 rounded-xl bg-slate-50 pl-11 font-mono text-xs"
					/>
				</div>
				<Button
					variant="outline"
					size="default"
					onclick={() => handleCodeInput(barcodeInput)}
					disabled={!barcodeInput.trim()}
					class="h-12 rounded-xl"
				>
					ยืนยัน
				</Button>
				<Button
					variant="default"
					size="default"
					onclick={() => (showCameraModal = true)}
					class="h-12 gap-1.5 rounded-xl bg-amber-600 font-semibold text-white hover:bg-amber-700"
				>
					<Camera class="size-4" />
					<span>สแกนกล้อง</span>
				</Button>
			</div>
		</div>
	</Card.Root>

	<section aria-label="สรุปยอดคิวจัดสรรที่พัก" class="grid grid-cols-1 gap-4 sm:grid-cols-3">
		<button
			type="button"
			onclick={() => setActiveTab('pending')}
			class="group flex flex-col justify-between rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm {activeTab ===
			'pending'
				? 'border-amber-300 bg-amber-50/50 shadow-2xs ring-2 ring-amber-500/20'
				: 'border-slate-200/80 bg-white shadow-2xs'}"
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-amber-900">พร้อมจัดโซน</span>
				<div
					class="flex size-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700 transition-colors group-hover:bg-amber-200"
				>
					<Clock class="size-4" />
				</div>
			</div>
			<div class="mt-2">
				<p class="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
					{pendingEvacuees.length}
					<span class="text-xs font-normal text-slate-500">คน</span>
				</p>
				<p class="mt-0.5 text-xs text-slate-500">คิวรอจัดสรรที่พัก</p>
			</div>
		</button>

		<button
			type="button"
			onclick={() => setActiveTab('awaiting_confirm')}
			class="group flex flex-col justify-between rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm {activeTab ===
			'awaiting_confirm'
				? 'border-emerald-300 bg-emerald-50/50 shadow-2xs ring-2 ring-emerald-500/20'
				: 'border-slate-200/80 bg-white shadow-2xs'}"
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-emerald-900">รอยืนยันถึงโซน</span>
				<div
					class="flex size-7 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 transition-colors group-hover:bg-emerald-200"
				>
					<Clock class="size-4" />
				</div>
			</div>
			<div class="mt-2">
				<p class="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
					{awaitingConfirmEvacuees.length}
					<span class="text-xs font-normal text-slate-500">คน</span>
				</p>
				<p class="mt-0.5 text-xs text-slate-500">รอ Zone Arrival Confirmation</p>
			</div>
		</button>

		<button
			type="button"
			onclick={() => setActiveTab('assigned')}
			class="group flex flex-col justify-between rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm {activeTab ===
			'assigned'
				? 'border-sky-300 bg-sky-50/50 shadow-2xs ring-2 ring-sky-500/20'
				: 'border-slate-200/80 bg-white shadow-2xs'}"
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-sky-900">ยืนยันแล้ว</span>
				<div
					class="flex size-7 items-center justify-center rounded-lg bg-sky-100 text-sky-700 transition-colors group-hover:bg-sky-200"
				>
					<Check class="size-4" />
				</div>
			</div>
			<div class="mt-2">
				<p class="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
					{assignedEvacuees.length}
					<span class="text-xs font-normal text-slate-500">คน</span>
				</p>
				<p class="mt-0.5 text-xs text-slate-500">ย้ายโซนได้</p>
			</div>
		</button>
	</section>

	<section class="flex flex-col gap-4">
		<div class="border-b border-border">
			<nav class="flex gap-1 overflow-x-auto" aria-label="แท็บคิวจัดสรรที่พัก">
				<button
					type="button"
					onclick={() => setActiveTab('pending')}
					class="flex shrink-0 items-center gap-2 border-b-2 px-4 pb-3 text-sm font-semibold transition-colors {activeTab ===
					'pending'
						? 'border-primary text-primary'
						: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
				>
					<Clock class="size-4" />
					<span>พร้อมจัดโซน</span>
					<span class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
						{pendingEvacuees.length}
					</span>
				</button>
				<button
					type="button"
					onclick={() => setActiveTab('awaiting_confirm')}
					class="flex shrink-0 items-center gap-2 border-b-2 px-4 pb-3 text-sm font-semibold transition-colors {activeTab ===
					'awaiting_confirm'
						? 'border-primary text-primary'
						: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
				>
					<Clock class="size-4" />
					<span>รอยืนยันถึงโซน</span>
					<span class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
						{awaitingConfirmEvacuees.length}
					</span>
				</button>
				<button
					type="button"
					onclick={() => setActiveTab('assigned')}
					class="flex shrink-0 items-center gap-2 border-b-2 px-4 pb-3 text-sm font-semibold transition-colors {activeTab ===
					'assigned'
						? 'border-primary text-primary'
						: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
				>
					<Check class="size-4" />
					<span>ยืนยันแล้ว</span>
					<span class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
						{assignedEvacuees.length}
					</span>
				</button>
			</nav>
		</div>

		<div class="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
			<div
				class="flex flex-wrap items-center gap-2 border-b border-slate-200/80 bg-white px-5 py-3.5"
			>
				<Users class="size-4 text-amber-600" />
				<span class="text-base font-semibold text-slate-900">
					{#if activeTab === 'pending'}
						Cleared for Zoning — คิวพร้อมจัดสรรที่พัก
					{:else if activeTab === 'awaiting_confirm'}
						รอยืนยันถึงโซน (Zone Arrival Confirmation) — ไม่หมดอายุอัตโนมัติ
					{:else}
						รายการที่ยืนยันถึงโซนแล้ว (ย้ายโซนได้)
					{/if}
				</span>
				<Badge variant="secondary" class="text-xs">{filteredQueue.length} ราย</Badge>
			</div>

			{#if selectedIds.length > 0}
				<div
					class="flex flex-wrap items-center gap-3 border-b border-sky-200/80 bg-[var(--shelter-accent-blue-bg)] px-5 py-3"
				>
					<span class="text-sm font-semibold text-[var(--shelter-accent-blue-text)]">
						เลือกแล้ว <span class="tabular-nums">{selectedIds.length}</span> คน
					</span>
					<Button
						variant="outline"
						size="sm"
						onclick={clearSelection}
						disabled={bulkBusy}
						class="rounded-lg border-slate-200"
					>
						ล้างการเลือก
					</Button>
					{#if activeTab === 'awaiting_confirm'}
						<Button
							size="sm"
							onclick={() => void bulkConfirmSelected()}
							disabled={bulkBusy || selectedIds.length === 0}
							class="rounded-lg font-semibold"
						>
							ยืนยันถึงโซน ({selectedIds.length} คน)
						</Button>
					{:else if activeTab === 'pending'}
						<Button
							size="sm"
							onclick={openBulkZoneDialog}
							disabled={bulkBusy || selectedIds.length === 0}
							class="rounded-lg font-semibold"
						>
							จัดโซนเดียวกัน…
						</Button>
					{:else}
						<Button
							size="sm"
							onclick={openBulkZoneDialog}
							disabled={bulkBusy || selectedIds.length === 0}
							class="rounded-lg font-semibold"
						>
							ย้ายโซนเดียวกัน…
						</Button>
					{/if}
				</div>
			{/if}

			{#if isLoading}
				<div class="flex h-48 flex-col items-center justify-center gap-2 text-slate-500">
					<div
						class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
					></div>
					<p class="text-xs">กำลังโหลดคิว...</p>
				</div>
			{:else if filteredQueue.length === 0}
				<div class="flex h-48 flex-col items-center justify-center gap-2 px-6 text-center">
					<MapPin class="size-8 text-slate-300" />
					<p class="text-sm font-medium text-slate-500">
						{#if activeTab === 'pending'}
							{emptyPendingMessage}
						{:else if activeTab === 'awaiting_confirm'}
							ไม่มีรายการรอยืนยันถึงโซน
						{:else}
							ยังไม่มีรายการที่ยืนยันถึงโซนแล้ว
						{/if}
					</p>
				</div>
			{:else}
				<div class="overflow-x-auto">
					<Table.Root>
						<Table.Header class="border-b border-slate-200/90 bg-slate-50">
							<Table.Row class="border-b-0 hover:bg-transparent">
								<Table.Head class="h-11 w-12 pl-5">
									<Checkbox
										checked={allPageSelected}
										indeterminate={somePageSelected}
										onCheckedChange={toggleSelectAll}
										aria-label="เลือกทั้งหมดในหน้านี้"
									/>
								</Table.Head>
								<Table.Head class="h-11 text-xs font-semibold text-slate-600"
									>ชื่อ-นามสกุล</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600">บัตร</Table.Head>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>เฝ้าระวัง (EWAR)</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>ความต้องการพิเศษ</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600"
									>ครอบครัว</Table.Head
								>
								<Table.Head class="h-11 px-3 text-xs font-semibold text-slate-600">
									{activeTab === 'pending' ? 'อัปเดต' : 'โซน'}
								</Table.Head>
								<Table.Head class="h-11 pr-5 text-right text-xs font-semibold text-slate-600"
									>ดำเนินการ</Table.Head
								>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each pagedRows.items as row, index (row._id)}
								{@const hh = row.household_id ? householdMap.get(row.household_id) : null}
								{@const ewarSymptoms = ewarSymptomsByEvacuee.get(row._id)}
								{@const selected = isSelected(row._id)}
								<Table.Row
									aria-selected={selected}
									class="cursor-pointer select-none hover:bg-slate-50/80 {selected
										? 'bg-[var(--shelter-accent-blue-bg)]'
										: ''}"
									onmousedown={(e) => onRowMouseDown(e, index)}
									onclick={(e) => onRowClick(e, row)}
								>
									<Table.Cell class="py-3 pl-5">
										<!-- svelte-ignore a11y_no_static_element_interactions -->
										<div
											onmousedown={(e) => onCheckboxMouseDown(e, index)}
											onclick={onCheckboxClick}
											onkeydown={(e) => e.stopPropagation()}
										>
											<Checkbox
												checked={selected}
												onCheckedChange={(checked) => onCheckboxChange(row._id, index, checked)}
												aria-label={`เลือก ${formatPersonName(row)}`}
											/>
										</div>
									</Table.Cell>
									<Table.Cell class="py-3 font-semibold text-slate-900">
										{formatPersonName(row)}
									</Table.Cell>
									<Table.Cell class="px-3 py-3 font-mono text-xs text-slate-600">
										{maskNationalId(row.person_id?.number)}
									</Table.Cell>
									<Table.Cell class="px-3 py-3">
										{#if ewarSymptoms && ewarSymptoms.length > 0}
											<Badge variant="outline" class="border-red-200 bg-red-50 text-red-900">
												เฝ้าระวัง ({ewarSymptoms.length})
											</Badge>
										{:else}
											<span class="text-xs text-slate-500">—</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="px-3 py-3">
										{#if row.special_needs && row.special_needs.length > 0}
											<div class="flex max-w-[14rem] flex-wrap gap-1">
												{#each row.special_needs as need (need)}
													<Badge
														variant="outline"
														class="border-amber-200 bg-amber-50 px-1.5 py-0 text-xs text-amber-900"
													>
														{getSpecialNeedLabel(need)}
													</Badge>
												{/each}
											</div>
										{:else}
											<span class="text-xs text-slate-500">—</span>
										{/if}
									</Table.Cell>
									<Table.Cell class="px-3 py-3 text-sm text-slate-600">
										{hh?.label ?? '—'}
									</Table.Cell>
									<Table.Cell class="px-3 py-3 text-xs text-slate-500">
										{#if activeTab === 'pending'}
											{formatTimeOrDate(row.updated_at)}
										{:else}
											{zoneLabel(row.current_stay.zone, shelterZones)}
										{/if}
									</Table.Cell>
									<Table.Cell class="py-3 pr-5 text-right">
										<div class="flex justify-end gap-1.5">
											{#if activeTab === 'awaiting_confirm'}
												<Button
													size="sm"
													onclick={(e) => {
														e.stopPropagation();
														void confirmOne(row._id);
													}}
													disabled={confirmRoomMutation.isPending || bulkBusy}
													class="rounded-lg font-semibold"
												>
													ยืนยันถึงโซน
												</Button>
												{#if row.household_id}
													<Button
														size="sm"
														variant="outline"
														onclick={(e) => {
															e.stopPropagation();
															void confirmHousehold(row.household_id!);
														}}
														disabled={confirmRoomHouseholdMutation.isPending || bulkBusy}
														class="rounded-lg border-slate-200 px-3 font-semibold text-slate-700"
													>
														ทั้งครัวเรือน
													</Button>
												{/if}
											{:else}
												<Button
													size="sm"
													variant="outline"
													onclick={(e) => {
														e.stopPropagation();
														openDetail(row._id);
													}}
													class="rounded-lg border-slate-200 px-3 font-semibold text-slate-700"
												>
													{activeTab === 'pending' ? 'จัดโซน' : 'ย้ายโซน'}
												</Button>
											{/if}
										</div>
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
				{#if pagedRows.totalPages > 1}
					<div class="border-t border-slate-200/80 px-5 py-3">
						<PaginationControls
							bind:page={currentPage}
							count={filteredQueue.length}
							perPage={PAGE_SIZE}
						/>
					</div>
				{/if}
			{/if}
		</div>
	</section>
</div>

<Dialog.Root bind:open={showCameraModal}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>สแกน QR จัดสรรที่พัก</Dialog.Title>
			<Dialog.Description>สแกน Person QR, Handover หรือรหัสผู้ประสบภัย</Dialog.Description>
		</Dialog.Header>
		{#if cameraError}
			<p class="text-sm text-destructive">{cameraError}</p>
		{:else if showCameraModal}
			<div
				id="zoning-qr-reader"
				class="overflow-hidden rounded-lg"
				{@attach cameraAttachment}
			></div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={bulkZoneOpen}>
	<Dialog.Content class="max-w-lg">
		<Dialog.Header>
			<Dialog.Title>
				{activeTab === 'assigned' ? 'ย้ายโซนเดียวกัน' : 'จัดโซนเดียวกัน'}
			</Dialog.Title>
			<Dialog.Description>
				เลือกโซนสำหรับ {selectedEvacuees.length} คนที่เลือก — ไม่ใช้ recommend รายคน
			</Dialog.Description>
		</Dialog.Header>
		{#if selectedEvacuees.length > 0}
			<p class="text-xs text-muted-foreground">
				{selectedEvacuees
					.slice(0, 5)
					.map((e) => formatPersonName(e))
					.join(', ')}{#if selectedEvacuees.length > 5}
					&nbsp;และอีก {selectedEvacuees.length - 5} คน{/if}
			</p>
		{/if}
		<div class="py-2">
			<ZoneSelectionFields
				bind:selected_zone={bulkZone}
				evacuee={null}
				occupant_counts={occupantCounts}
				shelter_zones={shelterZones}
				disabled={bulkBusy}
			/>
		</div>
		<div class="flex justify-end gap-2">
			<Button variant="outline" onclick={() => (bulkZoneOpen = false)} disabled={bulkBusy}>
				ยกเลิก
			</Button>
			<Button onclick={() => void bulkApplyZone()} disabled={bulkBusy || !bulkZone.trim()}>
				{activeTab === 'assigned' ? 'ยืนยันย้ายโซน' : 'ยืนยันจัดโซน'}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<ClaimDialog
	bind:open={claimOpen}
	bind:hit={claimHit}
	shelterCode={shelterStore.selectedShelterCode ?? getShelterCode()}
/>
