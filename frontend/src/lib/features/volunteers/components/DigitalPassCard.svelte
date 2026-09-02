<script lang="ts">
	import { generateQrDataUrl } from '$lib/utils/qrcode';
	import Download from '@lucide/svelte/icons/download';
	import Link from '@lucide/svelte/icons/link';
	import XCircle from '@lucide/svelte/icons/x-circle';
	import CheckCircle2 from '@lucide/svelte/icons/check-circle-2';
	import Clock from '@lucide/svelte/icons/clock';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import User from '@lucide/svelte/icons/user';
	import Phone from '@lucide/svelte/icons/phone';
	import { toast } from 'svelte-sonner';

	let { ticket } = $props<{
		ticket: {
			token: string;
			jobTitle: string;
			shelter: string;
			appliedAt: string;
			status: 'confirmed' | 'pending_review' | 'cancelled';
			date: string;
			time: string;
			meetingPoint: string;
			applicantName: string;
			maskedPhone: string;
		};
	}>();

	let qrDataUrl = $state<string>('');

	// Generate QR Code from Volunteer ID / tracking token
	$effect(() => {
		const payload = ticket.token;
		if (payload) {
			generateQrDataUrl(payload, {
				width: 360,
				margin: 2,
				color: {
					dark: '#0f172a',
					light: '#ffffff'
				}
			})
				.then((url: string) => {
					qrDataUrl = url;
				})
				.catch((err: unknown) => {
					console.error('Failed to generate QR code:', err);
				});
		}
	});

	function downloadQR() {
		if (!qrDataUrl) return;
		const a = document.createElement('a');
		a.href = qrDataUrl;
		a.download = `volunteer-pass-${ticket.token}.png`;
		a.click();
		toast.success('ดาวน์โหลดรูปภาพ QR Code เรียบร้อยแล้ว');
	}

	function copyLink() {
		if (typeof window !== 'undefined') {
			navigator.clipboard.writeText(window.location.href);
			toast.success('คัดลอกลิงก์ตั๋วดิจิทัลเรียบร้อยแล้ว');
		}
	}
</script>

