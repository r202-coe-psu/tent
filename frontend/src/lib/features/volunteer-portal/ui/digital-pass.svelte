<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Clock from '@lucide/svelte/icons/clock';
	import Download from '@lucide/svelte/icons/download';
	import Link2 from '@lucide/svelte/icons/link-2';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import X from '@lucide/svelte/icons/x';
	import { toast } from 'svelte-sonner';
	import { generateQrDataUrl } from '$lib/utils/qrcode';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton';
	import { useCancelTicketMutation, useVolunteerTicket } from '../application/queries';
	import { ticketStatusLabel } from '../domain/volunteer';

	interface Props {
		token: string;
	}

	let { token }: Props = $props();

	const query = useVolunteerTicket(() => token);
	const cancel = useCancelTicketMutation();

	const ticket = $derived(query.data);

	/**
	 * The QR carries the pass URL and nothing else — no name, no phone, no ID number.
	 * The check-in station resolves the token server-side, so anything more on the code
	 * would be PII held up at a shelter gate.
	 *
	 * Built inside `$derived.by` with its own try/catch: a synchronous throw in a derived
	 * aborts the update that reads it, so a QR that cannot be drawn would take the whole
	 * pass down with it. It has to degrade to "no QR" instead — the appointment details
	 * below are still worth showing.
	 */
	const qrPromise = $derived.by(() => {
		if (!ticket) return null;
		try {
			const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'http://localhost';
			const fullUrl = new URL(ticket.qr_payload, baseUrl).toString();
			return generateQrDataUrl(fullUrl, {
				width: 512,
				margin: 1,
				color: { dark: '#0f172a', light: '#ffffff' }
			});
		} catch (error) {
			return Promise.reject(error instanceof Error ? error : new Error(String(error)));
		}
	});

	const appliedAt = $derived.by(() => {
		if (!ticket?.applied_at) return '';
		const parsed = new Date(ticket.applied_at);
		return Number.isNaN(parsed.getTime())
			? ''
			: parsed.toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short' });
	});

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(window.location.href);
			toast.success('คัดลอกลิงก์ตั๋วแล้ว');
		} catch {
			toast.error('คัดลอกลิงก์ไม่สำเร็จ');
		}
	}

	async function downloadQr(dataUrl: string) {
		const link = document.createElement('a');
		link.href = dataUrl;
		link.download = `volunteer-ticket-${token}.png`;
		link.click();
	}

	async function cancelTicket() {
		try {
			await cancel.mutateAsync(token);
			toast.success('ยกเลิกการสมัครแล้ว');
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ยกเลิกการสมัครไม่สำเร็จ');
		}
	}
</script>

