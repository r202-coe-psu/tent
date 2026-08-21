<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Download from '@lucide/svelte/icons/download';
	import QRCode from 'qrcode';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { downloadElementAsPdf } from '$lib/utils/pdf';
	import type { BookingTicket } from '../application/booking-store.svelte';

	interface Props {
		ticket: BookingTicket;
		/** Shown on the confirmation step; hidden when the ticket is re-opened from lookup. */
		showSuccessHeader?: boolean;
	}

	const { ticket, showSuccessHeader = true }: Props = $props();

	/** Falls back to whichever half exists, so a blank never renders as a stray space. */
	const fullName = $derived([ticket.first_name, ticket.last_name].filter(Boolean).join(' '));

	/** The QR block — the only part that goes on paper (see the @media print rules). */
	let ticketEl = $state<HTMLElement | null>(null);
	let downloading = $state(false);

	// The QR carries only the booking code — no name, no phone, no health data
	// (CR-070: ไม่ expose medical/national ID บน public ticket). It is the same
	// payload the staff card encodes, so the gate scanner resolves it unchanged.
	// Derived rather than an $effect so the image simply follows the ticket.
	const qrPromise = $derived(
		QRCode.toDataURL(`evacuee:${ticket.code}`, {
			width: 384,
			margin: 1,
			color: { dark: '#0f172a', light: '#ffffff' }
		})
	);

	const bookedAt = $derived.by(() => {
		if (!ticket.booked_at) return '';
		const d = new Date(ticket.booked_at);
		return Number.isNaN(d.getTime())
			? ''
			: d.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
	});

	/**
	 * Save the ticket straight to the device as `preregister-<code>.pdf` (mirroring
	 * the `evacuee-id-<id>` filename convention of the onsite QR card).
	 *
	 * Deliberately a download, not `window.print()` and not the preview tab the
	 * staff QR card opens: a citizen on a phone at a shelter gate wants the file in
	 * their downloads, not a print dialog to dismiss or a popup their browser may
	 * block. Only the QR block is rasterized, matching what the print stylesheet
	 * below isolates — the QR plus the booking code as a human-readable fallback.
	 */
	async function downloadTicket() {
		if (!ticketEl || downloading) return;
		downloading = true;
		try {
			await downloadElementAsPdf(ticketEl, `preregister-${ticket.code}`);
		} catch {
			toast.error('ดาวน์โหลดใบจองไม่สำเร็จ กรุณาลองใหม่อีกครั้ง');
		} finally {
			downloading = false;
		}
	}

	const statusLabel = $derived(
		ticket.status === 'pre_registered'
			? 'Pre-registered'
			: ticket.status === 'active'
				? 'เช็คอินเข้าศูนย์แล้ว'
				: ticket.status === 'cancelled'
					? 'การจองถูกยกเลิก'
					: ticket.status
	);
</script>

