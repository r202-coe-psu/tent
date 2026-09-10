<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { Html5Qrcode } from 'html5-qrcode';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CalendarClock from '@lucide/svelte/icons/calendar-clock';
	import Camera from '@lucide/svelte/icons/camera';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';
	import Clock from '@lucide/svelte/icons/clock';
	import Globe from '@lucide/svelte/icons/globe';
	import Home from '@lucide/svelte/icons/home';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Stethoscope from '@lucide/svelte/icons/stethoscope';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Users from '@lucide/svelte/icons/users';
	import X from '@lucide/svelte/icons/x';
	import Zap from '@lucide/svelte/icons/zap';

	import { Button } from '$lib/components/ui/button';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Table from '$lib/components/ui/table';

	import {
		useEvacuees,
		useHouseholds,
		useScreenings,
		formatPersonName,
		maskNationalId,
		matchesEvacueeSearch,
		nextQueueLabel,
		STATUS_LABELS,
		REPORT_IN_CTA_LABEL,
		Station1IntakeSearch,
		StayStatusBadge,
		lookupFederatedByScanCode,
		type Evacuee,
		type StayStatus
	} from '$lib/features/people';
	import {
		ClaimDialog,
		type UnassignedRegistrationSearchHit
	} from '$lib/features/unassigned-registration';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { useShelter } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';
	import {
		canAccessMedicalScreening,
		canAccessZoning,
		canAccessUnassignedRegistrationQueue
	} from '$lib/auth/roles';
	import { useMasterData } from '$lib/features/master-data';

	const allEvacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	const screeningsQuery = useScreenings();
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');
	const queryClient = useQueryClient();

	const enableMedical = $derived(
		shelterQuery.data?.feature_flags?.enable_medical_screening ?? false
	);
	const roles = $derived(authStore.user?.roles ?? []);
	const canMedical = $derived(canAccessMedicalScreening(roles) && enableMedical);
	const canZoning = $derived(canAccessZoning(roles));
	const canAccessUnassignedQueue = $derived(
		canAccessUnassignedRegistrationQueue(
			roles,
			shelterStore.selectedShelterCode ?? getShelterCode()
		)
	);

	const allEvacuees = $derived(allEvacueesQuery.data ?? []);
	const householdMap = $derived(new Map((householdsQuery.data ?? []).map((h) => [h._id, h])));
	const screenings = $derived(screeningsQuery.data ?? []);
	const screenedIds = $derived(new Set(screenings.map((s) => s.evacuee_id)));
	const screeningByEvacuee = $derived(new Map(screenings.map((s) => [s.evacuee_id, s])));

	const GENDER_LABELS: Record<string, string> = {
		male: 'ชาย',
		female: 'หญิง',
		other: 'อื่นๆ'
	};
	const CARD_TYPE_LABELS: Record<string, string> = {
		national_id: 'บัตรประชาชน',
		passport: 'หนังสือเดินทาง',
		pink_card: 'บัตรชมพู',
		anonymous: 'บุคคลนิรนาม',
		other: 'เอกสารอื่นๆ'
	};
	const TRIAGE_LABELS: Record<string, string> = {
		green: 'เขียว',
		yellow: 'เหลือง',
		red: 'แดง'
	};

	type WorkflowTab = 'pre_registered' | 'arriving' | 'all';
	type ArrivingSubTab = 'all' | 'medical' | 'zoning';

	let activeTab = $state<WorkflowTab>('pre_registered');
	let arrivingSubTab = $state<ArrivingSubTab>('all');
	let allStatusFilter = $state<string>('all');
	let allZoneFilter = $state<string>('all');

	let searchQuery = $state('');
	let showCameraModal = $state(false);
	let cameraError = $state<string | null>(null);
	let selected = $state<Evacuee | null>(null);
	let sheetOpen = $state(false);
	/** Shared with Station1IntakeSearch — hide header new-reg while hard-gate locks. */
	let newRegistrationLocked = $state(false);
	let claimOpen = $state(false);
	let claimHit = $state<UnassignedRegistrationSearchHit | null>(null);
	let lookupInFlight = $state(false);

	// Summary KPI counts
	const preRegisteredEvacuees = $derived(
		allEvacuees.filter((e) => e.current_stay?.status === 'pre_registered')
	);
	const arrivingEvacuees = $derived(
		allEvacuees.filter((e) => e.current_stay?.status === 'arriving')
	);
	const inShelterEvacuees = $derived(
		allEvacuees.filter(
			(e) => e.current_stay?.status === 'active' || e.current_stay?.status === 'room_confirmed'
		)
	);
	const roomConfirmedCount = $derived(
		allEvacuees.filter((e) => e.current_stay?.status === 'room_confirmed').length
	);
	const waitingMedicalCount = $derived(
		arrivingEvacuees.filter((e) => enableMedical && !screenedIds.has(e._id)).length
	);
	const waitingZoningCount = $derived(
		arrivingEvacuees.filter((e) => !enableMedical || screenedIds.has(e._id)).length
	);

	// Pre-registered tab list
	const preRegisteredFiltered = $derived(
		preRegisteredEvacuees
			.filter((e) => matchesEvacueeSearch(e, searchQuery))
			.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
	);

	// Arriving tab list
	const arrivingFiltered = $derived(
		arrivingEvacuees
			.filter((e) => {
				if (!matchesEvacueeSearch(e, searchQuery)) return false;
				const hasScreening = screenedIds.has(e._id);
				if (arrivingSubTab === 'medical') return enableMedical && !hasScreening;
				if (arrivingSubTab === 'zoning') return !enableMedical || hasScreening;
				return true;
			})
			.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
	);

	// All evacuees tab list
	const allFiltered = $derived(
		allEvacuees
			.filter((e) => {
				if (!matchesEvacueeSearch(e, searchQuery)) return false;
				if (allStatusFilter !== 'all' && e.current_stay?.status !== allStatusFilter) return false;
				if (allZoneFilter !== 'all' && e.current_stay?.zone !== allZoneFilter) return false;
				return true;
			})
			.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
	);

	const availableZones = $derived(
		Array.from(new Set(allEvacuees.map((e) => e.current_stay?.zone).filter(Boolean))) as string[]
	);

	function openRow(e: Evacuee) {
		selected = e;
		sheetOpen = true;
	}

	function specialNeedsShort(needs: string[]): string {
		if (!needs?.length) return '—';
		return needs
			.slice(0, 2)
			.map((n) => vulnerableGroupQuery.data?.items.find((i) => i.code === n)?.label ?? n)
			.join(', ');
	}

	function specialNeedsLabels(needs: string[]): { code: string; label: string }[] {
		if (!needs?.length) return [];
		return needs.map((n) => ({
			code: n,
			label: vulnerableGroupQuery.data?.items.find((i) => i.code === n)?.label ?? n
		}));
	}

	function ageLabel(e: Evacuee): string {
		if (e.birth_year) {
			return `${new Date().getFullYear() + 543 - e.birth_year} ปี`;
		}
		if (e.age !== undefined) return `${e.age} ปี`;
		return 'ไม่ระบุ';
	}

	function formatUpdated(iso?: string | null): string {
		if (!iso) return '—';
		try {
			const d = new Date(iso);
			return d.toLocaleString('th-TH', {
				day: 'numeric',
				month: 'short',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return iso;
		}
	}

	function nextQueueBadgeVariant(
		next: string
	): 'default' | 'secondary' | 'destructive' | 'outline' {
		if (next === 'รอแพทย์') return 'destructive';
		if (next === 'รอโซน') return 'default';
		if (next === 'รอยืนยันถึงโซน') return 'default';
		if (next === 'พักแล้ว') return 'secondary';
		return 'outline';
	}

	async function handleCodeInput(raw: string) {
		if (lookupInFlight) return;
		lookupInFlight = true;
		try {
			const result = await lookupFederatedByScanCode(queryClient, raw);
			if (!result) {
				// If not an exact QR/barcode payload, put into search bar to search federated by text
				searchQuery = raw;
				showCameraModal = false;
				toast.info(`ค้นหา: ${raw}`);
				return;
			}
			showCameraModal = false;
			if (result.source === 'couch') {
				toast.success(`พบ: ${formatPersonName(result.evacuee)}`);
				if (result.evacuee.current_stay?.status === 'pre_registered') {
					goReportIn(result.evacuee);
				} else {
					openRow(result.evacuee);
				}
				return;
			}
			toast.success('พบคิวลงทะเบียนล่วงหน้า (คิวกลาง)');
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
						const size = Math.floor(minDimension * 0.7);
						return { width: size, height: size };
					}
				},
				(decodedText) => {
					if (decodedText) {
						if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(100);
						handleCodeInput(decodedText);
					}
				},
				() => {}
			)
			.catch(() => {
				cameraError = 'ไม่สามารถเข้าถึงกล้องได้';
			});
		return () => {
			if (html5QrCode.isScanning) html5QrCode.stop().catch(() => {});
		};
	}

	function goReportIn(evacuee: Evacuee) {
		sheetOpen = false;
		selected = null;
		goto(
			resolve(`/onsite/people/${evacuee._id}/report-in` as `/onsite/people/${string}/report-in`)
		);
	}
