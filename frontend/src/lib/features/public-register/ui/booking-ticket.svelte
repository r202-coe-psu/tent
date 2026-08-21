<script lang="ts">
	import CircleCheck from '@lucide/svelte/icons/circle-check';
	import Info from '@lucide/svelte/icons/info';
	import Printer from '@lucide/svelte/icons/printer';
	import QRCode from 'qrcode';
	import { Button } from '$lib/components/ui/button';
	import type { BookingTicket } from '../application/booking-store.svelte';

	interface Props {
		ticket: BookingTicket;
		/** Shown on the confirmation step; hidden when the ticket is re-opened from lookup. */
		showSuccessHeader?: boolean;
	}

	const { ticket, showSuccessHeader = true }: Props = $props();

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

	const statusLabel = $derived(
		ticket.status === 'pre_registered'
			? 'จองแล้ว รอยืนยันตัวตนที่ประตู'
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
			<p class="text-[11px] font-bold tracking-widest uppercase opacity-80">Shelter Booking</p>
			<p class="mt-1 text-base font-bold">{ticket.shelter_name}</p>
			<p class="text-xs opacity-80">รหัสศูนย์ {ticket.shelter_code}</p>
		</div>

		<!--
			Printable target: only this block should end up on paper (QR + booking code
			+ shelter name — no wristband chrome, no accent bars, no ID-card panels).
			The `booking-ticket-print` id is picked up by the @media print isolation
			below (same visibility-hidden-then-override idiom as evacuee-qr-modal.svelte),
			so it stays visible while the rest of the page (header banner, dl, page
			chrome outside this component) is hidden for print.
		-->
		<div id="booking-ticket-print" class="flex flex-col items-center gap-3 px-6 py-6">
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
					สร้าง QR ไม่สำเร็จ กรุณาใช้รหัสการจองด้านล่างแทน
				</p>
			{/await}

			<div class="text-center">
				<p class="text-[11px] font-semibold tracking-wider text-muted-foreground uppercase">
					รหัสการจอง
				</p>
				<p class="font-mono text-sm font-bold break-all text-foreground">{ticket.code}</p>
			</div>
		</div>

		<dl class="space-y-2 border-t border-border px-6 py-4 text-sm">
			<div class="flex justify-between gap-4">
				<dt class="text-muted-foreground">ชื่อผู้จอง</dt>
				<dd class="font-semibold text-foreground">{ticket.first_name}</dd>
			</div>
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

	<p
		class="mx-auto flex max-w-md items-start gap-2 rounded-xl bg-muted/50 p-3 text-xs text-muted-foreground print:hidden"
	>
		<Info class="mt-0.5 h-3.5 w-3.5 shrink-0" />
		<span>
			กรุณาเก็บรหัสการจองนี้ไว้เป็นหลักฐาน หากไม่สามารถมาได้
			กรุณาแจ้งเจ้าหน้าที่เพื่อยกเลิกและคืนที่ให้ผู้อื่น
		</span>
	</p>

	<div class="flex justify-center print:hidden">
		<Button type="button" variant="outline" onclick={() => window.print()}>
			<Printer class="h-4 w-4" />
			พิมพ์ใบจอง
		</Button>
	</div>
</div>

<style>
	/*
		Print QR-only: deliberately thinner than the onsite wristband/ID-card print
		in evacuee-qr-modal.svelte. That flow isolates a full card panel (accent bar,
		name, zone, national ID); a booking ticket only needs the gate scanner to read
		the QR plus the booking code as a human-readable fallback, so the isolated
		target here is just the QR block — no header banner, no dl summary.
	*/
	@media print {
		:global(body *) {
			visibility: hidden;
		}
		#booking-ticket-print,
		#booking-ticket-print * {
			visibility: visible;
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
