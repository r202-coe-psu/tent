<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import History from '@lucide/svelte/icons/history';
	import Plus from '@lucide/svelte/icons/plus';
	import { resolve } from '$app/paths';
	import { Button } from '$lib/components/ui/button';
	import {
		BookingForm,
		BookingTicketView,
		TicketHistory,
		getStoredTickets,
		removeStoredTicket,
		checkTicketStatus,
		type BookingTicketModel
	} from '$lib/features/public-register';
	import {
		listPublicShelters,
		toPublicShelterCard,
		type PublicShelterCardModel
	} from '$lib/features/public-portal';
	import { onMount } from 'svelte';
	import { toast } from 'svelte-sonner';

	interface Props {
		data: {
			shelterCode?: string;
		};
	}

	const { data }: Props = $props();

	let activeTab = $state<'form' | 'history'>('form');
	let ticket = $state<BookingTicketModel | null>(null);

	let shelters = $state<(PublicShelterCardModel & { available: number | null })[]>([]);
	let loadError = $state('');
	let isLoading = $state(true);

	let storedTicketsCount = $state(0);

	async function syncTicketsStatus() {
		const current = getStoredTickets();
		if (current.length === 0) {
			storedTicketsCount = 0;
			return;
		}

		let anyVerified = false;
		for (const t of current) {
			try {
				const res = await checkTicketStatus(t.code);
				if (res.verified) {
					removeStoredTicket(t.code);
					anyVerified = true;
				}
			} catch {
				// skip on failure
			}
		}

		storedTicketsCount = getStoredTickets().length;
		if (anyVerified) {
			toast.info('ตั๋วการจองได้รับการยืนยันเข้าศูนย์พักพิงแล้ว ระบบได้ลบข้อมูลออกจากอุปกรณ์');
		}
	}

	async function loadInitialData() {
		try {
			isLoading = true;
			const shelterRes = await listPublicShelters({});
			const cards = (shelterRes?.shelters ?? []).map((s) => toPublicShelterCard(s as never));

			const codes = cards.filter((c) => c.status !== 'CLOSED').map((c) => c.code);
			let occupancy: Record<string, number | null> = {};
			if (codes.length > 0) {
				try {
					const occRes = await fetch(
						`/api/public/v1/shelters/occupancy?codes=${codes.join(',')}`
					).then((r) => (r.ok ? r.json() : { occupancy: {} }));
					occupancy = occRes?.occupancy ?? {};
				} catch {
					// Optional occupancy count fallback
				}
			}
			shelters = cards.map((c) => ({
				...c,
				available:
					typeof occupancy[c.code] === 'number'
						? Math.max(0, c.capacity - occupancy[c.code]!)
						: null
			}));
		} catch {
			loadError = 'ไม่สามารถโหลดข้อมูลศูนย์พักพิงได้ กรุณาลองใหม่อีกครั้ง';
		} finally {
			isLoading = false;
		}
	}

	onMount(() => {
		storedTicketsCount = getStoredTickets().length;
		void syncTicketsStatus();
		void loadInitialData();
	});

	function handleNewBooking() {
		ticket = null;
		activeTab = 'form';
	}
</script>

<svelte:head>
	<title>ลงทะเบียนเข้าศูนย์พักพิงล่วงหน้า | SmartShelter</title>
</svelte:head>