</script>

<svelte:head>
	<title>ทะเบียนผู้ประสบภัย (Station 1) | SmartShelter</title>
</svelte:head>

<div class="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 md:px-6">
	<!-- 1. Header Bar -->
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
					<ClipboardList class="size-6 text-[#0A2647]" />
					<h1 class="text-2xl font-bold tracking-tight text-slate-900 md:text-3xl">
						ทะเบียนผู้ประสบภัย
					</h1>
					<Badge variant="outline" class="border-blue-200 bg-blue-50 font-semibold text-blue-900">
						Station 1
					</Badge>
				</div>
				<p class="mt-0.5 text-xs text-slate-500">
					Registration Desk — จุดรับรายงานตัวผู้จองล่วงหน้าและรับลงทะเบียนหน้างาน (Walk-in)
				</p>
			</div>
		</div>
		{#if !newRegistrationLocked}
			<Button
				href={resolve('/onsite/people/new')}
				class="h-11 gap-2 rounded-xl bg-[#0A2647] font-semibold text-white shadow-xs hover:bg-[#051930]"
			>
				<UserPlus class="size-4" />
				<span>+ ลงทะเบียน Walk-in</span>
			</Button>
		{/if}
	</header>

	<!-- 2. Unified Smart Search & Scan Bar (Omnibox with Anti-dupe) -->
	<Card.Root class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-xs">
		<div class="mb-3 flex flex-wrap items-center justify-between gap-2">
			<label for="station1-search-input" class="text-sm font-semibold text-slate-800">
				ค้นหาหรือสแกนก่อนลงทะเบียน (ตรวจซ้ำในศูนย์นี้และคิวกลาง)
			</label>
			<span class="text-xs text-slate-500">
				พิมพ์ชื่อ, เลขบัตร 13 หลัก, เบอร์โทร หรือใช้เครื่องสแกนบาร์โค้ด
			</span>
		</div>
		<Station1IntakeSearch
			bind:query={searchQuery}
			canClaimPool={canAccessUnassignedQueue}
			onNewRegistrationLockedChange={(locked) => (newRegistrationLocked = locked)}
			onScanClick={() => (showCameraModal = true)}
			onCodeEnter={handleCodeInput}
		/>
	</Card.Root>

	<!-- 3. Queue Stat Summary Cards -->
	<section aria-label="สรุปยอดคิวผู้ประสบภัย" class="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
		<!-- Card 1: Pre-registered -->
		<button
			type="button"
			onclick={() => (activeTab = 'pre_registered')}
			class="group flex flex-col justify-between rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm {activeTab ===
			'pre_registered'
				? 'border-blue-300 bg-blue-50/50 shadow-2xs ring-2 ring-blue-500/20'
				: 'border-slate-200/80 bg-white shadow-2xs'}"
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-blue-900">รอรายงานตัว</span>
				<div
					class="flex size-7 items-center justify-center rounded-lg bg-blue-100 text-blue-700 transition-colors group-hover:bg-blue-200"
				>
					<CalendarClock class="size-4" />
				</div>
			</div>
			<div class="mt-2">
				<p class="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
					{preRegisteredEvacuees.length}
					<span class="text-xs font-normal text-slate-500">คน</span>
				</p>
				<p class="mt-0.5 text-2xs text-slate-500">ลงทะเบียนล่วงหน้า / ออนไลน์</p>
			</div>
		</button>

		<!-- Card 2: Arriving -->
		<button
			type="button"
			onclick={() => (activeTab = 'arriving')}
			class="group flex flex-col justify-between rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm {activeTab ===
			'arriving'
				? 'border-amber-300 bg-amber-50/50 shadow-2xs ring-2 ring-amber-500/20'
				: 'border-slate-200/80 bg-white shadow-2xs'}"
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-amber-900">รอส่งต่อเข้าพัก</span>
				<div
					class="flex size-7 items-center justify-center rounded-lg bg-amber-100 text-amber-700 transition-colors group-hover:bg-amber-200"
				>
					<Clock class="size-4" />
				</div>
			</div>
			<div class="mt-2">
				<p class="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
					{arrivingEvacuees.length}
					<span class="text-xs font-normal text-slate-500">คน</span>
				</p>
				<p class="mt-0.5 text-2xs text-slate-500">
					{#if enableMedical}
						รอตรวจแพทย์ {waitingMedicalCount} ·
					{/if}รอจัดโซน {waitingZoningCount}
				</p>
			</div>
		</button>

		<!-- Card 3: In Shelter -->
		<button
			type="button"
			onclick={() => (activeTab = 'all')}
			class="group flex flex-col justify-between rounded-xl border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-sm {activeTab ===
			'all'
				? 'border-green-300 bg-green-50/50 shadow-2xs ring-2 ring-green-500/20'
				: 'border-slate-200/80 bg-white shadow-2xs'}"
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-green-900">พักในศูนย์แล้ว</span>
				<div
					class="flex size-7 items-center justify-center rounded-lg bg-green-100 text-green-700 transition-colors group-hover:bg-green-200"
				>
					<Home class="size-4" />
				</div>
			</div>
			<div class="mt-2">
				<p class="text-2xl font-bold tracking-tight text-slate-900 tabular-nums">
					{inShelterEvacuees.length}
					<span class="text-xs font-normal text-slate-500">คน</span>
				</p>
				<p class="mt-0.5 text-2xs text-slate-500">
					ยืนยันถึงโซนแล้ว {roomConfirmedCount} คน
				</p>
			</div>
		</button>

		<!-- Card 4: Central Pool Info -->
		<div
			class="flex flex-col justify-between rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs"
		>
			<div class="flex items-center justify-between">
				<span class="text-xs font-semibold text-slate-700">คิวกลาง (Central Pool)</span>
				<div class="flex size-7 items-center justify-center rounded-lg bg-slate-100 text-slate-600">
					<Globe class="size-4" />
				</div>
			</div>
			<div class="mt-2">
				<p class="text-base font-bold text-slate-800">พร้อมดึงเข้าศูนย์</p>
				<p class="mt-0.5 text-2xs text-slate-500">ค้นหาเพื่อ Claim เข้าศูนย์นี้ได้ทันที</p>
			</div>
		</div>
	</section>

	<!-- 4. Workflow Tabs & Lists -->
	<section class="flex flex-col gap-4">
		<!-- Tab Switcher Navigation -->
		<div class="border-b border-border">
			<nav class="flex gap-1 overflow-x-auto" aria-label="แท็บกระบวนการลงทะเบียน">
				<button
					type="button"
					onclick={() => (activeTab = 'pre_registered')}
					class="flex shrink-0 items-center gap-2 border-b-2 px-4 pb-3 text-sm font-semibold transition-colors {activeTab ===
					'pre_registered'
						? 'border-primary text-primary'
						: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
				>
					<CalendarClock class="size-4" />
					<span>รอรายงานตัว (Pre-registered)</span>
					<span
						class="rounded-full bg-blue-100 px-2 py-0.5 text-xs font-bold text-blue-800 tabular-nums dark:bg-blue-950 dark:text-blue-300"
					>
						{preRegisteredEvacuees.length}
					</span>
				</button>

				<button
					type="button"
					onclick={() => (activeTab = 'arriving')}
					class="flex shrink-0 items-center gap-2 border-b-2 px-4 pb-3 text-sm font-semibold transition-colors {activeTab ===
					'arriving'
						? 'border-primary text-primary'
						: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
				>
					<Clock class="size-4" />
					<span>รอส่งต่อเข้าพัก (Arriving)</span>
					<span
						class="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-bold text-amber-800 tabular-nums dark:bg-amber-950 dark:text-amber-300"
					>
						{arrivingEvacuees.length}
					</span>
				</button>

				<button
					type="button"
					onclick={() => (activeTab = 'all')}
					class="flex shrink-0 items-center gap-2 border-b-2 px-4 pb-3 text-sm font-semibold transition-colors {activeTab ===
					'all'
						? 'border-primary text-primary'
						: 'border-transparent text-muted-foreground hover:border-border hover:text-foreground'}"
				>
					<Users class="size-4" />
					<span>ผู้ประสบภัยทั้งหมด (All Evacuees)</span>
					<span class="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums">
						{allEvacuees.length}
					</span>
				</button>
			</nav>
		</div>

		<!-- Tab 1: Pre-registered (รอรายงานตัว) -->
		{#if activeTab === 'pre_registered'}
			<Card.Root class="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
				<div
					class="flex flex-col gap-2 border-b border-border bg-slate-50/60 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
				>
					<div>
						<h2 class="text-sm font-semibold text-slate-900">
							รายชื่อผู้ลงทะเบียนล่วงหน้า รอรับรายงานตัว (Station 1)
						</h2>
						<p class="text-xs text-slate-500">
							กดยืนยันตัวตนเพื่อดึงข้อมูลครอบครัวเดิมมาตรวจและปรับปรุงข้อมูล ไม่ต้องกรอกใหม่
						</p>
					</div>
					<span class="text-xs text-slate-500">
						แสดง {preRegisteredFiltered.length} จาก {preRegisteredEvacuees.length} รายการ
					</span>
				</div>

				{#if allEvacueesQuery.isPending}
					<div class="flex h-40 items-center justify-center text-sm text-slate-500">
						กำลังโหลดข้อมูล...
					</div>
				{:else if preRegisteredFiltered.length === 0}
					<div
						class="flex h-48 flex-col items-center justify-center gap-3 text-center text-sm text-slate-500"
					>
						<p class="font-medium text-slate-700">ไม่มีรายการผู้ลงทะเบียนล่วงหน้าค้างรายงานตัว</p>
						<p class="text-xs text-slate-500">
							{searchQuery
								? 'ไม่พบข้อมูลที่ตรงกับคำค้นหา'
								: 'หากมีผู้ประสบภัย Walk-in สามารถกดลงทะเบียนใหม่ได้ทันที'}
						</p>
						<Button
							variant="outline"
							href={resolve('/onsite/people/new')}
							class="gap-1.5 rounded-xl border-slate-200"
						>
							<UserPlus class="size-4" />
							<span>+ ลงทะเบียน Walk-in</span>
						</Button>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<Table.Root>
							<Table.Header>
								<Table.Row class="bg-muted/30">
									<Table.Head class="pl-5">ชื่อ-นามสกุล</Table.Head>
									<Table.Head>เลขที่เอกสาร</Table.Head>
									<Table.Head>เบอร์โทร</Table.Head>
									<Table.Head>ครอบครัว</Table.Head>
									<Table.Head>ความต้องการพิเศษ</Table.Head>
									<Table.Head>สถานะ</Table.Head>
									<Table.Head class="pr-5 text-right">การจัดการ</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each preRegisteredFiltered as row (row._id)}
									{@const hh = row.household_id ? householdMap.get(row.household_id) : null}
									<Table.Row
										class="cursor-pointer hover:bg-slate-50/80"
										onclick={() => openRow(row)}
									>
										<Table.Cell class="pl-5 font-semibold text-slate-900">
											{formatPersonName(row)}
											{#if row.nickname}
												<span class="text-xs font-normal text-slate-500">({row.nickname})</span>
											{/if}
										</Table.Cell>
										<Table.Cell class="font-mono text-xs text-slate-600">
											{maskNationalId(row.person_id?.number)}
										</Table.Cell>
										<Table.Cell class="text-xs text-slate-600 tabular-nums">
											{row.phone || '—'}
										</Table.Cell>
										<Table.Cell class="text-xs font-medium text-slate-700">
											{hh?.label ?? '—'}
										</Table.Cell>
										<Table.Cell class="max-w-[12rem] truncate text-xs text-slate-600">
											{specialNeedsShort(row.special_needs)}
										</Table.Cell>
										<Table.Cell>
											<StayStatusBadge status="pre_registered" size="sm" />
										</Table.Cell>
										<Table.Cell class="pr-5 text-right">
											<Button
												size="sm"
												class="gap-1.5 rounded-lg bg-blue-600 px-3 font-semibold text-white shadow-2xs hover:bg-blue-700"
												onclick={(e) => {
													e.stopPropagation();
													goReportIn(row);
												}}
											>
												<Zap class="size-3.5" />
												<span>รับรายงานตัว</span>
											</Button>
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				{/if}
			</Card.Root>

			<!-- Tab 2: Arriving (รอส่งต่อเข้าพัก) -->
		{:else if activeTab === 'arriving'}
			<Card.Root class="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
				<div
					class="flex flex-col gap-3 border-b border-border bg-slate-50/60 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
				>
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-xs font-semibold text-slate-700">กรองขั้นตอน:</span>
						<button
							type="button"
							onclick={() => (arrivingSubTab = 'all')}
							class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {arrivingSubTab ===
							'all'
								? 'border-amber-400 bg-amber-50 font-bold text-amber-900'
								: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
						>
							ทั้งหมด ({arrivingEvacuees.length})
						</button>
						{#if enableMedical}
							<button
								type="button"
								onclick={() => (arrivingSubTab = 'medical')}
								class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {arrivingSubTab ===
								'medical'
									? 'border-destructive bg-destructive/10 font-bold text-destructive'
									: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
							>
								รอตรวจแพทย์ ({waitingMedicalCount})
							</button>
						{/if}
						<button
							type="button"
							onclick={() => (arrivingSubTab = 'zoning')}
							class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {arrivingSubTab ===
							'zoning'
								? 'border-primary bg-primary/10 font-bold text-primary'
								: 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'}"
						>
							รอจัดโซนที่พัก ({waitingZoningCount})
						</button>
					</div>
					<span class="text-xs text-slate-500">
						แสดง {arrivingFiltered.length} จาก {arrivingEvacuees.length} รายการ
					</span>
				</div>

				{#if arrivingFiltered.length === 0}
					<div
						class="flex h-44 flex-col items-center justify-center gap-2 text-center text-sm text-slate-500"
					>
						<p class="font-medium text-slate-700">ไม่มีรายการในหมวดนี้</p>
						<p class="text-xs text-slate-500">ผู้ประสบภัยได้รับการตรวจและจัดสรรที่พักเรียบร้อยแล้ว</p>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<Table.Root>
							<Table.Header>
								<Table.Row class="bg-muted/30">
									<Table.Head class="pl-5">ชื่อ-นามสกุล</Table.Head>
									<Table.Head>เลขที่เอกสาร</Table.Head>
									<Table.Head>ครอบครัว</Table.Head>
									{#if enableMedical}
										<Table.Head>การแพทย์</Table.Head>
									{/if}
									<Table.Head>คิวถัดไป</Table.Head>
									<Table.Head class="pr-5 text-right">ส่งต่อ</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each arrivingFiltered as row (row._id)}
									{@const next = nextQueueLabel(row, {
										enableMedicalScreening: enableMedical,
										hasScreening: screenedIds.has(row._id)
									})}
									{@const hh = row.household_id ? householdMap.get(row.household_id) : null}
									{@const screening = screeningByEvacuee.get(row._id)}
									<Table.Row
										class="cursor-pointer hover:bg-slate-50/80"
										onclick={() => openRow(row)}
									>
										<Table.Cell class="pl-5 font-semibold text-slate-900">
											{formatPersonName(row)}
										</Table.Cell>
										<Table.Cell class="font-mono text-xs text-slate-600">
											{maskNationalId(row.person_id?.number)}
										</Table.Cell>
										<Table.Cell class="text-xs text-slate-700">
											{hh?.label ?? '—'}
										</Table.Cell>
										{#if enableMedical}
											<Table.Cell class="text-xs">
												{#if screening}
													<span class="inline-flex items-center gap-1 font-medium text-emerald-700">
														<CheckCircle2 class="size-3.5 text-emerald-600" />
														ตรวจแล้ว{#if screening.triage_level}
															({TRIAGE_LABELS[screening.triage_level] ?? screening.triage_level}){/if}
													</span>
												{:else}
													<span class="font-medium text-amber-700">รอตรวจคัดกรอง</span>
												{/if}
											</Table.Cell>
										{/if}
										<Table.Cell>
											<Badge variant={nextQueueBadgeVariant(next)} class="font-semibold">
												{next}
											</Badge>
										</Table.Cell>
										<Table.Cell class="pr-5 text-right">
											<div class="flex justify-end gap-1.5">
												{#if canMedical && next === 'รอแพทย์'}
													<Button
														size="sm"
														variant="outline"
														class="gap-1 border-rose-200 bg-rose-50 text-rose-800 hover:bg-rose-100"
														href={resolve(
															`/onsite/medical-screening/${row._id}` as `/onsite/medical-screening/${string}`
														)}
														onclick={(e) => e.stopPropagation()}
													>
														<Stethoscope class="size-3.5" />
														<span>คัดกรอง (S2)</span>
													</Button>
												{/if}
												{#if canZoning && (next === 'รอโซน' || !enableMedical || screenedIds.has(row._id))}
													<Button
														size="sm"
														class="gap-1 bg-[#0A2647] text-white hover:bg-[#051930]"
														href={resolve(`/onsite/zoning/${row._id}` as `/onsite/zoning/${string}`)}
														onclick={(e) => e.stopPropagation()}
													>
														<MapPin class="size-3.5" />
														<span>จัดโซน (S3)</span>
													</Button>
												{/if}
												<Button
													size="sm"
													variant="ghost"
													class="text-xs text-slate-500 hover:text-slate-900"
													onclick={(e) => {
														e.stopPropagation();
														openRow(row);
													}}
												>
													รายละเอียด
												</Button>
											</div>
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				{/if}
			</Card.Root>

			<!-- Tab 3: All Evacuees (ผู้ประสบภัยทั้งหมด) -->
		{:else}
			<Card.Root class="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-xs">
				<div
					class="flex flex-col gap-3 border-b border-border bg-slate-50/60 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between"
				>
					<div class="flex flex-wrap items-center gap-3">
						<div class="flex items-center gap-1.5 text-xs text-slate-600">
							<span class="font-medium">สถานะ:</span>
							<select
								bind:value={allStatusFilter}
								class="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-primary"
							>
								<option value="all">ทุกสถานะ</option>
								<option value="pre_registered">ลงทะเบียนล่วงหน้า</option>
								<option value="arriving">รอเข้าพัก</option>
								<option value="active">เข้าพักแล้ว</option>
								<option value="room_confirmed">ยืนยันถึงโซนแล้ว</option>
								<option value="temporary_leave">ออกชั่วคราว</option>
								<option value="transferred">ย้ายศูนย์</option>
								<option value="checked_out">เช็คเอาต์</option>
								<option value="deceased">เสียชีวิต</option>
								<option value="cancelled">ยกเลิก</option>
							</select>
						</div>

						{#if availableZones.length > 0}
							<div class="flex items-center gap-1.5 text-xs text-slate-600">
								<span class="font-medium">โซน:</span>
								<select
									bind:value={allZoneFilter}
									class="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 focus:outline-hidden focus:ring-1 focus:ring-primary"
								>
									<option value="all">ทุกโซน</option>
									{#each availableZones as z}
										<option value={z}>โซน {z}</option>
									{/each}
								</select>
							</div>
						{/if}
					</div>
					<span class="text-xs text-slate-500">
						แสดง {allFiltered.length} จาก {allEvacuees.length} รายการ
					</span>
				</div>

				{#if allFiltered.length === 0}
					<div
						class="flex h-44 flex-col items-center justify-center gap-2 text-center text-sm text-slate-500"
					>
						<p class="font-medium text-slate-700">ไม่พบข้อมูลที่ตรงกับเงื่อนไข</p>
					</div>
				{:else}
					<div class="overflow-x-auto">
						<Table.Root>
							<Table.Header>
								<Table.Row class="bg-muted/30">
									<Table.Head class="pl-5">ชื่อ-นามสกุล</Table.Head>
									<Table.Head>สถานะ</Table.Head>
									<Table.Head>โซน</Table.Head>
									<Table.Head>ครอบครัว</Table.Head>
									<Table.Head>ความต้องการพิเศษ</Table.Head>
									<Table.Head>อัปเดตล่าสุด</Table.Head>
									<Table.Head class="pr-5">คิวถัดไป</Table.Head>
								</Table.Row>
							</Table.Header>
							<Table.Body>
								{#each allFiltered as row (row._id)}
									{@const next = nextQueueLabel(row, {
										enableMedicalScreening: enableMedical,
										hasScreening: screenedIds.has(row._id)
									})}
									{@const hh = row.household_id ? householdMap.get(row.household_id) : null}
									<Table.Row
										class="cursor-pointer hover:bg-slate-50/80"
										onclick={() => openRow(row)}
									>
										<Table.Cell class="pl-5 font-semibold text-slate-900">
											{formatPersonName(row)}
										</Table.Cell>
										<Table.Cell>
											<StayStatusBadge status={row.current_stay?.status} size="sm" />
										</Table.Cell>
										<Table.Cell class="text-xs font-medium">
											{row.current_stay?.zone ? `โซน ${row.current_stay.zone}` : '—'}
										</Table.Cell>
										<Table.Cell class="text-xs text-slate-600">
											{hh?.label ?? '—'}
										</Table.Cell>
										<Table.Cell class="max-w-[12rem] truncate text-xs text-slate-600">
											{specialNeedsShort(row.special_needs)}
										</Table.Cell>
										<Table.Cell class="text-xs text-slate-500 tabular-nums">
											{formatUpdated(row.updated_at)}
										</Table.Cell>
										<Table.Cell class="pr-5">
											<Badge variant="secondary" class="text-xs">
												{next}
											</Badge>
										</Table.Cell>
									</Table.Row>
								{/each}
							</Table.Body>
						</Table.Root>
					</div>
				{/if}
			</Card.Root>
		{/if}
	</section>
</div>

<!-- Evacuee Detail Side Sheet (Drawer) -->
<Sheet.Root bind:open={sheetOpen}>
	<Sheet.Content side="right" class="flex w-full flex-col gap-0 overflow-y-auto sm:max-w-md">
		{#if selected}
			{@const next = nextQueueLabel(selected, {
				enableMedicalScreening: enableMedical,
				hasScreening: screenedIds.has(selected._id)
			})}
			{@const hh = selected.household_id ? householdMap.get(selected.household_id) : null}
			{@const screening = screeningByEvacuee.get(selected._id)}
			{@const needs = specialNeedsLabels(selected.special_needs)}
			{@const stayStatus = selected.current_stay?.status ?? 'pre_registered'}
			{@const cardType = selected.person_id?.cardType ?? 'national_id'}

			<Sheet.Header class="border-b border-border pb-4">
				<Sheet.Title class="text-xl">
					{formatPersonName(selected)}
					{#if selected.nickname}
						<span class="text-base font-normal text-muted-foreground">({selected.nickname})</span>
					{/if}
				</Sheet.Title>
				<Sheet.Description class="sr-only">รายละเอียดผู้ประสบภัยและสถานะคิว</Sheet.Description>
				<div class="mt-2 flex flex-wrap items-center gap-1.5">
					<StayStatusBadge status={stayStatus} size="sm" />
					<Badge variant={nextQueueBadgeVariant(next)}>คิวถัดไป: {next}</Badge>
					{#if enableMedical}
						{#if screening}
							<Badge variant="secondary">
								คัดกรองแล้ว{#if screening.triage_level}
									· triage {TRIAGE_LABELS[screening.triage_level] ?? screening.triage_level}{/if}
							</Badge>
						{:else if stayStatus === 'arriving'}
							<Badge variant="destructive">ยังไม่คัดกรอง</Badge>
						{/if}
					{/if}
					{#if selected.current_stay?.zone}
						<Badge variant="secondary">โซน {selected.current_stay.zone}</Badge>
					{/if}
				</div>
			</Sheet.Header>

			<div class="flex flex-1 flex-col gap-5 px-4 py-5">
				<section class="space-y-3">
					<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						สถานะที่พัก
					</h3>
					<div class="grid grid-cols-2 gap-3 text-sm">
						<div>
							<p class="text-xs text-muted-foreground">สถานะ</p>
							<div class="mt-0.5">
								<StayStatusBadge status={stayStatus} size="sm" />
							</div>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">โซน</p>
							<p class="font-medium">{selected.current_stay?.zone ?? '—'}</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">สถานะตั้งแต่</p>
							<p class="font-medium">{formatUpdated(selected.current_stay?.since)}</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">อัปเดตล่าสุด</p>
							<p class="font-medium">{formatUpdated(selected.updated_at)}</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">คิวถัดไป</p>
							<p class="font-medium">{next}</p>
						</div>
						{#if enableMedical}
							<div>
								<p class="text-xs text-muted-foreground">คัดกรองแพทย์</p>
								<p class="font-medium">
									{#if screening}
										แล้วเสร็จ{#if screening.triage_level}
											({TRIAGE_LABELS[screening.triage_level] ?? screening.triage_level}){/if}
									{:else}
										ยังไม่ทำ
									{/if}
								</p>
							</div>
						{/if}
					</div>
				</section>

				<section class="space-y-3 border-t border-border pt-5">
					<h3 class="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
						ข้อมูลส่วนบุคคล
					</h3>
					<div class="grid grid-cols-2 gap-3 text-sm">
						<div>
							<p class="text-xs text-muted-foreground">เพศ</p>
							<p class="font-medium">{GENDER_LABELS[selected.gender] ?? selected.gender}</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">อายุ</p>
							<p class="font-medium">{ageLabel(selected)}</p>
						</div>
						<div class="col-span-2">
							<p class="text-xs text-muted-foreground">เบอร์โทร</p>
							<p class="font-medium">{selected.phone || '—'}</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">เอกสาร</p>
							<p class="font-medium">{CARD_TYPE_LABELS[cardType] ?? cardType}</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">เลขที่เอกสาร</p>
							<p class="font-mono text-sm font-medium">
								{maskNationalId(selected.person_id?.number)}
							</p>
						</div>
						<div class="col-span-2">
							<p class="text-xs text-muted-foreground">ครอบครัว</p>
							<p class="font-medium">{hh?.label ?? '—'}</p>
						</div>
						<div class="col-span-2">
							<p class="text-xs text-muted-foreground">ความต้องการพิเศษ</p>
							{#if needs.length}
								<div class="mt-1 flex flex-wrap gap-1">
									{#each needs as need (need.code)}
										<Badge variant="outline" class="font-normal">{need.label}</Badge>
									{/each}
								</div>
							{:else}
								<p class="font-medium">—</p>
							{/if}
						</div>
						{#if selected.emergency_contact}
							<div class="col-span-2 rounded-md border border-border bg-muted/30 p-3">
								<p class="text-xs text-muted-foreground">ผู้ติดต่อฉุกเฉิน</p>
								<p class="mt-0.5 font-medium">
									{selected.emergency_contact.name}
									{#if selected.emergency_contact.relation}
										<span class="font-normal text-muted-foreground"
											>({selected.emergency_contact.relation})</span
										>
									{/if}
								</p>
								<p class="text-sm text-muted-foreground">
									{selected.emergency_contact.phone || 'ไม่มีเบอร์'}
								</p>
							</div>
						{/if}
					</div>
				</section>
			</div>

			<Sheet.Footer class="border-t border-border sm:flex-col">
				{#if selected.current_stay?.status === 'pre_registered'}
					<Button
						class="gap-1.5 bg-blue-600 text-white hover:bg-blue-700"
						onclick={() => goReportIn(selected!)}
					>
						<Zap class="size-4" />
						{REPORT_IN_CTA_LABEL}
					</Button>
				{/if}
				{#if canMedical && next === 'รอแพทย์'}
					<Button
						variant="secondary"
						onclick={() =>
							goto(
								resolve(
									`/onsite/medical-screening/${selected!._id}` as `/onsite/medical-screening/${string}`
								)
							)}
					>
						ไปคัดกรองแพทย์ (S2)
					</Button>
				{/if}
				{#if canZoning && (next === 'รอโซน' || selected.current_stay?.status === 'arriving')}
					<Button
						variant="secondary"
						onclick={() =>
							goto(resolve(`/onsite/zoning/${selected!._id}` as `/onsite/zoning/${string}`))}
					>
						ไปจัดโซน (S3)
					</Button>
				{/if}
				<Button
					variant="outline"
					onclick={() =>
						goto(
							resolve(
								`/onsite/people/evacuee-profile-view/${selected!._id}` as `/onsite/people/evacuee-profile-view/${string}`
							)
						)}
				>
					เปิดโปรไฟล์
				</Button>
			</Sheet.Footer>
		{/if}
	</Sheet.Content>
</Sheet.Root>

<!-- Camera QR Scanner Modal -->
<Dialog.Root bind:open={showCameraModal}>
	<Dialog.Content class="max-w-md">
		<Dialog.Header>
			<Dialog.Title>สแกน Person QR</Dialog.Title>
		</Dialog.Header>
		{#if cameraError}
			<p class="text-sm text-destructive">{cameraError}</p>
		{:else if showCameraModal}
			<div
				id="station1-qr-reader"
				class="overflow-hidden rounded-lg"
				{@attach cameraAttachment}
			></div>
		{/if}
	</Dialog.Content>
</Dialog.Root>

<!-- Central Pool Claim Dialog -->
<ClaimDialog
	bind:open={claimOpen}
	bind:hit={claimHit}
	shelterCode={shelterStore.selectedShelterCode ?? getShelterCode()}
/>
