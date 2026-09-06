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

	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Table from '$lib/components/ui/table';
	import * as Tabs from '$lib/components/ui/tabs';

	import {
		useEvacuees,
		useHouseholds,
		useScreenings,
		maskNationalId,
		matchesEvacueeSearch,
		formatPersonName,
		classifyZoningQueueTab,
		parseZoningQrCode,
		buildZoningPath,
		useConfirmRoom,
		useConfirmRoomForHousehold,
		listPendingZoneArrivalConfirmations,
		type ZoningQueueTab,
		type TriageLevel
	} from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { useMasterData } from '$lib/features/master-data';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';

	const allEvacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	const screeningsQuery = useScreenings();
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');
	const confirmRoomMutation = useConfirmRoom();
	const confirmRoomHouseholdMutation = useConfirmRoomForHousehold();

	const enableMedical = $derived(
		shelterQuery.data?.feature_flags?.enable_medical_screening ?? false
	);
	const allEvacuees = $derived(allEvacueesQuery.data ?? []);
	const householdMap = $derived(new SvelteMap((householdsQuery.data ?? []).map((h) => [h._id, h])));
	const screenings = $derived(screeningsQuery.data ?? []);
	const screenedIds = $derived(new Set(screenings.map((s) => s.evacuee_id)));
	const triageByEvacuee = $derived.by(() => {
		const map = new SvelteMap<string, TriageLevel>();
		const sorted = [...screenings].sort((a, b) =>
			(b.screened_at ?? b.created_at).localeCompare(a.screened_at ?? a.created_at)
		);
		for (const s of sorted) {
			if (s.triage_level && !map.has(s.evacuee_id)) {
				map.set(s.evacuee_id, s.triage_level);
			}
		}
		return map;
	});

	const TRIAGE_LABELS: Record<TriageLevel, string> = {
		green: 'เขียว',
		yellow: 'เหลือง',
		red: 'แดง'
	};
	const TRIAGE_BADGE_CLASS: Record<TriageLevel, string> = {
		green: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200',
		yellow: 'border-amber-500/40 bg-amber-500/15 text-amber-900 dark:text-amber-200',
		red: 'border-red-500/40 bg-red-500/15 text-red-800 dark:text-red-200'
	};

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

	const isLoading = $derived(
		allEvacueesQuery.isPending ||
			screeningsQuery.isPending ||
			householdsQuery.isPending ||
			shelterQuery.isPending
	);

	function openDetail(id: string) {
		goto(resolve(buildZoningPath(id) as `/onsite/zoning/${string}`));
	}

	function authorCtx() {
		return {
			shelterCode: getShelterCode(),
			createdBy: authStore.user?.name ?? 'unknown'
		};
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

	function handleCodeInput(raw: string) {
		const parsedId = parseZoningQrCode(raw);
		if (!parsedId) {
			toast.error('รหัส QR หรือข้อความที่สแกนไม่ถูกต้อง');
			return;
		}

		const found = allEvacuees.find((e) => e._id === parsedId || e.person_id?.number === parsedId);
		if (found) {
			toast.success(`พบผู้ประสบภัย: ${formatPersonName(found)}`);
			barcodeInput = '';
			showCameraModal = false;
			openDetail(found._id);
			return;
		}

		toast.error('ไม่พบข้อมูลผู้ประสบภัยที่ตรงกับรหัสนี้');
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
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-3">
			<a
				href={resolve('/onsite')}
				class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
				title="กลับหน้าระบบส่วนหน้า"
			>
				<ArrowLeft class="size-4" />
			</a>
			<div>
				<div class="flex items-center gap-2.5">
					<div
						class="flex size-8 items-center justify-center rounded-lg bg-amber-500/10 text-amber-700 dark:text-amber-300"
					>
						<MapPin class="size-5" />
					</div>
					<h1 class="text-2xl font-bold tracking-tight text-foreground">จัดสรรที่พัก</h1>
					<Badge
						variant="outline"
						class="border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-200"
					>
						Station 3
					</Badge>
				</div>
				<p class="mt-0.5 text-xs text-muted-foreground">
					คิวพร้อมจัดโซน · รอยืนยันถึงโซน · ยืนยันแล้ว — ค้นหาหรือสแกน Handover / Person QR
				</p>
			</div>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<Badge variant="secondary" class="gap-1.5 px-3 py-1.5 text-sm font-semibold shadow-xs">
				<Clock class="size-3.5 text-amber-600" />
				<span>พร้อมจัด:</span>
				<span class="font-bold text-amber-700 dark:text-amber-300">{pendingEvacuees.length} คน</span
				>
			</Badge>
			<Badge variant="secondary" class="gap-1.5 px-3 py-1.5 text-sm font-semibold shadow-xs">
				<Clock class="size-3.5 text-emerald-600" />
				<span>รอยืนยัน:</span>
				<span class="font-bold text-emerald-700 dark:text-emerald-300"
					>{awaitingConfirmEvacuees.length} คน</span
				>
			</Badge>
			<Badge variant="secondary" class="gap-1.5 px-3 py-1.5 text-sm font-semibold shadow-xs">
				<Check class="size-3.5 text-sky-600" />
				<span>ยืนยันแล้ว:</span>
				<span class="font-bold text-sky-700 dark:text-sky-300">{assignedEvacuees.length} คน</span>
			</Badge>
		</div>
	</div>

	<Card.Root class="border-border bg-card p-4 shadow-sm">
		<div class="flex flex-col gap-3 md:flex-row md:items-center">
			<div class="relative flex-1">
				<Search
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					type="text"
					placeholder="ค้นหาชื่อ, นามสกุล, เบอร์โทร, เลขบัตร..."
					bind:value={searchQuery}
					class="h-10 w-full bg-background pr-8 pl-9"
				/>
				{#if searchQuery}
					<button
						type="button"
						onclick={() => (searchQuery = '')}
						class="absolute top-1/2 right-2.5 -translate-y-1/2 p-0.5 text-muted-foreground hover:text-foreground"
						title="ล้างคำค้นหา"
					>
						<X class="size-3.5" />
					</button>
				{/if}
			</div>

			<div class="flex items-center gap-2">
				<div class="relative min-w-[220px]">
					<Scan
						class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
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
						class="h-10 bg-background pl-9 font-mono text-xs"
					/>
				</div>
				<Button
					variant="outline"
					size="default"
					onclick={() => handleCodeInput(barcodeInput)}
					disabled={!barcodeInput.trim()}
					class="h-10"
				>
					ยืนยัน
				</Button>
				<Button
					variant="default"
					size="default"
					onclick={() => (showCameraModal = true)}
					class="h-10 gap-1.5 bg-amber-600 text-white hover:bg-amber-700"
				>
					<Camera class="size-4" />
					<span>สแกนกล้อง</span>
				</Button>
			</div>
		</div>
	</Card.Root>

	<Tabs.Root
		value={activeTab}
		onValueChange={(v) => {
			if (v === 'pending' || v === 'awaiting_confirm' || v === 'assigned') activeTab = v;
		}}
	>
		<Tabs.List class="mb-3 flex h-auto flex-wrap gap-1">
			<Tabs.Trigger value="pending">พร้อมจัดโซน ({pendingEvacuees.length})</Tabs.Trigger>
			<Tabs.Trigger value="awaiting_confirm">
				รอยืนยันถึงโซน ({awaitingConfirmEvacuees.length})
			</Tabs.Trigger>
			<Tabs.Trigger value="assigned">ยืนยันแล้ว ({assignedEvacuees.length})</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value={activeTab}>
			<Card.Root class="overflow-hidden border-border bg-card shadow-sm">
				<Card.Header class="border-b bg-muted/20 px-5 py-3.5">
					<div class="flex items-center gap-2">
						<Users class="size-4 text-amber-600" />
						<Card.Title class="text-base font-semibold">
							{#if activeTab === 'pending'}
								Cleared for Zoning — คิวพร้อมจัดสรรที่พัก
							{:else if activeTab === 'awaiting_confirm'}
								รอยืนยันถึงโซน (Zone Arrival Confirmation) — ไม่หมดอายุอัตโนมัติ
							{:else}
								รายการที่ยืนยันถึงโซนแล้ว (ย้ายโซนได้)
							{/if}
						</Card.Title>
						<Badge variant="secondary" class="text-xs">{filteredQueue.length} ราย</Badge>
					</div>
				</Card.Header>
				<Card.Content class="p-0">
					{#if isLoading}
						<div class="flex h-48 flex-col items-center justify-center gap-2 text-muted-foreground">
							<div
								class="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
							></div>
							<p class="text-xs">กำลังโหลดคิว...</p>
						</div>
					{:else if filteredQueue.length === 0}
						<div class="flex h-48 flex-col items-center justify-center gap-2 px-6 text-center">
							<MapPin class="size-8 text-muted-foreground/50" />
							<p class="text-sm font-medium text-muted-foreground">
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
								<Table.Header>
									<Table.Row class="bg-muted/30 hover:bg-muted/30">
										<Table.Head class="pl-5">ชื่อ-นามสกุล</Table.Head>
										<Table.Head>บัตร</Table.Head>
										<Table.Head>Triage</Table.Head>
										<Table.Head>ความต้องการพิเศษ</Table.Head>
										<Table.Head>ครอบครัว</Table.Head>
										<Table.Head>{activeTab === 'pending' ? 'อัปเดต' : 'โซน'}</Table.Head>
										<Table.Head class="pr-5 text-right">ดำเนินการ</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each filteredQueue as row (row._id)}
										{@const hh = row.household_id ? householdMap.get(row.household_id) : null}
										{@const triage = triageByEvacuee.get(row._id)}
										<Table.Row class="cursor-pointer" onclick={() => openDetail(row._id)}>
											<Table.Cell class="pl-5 font-medium">
												{formatPersonName(row)}
											</Table.Cell>
											<Table.Cell class="font-mono text-xs">
												{maskNationalId(row.person_id?.number)}
											</Table.Cell>
											<Table.Cell>
												{#if triage}
													<Badge variant="outline" class={TRIAGE_BADGE_CLASS[triage]}>
														{TRIAGE_LABELS[triage]}
													</Badge>
												{:else}
													<span class="text-xs text-muted-foreground">—</span>
												{/if}
											</Table.Cell>
											<Table.Cell>
												{#if row.special_needs && row.special_needs.length > 0}
													<div class="flex max-w-[14rem] flex-wrap gap-1">
														{#each row.special_needs as need (need)}
															<Badge
																variant="outline"
																class="border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[11px] text-amber-800 dark:text-amber-200"
															>
																{getSpecialNeedLabel(need)}
															</Badge>
														{/each}
													</div>
												{:else}
													<span class="text-xs text-muted-foreground">—</span>
												{/if}
											</Table.Cell>
											<Table.Cell class="text-sm text-muted-foreground">
												{hh?.label ?? '—'}
											</Table.Cell>
											<Table.Cell class="text-xs text-muted-foreground">
												{#if activeTab === 'pending'}
													{formatTimeOrDate(row.updated_at)}
												{:else}
													{row.current_stay.zone ?? '—'}
												{/if}
											</Table.Cell>
											<Table.Cell class="pr-5 text-right">
												<div class="flex justify-end gap-1.5">
													{#if activeTab === 'awaiting_confirm'}
														<Button
															size="sm"
															onclick={(e) => {
																e.stopPropagation();
																void confirmOne(row._id);
															}}
															disabled={confirmRoomMutation.isPending}
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
																disabled={confirmRoomHouseholdMutation.isPending}
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
					{/if}
				</Card.Content>
			</Card.Root>
		</Tabs.Content>
	</Tabs.Root>
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
