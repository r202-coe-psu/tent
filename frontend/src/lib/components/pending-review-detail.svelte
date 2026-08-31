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
	import { Button } from '$lib/components/ui/button/index.js';
	import { toast } from 'svelte-sonner';
	import {
		donationActionRef,
		donationRefLabel,
		type PendingDonationRow
	} from '$lib/features/donations';
	import { useShelters } from '$lib/features/shelters';

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

	// A walk-in has no `booking_ref`; the doc id is what addresses it (see
	// `donationActionRef`). Bailing out on a missing ref left those donations stuck.
	const actionRef = $derived(donationActionRef(request));

	let memo = $state('');
	let actionPanel = $state<'none' | 'redirect' | 'reject'>('none');

	// Redirect inline form state. The shelter list comes from the feature's query
	// hook (TanStack Query — CONTRIBUTING §4) rather than a hand-rolled `onMount`
	// fetch, so it is cached, retried and shared with the rest of the page.
	const sheltersQuery = useShelters();
	const shelters = $derived(sheltersQuery.data ?? []);
	let selectedTargetShelter = $state('');
	let redirectNote = $state('');

	// Reject inline form state
	let rejectReason = $state('');

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
		return 'อยากสนับสนุนสิ่งของอื่นๆ ที่น่าจะจำเป็นสำหรับผู้ประสบภัยที่บ้านเรือนเสียหายอย่างหนัก';
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
		if (!dateStr) return '—';
		try {
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
		return '—';
	}

	function handleConfirmRedirect() {
		if (!actionRef) return;
		if (!selectedTargetShelter) {
			toast.error('กรุณาเลือกศูนย์พักพิงปลายทาง');
			return;
		}
		if (onRedirect) {
			onRedirect(actionRef, selectedTargetShelter, redirectNote.trim());
		}
	}

	function handleConfirmReject() {
		if (!actionRef) return;
		if (!rejectReason.trim()) {
			toast.error('กรุณาระบุเหตุผลในการปฏิเสธคำขอ');
			return;
		}
		onReject(actionRef, rejectReason.trim());
	}
</script>

