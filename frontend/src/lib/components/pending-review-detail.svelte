<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import User from '@lucide/svelte/icons/user';
	import Phone from '@lucide/svelte/icons/phone';
	import Mail from '@lucide/svelte/icons/mail';
	import Info from '@lucide/svelte/icons/info';
	import FileText from '@lucide/svelte/icons/file-text';
	import Truck from '@lucide/svelte/icons/truck';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Calendar from '@lucide/svelte/icons/calendar';
	import Check from '@lucide/svelte/icons/check';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { toast } from 'svelte-sonner';
	import {
		donationActionRef,
		donationRefLabel,
		PUBLIC_DONATION_CATEGORIES,
		RejectDonationDialog,
		RejectReasonFields,
		LineDecisionToggle,
		hasLineReview,
		isAutoApprovedLine,
		lineReviewDecisionSchema,
		type DonationRejectReasonCode,
		type LineReviewDecision,
		type PendingDonationRow,
		type RejectDonationInput,
		DonationPhotoStrip
	} from '$lib/features/donations';
	import { useShelters } from '$lib/features/shelters';
	import { formatUnit, useUnitsOfMeasure } from '$lib/features/catalog';
	import { langState } from '$lib/states/i18n.svelte';
	import { DISPLAY_LOCALE, DISPLAY_TIME_ZONE } from '$lib/utils/date';

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
		/** `lines` decides every pending line of a per-line reviewed booking (CR-174). */
		onApprove: (bookingRef: string, memo: string, lines?: LineReviewDecision[]) => void;
		onReject: (bookingRef: string, input: RejectDonationInput) => void;
		onRedirect?: (bookingRef: string, targetShelterCode: string, note: string) => void;
	} = $props();

	// A walk-in has no `booking_ref`; the doc id is what addresses it (see
	// `donationActionRef`). Bailing out on a missing ref left those donations stuck.
	const actionRef = $derived(donationActionRef(request));

	let memo = $state('');
	let actionPanel = $state<'none' | 'redirect'>('none');
	let rejectOpen = $state(false);

	const unitsQuery = useUnitsOfMeasure();
	const units = $derived(unitsQuery.data ?? []);

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

	/**
	 * The donor sends `category`, `condition` and a per-line `note` alongside each
	 * item. This view used to join every line into one string
	 * ("ข้าวสาร 1 ชิ้น, มาม่า 56 ชิ้น") and lump the notes into a single paragraph below,
	 * so a two-item "บริจาคสิ่งของอื่นๆ" request lost its categories and conditions
	 * outright and left staff unable to tell which note belonged to which item — the
	 * exact detail an unsolicited request has to be judged on.
	 */
	const CONDITION_LABELS: Record<string, string> = {
		new: 'ของใหม่ 100%',
		used: 'ของมือสอง สภาพดี',
		other: 'สภาพอื่นๆ'
	};

	function conditionLabel(condition?: string): string | undefined {
		const key = condition?.trim();
		if (!key) return undefined;
		return CONDITION_LABELS[key] ?? key;
	}

	function categoryLabel(category?: string): string | undefined {
		const key = category?.trim();
		if (!key) return undefined;
		return PUBLIC_DONATION_CATEGORIES.find((c) => c.value === key)?.label ?? key;
	}

	const declaredItems = $derived(request.items ?? []);

	/**
	 * CR-174 — a schema_v 7 booking is decided line by line: only `pending` lines take a
	 * decision; campaign lines were approved at booking and are shown, not decided (FR-8).
	 */
	const lineReview = $derived(hasLineReview(declaredItems));
	type LineDraft = {
		decision?: 'approved' | 'rejected';
		code?: DonationRejectReasonCode;
		note: string;
	};
	let drafts = $state<Record<number, LineDraft>>({});
	const pendingIndexes = $derived(
		declaredItems.flatMap((item, index) => (item.review_status === 'pending' ? [index] : []))
	);
	/** Event handlers only — never call while rendering (it may create the draft). */
	function draftAt(index: number): LineDraft {
		drafts[index] ??= { note: '' };
		return drafts[index];
	}
	const lineDecisions = $derived(
		pendingIndexes.map((index) =>
			lineReviewDecisionSchema.safeParse({
				index,
				decision: drafts[index]?.decision,
				reason_code: drafts[index]?.code,
				note: drafts[index]?.note || undefined
			})
		)
	);
	const reviewComplete = $derived(lineDecisions.every((parsed) => parsed.success));
	const REVIEW_INCOMPLETE = 'ตัดสินรายการที่รอประเมินให้ครบ และใส่เหตุผลของรายการที่ไม่รับ';
	/** Every line ends up refused, so saving rejects the booking (FR-6) — shown in red. */
	const rejectsAll = $derived.by(() => {
		if (!lineReview || !reviewComplete) return false;
		const kept = pendingIndexes.filter((index) => drafts[index]?.decision === 'approved').length;
		return kept + declaredItems.filter((item) => item.review_status === 'approved').length === 0;
	});
	const approveLabel = $derived.by(() => {
		if (!lineReview) return 'อนุมัติรับ (Generate QR)';
		return rejectsAll ? 'ปฏิเสธทั้งใบ' : 'บันทึกผลการประเมิน';
	});

	function submitReview() {
		if (!actionRef) return;
		if (!lineReview) {
			onApprove(actionRef, memo.trim());
			return;
		}
		const lines = lineDecisions.flatMap((parsed) => (parsed.success ? [parsed.data] : []));
		if (lines.length !== pendingIndexes.length) {
			toast.error(REVIEW_INCOMPLETE);
			return;
		}
		onApprove(actionRef, memo.trim(), lines);
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
		const normalized = /^\d{4}-\d{2}-\d{2}$/.test(dateStr.trim())
			? `${dateStr.trim()}T12:00:00+07:00`
			: dateStr;
		const d = new Date(normalized);
		if (Number.isNaN(d.getTime())) return dateStr;
		return d.toLocaleDateString(DISPLAY_LOCALE, {
			timeZone: DISPLAY_TIME_ZONE,
			day: 'numeric',
			month: 'long',
			year: 'numeric'
		});
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

	function handleConfirmReject(input: RejectDonationInput) {
		if (!actionRef) return;
		onReject(actionRef, input);
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
		<!-- Donor first, then — only when a line was typed in — a plain note on what that
		     means for the review. It is information, not a fault: amber read as a problem. -->
		<div class="grid grid-cols-1 gap-4 {request.is_unsolicited ? 'md:grid-cols-2' : ''}">
			<div class="rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs">
				<p class="text-sm font-semibold text-slate-500">ข้อมูลผู้บริจาค / จุดประสานงาน</p>
				<div class="mt-3 flex items-start gap-3">
					<span
						class="inline-flex size-11 shrink-0 items-center justify-center rounded-full border border-sky-200 bg-sky-50 text-sky-700"
						aria-hidden="true"
					>
						<User class="size-5" />
					</span>
					<div class="min-w-0 space-y-1.5">
						<p class="text-lg font-bold break-words text-slate-900">
							{request.donor_name || 'ไม่ระบุชื่อ'}
						</p>
						<p class="flex items-center gap-2 text-base text-slate-700">
							<Phone class="size-4 shrink-0 text-slate-400" aria-hidden="true" />
							<span class="sr-only">เบอร์โทร</span>
							{#if request.donor_phone}
								<a
									href="tel:{request.donor_phone}"
									class="font-semibold text-sky-800 tabular-nums underline-offset-2 hover:underline"
								>
									{request.donor_phone}
								</a>
							{:else}
								<span class="text-slate-500">ไม่ระบุเบอร์โทร</span>
							{/if}
						</p>
						{#if request.donor_email}
							<p class="flex items-center gap-2 text-sm break-all text-slate-600">
								<Mail class="size-4 shrink-0 text-slate-400" aria-hidden="true" />
								<span class="sr-only">อีเมล</span>
								{request.donor_email}
							</p>
						{/if}
					</div>
				</div>
			</div>

			{#if request.is_unsolicited}
				<!-- `is_unsolicited` = some line was typed in by the donor rather than picked
				     from the shelter's announced needs (no catalog item_id). -->
				<div class="rounded-xl border border-sky-200 bg-white p-5 shadow-2xs">
					<p class="flex items-center gap-2 text-sm font-semibold text-sky-900">
						<Info class="size-5 shrink-0 text-sky-600" aria-hidden="true" />
						มีรายการที่ผู้บริจาคระบุเอง
					</p>
					<p class="mt-2 text-base leading-relaxed text-slate-700">
						รายการเหล่านี้ไม่ได้มาจากประกาศความต้องการของศูนย์ —
						เลือกรับหรือไม่รับทีละรายการด้านล่าง รายการที่รับจะจับคู่กับสินค้าในคลังตอนตรวจรับ
					</p>
				</div>
			{/if}
		</div>

		<!-- Donor Input Items Section -->
		<div class="space-y-3">
			<div class="flex items-baseline justify-between gap-2">
				<h3 class="flex items-center gap-2 text-xl font-bold text-slate-900">
					<FileText class="size-6 text-slate-400" />
					รายการสิ่งของที่ผู้บริจาคแจ้ง
				</h3>
				{#if declaredItems.length > 0}
					<span class="shrink-0 text-base whitespace-nowrap text-slate-600 tabular-nums"
						>{declaredItems.length} รายการ</span
					>
				{/if}
			</div>
			<div class="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-2xs">
				{#if declaredItems.length === 0}
					<p class="p-4 text-sm text-slate-500">ไม่มีรายการสิ่งของระบุ</p>
				{:else}
					<ul class="divide-y divide-slate-100">
						{#each declaredItems as item, idx (`${item.item_id ?? item.free_text ?? 'line'}:${idx}`)}
							{@const cat = categoryLabel(item.category)}
							{@const cond = conditionLabel(item.condition)}
							<li class="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 p-4 sm:px-5">
								<div class="min-w-0 space-y-2">
									<p class="text-xl font-bold break-words text-slate-900">
										{item.free_text ?? item.item_id ?? 'สิ่งของ'}
									</p>
									{#if cat || cond || !item.item_id}
										<div class="flex flex-wrap items-center gap-2">
											{#if cat}
												<Badge
													variant="outline"
													class="border-slate-200 bg-slate-50 text-sm font-semibold text-slate-700"
												>
													{cat}
												</Badge>
											{/if}
											{#if cond}
												<Badge
													variant="outline"
													class="border-sky-200 bg-sky-50 text-sm font-semibold text-sky-900"
												>
													{cond}
												</Badge>
											{/if}
											{#if !item.item_id}
												<!-- No catalog binding — this line cannot become stock as-is
												     (schema.md §2.1 needs a real item_id), so staff must map it
												     at the scan station. Saying so here is what the reviewer
												     needs to decide on. -->
												<Badge
													variant="outline"
													class="border-amber-200 bg-amber-50 text-sm font-semibold text-amber-900"
												>
													ยังไม่จับคู่แคตตาล็อก
												</Badge>
											{/if}
										</div>
									{/if}
									{#if item.note?.trim()}
										<p class="text-base leading-relaxed text-slate-700">
											หมายเหตุ: {item.note.trim()}
										</p>
									{/if}
									{#if item.review_status === 'approved'}
										<Badge
											variant="outline"
											class="border-emerald-200 bg-emerald-50 text-sm font-semibold text-emerald-900"
										>
											{isAutoApprovedLine(item, request.campaign_id ?? null)
												? 'อยู่ในแคมเปญ · อนุมัติอัตโนมัติ'
												: 'อนุมัติแล้ว'}
										</Badge>
									{:else if item.review_status === 'rejected'}
										<Badge
											variant="outline"
											class="border-red-200 bg-red-50 text-sm font-semibold text-red-900"
										>
											ไม่รับ{item.review_reason ? ` · ${item.review_reason}` : ''}
										</Badge>
									{/if}
								</div>
								<div class="shrink-0 text-right">
									<span class="text-sm text-slate-500">จำนวนที่แจ้ง</span>
									<p class="text-2xl font-bold whitespace-nowrap text-slate-900 tabular-nums">
										{item.qty}
										<span class="text-base font-medium text-slate-600">
											{formatUnit(item.unit, units, langState.current)}
										</span>
									</p>
								</div>
								{#if item.review_status === 'pending'}
									{@const draft = drafts[idx]}
									<div class="w-full space-y-3 border-t border-slate-100 pt-4">
										<LineDecisionToggle
											bind:value={
												() =>
													draft?.decision === 'approved'
														? 'accept'
														: draft?.decision === 'rejected'
															? 'reject'
															: null,
												(next) =>
													(draftAt(idx).decision =
														next === 'accept'
															? 'approved'
															: next === 'reject'
																? 'rejected'
																: undefined)
											}
											acceptLabel="รับรายการนี้"
											acceptHint="ผู้บริจาคนำมาส่งได้"
											groupLabel="ผลการประเมิน {item.free_text ?? item.item_id ?? 'รายการ'}"
											disabled={saving}
										/>
										{#if draft?.decision === 'rejected'}
											<RejectReasonFields
												bind:code={draft.code}
												bind:note={draft.note}
												idPrefix="review-line-{idx}"
												disabled={saving}
											/>
										{/if}
									</div>
								{/if}
							</li>
						{/each}
					</ul>
				{/if}
			</div>
		</div>

		<!-- CR-175 FR-12: the donor's photos, so the goods can be judged before they arrive. -->
		<DonationPhotoStrip photoIds={request.photos} shelterCode={request.shelter_code} />

		<!-- Logistics Info Cards Grid (3 boxes) -->
		<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
			<!-- Vehicle -->
			<div class="rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs">
				<div class="flex items-center gap-2 text-sm font-semibold text-slate-500">
					<Truck class="size-5 text-sky-600" aria-hidden="true" />
					<span>ยานพาหนะจัดส่ง</span>
				</div>
				<p class="mt-2 text-lg font-bold text-slate-900">
					{formatVehicle(request.vehicle, request.delivery_method)}
				</p>
			</div>

			{#if request.pickup_address}
				<!-- Where the shelter's vehicle goes. Only a pickup booking has one; the
				     card used to fall back to a made-up "จุดรับบริจาคส่วนหน้า" for the rest. -->
				<div class="rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs">
					<div class="flex items-center gap-2 text-sm font-semibold text-slate-500">
						<MapPin class="size-5 text-sky-600" aria-hidden="true" />
						<span>ที่อยู่เข้ารับของ</span>
					</div>
					<p class="mt-2 text-lg font-bold text-slate-900">{request.pickup_address}</p>
				</div>
			{/if}

			<!-- Appointment Date -->
			<div
				class="rounded-xl border border-slate-200/80 bg-white p-5 shadow-2xs {request.pickup_address
					? 'md:col-span-2'
					: ''}"
			>
				<div class="flex items-center gap-2 text-sm font-semibold text-slate-500">
					<Calendar class="size-5 text-sky-600" aria-hidden="true" />
					<span>นัดหมายเสนอขอบริจาค</span>
				</div>
				<p class="mt-2 text-lg font-bold text-slate-900">
					{formatSlotDate(request.slot, request.eta, request.declared_at)}
				</p>
			</div>
		</div>

		<!-- Staff Review Memo Textarea -->
		<div class="space-y-2">
			<Label for="internal-review-memo" class="text-sm font-semibold text-slate-700">
				บันทึกความเห็นของเจ้าหน้าที่ประจำศูนย์ (Internal Review Memo)
			</Label>
			<Textarea
				id="internal-review-memo"
				rows={3}
				placeholder="เขียนวิเคราะห์ความจุคลัง หรือข้อตกลงพิเศษในการรับของ เช่น โซนตู้แช่สำรองไฟ ฯลฯ"
				bind:value={memo}
				class="rounded-xl p-3.5 text-base"
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
				onclick={submitReview}
				disabled={saving || (lineReview && !reviewComplete)}
				aria-describedby={lineReview && !reviewComplete ? 'review-incomplete-hint' : undefined}
				class="h-10 gap-1.5 rounded-xl px-5 text-xs font-bold text-white shadow-xs {rejectsAll
					? 'bg-red-600 hover:bg-red-700'
					: 'bg-emerald-600 hover:bg-emerald-700'}"
			>
				<Check class="h-4 w-4" />
				{saving ? 'กำลังดำเนินการ...' : approveLabel}
			</Button>
			{#if lineReview && !reviewComplete}
				<p id="review-incomplete-hint" class="text-xs text-muted-foreground">
					{REVIEW_INCOMPLETE}
				</p>
			{/if}

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
			onclick={() => (rejectOpen = true)}
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
</div>

<RejectDonationDialog
	bind:open={rejectOpen}
	bookingRef={request.booking_ref || actionRef || undefined}
	pending={saving}
	onconfirm={handleConfirmReject}
/>
