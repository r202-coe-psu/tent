<script lang="ts">
	import { onMount, tick, untrack } from 'svelte';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import { Button } from '$lib/components/ui/button/index.js';
	import { StaffPinEntry, STAFF_PIN_LENGTH } from '../application/staff-pin-entry.svelte';
	import { verifyKioskStaffPin, type KioskStaffPinResult } from '../data/kiosk-staff-pin.api';
	import KioskNumpadPanel from './kiosk-numpad-panel.svelte';

	const PIN_SLOTS = Array.from({ length: STAFF_PIN_LENGTH }, (_, slot) => slot);

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

	// Never in a URL, a log or storage; cleared on every way out.
	const entry = untrack(
		() =>
			new StaffPinEntry({
				verify: (pin) => verify(pin),
				onverified: () => onverified(),
				oncancel: () => oncancel(),
				onretry: () => void refocusKeys()
			})
	);
	let closed = false;
	let panel: HTMLElement | null = null;

	/**
	 * A keyboard works wherever focus is: a focused key that gets disabled (6 digits in, or while
	 * checking) drops focus to the page, and the numpad only hears its own focused keys. Keys the
	 * numpad already handled arrive here default-prevented and are skipped.
	 */
	function handleWindowKeydown(event: KeyboardEvent): void {
		entry.touch();
		if (event.key === 'Escape') {
			event.preventDefault();
			entry.press('Escape');
			return;
		}
		if (event.defaultPrevented || event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
			return;
		}
		const target = event.target instanceof Element ? event.target : null;
		if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
		// Enter on a focused button activates that button instead.
		if (event.key === 'Enter' && target?.closest('button, a')) return;
		if (entry.press(event.key)) event.preventDefault();
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

	/** The keys are usable again after a wrong PIN or a failed check: put focus back on them. */
	async function refocusKeys(): Promise<void> {
		await tick();
		if (!closed && panel) focusFirstKey(panel);
	}

	onMount(() => {
		entry.start();
		return () => {
			closed = true;
			entry.close();
		};
	});
</script>

<svelte:window onkeydown={handleWindowKeydown} onpointerdown={() => entry.touch()} />

<div
	class="flex flex-col"
	data-testid="kiosk-staff-pin"
	data-pin-status={entry.status.kind}
	{@attach attachPanel}
>
	<KioskNumpadPanel
		bind:value={entry.pin}
		maxLength={STAFF_PIN_LENGTH}
		disabled={entry.keysDisabled}
		onsubmit={() => void entry.confirm()}
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
				aria-label={`กรอก PIN แล้ว ${entry.pin.length} จาก ${STAFF_PIN_LENGTH} หลัก`}
				data-testid="kiosk-staff-pin-dots"
			>
				{#each PIN_SLOTS as slot (slot)}
					<span
						class={[
							'size-4 rounded-full border-2 kiosk-portrait:size-6',
							slot < entry.pin.length
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
				disabled={!entry.canConfirm}
				onclick={() => void entry.confirm()}
				class="min-h-12 w-full gap-2 bg-[#0A2647] text-base font-bold text-white hover:bg-[#051930] focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 kiosk-portrait:min-h-16 kiosk-portrait:text-xl"
			>
				{#if entry.status.kind === 'checking'}
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
				onclick={() => entry.cancel()}
				class="min-h-12 w-full text-base font-bold focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 kiosk-portrait:min-h-16 kiosk-portrait:text-xl"
			>
				ยกเลิก
			</Button>
		{/snippet}

		{#snippet footer()}
			<div class="min-h-7" aria-live="polite" data-testid="kiosk-staff-pin-status">
				{#if entry.status.kind === 'wrong'}
					<p
						class="flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-base font-semibold text-amber-900 kiosk-portrait:text-xl"
					>
						<CircleAlert class="size-5 shrink-0" aria-hidden="true" />
						PIN ไม่ถูกต้อง กรุณาลองใหม่
					</p>
				{:else if entry.status.kind === 'error'}
					<p
						class="flex items-center justify-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-base font-semibold text-amber-900 kiosk-portrait:text-xl"
					>
						<CircleAlert class="size-5 shrink-0" aria-hidden="true" />
						ตรวจสอบ PIN ไม่สำเร็จ กรุณาลองใหม่
					</p>
				{:else if entry.status.kind === 'blocked'}
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