<div class="mx-auto w-full max-w-6xl px-4 py-6 md:px-6 md:py-8 xl:max-w-7xl">
	<!-- Top Navigation -->
	<div class="mb-6 flex flex-wrap items-center justify-between gap-4">
		<a
			href={resolve('/')}
			class="inline-flex cursor-pointer items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground hover:underline"
		>
			<ArrowLeft class="size-4" />
			<span>กลับหน้าหลัก</span>
		</a>

		<!-- Tab Switcher -->
		<div class="inline-flex rounded-2xl border border-border bg-muted/40 p-1">
			<button
				type="button"
				class="inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all {activeTab ===
				'form'
					? 'bg-card text-foreground shadow-xs ring-1 ring-border/50'
					: 'text-muted-foreground hover:text-foreground'}"
				onclick={() => (activeTab = 'form')}
			>
				<ClipboardCheck class="size-4" />
				<span>{ticket ? 'ตั๋วการจอง' : 'ลงทะเบียนใหม่'}</span>
			</button>
			<button
				type="button"
				class="relative inline-flex cursor-pointer items-center gap-2 rounded-xl px-4 py-2 text-sm font-semibold transition-all {activeTab ===
				'history'
					? 'bg-card text-foreground shadow-xs ring-1 ring-border/50'
					: 'text-muted-foreground hover:text-foreground'} {storedTicketsCount > 0
					? 'ticket-tab-glow font-bold text-foreground ring-2 ring-primary/60'
					: ''}"
				onclick={() => {
					activeTab = 'history';
					storedTicketsCount = getStoredTickets().length;
					void syncTicketsStatus();
				}}
			>
				<History class="size-4" />
				<span>ประวัติการจองของฉัน</span>
				{#if storedTicketsCount > 0}
					<span
						class="flex size-5 animate-pulse items-center justify-center rounded-full bg-primary text-2xs font-bold text-primary-foreground"
					>
						{storedTicketsCount}
					</span>
				{/if}
			</button>
		</div>
	</div>

	<!-- Page Heading -->
	<div class="mb-8">
		<h1 class="text-2xl font-black tracking-tight text-foreground md:text-3xl">
			ลงทะเบียนเข้าศูนย์พักพิงล่วงหน้า
		</h1>
		<p class="mt-2 text-sm text-muted-foreground">
			กรอกข้อมูลตัวท่านและสมาชิกในครอบครัว เพื่ออำนวยความสะดวกในการจัดสรรพื้นที่เข้าพัก
			เมื่อเดินทางถึงศูนย์พักพิง
		</p>
	</div>

	<!-- Main Content Area -->
	{#if activeTab === 'history'}
		<div class="rounded-2xl border border-border/80 bg-card p-6 shadow-2xs sm:p-8">
			<TicketHistory
				onNewBooking={handleNewBooking}
				onTicketsChange={() => {
					storedTicketsCount = getStoredTickets().length;
				}}
			/>
		</div>
	{:else if ticket}
		<div class="space-y-6">
			<div class="rounded-2xl border border-border/80 bg-card p-6 shadow-2xs sm:p-8">
				<BookingTicketView
					{ticket}
					onVerified={(code) => {
						removeStoredTicket(code);
						ticket = null;
						storedTicketsCount = getStoredTickets().length;
						toast.success('นำตั๋วไปยืนยันแล้ว ระบบได้ลบข้อมูลออกจากอุปกรณ์เรียบร้อย');
					}}
				/>
			</div>

			<div class="flex flex-wrap items-center justify-between gap-4">
				<Button variant="outline" onclick={handleNewBooking} class="gap-2 font-semibold">
					<Plus class="size-4" />
					<span>ลงทะเบียนใหม่อีกครอบครัว</span>
				</Button>
				<Button
					variant="ghost"
					onclick={() => {
						activeTab = 'history';
						storedTicketsCount = getStoredTickets().length;
					}}
					class="gap-2 text-muted-foreground hover:text-foreground"
				>
					<History class="size-4" />
					<span>ดูตั๋วลงทะเบียนทั้งหมดที่บันทึกไว้</span>
				</Button>
			</div>
		</div>
	{:else if isLoading}
		<div class="rounded-2xl border border-border/80 bg-card p-12 text-center shadow-2xs">
			<div
				class="mx-auto mb-3 size-8 animate-spin rounded-full border-2 border-primary border-t-transparent"
			></div>
			<p class="text-sm font-medium text-muted-foreground">กำลังโหลดรายชื่อศูนย์พักพิง…</p>
		</div>
	{:else if loadError}
		<div
			class="rounded-2xl border border-destructive/30 bg-destructive/10 p-6 text-center text-sm text-destructive shadow-2xs"
		>
			<p>{loadError}</p>
		</div>
	{:else}
		<div class="space-y-6">
			{#key data.shelterCode}
				<BookingForm
					{shelters}
					lockedShelterCode={data.shelterCode}
					onbooked={(t) => {
						ticket = t;
						storedTicketsCount = getStoredTickets().length;
					}}
				/>
			{/key}
		</div>
	{/if}
</div>

<style>
	@keyframes ticketTabGlow {
		0%,
		100% {
			box-shadow:
				0 0 0 2px color-mix(in srgb, var(--primary) 40%, transparent),
				0 0 10px color-mix(in srgb, var(--primary) 30%, transparent);
		}
		50% {
			box-shadow:
				0 0 0 3px color-mix(in srgb, var(--primary) 85%, transparent),
				0 0 20px color-mix(in srgb, var(--primary) 60%, transparent);
		}
	}

	.ticket-tab-glow {
		animation: ticketTabGlow 2s ease-in-out infinite;
	}
</style>
