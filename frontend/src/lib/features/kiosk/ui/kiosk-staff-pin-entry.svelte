<script lang="ts">
	import { onMount, tick } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { Button } from '$lib/components/ui/button/index.js';
	import { verifyKioskStaffPin, type KioskStaffPinResult } from '../data/kiosk-staff-pin.api';
	import KioskNumpadPanel from './kiosk-numpad-panel.svelte';

	/** Digits in a staff PIN. */
	const PIN_LENGTH = 6;
	const PIN_SLOTS = Array.from({ length: PIN_LENGTH }, (_, slot) => slot);
	/** Nobody touched the panel for this long: close it as if cancelled, so the kiosk is not stuck. */
	const STAFF_PIN_IDLE_MS = 30_000;

	interface Props {
		headingTag?: 'h1' | 'h2';
		/** The PIN was right: carry on (the panel has already forgotten it). */
		onverified: () => void;
		/** Cancel, Esc or 30 s without a touch. */
		oncancel: () => void;
		/** Checks the PIN with the server; replaced in tests. */
		verify?: (pin: string) => Promise<KioskStaffPinResult>;
	}

	let { headingTag = 'h1', onverified, oncancel, verify = verifyKioskStaffPin }: Props = $props();

	const id = $props.id();
	const titleId = `${id}-title`;

	type Status =
		| { kind: 'idle' }
		| { kind: 'checking' }
		| { kind: 'wrong' }
		/** No PIN set on this kiosk, or the server could not check it. */
		| { kind: 'blocked' };

	// Never in a URL, a log or storage; cleared on every way out.
	let pin = $state('');
	let status = $state<Status>({ kind: 'idle' });
	let closed = false;
	let idleTimer: ReturnType<typeof setTimeout> | null = null;
	let panel: HTMLElement | null = null;

	const keysDisabled = $derived(status.kind === 'checking' || status.kind === 'blocked');
	const canConfirm = $derived(pin.length === PIN_LENGTH && !keysDisabled);

	function touch(): void {
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = setTimeout(cancel, STAFF_PIN_IDLE_MS);
	}

	function close(): void {
		closed = true;
		pin = '';
		if (idleTimer) clearTimeout(idleTimer);
		idleTimer = null;
	}

	function cancel(): void {
		if (closed) return;
		close();
		oncancel();
	}

	async function confirm(): Promise<void> {
		if (!canConfirm) return;
		const entered = pin;
		status = { kind: 'checking' };
		const result = await verify(entered);
		if (closed) return; // cancelled, timed out or closed by the page meanwhile
		pin = '';
		switch (result.kind) {
			case 'verified':
				close();
				onverified();
				return;
			case 'wrong':
				status = { kind: 'wrong' };
				void refocusKeys();
				return;
			default:
				status = { kind: 'blocked' };
		}
	}

	/**
	 * A keyboard works wherever focus is: a focused key that gets disabled (6 digits in, or while
	 * checking) drops focus to the page, and the numpad only hears its own focused keys. Keys the
	 * numpad already handled arrive here default-prevented and are skipped.
	 */
	function handleWindowKeydown(event: KeyboardEvent): void {
		touch();
		if (event.key === 'Escape') {
			event.preventDefault();
			cancel();
			return;
		}
		if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
			return;
		}
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
		if (/^\d$/.test(event.key)) {
			event.preventDefault();
			if (!keysDisabled && pin.length < PIN_LENGTH) pin += event.key;
		} else if (event.key === 'Backspace') {
			event.preventDefault();
			if (!keysDisabled) pin = pin.slice(0, -1);
		} else if (event.key === 'Enter' && !target?.closest('button, a')) {
			// Enter on a focused button activates that button instead.
			event.preventDefault();
			void confirm();
		}
	}

	function focusFirstKey(node: HTMLElement): void {
		node.querySelector<HTMLButtonElement>('button[aria-label="ตัวเลข 1"]')?.focus();
	}

	/** Staff start on the keys: focus goes to digit 1 as the panel opens. */
	function attachPanel(node: HTMLElement): () => void {
		panel = node;
		focusFirstKey(node);
		return () => (panel = null);
	}

	/** The keys are usable again after a wrong PIN: put focus back on them. */
	async function refocusKeys(): Promise<void> {
		await tick();
		if (!closed && panel) focusFirstKey(panel);
	}

	onMount(() => {
		touch();
		return close;
	});
