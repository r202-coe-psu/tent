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
	// All mock databases
	let allMockData = $state<
		Record<
			string,
			{
				refId: string;
				donorName: string;
				donorSubtitle: string;
				status: 'declared' | 'pending' | 'received' | 'cancelled';
				submittedTime: string;
				triggerReason?: string;
				itemsList: { name: string; qty: number; unit: string }[];
				statement: string;
				vehicle: string;
				location: string;
				schedule: string;
				contact: string;
			}
		>
	>({
		'DN-582910': {
			refId: 'DN-582910',
			donorName: 'คุณสมชาย ใจดี',
			donorSubtitle: '',
			status: 'declared',
			submittedTime: '22 มิถุนายน 2026 10:00 น.',
			itemsList: [
				{ name: 'น้ำดื่ม 1.5L', qty: 50, unit: 'แพ็ค' },
				{ name: 'ปลากระป๋อง', qty: 100, unit: 'กระป๋อง' }
			],
			statement: 'น้ำดื่มและปลากระป๋องบรรจุกล่องพร้อมขนส่ง สภาพสมบูรณ์และไม่มีการชำรุด',
			vehicle: 'รถกระบะส่วนบุคคล',
			location: 'คลังช่วยเหลือภัยพิบัติ EOC',
			schedule: '23 มิถุนายน 2026 (ช่วงเวลา 10:00 - 12:00 น.)',
			contact: 'คุณสมชาย ใจดี โทร. 081-234-5678 somchai@gmail.com'
		},
		'RQ-9901': {
			refId: 'RQ-9901',
			donorName: 'มูลนิธิใจบุญอารี',
			donorSubtitle: '(ล็อตใหญ่พิเศษ)',
			status: 'pending',
			submittedTime: '22 มิถุนายน 2026 09:00 น.',
			triggerReason: 'โควต้าล็อตใหญ่เกินขีดจำกัดหน่วยคลังย่อยปกติ (Over-Limit Volume)',
			itemsList: [
				{ name: 'เสื้อผ้าเครื่องนุ่งห่มมือสอง', qty: 5, unit: 'รถบรรทุก' },
				{ name: 'ข้าวสารหอมมะลิ', qty: 10, unit: 'ตัน' }
			],
			statement:
				'เครื่องนุ่งห่มคัดแยกสภาพพร้อมใช้งานบรรจุกล่องกระดาษขนาดกลาง 250 กล่อง และข้าวสารขาวหอมมะลิอบพ่นฆ่ามอดบรรจุถุงพลาสติกหนาถุงละ 5 กิโลกรัม จำนวน 2,000 ถุง มีน้ำหนักรวมประมาณ 10,000 กิโลกรัม (10 ตัน) จำเป็นต้องเตรียมพนักงานยกขนย้ายและหาพาหนะรองรับวางเฉพาะเพื่อกันความชื้นและสะสม',
			vehicle: 'รถบรรทุกสิบล้อทะเบียนส่งออกพิเศษ (ต้องการจุดเลี่ยงรถติด)',
			location: 'อาคารคลังสินค้าอเนกประสงค์ (โซนปีกกลางแจ้ง)',
			schedule: '13 มิถุนายน 2026 (ช่วงเวลา 10:00 น. เป็นต้นไป)',
			contact: 'คุณพิมพ์มาดา (ผู้ประสานงาน) โทร. 081-456-7890 contact@jaiboon-foundation.or.th'
		},
		'DN-111111': {
			refId: 'DN-111111',
			donorName: 'นางสมศรี มั่งมี',
			donorSubtitle: '',
			status: 'received',
			submittedTime: '21 มิถุนายน 2026 08:00 น.',
			itemsList: [
				{ name: 'ข้าวสาร (5 กก.)', qty: 10, unit: 'ถุง' },
				{ name: 'บะหมี่กึ่งสำเร็จรูป', qty: 5, unit: 'กล่อง' }
			],
			statement: 'ข้าวสารและบะหมี่สำเร็จรูปใหม่ ยังไม่หมดอายุ สะอาดเรียบร้อย',
			vehicle: 'รถส่วนบุคคล',
			location: 'คลังช่วยเหลือภัยพิบัติ EOC',
			schedule: '21 มิถุนายน 2026 (ช่วงเวลา 14:00 น.)',
			contact: 'นางสมศรี มั่งมี โทร. 082-345-6789 somศรี@hotmail.com'
		},
		'DN-222222': {
			refId: 'DN-222222',
			donorName: 'นายสมศักดิ์ รักชาติ',
			donorSubtitle: '',
			status: 'cancelled',
			submittedTime: '20 มิถุนายน 2026 12:00 น.',
			itemsList: [{ name: 'ผ้าห่มกันหนาว', qty: 20, unit: 'ผืน' }],
			statement: 'ผ้าห่มสภาพใหม่ บรรจุในถุงพลาสติกแยกผืนเรียบร้อย',
			vehicle: 'รถส่วนบุคคล',
			location: 'คลังย่อยโรงเรียนเทศบาล 2',
			schedule: '20 มิถุนายน 2026 (ช่วงเวลา 13:00 น.)',
			contact: 'นายสมศักดิ์ รักชาติ โทร. 083-456-7890 somsak@gmail.com'
		}
	});
	// Get current active request based on token
	let request = $derived.by(() => {
		if (allMockData[token]) {
			return allMockData[token];
		}
		// Return dynamic default mock if it's a random token input
		return {
			refId: token,
			donorName: 'ผู้บริจาคทั่วไป (จำลองรหัสใหม่)',
			donorSubtitle: '',
			status: 'declared' as const,
			submittedTime: 'เมื่อสักครู่นี้',
			itemsList: [
				{ name: 'หน้ากากอนามัย', qty: 200, unit: 'ชิ้น' },
				{ name: 'เจลล้างมือ', qty: 10, unit: 'ขวด' }
			],
			statement: 'จำลองข้อมูลพัสดุสำหรับรหัสติดตามพิเศษที่คุณกำหนดขึ้น',
			vehicle: 'รถส่วนบุคคล',
			location: 'คลังช่วยเหลือภัยพิบัติ EOC',
			schedule: 'นัดหมายด่วนวันนี้',
			contact: 'ผู้บริจาคระบบทดลอง'
		};
	});
	let isCancelModalOpen = $state(false);
	onMount(() => {
		const action = $page.url.searchParams.get('action');
		if (action === 'cancel' && (request.status === 'declared' || request.status === 'pending')) {
			isCancelModalOpen = true;
		}
	});
	function handleCancelDonation() {
		// Update status locally for mockup interactivity
		if (allMockData[token]) {
			allMockData[token].status = 'cancelled';
		} else {
			// Add to local database if not exists
			allMockData[token] = {
				...request,
				status: 'cancelled'
			};
		}
		isCancelModalOpen = false;
		toast.success(`ยกเลิกคำขอบริจาค ${token} สำเร็จแล้ว`);
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
		<!-- Ticket header -->
		<div
			class="flex flex-col gap-4 border-b border-border/20 bg-zinc-950 p-6 text-white sm:flex-row sm:items-center sm:justify-between"
		>
			<div>
				<div class="flex items-center gap-2">
					<QrCode class="h-4.5 w-4.5 text-primary" />
					<span class="text-xs font-medium text-zinc-400">รหัสติดตามของบริจาค (Tracking Token)</span
					>
				</div>
				<h2 class="mt-1 text-xl font-extrabold text-white">{request.refId}</h2>
			</div>
			<!-- Status Badges -->
			<div>
				{#if request.status === 'declared'}
					<span
						class="inline-flex items-center gap-1.5 rounded-full border border-primary/20 bg-primary/10 px-3.5 py-1 text-xs font-bold text-primary"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-primary"></span>
						จองคิวบริจาคแล้ว (Declared)
					</span>
				{:else if request.status === 'pending'}
					<span
						class="inline-flex items-center gap-1.5 rounded-full border border-warning/20 bg-warning/10 px-3.5 py-1 text-xs font-bold text-warning"
					>
						<span class="h-1.5 w-1.5 animate-pulse rounded-full bg-warning"></span>
						รอตรวจสอบความเหมาะสม (Pending)
					</span>
				{:else if request.status === 'received'}
					<span
						class="inline-flex items-center gap-1.5 rounded-full border border-success/20 bg-success/10 px-3.5 py-1 text-xs font-bold text-success"
					>
						<span class="h-1.5 w-1.5 rounded-full bg-success"></span>
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
					class="flex items-start gap-3 rounded-2xl border border-warning/20 bg-warning/5 p-4 text-warning-dark dark:text-warning-subtle"
				>
					<ShieldAlert
						class="mt-0.5 h-5 w-5 shrink-0 text-warning-foreground dark:text-warning-subtle"
					/>
					<div>
						<h4
							class="text-xs font-bold tracking-wider text-warning-foreground uppercase dark:text-warning-subtle"
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
								class="absolute -left-[20px] z-10 flex h-3 w-3 animate-ping items-center justify-center rounded-full border-2 border-warning bg-warning"
							></div>
							<div
								class="absolute -left-[20px] z-10 flex h-3 w-3 items-center justify-center rounded-full border-2 border-warning bg-warning"
							></div>
							<div class="text-xs">
								<span class="font-bold text-warning-foreground dark:text-warning-subtle"
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
								class="absolute -left-[20px] z-10 flex h-3 w-3 items-center justify-center rounded-full border-2 border-danger bg-danger"
							></div>
							<div class="text-xs">
								<span class="font-bold text-danger">ยกเลิกรายการบริจาคนี้แล้ว (Cancelled)</span>
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
									? 'border-success bg-success-dark'
									: 'border-border bg-card'}"
							></div>
							<div class="text-xs {request.status !== 'received' ? 'opacity-50' : ''}">
								<span class="font-bold text-foreground">ตรวจรับของเข้าคลังเรียบร้อย (Received)</span
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
					class="inline-flex cursor-pointer items-center gap-1.5 rounded-xl border border-danger-border px-4 py-2.5 text-xs font-bold text-danger transition-colors hover:bg-danger-muted dark:hover:bg-danger/10"
				>
					<Trash2 class="h-4 w-4" />
					ยกเลิกคิวจองบริจาคนี้
				</Button>
			</div>
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
