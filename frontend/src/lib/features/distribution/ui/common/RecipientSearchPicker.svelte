<script lang="ts">
	import { useQueryClient } from '@tanstack/svelte-query';
	import Search from '@lucide/svelte/icons/search';
	import User from '@lucide/svelte/icons/user';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import X from '@lucide/svelte/icons/x';
	import Lock from '@lucide/svelte/icons/lock';
	import Loader from '@lucide/svelte/icons/loader';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import Check from '@lucide/svelte/icons/check';
	import Building2 from '@lucide/svelte/icons/building-2';
	import { useSearchEvacuees, lookupEvacueeByScanCode, type Evacuee } from '$lib/features/people';
	import type { FrontlineRecipientSelection } from '../model/frontline-handover';

	interface Props {
		value?: FrontlineRecipientSelection | null;
		disabled?: boolean;
		onselect?: (recipient: FrontlineRecipientSelection | null) => void;
	}

	let { value = $bindable(null), disabled = false, onselect }: Props = $props();

	const queryClient = useQueryClient();

	let activeTab = $state<'evacuee' | 'outside'>('evacuee');
	let searchTerm = $state('');
	let scanCodeInput = $state('');
	let isScanning = $state(false);
	let scanError = $state<string | null>(null);
	let outsideNotes = $state('');

	const searchEnabled = $derived(
		activeTab === 'evacuee' && !value && searchTerm.trim().length >= 2
	);
	const evacueeSearchQuery = useSearchEvacuees(
		() => searchTerm.trim(),
		() => searchEnabled
	);

	const searchResults = $derived((evacueeSearchQuery.data as Evacuee[] | undefined) ?? []);
	const isSearching = $derived(evacueeSearchQuery.isPending);

	function selectEvacuee(evacuee: Evacuee) {
		const selection: FrontlineRecipientSelection = {
			recipientType: 'evacuee',
			recipientId: evacuee._id,
			householdId: evacuee.household_id ?? undefined,
			label: `${evacuee.first_name} ${evacuee.last_name}${evacuee.nickname ? ` (${evacuee.nickname})` : ''}`,
			phone: evacuee.phone,
			stayInfo: evacuee.current_stay?.zone ? `โซน ${evacuee.current_stay.zone}` : undefined
		};
		value = selection;
		searchTerm = '';
		scanError = null;
		onselect?.(selection);
	}

	async function handleScanSubmit(e: SubmitEvent) {
		e.preventDefault();
		const code = scanCodeInput.trim();
		if (!code) return;

		isScanning = true;
		scanError = null;
		try {
			const found = await lookupEvacueeByScanCode(queryClient, code);
			if (found) {
				selectEvacuee(found);
				scanCodeInput = '';
			} else {
				scanError = `ไม่พบข้อมูลผู้ประสบภัยจากรหัส '${code}'`;
			}
		} catch (err) {
			scanError = `เกิดข้อผิดพลาดในการค้นหา: ${(err as Error).message}`;
		} finally {
			isScanning = false;
		}
	}

	function handleOutsideTabSelect() {
		activeTab = 'outside';
		const selection: FrontlineRecipientSelection = {
			recipientType: 'outside',
			recipientId: null,
			label: 'บุคคลภายนอก (ไม่ระบุตัวตน)',
			notes: outsideNotes.trim() || undefined
		};
		value = selection;
		scanError = null;
		onselect?.(selection);
	}

	function handleEvacueeTabSelect() {
		activeTab = 'evacuee';
		if (value?.recipientType === 'outside') {
			value = null;
			onselect?.(null);
		}
	}

	function handleClearSelection() {
		value = null;
		searchTerm = '';
		scanCodeInput = '';
		scanError = null;
		if (activeTab === 'outside') {
			activeTab = 'evacuee';
		}
		onselect?.(null);
	}

	function handleOutsideNotesChange(e: Event) {
		const target = e.currentTarget as HTMLInputElement;
		outsideNotes = target.value;
		if (value?.recipientType === 'outside') {
			value = {
				...value,
				notes: target.value.trim() || undefined
			};
			onselect?.(value);
		}
	}
</script>

