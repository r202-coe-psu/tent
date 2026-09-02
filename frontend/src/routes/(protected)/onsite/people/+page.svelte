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
		usePatchEvacuee,
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
	import { now } from '$lib/db/model';
	import { useMasterData } from '$lib/features/master-data';

	const allEvacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	const screeningsQuery = useScreenings();
	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const patchMutation = usePatchEvacuee();
	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');

	const enableMedical = $derived(
		shelterQuery.data?.feature_flags?.enable_medical_screening ?? false
	);
	const roles = $derived(authStore.user?.roles ?? []);
	const canMedical = $derived(canAccessMedicalScreening(roles) && enableMedical);
	const canZoning = $derived(canAccessZoning(roles));

	const allEvacuees = $derived(allEvacueesQuery.data ?? []);
	const householdMap = $derived(new Map((householdsQuery.data ?? []).map((h) => [h._id, h])));
	const screenedIds = $derived(new Set((screeningsQuery.data ?? []).map((s) => s.evacuee_id)));

	type StatusChip = 'all' | StayStatus | 'รอแพทย์' | 'รอโซน';

	let searchQuery = $state('');
	let statusChip = $state<StatusChip>('all');
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

	function handleCodeInput(raw: string) {
		const trimmed = raw.trim();
		if (!trimmed) return;
		const found = allEvacuees.find((e) => e._id === trimmed || e.person_id?.number === trimmed);
		if (found) {
			toast.success(`พบ: ${found.first_name} ${found.last_name}`);
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

	async function reportIn(evacuee: Evacuee) {
		try {
			await patchMutation.mutateAsync({
				id: evacuee._id,
				patch: {
					current_stay: {
						...evacuee.current_stay,
						status: 'arriving',
						zone: null,
						since: now()
					}
				}
			});
			toast.success('รายงานตัวแล้ว — สถานะเป็น arriving');
			sheetOpen = false;
			selected = null;
		} catch (err: unknown) {
			toast.error(err instanceof Error ? err.message : 'รายงานตัวไม่สำเร็จ');
		}
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
							<Table.Head>ครัวเรือน</Table.Head>
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
								<Table.Cell class="pl-4 font-medium">{row.first_name} {row.last_name}</Table.Cell>
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
	<Sheet.Content side="right" class="w-full sm:max-w-md">
		{#if selected}
			{@const next = nextQueueLabel(selected, {
				enableMedicalScreening: enableMedical,
				hasScreening: screenedIds.has(selected._id)
			})}
			<Sheet.Header>
				<Sheet.Title>{selected.first_name} {selected.last_name}</Sheet.Title>
				<Sheet.Description>
					{STATUS_LABELS[selected.current_stay.status]} · คิวถัดไป {next} · บัตร
					{maskNationalId(selected.person_id?.number)}
				</Sheet.Description>
			</Sheet.Header>
			<div class="mt-6 flex flex-col gap-2">
				{#if selected.current_stay.status === 'pre_registered'}
					<Button onclick={() => reportIn(selected!)}>รายงานตัว → arriving</Button>
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
			</div>
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
