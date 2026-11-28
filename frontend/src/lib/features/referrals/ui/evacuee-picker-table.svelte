<script lang="ts">
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Loader2 from '@lucide/svelte/icons/loader-2';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import RotateCw from '@lucide/svelte/icons/rotate-cw';
	import Search from '@lucide/svelte/icons/search';
	import TriangleAlert from '@lucide/svelte/icons/triangle-alert';
	import X from '@lucide/svelte/icons/x';
	import { Html5QrcodeSupportedFormats } from 'html5-qrcode';
	import CameraCodeScannerDialog from '$lib/components/camera-code-scanner-dialog.svelte';
	import { createReadGuard } from '$lib/components/camera-code-scanner-state';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Table from '$lib/components/ui/table/index.js';
	import {
		checkPersonQr,
		extractScanPersonQr,
		staffPersonQrRejectionMessage,
		useEvacueeServerSearch,
		zoneLabel,
		type Evacuee
	} from '$lib/features/people';
	import { useShelter } from '$lib/features/shelters';
	import { shelterStore } from '$lib/stores/shelter.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useActiveReferralEvacueeIds } from '../application/queries';
	import { formatEvacueeFullName } from './referral.ui-helpers';
	import {
		clearLoaded,
		loadedSelectionState,
		pickableEvacuees,
		resolvePickerScan,
		selectLoaded,
		toggleEvacuee
	} from './evacuee-picker.helpers';

	let {
		selected = $bindable<Evacuee[]>([]),
		error,
		label = '2. เลือกผู้เข้าพักที่ต้องการส่งต่อ'
	}: {
		/** Chosen evacuees; kept across searches and "โหลดเพิ่ม" so callers always have names. */
		selected?: Evacuee[];
		error?: string | string[];
		/** Step heading; the caller numbers it within its own form. */
		label?: string;
	} = $props();

	const errorMessage = $derived(Array.isArray(error) ? error[0] : error);
	const inputId = $props.id();

	const shelterQuery = useShelter(() => shelterStore.selectedShelterCode ?? getShelterCode());
	const shelterZones = $derived(shelterQuery.data?.zones ?? []);

	// Typing is debounced into the server query; a blank query fetches nothing (#555).
	const SEARCH_DEBOUNCE_MS = 300;
	let searchText = $state('');
	let query = $state('');
	let timer: ReturnType<typeof setTimeout> | undefined;

	function onSearchInput(value: string) {
		searchText = value;
		clearTimeout(timer);
		timer = setTimeout(() => (query = value.trim()), SEARCH_DEBOUNCE_MS);
	}

	const SCAN_FORMATS = [Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.CODE_128];
	let scannerOpen = $state(false);
	let scanBusy = $state(false);
	let scanError = $state<string | null>(null);
	const scanGuard = createReadGuard();

	/**
	 * A camera read is a finished code: search it at once, no debounce (#555). A Person QR is
	 * checked against the CR-233 scan rule first, so an expired card cannot pick anyone.
	 */
	async function onScan(code: string) {
		const isLatest = scanGuard.begin();
		scanBusy = true;
		scanError = null;
		try {
			const outcome = await resolvePickerScan(code, {
				parse: extractScanPersonQr,
				check: (parsed) => checkPersonQr(parsed),
				message: (verdict) => staffPersonQrRejectionMessage(verdict)
			});
			if (!isLatest()) return;
			if (outcome.kind === 'rejected') {
				scanError = outcome.message;
				return;
			}
			clearTimeout(timer);
			searchText = outcome.query;
			query = outcome.query;
		} catch {
			if (isLatest()) scanError = 'ตรวจสอบ QR ไม่สำเร็จ กรุณาลองใหม่ หรือค้นหาด้วยชื่อแทน';
		} finally {
			if (isLatest()) scanBusy = false;
		}
	}

	function cancelScan() {
		scanGuard.cancel();
		scanBusy = false;
	}

	function openScanner() {
		scanError = null;
		scannerOpen = true;
	}

	const search = useEvacueeServerSearch(() => query);
	const loaded = $derived(pickableEvacuees(search.data?.pages ?? []));

	// Ask only for the ids on screen plus the ones already picked — never the whole shelter.
	const lookupIds = $derived([
		...new Set([...loaded.map((e) => e._id), ...selected.map((e) => e._id)])
	]);
	const activeQuery = useActiveReferralEvacueeIds(() => lookupIds);
	const blocked = $derived<ReadonlySet<string>>(activeQuery.data ?? new Set());

	const selectedIds = $derived(new Set(selected.map((e) => e._id)));
	const headerState = $derived(loadedSelectionState(selected, loaded, blocked));
	const blockedSelected = $derived(selected.filter((e) => blocked.has(e._id)));

	function toggle(evacuee: Evacuee, on: boolean | 'indeterminate') {
		if (on === true && blocked.has(evacuee._id)) return;
		selected = toggleEvacuee(selected, evacuee, on === true);
	}

	function toggleAll(on: boolean | 'indeterminate') {
		selected =
			on === true ? selectLoaded(selected, loaded, blocked) : clearLoaded(selected, loaded);
	}

	function removeBlocked() {
		selected = selected.filter((e) => !blocked.has(e._id));
	}
