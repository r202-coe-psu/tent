<script lang="ts">
	import type { Snippet } from 'svelte';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import CreditCard from '@lucide/svelte/icons/credit-card';
	import Printer from '@lucide/svelte/icons/printer';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import UserCheck from '@lucide/svelte/icons/user-check';
	import UsersRound from '@lucide/svelte/icons/users-round';
	import { Button } from '$lib/components/ui/button/index.js';
	import KioskCheckInWizard from './kiosk-check-in-wizard.svelte';
	import KioskLookupErrorActions from './kiosk-lookup-error-actions.svelte';
	import PhoneHouseholdPicker from './phone-household-picker.svelte';
	import KioskLabelSheet from './kiosk-label-sheet.svelte';
	import KioskPrintStatus from './kiosk-print-status.svelte';
	import {
		initialReprintSelection,
		initialSelection,
		isAllSelected,
		toExistingReportResults,
		toggleAllSelection,
		canPrintQr,
		isQrIssueFailed
	} from '../domain/household-selection';
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
	import {
		prepareKioskQrImage,
		printKioskQrLabels,
		type KioskQrImage,
		type KioskQrLabel
	} from '../application/kiosk-label-print';
	import { KIOSK_CHECK_IN_TICKS } from '../domain/print-label';
	import { buildKioskPhotoPayload } from '../application/kiosk-card-photo';
	import KioskBackButton from './kiosk-back-button.svelte';
	import { languageStore } from '$lib/stores/language.svelte';
	import { getTranslation } from '$lib/utils/i18n';
	import { KIOSK_QR_FLOW_I18N } from './_constants/kiosk-qr-flow.i18n';
	import KioskWalkInOffer from './kiosk-walk-in-offer.svelte';
	import KioskNoticePanel from './kiosk-notice-panel.svelte';
	import {
		KIOSK_NOTICE_PRIMARY_ACTION,
		KIOSK_NOTICE_SECONDARY_ACTION
	} from './kiosk-notice-actions';

	// A primary button beside secondary ones (confirm, print QR): same height and text, only the colour differs.
	const INLINE_PRIMARY_SIZE =
		'min-h-14 text-lg kiosk-portrait:min-h-20 kiosk-portrait:text-2xl kiosk-compact:min-h-12 kiosk-compact:text-base [&_svg]:size-5! kiosk-portrait:[&_svg]:size-7!';
	import type { KioskContextQuery } from '../domain/display-context';

	interface Props {
		input: GateInput | null;
		contextQuery: KioskContextQuery;
		displayShelterCode: string;
		cardMode?: boolean;
		backHref?: string;
		onprintbusychange?: (busy: boolean) => void;
		/** Walk-in registration, offered after a card or ThaiD miss: who to register. */
		onregister?: (
			identity: Extract<GateInput, { source: 'smart-card' } | { source: 'thaid' }>
		) => void;
		onreset: () => void;
		/** ThaiD only: scan again with a new QR once the verified session can no longer be used. */
		onrescan?: () => void;
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
		onrescan,
		holdMembers = false,
		hold,
		cardPhoto = null
	}: Props = $props();

	const t = $derived(getTranslation(KIOSK_QR_FLOW_I18N, languageStore.current).checkIn);

	let lookup = $state<Extract<KioskLookupResponse, { kind: 'household' }> | null>(null);
	/** When the current `lookup` succeeded (ISO) — sent with the check-in as the Station 1 start (CR-192). */
	let lookupAt = '';
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
	let qrImages = $state<Record<string, KioskQrImage>>({});
	/** The payload each cached `qrImages` entry was drawn from: a new QR (reissue) must redraw. */
	let qrImagePayloads: Record<string, string> = {};
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
	/** No pre-registration for this card / ThaiD scan, and this shelter takes walk-ins at the kiosk. */
	const walkInOffered = $derived(
		Boolean(lookupError) &&
			canRegister &&
			(input?.source === 'smart-card' || input?.source === 'thaid') &&
			Boolean(onregister)
	);
	/** No pre-registration and the kiosk may not register this card / ThaiD scan (FR-KWR-40). */
	const walkInClosed = $derived(
		lookupErrorCode === 'PRE_REGISTRATION_NOT_FOUND' &&
			!canRegister &&
			(input?.source === 'smart-card' || input?.source === 'thaid')
	);
	/** Members that have (or can be reissued) a QR to print; never a `qr_issue_failed` one (FR-EQR-24). */
	const successfulResults = $derived(results.filter((result) => canPrintQr(result)));
	/** Members whose QR entry failed: not printed, the visitor may retry or ask staff. */
	const qrFailedResults = $derived(results.filter((result) => isQrIssueFailed(result)));
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
				result.qr_payload ||
				result.qr_issue_failed
		)
	);
	/** Card face check (hold) or ThaiD: step 3 is proving who is at the kiosk, not a plain lookup. */
	const verifiesIdentity = $derived((holdMembers && Boolean(hold)) || isThaidGate);
	// The face check runs after the lookup, so the members (step 4) only count once it has ended.
	const wizardStep = $derived(
		results.length > 0
			? 5
			: candidates.length > 0 || lookupError || isLookingUp || (lookup && holdMembers && hold)
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
	const allSelected = $derived(isAllSelected(selectedIds, lookup?.members ?? []));

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
				lookupError = t.errors.centerMismatch;
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
			lookupAt = new Date().toISOString();
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
				lookupError = error instanceof Error ? error.message : t.errors.lookupFailed;
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

	function toggleAllMembers(): void {
		if (!lookup || isSubmitting) return;
		selectedIds = toggleAllSelection(selectedIds, lookup.members);
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
				lookupAt,
				...(isThaidGate ? thaidOptions() : await cardPhotoOptions())
			});
			thaidSessionSpent = true;
			results = mergeCheckInResults(results, response.members);
			retryableIds = response.retryable_evacuee_ids;
			if (retryableIds.length > 0) {
				actionError = t.errors.partialFailure;
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
				actionError = error instanceof Error ? error.message : t.errors.checkInFailed;
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
		const nextImages: Record<string, KioskQrImage> = { ...qrImages };
		try {
			for (const item of items) {
				if (!item.qr_payload) continue;
				if (nextImages[item.evacuee_id] && qrImagePayloads[item.evacuee_id] === item.qr_payload) {
					continue;
				}
				nextImages[item.evacuee_id] = await prepareKioskQrImage(item.qr_payload);
				qrImagePayloads[item.evacuee_id] = item.qr_payload;
			}
			if (generation !== undefined && generation !== lookupGeneration) return false;
			qrImages = nextImages;
			return true;
		} catch {
			if (generation !== undefined && generation !== lookupGeneration) return false;
			qrImages = nextImages;
			printError = t.errors.qrPrepareFailed;
			return false;
		}
	}

	/**
	 * Ask /check-in for a fresh QR + the unmasked label text of these members. A lookup carries
	 * neither; arriving members are not written again, only reissued a QR (CR-233 FR-EQR-23).
	 */
	async function fetchFreshQr(ids: string[]): Promise<boolean> {
		if (ids.length === 0) return true;
		if (!lookup) return false;
		printError = '';
		try {
			const response = await checkInSelectedMembers(lookup.primary_evacuee_id, ids, {
				batchLimit: 20
			});
			results = mergeCheckInResults(results, response.members);
			return true;
		} catch (error) {
			if (error instanceof KioskPartialCheckInError) {
				results = mergeCheckInResults(results, error.result.members);
			}
			printError = t.errors.labelDataFailed;
			return false;
		}
	}

	/**
	 * Reprint: every print command issues a new QR (FR-EQR-21), so these always refetch. A fresh
	 * check-in already holds its QR and only lacks the label text when it came from a lookup.
	 */
	function loadMissingLabels(items: KioskCheckInMemberResult[]): Promise<boolean> {
		return fetchFreshQr(
			items
				.filter((item) => isReprintOnly || !item.qr_payload || !item.label)
				.map((item) => item.evacuee_id)
		);
	}

	/** Try again to issue the QR of the members it failed for; nothing is printed here. */
	async function retryQrIssue(): Promise<void> {
		if (printBusy || isSubmitting) return;
		isSubmitting = true;
		try {
			if (await fetchFreshQr(qrFailedResults.map((result) => result.evacuee_id))) {
				await prepareQrImages(results);
			}
		} finally {
			isSubmitting = false;
		}
	}

	async function printWristbands(): Promise<void> {
		if (printableResults.length === 0 || printBusy) return;
		printBusy = true;
		onprintbusychange?.(true);
		try {
			if (!(await loadMissingLabels(printableResults))) return;
			// Re-read: a member who moved past arriving since the lookup has no QR to reprint any more.
			// A member whose QR could not be issued is never printed (FR-EQR-24).
			const toPrint = printableResults.filter((result) => result.qr_payload);
			if (toPrint.length === 0) return;
			if (!(await prepareQrImages(toPrint))) return;
			let labels: KioskQrLabel[];
			try {
				labels = toLabels(toPrint);
			} catch {
				printError = t.errors.labelRenderFailed;
				return;
			}
			printedCount = toPrint.length;
			printPhase = 'printing';
			// No scanner client (dev browser / browser print mode): print the CSS labels instead.
			const result = await printKioskQrLabels(
				labels,
				async () => {
					await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
					window.print();
				},
				languageStore.current
			);
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

	function toLabels(items: KioskCheckInMemberResult[]): KioskQrLabel[] {
		return items.map((result) => {
			const person = lookup?.members.find((member) => member.evacuee_id === result.evacuee_id);
			const qr = qrImages[result.evacuee_id];
			if (!qr) throw new Error('QR image missing');
			return {
				qrSrc: qr.src,
				name: labelName(result, person),
				emergencyPhone: result.label?.emergency_phone,
				checkedCount: KIOSK_CHECK_IN_TICKS
			};
		});
	}

	function fullName(
		member: Pick<KioskEvacueeSummary, 'first_name' | 'last_name'>,
		fallback: string
	): string {
		return [member.first_name, member.last_name].filter(Boolean).join(' ') || fallback;
	}

	/** The printed label carries the unmasked name from /check-in; the screen keeps the masked one. */
	function labelName(result: KioskCheckInMemberResult, person?: KioskEvacueeSummary): string {
		// The label is a printout: its fallback stays Thai whatever language the screen is in.
		return (
			result.label?.name || (person ? fullName(person, KIOSK_QR_FLOW_I18N.th.checkIn.noName) : '')
		);
	}

	function statusLabel(status: string): string {
		return status in t.status && status !== 'unknown'
			? t.status[status as keyof typeof t.status]
			: t.status.unknown;
	}
</script>

<svelte:head>
	<title>{t.pageTitle}</title>
</svelte:head>

<section
	class="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-3"
	aria-labelledby="check-in-title"
>
	<KioskCheckInWizard
		currentStep={wizardStep}
		step2Label={isThaidGate ? t.stepThaid : undefined}
		step3Label={verifiesIdentity ? t.stepVerify : undefined}
	/>
	<div class="no-print flex justify-start">
		<KioskBackButton
			href={backUrl}
			onclick={isPhoneGate ? onreset : undefined}
			label={isPhoneGate ? t.backToPhone : undefined}
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
					? t.title.notPreRegistered
					: alreadyKioskRegistered
						? t.title.alreadyKioskRegistered
						: lookupError
							? t.title.lookupFailed
							: results.length > 0
								? t.title.results
								: candidates.length > 0
									? t.title.chooseHousehold
									: lookup
										? holdMembers
											? t.title.verifyIdentity
											: t.title.chooseMembers
										: cardMode && !input
											? t.title.waitingForCard
											: t.title.searching}
			</h1>
			{#if cardMode && !input}
				<p class="mt-1 text-base text-slate-700 kiosk-portrait:mt-2 kiosk-portrait:text-xl">
					{t.sub.insertCard}
				</p>
			{:else if lookup && results.length === 0 && !holdMembers}
				<p class="mt-1 text-base text-slate-700 kiosk-portrait:mt-2 kiosk-portrait:text-xl">
					{t.sub.chooseArrived}
				</p>
			{:else if candidates.length > 0}
				<p class="mt-1 text-base text-slate-700 kiosk-portrait:mt-2 kiosk-portrait:text-xl">
					{t.sub.chooseHousehold}
				</p>
			{:else if isReprintOnly && successfulResults.length > 0}
				<p class="mt-1 text-base text-slate-700 kiosk-portrait:mt-2 kiosk-portrait:text-xl">
					{t.sub.reprintFound}
				</p>
			{:else if results.some((result) => result.status === 'already_checked_in')}
				<p class="mt-1 text-base text-slate-700 kiosk-portrait:mt-2 kiosk-portrait:text-xl">
					{t.sub.alreadyFound}
				</p>
			{:else if results.length > 0}
				<p class="mt-1 text-base text-slate-700 kiosk-portrait:mt-2 kiosk-portrait:text-xl">
					{t.sub.reviewThenPrint}
				</p>
			{/if}
		</header>

		{#if cardMode && !input}
			<div
				class="no-print flex min-h-20 items-center justify-center gap-3 rounded-xl border border-slate-200 bg-white text-lg font-semibold text-slate-700 sm:text-xl kiosk-portrait:min-h-24 kiosk-portrait:text-3xl kiosk-compact:min-h-16"
				role="status"
				aria-live="polite"
			>
				<CreditCard
					class="size-6 text-[#0A2647] kiosk-portrait:size-8"
					aria-hidden="true"
				/>{t.waitingForCard}
			</div>
		{/if}

		{#if isLookingUp}
			<div
				class="no-print flex min-h-24 items-center justify-center gap-4 rounded-2xl border border-slate-200 bg-white text-lg font-semibold text-slate-700 shadow-2xs sm:text-xl kiosk-portrait:min-h-28 kiosk-portrait:text-3xl kiosk-compact:min-h-16"
				role="status"
			>
				<span
					class="size-7 animate-spin rounded-full border-[3px] border-slate-300 border-t-[#0A2647] motion-reduce:animate-none kiosk-portrait:size-8"
					aria-hidden="true"
				></span>
				{t.searchingData}
			</div>
		{/if}

		{#if walkInOffered}
			<KioskWalkInOffer
				source={input?.source === 'thaid' ? 'thaid' : 'smart-card'}
				{isLookingUp}
				{retryAfterSeconds}
				onretry={retryLookup}
				onregister={() => {
					if (input?.source === 'smart-card' || input?.source === 'thaid') onregister?.(input);
				}}
			/>
		{:else if walkInClosed}
			<KioskNoticePanel
				tone="warning"
				icon={CircleAlert}
				title={t.walkInClosed.title}
				role="alert"
				data-testid="kiosk-walk-in-closed"
			>
				<p>{t.walkInClosed.body}</p>
				{#snippet actions()}
					<KioskLookupErrorActions
						{lookupErrorCode}
						{isPhoneGate}
						{isThaidGate}
						walkInClosed
						{isLookingUp}
						{retryAfterSeconds}
						{homeUrl}
						{backUrl}
						onretry={retryLookup}
						{onreset}
						{onrescan}
					/>
				{/snippet}
			</KioskNoticePanel>
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
						{onrescan}
					/>
				{/snippet}
			</KioskNoticePanel>
		{/if}

		{#if alreadyKioskRegistered}
			<KioskNoticePanel tone="warning" icon={UserCheck} title={t.alreadyKiosk.title} role="status">
				{#if isThaidGate}
					<p>{t.alreadyKiosk.bodyThaid}</p>
				{:else}
					<p>{t.alreadyKiosk.bodyCard}</p>
				{/if}
				{#snippet actions()}
					<Button type="button" onclick={onreset} class={KIOSK_NOTICE_PRIMARY_ACTION}
						>{t.alreadyKiosk.home}</Button
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
				<div class="mb-4 flex items-center gap-3 kiosk-portrait:mb-6 kiosk-portrait:gap-5">
					<div
						class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#F0F4F8] text-[#0A2647] kiosk-portrait:h-20 kiosk-portrait:w-20 kiosk-compact:h-11 kiosk-compact:w-11"
						aria-hidden="true"
					>
						<UsersRound class="size-6 kiosk-portrait:size-10" />
					</div>
					<div class="min-w-0 flex-1">
						<h2
							id="household-title"
							class="text-lg font-bold text-slate-900 sm:text-xl kiosk-portrait:text-3xl"
						>
							{t.members.heading}
						</h2>
						<p class="text-base text-slate-600 kiosk-portrait:text-xl">
							{t.members.shelter(lookup.shelter_code)}
						</p>
					</div>
					{#if selectableMemberCount > 1}
						<Button
							type="button"
							variant="outline"
							disabled={isSubmitting}
							onclick={toggleAllMembers}
							class="{KIOSK_NOTICE_SECONDARY_ACTION} w-auto shrink-0 kiosk-portrait:px-10"
						>
							{allSelected ? t.members.clearAll : t.members.selectAll}
						</Button>
					{/if}
				</div>
				{#if lookup.name_masked}
					<p
						class="mb-4 rounded-lg bg-sky-50 px-3 py-2 text-base font-medium text-sky-950 kiosk-portrait:mb-5 kiosk-portrait:px-4 kiosk-portrait:py-3 kiosk-portrait:text-xl kiosk-compact:text-sm"
					>
						{t.members.nameMasked}
					</p>
				{/if}

				<div class="space-y-3 kiosk-portrait:space-y-4">
					{#each lookup.members as member (member.evacuee_id)}
						{@const selected = selectedIds.includes(member.evacuee_id)}
						{@const locked = isSubmitting}
						<!-- The whole row is the tap target: the label forwards taps to the checkbox. -->
						<label
							class={[
								'flex min-h-20 items-center gap-4 rounded-xl border-2 px-4 py-3 kiosk-portrait:min-h-24 kiosk-portrait:gap-5 kiosk-portrait:px-6 kiosk-compact:min-h-16 kiosk-compact:py-2',
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
									class="size-12 shrink-0 kiosk-compact:size-10"
								/>
							{:else}
								<span class="size-12 shrink-0 kiosk-compact:size-10" aria-hidden="true"></span>
							{/if}
							<div class="min-w-0 flex-1">
								<p
									id={`member-name-${member.evacuee_id}`}
									class="truncate text-lg font-bold text-slate-950 sm:text-xl kiosk-portrait:text-2xl kiosk-compact:text-lg"
								>
									{fullName(member, t.noName)}
									{#if input?.source === 'phone' ? member.phone_matched : member.is_primary}<span
											class="ml-2 rounded-full bg-[#F0F4F8] px-2 py-1 text-sm font-bold text-[#0A2647] kiosk-portrait:px-3 kiosk-portrait:text-lg kiosk-compact:text-xs"
											>{input?.source === 'phone'
												? t.members.phoneMatch
												: t.members.registrant}</span
										>{/if}
								</p>
								<p
									class="mt-1 text-base text-slate-600 kiosk-portrait:mt-2 kiosk-portrait:text-xl kiosk-compact:text-sm"
								>
									{member.age === null ? t.members.ageUnknown : t.members.age(member.age)}
									<span class="mx-1" aria-hidden="true">·</span>{statusLabel(member.status)}
								</p>
							</div>
						</label>
					{/each}
				</div>

				{#if selectedMembers.length > 0 && selectedMembers.length < selectableMemberCount}
					<p
						class="mt-4 text-base leading-relaxed text-slate-600 kiosk-portrait:mt-5 kiosk-portrait:text-xl kiosk-compact:text-sm"
					>
						{t.members.selectedNote(selectedMembers.length)}
					</p>
				{/if}

				{#if actionError}
					<p
						class="mt-4 rounded-lg border border-rose-200 bg-rose-50 p-3 text-base font-semibold text-rose-900 kiosk-portrait:mt-5 kiosk-portrait:p-4 kiosk-portrait:text-xl kiosk-compact:text-sm"
						role="alert"
					>
						{actionError}
					</p>
				{/if}

				<div
					class="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end kiosk-portrait:mt-8 kiosk-portrait:gap-4"
				>
					<Button
						type="button"
						variant="outline"
						onclick={onreset}
						class="{KIOSK_NOTICE_SECONDARY_ACTION} sm:w-auto sm:px-10 kiosk-portrait:px-14"
						>{t.members.cancel}</Button
					>
					<Button
						type="button"
						disabled={!centerMatches || selectedIds.length === 0 || isSubmitting}
						onclick={submitCheckIn}
						class="{KIOSK_NOTICE_PRIMARY_ACTION} {INLINE_PRIMARY_SIZE} sm:w-auto"
					>
						{#if isSubmitting}<span
								class="size-5 animate-spin rounded-full border-2 border-white/40 border-t-white kiosk-portrait:size-6"
								aria-hidden="true"
							></span>{t.members.saving}{:else}<CheckCircle2
								aria-hidden="true"
							/>{t.members.confirm(selectedIds.length)}{/if}
					</Button>
				</div>
				{#if !centerMatches}<p
						class="mt-3 text-base font-semibold text-rose-800 kiosk-portrait:mt-4 kiosk-portrait:text-xl kiosk-compact:text-sm"
						role="alert"
					>
						{t.members.centerMismatch}
					</p>{/if}
			</section>
		{/if}

		{#if results.length > 0}
			<section
				class="no-print rounded-2xl border border-emerald-200 bg-white p-5 shadow-2xs sm:p-7 kiosk-portrait:p-8 kiosk-compact:p-4"
				aria-labelledby="result-title"
				aria-live="polite"
			>
				<div
					class="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-start sm:justify-between kiosk-portrait:gap-8"
				>
					<div class="flex min-w-0 flex-1 items-start gap-3 sm:basis-sm kiosk-portrait:gap-5">
						<div
							class="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-800 kiosk-portrait:h-20 kiosk-portrait:w-20 kiosk-compact:h-11 kiosk-compact:w-11"
							aria-hidden="true"
						>
							<CheckCircle2 class="size-6 kiosk-portrait:size-10" />
						</div>
						<div>
							<h2
								id="result-title"
								class="text-lg font-bold text-[#0A2647] sm:text-xl kiosk-portrait:text-3xl"
							>
								{retryableIds.length > 0
									? t.results.partial
									: results.some((result) => result.status === 'already_checked_in')
										? t.results.reported
										: successfulResults.length > 0 || qrFailedResults.length > 0
											? t.results.saved
											: t.results.none}
							</h2>
							<p
								class="mt-1 text-base leading-relaxed text-slate-700 kiosk-portrait:mt-2 kiosk-portrait:text-xl"
							>
								{#if retryableIds.length > 0}
									{t.results.summaryPartial(
										reportedResults.length,
										retryableIds.length,
										lookup?.shelter_code ?? ''
									)}
								{:else}
									{t.results.summaryAll(
										reportedResults.length,
										results.length,
										lookup?.shelter_code ?? ''
									)}
								{/if}
							</p>
							{#if lookup?.name_masked}
								<p
									class="mt-2 text-base font-medium text-slate-700 kiosk-portrait:mt-3 kiosk-portrait:text-xl"
								>
									{t.members.nameMasked}
								</p>
							{/if}
						</div>
					</div>
					<div class="flex flex-col gap-2 sm:ml-auto sm:flex-row kiosk-portrait:gap-4">
						{#if retryableIds.length > 0}
							<Button
								type="button"
								disabled={!centerMatches || isSubmitting || printBusy}
								variant="outline"
								onclick={() => void submitCheckInIds(retryableIds)}
								class="{KIOSK_NOTICE_SECONDARY_ACTION} sm:w-auto"
							>
								{isSubmitting ? t.results.saving : t.results.retryRemaining(retryableIds.length)}
							</Button>
						{/if}
						<Button
							type="button"
							disabled={printableResults.length === 0 || printBusy || isSubmitting}
							onclick={printWristbands}
							class="{KIOSK_NOTICE_PRIMARY_ACTION} {INLINE_PRIMARY_SIZE} sm:w-auto"
						>
							<Printer aria-hidden="true" />{printBusy || isSubmitting
								? t.results.preparingQr
								: isReprintOnly
									? t.results.printQrCount(printableResults.length)
									: t.results.printQr}
						</Button>
						<Button
							type="button"
							variant="outline"
							onclick={onreset}
							class="{KIOSK_NOTICE_SECONDARY_ACTION} sm:w-auto">{t.results.done}</Button
						>
					</div>
				</div>
				{#if actionError}
					<p
						class="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-base font-semibold text-amber-950 kiosk-portrait:mt-5 kiosk-portrait:p-4 kiosk-portrait:text-xl kiosk-compact:text-sm"
						role="alert"
					>
						{actionError}
					</p>
				{/if}
				{#if qrFailedResults.length > 0}
					<div
						class="mt-3 flex flex-col gap-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-base font-semibold text-amber-950 sm:flex-row sm:items-center kiosk-portrait:mt-5 kiosk-portrait:p-4 kiosk-portrait:text-xl kiosk-compact:text-sm"
						role="alert"
					>
						<p class="flex-1">
							{t.results.qrIssueFailed(qrFailedResults.length)}
						</p>
						<Button
							type="button"
							variant="outline"
							disabled={isSubmitting || printBusy}
							onclick={() => void retryQrIssue()}
							class="{KIOSK_NOTICE_SECONDARY_ACTION} sm:w-auto">{t.results.retryQrIssue}</Button
						>
					</div>
				{/if}
				{#if printError}<p
						class="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-base font-semibold text-amber-950 kiosk-portrait:mt-5 kiosk-portrait:p-4 kiosk-portrait:text-xl kiosk-compact:text-sm"
						role="alert"
					>
						{t.errors.printHint(printError)}
					</p>{/if}
				<div class="mt-5 space-y-3 kiosk-portrait:mt-8 kiosk-portrait:space-y-4">
					{#each results as result (result.evacuee_id)}
						{@const person = lookup?.members.find(
							(member) => member.evacuee_id === result.evacuee_id
						)}
						<svelte:element
							this={isReprintOnly && canPrintQr(result) ? 'label' : 'div'}
							class="flex items-center gap-3 rounded-xl border kiosk-portrait:min-h-24 kiosk-portrait:gap-5 kiosk-portrait:px-6 {isReprintOnly &&
							result.qr_payload
								? 'cursor-pointer'
								: ''} {!isQrIssueFailed(result) &&
							(result.qr_payload || result.status === 'already_checked_in')
								? 'border-emerald-200 bg-emerald-50'
								: 'border-amber-200 bg-amber-50'} p-4 kiosk-compact:p-3"
						>
							{#if isReprintOnly && canPrintQr(result)}<Checkbox
									checked={printSelectedIds.includes(result.evacuee_id)}
									onCheckedChange={(checked) => togglePrint(result.evacuee_id, checked)}
									disabled={printBusy}
									aria-labelledby={`result-name-${result.evacuee_id}`}
									aria-describedby={`result-status-${result.evacuee_id}`}
									class="size-12 shrink-0 bg-white kiosk-compact:size-10"
								/>{:else if isReprintOnly}<span class="size-12 shrink-0" aria-hidden="true"
								></span>{:else if !isQrIssueFailed(result) && (result.qr_payload || result.status === 'already_checked_in')}<CheckCircle2
									class="size-6 shrink-0 text-emerald-800 kiosk-portrait:size-8"
									aria-hidden="true"
								/>{:else}<CircleAlert
									class="size-6 shrink-0 text-amber-800 kiosk-portrait:size-8"
									aria-hidden="true"
								/>{/if}
							<div class="min-w-0 flex-1">
								<p
									id={`result-name-${result.evacuee_id}`}
									class="truncate text-lg font-bold text-slate-950 sm:text-xl kiosk-portrait:text-2xl kiosk-compact:text-base"
								>
									{person ? fullName(person, t.noName) : result.evacuee_id}
								</p>
								<p
									id={`result-status-${result.evacuee_id}`}
									class="mt-1 text-base text-slate-700 kiosk-portrait:mt-2 kiosk-portrait:text-xl kiosk-compact:text-sm"
								>
									{isQrIssueFailed(result)
										? t.results.rowQrIssueFailed
										: result.status === 'checked_in'
											? t.results.rowCheckedIn
											: canPrintQr(result)
												? t.results.rowReprintable
												: result.status === 'already_checked_in'
													? statusLabel(result.stay_status ?? 'unknown')
													: t.results.rowFailed}
								</p>
							</div>
						</svelte:element>
					{/each}
				</div>
			</section>

			<KioskLabelSheet
				labels={printableResults
					.filter((result) => result.qr_payload)
					.map((result) => ({
						key: result.evacuee_id,
						qrSrc: qrImages[result.evacuee_id]?.src,
						qrSizeMm: qrImages[result.evacuee_id]?.sizeMm,
						name: labelName(
							result,
							lookup?.members.find((member) => member.evacuee_id === result.evacuee_id)
						),
						emergencyPhone: result.label?.emergency_phone,
						checkedCount: KIOSK_CHECK_IN_TICKS
					}))}
			/>
		{/if}

		<p
			class={[
				'no-print flex items-center justify-center gap-2 text-base text-slate-600 kiosk-portrait:gap-3 kiosk-portrait:text-xl kiosk-compact:text-sm',
				holdShown && 'kiosk-compact:hidden'
			]}
		>
			<ShieldCheck
				class="size-4 shrink-0 text-[#0A2647] kiosk-portrait:size-6"
				aria-hidden="true"
			/>{t.qrNoPersonalData}
		</p>
	</div>
</section>

{#if printPhase !== 'idle'}
	<KioskPrintStatus phase={printPhase} count={printedCount} />
{/if}
