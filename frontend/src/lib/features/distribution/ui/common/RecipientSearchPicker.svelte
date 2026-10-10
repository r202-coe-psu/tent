<script lang="ts">
	import { useQueryClient } from '@tanstack/svelte-query';
	import { Html5QrcodeSupportedFormats } from 'html5-qrcode';
	import Search from '@lucide/svelte/icons/search';
	import User from '@lucide/svelte/icons/user';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import X from '@lucide/svelte/icons/x';
	import Loader from '@lucide/svelte/icons/loader';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Building2 from '@lucide/svelte/icons/building-2';
	import {
		useSearchEvacuees,
		lookupEvacueeByScanCode,
		evacueeAgeYears,
		type Evacuee
	} from '$lib/features/people';
	import CameraCodeScannerDialog from '$lib/components/camera-code-scanner-dialog.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import type { FrontlineRecipientSelection } from '../model/frontline-handover';
	import { deriveRecipientMenuTags } from '../../domain/food-supplies';
	import { formatDistributionError } from '../model/distribution-error';

	interface Props {
		value?: FrontlineRecipientSelection | null;
		disabled?: boolean;
		/** Offer the "บุคคลภายนอก" (anonymous outside person) option. Off for loan returns. */
		allowOutside?: boolean;
		onselect?: (recipient: FrontlineRecipientSelection | null) => void;
	}

	let {
		value = $bindable(null),
		disabled = false,
		allowOutside = true,
		onselect
	}: Props = $props();

	/** Evacuee QR cards plus the 1D codes a handheld scanner or printed label may carry. */
	const SCAN_FORMATS = [Html5QrcodeSupportedFormats.QR_CODE, Html5QrcodeSupportedFormats.CODE_128];

	const queryClient = useQueryClient();

	let searchTerm = $state('');
	let scannerOpen = $state(false);
	let isLookingUp = $state(false);
	let scanError = $state<string | null>(null);
	let outsideNotes = $state('');
	/** Whether the current pick came from the scanner — `next()` reopens it only then. */
	let pickedByScan = false;

	const searchEnabled = $derived(!value && searchTerm.trim().length >= 2);
	const evacueeSearchQuery = useSearchEvacuees(
		() => searchTerm.trim(),
		() => searchEnabled
	);

	const searchResults = $derived((evacueeSearchQuery.data as Evacuee[] | undefined) ?? []);
	// A disabled query stays `isPending` forever (TanStack v5), so gate the spinner on the
	// search being enabled; `isPending` (not `isFetching`) keeps results visible on refetch.
	const isSearching = $derived(searchEnabled && evacueeSearchQuery.isPending);

	function choose(selection: FrontlineRecipientSelection | null) {
		value = selection;
		onselect?.(selection);
	}

	function selectEvacuee(evacuee: Evacuee, viaScan: boolean) {
		pickedByScan = viaScan;
		searchTerm = '';
		scanError = null;
		choose({
			recipientType: 'evacuee',
			recipientId: evacuee._id,
			householdId: evacuee.household_id ?? undefined,
			label: `${evacuee.first_name} ${evacuee.last_name}${evacuee.nickname ? ` (${evacuee.nickname})` : ''}`,
			phone: evacuee.phone,
			stayInfo: evacuee.current_stay?.zone ? `โซน ${evacuee.current_stay.zone}` : undefined,
			menuTags: deriveRecipientMenuTags({ ...evacuee, age: evacueeAgeYears(evacuee) })
		});
	}

	async function handleScan(code: string) {
		isLookingUp = true;
		scanError = null;
		try {
			const found = await lookupEvacueeByScanCode(queryClient, code);
			if (found) {
				selectEvacuee(found, true);
			} else {
				scanError = `ไม่พบผู้ประสบภัยจากรหัส "${code}" ลองสแกนใหม่หรือค้นหาด้วยชื่อ`;
			}
		} catch (err) {
			scanError = formatDistributionError(err, 'เกิดข้อผิดพลาดในการค้นหา กรุณาลองใหม่อีกครั้ง');
		} finally {
			isLookingUp = false;
		}
	}

	function outsideSelection(): FrontlineRecipientSelection {
		return {
			recipientType: 'outside',
			recipientId: null,
			label: 'บุคคลภายนอก (ไม่ระบุตัวตน)',
			notes: outsideNotes.trim() || undefined
		};
	}

	function switchToOutside() {
		pickedByScan = false;
		scanError = null;
		choose(outsideSelection());
	}

	function handleOutsideNotesInput(e: Event) {
		outsideNotes = (e.currentTarget as HTMLInputElement).value;
		if (value?.recipientType === 'outside') choose(outsideSelection());
	}

	function handleClearSelection() {
		searchTerm = '';
		scanError = null;
		choose(null);
	}

	/** Open the camera scanner. */
	export function scan() {
		scanError = null;
		scannerOpen = true;
	}

	/**
	 * Ready for the next person after a handover: clears the evacuee and, when they were scanned,
	 * reopens the scanner. An outside-person pick is kept so a run of walk-ins needs no re-entry.
	 */
	export function next() {
		if (value?.recipientType === 'outside') return;
		const reopen = pickedByScan;
		handleClearSelection();
		if (reopen) scan();
	}
