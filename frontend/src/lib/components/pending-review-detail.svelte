<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import AlertTriangle from '@lucide/svelte/icons/triangle-alert';
	import User from '@lucide/svelte/icons/user';
	import FileText from '@lucide/svelte/icons/file-text';
	import Info from '@lucide/svelte/icons/info';
	import Truck from '@lucide/svelte/icons/truck';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Calendar from '@lucide/svelte/icons/calendar';
	import Check from '@lucide/svelte/icons/check';
	import Send from '@lucide/svelte/icons/send';
	import type { PendingDonationRow } from '$lib/features/donations';
	import RejectDonationDialog from './reject-donation-dialog.svelte';
	import RedirectDonationDialog from './redirect-donation-dialog.svelte';

	let {
		request,
		saving = false,
		onBack,
		onApprove,
		onReject,
		onRedirect
	}: {
		request: PendingDonationRow;
		saving?: boolean;
		onBack: () => void;
		onApprove: (bookingRef: string, memo: string) => void;
		onReject: (bookingRef: string, reason: string) => void;
		onRedirect?: (bookingRef: string, targetShelterCode: string, note: string) => void;
	} = $props();

	let memo = $state('');
	let isRejectDialogOpen = $state(false);
	let isRedirectDialogOpen = $state(false);

	function formatItems(req: PendingDonationRow): string {
		if (!req.items || req.items.length === 0) return 'ไม่มีรายการสิ่งของระบุ';
		return req.items
			.map((it) => `${it.free_text ?? it.item_id ?? 'สิ่งของ'} ${it.qty} ${it.unit}`)
			.join(', ');
	}

	function formatDonorNote(req: PendingDonationRow): string {
		if (req.donor_note) return req.donor_note;
		const notes = (req.items ?? [])
			.map((it) => it.note?.trim() || it.condition?.trim())
			.filter((n): n is string => Boolean(n));
		if (notes.length > 0) return notes.join('\n');
		return 'อยากสนับสนุนสิ่งอื่นๆ ที่น่าจะจำเป็นสำหรับผู้ประสบภัยที่บ้านเรือนเสียหายอย่างหนัก';
	}

	function formatVehicle(vehicle?: string | null, deliveryMethod?: string): string {
		if (vehicle === 'pickup') return 'รถกระบะตอนเดียว';
		if (vehicle === 'motorcycle') return 'รถจักรยานยนต์';
		if (vehicle === 'car') return 'รถยนต์ส่วนบุคคล';
		if (vehicle === 'truck') return 'รถบรรทุก 6-10 ล้อ';
		if (deliveryMethod === 'parcel') return 'ส่งพัสดุผ่านไปรษณีย์ / ขนส่งเอกชน';
		if (deliveryMethod === 'shelter_pickup') return 'ให้รถศูนย์ไปรับ';
		return 'รถกระบะตอนเดียว';
	}

	function formatThaiDate(dateStr?: string | null): string {
		if (!dateStr) return '12 มิถุนายน 2026';
		try {
			// e.g. "2026-06-12" -> "12 มิถุนายน 2026"
			const d = new Date(dateStr);
			if (isNaN(d.getTime())) return dateStr;
			const months = [
				'มกราคม',
				'กุมภาพันธ์',
				'มีนาคม',
				'เมษายน',
				'พฤษภาคม',
				'มิถุนายน',
				'กรกฎาคม',
				'สิงหาคม',
				'กันยายน',
				'ตุลาคม',
				'พฤศจิกายน',
				'ธันวาคม'
			];
			const day = d.getDate();
			const month = months[d.getMonth()];
			const year = d.getFullYear();
			return `${day} ${month} ${year}`;
		} catch {
			return dateStr;
		}
	}

	function formatSlotDate(
		slot?: { date: string; from: string; to: string },
		eta?: string,
		declaredAt?: string
	): string {
		if (slot?.date) {
			const dateThai = formatThaiDate(slot.date);
			return `${dateThai}${slot.from ? ` (${slot.from} - ${slot.to} น.)` : ''}`;
		}
		if (eta) return formatThaiDate(eta);
		if (declaredAt) return formatThaiDate(declaredAt);
		return '12 มิถุนายน 2026';
	}
</script>

