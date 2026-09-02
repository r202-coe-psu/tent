<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
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
		classifyZoningQueueTab,
		parseZoningQrCode,
		buildZoningPath,
		type ZoningQueueTab
	} from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';

	const allEvacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	const screeningsQuery = useScreenings();
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());

	const enableMedical = $derived(
		shelterQuery.data?.feature_flags?.enable_medical_screening ?? false
	);
	const allEvacuees = $derived(allEvacueesQuery.data ?? []);
	const householdMap = $derived(new Map((householdsQuery.data ?? []).map((h) => [h._id, h])));
	const screenedIds = $derived(new Set((screeningsQuery.data ?? []).map((s) => s.evacuee_id)));

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
	const assignedEvacuees = $derived(
		allEvacuees.filter(
			(e) =>
				classifyZoningQueueTab(e, {
					enableMedicalScreening: enableMedical,
					hasScreening: screenedIds.has(e._id)
				}) === 'assigned'
		)
	);

	const tabEvacuees = $derived(activeTab === 'pending' ? pendingEvacuees : assignedEvacuees);

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

	function handleCodeInput(raw: string) {
		const parsedId = parseZoningQrCode(raw);
		if (!parsedId) {
			toast.error('รหัส QR หรือข้อความที่สแกนไม่ถูกต้อง');
			return;
		}

		const found = allEvacuees.find((e) => e._id === parsedId || e.person_id?.number === parsedId);
		if (found) {
			toast.success(`พบผู้ประสบภัย: ${found.first_name} ${found.last_name}`);
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
			? 'ยังไม่มีผู้รอจัดโซน — ผู้ที่ลงทะเบียนแล้วต้องผ่านคัดกรองแพทย์ก่อน'
			: 'ยังไม่มีผู้รอจัดโซน — เมื่อลงทะเบียนเสร็จจะปรากฏที่นี่'
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
					คิวรอจัดโซนและรายการที่จัดแล้ว — เลือกแถวหรือสแกน QR เพื่อเปิดหน้าจัดสรร
				</p>
			</div>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<Badge variant="secondary" class="gap-1.5 px-3 py-1.5 text-sm font-semibold shadow-xs">
				<Clock class="size-3.5 text-amber-600" />
				<span>รอจัด:</span>
				<span class="font-bold text-amber-700 dark:text-amber-300">{pendingEvacuees.length} คน</span
				>
			</Badge>
			<Badge variant="secondary" class="gap-1.5 px-3 py-1.5 text-sm font-semibold shadow-xs">
				<Check class="size-3.5 text-sky-600" />
				<span>จัดแล้ว:</span>
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
			if (v === 'pending' || v === 'assigned') activeTab = v;
		}}
	>
		<Tabs.List class="mb-3">
			<Tabs.Trigger value="pending">รอจัด ({pendingEvacuees.length})</Tabs.Trigger>
			<Tabs.Trigger value="assigned">จัดแล้ว ({assignedEvacuees.length})</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value={activeTab}>
			<Card.Root class="overflow-hidden border-border bg-card shadow-sm">
				<Card.Header class="border-b bg-muted/20 px-5 py-3.5">
					<div class="flex items-center gap-2">
						<Users class="size-4 text-amber-600" />
						<Card.Title class="text-base font-semibold">
							{activeTab === 'pending' ? 'คิวรอจัดสรรที่พัก' : 'รายการที่จัดโซนแล้ว (ย้ายโซนได้)'}
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
								{activeTab === 'pending' ? emptyPendingMessage : 'ยังไม่มีรายการที่จัดโซนแล้ว'}
							</p>
						</div>
					{:else}
						<div class="overflow-x-auto">
							<Table.Root>
								<Table.Header>
									<Table.Row class="bg-muted/30 hover:bg-muted/30">
										<Table.Head class="pl-5">ชื่อ-นามสกุล</Table.Head>
										<Table.Head>บัตร</Table.Head>
										<Table.Head>ครัวเรือน</Table.Head>
										<Table.Head>{activeTab === 'pending' ? 'อัปเดต' : 'โซน'}</Table.Head>
										<Table.Head class="pr-5 text-right">ดำเนินการ</Table.Head>
									</Table.Row>
								</Table.Header>
								<Table.Body>
									{#each filteredQueue as row (row._id)}
										{@const hh = row.household_id ? householdMap.get(row.household_id) : null}
										<Table.Row class="cursor-pointer" onclick={() => openDetail(row._id)}>
											<Table.Cell class="pl-5 font-medium">
												{row.first_name}
												{row.last_name}
											</Table.Cell>
											<Table.Cell class="font-mono text-xs">
												{maskNationalId(row.person_id?.number)}
											</Table.Cell>
											<Table.Cell class="text-sm text-muted-foreground">
												{hh?.label ?? '—'}
											</Table.Cell>
											<Table.Cell class="text-xs text-muted-foreground">
												{#if activeTab === 'assigned'}
													{row.current_stay.zone ?? '—'}
												{:else}
													{formatTimeOrDate(row.updated_at)}
												{/if}
											</Table.Cell>
											<Table.Cell class="pr-5 text-right">
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
