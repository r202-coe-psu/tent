<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Printer from '@lucide/svelte/icons/printer';
	import Search from '@lucide/svelte/icons/search';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button/index.js';
	import { navigateToKioskHome } from '../application/kiosk-navigation';
	import { prepareKioskQrImage, printKioskQrLabels } from '../application/kiosk-label-print';
	import {
		ReprintSession,
		REPRINT_LAST4_LENGTH,
		REPRINT_PHONE_MAX_LENGTH,
		type ReprintSessionDeps
	} from '../application/reprint-session.svelte';
	import { lookupPreRegisteredEvacuee, reprintKioskLabels } from '../data/kiosk-check-in.api';
	import type { KioskContextQuery } from '../domain/display-context';
	import { formatPhoneForDisplay, phoneEntryHint } from '../domain/phone';
	import KioskBackButton from './kiosk-back-button.svelte';
	import KioskInlineAlert from './kiosk-inline-alert.svelte';
	import { KioskIdleTimeout, KIOSK_IDLE_TIMEOUT_MS } from './kiosk-idle-timeout.svelte.js';
	import type { KioskLabelSheetItem } from '../domain/kiosk-label-item';
	import KioskLabelSheet from './kiosk-label-sheet.svelte';
	import {
		KIOSK_NOTICE_PRIMARY_ACTION,
		KIOSK_NOTICE_SECONDARY_ACTION
	} from './kiosk-notice-actions';
	import KioskNoticePanel from './kiosk-notice-panel.svelte';
	import KioskNumpadPanel from './kiosk-numpad-panel.svelte';
	import KioskPrintStatus from './kiosk-print-status.svelte';
	import KioskStaffPinEntry from './kiosk-staff-pin-entry.svelte';
	import PhoneHouseholdPicker from './phone-household-picker.svelte';
	import ReprintMemberList from './reprint-member-list.svelte';

	interface Props {
		contextQuery: KioskContextQuery;
		/** Replaced in tests; the kiosk uses the real endpoints and printer. */
		deps?: Partial<ReprintSessionDeps>;
	}

	let { contextQuery, deps }: Props = $props();

	const LAST4_SLOTS = Array.from({ length: REPRINT_LAST4_LENGTH }, (_, slot) => slot);
	const PRIMARY_BUTTON =
		'min-h-12 w-full gap-2 bg-[#0A2647] text-base font-bold text-white hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 kiosk-portrait:min-h-16 kiosk-portrait:text-xl';

	/** Labels the browser prints when no scanner client answered; empty again once printing ends. */
	let sheetLabels = $state.raw<KioskLabelSheetItem[]>([]);

	async function printMembers(
		members: Parameters<ReprintSessionDeps['print']>[0]
	): ReturnType<ReprintSessionDeps['print']> {
		const images = await Promise.all(members.map((m) => prepareKioskQrImage(m.qr_payload)));
		sheetLabels = members.map((member, index) => ({
			key: member.evacuee_id,
			qrSrc: images[index].src,
			qrSizeMm: images[index].sizeMm,
			name: member.label.name,
			zone: member.label.zone,
			checkedCount: member.label.stations_passed
		}));
		try {
			return await printKioskQrLabels(
				members.map((member, index) => ({
					qrSrc: images[index].src,
					name: member.label.name,
					zone: member.label.zone,
					checkedCount: member.label.stations_passed
				})),
				async () => {
					// The sheet must be on the page before the browser prints it.
					await tick();
					await new Promise<void>((done) => requestAnimationFrame(() => done()));
					window.print();
				}
			);
		} finally {
			sheetLabels = [];
		}
	}

	const session = untrack(
		() =>
			new ReprintSession({
				lookup: (input) => lookupPreRegisteredEvacuee(input),
				reprint: (input) => reprintKioskLabels(input),
				print: printMembers,
				...deps
			})
	);
	const idleTimeout = new KioskIdleTimeout(KIOSK_IDLE_TIMEOUT_MS, returnHome);

	const printQrUrl = $derived(resolve(`/kiosk/print-qr${contextQuery}`));
	const reprintUrl = $derived(resolve(`/kiosk/reprint${contextQuery}`));
	const displayPhone = $derived(formatPhoneForDisplay(session.phone));
	const entryHint = $derived(phoneEntryHint(session.phone));
	const inFlow = $derived(session.step !== 'phone');
	// Not sent home while the labels come out; resuming restarts the idle countdown.
	const printing = $derived(session.step === 'printing');

	$effect(() => {
		idleTimeout.setPaused(printing);
	});

	onMount(() => {
		idleTimeout.start();
		return () => {
			idleTimeout.stop();
			session.reset();
		};
	});

	function returnHome(): void {
		session.reset();
		navigateToKioskHome(contextQuery);
	}

	function recordActivity(): void {
		idleTimeout.recordActivity();
	}
</script>

<svelte:head>
	<title>พิมพ์ QR — SmartShelter Kiosk</title>
</svelte:head>

<svelte:window onpointerdown={recordActivity} onkeydown={recordActivity} />