</script>

<div class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
	<p class="text-sm font-semibold text-slate-700">
		ผู้รับ <span class="text-red-500">*</span>
	</p>

	{#if value}
		<!-- Selected recipient -->
		<div
			class="flex items-center justify-between gap-3 rounded-lg border px-3 py-3 {value.recipientType ===
			'evacuee'
				? 'border-emerald-200 bg-emerald-50/60'
				: 'border-slate-200 bg-slate-50'}"
		>
			<div class="flex min-w-0 items-center gap-3">
				<div
					class="flex size-10 shrink-0 items-center justify-center rounded-full {value.recipientType ===
					'evacuee'
						? 'bg-emerald-100 text-emerald-800'
						: 'bg-slate-200 text-slate-700'}"
				>
					{#if value.recipientType === 'evacuee'}
						<User class="size-5" aria-hidden="true" />
					{:else}
						<Building2 class="size-5" aria-hidden="true" />
					{/if}
				</div>

				<div class="min-w-0">
					<p class="truncate text-base font-bold text-slate-900">{value.label}</p>
					<div class="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm text-slate-600">
						{#if value.recipientType === 'evacuee'}
							{#if value.stayInfo}<span>{value.stayInfo}</span>{/if}
							{#if value.phone}<span>โทร {value.phone}</span>{/if}
							<span class="text-xs text-slate-400">{value.recipientId}</span>
						{:else}
							<span>บุคคลภายนอก{value.notes ? ` · ${value.notes}` : ''}</span>
						{/if}
					</div>
				</div>
			</div>

			<Button
				type="button"
				variant="outline"
				onclick={handleClearSelection}
				aria-label="เปลี่ยนผู้รับ"
				{disabled}
				class="min-h-11 shrink-0 rounded-lg text-sm font-semibold"
			>
				<X class="size-4" aria-hidden="true" />
				<span>เปลี่ยนคน</span>
			</Button>
		</div>

		{#if value.recipientType === 'outside'}
			<div class="space-y-1.5">
				<label for="outside-notes" class="text-sm font-semibold text-slate-700">
					หมายเหตุผู้รับ (ไม่บังคับ)
				</label>
				<Input
					id="outside-notes"
					type="text"
					value={outsideNotes}
					oninput={handleOutsideNotesInput}
					placeholder="เช่น ประชาชนชุมชนข้างเคียง, ญาติผู้ประสบภัย..."
					class="h-11 text-sm"
					{disabled}
				/>
				<p class="text-xs text-slate-500">
					บุคคลภายนอกรับได้เฉพาะอาหารและของแจกจ่าย ไม่สามารถยืมของประเภทต้องคืนได้
				</p>
			</div>
		{/if}
	{:else}
		<!-- Scan first -->
		<Button
			type="button"
			onclick={scan}
			disabled={disabled || isLookingUp}
			class="h-14 w-full rounded-xl bg-[#0A2647] text-base font-bold hover:bg-[#051930]"
		>
			{#if isLookingUp}
				<Loader class="size-5 animate-spin" aria-hidden="true" />
				<span>กำลังค้นหา...</span>
			{:else}
				<QrCode class="size-5" aria-hidden="true" />
				<span>สแกน QR ผู้รับ</span>
			{/if}
		</Button>

		{#if scanError}
			<div
				class="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800"
				role="alert"
			>
				<AlertCircle class="size-4 shrink-0 text-red-600" aria-hidden="true" />
				<span>{scanError}</span>
			</div>
		{/if}

		<!-- Fallback: search by name -->
		<div class="flex items-center gap-3 text-xs text-slate-400">
			<span class="h-px flex-1 bg-slate-200"></span>
			<span>หรือ</span>
			<span class="h-px flex-1 bg-slate-200"></span>
		</div>

		<div class="relative">
			<Search
				class="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400"
				aria-hidden="true"
			/>
			<Input
				id="recipient-search-input"
				type="search"
				bind:value={searchTerm}
				placeholder="ค้นหาด้วยชื่อ ชื่อเล่น หรือเบอร์โทร"
				aria-label="ค้นหาผู้รับด้วยชื่อ ชื่อเล่น หรือเบอร์โทร"
				class="h-11 pl-9 text-sm"
				{disabled}
			/>
		</div>

		{#if isSearching}
			<div class="flex items-center justify-center gap-2 py-3 text-sm text-slate-500">
				<Loader class="size-4 animate-spin text-sky-600" aria-hidden="true" />
				<span>กำลังค้นหา...</span>
			</div>
		{:else if searchEnabled && searchResults.length === 0}
			<p class="rounded-lg bg-slate-50 py-3 text-center text-sm text-slate-500">
				ไม่พบผู้ประสบภัยที่ตรงกับคำค้นหา
			</p>
		{:else if searchResults.length > 0}
			<div class="max-h-60 space-y-1 overflow-y-auto rounded-lg border border-slate-200/80 p-1">
				{#each searchResults as evacuee (evacuee._id)}
					<button
						type="button"
						onclick={() => selectEvacuee(evacuee, false)}
						class="flex min-h-11 w-full flex-col justify-center rounded-lg px-3 py-2 text-left hover:bg-sky-50 focus-visible:bg-sky-50 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
					>
						<span class="text-sm font-semibold text-slate-900">
							{evacuee.first_name}
							{evacuee.last_name}
							{#if evacuee.nickname}
								<span class="font-normal text-slate-500">({evacuee.nickname})</span>
							{/if}
						</span>
						<span class="text-xs text-slate-500">
							{#if evacuee.current_stay?.zone}โซน {evacuee.current_stay.zone} ·
							{/if}{evacuee.phone ?? evacuee._id}
						</span>
					</button>
				{/each}
			</div>
		{/if}

		{#if allowOutside}
			<Button
				type="button"
				variant="ghost"
				onclick={switchToOutside}
				{disabled}
				class="min-h-11 w-full text-sm font-semibold text-slate-600"
			>
				<Building2 class="size-4" aria-hidden="true" />
				<span>บุคคลภายนอก</span>
			</Button>
		{/if}
	{/if}
</div>

<CameraCodeScannerDialog
	bind:open={scannerOpen}
	title="สแกน QR ผู้รับ"
	hint="เล็งกล้องไปที่ QR บนบัตรผู้ประสบภัย หรือพิมพ์ / ยิงรหัสด้วยเครื่องสแกน"
	formats={SCAN_FORMATS}
	manualInputMode="text"
	onScan={handleScan}
/>
