<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import Calendar from '@lucide/svelte/icons/calendar';
	import CheckCircle from '@lucide/svelte/icons/check-circle';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Plus from '@lucide/svelte/icons/plus';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { Button } from '$lib/components/ui/button';
	import BookingTicketView from './booking-ticket.svelte';
	import type { BookingTicket } from '../application/booking-store.svelte';
	import { getStoredTickets, removeStoredTicket } from '../data/ticket-storage';
	import { checkTicketStatus } from '../data/public-register.api';
	import { langState } from '$lib/states/i18n.svelte';

	interface Props {
		onNewBooking?: () => void;
		onTicketsChange?: () => void;
	}

	const { onNewBooking, onTicketsChange }: Props = $props();

	let tickets = $state<BookingTicket[]>([]);
	let selectedTicket = $state<BookingTicket | null>(null);
	let checkingCode = $state<string | null>(null);

	onMount(() => {
		tickets = getStoredTickets();
		void syncAllStatus();
	});

	async function syncAllStatus() {
		const current = getStoredTickets();
		let removedAny = false;
		for (const t of current) {
			try {
				const res = await checkTicketStatus(t.code);
				if (res.verified || res.notFound) {
					removeStoredTicket(t.code);
					removedAny = true;
				}
			} catch {
				// skip on network/status error
			}
		}
		if (removedAny) {
			tickets = getStoredTickets();
			if (selectedTicket && !tickets.some((t) => t.code === selectedTicket?.code)) {
				selectedTicket = null;
			}
			onTicketsChange?.();
			toast.info('ตั๋วการจองได้รับการยืนยันเข้าศูนย์พักพิงแล้ว ระบบได้ลบข้อมูลออกจากอุปกรณ์');
		}
	}

	function handleRemove(code: string, e?: MouseEvent) {
		e?.stopPropagation();
		if (confirm('คุณต้องการลบตั๋วการจองนี้ออกจากเครื่องหรือไม่?')) {
			removeStoredTicket(code);
			tickets = getStoredTickets();
			if (selectedTicket?.code === code) {
				selectedTicket = null;
			}
			onTicketsChange?.();
		}
	}

	function handleConfirmVerified(code: string, e?: MouseEvent) {
		e?.stopPropagation();
		if (
			confirm(
				'คุณได้นำตั๋วนี้ไปรายงานตัวยืนยันเข้าพักที่ศูนย์แล้วใช่หรือไม่?\n\nระบบจะลบข้อมูลตั๋วนี้ออกจากอุปกรณ์'
			)
		) {
			removeStoredTicket(code);
			tickets = getStoredTickets();
			if (selectedTicket?.code === code) {
				selectedTicket = null;
			}
			onTicketsChange?.();
			toast.success('นำตั๋วไปยืนยันแล้ว ระบบได้ลบข้อมูลตั๋วนี้ออกจากอุปกรณ์เรียบร้อย');
		}
	}

	async function handleCheckStatus(code: string, e?: MouseEvent) {
		e?.stopPropagation();
		checkingCode = code;
		try {
			const res = await checkTicketStatus(code);
			if (res.verified) {
				removeStoredTicket(code);
				tickets = getStoredTickets();
				if (selectedTicket?.code === code) {
					selectedTicket = null;
				}
				onTicketsChange?.();
				toast.success(
					'ตั๋วนี้ได้รับการยืนยันเข้าศูนย์พักพิงแล้ว ระบบได้ลบข้อมูลออกจากอุปกรณ์เรียบร้อย'
				);
			} else if (res.notFound) {
				removeStoredTicket(code);
				tickets = getStoredTickets();
				if (selectedTicket?.code === code) {
					selectedTicket = null;
				}
				onTicketsChange?.();
				toast.info(
					'ไม่พบข้อมูลตั๋วนี้ในระบบ (อาจหมดอายุหรือถูกลบแล้ว) ระบบได้ลบข้อมูลออกจากอุปกรณ์'
				);
			} else {
				toast.info('ตั๋วนี้ยังอยู่ระหว่างรอการยืนยันเข้าพักที่ศูนย์');
			}
		} catch {
			toast.error('ไม่สามารถตรวจสอบสถานะได้ในขณะนี้');
		} finally {
			checkingCode = null;
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

			<BookingTicketView
				ticket={selectedTicket}
				showSuccessHeader={false}
				onVerified={(code) => handleConfirmVerified(code)}
			/>
		</div>
	{:else}
		<div class="flex items-center justify-between">
			<div>
				<h2 class="text-lg font-bold text-foreground">ตั๋วลงทะเบียนที่บันทึกไว้ในอุปกรณ์นี้</h2>
				<p class="text-xs text-muted-foreground">
					แตะที่ตั๋วเพื่อเปิดแสดง QR Code สำหรับแสดงต่อเจ้าหน้าที่ลงทะเบียนประจำศูนย์
					เพื่อยืนยันการเข้าพัก
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
									class="rounded-full {t.shelter_code === 'unassigned' ||
									t.type === 'unassigned_queue'
										? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300'
										: 'bg-primary/10 text-primary'} px-2 py-0.5 text-2xs font-bold"
								>
									{t.shelter_code === 'unassigned' || t.type === 'unassigned_queue'
										? 'ยังไม่ระบุศูนย์'
										: t.code}
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

						<div class="flex flex-wrap items-center gap-1.5 sm:gap-2">
							<Button
								type="button"
								variant="outline"
								size="sm"
								title="ตรวจสอบว่าตั๋วได้รับการยืนยันที่ศูนย์แล้วหรือยัง"
								class="h-8 gap-1 px-2 text-xs font-semibold"
								disabled={checkingCode === t.code}
								onclick={(e) => handleCheckStatus(t.code, e)}
							>
								<RefreshCw class="size-3.5 {checkingCode === t.code ? 'animate-spin' : ''}" />
								<span class="hidden sm:inline">ตรวจสถานะ</span>
							</Button>
							<Button
								type="button"
								variant="secondary"
								size="sm"
								title="ยืนยันว่านำตั๋วไปใช้งานแล้ว และลบออกจากอุปกรณ์"
								class="h-8 gap-1 px-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 dark:text-emerald-300 dark:hover:bg-emerald-950/50"
								onclick={(e) => handleConfirmVerified(t.code, e)}
							>
								<CheckCircle class="size-3.5 text-emerald-600" />
								<span>ยืนยันแล้ว</span>
							</Button>
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
