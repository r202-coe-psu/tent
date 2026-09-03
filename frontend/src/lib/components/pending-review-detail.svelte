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
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
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

	// Only other shelters are valid destinations — the one already holding the request
	// is not somewhere to redirect to.
	const redirectTargets = $derived(shelters.filter((s) => s.code !== request.shelter_code));
	const redirectTargetLabel = $derived.by(() => {
		const picked = redirectTargets.find((s) => s.code === selectedTargetShelter);
		if (picked) return `${picked.name} (${picked.code})`;
		return sheltersQuery.isPending ? 'กำลังโหลดรายชื่อศูนย์...' : '-- เลือกศูนย์พักพิงปลายทาง --';
	});

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
		<Button
			variant="link"
			size="sm"
			type="button"
			onclick={onBack}
			class="mb-3 h-auto gap-1.5 p-0 text-xs font-medium text-blue-200 no-underline hover:text-white hover:no-underline"
		>
			<ArrowLeft class="h-3.5 w-3.5" />
			กลับหน้าตรวจรับบริจาค
		</Button>
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
			<Label for="internal-review-memo" class="text-xs font-bold text-foreground">
				บันทึกความเห็นของเจ้าหน้าที่ประจำศูนย์ (Internal Review Memo)
			</Label>
			<Textarea
				id="internal-review-memo"
				rows={3}
				placeholder="เขียนวิเคราะห์ความจุคลัง หรือข้อตกลงพิเศษในการรับของ เช่น โซนตู้แช่สำรองไฟ ฯลฯ"
				bind:value={memo}
				class="rounded-2xl p-3.5 text-xs"
			/>
		</div>
	</div>

	<!-- Bottom Action Bar Footer -->
	<div
		class="flex flex-col-reverse items-stretch justify-between gap-3 border-t border-border/60 bg-muted/5 p-4 sm:flex-row sm:items-center md:px-8"
	>
		<div class="flex flex-wrap items-center gap-2.5">
			<!-- Approve Button -->
			<Button
				type="button"
				onclick={() => actionRef && onApprove(actionRef, memo.trim())}
				disabled={saving}
				class="h-10 gap-1.5 rounded-xl bg-emerald-600 px-5 text-xs font-bold text-white shadow-xs hover:bg-emerald-700"
			>
				<Check class="h-4 w-4" />
				{saving ? 'กำลังดำเนินการ...' : 'อนุมัติรับ (Generate QR)'}
			</Button>

			<!--
			Redirect ("ประสานงานส่งต่อ") is hidden for now: the centre does not hand donations
			off to another shelter yet, so offering the action would promise a workflow that
			has no receiving end. The panel below, `handleConfirmRedirect` and the
			`/redirect` route all stay wired up — bringing the action back is uncommenting
			this button, not rebuilding the feature.

			<Button
				type="button"
				onclick={() => (actionPanel = actionPanel === 'redirect' ? 'none' : 'redirect')}
				disabled={saving}
				class="h-10 gap-1.5 rounded-xl bg-[#002D5B] px-5 text-xs font-bold text-white shadow-xs hover:bg-[#001f3f] dark:bg-blue-600 dark:hover:bg-blue-700"
			>
				<MapPin class="h-3.5 w-3.5" />
				ประสานงานส่งต่อ
			</Button>
			-->
		</div>

		<!-- Reject Button -->
		<Button
			variant="outline"
			type="button"
			onclick={() => (actionPanel = actionPanel === 'reject' ? 'none' : 'reject')}
			disabled={saving}
			class="h-10 rounded-xl border-rose-200 bg-rose-50/70 px-5 text-xs font-bold text-rose-600 hover:bg-rose-100 hover:text-rose-700 dark:border-rose-900/50 dark:bg-rose-950/20 dark:hover:bg-rose-900/40"
		>
			ปฏิเสธคำขอ
		</Button>
	</div>

	<!-- Expandable Reroute / Redirect Section (Screenshot 4) -->
	{#if actionPanel === 'redirect'}
		<div
			class="animate-in border-t border-border/60 bg-muted/10 p-6 fade-in slide-in-from-top-2 md:p-8"
		>
			<div class="space-y-4 rounded-2xl border-2 border-blue-500 bg-card p-5 shadow-sm">
				<div>
					<Label for="target-shelter-select" class="mb-1.5 text-xs font-bold text-foreground">
						เลือกศูนย์พักพิงปลายทางแห่งใหม่ (Target Shelter Reroute)
						<span class="text-destructive">*</span>
					</Label>
					<Select.Root type="single" bind:value={selectedTargetShelter}>
						<Select.Trigger
							id="target-shelter-select"
							class="h-10 w-full rounded-xl text-xs data-[size=default]:h-10"
						>
							{redirectTargetLabel}
						</Select.Trigger>
						<Select.Content>
							{#each redirectTargets as s (s.code)}
								<Select.Item value={s.code} label="{s.name} ({s.code})" />
							{/each}
						</Select.Content>
					</Select.Root>
				</div>

				<div>
					<Label for="redirect-remark-input" class="mb-1.5 text-xs font-bold text-foreground">
						หมายเหตุสำหรับการส่งต่อ (Remark)
					</Label>
					<Textarea
						id="redirect-remark-input"
						rows={2}
						placeholder="เช่น พื้นที่จัดเก็บศูนย์ต้นทางเต็ม หรือต้องการการดูแลจำเพาะจากผู้เชี่ยวชาญ..."
						bind:value={redirectNote}
						class="rounded-xl bg-muted/10 text-xs"
					/>
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
					<Label for="reject-reason-input" class="mb-1.5 text-xs font-bold text-foreground">
						ระบุเหตุผลในการปฏิเสธคำขอ (Reject Reason) <span class="text-destructive">*</span>
					</Label>
					<Textarea
						id="reject-reason-input"
						rows={2}
						placeholder="เช่น พื้นที่จัดเก็บไม่เพียงพอ, งดรับเสื้อผ้าชั่วคราว..."
						bind:value={rejectReason}
						class="rounded-xl bg-muted/10 text-xs"
					/>
				</div>

				<div class="flex items-center justify-between gap-3 pt-2">
					<Button
						type="button"
						onclick={handleConfirmReject}
						disabled={saving || !rejectReason.trim()}
						variant="destructive"
						class="h-10 rounded-xl bg-destructive px-6 text-xs font-bold text-white hover:bg-destructive/90"
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
