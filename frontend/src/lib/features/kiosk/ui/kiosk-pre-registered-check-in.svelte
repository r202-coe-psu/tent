<script lang="ts">
	import type { Snippet } from 'svelte';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Printer from '@lucide/svelte/icons/printer';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import QrNameTag from '$lib/components/qr-name-tag.svelte';
	import { Button } from '$lib/components/ui/button/index.js';
	import { generateQrDataUrl, qrModuleCount } from '$lib/utils/qrcode';
	import KioskCheckInWizard from './kiosk-check-in-wizard.svelte';
	import KioskLookupErrorActions from './kiosk-lookup-error-actions.svelte';
	import PhoneHouseholdPicker from './phone-household-picker.svelte';
	import KioskPrintStatus from './kiosk-print-status.svelte';
	import {
		initialReprintSelection,
		initialSelection,
		toExistingReportResults
	} from '../domain/household-selection';
	import {
		KIOSK_LABEL_GAP_MM,
		KIOSK_LABEL_MM,
		KIOSK_LABEL_OFFSET_X_MM,
		KIOSK_LABEL_PADDING_MM,
		KIOSK_QR_COLOR,
		kioskLabelPageCss,
		kioskQrBoxMm,
		kioskQrPrintSize
	} from '../domain/print-label';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import {
		checkInSelectedMembers,
		KioskPartialCheckInError,
		KioskRequestError,
		lookupPreRegisteredEvacuee,
		type GateInput,
		type KioskCheckInMemberResult,
		type KioskCheckInPhotoOptions,
		type KioskHouseholdCandidate,
		type KioskEvacueeSummary,
		type KioskLookupResponse
	} from '../data/kiosk-check-in.api';
	import { printKioskLabels } from '../data/kiosk-print.api';
	import { renderKioskLabelPng } from '../application/kiosk-label-image';
	import { runKioskPrintFlow } from '../application/kiosk-print-flow';
	import { buildKioskPhotoPayload } from '../application/kiosk-card-photo';
	import KioskBackButton from './kiosk-back-button.svelte';
	import KioskWalkInOffer from './kiosk-walk-in-offer.svelte';
	import KioskNoticePanel from './kiosk-notice-panel.svelte';
	import { KIOSK_NOTICE_PRIMARY_ACTION } from './kiosk-notice-actions';
	import type { KioskContextQuery } from '../domain/display-context';

	interface Props {
		input: GateInput | null;
		contextQuery: KioskContextQuery;
		displayShelterCode: string;
		cardMode?: boolean;
		backHref?: string;
		onprintbusychange?: (busy: boolean) => void;
		onregister?: (citizenId: string) => void;
		onreset: () => void;
		/** Keep the member list back while `hold` (e.g. the face check) is on screen. */
		holdMembers?: boolean;
		hold?: Snippet;
		/**
		 * Smart-card check-in whose face matched: the chip photo (base64 JPEG), sent with /check-in so
		 * the server can keep it as the card owner's photo when they have none.
		 */
		cardPhoto?: string | null;
	}

	let {
		input,
		contextQuery,
		displayShelterCode,
		cardMode = false,
		backHref,
		onprintbusychange,
		onregister,
		onreset,
		holdMembers = false,
		hold,
		cardPhoto = null
	}: Props = $props();

	let lookup = $state<Extract<KioskLookupResponse, { kind: 'household' }> | null>(null);
	let candidates = $state<KioskHouseholdCandidate[]>([]);
	let candidateShelterCode = $state('');
	let lookupError = $state('');
	let lookupErrorCode = $state<string | null>(null);
	let canRegister = $state(false);
	let alreadyKioskRegistered = $state(false);
	let retryAfterSeconds = $state(0);
	let isLookingUp = $state(false);
	let isSubmitting = $state(false);
	let selectedIds = $state<string[]>([]);
	let results = $state<KioskCheckInMemberResult[]>([]);
	let retryableIds = $state<string[]>([]);
	let qrImages = $state<Record<string, { src: string; sizeMm: number }>>({});
	let actionError = $state('');
	let printError = $state('');
	let printBusy = $state(false);
	let printPhase = $state<'idle' | 'printing' | 'done'>('idle');
	let printedCount = $state(0);
	/** True when every member had already reported: the visitor picks whose QR to reprint. */
	let isReprintOnly = $state(false);
	let printSelectedIds = $state<string[]>([]);
	let lookupKey = '';
	let retryGate = $state<GateInput | null>(null);
	let lookupGeneration = 0;
	/** A ThaiD session is single-use: once a check-in reached the server, a retry must not resend it. */
	let thaidSessionSpent = false;

	const PRINT_DONE_VISIBLE_MS = 2500;
	const homeUrl = $derived(`/kiosk${contextQuery}`);
	const backUrl = $derived(backHref ?? homeUrl);
	const centerMatches = $derived(
		Boolean(displayShelterCode) &&
			displayShelterCode === (lookup?.shelter_code ?? candidateShelterCode)
	);
	const isPhoneGate = $derived(input?.source === 'phone');
	const isThaidGate = $derived(input?.source === 'thaid');
	const holdShown = $derived(
		holdMembers && Boolean(hold) && Boolean(lookup) && centerMatches && results.length === 0
	);
	/** No pre-registration for this card, and this shelter takes walk-ins at the kiosk. */
	const walkInOffered = $derived(
		Boolean(lookupError) && canRegister && input?.source === 'smart-card' && Boolean(onregister)
	);
	const successfulResults = $derived(
		results.filter((result) => result.status === 'checked_in' || result.qr_payload)
	);
	const printableResults = $derived(
		isReprintOnly
			? successfulResults.filter((result) => printSelectedIds.includes(result.evacuee_id))
			: successfulResults
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
		results.length > 0
			? 5
			: candidates.length > 0 || lookupError || isLookingUp
				? 3
				: lookup
					? 4
					: 2
	);
	const selectedMembers = $derived(
		lookup?.members.filter((member) => selectedIds.includes(member.evacuee_id)) ?? []
	);
	const selectableMemberCount = $derived(
		lookup?.members.filter((member) => member.selectable).length ?? 0
	);

	// A gate arrives after camera/card events; this effect owns that async lookup side effect.
	$effect(() => {
		const nextInput = input;
		if (!nextInput) return;
		const nextKey = JSON.stringify(nextInput);
		if (lookupKey === nextKey) return;
		lookupKey = nextKey;
		thaidSessionSpent = false;
		void performLookup(nextInput);
	});

	$effect(() => {
		if (retryAfterSeconds <= 0) return;
		const timer = window.setTimeout(() => {
			retryAfterSeconds = Math.max(0, retryAfterSeconds - 1);
		}, 1000);
		return () => window.clearTimeout(timer);
	});

	async function performLookup(gate: GateInput): Promise<void> {
		const generation = ++lookupGeneration;
		retryGate = gate;
		lookup = null;
		candidates = [];
		candidateShelterCode = '';
		lookupError = '';
		lookupErrorCode = null;
		canRegister = false;
		alreadyKioskRegistered = false;
		retryAfterSeconds = 0;
		results = [];
		retryableIds = [];
		qrImages = {};
		selectedIds = [];
		isReprintOnly = false;
		printSelectedIds = [];
		isLookingUp = true;
		try {
			const found = await lookupPreRegisteredEvacuee(gate);
			if (generation !== lookupGeneration) return;
			if (!centerMatchesFor(found.shelter_code)) {
				lookupError = 'ข้อมูลศูนย์ของเครื่องสแกนไม่ตรงกัน กรุณาติดต่อผู้ดูแลเครื่อง';
				return;
			}
			if (found.kind === 'candidates') {
				candidateShelterCode = found.shelter_code;
				candidates = found.candidates;
				return;
			}
			if (found.kind === 'kiosk_registered') {
				alreadyKioskRegistered = true;
				return;
			}
			lookup = found;
			const selectableMembers = found.members.filter((member) => member.selectable);
			if (selectableMembers.length === 0) {
				results = toExistingReportResults(found.members);
				isReprintOnly = true;
				printSelectedIds = initialReprintSelection(results);
				await prepareQrImages(results, generation);
				if (generation !== lookupGeneration) return;
				return;
			}
			selectedIds = initialSelection(gate.source, selectableMembers);
		} catch (error) {
			if (generation !== lookupGeneration) return;
			if (error instanceof KioskRequestError) {
				lookupErrorCode = error.code;
				lookupError = error.message;
				canRegister = error.canRegister;
				if (error.status === 429) retryAfterSeconds = 60;
			} else {
				lookupError =
					error instanceof Error ? error.message : 'ค้นหาข้อมูลไม่สำเร็จ กรุณาลองอีกครั้ง';
			}
		} finally {
			if (generation === lookupGeneration) isLookingUp = false;
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

	function togglePrint(evacueeId: string, checked: boolean | 'indeterminate'): void {
		if (checked === 'indeterminate') return;
		printSelectedIds = checked
			? [...new Set([...printSelectedIds, evacueeId])]
			: printSelectedIds.filter((id) => id !== evacueeId);
	}

	function chooseHousehold(primaryEvacueeId: string): void {
		if (input?.source !== 'phone') return;
		void performLookup({ ...input, primary_evacuee_id: primaryEvacueeId });
	}

	function retryLookup(): void {
		if (!retryGate || isLookingUp || retryAfterSeconds > 0) return;
		void performLookup(retryGate);
	}

	async function submitCheckIn(): Promise<void> {
		return submitCheckInIds(selectedIds);
	}

	async function submitCheckInIds(ids: string[]): Promise<void> {
		if (!lookup || !centerMatches || ids.length === 0 || isSubmitting || printBusy) return;
		isSubmitting = true;
		actionError = '';
		printError = '';
		try {
			const response = await checkInSelectedMembers(lookup.primary_evacuee_id, ids, {
				batchLimit: 20,
				...(isThaidGate ? thaidOptions() : await cardPhotoOptions())
			});
			thaidSessionSpent = true;
			results = mergeCheckInResults(results, response.members);
			retryableIds = response.retryable_evacuee_ids;
			if (retryableIds.length > 0) {
				actionError =
					'บางรายการยังรายงานตัวไม่สำเร็จ ตรวจผลด้านล่างและลองเฉพาะรายการที่เหลืออีกครั้ง';
			}
			await prepareQrImages(results);
		} catch (error) {
			if (isThaidGate && isThaidSessionError(error)) {
				// The verified session is gone or the method was switched off: only a new scan can go on.
				lookup = null;
				results = [];
				lookupErrorCode = error.code;
				lookupError = error.message;
			} else if (error instanceof KioskPartialCheckInError) {
				thaidSessionSpent = true;
				results = mergeCheckInResults(results, error.result.members);
				retryableIds = error.result.retryable_evacuee_ids;
				actionError = error.message;
				await prepareQrImages(results);
			} else {
				actionError = error instanceof Error ? error.message : 'บันทึกการรายงานตัวไม่สำเร็จ';
			}
		} finally {
			isSubmitting = false;
		}
	}

	/** FR-KTD-39: a ThaiD check-in carries only its verified session id; no photo, no face check. */
	function thaidOptions(): KioskCheckInPhotoOptions {
		return input?.source === 'thaid' && !thaidSessionSpent
			? { thaidSessionId: input.session_id }
			: {};
	}

	function isThaidSessionError(error: unknown): error is KioskRequestError {
		return (
			error instanceof KioskRequestError &&
			(error.code === 'KIOSK_THAID_SESSION_INVALID' || error.code === 'KIOSK_METHOD_DISABLED')
		);
	}

	/** The chip photo, made small enough to send; nothing when it cannot be (the check-in still goes ahead). */
	async function cardPhotoOptions(): Promise<KioskCheckInPhotoOptions> {
		if (!cardPhoto || input?.source !== 'smart-card') return {};
		const photo = await buildKioskPhotoPayload(cardPhoto);
		return photo ? { photo, citizenId: input.citizen_id } : {};
	}

	function mergeCheckInResults(
		current: KioskCheckInMemberResult[],
		incoming: KioskCheckInMemberResult[]
	): KioskCheckInMemberResult[] {
		const merged = [...current];
		for (const result of incoming) {
			const existingIndex = merged.findIndex(
				(existing) => existing.evacuee_id === result.evacuee_id
			);
			if (existingIndex === -1) merged.push(result);
			else merged[existingIndex] = result;
		}
		return merged;
	}

	async function prepareQrImages(
		items: KioskCheckInMemberResult[],
		generation?: number
	): Promise<boolean> {
		printError = '';
		const nextImages: Record<string, { src: string; sizeMm: number }> = { ...qrImages };
		try {
			for (const item of items) {
				if (!item.qr_payload || nextImages[item.evacuee_id]) continue;
				const size = kioskQrPrintSize(await qrModuleCount(item.qr_payload));
				const src = await generateQrDataUrl(item.qr_payload, {
					width: size.widthPx,
					margin: size.margin,
					color: KIOSK_QR_COLOR
				});
				if (!src) throw new Error('QR render returned empty');
				nextImages[item.evacuee_id] = { src, sizeMm: size.sizeMm };
			}
			if (generation !== undefined && generation !== lookupGeneration) return false;
			qrImages = nextImages;
			return true;
		} catch {
			if (generation !== undefined && generation !== lookupGeneration) return false;
			qrImages = nextImages;
			printError = 'สร้าง QR สำหรับพิมพ์ไม่สำเร็จ กรุณาลองอีกครั้ง';
			return false;
		}
	}

	async function printWristbands(): Promise<void> {
		const toPrint = printableResults;
		if (toPrint.length === 0 || printBusy) return;
		printBusy = true;
		onprintbusychange?.(true);
		try {
			if (!(await prepareQrImages(toPrint))) return;
			printedCount = toPrint.length;
			printPhase = 'printing';
			const result = await runKioskPrintFlow({
				renderLabels: () => renderLabels(toPrint),
				printLabels: printKioskLabels,
				// No scanner client (dev browser / browser print mode): print the CSS labels instead.
				fallbackPrint: async () => {
					await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
					window.print();
				}
			});
			if (result.kind === 'printed') {
				printPhase = 'done';
				window.setTimeout(() => {
					if (printPhase === 'done') printPhase = 'idle';
				}, PRINT_DONE_VISIBLE_MS);
				return;
			}
			if (result.kind === 'fallback') {
				printPhase = 'idle';
				return;
			}
			printPhase = 'idle';
			printError = result.message;
		} finally {
			printBusy = false;
			onprintbusychange?.(false);
		}
	}

	function renderLabels(items: KioskCheckInMemberResult[]): Promise<string[]> {
		return Promise.all(
			items.map((result) => {
				const person = lookup?.members.find((member) => member.evacuee_id === result.evacuee_id);
				const qr = qrImages[result.evacuee_id];
				if (!qr) throw new Error('QR image missing');
				return renderKioskLabelPng({
					qrSrc: qr.src,
					caption: 'ชื่อ',
					name: person ? fullName(person) : '',
					detail: `ศูนย์ ${lookup?.shelter_code ?? ''}`
				});
			})
		);
	}

	// Print labels must be a direct child of <body> so print CSS can drop the whole kiosk screen with
	// display:none; visibility:hidden keeps its layout height and prints blank labels.
	function mountOnBody(node: HTMLElement) {
		document.body.appendChild(node);
		return () => node.remove();
	}

	function fullName(member: Pick<KioskEvacueeSummary, 'first_name' | 'last_name'>): string {
		return [member.first_name, member.last_name].filter(Boolean).join(' ') || 'ไม่ระบุชื่อ';
	}

	function statusLabel(status: string): string {
		if (status === 'pre_registered') return 'ลงทะเบียนล่วงหน้า';
		if (status === 'kiosk_registered') return 'ลงทะเบียนที่ตู้ (รอยืนยัน)';
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
	<!-- Static CSS built from KIOSK_LABEL_MM constants only (no user input). -->
	<!-- eslint-disable-next-line svelte/no-at-html-tags -->
	{@html `<style>${kioskLabelPageCss()}</style>`}
</svelte:head>

<section
	class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-3"
	aria-labelledby="check-in-title"
>
	<KioskCheckInWizard currentStep={wizardStep} />
	<div class="no-print flex justify-start">
		<KioskBackButton
			href={backUrl}
			onclick={isPhoneGate ? onreset : undefined}
			label={isPhoneGate ? 'กลับไปกรอกเบอร์' : 'กลับหน้าเริ่มต้น'}
		/>
	</div>

	<div class="flex flex-col gap-3 print:block">
		<!-- Short screen: the face step's own heading says the same, so give the row to it. -->
		<header class={['text-center', holdShown && 'kiosk-compact:sr-only']}>
			<h1
				id="check-in-title"
				class="text-2xl font-extrabold tracking-tight text-[#0A2647] sm:text-3xl kiosk-portrait:text-4xl"
			>
				{walkInOffered
					? 'ยังไม่ได้ลงทะเบียนล่วงหน้า'
					: alreadyKioskRegistered
						? 'ลงทะเบียนที่ตู้แล้ว'
						: lookupError
							? 'ค้นหาไม่สำเร็จ'
							: results.length > 0
								? 'ผลรายงานตัว'
								: candidates.length > 0
									? 'เลือกครัวเรือน'
									: lookup
										? holdMembers
											? 'ตรวจสอบตัวตน'
											: 'เลือกสมาชิก'
										: cardMode && !input
											? 'รอเสียบบัตร'
											: 'กำลังค้นหา'}
			</h1>
			{#if cardMode && !input}
				<p class="mt-1 text-base text-slate-700">เสียบบัตรเพื่อค้นหา</p>
			{:else if lookup && results.length === 0 && !holdMembers}
				<p class="mt-1 text-base text-slate-700">เลือกผู้ที่มาถึง</p>
			{:else if candidates.length > 0}
				<p class="mt-1 text-base text-slate-700">เลือกครัวเรือนของท่าน</p>
			{:else if isReprintOnly && successfulResults.length > 0}
				<p class="mt-1 text-base text-slate-700">
					พบผลรายงานตัวเดิม ไม่มีการบันทึกซ้ำ · เลือกคนที่จะพิมพ์ QR Code
				</p>
			{:else if results.some((result) => result.status === 'already_checked_in')}
				<p class="mt-1 text-base text-slate-700">พบผลรายงานตัวเดิม ไม่มีการบันทึกซ้ำ</p>
			{:else if results.length > 0}
				<p class="mt-1 text-base text-slate-700">ตรวจผล แล้วพิมพ์ QR Code</p>
			{/if}
		</header>

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
				class="no-print flex min-h-24 items-center justify-center gap-4 rounded-2xl border border-slate-200 bg-white text-xl font-semibold text-slate-700 shadow-2xs kiosk-portrait:min-h-40 kiosk-portrait:text-3xl kiosk-compact:min-h-16 kiosk-compact:text-lg"
				role="status"
			>
				<span
					class="size-7 animate-spin rounded-full border-[3px] border-slate-300 border-t-[#0A2647] motion-reduce:animate-none kiosk-portrait:size-10"
					aria-hidden="true"
				></span>
				กำลังค้นหาข้อมูล…
			</div>
		{/if}

		{#if walkInOffered}
			<KioskWalkInOffer
				{isLookingUp}
				{retryAfterSeconds}
				onretry={retryLookup}
				onregister={() => {
					if (input?.source === 'smart-card') onregister?.(input.citizen_id);
				}}
			/>
		{:else if lookupError}
			<KioskNoticePanel tone="warning" icon={CircleAlert} title={lookupError} role="alert">
				{#snippet actions()}
					<KioskLookupErrorActions
						{lookupErrorCode}
						{isPhoneGate}
						{isThaidGate}
						{isLookingUp}
						{retryAfterSeconds}
						{homeUrl}
						{backUrl}
						onretry={retryLookup}
						{onreset}
					/>
				{/snippet}
			</KioskNoticePanel>
		{/if}

		{#if alreadyKioskRegistered}
			<KioskNoticePanel
				tone="warning"
				icon={UserCheck}
				title="ไปพบเจ้าหน้าที่เพื่อยืนยันข้อมูล"
				role="status"
			>
				<p>บัตรนี้ลงทะเบียนที่ตู้ไว้แล้ว ไม่ต้องลงทะเบียนซ้ำ</p>
				{#snippet actions()}
					<Button type="button" onclick={onreset} class={KIOSK_NOTICE_PRIMARY_ACTION}
						>กลับหน้าแรก</Button
					>
				{/snippet}
			</KioskNoticePanel>
		{/if}

		{#if candidates.length > 0 && !lookupError && !isLookingUp}
			<section class="no-print rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-6">
				<PhoneHouseholdPicker {candidates} onselect={chooseHousehold} />
			</section>
		{/if}

		{#if holdShown}
			{@render hold?.()}
		{/if}

		{#if lookup && centerMatches && results.length === 0 && !holdMembers}
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
				{#if lookup.name_masked}
					<p class="mb-4 rounded-lg bg-sky-50 px-3 py-2 text-sm font-medium text-sky-950">
						ชื่อถูกปิดบางส่วนเพื่อความเป็นส่วนตัว
					</p>
				{/if}

				<div class="space-y-3">
					{#each lookup.members as member (member.evacuee_id)}
						{@const selected = selectedIds.includes(member.evacuee_id)}
						{@const locked = isSubmitting}
						<!-- The whole row is the tap target: the label forwards taps to the checkbox. -->
						<label
							class={[
								'flex min-h-20 items-center gap-4 rounded-xl border-2 px-4 py-3 kiosk-portrait:min-h-28 kiosk-portrait:gap-6 kiosk-portrait:px-6',
								!member.selectable && 'border-slate-200 bg-slate-50 opacity-75',
								member.selectable &&
									(selected
										? 'border-[#0A2647] bg-sky-50'
										: 'border-slate-200 bg-white active:bg-slate-50'),
								member.selectable && !locked && 'cursor-pointer',
								member.selectable && locked && 'cursor-not-allowed'
							]}
						>
							{#if member.selectable}
								<Checkbox
									checked={selected}
									onCheckedChange={(checked) => toggleMember(member, checked)}
									disabled={locked}
									aria-labelledby={`member-name-${member.evacuee_id}`}
									class="size-12 shrink-0 kiosk-portrait:size-16"
								/>
							{:else}
								<span class="size-12 shrink-0 kiosk-portrait:size-16" aria-hidden="true"></span>
							{/if}
							<div class="min-w-0 flex-1">
								<p
									id={`member-name-${member.evacuee_id}`}
									class="truncate text-lg font-bold text-slate-950 kiosk-portrait:text-3xl"
								>
									{fullName(member)}
									{#if input?.source === 'phone' ? member.phone_matched : member.is_primary}<span
											class="ml-2 rounded-full bg-[#F0F4F8] px-2 py-1 text-xs font-bold text-[#0A2647] kiosk-portrait:text-lg"
											>{input?.source === 'phone' ? 'เบอร์ตรง' : 'ผู้ลงทะเบียน'}</span
										>{/if}
								</p>
								<p class="mt-1 text-sm text-slate-600 kiosk-portrait:text-xl">
									{member.age === null ? 'ไม่ระบุอายุ' : `${member.age} ปี`}
									<span class="mx-1" aria-hidden="true">·</span>{statusLabel(member.status)}
								</p>
							</div>
						</label>
					{/each}
				</div>

				{#if selectedMembers.length > 0 && selectedMembers.length < selectableMemberCount}
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
						disabled={!centerMatches || selectedIds.length === 0 || isSubmitting}
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
								{retryableIds.length > 0
									? 'รายงานตัวได้บางส่วน'
									: results.some((result) => result.status === 'already_checked_in')
										? 'รายงานตัวแล้ว'
										: successfulResults.length > 0
											? 'บันทึกผลรายงานตัวแล้ว'
											: 'ไม่มีสมาชิกที่รายงานตัวสำเร็จ'}
							</h2>
							<p class="mt-1 text-sm leading-relaxed text-slate-700">
								{#if retryableIds.length > 0}
									รายงานตัวแล้ว {reportedResults.length} คน · ยังเหลือ {retryableIds.length} คนที่ต้องตรวจผลหรือทำรายการซ้ำ
									· ศูนย์ {lookup?.shelter_code}
								{:else}
									รายงานตัวแล้ว {reportedResults.length} จาก {results.length} คน · ศูนย์ {lookup?.shelter_code}
								{/if}
							</p>
							{#if lookup?.name_masked}
								<p class="mt-2 text-sm font-medium text-slate-700">
									ชื่อถูกปิดบางส่วนเพื่อความเป็นส่วนตัว
								</p>
							{/if}
						</div>
					</div>
					<div class="flex flex-col gap-2 sm:flex-row">
						{#if retryableIds.length > 0}
							<Button
								type="button"
								disabled={!centerMatches || isSubmitting || printBusy}
								onclick={() => void submitCheckInIds(retryableIds)}
								class="min-h-12 border-[#CBD5E1] px-5 text-base font-bold text-[#0A2647]"
							>
								{isSubmitting
									? 'กำลังบันทึก…'
									: `ลองรายการที่เหลืออีกครั้ง · ${retryableIds.length} คน`}
							</Button>
						{/if}
						<Button
							type="button"
							disabled={printableResults.length === 0 || printBusy || isSubmitting}
							onclick={printWristbands}
							class="min-h-12 gap-2 bg-[#0A2647] px-5 text-base font-bold text-white hover:bg-[#051930]"
						>
							<Printer class="h-5 w-5" aria-hidden="true" />{printBusy || isSubmitting
								? 'กำลังเตรียม QR…'
								: isReprintOnly
									? `พิมพ์ QR Code · ${printableResults.length} คน`
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
				{#if actionError}
					<p
						class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm font-semibold text-amber-950"
						role="alert"
					>
						{actionError}
					</p>
				{/if}
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
						<svelte:element
							this={isReprintOnly && result.qr_payload ? 'label' : 'div'}
							class="flex items-center gap-3 rounded-xl border {isReprintOnly && result.qr_payload
								? 'cursor-pointer'
								: ''} {result.qr_payload || result.status === 'already_checked_in'
								? 'border-emerald-200 bg-emerald-50'
								: 'border-amber-200 bg-amber-50'} p-4"
						>
							{#if isReprintOnly && result.qr_payload}<Checkbox
									checked={printSelectedIds.includes(result.evacuee_id)}
									onCheckedChange={(checked) => togglePrint(result.evacuee_id, checked)}
									disabled={printBusy}
									aria-labelledby={`result-name-${result.evacuee_id}`}
									aria-describedby={`result-status-${result.evacuee_id}`}
									class="size-12 bg-white"
								/>{:else if isReprintOnly}<span class="size-12 shrink-0" aria-hidden="true"
								></span>{:else if result.qr_payload || result.status === 'already_checked_in'}<CheckCircle2
									class="h-6 w-6 shrink-0 text-emerald-800"
									aria-hidden="true"
								/>{:else}<CircleAlert
									class="h-6 w-6 shrink-0 text-amber-800"
									aria-hidden="true"
								/>{/if}
							<div class="min-w-0 flex-1">
								<p
									id={`result-name-${result.evacuee_id}`}
									class="truncate text-base font-bold text-slate-950"
								>
									{person ? fullName(person) : result.evacuee_id}
								</p>
								<p id={`result-status-${result.evacuee_id}`} class="mt-1 text-sm text-slate-700">
									{result.status === 'checked_in'
										? 'รายงานตัวสำเร็จ · รอคัดกรอง'
										: result.qr_payload
											? 'รายงานตัวแล้ว · ใช้ QR เดิมเพื่อพิมพ์ซ้ำได้'
											: result.status === 'already_checked_in'
												? statusLabel(result.stay_status ?? 'unknown')
												: 'ไม่สามารถรายงานตัวได้ กรุณาให้เจ้าหน้าที่ตรวจสอบ'}
								</p>
							</div>
						</svelte:element>
					{/each}
				</div>
			</section>

			<!-- The wrapper stays in place for Svelte's DOM bookkeeping; its child is moved to <body>. -->
			<div hidden>
				<div
					class="kiosk-print-area"
					aria-hidden="true"
					style:--label-width="{KIOSK_LABEL_MM.width}mm"
					style:--label-height="{KIOSK_LABEL_MM.height}mm"
					style:--label-padding="{KIOSK_LABEL_PADDING_MM}mm"
					style:--label-offset-x="{KIOSK_LABEL_OFFSET_X_MM}mm"
					style:--label-gap="{KIOSK_LABEL_GAP_MM}mm"
					{@attach mountOnBody}
				>
					{#each printableResults as result (result.evacuee_id)}
						{@const person = lookup?.members.find(
							(member) => member.evacuee_id === result.evacuee_id
						)}
						{@const qr = qrImages[result.evacuee_id]}
						<div class="wristband" style:--qr-size="{qr?.sizeMm ?? kioskQrBoxMm()}mm">
							<QrNameTag
								variant="label"
								class="gap-(--label-gap)"
								src={qr?.src}
								alt="QR ประจำตัวสำหรับใช้ภายในศูนย์"
								caption="ชื่อ"
								name={person ? fullName(person) : ''}
								detail="ศูนย์ {lookup?.shelter_code ?? ''}"
							/>
						</div>
					{/each}
				</div>
			</div>
		{/if}

		<p
			class={[
				'no-print flex items-center justify-center gap-2 text-sm text-slate-600',
				holdShown && 'kiosk-compact:hidden'
			]}
		>
			<ShieldCheck class="h-4 w-4 shrink-0 text-[#0A2647]" aria-hidden="true" />QR
			ไม่มีข้อมูลส่วนบุคคล
		</p>
	</div>
</section>

{#if printPhase !== 'idle'}
	<KioskPrintStatus phase={printPhase} count={printedCount} />
{/if}

<style>
	.kiosk-print-area {
		display: none;
	}

	/* Label size comes from domain/print-label.ts (CSS vars + generated @page in <svelte:head>). */
	@media print {
		:global(body) {
			margin: 0 !important;
		}
		:global(body > :not(.kiosk-print-area)) {
			display: none !important;
		}
		.kiosk-print-area {
			display: block;
		}
		.wristband {
			box-sizing: border-box;
			display: block;
			width: var(--label-width);
			height: var(--label-height);
			padding: var(--label-padding);
			translate: var(--label-offset-x) 0;
			overflow: hidden;
			break-after: page;
			break-inside: avoid;
			font-family: 'IBM Plex Sans Thai', sans-serif;
			color: #000;
		}
		.wristband:last-child {
			break-after: auto;
		}
	}
</style>
