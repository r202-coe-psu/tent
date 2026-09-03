<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { Html5Qrcode } from 'html5-qrcode';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import UserPlus from '@lucide/svelte/icons/user-plus';
	import Search from '@lucide/svelte/icons/search';
	import Scan from '@lucide/svelte/icons/scan';
	import Camera from '@lucide/svelte/icons/camera';
	import X from '@lucide/svelte/icons/x';
	import ClipboardList from '@lucide/svelte/icons/clipboard-list';

	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
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
		type Evacuee,
		type StayStatus
	} from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { authStore } from '$lib/stores/auth.svelte';
	import { canAccessMedicalScreening, canAccessZoning } from '$lib/auth/roles';
	import { useMasterData } from '$lib/features/master-data';

	const allEvacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	const screeningsQuery = useScreenings();
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');

	const enableMedical = $derived(
		shelterQuery.data?.feature_flags?.enable_medical_screening ?? false
	);
	const roles = $derived(authStore.user?.roles ?? []);
	const canMedical = $derived(canAccessMedicalScreening(roles) && enableMedical);
	const canZoning = $derived(canAccessZoning(roles));

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
		other: 'เอกสารอื่นๆ'
	};
	const TRIAGE_LABELS: Record<string, string> = {
		green: 'เขียว',
		yellow: 'เหลือง',
		red: 'แดง'
	};

	type StatusChip = 'all' | StayStatus | 'รอแพทย์' | 'รอโซน';

	let searchQuery = $state('');
	let statusChip = $state<StatusChip>('pre_registered');
	let barcodeInput = $state('');
	let showCameraModal = $state(false);
	let cameraError = $state<string | null>(null);
	let selected = $state<Evacuee | null>(null);
	let sheetOpen = $state(false);

	const filtered = $derived(
		allEvacuees
			.filter((e) => {
				if (!matchesEvacueeSearch(e, searchQuery)) return false;
				const next = nextQueueLabel(e, {
					enableMedicalScreening: enableMedical,
					hasScreening: screenedIds.has(e._id)
				});
				if (statusChip === 'all') return true;
				if (statusChip === 'รอแพทย์' || statusChip === 'รอโซน') return next === statusChip;
				return e.current_stay.status === statusChip;
			})
			.slice()
			.sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
	);

	const chips: { id: StatusChip; label: string }[] = [
		{ id: 'all', label: 'ทั้งหมด' },
		{ id: 'arriving', label: 'กำลังมาถึง' },
		{ id: 'pre_registered', label: 'ลงทะเบียนล่วงหน้า' },
		{ id: 'รอแพทย์', label: 'รอแพทย์' },
		{ id: 'รอโซน', label: 'รอโซน' },
		{ id: 'active', label: 'พักแล้ว' }
	];

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
		if (next === 'พักแล้ว') return 'secondary';
		return 'outline';
	}

	function handleCodeInput(raw: string) {
		const trimmed = raw.trim();
		if (!trimmed) return;
		const found = allEvacuees.find((e) => e._id === trimmed || e.person_id?.number === trimmed);
		if (found) {
			toast.success(`พบ: ${formatPersonName(found)}`);
			barcodeInput = '';
			showCameraModal = false;
			openRow(found);
			return;
		}
		toast.error('ไม่พบผู้ประสบภัยจากรหัสที่สแกน');
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
	<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
		<div class="flex items-center gap-3">
			<a
				href={resolve('/onsite')}
				class="inline-flex h-9 w-9 items-center justify-center rounded-full border border-border bg-card text-muted-foreground hover:bg-accent"
			>
				<ArrowLeft class="size-4" />
			</a>
			<div>
				<div class="flex items-center gap-2">
					<ClipboardList class="size-5 text-primary" />
					<h1 class="text-2xl font-bold">ทะเบียนผู้ประสบภัย</h1>
					<Badge variant="outline">Station 1</Badge>
				</div>
				<p class="text-xs text-muted-foreground">Registration Desk — คิวลงทะเบียนและรายงานตัว</p>
			</div>
		</div>
		<Button href={resolve('/onsite/people/new')} class="gap-2">
			<UserPlus class="size-4" />
			ลงทะเบียนใหม่
		</Button>
	</div>

	<div class="flex flex-wrap gap-2">
		{#each chips as chip (chip.id)}
			{#if !(chip.id === 'รอแพทย์' && !enableMedical)}
				<button
					type="button"
					onclick={() => (statusChip = chip.id)}
					class="rounded-full border px-3 py-1 text-xs font-medium transition-colors {statusChip ===
					chip.id
						? 'border-primary bg-primary text-primary-foreground'
						: 'border-border bg-card text-muted-foreground hover:bg-muted'}"
				>
					{chip.label}
				</button>
			{/if}
		{/each}
	</div>

	<Card.Root class="border-border p-4 shadow-sm">
		<div class="flex flex-col gap-3 md:flex-row md:items-center">
			<div class="relative flex-1">
				<Search
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					placeholder="ค้นหาชื่อ เบอร์โทร เลขบัตร..."
					bind:value={searchQuery}
					class="h-10 pl-9"
				/>
				{#if searchQuery}
					<button
						type="button"
						class="absolute top-1/2 right-2 -translate-y-1/2 text-muted-foreground"
						onclick={() => (searchQuery = '')}
					>
						<X class="size-3.5" />
					</button>
				{/if}
			</div>
			<div class="flex gap-2">
				<div class="relative min-w-[200px]">
					<Scan
						class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
					/>
					<Input
						placeholder="สแกน Person QR"
						bind:value={barcodeInput}
						class="h-10 pl-9 font-mono text-xs"
						onkeydown={(e) => {
							if (e.key === 'Enter') {
								e.preventDefault();
								handleCodeInput(barcodeInput);
							}
						}}
					/>
				</div>
				<Button variant="outline" onclick={() => handleCodeInput(barcodeInput)}>ยืนยัน</Button>
				<Button onclick={() => (showCameraModal = true)} class="gap-1.5">
					<Camera class="size-4" /> สแกน
				</Button>
			</div>
		</div>
	</Card.Root>

	<Card.Root class="overflow-hidden border-border shadow-sm">
		{#if allEvacueesQuery.isPending}
			<div class="flex h-40 items-center justify-center text-sm text-muted-foreground">
				กำลังโหลด...
			</div>
		{:else if filtered.length === 0}
			<div
				class="flex h-40 flex-col items-center justify-center gap-2 text-sm text-muted-foreground"
			>
				<p>ไม่พบรายการ</p>
				<Button variant="outline" href={resolve('/onsite/people/new')}>ลงทะเบียนใหม่</Button>
			</div>
		{:else}
			<div class="overflow-x-auto">
				<Table.Root>
					<Table.Header>
						<Table.Row class="bg-muted/30">
							<Table.Head class="pl-4">ชื่อ</Table.Head>
							<Table.Head>สถานะ</Table.Head>
							<Table.Head>ความต้องการพิเศษ</Table.Head>
							<Table.Head>ครอบครัว</Table.Head>
							<Table.Head>โซน</Table.Head>
							<Table.Head>อัปเดต</Table.Head>
							<Table.Head class="pr-4">คิวถัดไป</Table.Head>
						</Table.Row>
					</Table.Header>
					<Table.Body>
						{#each filtered as row (row._id)}
							{@const next = nextQueueLabel(row, {
								enableMedicalScreening: enableMedical,
								hasScreening: screenedIds.has(row._id)
							})}
							{@const hh = row.household_id ? householdMap.get(row.household_id) : null}
							<Table.Row class="cursor-pointer" onclick={() => openRow(row)}>
								<Table.Cell class="pl-4 font-medium">{formatPersonName(row)}</Table.Cell>
								<Table.Cell class="text-xs"
									>{STATUS_LABELS[row.current_stay.status] ?? row.current_stay.status}</Table.Cell
								>
								<Table.Cell class="max-w-[10rem] truncate text-xs"
									>{specialNeedsShort(row.special_needs)}</Table.Cell
								>
								<Table.Cell class="text-xs text-muted-foreground">{hh?.label ?? '—'}</Table.Cell>
								<Table.Cell class="text-xs">{row.current_stay.zone ?? '—'}</Table.Cell>
								<Table.Cell class="text-xs text-muted-foreground"
									>{formatUpdated(row.updated_at)}</Table.Cell
								>
								<Table.Cell class="pr-4">
									<Badge variant="secondary">{next}</Badge>
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>
		{/if}
	</Card.Root>
</div>

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
			{@const stayStatus = selected.current_stay.status}
			{@const cardType = selected.person_id?.cardType ?? 'national_id'}

			<Sheet.Header class="border-b border-border pb-4">
				<Sheet.Title class="text-xl">
					{formatPersonName(selected)}
					{#if selected.nickname}
						<span class="text-base font-normal text-muted-foreground">({selected.nickname})</span>
					{/if}
				</Sheet.Title>
				<Sheet.Description class="sr-only">รายละเอียดผู้ประสบภัยและสถานะคิว</Sheet.Description>
				<div class="mt-2 flex flex-wrap gap-1.5">
					<Badge variant="outline">
						{STATUS_LABELS[stayStatus] ?? stayStatus}
					</Badge>
					<Badge variant={nextQueueBadgeVariant(next)}>คิวถัดไป: {next}</Badge>
					{#if enableMedical}
						{#if screening}
							<Badge variant="secondary">
								คัดกรองแล้ว{#if screening.triage_level}
									· triage {TRIAGE_LABELS[screening.triage_level] ?? screening.triage_level}{/if}
							</Badge>
						{:else if stayStatus === 'arriving'}
							<Badge variant="destructive">ยังไม่คัดกรอง</Badge>
						{:else}
							<Badge variant="outline">ยังไม่คัดกรอง</Badge>
						{/if}
					{/if}
					{#if selected.current_stay.zone}
						<Badge variant="secondary">โซน {selected.current_stay.zone}</Badge>
					{:else if stayStatus === 'arriving' || stayStatus === 'active'}
						<Badge variant="outline">ยังไม่มีโซน</Badge>
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
							<p class="font-medium">{STATUS_LABELS[stayStatus] ?? stayStatus}</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">โซน</p>
							<p class="font-medium">{selected.current_stay.zone ?? '—'}</p>
						</div>
						<div>
							<p class="text-xs text-muted-foreground">สถานะตั้งแต่</p>
							<p class="font-medium">{formatUpdated(selected.current_stay.since)}</p>
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
				{#if selected.current_stay.status === 'pre_registered'}
					<Button onclick={() => goReportIn(selected!)}>รายงานตัว</Button>
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
				{#if canZoning && (next === 'รอโซน' || selected.current_stay.status === 'arriving')}
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