<div class="space-y-4">
	{#if showSuccessHeader}
		<div
			class="flex items-start gap-3 rounded-2xl border border-success/30 bg-success-muted/40 p-4"
		>
			<CircleCheck class="mt-0.5 h-5 w-5 shrink-0 text-success" />
			<div>
				<p class="text-sm font-bold text-foreground">จองเข้าศูนย์สำเร็จ</p>
				<p class="mt-0.5 text-xs text-muted-foreground">
					ระบบกันที่ให้ท่านแล้ว กรุณาบันทึกหรือพิมพ์ใบจองนี้ไว้แสดงที่ประตูศูนย์
				</p>
			</div>
		</div>
	{/if}

	<div
		class="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-black/[0.04] bg-card shadow-sm print:border-0 print:shadow-none"
	>
		<div class="bg-primary-dark px-6 py-4 text-center text-white">
			<p class="mt-1 text-base font-bold">{ticket.shelter_name}</p>
			<p class="text-xs opacity-80">รหัสศูนย์ {ticket.shelter_code}</p>
		</div>

		<!--
			Printable target: only this block should end up on paper (QR + the holder's
			name + shelter name — no wristband chrome, no accent bars, no ID-card panels).
			The booking code is deliberately not shown: it is the evacuee ULID the QR
			already carries — unreadable to a human, and meaningless to the marshal at
			the gate, who matches the person in front of them against the name.
			The `booking-ticket-print` id is picked up by the @media print isolation
			below (same visibility-hidden-then-override idiom as evacuee-qr-modal.svelte),
			so it stays visible while the rest of the page (header banner, dl, page
			chrome outside this component) is hidden for print.
		-->
		<div
			bind:this={ticketEl}
			id="booking-ticket-print"
			class="flex flex-col items-center gap-3 bg-card px-6 py-6"
		>
			<p class="hidden text-center text-sm font-bold text-foreground print:block">
				{ticket.shelter_name}
			</p>
			{#await qrPromise}
				<div class="h-44 w-44 animate-pulse rounded-lg bg-muted"></div>
			{:then qrUrl}
				<img src={qrUrl} alt="QR สำหรับยืนยันตัวตนที่ประตูศูนย์" class="h-44 w-44" />
			{:catch}
				<p
					class="flex h-44 w-44 items-center justify-center rounded-lg bg-muted p-4 text-center text-xs text-muted-foreground"
				>
					สร้าง QR ไม่สำเร็จ กรุณาแจ้งชื่อ-นามสกุลกับเจ้าหน้าที่ที่ประตูศูนย์
				</p>
			{/await}

			<div class="text-center">
				<p class="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
					ชื่อผู้จอง
				</p>
				<p class="text-base font-bold text-foreground">{fullName}</p>
			</div>
		</div>

		<!-- The name lives in the QR block above (it prints); no need to repeat it here. -->
		<dl class="space-y-2 border-t border-border px-6 py-4 text-sm">
			<div class="flex justify-between gap-4">
				<dt class="text-muted-foreground">สถานะ</dt>
				<dd class="text-right font-semibold text-foreground">{statusLabel}</dd>
			</div>
			{#if bookedAt}
				<div class="flex justify-between gap-4">
					<dt class="text-muted-foreground">เวลาที่จอง</dt>
					<dd class="text-right font-semibold text-foreground">{bookedAt}</dd>
				</div>
			{/if}
		</dl>
	</div>

	<div class="flex justify-center print:hidden">
		<Button type="button" variant="outline" disabled={downloading} onclick={downloadTicket}>
			<Download class="h-4 w-4" />
			{downloading ? 'กำลังสร้างไฟล์…' : 'ดาวน์โหลดใบจอง (PDF)'}
		</Button>
	</div>
</div>

<style>
	/*
		Print QR-only: deliberately thinner than the onsite wristband/ID-card print
		in evacuee-qr-modal.svelte. That flow isolates a full card panel (accent bar,
		name, zone, national ID); a booking ticket only needs the gate scanner to read
		the QR plus the holder's name as a human-readable fallback, so the isolated
		target here is just the QR block — no header banner, no dl summary.

		The download button no longer calls `window.print()`, but these rules still
		earn their place: a user who hits Ctrl+P (or "Print" from the browser menu)
		on an open ticket gets the same one-page QR instead of the whole landing page.

		The ticket renders inside a bits-ui Dialog (booking-modal.svelte), portalled
		to <body>, sitting on top of the public landing page's own CTA buttons.

		`transition: none` is load-bearing, not hygiene. `visibility` is a discrete
		*transitionable* property, and the landing page's PublicActionBtn CTAs plus
		the dialog overlay/content all carry `transition-all` at 150ms — so their
		visible → hidden flip is deferred (a discrete property switches at 50% of the
		duration) past the moment the print snapshot is taken. Measured under
		print-media emulation: 8 foreign elements were still `visible` immediately
		after print styles applied, every one of them with `transition: all 0.15s`,
		and 0 remained once the transitions were allowed to settle. Killing
		transitions here makes the flip instant, which is what actually closes the
		isolation gap; the `!important` below is only belt-and-braces.
	*/
	@media print {
		:global(*),
		:global(*::before),
		:global(*::after) {
			transition: none !important;
			animation: none !important;
		}
		:global(body *) {
			visibility: hidden !important;
		}
		#booking-ticket-print,
		#booking-ticket-print * {
			visibility: visible !important;
		}
		/*
			`visibility: hidden` stops the painting but KEEPS the layout box, so the
			(invisible) landing page underneath still contributed its full height and
			printed as trailing blank pages — a 2-3 page PDF for one QR. Collapsing
			every body-level subtree that does not contain the ticket removes that
			height entirely; the dialog's own chrome is `position: fixed`, so what is
			left contributes nothing to the flow and the QR fits one page.
		*/
		:global(body > *:not(:has(#booking-ticket-print))) {
			display: none !important;
		}
		#booking-ticket-print {
			position: absolute;
			left: 50%;
			top: 50%;
			transform: translate(-50%, -50%);
			display: flex;
			flex-direction: column;
			align-items: center;
			gap: 12px;
		}
		#booking-ticket-print img {
			height: 240px !important;
			width: 240px !important;
		}
	}
</style>