<div class="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs">
	<!-- Dark Navy Header Banner -->
	<div class="bg-[#002D5B] p-6 text-white md:p-8 dark:bg-slate-900">
		<button
			type="button"
			onclick={onBack}
			class="mb-3 inline-flex cursor-pointer items-center gap-1.5 text-xs font-medium text-blue-200 transition-colors hover:text-white"
		>
			<ArrowLeft class="h-3.5 w-3.5" />
			กลับหน้าตรวจรับบริจาค
		</button>
		<div class="flex items-center gap-2.5">
			<div class="flex h-8 w-8 items-center justify-center rounded-lg bg-white/10 text-white">
				<ClipboardCheck class="h-5 w-5" />
			</div>
			<h2 class="text-base font-bold text-white md:text-lg">
				{donationRefLabel(request)} - พิจารณาคำขอรับบริจาค (Pending Review)
			</h2>
		</div>
	</div>

	<!-- Main Body Content -->
	<div class="space-y-6 p-6 md:p-8">
		<!-- Top Notice & Donor Info Grid -->
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<!-- Left Warning / Unsolicited Notice Card -->
			<div
				class="rounded-2xl border border-rose-200/80 bg-rose-50/50 p-5 dark:border-rose-900/40 dark:bg-rose-950/20"
			>
				<div class="flex items-center gap-2 text-xs font-bold text-rose-600 dark:text-rose-400">
					<AlertTriangle class="h-4 w-4 shrink-0 text-rose-600 dark:text-rose-400" />
					<span>คำชี้แจง / เงื่อนไขตรวจสอบพัสดุพิเศษระวัง</span>
				</div>
				<div class="mt-2.5 space-y-1">
					<p class="text-xs font-bold text-rose-700 dark:text-rose-300">
						ประเภท: {(request.is_unsolicited ?? true)
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
				class="rounded-2xl border border-sky-200/80 bg-sky-50/50 p-5 dark:border-sky-900/40 dark:bg-sky-950/20"
			>
				<div class="flex items-center gap-2 text-xs font-bold text-sky-700 dark:text-sky-400">
					<User class="h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" />
					<span>ข้อมูลผู้บริจาค / จุดประสานงาน</span>
				</div>
				<div class="mt-2.5 space-y-1">
					<p class="text-xs font-bold text-slate-800 dark:text-slate-100">
						{request.donor_name || 'ไม่ระบุชื่อ'}
					</p>
					<p class="text-xs text-slate-600 dark:text-slate-400">
						โทร. {request.donor_phone || 'ไม่ระบุเบอร์โทร'}
					</p>
					{#if request.donor_email}
						<p class="text-xs text-slate-500 dark:text-slate-400">{request.donor_email}</p>
					{/if}
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
				class="rounded-2xl border border-border/80 bg-card p-4 text-xs font-medium text-foreground"
			>
				{formatItems(request)}
			</div>
		</div>

		<!-- Condition & Notes Section -->
		<div class="space-y-2">
			<div class="flex items-center gap-2 text-xs font-medium text-muted-foreground">
				<Info class="h-4 w-4 text-muted-foreground" />
				<span>คำชี้แจงและกรณีศึกษาสภาพสิ่งของเพิ่มเติม</span>
			</div>
			<div class="rounded-2xl border border-border/80 bg-card p-4 text-xs text-foreground">
				{formatDonorNote(request)}
			</div>
		</div>

		<!-- Logistics Info Cards Grid (3 boxes) -->
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<!-- Vehicle -->
			<div class="rounded-2xl border border-border/80 bg-card p-4">
				<div class="flex items-center gap-2 text-2xs font-bold text-muted-foreground uppercase">
					<Truck class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
					<span>ยานพาหนะจัดส่ง</span>
				</div>
				<p class="mt-2 text-xs font-bold text-foreground">
					{formatVehicle(request.vehicle, request.delivery_method)}
				</p>
			</div>

			<!-- Location / Shelter -->
			<div class="rounded-2xl border border-border/80 bg-card p-4">
				<div class="flex items-center gap-2 text-2xs font-bold text-muted-foreground uppercase">
					<MapPin class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
					<span>อาคาร/พิกัดเสนอรับเข้า</span>
				</div>
				<p class="mt-2 text-xs font-bold text-foreground">
					{request.pickup_address || 'จุดรับบริจาคส่วนหน้า'}
				</p>
			</div>

			<!-- Appointment Date -->
			<div class="rounded-2xl border border-border/80 bg-card p-4 md:col-span-2">
				<div class="flex items-center gap-2 text-2xs font-bold text-muted-foreground uppercase">
					<Calendar class="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
					<span>นัดหมายเสนอขอบริจาค</span>
				</div>
				<p class="mt-2 text-xs font-bold text-foreground">
					{formatSlotDate(request.slot, request.eta, request.declared_at)}
				</p>
			</div>
		</div>

		<!-- Staff Review Memo Textarea -->
		<div class="space-y-2">
			<label for="internal-review-memo" class="block text-xs font-bold text-foreground">
				บันทึกความเห็นของเจ้าหน้าที่ประจำศูนย์ (Internal Review Memo)
			</label>
			<textarea
				id="internal-review-memo"
				rows="3"
				placeholder="เขียนวิเคราะห์ความจุคลัง หรือข้อตกลงพิเศษในการรับของ เช่น โซนตู้แช่สำรองไฟ ฯลฯ"
				bind:value={memo}
				class="w-full rounded-2xl border border-border/80 bg-card p-3.5 text-xs text-foreground outline-hidden placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/20"
			></textarea>
		</div>
	</div>

	<!-- Bottom Action Bar Footer -->
	<div
		class="flex flex-col-reverse items-stretch justify-between gap-3 border-t border-border/60 bg-muted/5 p-4 sm:flex-row sm:items-center md:px-8"
	>
		<div class="flex flex-wrap items-center gap-2.5">
			<!-- Approve Button -->
			<button
				type="button"
				onclick={() => actionRef && onApprove(actionRef, memo.trim())}
				disabled={saving}
				class="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-2.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-60"
			>
				<Check class="h-4 w-4" />
				{saving ? 'กำลังดำเนินการ...' : 'อนุมัติรับ (Generate QR)'}
			</button>

			<!-- Redirect Button -->
			<button
				type="button"
				onclick={() => (actionPanel = actionPanel === 'redirect' ? 'none' : 'redirect')}
				disabled={saving}
				class="inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-xl bg-[#002D5B] px-5 py-2.5 text-xs font-bold text-white shadow-xs transition-colors hover:bg-[#001f3f] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-blue-600 dark:hover:bg-blue-700"
			>
				<MapPin class="h-3.5 w-3.5" />
				ประสานงานส่งต่อ
			</button>
		</div>

		<!-- Reject Button -->
		<button
			type="button"
			onclick={() => (actionPanel = actionPanel === 'reject' ? 'none' : 'reject')}
			disabled={saving}
			class="inline-flex cursor-pointer items-center justify-center rounded-xl border border-rose-200 bg-rose-50/70 px-5 py-2.5 text-xs font-bold text-rose-600 transition-colors hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60 dark:border-rose-900/50 dark:bg-rose-950/20 dark:hover:bg-rose-900/40"
		>
			ปฏิเสธคำขอ
		</button>
	</div>

	<!-- Expandable Reroute / Redirect Section (Screenshot 4) -->
	{#if actionPanel === 'redirect'}
		<div
			class="animate-in border-t border-border/60 bg-muted/10 p-6 fade-in slide-in-from-top-2 md:p-8"
		>
			<div class="space-y-4 rounded-2xl border-2 border-blue-500 bg-card p-5 shadow-sm">
				<div>
					<label for="target-shelter-select" class="mb-1.5 block text-xs font-bold text-foreground">
						เลือกศูนย์พักพิงปลายทางแห่งใหม่ (Target Shelter Reroute) <span class="text-rose-500"
							>*</span
						>
					</label>
					<select
						id="target-shelter-select"
						bind:value={selectedTargetShelter}
						class="h-10 w-full rounded-xl border border-border/80 bg-background px-3 text-xs text-foreground focus:ring-2 focus:ring-primary/20 focus:outline-none"
					>
						<option value="">
							{sheltersQuery.isPending
								? 'กำลังโหลดรายชื่อศูนย์...'
								: '-- เลือกศูนย์พักพิงปลายทาง --'}
						</option>
						{#each shelters as s (s.code)}
							{#if s.code !== request.shelter_code}
								<option value={s.code}>{s.name} ({s.code})</option>
							{/if}
						{/each}
					</select>
				</div>

				<div>
					<label for="redirect-remark-input" class="mb-1.5 block text-xs font-bold text-foreground">
						หมายเหตุสำหรับการส่งต่อ (Remark)
					</label>
					<textarea
						id="redirect-remark-input"
						rows="2"
						placeholder="เช่น พื้นที่จัดเก็บศูนย์ต้นทางเต็ม หรือต้องการการดูแลจำเพาะจากผู้เชี่ยวชาญ..."
						bind:value={redirectNote}
						class="w-full rounded-xl border border-border/80 bg-muted/10 p-3 text-xs text-foreground focus:border-primary focus:ring-2 focus:ring-primary/20 focus:outline-none"
					></textarea>
				</div>

				<div class="flex items-center justify-between gap-3 pt-2">
					<Button
						type="button"
						onclick={handleConfirmRedirect}
						disabled={saving || !selectedTargetShelter}
						class="h-10 rounded-xl bg-[#002D5B] px-6 text-xs font-bold text-white hover:bg-[#001f3f] dark:bg-blue-600 dark:hover:bg-blue-700"
					>
						{saving ? 'กำลังดำเนินการ...' : 'ยืนยันการประสานงานส่งต่อ'}
					</Button>
					<Button
						variant="ghost"
						type="button"
						onclick={() => (actionPanel = 'none')}
						class="h-10 rounded-xl px-5 text-xs font-bold"
					>
						ยกเลิก
					</Button>
				</div>
			</div>
		</div>
	{/if}

	<!-- Expandable Reject Section (Screenshot 5) -->
	{#if actionPanel === 'reject'}
		<div
			class="animate-in border-t border-border/60 bg-muted/10 p-6 fade-in slide-in-from-top-2 md:p-8"
		>
			<div
				class="space-y-4 rounded-2xl border-2 border-rose-300 bg-card p-5 shadow-sm dark:border-rose-900/60"
			>
				<div>
					<label for="reject-reason-input" class="mb-1.5 block text-xs font-bold text-foreground">
						ระบุเหตุผลในการปฏิเสธคำขอ (Reject Reason) <span class="text-rose-500">*</span>
					</label>
					<textarea
						id="reject-reason-input"
						rows="2"
						placeholder="เช่น พื้นที่จัดเก็บไม่เพียงพอ, งดรับเสื้อผ้าชั่วคราว..."
						bind:value={rejectReason}
						class="w-full rounded-xl border border-border/80 bg-muted/10 p-3 text-xs text-foreground focus:border-rose-500 focus:ring-2 focus:ring-rose-500/20 focus:outline-none"
					></textarea>
				</div>

				<div class="flex items-center justify-between gap-3 pt-2">
					<Button
						type="button"
						onclick={handleConfirmReject}
						disabled={saving || !rejectReason.trim()}
						class="h-10 rounded-xl bg-rose-600 px-6 text-xs font-bold text-white hover:bg-rose-700"
					>
						{saving ? 'กำลังดำเนินการ...' : 'ยืนยันการปฏิเสธคำขอ'}
					</Button>
					<Button
						variant="ghost"
						type="button"
						onclick={() => (actionPanel = 'none')}
						class="h-10 rounded-xl px-5 text-xs font-bold"
					>
						ยกเลิก
					</Button>
				</div>
			</div>
		</div>
	{/if}
</div>