<div class="mx-auto max-w-md overflow-hidden rounded-3xl border border-border bg-card shadow-lg">
	<!-- Header / Status Banner -->
	<div
		class="px-6 py-4 text-center
		{ticket.status === 'confirmed' ? 'bg-success/15' : ''}
		{ticket.status === 'pending_review' ? 'bg-warning/15' : ''}
		{ticket.status === 'cancelled' ? 'bg-muted' : ''}"
	>
		{#if ticket.status === 'confirmed'}
			<div class="flex items-center justify-center gap-2 text-success">
				<CheckCircle2 class="h-5 w-5" />
				<span class="font-bold">ยืนยันแล้ว (Confirmed)</span>
			</div>
		{:else if ticket.status === 'pending_review'}
			<div class="flex items-center justify-center gap-2 text-warning-foreground">
				<Clock class="h-5 w-5" />
				<span class="font-bold">รอการพิจารณา (Pending Review)</span>
			</div>
		{:else}
			<div class="flex items-center justify-center gap-2 text-muted-foreground">
				<XCircle class="h-5 w-5" />
				<span class="font-bold">ยกเลิกแล้ว (Cancelled)</span>
			</div>
		{/if}
	</div>

	<!-- QR Code Section -->
	<div class="flex flex-col items-center border-b border-border/50 px-6 py-8">
		<h2 class="mb-1 text-center text-xl font-bold text-foreground">{ticket.jobTitle}</h2>
		<p class="mb-6 text-center text-sm text-muted-foreground">{ticket.shelter}</p>

		<!-- Real Generated QR Code -->
		<div class="rounded-3xl border-4 border-muted/40 bg-white p-4 shadow-inner">
			{#if qrDataUrl}
				<img
					src={qrDataUrl}
					alt="QR Code รหัสอาสาสมัคร: {ticket.token}"
					class="h-48 w-48 object-contain"
				/>
			{:else}
				<div class="flex h-48 w-48 items-center justify-center bg-white">
					<span class="animate-pulse text-xs text-muted-foreground">กำลังสร้าง QR Code...</span>
				</div>
			{/if}
		</div>

		<div class="mt-4 text-center">
			<p class="mb-1 text-xs text-muted-foreground">รหัสอาสาสมัคร / Token</p>
			<p class="font-mono text-lg font-black tracking-wider text-foreground">{ticket.token}</p>
		</div>
	</div>

	<!-- Appointment Details -->
	<div class="bg-muted/10 px-6 py-5">
		<div class="space-y-4">
			<div class="flex items-start gap-3">
				<CalendarDays class="mt-0.5 h-4.5 w-4.5 shrink-0 text-primary" />
				<div>
					<p class="text-xs text-muted-foreground">วันที่ปฏิบัติงาน</p>
					<p class="text-sm font-bold text-foreground">{ticket.date}</p>
				</div>
			</div>
			<div class="flex items-start gap-3">
				<Clock class="mt-0.5 h-4.5 w-4.5 shrink-0 text-primary" />
				<div>
					<p class="text-xs text-muted-foreground">เวลากะงาน</p>
					<p class="text-sm font-bold text-foreground">{ticket.time}</p>
				</div>
			</div>
			<div class="flex items-start gap-3">
				<MapPin class="mt-0.5 h-4.5 w-4.5 shrink-0 text-primary" />
				<div>
					<p class="text-xs text-muted-foreground">จุดนัดพบ</p>
					<p class="text-sm font-bold text-foreground">{ticket.meetingPoint}</p>
				</div>
			</div>
		</div>

		<div class="my-5 border-t border-dashed border-border/70"></div>

		<!-- Personal Details (Masked for Privacy) -->
		<div class="space-y-3">
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<User class="h-4 w-4 text-muted-foreground" />
					<span class="text-xs text-muted-foreground">ชื่อผู้สมัคร</span>
				</div>
				<span class="text-sm font-medium text-foreground">{ticket.applicantName}</span>
			</div>
			<div class="flex items-center justify-between">
				<div class="flex items-center gap-2">
					<Phone class="h-4 w-4 text-muted-foreground" />
					<span class="text-xs text-muted-foreground">เบอร์โทรศัพท์</span>
				</div>
				<span class="text-sm font-medium tracking-widest text-foreground">{ticket.maskedPhone}</span
				>
			</div>
			<p class="mt-2 text-center text-2xs text-muted-foreground/70">
				* ข้อมูลส่วนบุคคลบางส่วนถูกปกปิดเพื่อความปลอดภัย (PDPA)
			</p>
		</div>
	</div>

	<!-- Actions -->
	<div class="grid grid-cols-2 gap-2 bg-muted/20 p-4 sm:grid-cols-3">
		<button
			type="button"
			onclick={downloadQR}
			class="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card p-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
		>
			<Download class="h-4 w-4" />
			บันทึกรูป QR
		</button>
		<button
			type="button"
			onclick={copyLink}
			class="flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card p-3 text-xs font-medium text-foreground transition-colors hover:bg-muted"
		>
			<Link class="h-4 w-4" />
			คัดลอกลิงก์
		</button>
		<button
			type="button"
			onclick={() => {
				if (confirm('คุณต้องการยกเลิกการสมัครกะนี้ใช่หรือไม่?')) {
					toast.info('ส่งคำขอยกเลิกเรียบร้อยแล้ว');
				}
			}}
			class="col-span-2 flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border border-border bg-card p-3 text-xs font-medium text-danger transition-colors hover:bg-danger-muted/30 sm:col-span-1"
		>
			<XCircle class="h-4 w-4" />
			ยกเลิกกะ
		</button>
	</div>
</div>