{#snippet errorLine()}
	<!-- Always in the page so a screen reader hears the message the moment it appears. -->
	<div class="min-h-7" aria-live="polite" role="status">
		{#if session.error}
			<KioskInlineAlert tone="warning" icon={CircleAlert} role="alert"
				>{session.error}</KioskInlineAlert
			>
		{/if}
	</div>
{/snippet}

{#if session.step === 'done'}
	<div class="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-4 py-3">
		<KioskNoticePanel
			tone="success"
			icon={CheckCircle2}
			title="พิมพ์ QR เรียบร้อย"
			headingTag="h1"
			role="status"
		>
			<p>รับ QR Code {session.printedCount} ดวงที่ช่องพิมพ์ แล้วไปที่จุดคัดกรอง</p>
			{#snippet actions()}
				<Button type="button" onclick={returnHome} class={KIOSK_NOTICE_PRIMARY_ACTION}
					>กลับหน้าแรก</Button
				>
			{/snippet}
		</KioskNoticePanel>
	</div>
{:else if session.step === 'print_failed'}
	<div class="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center gap-4 py-3">
		<KioskNoticePanel
			tone="warning"
			icon={CircleAlert}
			title="พิมพ์ไม่สำเร็จ"
			headingTag="h1"
			role="alert"
		>
			<p>{session.error} กดพิมพ์อีกครั้ง หรือติดต่อเจ้าหน้าที่</p>
			{#snippet actions()}
				<Button
					type="button"
					onclick={() => void session.retryPrint()}
					disabled={session.busy}
					class={KIOSK_NOTICE_PRIMARY_ACTION}><Printer aria-hidden="true" />พิมพ์อีกครั้ง</Button
				>
				<Button
					type="button"
					variant="outline"
					onclick={returnHome}
					class={KIOSK_NOTICE_SECONDARY_ACTION}>กลับหน้าแรก</Button
				>
			{/snippet}
		</KioskNoticePanel>
	</div>
{:else}
	<div
		class="reprint-page mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col gap-3"
		data-reprint-step={session.step}
	>
		<div class="no-print flex justify-start">
			{#if inFlow}
				<KioskBackButton
					href={reprintUrl}
					label="ย้อนกลับ"
					disabled={printing || session.busy}
					onclick={() => session.back()}
				/>
			{:else}
				<KioskBackButton href={printQrUrl} />
			{/if}
		</div>

		{#if session.step === 'phone'}
			<div class="flex min-h-0 flex-1 flex-col gap-3 kiosk-portrait:justify-start">
				<KioskNumpadPanel
					bind:value={session.phone}
					maxLength={REPRINT_PHONE_MAX_LENGTH}
					disabled={session.busy}
					onsubmit={() => void session.submitPhone()}
					labelledby="reprint-phone-title"
					class="kiosk-portrait:mt-4"
				>
					{#snippet header()}
						<header class="text-center">
							<h1
								id="reprint-phone-title"
								class="text-2xl font-extrabold tracking-tight text-[#0A2647] kiosk-portrait:text-4xl kiosk-compact:text-xl"
							>
								พิมพ์ QR
							</h1>
							<p class="mt-1 text-base text-slate-700 kiosk-portrait:text-xl">
								กรอกเบอร์โทรที่ลงทะเบียนไว้
							</p>
						</header>
					{/snippet}

					{#snippet display()}
						<output
							class={[
								'flex min-h-14 items-center justify-center rounded-xl border border-slate-200 bg-white px-4 text-2xl font-bold text-slate-950 tabular-nums kiosk-portrait:min-h-20 kiosk-portrait:rounded-2xl kiosk-portrait:border-2',
								displayPhone
									? 'kiosk-portrait:text-4xl'
									: 'kiosk-portrait:text-2xl kiosk-portrait:font-semibold kiosk-portrait:text-slate-400'
							]}
							aria-label="เบอร์โทรศัพท์ที่กรอก"
							aria-live="polite"
						>
							{displayPhone || 'เบอร์โทรศัพท์'}
						</output>
					{/snippet}

					{#snippet actions()}
						<Button
							type="button"
							disabled={!session.canSubmitPhone}
							onclick={() => void session.submitPhone()}
							class={PRIMARY_BUTTON}
						>
							{#if session.busy}
								<span
									class="inline-block size-5 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none"
									aria-hidden="true"
								></span>กำลังค้นหา…
							{:else}
								<Search class="h-5 w-5" aria-hidden="true" />ค้นหา
							{/if}
						</Button>
					{/snippet}

					{#snippet footer()}
						{#if session.error}
							{@render errorLine()}
						{:else}
							<p
								class="hidden min-h-7 text-center text-lg font-semibold text-amber-900 kiosk-portrait:block"
								aria-live="polite"
							>
								{entryHint ?? ''}
							</p>
							<p
								class="kiosk-numpad-panel-note text-center text-sm leading-snug text-slate-600 kiosk-portrait:text-lg"
							>
								ยังไม่เคยลงทะเบียน? ใช้ QR บัตรประชาชน หรือ ThaiD ที่หน้าแรก
							</p>
						{/if}
					{/snippet}
				</KioskNumpadPanel>
			</div>
		{:else if session.step === 'candidates'}
			<section class="no-print rounded-2xl border border-slate-200 bg-white p-4 shadow-2xs sm:p-6">
				<PhoneHouseholdPicker
					mode="reprint"
					candidates={session.candidates}
					disabled={session.busy}
					onselect={(primaryEvacueeId) => void session.chooseCandidate(primaryEvacueeId)}
				/>
			</section>
			{@render errorLine()}
		{:else if session.step === 'members'}
			{#if session.blocked}
				<KioskNoticePanel
					tone="warning"
					icon={CircleAlert}
					title="ยังไม่มี QR ให้พิมพ์"
					headingTag="h1"
					role="status"
				>
					<p>{session.blockedReason}</p>
					{#snippet actions()}
						<Button
							type="button"
							variant="outline"
							onclick={() => session.back()}
							class={KIOSK_NOTICE_SECONDARY_ACTION}>ย้อนกลับ</Button
						>
					{/snippet}
				</KioskNoticePanel>
			{:else}
				<ReprintMemberList
					members={session.members}
					selectedIds={session.selectedIds}
					allSelected={session.allSelected}
					disabled={session.busy}
					ontoggle={(id) => session.toggleMember(id)}
					ontoggleall={() => session.toggleAll()}
				/>
				<div class="no-print mx-auto w-full max-w-md">
					<Button
						type="button"
						disabled={!session.canContinue}
						onclick={() => session.continueToVerify()}
						class={PRIMARY_BUTTON}
					>
						<Printer class="h-5 w-5" aria-hidden="true" />ต่อไป · {session.selectedIds.length} คน
					</Button>
				</div>
			{/if}
		{:else if session.step === 'staff_pin'}
			<div
				class="flex min-h-0 flex-1 flex-col gap-3 kiosk-portrait:mt-4 kiosk-portrait:justify-start"
			>
				<KioskStaffPinEntry
					description="ตรวจบัตรประชาชนกับตัวบุคคลแล้ว กรอก PIN 6 หลักเพื่อพิมพ์ QR"
					verify={(pin) => session.verifyStaffPin(pin)}
					onverified={() => void session.onStaffPinVerified()}
					oncancel={() => session.cancelStaffPin()}
				/>
			</div>
		{:else}
			<!-- verify, and printing (the keys stay on screen behind the print status) -->
			<div class="flex min-h-0 flex-1 flex-col gap-3 kiosk-portrait:justify-start">
				<KioskNumpadPanel
					bind:value={session.idLast4}
					maxLength={REPRINT_LAST4_LENGTH}
					disabled={session.busy}
					onsubmit={() => void session.submitVerify()}
					labelledby="reprint-verify-title"
					class="kiosk-portrait:mt-4"
				>
					{#snippet header()}
						<header class="text-center">
							<h1
								id="reprint-verify-title"
								class="text-2xl font-extrabold tracking-tight text-[#0A2647] kiosk-portrait:text-4xl kiosk-compact:text-xl"
							>
								กรอกเลขบัตรประชาชน 4 ตัวท้ายของเจ้าของเบอร์
							</h1>
						</header>
					{/snippet}

					{#snippet display()}
						<output
							class="flex min-h-14 items-center justify-center gap-4 rounded-xl border border-slate-200 bg-white px-4 kiosk-portrait:min-h-20 kiosk-portrait:gap-6 kiosk-portrait:rounded-2xl kiosk-portrait:border-2"
							aria-label={`กรอกแล้ว ${session.idLast4.length} จาก ${REPRINT_LAST4_LENGTH} หลัก`}
						>
							{#each LAST4_SLOTS as slot (slot)}
								<span
									class={[
										'size-4 rounded-full border-2 kiosk-portrait:size-6',
										slot < session.idLast4.length
											? 'border-[#0A2647] bg-[#0A2647]'
											: 'border-slate-300 bg-white'
									]}
									aria-hidden="true"
								></span>
							{/each}
						</output>
					{/snippet}

					{#snippet actions()}
						<Button
							type="button"
							disabled={!session.canVerify}
							onclick={() => void session.submitVerify()}
							class={PRIMARY_BUTTON}
						>
							{#if session.busy}
								<span
									class="inline-block size-5 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none"
									aria-hidden="true"
								></span>กำลังตรวจสอบ…
							{:else}
								<KeyRound class="h-5 w-5" aria-hidden="true" />ยืนยันและพิมพ์
							{/if}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={session.busy}
							onclick={() => session.openStaffPin()}
							class="min-h-12 w-full text-base font-bold focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 kiosk-portrait:min-h-16 kiosk-portrait:text-xl"
						>
							ให้เจ้าหน้าที่ยืนยันด้วย PIN
						</Button>
					{/snippet}

					{#snippet footer()}
						{@render errorLine()}
					{/snippet}
				</KioskNumpadPanel>
			</div>
		{/if}
	</div>
{/if}

{#if sheetLabels.length > 0}
	<KioskLabelSheet labels={sheetLabels} />
{/if}
{#if printing}
	<KioskPrintStatus phase="printing" count={session.selectedIds.length} />
{/if}
