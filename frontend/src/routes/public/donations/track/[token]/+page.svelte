<script lang="ts">
	import { page } from '$app/stores';
	import { resolve } from '$app/paths';
	import { onMount } from 'svelte';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import QrCode from '@lucide/svelte/icons/qr-code';
	import Calendar from '@lucide/svelte/icons/calendar';
	import User from '@lucide/svelte/icons/user';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import AlertCircle from '@lucide/svelte/icons/alert-circle';
	import ShieldAlert from '@lucide/svelte/icons/shield-alert';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import { Button } from '$lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';

	let { data }: { data: { token: string } } = $props();
	const token = $derived(data.token);

	interface TrackDonationItem {
		item_id?: string;
		free_text?: string;
		category?: string;
		qty?: string | number;
		unit?: string;
		condition?: string;
		note?: string;
	}
	interface TrackDonation {
		status: string;
		booking_ref?: string;
		shelter_code?: string;
		donor: { name?: string; phone?: string | null; email?: string | null; line_id?: string | null };
		items?: TrackDonationItem[];
		logistics?: {
			delivery_method?: string;
			vehicle?: string;
			slot?: { date: string; from: string; to: string } | null;
			eta?: string | null;
			courier_tracking_no?: string | null;
		};
		received_summary?: unknown;
		created_at?: string;
		expires_at?: string;
	}

	let realDonation = $state<TrackDonation | null>(null);
	let isLoading = $state(true);
	let errorMsg = $state('');
	let isCancelModalOpen = $state(false);

	async function loadDonation() {
		isLoading = true;
		errorMsg = '';
		try {
			const res = await fetch(`/api/public/v1/donations/${encodeURIComponent(token)}`);
			const resData = await res.json();
			if (resData.success && resData.donation) {
				realDonation = resData.donation;
			} else {
				errorMsg = resData.error || 'ไม่พบข้อมูลการบริจาค';
			}
		} catch (e) {
			console.error('Failed to fetch donation:', e);
			errorMsg = 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์';
		} finally {
			isLoading = false;
		}
	}

	onMount(async () => {
		await loadDonation();
		const action = $page.url.searchParams.get('action');
		if (
			action === 'cancel' &&
			realDonation &&
			(realDonation.status === 'declared' || realDonation.status === 'pending')
		) {
			isCancelModalOpen = true;
		}
	});

	let request = $derived.by(() => {
		if (realDonation) {
			const d = realDonation;
			const methodMap: Record<string, string> = {
				self_dropoff: 'นำมาส่งด้วยตนเอง',
				parcel: 'ส่งผ่านขนส่งพัสดุ',
				shelter_pickup: 'รถศูนย์ไปรับ'
			};
			const vehicleMap: Record<string, string> = {
				motorcycle: 'รถจักรยานยนต์',
				car: 'รถยนต์',
				pickup: 'รถกระบะ',
				truck: 'รถบรรทุก'
			};

			const slotInfo = d.logistics?.slot
				? `${d.logistics.slot.date} (${d.logistics.slot.from} - ${d.logistics.slot.to})`
				: d.logistics?.eta || 'ไม่ระบุนัดหมาย';

			const phoneStr = d.donor.phone ? ` โทร. ${d.donor.phone}` : '';
			const emailStr = d.donor.email ? ` อีเมล ${d.donor.email}` : '';
			const lineStr = d.donor.line_id ? ` Line: ${d.donor.line_id}` : '';

			return {
				refId: d.booking_ref || token,
				donorName: d.donor.name || 'ผู้บริจาคทั่วไป',
				donorSubtitle: '',
				status: d.status,
				submittedTime: d.created_at ? new Date(d.created_at).toLocaleString('th-TH') : '',
				itemsList: (d.items || []).map((i: TrackDonationItem) => ({
					name: i.free_text || 'สิ่งของทั่วไป',
					qty: i.qty || 0,
					unit: i.unit || 'ชิ้น'
				})),
				statement:
					(d.items || [])
						.map((i: TrackDonationItem) => i.note)
						.filter(Boolean)
						.join(', ') || 'ไม่มีหมายเหตุเพิ่มเติม',
				vehicle:
					vehicleMap[d.logistics?.vehicle ?? ''] ||
					methodMap[d.logistics?.delivery_method ?? ''] ||
					'ไม่ระบุวิธีจัดส่ง',
				location: `ศูนย์รหัส ${d.shelter_code}`,
				schedule: slotInfo,
				contact: `${d.donor.name}${phoneStr}${emailStr}${lineStr}`,
				triggerReason: undefined
			};
		}

		return {
			refId: token,
			donorName: '',
			donorSubtitle: '',
			status: 'declared' as const,
			submittedTime: '',
			itemsList: [],
			statement: '',
			vehicle: '',
			location: '',
			schedule: '',
			contact: ''
		};
	});

	async function handleCancelDonation() {
		try {
			const res = await fetch(`/api/public/v1/donations/${encodeURIComponent(token)}`, {
				method: 'DELETE'
			});
			const resData = await res.json();
			if (resData.success) {
				toast.success(`ยกเลิกคำขอบริจาค ${token} สำเร็จแล้ว`);
				await loadDonation();
			} else {
				toast.error(resData.error || 'ยกเลิกคำขอบริจาคไม่สำเร็จ');
			}
		} catch (e) {
			console.error(e);
			toast.error('เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
		} finally {
			isCancelModalOpen = false;
		}
	}
</script>

<svelte:head>
	<title>รายละเอียดสถานะของบริจาค {token} — Smart Shelter</title>
</svelte:head>

<div class="mx-auto max-w-3xl px-4 py-8 md:py-12">
	<!-- Navigation Header -->
	<a
		href={resolve('/public/donations/track')}
		class="mb-6 inline-flex items-center gap-2 text-xs font-bold text-muted-foreground transition-colors hover:text-foreground"
	>
		<ArrowLeft class="h-3.5 w-3.5" />
		กลับหน้ารายการค้นหา
	</a>

	<!-- Details Card -->
	<div class="overflow-hidden rounded-3xl border border-border bg-card text-foreground shadow-xl">
		{#if isLoading}
			<div class="flex flex-col items-center justify-center p-12 text-muted-foreground">
				<svg
					class="h-8 w-8 animate-spin text-primary"
					xmlns="http://www.w3.org/2000/svg"
					fill="none"
					viewBox="0 0 24 24"
				>
					<circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"
					></circle>
					<path
						class="opacity-75"
						fill="currentColor"
						d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
					></path>
				</svg>
				<p class="mt-4 text-xs font-bold">กำลังโหลดข้อมูลสถานะการจอง...</p>
			</div>
		{:else if errorMsg}
			<div class="flex flex-col items-center justify-center p-12 text-center">
				<AlertCircle class="h-10 w-10 text-destructive" />
				<h3 class="mt-4 text-sm font-bold text-foreground">ไม่สามารถโหลดข้อมูลได้</h3>
				<p class="mt-2 text-xs text-muted-foreground">{errorMsg}</p>
			</div>
		{:else}
			<!-- Ticket header -->
			<div
				class="flex flex-col gap-4 border-b border-border/20 bg-zinc-950 p-6 text-white sm:flex-row sm:items-center sm:justify-between"
			>
				<div>
					<div class="flex items-center gap-2">
						<QrCode class="h-4.5 w-4.5 text-primary" />
						<span class="text-xs font-medium text-zinc-400"
							>รหัสติดตามของบริจาค (Tracking Token)</span
						>
					</div>
					<h2 class="mt-1 text-xl font-extrabold text-white">{request.refId}</h2>
				</div>
				<!-- Status Badges -->
				<div>
					{#if request.status === 'declared'}
						<span
							class="inline-flex items-center gap-1.5 rounded-full border border-blue-500/20 bg-blue-500/10 px-3.5 py-1 text-xs font-bold text-blue-500"
						>
							<span class="h-1.5 w-1.5 rounded-full bg-blue-500"></span>
							จองคิวบริจาคแล้ว (Declared)
						</span>
					{:else if request.status === 'pending'}
						<span
							class="inline-flex items-center gap-1.5 rounded-full border border-amber-500/20 bg-amber-500/10 px-3.5 py-1 text-xs font-bold text-amber-500"
						>
							<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-500"></span>
							รอตรวจสอบความเหมาะสม (Pending)
						</span>
					{:else if request.status === 'received'}
						<span
							class="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-3.5 py-1 text-xs font-bold text-emerald-500"
						>
							<span class="h-1.5 w-1.5 rounded-full bg-emerald-500"></span>
							รับเข้าคลังเรียบร้อย (Received)
						</span>
					{:else if request.status === 'cancelled'}
						<span
							class="inline-flex items-center gap-1.5 rounded-full border border-zinc-500/20 bg-zinc-500/10 px-3.5 py-1 text-xs font-bold text-zinc-500"
						>
							<span class="h-1.5 w-1.5 rounded-full bg-zinc-400"></span>
							ยกเลิกการจองแล้ว (Cancelled)
						</span>
					{/if}
				</div>
			</div>
			<!-- Body Contents -->
			<div class="space-y-8 p-6 md:p-8">
				<!-- 1. Safety trigger warning if pending -->
				{#if request.status === 'pending' && request.triggerReason}
					<div
						class="flex items-start gap-3 rounded-2xl border border-amber-500/20 bg-amber-500/5 p-4 text-amber-800 dark:text-amber-300"
					>
						<ShieldAlert class="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
						<div>
							<h4
								class="text-xs font-bold tracking-wider text-amber-600 uppercase dark:text-amber-400"
							>
								อยู่ระหว่างตรวจสอบข้อควรระวัง
							</h4>
							<p class="mt-1 text-xs leading-relaxed font-bold">{request.triggerReason}</p>
						</div>
					</div>
				{/if}
				<!-- 2. Interactive Status Timeline -->
				<div class="space-y-4">
					<h4 class="text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase">
						ไทม์ไลน์สถานะการส่งมอบ (Timeline Status)
					</h4>
					<div
						class="relative space-y-6 pl-6 before:absolute before:top-2 before:bottom-2 before:left-[11px] before:w-0.5 before:bg-border/60"
					>
						<!-- Step 1: Declared -->
						<div class="relative flex gap-4">
							<div
								class="absolute -left-[20px] z-10 flex h-3 w-3 items-center justify-center rounded-full border-2 border-primary bg-card {request.status !==
								'cancelled'
									? 'bg-primary'
									: 'border-zinc-400 bg-zinc-400'}"
							></div>
							<div class="text-xs">
								<span class="font-bold text-foreground">ส่งข้อมูลบริจาคสำเร็จ (Declared)</span>
								<p class="mt-0.5 text-[10px] text-muted-foreground">
									คำขอบริจาคเข้าระบบแล้วเมื่อ {request.submittedTime}
								</p>
							</div>
						</div>
						<!-- Step 2: Pending/Checking if applicable -->
						{#if request.status === 'pending'}
							<div class="relative flex gap-4">
								<div
									class="absolute -left-[20px] z-10 flex h-3 w-3 animate-ping items-center justify-center rounded-full border-2 border-amber-500 bg-amber-500"
								></div>
								<div
									class="absolute -left-[20px] z-10 flex h-3 w-3 items-center justify-center rounded-full border-2 border-amber-500 bg-amber-500"
								></div>
								<div class="text-xs">
									<span class="font-bold text-amber-600 dark:text-amber-400"
										>อยู่ระหว่างประเมินพื้นที่คลังและความเหมาะสม</span
									>
									<p class="mt-0.5 text-[10px] text-muted-foreground">
										เจ้าหน้าที่กำลังตรวจสอบรายการเพื่ออนุมัติเข้าจัดเก็บในคลังปลายทาง
									</p>
								</div>
							</div>
						{/if}
						<!-- Step 2/3: Cancelled or Received -->
						{#if request.status === 'cancelled'}
							<div class="relative flex gap-4">
								<div
									class="absolute -left-[20px] z-10 flex h-3 w-3 items-center justify-center rounded-full border-2 border-red-500 bg-red-500"
								></div>
								<div class="text-xs">
									<span class="font-bold text-red-600">ยกเลิกรายการบริจาคนี้แล้ว (Cancelled)</span>
									<p class="mt-0.5 text-[10px] text-muted-foreground">
										ผู้บริจาคขอยกเลิกคิวจองบริจาคเรียบร้อยแล้ว โควต้าถูกคืนระบบ
									</p>
								</div>
							</div>
						{:else}
							<div class="relative flex gap-4">
								<div
									class="absolute -left-[20px] z-10 flex h-3 w-3 items-center justify-center rounded-full border-2 {request.status ===
									'received'
										? 'border-emerald-600 bg-emerald-600'
										: 'border-border bg-card'}"
								></div>
								<div class="text-xs {request.status !== 'received' ? 'opacity-50' : ''}">
									<span class="font-bold text-foreground"
										>ตรวจรับของเข้าคลังเรียบร้อย (Received)</span
									>
									<p class="mt-0.5 text-[10px] text-muted-foreground">
										เจ้าหน้าที่คัดแยกพัสดุและบันทึกยอดพัสดุเข้าคลังคงเหลือแล้ว
									</p>
								</div>
							</div>
						{/if}
					</div>
				</div>
				<!-- 3. Items and Donor Details -->
				<div class="grid grid-cols-1 gap-6 md:grid-cols-2">
					<!-- Donor Details -->
					<div class="space-y-4">
						<h4 class="text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase">
							ข้อมูลผู้บริจาคและการนัดหมาย
						</h4>
						<div class="space-y-3.5 rounded-2xl border border-border bg-card p-4 text-xs">
							<div class="flex gap-2.5">
								<User class="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
								<div>
									<span class="text-[10px] font-bold text-muted-foreground uppercase"
										>ผู้ประสงค์บริจาค</span
									>
									<p class="mt-0.5 font-bold text-foreground">
										{request.donorName}
										{request.donorSubtitle}
									</p>
								</div>
							</div>
							<div class="flex gap-2.5">
								<Calendar class="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
								<div>
									<span class="text-[10px] font-bold text-muted-foreground uppercase"
										>เวลานัดหมายจัดส่ง</span
									>
									<p class="mt-0.5 font-semibold text-foreground">{request.schedule}</p>
								</div>
							</div>
							<div class="flex gap-2.5">
								<MapPin class="h-4.5 w-4.5 shrink-0 text-muted-foreground" />
								<div>
									<span class="text-[10px] font-bold text-muted-foreground uppercase"
										>คลังพัสดุปลายทาง</span
									>
									<p class="mt-0.5 font-semibold text-foreground">
										{request.location} ({request.vehicle})
									</p>
								</div>
							</div>
						</div>
					</div>
					<!-- Items Table -->
					<div class="space-y-4">
						<h4 class="text-[11px] font-extrabold tracking-wider text-muted-foreground uppercase">
							รายการสิ่งของที่บริจาคทั้งหมด
						</h4>
						<div class="overflow-hidden rounded-2xl border border-border bg-card text-xs">
							<table class="w-full border-collapse text-left">
								<thead>
									<tr
										class="border-b border-border bg-muted/30 text-[10px] font-bold text-muted-foreground uppercase"
									>
										<th class="px-4 py-2.5">รายการสิ่งของ</th>
										<th class="px-4 py-2.5 text-right">จำนวน</th>
										<th class="px-4 py-2.5">หน่วย</th>
									</tr>
								</thead>
								<tbody class="divide-y divide-border/60 font-semibold text-foreground">
									{#each request.itemsList as item (item.name)}
										<tr>
											<td class="px-4 py-3">{item.name}</td>
											<td class="px-4 py-3 text-right">{item.qty.toLocaleString()}</td>
											<td class="px-4 py-3 text-muted-foreground">{item.unit}</td>
										</tr>
									{/each}
								</tbody>
							</table>
						</div>
					</div>
				</div>
			</div>
			<!-- Action Footer -->
			{#if request.status === 'declared' || request.status === 'pending'}
				<div class="flex justify-end border-t border-border/60 bg-muted/10 p-5">
					<Button
						onclick={() => (isCancelModalOpen = true)}
						variant="outline"
						class="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-red-200 px-4 py-2.5 text-xs font-bold text-red-600 transition-colors hover:bg-red-50 dark:hover:bg-red-950/20"
					>
						<Trash2 class="h-4 w-4" />
						ยกเลิกคิวจองบริจาคนี้
					</Button>
				</div>
			{/if}
		{/if}
	</div>
</div>

<!-- Cancellation Confirmation Dialog -->
{#if isCancelModalOpen}
	<div
		class="fixed inset-0 z-50 flex animate-in items-center justify-center bg-black/40 p-4 backdrop-blur-xs duration-200 fade-in"
		role="button"
		tabindex="0"
		onclick={() => (isCancelModalOpen = false)}
		onkeydown={(e) => {
			if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') isCancelModalOpen = false;
		}}
	>
		<div
			class="relative w-full max-w-md animate-in cursor-default rounded-3xl border border-border bg-card p-6 text-left text-foreground shadow-2xl duration-200 zoom-in-95"
			role="dialog"
			aria-modal="true"
			tabindex="-1"
			onclick={(e) => e.stopPropagation()}
			onkeydown={(e) => e.stopPropagation()}
		>
			<div class="mb-4 flex items-start gap-3">
				<div
					class="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-danger-muted text-danger dark:bg-danger/20"
				>
					<AlertCircle class="h-5 w-5" />
				</div>
				<div>
					<h3 class="text-sm font-bold text-foreground">ยืนยันการยกเลิกคำขอบริจาค?</h3>
					<p class="mt-1 text-xs leading-relaxed text-muted-foreground">
						การกดยกเลิกจองบริจาค รหัสอ้างอิง <span class="font-mono font-bold text-foreground"
							>{request.refId}</span
						>
						จะไม่สามารถแก้ไขคืนค่าได้อีก โควต้าสิ่งของจะถูกคืนระบบเพื่อเปิดโอกาสให้ผู้บริจาคท่านอื่นต่อไป
					</p>
				</div>
			</div>
			<div class="mt-6 flex justify-end gap-2.5 border-t border-border/60 pt-4">
				<button
					type="button"
					onclick={() => (isCancelModalOpen = false)}
					class="cursor-pointer rounded-xl border border-border px-4 py-2.5 text-xs font-bold text-foreground transition-colors hover:bg-muted"
				>
					ไม่ยกเลิก
				</button>
				<button
					type="button"
					onclick={handleCancelDonation}
					class="hover:bg-danger-dark cursor-pointer rounded-xl bg-danger px-5 py-2.5 text-xs font-bold text-white transition-colors"
				>
					ยืนยันยกเลิกจอง
				</button>
			</div>
		</div>
	</div>
{/if}
