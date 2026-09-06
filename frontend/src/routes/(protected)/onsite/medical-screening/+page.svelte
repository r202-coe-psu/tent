<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { toast } from 'svelte-sonner';
	import { Html5Qrcode } from 'html5-qrcode';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Scan from '@lucide/svelte/icons/scan';
	import Search from '@lucide/svelte/icons/search';
	import Camera from '@lucide/svelte/icons/camera';
	import CameraOff from '@lucide/svelte/icons/camera-off';
	import Stethoscope from '@lucide/svelte/icons/stethoscope';
	import Clock from '@lucide/svelte/icons/clock';
	import Users from '@lucide/svelte/icons/users';
	import X from '@lucide/svelte/icons/x';
	import Check from '@lucide/svelte/icons/check';
	import Pencil from '@lucide/svelte/icons/pencil';

	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Badge } from '$lib/components/ui/badge';
	import * as Card from '$lib/components/ui/card';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as Table from '$lib/components/ui/table';
	import * as Tabs from '$lib/components/ui/tabs';

	import { useEvacuees, useHouseholds, useScreenings, maskNationalId } from '$lib/features/people';
	import { useMasterData } from '$lib/features/master-data';
	import {
		buildMedicalScreeningPath,
		classifyScreeningQueueTab,
		matchesMedicalScreeningSearch,
		parseMedicalScreeningQrCode,
		type ScreeningQueueTab
	} from './medical-screening.utils';

	const allEvacueesQuery = useEvacuees();
	const householdsQuery = useHouseholds();
	const screeningsQuery = useScreenings();
	const vulnerableGroupQuery = useMasterData(() => 'vulnerable_group');

	const allEvacuees = $derived(allEvacueesQuery.data ?? []);
	const householdMap = $derived(new Map((householdsQuery.data ?? []).map((h) => [h._id, h])));
	const screenedIds = $derived(new Set((screeningsQuery.data ?? []).map((s) => s.evacuee_id)));

	let searchQuery = $state('');
	let barcodeInput = $state('');
	let showCameraModal = $state(false);
	let cameraError = $state<string | null>(null);
	let activeTab = $state<ScreeningQueueTab>('pending');

	const pendingEvacuees = $derived(
		allEvacuees.filter((e) => classifyScreeningQueueTab(e, screenedIds) === 'pending')
	);
	const screenedEvacuees = $derived(
		allEvacuees.filter((e) => classifyScreeningQueueTab(e, screenedIds) === 'screened')
	);

	const tabEvacuees = $derived(activeTab === 'pending' ? pendingEvacuees : screenedEvacuees);

	const filteredQueue = $derived(
		tabEvacuees.filter((evacuee) => {
			const household = evacuee.household_id ? householdMap.get(evacuee.household_id) : undefined;
			return matchesMedicalScreeningSearch(evacuee, searchQuery, household);
		})
	);

	const isLoading = $derived(
		allEvacueesQuery.isPending || screeningsQuery.isPending || householdsQuery.isPending
	);

	function openScreeningForm(id: string) {
		const path = buildMedicalScreeningPath(id);
		goto(resolve(path as `/onsite/medical-screening/${string}`));
	}

	function handleCodeInput(raw: string) {
		const parsedId = parseMedicalScreeningQrCode(raw);
		if (!parsedId) {
			toast.error('รหัส QR หรือข้อความที่สแกนไม่ถูกต้อง');
			return;
		}

		const found = allEvacuees.find((e) => e._id === parsedId || e.person_id?.number === parsedId);
		if (found) {
			toast.success(`พบผู้ประสบภัย: ${found.first_name} ${found.last_name}`);
			barcodeInput = '';
			showCameraModal = false;
			openScreeningForm(found._id);
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
		const fromLegacy = SPECIAL_NEED_LABELS[need];
		if (fromLegacy) return fromLegacy;
		if (need.startsWith('item_')) return '—';
		return need;
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
</script>

<svelte:head>
	<title>คัดกรองการแพทย์ (Station 2) | SmartShelter</title>
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
						class="flex size-8 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
					>
						<Stethoscope class="size-5" />
					</div>
					<h1 class="text-2xl font-bold tracking-tight text-foreground">
						จุดตรวจคัดกรองทางการแพทย์
					</h1>
					<Badge
						variant="outline"
						class="border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
					>
						Station 2
					</Badge>
				</div>
				<p class="mt-0.5 text-xs text-muted-foreground">
					คิวรอตรวจและรายการที่ตรวจแล้ว — เลือกแถวหรือสแกน QR เพื่อเปิดฟอร์มคัดกรองเต็มหน้าจอ
				</p>
			</div>
		</div>

		<div class="flex flex-wrap items-center gap-2">
			<Badge variant="secondary" class="gap-1.5 px-3 py-1.5 text-sm font-semibold shadow-xs">
				<Clock class="size-3.5 text-emerald-600 dark:text-emerald-400" />
				<span>รอตรวจ:</span>
				<span class="font-bold text-emerald-700 dark:text-emerald-300">
					{pendingEvacuees.length} คน
				</span>
			</Badge>
			<Badge variant="secondary" class="gap-1.5 px-3 py-1.5 text-sm font-semibold shadow-xs">
				<Pencil class="size-3.5 text-sky-600 dark:text-sky-400" />
				<span>ตรวจแล้ว:</span>
				<span class="font-bold text-sky-700 dark:text-sky-300">
					{screenedEvacuees.length} คน
				</span>
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
					placeholder="ค้นหาทันใจด้วยชื่อ, นามสกุล, เบอร์โทร, เลขบัตร หรือที่อยู่..."
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
					class="h-10 gap-1.5 bg-emerald-600 text-white hover:bg-emerald-700"
				>
					<Camera class="size-4" />
					<span>สแกนกล้อง</span>
				</Button>
			</div>
		</div>
	</Card.Root>

	{#snippet queueTable()}
		<Card.Root class="overflow-hidden border-border bg-card shadow-sm">
			<Card.Header class="border-b bg-muted/20 px-5 py-3.5">
				<div class="flex items-center justify-between">
					<div class="flex items-center gap-2">
						<Users class="size-4 text-emerald-600 dark:text-emerald-400" />
						<Card.Title class="text-base font-semibold">
							{activeTab === 'pending' ? 'คิวรอตรวจคัดกรอง' : 'รายการที่ตรวจแล้ว (แก้ไขได้)'}
						</Card.Title>
						<Badge variant="secondary" class="text-xs">
							{filteredQueue.length} ราย
						</Badge>
					</div>
					{#if searchQuery}
						<span class="text-xs text-muted-foreground">
							กรองจากทั้งหมด {tabEvacuees.length} ราย
						</span>
					{/if}
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
					<div
						class="flex h-48 flex-col items-center justify-center gap-2 p-6 text-center text-muted-foreground"
					>
						{#if searchQuery}
							<Search class="size-8 text-muted-foreground/50" />
							<p class="text-sm font-medium">ไม่พบรายชื่อที่ตรงกับ "{searchQuery}"</p>
							<Button variant="ghost" size="sm" onclick={() => (searchQuery = '')}>
								ล้างการค้นหา
							</Button>
						{:else if activeTab === 'pending'}
							<Check class="size-8 text-emerald-500/60" />
							<p class="text-sm font-medium text-foreground">
								ไม่มีผู้ประสบภัยรอตรวจคัดกรองในขณะนี้
							</p>
						{:else}
							<Pencil class="size-8 text-sky-500/60" />
							<p class="text-sm font-medium text-foreground">ยังไม่มีรายการที่ตรวจแล้ว</p>
						{/if}
					</div>
				{:else}
					<div class="overflow-x-auto">
						<Table.Root>
							<Table.TableHeader class="bg-muted/40 text-xs">
								<Table.TableRow>
									<Table.TableHead class="w-[200px]">ชื่อ-นามสกุล</Table.TableHead>
									<Table.TableHead>เลขประจำตัว</Table.TableHead>
									<Table.TableHead>เบอร์โทร</Table.TableHead>
									<Table.TableHead>เวลาลงทะเบียน</Table.TableHead>
									<Table.TableHead>กลุ่มเปราะบาง / พิเศษ</Table.TableHead>
									<Table.TableHead class="text-right">ดำเนินการ</Table.TableHead>
								</Table.TableRow>
							</Table.TableHeader>
							<Table.TableBody>
								{#each filteredQueue as evacuee (evacuee._id)}
									<Table.TableRow
										class="cursor-pointer transition-colors hover:bg-muted/50"
										onclick={() => openScreeningForm(evacuee._id)}
									>
										<Table.TableCell class="py-3">
											<div class="flex flex-col">
												<span class="font-semibold text-foreground">
													{evacuee.first_name}
													{evacuee.last_name}
												</span>
												{#if evacuee.nickname}
													<span class="text-xs text-muted-foreground">
														({evacuee.nickname})
													</span>
												{/if}
											</div>
										</Table.TableCell>
										<Table.TableCell class="py-3 font-mono text-xs text-muted-foreground">
											{maskNationalId(evacuee.person_id?.number)}
										</Table.TableCell>
										<Table.TableCell class="py-3 text-xs">
											{evacuee.phone || '—'}
										</Table.TableCell>
										<Table.TableCell class="py-3 text-xs whitespace-nowrap text-muted-foreground">
											{formatTimeOrDate(evacuee.current_stay?.since || evacuee.created_at)}
										</Table.TableCell>
										<Table.TableCell class="py-3">
											{#if (evacuee.vulnerable_groups && evacuee.vulnerable_groups.length > 0) || (evacuee.special_needs && evacuee.special_needs.length > 0)}
												<div class="flex flex-wrap gap-1">
													{#each evacuee.vulnerable_groups ?? [] as need (need)}
														<Badge
															variant="outline"
															class="border-primary/30 bg-primary/10 px-1.5 py-0 text-[11px] text-primary"
														>
															{getSpecialNeedLabel(need)}
														</Badge>
													{/each}
													{#each evacuee.special_needs ?? [] as need (need)}
														<Badge
															variant="outline"
															class="border-amber-500/30 bg-amber-500/10 px-1.5 py-0 text-[11px] text-amber-700 dark:text-amber-300"
														>
															{getSpecialNeedLabel(need)}
														</Badge>
													{/each}
												</div>
											{:else}
												<span class="text-xs text-muted-foreground">—</span>
											{/if}
										</Table.TableCell>
										<Table.TableCell class="py-3 text-right">
											<Button
												variant="outline"
												size="sm"
												onclick={(e) => {
													e.stopPropagation();
													openScreeningForm(evacuee._id);
												}}
												class="h-7 text-xs"
											>
												{activeTab === 'pending' ? 'ตรวจคัดกรอง' : 'แก้ไขผลตรวจ'}
											</Button>
										</Table.TableCell>
									</Table.TableRow>
								{/each}
							</Table.TableBody>
						</Table.Root>
					</div>
				{/if}
			</Card.Content>
		</Card.Root>
	{/snippet}

	<Tabs.Root bind:value={activeTab} class="gap-4">
		<Tabs.List class="grid w-full max-w-md grid-cols-2">
			<Tabs.Trigger value="pending" class="gap-1.5">
				รอตรวจ
				<Badge variant="secondary" class="text-[10px]">{pendingEvacuees.length}</Badge>
			</Tabs.Trigger>
			<Tabs.Trigger value="screened" class="gap-1.5">
				ตรวจแล้ว (แก้ไขได้)
				<Badge variant="secondary" class="text-[10px]">{screenedEvacuees.length}</Badge>
			</Tabs.Trigger>
		</Tabs.List>

		<Tabs.Content value="pending" class="mt-0">
			{@render queueTable()}
		</Tabs.Content>
		<Tabs.Content value="screened" class="mt-0">
			{@render queueTable()}
		</Tabs.Content>
	</Tabs.Root>
</div>

{#if showCameraModal}
	<Dialog.Root
		open={showCameraModal}
		onOpenChange={(open) => {
			if (!open) showCameraModal = false;
		}}
	>
		<Dialog.Content
			class="flex max-h-[85vh] w-full max-w-md flex-col rounded-3xl border-border bg-card p-6"
		>
			<Dialog.Header class="border-b pb-4">
				<Dialog.Title class="flex items-center gap-2 text-base font-bold text-foreground">
					<Scan class="size-5 text-emerald-600 dark:text-emerald-400" />
					<span>สแกน QR Code บนใบนำทาง</span>
				</Dialog.Title>
				<Dialog.Description class="text-xs text-muted-foreground">
					สแกน Handover Slip จากโต๊ะลงทะเบียนเพื่อเปิดฟอร์มคัดกรองเต็มหน้าจอ
				</Dialog.Description>
			</Dialog.Header>

			<div class="my-6 flex flex-col items-center justify-center">
				<div
					class="relative flex aspect-square w-full max-w-[280px] items-center justify-center overflow-hidden rounded-2xl border border-border bg-background"
				>
					{#if !cameraError}
						<div
							id="medical-screening-qr-reader"
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
			</div>

			<Dialog.Footer>
				<Button variant="outline" onclick={() => (showCameraModal = false)} class="w-full">
					ยกเลิก
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}