</script>

<svelte:window onkeydown={handleWindowKeydown} onpointerdown={touch} />

<div
	class="flex flex-col"
	data-testid="kiosk-staff-pin"
	data-pin-status={status.kind}
	{@attach attachPanel}
>
	<KioskNumpadPanel
		bind:value={pin}
		maxLength={PIN_LENGTH}
		disabled={keysDisabled}
		onsubmit={() => void confirm()}
		labelledby={titleId}
	>
		{#snippet header()}
			<header class="text-center">
				<svelte:element
					this={headingTag}
					id={titleId}
					class="text-2xl font-extrabold tracking-tight text-[#0A2647] kiosk-portrait:text-4xl kiosk-compact:text-xl"
					>สำหรับเจ้าหน้าที่</svelte:element
				>
				<p class="mt-1 text-base text-slate-700 kiosk-portrait:text-xl">
					ตรวจบัตรประชาชนกับตัวบุคคลแล้ว กรอก PIN 6 หลักเพื่อดำเนินการต่อ
				</p>
			</header>
		{/snippet}

		{#snippet display()}
			<output
				class="flex min-h-14 items-center justify-center gap-4 rounded-xl border border-slate-200 bg-white px-4 kiosk-portrait:min-h-20 kiosk-portrait:gap-6 kiosk-portrait:rounded-2xl kiosk-portrait:border-2"
				aria-label={`กรอก PIN แล้ว ${pin.length} จาก ${PIN_LENGTH} หลัก`}
				data-testid="kiosk-staff-pin-dots"
			>
				{#each PIN_SLOTS as slot (slot)}
					<span
						class={[
							'size-4 rounded-full border-2 kiosk-portrait:size-6',
							slot < pin.length ? 'border-[#0A2647] bg-[#0A2647]' : 'border-slate-300 bg-white'
						]}
						aria-hidden="true"
					></span>
				{/each}
			</output>
		{/snippet}

		{#snippet actions()}
			<Button
				type="button"
				disabled={!canConfirm}
				onclick={() => void confirm()}
				class="min-h-12 w-full gap-2 bg-[#0A2647] text-base font-bold text-white hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 kiosk-portrait:min-h-16 kiosk-portrait:text-xl"
			>
				{#if status.kind === 'checking'}
					<span
						class="inline-block size-5 animate-spin rounded-full border-2 border-white/40 border-t-white motion-reduce:animate-none"
						aria-hidden="true"
					></span>กำลังตรวจสอบ…
				{:else}
					ยืนยัน
				{/if}
			</Button>
			<Button
				type="button"
				variant="outline"
				onclick={cancel}
				class="min-h-12 w-full text-base font-bold focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 kiosk-portrait:min-h-16 kiosk-portrait:text-xl"
			>
				ยกเลิก
			</Button>
		{/snippet}

		{#snippet footer()}
			<div class="min-h-7" aria-live="polite" data-testid="kiosk-staff-pin-status">
				{#if status.kind === 'wrong'}
					<p
						class="flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-base font-semibold text-amber-900 kiosk-portrait:text-xl"
					>
						<CircleAlert class="size-5 shrink-0" aria-hidden="true" />
						PIN ไม่ถูกต้อง กรุณาลองใหม่
					</p>
				{:else if status.kind === 'blocked'}
					<p
						class="flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-base font-semibold text-amber-900 kiosk-portrait:text-xl"
					>
						<CircleAlert class="size-5 shrink-0" aria-hidden="true" />
						ยังข้ามขั้นตอนนี้ไม่ได้ กรุณาติดต่อผู้ดูแลระบบ
					</p>
				{/if}
			</div>
		{/snippet}
	</KioskNumpadPanel>
</div>
