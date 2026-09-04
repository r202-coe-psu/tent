<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Calendar from '@lucide/svelte/icons/calendar';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Plus from '@lucide/svelte/icons/plus';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { onMount } from 'svelte';
	import { Button } from '$lib/components/ui/button';
	import BookingTicketView from './booking-ticket.svelte';
	import type { BookingTicket } from '../application/booking-store.svelte';
	import { getStoredTickets, removeStoredTicket } from '../data/ticket-storage';
	import { langState } from '$lib/states/i18n.svelte';

	interface Props {
		onNewBooking?: () => void;
	}

	const { onNewBooking }: Props = $props();

	let tickets = $state<BookingTicket[]>([]);
	let selectedTicket = $state<BookingTicket | null>(null);

	onMount(() => {
		tickets = getStoredTickets();
	});

	function handleRemove(code: string, e: MouseEvent) {
		e.stopPropagation();
		if (confirm('คุณต้องการลบตั๋วการจองนี้ออกจากเครื่องหรือไม่?')) {
			removeStoredTicket(code);
			tickets = getStoredTickets();
			if (selectedTicket?.code === code) {
				selectedTicket = null;
			}
		}
	}

	function formatDate(dateStr: string): string {
		if (!dateStr) return '';
		const d = new Date(dateStr);
		return Number.isNaN(d.getTime())
			? ''
			: d.toLocaleString(langState.current === 'th' ? 'th-TH' : 'en-US', {
					dateStyle: 'medium',
					timeStyle: 'short'
				});
	}
</script>

<div class="space-y-6">
	{#if selectedTicket}
		<div class="space-y-4">
			<button
				type="button"
				onclick={() => (selectedTicket = null)}
				class="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground"
			>
				<ArrowLeft class="size-4" />
				<span>กลับไปยังรายการตั๋วทั้งหมด</span>
			</button>

			<BookingTicketView ticket={selectedTicket} showSuccessHeader={false} />
		</div>
	{:else}
		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-lg font-bold text-foreground">ตั๋วการจองที่บันทึกไว้ในอุปกรณ์นี้</h2>
				<p class="text-xs text-muted-foreground">
					แตะที่ตั๋วเพื่อเปิดแสดง Person QR สำหรับยื่นให้เจ้าหน้าที่ ณ จุดลงทะเบียน (Station 1)
				</p>
			</div>
			{#if onNewBooking}
				<Button size="sm" onclick={onNewBooking} class="gap-1.5 font-semibold">
					<Plus class="size-4" />
					<span>ลงทะเบียนใหม่</span>
				</Button>
			{/if}
		</div>

		{#if tickets.length === 0}
			<div class="rounded-2xl border border-dashed border-border bg-card p-10 text-center">
				<div
					class="mx-auto mb-3 flex size-12 items-center justify-center rounded-2xl bg-muted text-muted-foreground"
				>
					<QrCode class="size-6" />
				</div>
				<p class="text-sm font-bold text-foreground">ไม่พบตั๋วการจองในอุปกรณ์นี้</p>
				<p class="mt-1 text-xs text-muted-foreground">
					เมื่อคุณจองเข้าศูนย์พักพิงล่วงหน้าสำเร็จ ตั๋วและรหัส QR จะถูกบันทึกไว้ที่นี่โดยอัตโนมัติ
				</p>
				{#if onNewBooking}
					<div class="mt-5">
						<Button onclick={onNewBooking} class="font-semibold">
							<Plus class="mr-1.5 size-4" />
							<span>เริ่มการจองเข้าศูนย์ล่วงหน้า</span>
						</Button>
					</div>
				{/if}
			</div>
		{:else}
			<div class="grid gap-3">
				{#each tickets as t (t.code)}
					<div
						role="button"
						tabindex="0"
						onclick={() => (selectedTicket = t)}
						onkeydown={(e) => {
							if (e.key === 'Enter' || e.key === ' ') {
								e.preventDefault();
								selectedTicket = t;
							}
						}}
						class="flex cursor-pointer items-center justify-between rounded-2xl border border-border bg-card p-4 shadow-xs transition-all hover:border-primary/50 hover:bg-muted/30 focus-visible:ring-2 focus-visible:ring-primary focus-visible:outline-none"
					>
						<div class="space-y-1.5">
							<div class="flex items-center gap-2">
								<span
									class="rounded-full bg-primary/10 px-2 py-0.5 text-2xs font-bold text-primary"
								>
									{t.code}
								</span>
								<span class="text-sm font-bold text-foreground">
									{[t.first_name, t.last_name].filter(Boolean).join(' ') || 'ผู้จอง'}
								</span>
							</div>

							<div
								class="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground"
							>
								<span class="flex items-center gap-1">
									<MapPin class="size-3.5" />
									{t.shelter_name || t.shelter_code}
								</span>
								{#if t.booked_at}
									<span class="flex items-center gap-1">
										<Calendar class="size-3.5" />
										{formatDate(t.booked_at)}
									</span>
								{/if}
							</div>
						</div>

						<div class="flex items-center gap-2">
							<span class="inline-flex items-center gap-1 text-xs font-semibold text-primary">
								<QrCode class="size-4" />
								<span>ดู QR</span>
							</span>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label="ลบตั๋ว"
								class="text-muted-foreground hover:text-destructive"
								onclick={(e) => handleRemove(t.code, e)}
							>
								<Trash2 class="size-4" />
							</Button>
						</div>
					</div>
				{/each}
			</div>
		{/if}
	{/if}
</div>