</script>

<div class="space-y-3">
	<div class="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
		<div class="space-y-1">
			<label for={inputId} class="text-sm font-semibold text-foreground"
				>{label} <span class="text-red-600">*</span></label
			>
			<p class="text-xs text-muted-foreground">
				ค้นด้วยชื่อ นามสกุล ชื่อเล่น เบอร์โทร เลขบัตร หรือสแกน QR · แสดงเฉพาะผู้ที่พักอยู่ในศูนย์
			</p>
		</div>
		<p class="text-sm font-medium text-foreground" aria-live="polite">
			เลือกแล้ว <span class="text-primary tabular-nums">{selected.length}</span> คน
		</p>
	</div>

	<div class="flex gap-2">
		<div class="relative flex-1">
			<Input
				id={inputId}
				type="search"
				placeholder="พิมพ์ชื่อ เบอร์โทร หรือสแกน QR..."
				value={searchText}
				oninput={(e) => onSearchInput(e.currentTarget.value)}
				class="h-11 pl-9 md:h-9 {errorMessage ? 'border-destructive' : ''}"
				autocomplete="off"
			/>
			<div
				class="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-muted-foreground"
			>
				<Search class="h-4 w-4" />
			</div>
		</div>
		<Button variant="outline" class="h-11 shrink-0 gap-2 md:h-9" onclick={openScanner}>
			<QrCode class="h-4 w-4" aria-hidden="true" />
			<span>สแกน QR</span>
		</Button>
	</div>

	{#if errorMessage}
		<p class="text-xs font-medium text-destructive">{errorMessage}</p>
	{/if}

	{#if selected.length > 0}
		<ul class="flex flex-wrap gap-2" aria-label="ผู้ที่เลือกแล้ว">
			{#each selected as evacuee (evacuee._id)}
				<li
					class="inline-flex items-center gap-1 rounded-full border py-0.5 pr-1 pl-3 text-sm {blocked.has(
						evacuee._id
					)
						? 'border-amber-200 bg-amber-50 text-amber-900'
						: 'border-sky-200 bg-sky-50 text-sky-900'}"
				>
					{#if blocked.has(evacuee._id)}
						<CircleAlert class="h-3.5 w-3.5" aria-hidden="true" />
					{/if}
					{formatEvacueeFullName(evacuee)}
					<Button
						variant="ghost"
						size="icon"
						class="h-11 w-11 rounded-full md:h-7 md:w-7"
						onclick={() => toggle(evacuee, false)}
					>
						<X class="h-4 w-4" />
						<span class="sr-only">เอา {formatEvacueeFullName(evacuee)} ออก</span>
					</Button>
				</li>
			{/each}
		</ul>
	{/if}

	{#if blockedSelected.length > 0}
		<div
			role="alert"
			class="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 sm:flex-row sm:items-center sm:justify-between"
		>
			<p class="flex items-start gap-2">
				<TriangleAlert class="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
				<span>
					ที่เลือกไว้ <span class="font-semibold tabular-nums">{blockedSelected.length}</span>
					คนมีคำร้องส่งต่อค้างอยู่ จะสร้างคำร้องใหม่ไม่ได้จนกว่าคำร้องเดิมจะปิด
				</span>
			</p>
			<Button variant="outline" size="sm" class="h-11 md:h-8" onclick={removeBlocked}>
				เอาออกจากรายการ
			</Button>
		</div>
	{/if}

	<div class="overflow-hidden rounded-lg border border-border/80">
		{#if !query}
			<div class="px-4 py-10 text-center text-sm text-muted-foreground">
				พิมพ์คำค้นเพื่อค้นหาผู้เข้าพัก
			</div>
		{:else if search.isPending}
			<div class="flex flex-col items-center justify-center gap-2 py-12 text-muted-foreground">
				<Loader2 class="h-6 w-6 animate-spin text-primary" />
				<span class="text-sm">กำลังค้นหา...</span>
			</div>
		{:else if search.isError}
			<div
				role="alert"
				class="flex flex-col items-center justify-center gap-3 px-4 py-10 text-center"
			>
				<TriangleAlert class="h-6 w-6 text-red-600" />
				<p class="text-sm font-medium text-foreground">ค้นหาผู้เข้าพักไม่สำเร็จ</p>
				<Button
					variant="outline"
					size="sm"
					onclick={() => search.refetch()}
					class="h-11 gap-2 md:h-7"
				>
					<RotateCw class="h-4 w-4" />
					ลองใหม่
				</Button>
			</div>
		{:else}
			{#if loaded.length === 0}
				<div class="px-4 py-10 text-center text-sm text-muted-foreground">
					{#if search.hasNextPage}
						ยังไม่พบผู้ที่พักอยู่ในศูนย์ในผลที่โหลดแล้ว
					{:else}
						ไม่พบผู้เข้าพักที่ตรงกับคำค้น «{query}»
					{/if}
				</div>
			{:else}
				<div class="max-h-72 overflow-auto">
					<Table.Root>
						<Table.Header class="sticky top-0 z-10 bg-muted/80 backdrop-blur-sm">
							<Table.Row>
								<Table.Head
									class="h-11 w-12 cursor-pointer"
									onclick={() => toggleAll(headerState !== 'all')}
								>
									<Checkbox
										onclick={(e) => e.stopPropagation()}
										checked={headerState === 'all'}
										indeterminate={headerState === 'some'}
										onCheckedChange={toggleAll}
										aria-label="เลือกทั้งหมดที่แสดงอยู่"
									/>
								</Table.Head>
								<Table.Head>ชื่อ-นามสกุล</Table.Head>
								<Table.Head class="hidden sm:table-cell">เบอร์โทร</Table.Head>
								<Table.Head class="hidden md:table-cell">โซน</Table.Head>
							</Table.Row>
						</Table.Header>
						<Table.Body>
							{#each loaded as evacuee (evacuee._id)}
								{@const isBlocked = blocked.has(evacuee._id)}
								{@const isSelected = selectedIds.has(evacuee._id)}
								<Table.Row
									class="h-11 {isBlocked ? 'cursor-not-allowed' : 'cursor-pointer'} {isSelected
										? 'bg-primary/5'
										: ''}"
									onclick={() => toggle(evacuee, !isSelected)}
								>
									<Table.Cell class="py-0">
										<!-- The padded label is the ≥44px touch target around the 16px box. -->
										<span class="flex h-11 w-11 items-center justify-center">
											<Checkbox
												onclick={(e) => e.stopPropagation()}
												checked={isSelected}
												disabled={isBlocked && !isSelected}
												onCheckedChange={(v) => toggle(evacuee, v)}
												aria-label={`เลือก ${formatEvacueeFullName(evacuee)}`}
												aria-describedby={isBlocked ? `${inputId}-busy-${evacuee._id}` : undefined}
											/>
										</span>
									</Table.Cell>
									<Table.Cell class="font-medium">
										<span class="flex flex-wrap items-center gap-2">
											{formatEvacueeFullName(evacuee)}
											{#if isBlocked}
												<span
													id="{inputId}-busy-{evacuee._id}"
													class="inline-flex items-center gap-1 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-900"
												>
													<CircleAlert class="h-3.5 w-3.5" aria-hidden="true" />
													มีคำร้องส่งต่อค้างอยู่
												</span>
											{/if}
										</span>
									</Table.Cell>
									<Table.Cell class="hidden text-muted-foreground sm:table-cell">
										{evacuee.phone ?? '—'}
									</Table.Cell>
									<Table.Cell
										class="hidden text-xs text-muted-foreground tabular-nums md:table-cell"
									>
										{zoneLabel(evacuee.current_stay?.zone, shelterZones)}
									</Table.Cell>
								</Table.Row>
							{/each}
						</Table.Body>
					</Table.Root>
				</div>
			{/if}

			{#if search.hasNextPage}
				<div class="border-t border-border/80 p-2">
					<Button
						variant="ghost"
						class="h-11 w-full gap-2 md:h-9"
						disabled={search.isFetchingNextPage}
						onclick={() => search.fetchNextPage()}
					>
						{#if search.isFetchingNextPage}
							<Loader2 class="h-4 w-4 animate-spin" />
						{/if}
						โหลดเพิ่ม
					</Button>
				</div>
			{/if}
		{/if}
	</div>

	{#if activeQuery.isError}
		<p class="flex items-center gap-2 text-xs text-amber-900">
			<TriangleAlert class="h-4 w-4" aria-hidden="true" />
			ตรวจสอบคำร้องส่งต่อที่ค้างอยู่ไม่สำเร็จ ระบบจะตรวจอีกครั้งตอนส่ง
			<Button
				variant="link"
				size="sm"
				class="h-11 px-1 md:h-7"
				onclick={() => activeQuery.refetch()}
			>
				ลองใหม่
			</Button>
		</p>
	{/if}
</div>

<CameraCodeScannerDialog
	bind:open={scannerOpen}
	title="สแกน QR ผู้เข้าพัก"
	hint="เล็งกล้องไปที่ QR บนบัตรผู้ประสบภัย หรือพิมพ์ / ยิงรหัสด้วยเครื่องสแกน"
	formats={SCAN_FORMATS}
	manualInputMode="text"
	busy={scanBusy}
	error={scanError}
	{onScan}
	oncancel={cancelScan}
/>
