<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Download from '@lucide/svelte/icons/download';
	import ImageDown from '@lucide/svelte/icons/image-down';
	import { generateQrDataUrl } from '$lib/utils/qrcode';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import { PUBLIC_BOOKING_TICKET_I18N } from '$lib/constants/i18n';
	import { langState } from '$lib/states/i18n.svelte';
	import { downloadElementAsPdf, downloadElementAsPng } from '$lib/utils/pdf';
	import { getTranslation } from '$lib/utils/i18n';
	import { formatThaiDateTime } from '$lib/utils/date';
	import type { BookingTicket } from '../application/booking-store.svelte';

	interface Props {
		ticket: BookingTicket;
		/** Shown on the confirmation step; hidden when the ticket is re-opened from lookup. */
		showSuccessHeader?: boolean;
	}

	const { ticket, showSuccessHeader = true }: Props = $props();

	let t = $derived(getTranslation(PUBLIC_BOOKING_TICKET_I18N, langState.current));

	/** Falls back to whichever half exists, so a blank never renders as a stray space. */
	const fullName = $derived([ticket.first_name, ticket.last_name].filter(Boolean).join(' '));

	/** The QR block — the only part that goes on paper (see the @media print rules). */
	let ticketEl = $state<HTMLElement | null>(null);
	/** Which export is rendering; both share one html2canvas pass at a time. */
	let downloading = $state<'pdf' | 'png' | null>(null);

	const isUnassigned = $derived(
		ticket.type === 'unassigned_queue' || ticket.shelter_code === 'unassigned'
	);

	const qrPayload = $derived(isUnassigned ? ticket.code : `evacuee:${ticket.code}`);

	// Shelter booking: QR carries `evacuee:{ulid}` — same payload staff encode for the
	// gate scanner. Unassigned queue (#255): QR is the Mongo registration id only —
	// NOT a Station-1 Person QR / FamilyBatchPrint / Handover until claim into a shelter.
	const qrPromise = $derived(
		generateQrDataUrl(qrPayload, {
			width: 384,
			margin: 1,
			color: { dark: '#0f172a', light: '#ffffff' }
		})
	);

	const bookedAt = $derived(ticket.booked_at ? formatThaiDateTime(ticket.booked_at) : '');

	/**
	 * Save the ticket straight to the device as `preregister-<code>.pdf` or `.png`
	 * (mirroring the `evacuee-id-<id>` filename convention of the onsite QR card).
	 * The PNG suits phones, where a picture in the gallery is easier to find.
	 *
	 * Deliberately a download, not `window.print()` and not the preview tab the
	 * staff QR card opens: a citizen on a phone at a shelter gate wants the file in
	 * their downloads, not a print dialog to dismiss or a popup their browser may
	 * block. Only the QR block is rasterized, matching what the print stylesheet
	 * below isolates — the QR plus the booking code as a human-readable fallback.
	 */
	async function downloadTicket(format: 'pdf' | 'png') {
		if (!ticketEl || downloading) return;
		downloading = format;
		const filename = `preregister-${ticket.code}`;
		try {
			if (format === 'png') await downloadElementAsPng(ticketEl, filename);
			else await downloadElementAsPdf(ticketEl, filename);
		} catch (err) {
			// Surface the real reason when there is one — a render that timed out
			// says so, which tells the citizen retrying is worth it.
			toast.error(err instanceof Error && err.message ? err.message : t.downloadErrorFallback);
		} finally {
			downloading = null;
		}
	}

	const statusLabel = $derived(
		isUnassigned
			? t.statusAwaitingShelter
			: ticket.status === 'pre_registered'
				? t.statusPreRegistered
				: ticket.status === 'active'
					? t.statusActive
					: ticket.status === 'cancelled'
						? t.statusCancelled
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
				<p class="text-sm font-bold text-foreground">
					{t.successHeaderTitle}
				</p>
				<p class="mt-0.5 text-xs text-muted-foreground">
					{isUnassigned ? t.unassignedSuccessDesc : t.successHeaderDesc}
				</p>
			</div>
		</div>
	{/if}

	<div
		class="mx-auto w-full max-w-md overflow-hidden rounded-2xl border border-black/[0.04] bg-card shadow-sm print:border-0 print:shadow-none"
	>
		<div
			class="{isUnassigned ? 'bg-indigo-900' : 'bg-primary-dark'} px-6 py-4 text-center text-white"
		>
			<p class="mt-1 text-base font-bold">
				{isUnassigned ? t.unassignedShelter : ticket.shelter_name}
			</p>
			{#if !isUnassigned}
				<p class="text-xs opacity-80">{t.shelterCodeLabel} {ticket.shelter_code}</p>
			{/if}
		</div>

		<!--
			Printable target: only this block should end up on paper (QR + the holder's
			name + shelter name — no wristband chrome, no accent bars, no ID-card panels).
			The code is deliberately not shown (shelter and unassigned tickets alike):
			it is the ULID / registration id the QR already carries — unreadable to a
			human, and staff find the person by QR, name or phone, never by typing it.
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
				{isUnassigned ? t.unassignedShelterPrint : ticket.shelter_name}
			</p>
			{#await qrPromise}
				<div class="h-44 w-44 animate-pulse rounded-lg bg-muted"></div>
			{:then qrUrl}
				<img src={qrUrl} alt={isUnassigned ? t.qrAltUnassigned : t.qrAlt} class="h-44 w-44" />
			{:catch}
				<p
					class="flex h-44 w-44 items-center justify-center rounded-lg bg-muted p-4 text-center text-xs text-muted-foreground"
				>
					{isUnassigned ? t.qrErrorFallbackUnassigned : t.qrErrorFallback}
				</p>
			{/await}

			<div class="text-center">
				<p class="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
					{t.bookerNameLabel}
				</p>
				<p class="text-base font-bold text-foreground">{fullName}</p>
			</div>
			<p class="text-center text-sm font-semibold text-foreground">{t.showQrInstruction}</p>
		</div>

		<!-- The name lives in the QR block above (it prints); no need to repeat it here. -->
		<dl class="space-y-2 border-t border-border px-6 py-4 text-sm">
			<div class="flex justify-between gap-4">
				<dt class="text-muted-foreground">{t.statusDtLabel}</dt>
				<dd class="text-right font-semibold text-foreground">{statusLabel}</dd>
			</div>
			{#if ticket.member_count}
				<div class="flex justify-between gap-4">
					<dt class="text-muted-foreground">{t.memberCountLabel}</dt>
					<dd class="text-right font-semibold text-foreground">
						{t.memberCountValue(ticket.member_count)}
					</dd>
				</div>
			{/if}
			{#if bookedAt}
				<div class="flex justify-between gap-4">
					<dt class="text-muted-foreground">{t.bookedAtLabel}</dt>
					<dd class="text-right font-semibold text-foreground">{bookedAt}</dd>
				</div>
			{/if}
		</dl>
	</div>

	<div class="flex flex-wrap items-center justify-center gap-3 print:hidden">
		<Button
			type="button"
			variant="outline"
			class="min-h-11"
			disabled={downloading !== null}
			onclick={() => downloadTicket('pdf')}
		>
			<Download class="h-4 w-4" />
			{downloading === 'pdf' ? t.downloadingBtn : t.downloadBtn}
		</Button>
		<Button
			type="button"
			variant="outline"
			class="min-h-11"
			disabled={downloading !== null}
			onclick={() => downloadTicket('png')}
		>
			<ImageDown class="h-4 w-4" />
			{downloading === 'png' ? t.downloadingBtn : t.downloadPngBtn}
		</Button>
	</div>
</div>

<style>
	/*
		Print QR-only: deliberately thinner than the onsite wristband/ID-card print
		in evacuee-qr-modal.svelte. Shelter booking needs the gate scanner to read
		`evacuee:{ulid}`; unassigned tickets encode the Mongo registration id only
		(queue reference — not Station-1 Person QR until claim). Plus the holder's
		name as a human-readable fallback.

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