<div class="mx-auto max-w-md space-y-4 py-6">
	<Button href="/volunteers/portal" variant="ghost" size="sm">
		<ArrowLeft class="mr-2 size-4" aria-hidden="true" />
		กลับไปยังพอร์ทัลจิตอาสา
	</Button>

	{#if query.isPending}
		<Skeleton class="h-[32rem] w-full rounded-xl" />
	{:else if query.isError || !ticket}
		<Card.Root>
			<Card.Content class="flex flex-col items-center gap-3 py-12 text-center">
				<CircleAlert class="size-8 text-muted-foreground" aria-hidden="true" />
				<p class="text-sm">
					{query.error instanceof Error ? query.error.message : 'ไม่พบตั๋วนี้'}
				</p>
			</Card.Content>
		</Card.Root>
	{:else}
		<!--
			Clean Single Ticket View (FR-VOL-03.2) — this page shows one pass and nothing
			else. No "find another ticket" search below it: that lives on the board's
			second tab, and putting it here turned the pass into a lookup form.
		-->
		<Card.Root>
			<Card.Header class="space-y-3 text-center">
				<div class="flex justify-center">
					<Badge variant={ticket.status === 'confirmed' ? 'default' : 'secondary'} class="text-sm">
						{ticket.status === 'confirmed' ? '🟢' : ticket.status === 'cancelled' ? '⚪' : '🟡'}
						{ticketStatusLabel(ticket.status)}
					</Badge>
				</div>
				<Card.Title>{ticket.job_title || 'งานอาสาสมัคร'}</Card.Title>
				<Card.Description class="space-y-1">
					<span class="flex items-center justify-center gap-1">
						<MapPin class="size-3.5" aria-hidden="true" />
						{ticket.shelter_name || ticket.shelter_code}
					</span>
					{#if appliedAt}
						<span class="block">สมัครเมื่อ {appliedAt}</span>
					{/if}
				</Card.Description>
			</Card.Header>

			<Card.Content class="space-y-5">
				{#if qrPromise}
					{#await qrPromise then dataUrl}
						<div class="flex justify-center">
							<img
								src={dataUrl}
								alt="QR Code สำหรับรายงานตัวหน้างาน"
								class="size-56 rounded-lg border bg-white p-2"
							/>
						</div>
					{:catch}
						<p class="text-center text-sm text-muted-foreground">แสดง QR Code ไม่สำเร็จ</p>
					{/await}
				{/if}

				<div class="space-y-2 rounded-lg bg-muted/50 p-3 text-sm">
					<div class="flex justify-between gap-4">
						<span class="text-muted-foreground">ผู้สมัคร</span>
						<span class="text-right font-medium">{ticket.applicant_name}</span>
					</div>
					<div class="flex justify-between gap-4">
						<span class="text-muted-foreground">เบอร์โทรศัพท์</span>
						<!-- Masked upstream; the full number never reaches this page (FR-VOL-03.4). -->
						<span class="text-right font-medium">{ticket.phone_masked}</span>
					</div>
					{#if ticket.selected_shift?.date}
						<div class="flex justify-between gap-4">
							<span class="text-muted-foreground">วันที่</span>
							<span class="text-right font-medium">{ticket.selected_shift.date}</span>
						</div>
					{/if}
					{#if ticket.selected_shift?.start_time}
						<div class="flex justify-between gap-4">
							<span class="flex items-center gap-1 text-muted-foreground">
								<Clock class="size-3.5" aria-hidden="true" />
								เวลากะ
							</span>
							<span class="text-right font-medium">
								{ticket.selected_shift.start_time}–{ticket.selected_shift.end_time}
							</span>
						</div>
					{/if}
					{#if ticket.selected_shift?.station}
						<div class="flex justify-between gap-4">
							<span class="text-muted-foreground">จุดนัดพบ</span>
							<span class="text-right font-medium">{ticket.selected_shift.station}</span>
						</div>
					{/if}
					<div class="flex justify-between gap-4">
						<span class="text-muted-foreground">รหัสตั๋ว</span>
						<span class="text-right font-mono text-xs break-all">{ticket.token}</span>
					</div>
				</div>
			</Card.Content>

			<Card.Footer class="flex-col gap-2">
				{#if qrPromise}
					{#await qrPromise then dataUrl}
						<Button variant="outline" class="w-full" onclick={() => downloadQr(dataUrl)}>
							<Download class="mr-2 size-4" aria-hidden="true" />
							บันทึกรูป QR Code ลงเครื่อง
						</Button>
					{/await}
				{/if}
				<Button variant="outline" class="w-full" onclick={copyLink}>
					<Link2 class="mr-2 size-4" aria-hidden="true" />
					คัดลอกลิงก์ตั๋วนี้
				</Button>
				{#if ticket.status !== 'cancelled' && ticket.can_cancel}
					<Button
						variant="ghost"
						class="w-full text-destructive"
						disabled={cancel.isPending}
						onclick={cancelTicket}
					>
						<X class="mr-2 size-4" aria-hidden="true" />
						ขอยกเลิกการสมัครล่วงหน้า
					</Button>
				{/if}
			</Card.Footer>
		</Card.Root>
	{/if}
</div>
