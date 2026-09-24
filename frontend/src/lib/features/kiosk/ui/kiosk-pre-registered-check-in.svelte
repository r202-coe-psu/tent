<script lang="ts">
	import QRCode from 'qrcode';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Printer from '@lucide/svelte/icons/printer';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import { Button } from '$lib/components/ui/button/index.js';
	import KioskCheckInWizard from './kiosk-check-in-wizard.svelte';
	import { isAlreadyCheckedInStatus } from '../domain/check-in-status';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import {
		checkInSelectedMembers,
		lookupPreRegisteredEvacuee,
		type GateInput,
		type KioskCheckInMemberResult,
		type KioskEvacueeSummary,
		type KioskLookupResult
	} from '../data/kiosk-check-in.api';

	interface Props {
		input: GateInput | null;
		contextQuery: string;
		displayShelterCode: string;
		cardMode?: boolean;
		cardRemoved?: boolean;
		onreset: () => void;
	}

	let {
		input,
		contextQuery,
		displayShelterCode,
		cardMode = false,
		cardRemoved = true,
		onreset
	}: Props = $props();

	let lookup = $state<KioskLookupResult | null>(null);
	let lookupError = $state('');
	let isLookingUp = $state(false);
	let isSubmitting = $state(false);
	let selectedIds = $state<string[]>([]);
	let results = $state<KioskCheckInMemberResult[]>([]);
	let qrImages = $state<Record<string, string>>({});
	let actionError = $state('');
	let printError = $state('');
	let printBusy = $state(false);
	let lookupKey = '';

	const homeUrl = $derived(`/kiosk${contextQuery}`);
	const centerMatches = $derived(
		Boolean(displayShelterCode) && displayShelterCode === lookup?.shelter_code
	);
	const successfulResults = $derived(
		results.filter((result) => result.status === 'checked_in' || result.qr_payload)
	);
	const reportedResults = $derived(
		results.filter(
			(result) =>
				result.status === 'checked_in' ||
				result.status === 'already_checked_in' ||
				result.qr_payload
		)
	);
	const wizardStep = $derived(
		results.length > 0 ? 5 : lookupError || isLookingUp ? 3 : lookup ? 4 : 2
	);
	const selectedMembers = $derived(
		lookup?.members.filter((member) => selectedIds.includes(member.evacuee_id)) ?? []
	);

	// A gate arrives after camera/card events; this effect owns that async lookup side effect.
	$effect(() => {
		const nextInput = input;
		if (!nextInput) return;
		const nextKey = JSON.stringify(nextInput);
		if (lookupKey === nextKey) return;
		lookupKey = nextKey;
		void performLookup(nextInput);
	});

	async function performLookup(gate: GateInput): Promise<void> {
		lookup = null;
		lookupError = '';
		results = [];
		qrImages = {};
		selectedIds = [];
		isLookingUp = true;
		try {
			const found = await lookupPreRegisteredEvacuee(gate);
			lookup = found;
			if (!centerMatchesFor(found.shelter_code)) {
				lookupError = 'ข้อมูลศูนย์ของเครื่องสแกนไม่ตรงกัน กรุณาติดต่อผู้ดูแลเครื่อง';
				return;
			}
			const scannedMember = found.members.find((member) => member.is_primary);
			if (scannedMember && isAlreadyCheckedInStatus(scannedMember.status)) {
				results = [
					{
						evacuee_id: scannedMember.evacuee_id,
						status: 'already_checked_in',
						stay_status: scannedMember.status,
						...(scannedMember.status === 'arriving' ? { qr_payload: scannedMember.evacuee_id } : {})
					}
				];
				return;
			}
			selectedIds = found.members
				.filter((member) => member.is_primary && member.selectable)
				.map((member) => member.evacuee_id);
		} catch (error) {
			lookupError =
				error instanceof Error ? error.message : 'ค้นหาข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง';
		} finally {
			isLookingUp = false;
		}
	}

	function centerMatchesFor(serverCode: string): boolean {
		return Boolean(displayShelterCode) && displayShelterCode === serverCode;
	}

	function toggleMember(member: KioskEvacueeSummary, checked: boolean | 'indeterminate'): void {
		if (!member.selectable || checked === 'indeterminate') return;
		selectedIds = checked
			? [...new Set([...selectedIds, member.evacuee_id])]
			: selectedIds.filter((id) => id !== member.evacuee_id);
	}

	async function submitCheckIn(): Promise<void> {
		if (!lookup || !centerMatches || selectedIds.length === 0 || isSubmitting) return;
		if (cardMode && !cardRemoved) return;
		isSubmitting = true;
		actionError = '';
		printError = '';
		try {
			const response = await checkInSelectedMembers(lookup.primary_evacuee_id, selectedIds);
			results = response.members;
			await prepareQrImages(response.members);
		} catch (error) {
			actionError = error instanceof Error ? error.message : 'บันทึกการรายงานตัวไม่สำเร็จ';
		} finally {
			isSubmitting = false;
		}
	}

	async function prepareQrImages(items: KioskCheckInMemberResult[]): Promise<boolean> {
		printError = '';
		const nextImages: Record<string, string> = { ...qrImages };
		try {
			for (const item of items) {
				if (!item.qr_payload || nextImages[item.evacuee_id]) continue;
				nextImages[item.evacuee_id] = await QRCode.toDataURL(item.qr_payload, {
					width: 240,
					margin: 1,
					color: { dark: '#0A2647', light: '#FFFFFF' }
				});
			}
			qrImages = nextImages;
			return true;
		} catch {
			qrImages = nextImages;
			printError = 'สร้าง QR สำหรับพิมพ์ไม่สำเร็จ กรุณาลองอีกครั้ง';
			return false;
		}
	}

	async function printWristbands(): Promise<void> {
		if (successfulResults.length === 0 || printBusy) return;
		printBusy = true;
		const allReady = await prepareQrImages(successfulResults);
		if (allReady) {
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			window.print();
		}
		printBusy = false;
	}

	function fullName(member: Pick<KioskEvacueeSummary, 'first_name' | 'last_name'>): string {
		return [member.first_name, member.last_name].filter(Boolean).join(' ') || 'ไม่ระบุชื่อ';
	}

	function statusLabel(status: string): string {
		if (status === 'pre_registered') return 'ลงทะเบียนล่วงหน้า';
		if (status === 'arriving') return 'รายงานตัวแล้ว · รอคัดกรอง';
		if (status === 'room_confirmed') return 'ยืนยันที่พักแล้ว';
		if (status === 'temporary_leave') return 'ออกไปชั่วคราว';
		if (status === 'active') return 'เข้าพักแล้ว';
		if (status === 'cancelled') return 'ยกเลิก';
		return 'ไม่พร้อมรายงานตัว';
	}