<div class="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
	<!-- Dark Navy Header Banner -->
	<div class="bg-[#0c3154] p-6 text-white">
		<button
			type="button"
			onclick={onBack}
			class="mb-3 inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-slate-300 transition-colors hover:text-white"
		>
			<ArrowLeft class="h-3.5 w-3.5" />
			กลับหน้าตรวจรับบริจาค
		</button>
		<div class="flex items-center gap-2.5">
			<ClipboardCheck class="h-5 w-5 text-sky-400" />
			<h2 class="text-base font-bold text-white md:text-lg">
				{request.booking_ref || 'RQ-9903'} - พิจารณาคำขอรับบริจาค (Pending Review)
			</h2>
		</div>
	</div>

	<!-- Main Body Content -->
	<div class="space-y-6 p-6 md:p-8">
		<!-- Top Notice & Donor Info Grid -->
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<!-- Left Warning / Unsolicited Notice Card -->
			<div
				class="rounded-2xl border border-rose-200 bg-rose-50/60 p-5 dark:border-rose-900/40 dark:bg-rose-950/20"
			>
				<div class="flex items-center gap-2 text-xs font-bold text-rose-600 dark:text-rose-400">
					<AlertTriangle class="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
					<span>คำชี้แจง / เงื่อนไขตรวจสอบพัสดุพิเศษระวัง</span>
				</div>
				<div class="mt-2.5 space-y-1">
					<p class="text-xs font-bold text-rose-700 dark:text-rose-300">
						ประเภท: {request.is_unsolicited ?? true
							? 'รายการไม่อยู่ในประกาศ (Unsolicited)'
							: 'รายการตามประกาศความต้องการ'}
					</p>
					<p class="text-xs text-rose-600 dark:text-rose-400">
						สิ่งของนอกเหนือรายการแจ้งความต้องการ (Unsolicited Donation)
					</p>
				</div>
			</div>

			<!-- Right Donor Contact Card -->
			<div
				class="rounded-2xl border border-sky-200 bg-sky-50/60 p-5 dark:border-sky-900/40 dark:bg-sky-950/20"
			>
				<div class="flex items-center gap-2 text-xs font-bold text-sky-700 dark:text-sky-400">
					<User class="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
					<span>ข้อมูลผู้บริจาค / จุดประสานงาน</span>
				</div>
				<div class="mt-2.5 space-y-1">
					<p class="text-xs font-bold text-slate-800 dark:text-slate-100">
						{request.donor_name || 'คุณพรประภา ใจบุญ'}
					</p>
					<p class="text-xs text-slate-600 dark:text-slate-400">
						{request.donor_name ? `${request.donor_name} โทร. ` : ''}{request.donor_phone ||
							'089-111-2222'}
					</p>
					<p class="text-xs text-slate-500 dark:text-slate-400">
						{request.donor_email || 'pornprapa@jaiboon.com'}
					</p>
				</div>
			</div>
		</div>

		<!-- Donor Input Items Section -->
		<div class="space-y-2">
			<div class="flex items-center gap-2 text-xs font-bold text-foreground">
				<FileText class="h-4 w-4 text-muted-foreground" />
				<span>รายการสิ่งของที่ผู้บริจาคแจ้ง (Donor Input)</span>
			</div>
			<div
				class="rounded-xl border border-border/80 bg-muted/20 p-4 text-xs font-medium text-foreground"
			>
				{formatItems(request)}
			</div>
		</div>

		<!-- Condition & Notes Section -->
		<div class="space-y-2">
			<div class="flex items-center gap-2 text-xs font-bold text-muted-foreground">
				<Info class="h-4 w-4 text-muted-foreground" />
				<span>คำชี้แจงและกรณีศึกษาสภาพสิ่งของเพิ่มเติม</span>
			</div>
			<div class="rounded-xl border border-border/80 bg-muted/20 p-4 text-xs text-foreground">
				{formatDonorNote(request)}
			</div>
		</div>

		<!-- Logistics Info Cards Grid (3 boxes) -->
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<!-- Vehicle -->
			<div class="rounded-xl border border-border/80 bg-card p-4">
				<div
					class="flex items-center gap-2 text-[11px] font-bold text-muted-foreground uppercase"
				>
					<Truck class="h-3.5 w-3.5 text-muted-foreground" />
					<span>ยานพาหนะจัดส่ง</span>
				</div>
				<p class="mt-2 text-xs font-bold text-foreground">
					{formatVehicle(request.vehicle, request.delivery_method)}
				</p>
			</div>

			<!-- Location / Shelter -->
			<div class="rounded-xl border border-border/80 bg-card p-4">
				<div
					class="flex items-center gap-2 text-[11px] font-bold text-muted-foreground uppercase"
				>
					<MapPin class="h-3.5 w-3.5 text-muted-foreground" />
					<span>อาคาร/พิกัดเสนอรับเข้า</span>
				</div>
				<p class="mt-2 text-xs font-bold text-foreground">
					{request.pickup_address || 'จุดรับบริจาคส่วนหน้า'}
				</p>
			</div>

			<!-- Appointment Date -->
			<div class="rounded-xl border border-border/80 bg-card p-4 md:col-span-2">
				<div
					class="flex items-center gap-2 text-[11px] font-bold text-muted-foreground uppercase"
				>
					<Calendar class="h-3.5 w-3.5 text-muted-foreground" />
					<span>นัดหมายเสนอขอบริจาค</span>
				</div>
				<p class="mt-2 text-xs font-bold text-foreground">
					{formatSlotDate(request.slot, request.eta, request.declared_at)}
				</p>
			</div>
		</div>

		<!-- Staff Review Memo Textarea -->
		<div class="space-y-2">
			<label
				for="internal-review-memo"
				class="block text-xs font-bold text-foreground"
			>
				บันทึกความเห็นของเจ้าหน้าที่ประจำศูนย์ (Internal Review Memo)
			</label>
			<textarea
				id="internal-review-memo"
				rows="3"
				placeholder="เขียนวิเคราะห์ความจุคลัง หรือข้อตกลงพิเศษในการรับของ เช่น โซนตู้แช่สำรองไฟ ฯลฯ"
				bind:value={memo}
				class="w-full rounded-xl border border-border/80 bg-muted/10 p-3.5 text-xs text-foreground placeholder:text-muted-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
			></textarea>
		</div>
	</div>

	<!-- Bottom Action Bar Footer -->
	<div
		class="flex flex-col-reverse items-stretch justify-between gap-3 border-t border-border/60 bg-muted/5 p-4 sm:flex-row sm:items-center md:px-6"
	>
		<div class="flex flex-wrap items-center gap-2.5">
			<button
				type="button"
				onclick={() => request.booking_ref && onApprove(request.booking_ref, memo.trim())}
				disabled={saving}
				class="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
			>
				<Check class="h-4 w-4" />
				{saving ? 'กำลังดำเนินการ...' : 'อนุมัติรับ (Generate QR)'}
			</button>

			<button
				type="button"
				onclick={() => (isRedirectDialogOpen = true)}
				disabled={saving}
				class="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-[#0c3154] px-5 py-2.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-[#124270] disabled:cursor-not-allowed disabled:opacity-60"
			>
				<Send class="h-3.5 w-3.5" />
				ประสานงานส่งต่อ
			</button>
		</div>

		<button
			type="button"
			onclick={() => (isRejectDialogOpen = true)}
			disabled={saving}
			class="inline-flex cursor-pointer items-center justify-center rounded-xl border border-red-200 bg-red-50/70 px-5 py-2.5 text-xs font-bold text-red-600 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/50 dark:bg-red-950/20 dark:hover:bg-red-900/40"
		>
			ปฏิเสธคำขอ
		</button>
	</div>
</div>

<!-- Rejection Reason Dialog -->
<RejectDonationDialog
	open={isRejectDialogOpen}
	{request}
	{saving}
	onclose={() => (isRejectDialogOpen = false)}
	onConfirm={(ref, reason) => {
		isRejectDialogOpen = false;
		onReject(ref, reason);
	}}
/>

<!-- Redirect Shelter Dialog -->
<RedirectDonationDialog
	open={isRedirectDialogOpen}
	{request}
	{saving}
	onclose={() => (isRedirectDialogOpen = false)}
	onConfirm={(ref, targetShelter, note) => {
		isRedirectDialogOpen = false;
		if (onRedirect) onRedirect(ref, targetShelter, note);
	}}
/>