<div class="space-y-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-2xs">
	<!-- Recipient Type Tabs Header -->
	<div class="flex items-center justify-between border-b border-slate-100 pb-2">
		<label
			for="recipient-search-input"
			class="text-xs font-bold tracking-wider text-slate-700 uppercase"
		>
			ผู้รับสิ่งของ / อาหาร <span class="text-red-500">*</span>
		</label>

		<div class="flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 p-0.5">
			<button
				type="button"
				class="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors {activeTab ===
				'evacuee'
					? 'bg-white text-sky-900 shadow-2xs'
					: 'text-slate-600 hover:text-slate-900'}"
				onclick={handleEvacueeTabSelect}
				{disabled}
			>
				<User class="h-3.5 w-3.5" />
				<span>ผู้ประสบภัย</span>
			</button>

			<button
				type="button"
				class="inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-xs font-semibold transition-colors {activeTab ===
				'outside'
					? 'bg-white text-sky-900 shadow-2xs'
					: 'text-slate-600 hover:text-slate-900'}"
				onclick={handleOutsideTabSelect}
				{disabled}
			>
				<Building2 class="h-3.5 w-3.5" />
				<span>บุคคลภายนอก</span>
			</button>

			<button
				type="button"
				disabled
				title="ระบบทะเบียนจิตอาสายังไม่เปิดใช้งาน (VOLUNTEER_LOOKUP_MISSING)"
				class="inline-flex cursor-not-allowed items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-slate-400 opacity-60"
			>
				<Lock class="h-3 w-3" />
				<span>จิตอาสา</span>
			</button>
		</div>
	</div>

	<!-- Active Selected Recipient Summary Card -->
	{#if value}
		<div
			class="flex items-center justify-between rounded-lg border px-3 py-2.5 {value.recipientType ===
			'evacuee'
				? 'border-sky-200 bg-sky-50/70 text-sky-950'
				: 'border-slate-200 bg-slate-50 text-slate-900'}"
		>
			<div class="flex items-center gap-2.5 overflow-hidden">
				<div
					class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full {value.recipientType ===
					'evacuee'
						? 'bg-sky-200/80 text-sky-800'
						: 'bg-slate-200 text-slate-700'}"
				>
					{#if value.recipientType === 'evacuee'}
						<User class="h-4 w-4" />
					{:else}
						<Building2 class="h-4 w-4" />
					{/if}
				</div>

				<div class="min-w-0">
					<div class="flex items-center gap-2">
						<span class="truncate text-xs font-bold">{value.label}</span>
						<span
							class="py-0.2 rounded-full px-2 text-2xs font-semibold {value.recipientType ===
							'evacuee'
								? 'bg-sky-100 text-sky-800'
								: 'bg-slate-200 text-slate-800'}"
						>
							{value.recipientType === 'evacuee' ? 'ผู้ประสบภัยในศูนย์' : 'บุคคลภายนอก'}
						</span>
					</div>

					<div class="flex items-center gap-3 text-2xs text-slate-500">
						{#if value.recipientType === 'evacuee'}
							<span class="font-mono text-slate-400">{value.recipientId}</span>
							{#if value.stayInfo}
								<span>• {value.stayInfo}</span>
							{/if}
							{#if value.phone}
								<span>• โทร: {value.phone}</span>
							{/if}
							{#if value.householdId}
								<span>• ครอบครัว: {value.householdId}</span>
							{/if}
						{:else if value.notes}
							<span>หมายเหตุ: {value.notes}</span>
						{/if}
					</div>
				</div>
			</div>

			<button
				type="button"
				onclick={handleClearSelection}
				class="rounded-full p-1 text-slate-400 hover:bg-slate-200/60 hover:text-slate-700"
				title="เปลี่ยนผู้รับ"
				aria-label="เปลี่ยนผู้รับ"
				{disabled}
			>
				<X class="h-4 w-4" />
			</button>
		</div>
	{:else if activeTab === 'evacuee'}
		<!-- Search by Name/Phone or QR Scan Form -->
		<div class="space-y-3">
			<!-- Name / Phone search input -->
			<div class="relative">
				<Search class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
				<input
					id="recipient-search-input"
					type="search"
					bind:value={searchTerm}
					placeholder="พิมพ์ชื่อ นามสกุล ชื่อเล่น หรือเบอร์โทรศัพท์..."
					class="h-9 w-full rounded-lg border border-slate-200 bg-white pr-3 pl-9 text-xs shadow-2xs transition-colors placeholder:text-slate-400 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none"
					{disabled}
				/>
			</div>

			<!-- Scan Code / ID quick input -->
			<form onsubmit={handleScanSubmit} class="flex items-center gap-2">
				<div class="relative flex-1">
					<QrCode class="absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-slate-400" />
					<input
						type="text"
						bind:value={scanCodeInput}
						placeholder="สแกน QR หรือวางรหัสบัตร / evacuee:ID..."
						class="h-8 w-full rounded-lg border border-slate-200 bg-white pr-3 pl-9 text-xs shadow-2xs transition-colors placeholder:text-slate-400 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none"
						{disabled}
					/>
				</div>
				<button
					type="submit"
					disabled={disabled || isScanning || !scanCodeInput.trim()}
					class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs font-semibold text-slate-700 shadow-2xs hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
				>
					{#if isScanning}
						<Loader class="h-3 w-3 animate-spin" />
						<span>ค้นหา...</span>
					{:else}
						<span>ค้นหารหัส</span>
					{/if}
				</button>
			</form>

			{#if scanError}
				<div
					class="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 p-2 text-xs text-red-700"
				>
					<AlertCircle class="h-4 w-4 shrink-0 text-red-500" />
					<span>{scanError}</span>
				</div>
			{/if}

			<!-- Search Results List -->
			{#if isSearching}
				<div class="flex items-center justify-center gap-2 py-4 text-xs text-slate-500">
					<Loader class="h-4 w-4 animate-spin text-sky-600" />
					<span>กำลังค้นหาข้อมูลผู้ประสบภัย...</span>
				</div>
			{:else if searchEnabled && searchResults.length === 0}
				<div
					class="rounded-lg border border-slate-100 bg-slate-50 py-4 text-center text-xs text-slate-500"
				>
					ไม่พบข้อมูลผู้ประสบภัยที่ตรงกับคำค้นหา
				</div>
			{:else if searchResults.length > 0}
				<div class="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-slate-200/80 p-1">
					{#each searchResults as evacuee (evacuee._id)}
						<button
							type="button"
							onclick={() => selectEvacuee(evacuee)}
							class="flex w-full items-center justify-between rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors hover:bg-sky-50 focus:bg-sky-50 focus:outline-none"
						>
							<div class="min-w-0 flex-1">
								<div class="font-semibold text-slate-900">
									{evacuee.first_name}
									{evacuee.last_name}
									{#if evacuee.nickname}
										<span class="font-normal text-slate-500">({evacuee.nickname})</span>
									{/if}
								</div>
								<div class="flex items-center gap-2 text-2xs text-slate-500">
									<span class="font-mono text-slate-400">{evacuee._id}</span>
									{#if evacuee.current_stay?.zone}
										<span>• โซน {evacuee.current_stay.zone}</span>
									{/if}
									{#if evacuee.phone}
										<span>• {evacuee.phone}</span>
									{/if}
								</div>
							</div>
							<div class="shrink-0 text-sky-600">
								<Check class="h-4 w-4 opacity-0 group-hover:opacity-100" />
							</div>
						</button>
					{/each}
				</div>
			{/if}
		</div>
	{:else}
		<!-- Outside Recipient Form -->
		<div class="space-y-2 rounded-lg border border-slate-100 bg-slate-50 p-3">
			<div class="flex items-start gap-2 text-xs text-slate-600">
				<AlertCircle class="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
				<div class="space-y-1 text-2xs">
					<p class="font-semibold text-slate-800">
						บันทึกแจกจ่ายให้บุคคลภายนอก / ประชาชนที่ไม่ได้ลงทะเบียนในศูนย์
					</p>
					<p class="text-slate-500">
						• สามารถรับอาหารปรุงสุก และพัสดุประเภท <strong>แจกจ่าย (สิ้นเปลือง)</strong> ได้<br />
						• <strong>ไม่สามารถ</strong> รับพัสดุประเภท <strong>ต้องคืน (ยืม-คืน)</strong> ได้
					</p>
				</div>
			</div>

			<div class="pt-1">
				<label for="outside-notes" class="mb-1 block text-2xs font-medium text-slate-600">
					หมายเหตุ / ข้อมูลผู้รับ (ไม่บังคับ)
				</label>
				<input
					id="outside-notes"
					type="text"
					value={outsideNotes}
					oninput={handleOutsideNotesChange}
					placeholder="เช่น ประชาชนชุมชนข้างเคียง, ญาติผู้ประสบภัย..."
					class="h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs shadow-2xs placeholder:text-slate-400 focus:border-sky-500 focus:ring-1 focus:ring-sky-500 focus:outline-none"
					{disabled}
				/>
			</div>
		</div>
	{/if}
</div>