</script>

<svelte:head>
	<title>ตรวจสอบและรายงานตัว — SmartShelter Kiosk</title>
</svelte:head>

<section class="mx-auto flex w-full max-w-5xl flex-col gap-3" aria-labelledby="check-in-title">
	<KioskCheckInWizard currentStep={wizardStep} />
	<div class="no-print flex justify-start">
		<Button
			href={homeUrl}
			variant="ghost"
			aria-label="กลับหน้าเริ่มต้น"
			class="min-h-11 gap-2 px-3 text-base font-semibold text-[#0A2647] focus-visible:ring-2 focus-visible:ring-[#0A2647]"
		>
			<ArrowLeft class="h-5 w-5" aria-hidden="true" />กลับ
		</Button>
	</div>

	<header class="text-center">
		<h1
			id="check-in-title"
			class="text-2xl font-extrabold tracking-tight text-[#0A2647] sm:text-3xl"
		>
			{results.length > 0
				? 'ผลรายงานตัว'
				: lookup
					? 'เลือกสมาชิก'
					: cardMode && !input
						? 'รอเสียบบัตร'
						: 'กำลังค้นหา'}
		</h1>
		{#if cardMode && !cardRemoved && input && results.length === 0}
			<p class="mt-1 text-base font-semibold text-slate-700">ถอดบัตรเพื่อยืนยัน</p>
		{:else if cardMode && !input}
			<p class="mt-1 text-base text-slate-700">เสียบบัตรเพื่อค้นหา</p>
		{:else if lookup && results.length === 0}
			<p class="mt-1 text-base text-slate-700">เลือกผู้ที่มาถึง</p>
		{:else if results.some((result) => result.status === 'already_checked_in')}
			<p class="mt-1 text-base text-slate-700">พบผลรายงานตัวเดิม ไม่มีการบันทึกซ้ำ</p>
		{:else if results.length > 0}
			<p class="mt-1 text-base text-slate-700">ตรวจผล แล้วพิมพ์ QR Code</p>
		{/if}
	</header>

	{#if cardMode && !cardRemoved && input && results.length === 0}
		<div
			class="no-print flex items-center gap-4 rounded-2xl border border-sky-200 bg-sky-50 p-5 text-sky-950"
			role="status"
			aria-live="polite"
		>
			<CreditCard class="h-8 w-8 shrink-0 text-sky-800" aria-hidden="true" />
			<p class="text-base font-bold">ถอดบัตรเพื่อยืนยัน</p>
		</div>
	{/if}

	{#if cardMode && !input}
		<div
			class="no-print flex min-h-20 items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white text-base font-semibold text-slate-700"
			role="status"
			aria-live="polite"
		>
			<CreditCard class="h-5 w-5 text-[#0A2647]" aria-hidden="true" />รอเสียบบัตร
		</div>
	{/if}

	{#if isLookingUp}
		<div
			class="no-print flex min-h-20 items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white text-base font-semibold text-slate-700"
			role="status"
		>
			<span
				class="h-6 w-6 animate-spin rounded-full border-2 border-slate-300 border-t-[#0A2647]"
				aria-hidden="true"
			></span>
			กำลังค้นหาข้อมูล…
		</div>
	{/if}

	{#if lookupError}
		<div
			class="no-print rounded-2xl border border-amber-200 bg-amber-50 p-5 text-amber-950"
			role="alert"
		>
			<div class="flex items-start gap-3">
				<CircleAlert class="mt-0.5 h-6 w-6 shrink-0" aria-hidden="true" />
				<div>
					<h2 class="text-base font-bold">ค้นหาไม่สำเร็จ</h2>
					<p class="mt-1 text-base leading-relaxed">{lookupError}</p>
				</div>
			</div>
		</div>
	{/if}

	{#if lookup && centerMatches && results.length === 0}
		<section
			class="no-print rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-6"
			aria-labelledby="household-title"
		>
			<div class="mb-4 flex items-center gap-3">
				<div
					class="flex h-11 w-11 items-center justify-center rounded-xl bg-[#F0F4F8] text-[#0A2647]"
					aria-hidden="true"
				>
					<UsersRound class="h-6 w-6" />
				</div>
				<div>
					<h2 id="household-title" class="text-lg font-bold text-slate-900">สมาชิก</h2>
					<p class="text-sm text-slate-600">ศูนย์ {lookup.shelter_code}</p>
				</div>
			</div>

			<div class="space-y-3">
				{#each lookup.members as member (member.evacuee_id)}
					<div
						class="flex min-h-16 items-center gap-3 rounded-xl border border-slate-200 bg-white px-3 py-2 {member.selectable
							? ''
							: 'bg-slate-50'}"
					>
						<Checkbox
							checked={selectedIds.includes(member.evacuee_id)}
							onCheckedChange={(checked) => toggleMember(member, checked)}
							disabled={!member.selectable || isSubmitting || (cardMode && !cardRemoved)}
							aria-labelledby={`member-name-${member.evacuee_id}`}
							class="size-12"
						/>
						<div class="min-w-0 flex-1">
							<p
								id={`member-name-${member.evacuee_id}`}
								class="truncate text-base font-bold text-slate-950 sm:text-lg"
							>
								{fullName(member)}
								{#if member.is_primary}<span
										class="ml-2 rounded-full bg-[#F0F4F8] px-2 py-1 text-xs font-bold text-[#0A2647]"
										>ผู้ลงทะเบียน</span
									>{/if}
							</p>
							<p class="mt-1 text-sm text-slate-600">
								{member.age === null ? 'ไม่ระบุอายุ' : `${member.age} ปี`}
								<span class="mx-1" aria-hidden="true">·</span>{statusLabel(member.status)}
							</p>
						</div>
					</div>
				{/each}
			</div>

			{#if selectedMembers.length > 0 && selectedMembers.length < lookup.members.length}
				<p class="mt-4 text-sm leading-relaxed text-slate-600">
					เลือก {selectedMembers.length} คน · รายงานตัวแล้วเลือกซ้ำไม่ได้
				</p>
			{/if}

			{#if actionError}
				<p
					class="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-sm font-semibold text-rose-900"
					role="alert"
				>
					{actionError}
				</p>
			{/if}

			<div class="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
				<Button
					type="button"
					variant="outline"
					onclick={onreset}
					class="min-h-12 border-[#CBD5E1] px-5 text-base font-bold text-[#0A2647]">ยกเลิก</Button
				>
				<Button
					type="button"
					disabled={!centerMatches ||
						selectedIds.length === 0 ||
						isSubmitting ||
						(cardMode && !cardRemoved)}
					onclick={submitCheckIn}
					class="min-h-12 gap-2 bg-[#0A2647] px-6 text-base font-bold text-white hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-[#0A2647] focus-visible:ring-offset-2"
				>
					{#if isSubmitting}<span
							class="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white"
							aria-hidden="true"
						></span>กำลังบันทึก…{:else}<CheckCircle2 class="h-5 w-5" aria-hidden="true" />ยืนยัน · {selectedIds.length}
						คน{/if}
				</Button>
			</div>
			{#if !centerMatches}<p class="mt-3 text-sm font-semibold text-rose-800" role="alert">
					ศูนย์บนหน้าจอไม่ตรงกับศูนย์ที่ผูกกับเครื่อง จึงยังยืนยันไม่ได้
				</p>{/if}
		</section>
	{/if}

	{#if results.length > 0}
		<section
			class="no-print rounded-2xl border border-emerald-200 bg-white p-5 shadow-2xs sm:p-7"
			aria-labelledby="result-title"
			aria-live="polite"
		>
			<div class="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
				<div class="flex items-start gap-3">
					<div
						class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800"
						aria-hidden="true"
					>
						<CheckCircle2 class="h-7 w-7" />
					</div>
					<div>
						<h2 id="result-title" class="text-xl font-extrabold text-[#0A2647] sm:text-2xl">
							{results.some((result) => result.status === 'already_checked_in')
								? 'รายงานตัวแล้ว'
								: successfulResults.length > 0
									? 'บันทึกผลรายงานตัวแล้ว'
									: 'ไม่มีสมาชิกที่รายงานตัวสำเร็จ'}
						</h2>
						<p class="mt-1 text-sm leading-relaxed text-slate-700">
							รายงานตัวแล้ว {reportedResults.length} จาก {results.length} คน · ศูนย์ {lookup?.shelter_code}
						</p>
					</div>
				</div>
				<div class="flex flex-col gap-2 sm:flex-row">
					<Button
						type="button"
						disabled={successfulResults.length === 0 || printBusy || isSubmitting}
						onclick={printWristbands}
						class="min-h-12 gap-2 bg-[#0A2647] px-5 text-base font-bold text-white hover:bg-[#051930]"
					>
						<Printer class="h-5 w-5" aria-hidden="true" />{printBusy || isSubmitting
							? 'กำลังเตรียม QR…'
							: 'พิมพ์ QR Code'}
					</Button>
					<Button
						type="button"
						variant="outline"
						onclick={onreset}
						class="min-h-12 border-[#CBD5E1] px-5 text-base font-bold text-[#0A2647]"
						>เสร็จสิ้น</Button
					>
				</div>
			</div>
			{#if printError}<p
					class="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-950"
					role="alert"
				>
					{printError} ใช้ปุ่มพิมพ์อีกครั้งได้โดยไม่บันทึก check-in ซ้ำ
				</p>{/if}
			<div class="mt-5 space-y-3">
				{#each results as result (result.evacuee_id)}
					{@const person = lookup?.members.find(
						(member) => member.evacuee_id === result.evacuee_id
					)}
					<div
						class="flex items-center gap-3 rounded-xl border {result.qr_payload ||
						result.status === 'already_checked_in'
							? 'border-emerald-200 bg-emerald-50'
							: 'border-amber-200 bg-amber-50'} p-4"
					>
						{#if result.qr_payload || result.status === 'already_checked_in'}<CheckCircle2
								class="h-6 w-6 shrink-0 text-emerald-800"
								aria-hidden="true"
							/>{:else}<CircleAlert
								class="h-6 w-6 shrink-0 text-amber-800"
								aria-hidden="true"
							/>{/if}
						<div class="min-w-0 flex-1">
							<p class="truncate text-base font-bold text-slate-950">
								{person ? fullName(person) : result.evacuee_id}
							</p>
							<p class="mt-1 text-sm text-slate-700">
								{result.status === 'checked_in'
									? 'รายงานตัวสำเร็จ · รอคัดกรอง'
									: result.qr_payload
										? 'รายงานตัวแล้ว · ใช้ QR เดิมเพื่อพิมพ์ซ้ำได้'
										: result.status === 'already_checked_in'
											? statusLabel(result.stay_status ?? 'unknown')
											: 'ไม่สามารถรายงานตัวได้ กรุณาให้เจ้าหน้าที่ตรวจสอบ'}
							</p>
						</div>
						{#if result.qr_payload}<QrCode
								class="h-6 w-6 shrink-0 text-emerald-800"
								aria-label="มี QR สำหรับสายรัดข้อมือ"
							/>{/if}
					</div>
				{/each}
			</div>
		</section>

		<div class="print-area" aria-hidden="true">
			{#each successfulResults as result (result.evacuee_id)}
				{@const person = lookup?.members.find((member) => member.evacuee_id === result.evacuee_id)}
				<div class="wristband">
					<div class="wristband-brand">SMART SHELTER · รายงานตัวแล้ว</div>
					<p class="wristband-name">{person ? fullName(person) : ''}</p>
					<p class="wristband-center">ศูนย์ {lookup?.shelter_code}</p>
					{#if qrImages[result.evacuee_id]}<img
							src={qrImages[result.evacuee_id]}
							alt="QR ประจำตัวสำหรับใช้ภายในศูนย์"
						/>{:else}<div class="qr-placeholder">QR</div>{/if}
					<p class="wristband-help">สแกน QR นี้เพื่อค้นหาข้อมูลในศูนย์พักพิง</p>
				</div>
			{/each}
		</div>
	{/if}

	<p class="no-print flex items-center justify-center gap-2 text-sm text-slate-600">
		<ShieldCheck class="h-4 w-4 shrink-0 text-[#0A2647]" aria-hidden="true" />QR
		ไม่มีข้อมูลส่วนบุคคล
	</p>
</section>

<style>
	.print-area {
		display: none;
	}

	@media print {
		:global(body *) {
			visibility: hidden !important;
		}
		.print-area,
		.print-area * {
			visibility: visible !important;
		}
		.print-area {
			display: block;
			position: absolute;
			inset: 0;
			width: 100%;
		}
		.wristband {
			box-sizing: border-box;
			width: 80mm;
			min-height: 120mm;
			margin: 0 auto;
			padding: 8mm;
			page-break-after: always;
			break-after: page;
			border: 1px dashed #64748b;
			text-align: center;
			font-family: sans-serif;
			color: #0f172a;
		}
		.wristband-brand {
			font-size: 10pt;
			font-weight: 700;
		}
		.wristband-name {
			margin: 8mm 0 2mm;
			font-size: 18pt;
			font-weight: 800;
		}
		.wristband-center {
			margin: 0;
			font-size: 11pt;
		}
		.wristband img {
			display: block;
			width: 48mm;
			height: 48mm;
			margin: 6mm auto;
		}
		.wristband-help {
			margin: 0;
			font-size: 9pt;
		}
		.qr-placeholder {
			display: grid;
			place-items: center;
			width: 48mm;
			height: 48mm;
			margin: 6mm auto;
			border: 1px solid #94a3b8;
		}
		@page {
			size: 90mm 130mm;
			margin: 4mm;
		}
	}
</style>
