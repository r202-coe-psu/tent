<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import {
		Activity,
		ArrowLeft,
		CalendarDays,
		CheckCircle2,
		ChevronRight,
		ClipboardCheck,
		CloudOff,
		Radio,
		UserRound
	} from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog';
	import {
		AuthError,
		CannotConnectError,
		ConflictError,
		CouchDocumentPolicyError,
		errorMessage
	} from '$lib/utils/errors';
	import { authStore } from '$lib/stores/auth.svelte';
	import { backofficeState } from '$lib/stores/backoffice.svelte';
	import { endpointStore } from '$lib/stores/endpoint.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useShelter } from '$lib/features/shelters';
	import {
		DAILY_SOP_LIFELINES,
		DAILY_SOP_SECTIONS_WITH_ITEMS,
		LIFELINE_KEYS,
		SOP_UI_STATUSES,
		answerControl,
		canComplete,
		createEmptyDraft,
		draftFromAssessment,
		lifelineProgress,
		sectionProgress,
		toUiStatus,
		type AssessmentSectionId,
		type DailySopAssessment,
		type DailySopDraft,
		type LifelineId,
		type LifelineStatus,
		type SopUiStatus
	} from '..';
	import {
		useCreateDailySop,
		useDailySopAssessment,
		useDailySopAssessments,
		useUpdateDailySop
	} from '../application/queries';
	import DailySopActionBar from './daily-sop-action-bar.svelte';

	type View =
		| 'history'
		| 'menu'
		| 'section'
		| 'snapshot-menu'
		| 'snapshot-section'
		| 'edit-menu'
		| 'edit-section';

	const shelterCode = $derived(getShelterCode());
	const shelterQuery = useShelter(() => shelterCode);
	const historyQuery = useDailySopAssessments(() => shelterCode);
	const createMutation = useCreateDailySop();
	const updateMutation = useUpdateDailySop();
	let snapshotId = $state<string | null>(null);
	const snapshotQuery = useDailySopAssessment(() => snapshotId);

	let view = $state<View>('history');
	let activeSection = $state<AssessmentSectionId>('registration');
	let draft = $state<DailySopDraft>(createEmptyDraft());
	let assessorName = $state('');
	let hydratedEditId = $state<string | null>(null);
	let saveDialogOpen = $state(false);
	let saveDialogTitle = $state('');
	let saveDialogDescription = $state('');

	const shelterName = $derived(shelterQuery.data?.name ?? `ศูนย์พักพิง ${shelterCode}`);
	const currentUserId = $derived(authStore.user?.name ?? 'ไม่ทราบผู้ใช้');
	const currentAssessorName = $derived(authStore.user?.display_name?.trim() || currentUserId);
	const history = $derived(historyQuery.data ?? []);
	const snapshot = $derived(snapshotQuery.data ?? null);
	const isReadOnly = $derived(view === 'snapshot-menu' || view === 'snapshot-section');
	const isEditing = $derived(view === 'edit-menu' || view === 'edit-section');
	const selectedSection = $derived(
		DAILY_SOP_SECTIONS_WITH_ITEMS.find((section) => section.id === activeSection)
	);
	const activeQuestions = $derived(selectedSection?.items ?? []);

	function initialView(): View {
		const requested = page.url.searchParams.get('view');
		if (requested === 'menu' || requested === 'section') return requested;
		if (
			requested === 'snapshot-menu' ||
			requested === 'snapshot-section' ||
			requested === 'edit-menu' ||
			requested === 'edit-section'
		)
			return requested;
		return 'history';
	}

	$effect(() => {
		view = initialView();
		snapshotId = page.url.searchParams.get('snapshot');
		const requestedSection = page.url.searchParams.get('section') as AssessmentSectionId | null;
		if (requestedSection) activeSection = requestedSection;
	});

	$effect(() => {
		if (isEditing && snapshot && hydratedEditId !== snapshot._id) {
			draft = draftFromAssessment(snapshot);
			assessorName = snapshot.assessor_name;
			hydratedEditId = snapshot._id;
		}
	});

	function formatDate(value: string): string {
		return new Intl.DateTimeFormat('th-TH', {
			timeZone: 'Asia/Bangkok',
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		}).format(new Date(value));
	}

	function formatTime(value: string): string {
		return new Intl.DateTimeFormat('th-TH', {
			timeZone: 'Asia/Bangkok',
			hour: '2-digit',
			minute: '2-digit'
		}).format(new Date(value));
	}

	function navigate(next: View, section?: AssessmentSectionId, id?: string): void {
		view = next;
		if (section) activeSection = section;
		const keepsSnapshot = next.startsWith('snapshot-') || next.startsWith('edit-');
		const targetSnapshotId = id ?? (keepsSnapshot ? snapshotId : null);
		snapshotId = targetSnapshotId;
		const params = new SvelteURLSearchParams();
		params.set('view', next);
		if (section) params.set('section', section);
		if (targetSnapshotId) params.set('snapshot', targetSnapshotId);
		if (next === 'history') void historyQuery.refetch();
		void goto(`/back-office/dailysop?${params.toString()}`, { keepFocus: true, noScroll: true });
	}

	function startAssessment(): void {
		const today = bangkokDate(new Date());
		const existing = history.find((item) => item.assessment_date === today);
		if (existing) {
			openEdit(existing);
			return;
		}
		draft = createEmptyDraft();
		assessorName = currentAssessorName;
		activeSection = 'registration';
		hydratedEditId = null;
		navigate('menu');
	}

	function openEdit(item: DailySopAssessment): void {
		snapshotId = item._id;
		draft = draftFromAssessment(item);
		assessorName = item.assessor_name;
		activeSection = 'registration';
		hydratedEditId = item._id;
		navigate('edit-menu', undefined, item._id);
	}

	function selectControl(id: string, status: SopUiStatus): void {
		if (isReadOnly) return;
		draft = answerControl(draft, id, status, currentUserId, new Date().toISOString());
	}

	function selectLifeline(id: LifelineId, status: LifelineStatus): void {
		if (isReadOnly) return;
		draft.lifelines[id] = status;
	}

	function statusLabel(status: SopUiStatus): string {
		return { Pass: 'ผ่าน (Pass)', Fail: 'ไม่ผ่าน (Fail)', Pending: 'รอแก้ไข (Pending)' }[status];
	}

	function storedStatusLabel(status: DailySopAssessment['controls'][number]['status']): string {
		return statusLabel(toUiStatus(status));
	}

	function lifelineStatusLabel(status: LifelineStatus | null | undefined): string {
		if (!status) return 'ยังไม่ระบุสถานะ';
		return {
			Operational: 'ใช้งานได้ (Operational)',
			Interrupted: 'ขัดข้อง (Interrupted)',
			Critical: 'วิกฤต (Critical)'
		}[status];
	}

	function assessmentStatusLabel(status: DailySopAssessment['status']): string {
		return status === 'Completed' ? 'เสร็จสิ้น (Completed)' : 'กำลังประเมิน (In Progress)';
	}

	function assessmentStatusClass(status: DailySopAssessment['status']): string {
		return status === 'Completed'
			? 'border-emerald-200 bg-emerald-50 text-emerald-700'
			: 'border-amber-200 bg-amber-50 text-amber-700';
	}

	function controlCardClass(status: SopUiStatus): string {
		return {
			Pass: 'border-emerald-200 bg-emerald-50/60',
			Fail: 'border-rose-200 bg-rose-50/60',
			Pending: 'border-amber-200 bg-amber-50/60'
		}[status];
	}

	function controlStatusClass(status: SopUiStatus): string {
		return {
			Pass: 'border-emerald-200 bg-emerald-50 text-emerald-700',
			Fail: 'border-rose-200 bg-rose-50 text-rose-700',
			Pending: 'border-amber-200 bg-amber-50 text-amber-700'
		}[status];
	}

	function controlAuditClass(status: SopUiStatus): string {
		return { Pass: 'text-emerald-700', Fail: 'text-rose-700', Pending: 'text-amber-700' }[status];
	}

	function progressTone(done: number, total: number): string {
		if (done === 0) return 'border-rose-200 bg-rose-50 text-rose-700';
		if (done === total) return 'border-emerald-200 bg-emerald-50 text-emerald-700';
		return 'border-amber-200 bg-amber-50 text-amber-700';
	}

	function progressBarTone(done: number, total: number): string {
		if (done === 0) return 'bg-rose-500';
		if (done === total) return 'bg-emerald-500';
		return 'bg-amber-500';
	}

	function cardProgressLabel(done: number, total: number): string {
		return done === total && total > 0 ? 'ประเมินแล้ว' : `ตอบแล้ว ${done}/${total}`;
	}

	function historyProgressTone(percent: number): string {
		if (percent >= 100) return 'bg-emerald-500';
		if (percent > 0) return 'bg-amber-500';
		return 'bg-rose-500';
	}

	function historyProgressLabel(percent: number): string {
		if (percent >= 100) return 'เสร็จครบ';
		if (percent > 0) return 'อยู่ระหว่างประเมิน';
		return 'ยังไม่เริ่ม';
	}

	function sectionStatus(sectionId: AssessmentSectionId): { done: number; total: number } {
		if (sectionId === 'lifelines') return lifelineProgress(draft);
		return sectionProgress(draft, sectionId);
	}

	function snapshotSectionStatus(sectionId: AssessmentSectionId): { done: number; total: number } {
		if (!snapshot) return { done: 0, total: sectionId === 'lifelines' ? 4 : 0 };
		if (sectionId === 'lifelines') {
			return { done: LIFELINE_KEYS.filter((key) => snapshot.lifelines[key]).length, total: 4 };
		}
		const items = snapshot.controls.filter((control) => control.section_id === sectionId);
		return { done: items.filter((control) => control.answered).length, total: items.length };
	}

	function bangkokDate(date: Date): string {
		const parts = new Intl.DateTimeFormat('en-CA', {
			timeZone: 'Asia/Bangkok',
			year: 'numeric',
			month: '2-digit',
			day: '2-digit'
		}).formatToParts(date);
		const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
		return `${value.year}-${value.month}-${value.day}`;
	}

	async function saveNewAssessment(): Promise<void> {
		const hasAnswer =
			Object.values(draft.answeredControls).some(Boolean) ||
			Object.values(draft.lifelines).some((status) => status !== null);
		if (!hasAnswer) {
			toast.error('ยังไม่มีข้อมูลให้บันทึก');
			return;
		}
		try {
			const result = await createMutation.mutateAsync({
				draft,
				date: bangkokDate(new Date()),
				ctx: { shelterCode, createdBy: currentUserId, assessorName: currentAssessorName }
			});
			if (result.kind === 'duplicate') {
				void historyQuery.refetch();
				showSaveDialog(
					'มีรายการประเมินของวันนี้แล้ว',
					'คำตอบที่กำลังกรอกยังอยู่ในหน้านี้ กรุณาเปิดรายการล่าสุดจากประวัติเพื่อตรวจสอบก่อนบันทึกอีกครั้ง'
				);
				return;
			}
			draft = createEmptyDraft();
			assessorName = '';
			snapshotId = null;
			hydratedEditId = null;
			navigate('history');
			showSaveSuccess('บันทึกการประเมินสำเร็จ');
		} catch (error) {
			handleSaveError(error, 'บันทึกผลการประเมินไม่สำเร็จ');
		}
	}

	async function updateAssessment(): Promise<void> {
		if (!snapshot) return;
		try {
			await updateMutation.mutateAsync({
				existing: snapshot,
				draft,
				ctx: { shelterCode, createdBy: currentUserId, assessorName: currentAssessorName }
			});
			draft = createEmptyDraft();
			assessorName = '';
			snapshotId = null;
			hydratedEditId = null;
			navigate('history');
			showSaveSuccess('บันทึกการแก้ไขสำเร็จ');
		} catch (error) {
			handleSaveError(error, 'แก้ไขผลการประเมินไม่สำเร็จ');
		}
	}

	function handleSaveError(error: unknown, title: string): void {
		if (error instanceof AuthError) {
			authStore.markNeedsReauth();
			backofficeState.requestReauth();
			toast.error(title, { description: 'Session หมดอายุ กรุณาเข้าสู่ระบบอีกครั้ง' });
			return;
		}
		if (error instanceof ConflictError) {
			showSaveDialog(
				title,
				'รายการนี้ถูกแก้ไขจากอีก Session กรุณากลับไปเปิดข้อมูลล่าสุดแล้วลองใหม่'
			);
			return;
		}
		if (error instanceof CannotConnectError) {
			showSaveDialog(
				title,
				'เชื่อมต่อ CouchDB ไม่ได้ คำตอบยังอยู่ในหน้านี้ กรุณาลองใหม่เมื่อออนไลน์'
			);
			return;
		}
		if (error instanceof CouchDocumentPolicyError) {
			showSaveDialog(title, error.reason ?? error.message);
			return;
		}
		showSaveDialog(title, errorMessage(error));
	}

	function showSaveSuccess(title: string, description?: string): void {
		toast.success(title, {
			...(description ? { description } : {}),
			duration: 4500,
			classes: {
				title: 'font-bold',
				description: 'text-sm opacity-90'
			}
		});
	}

	function showSaveDialog(title: string, description: string): void {
		saveDialogTitle = title;
		saveDialogDescription = description;
		saveDialogOpen = true;
	}
</script>

<svelte:head><title>การประเมินประจำวัน (Daily SOP)</title></svelte:head>

<div class="min-h-full bg-[#f5f7fa] px-3 py-4 sm:px-5 md:px-7 md:py-7">
	<div class="mx-auto flex w-full max-w-[1480px] flex-col gap-5">
		{#if endpointStore.status === 'disconnected'}
			<div
				class="flex items-start gap-3 rounded-[24px] border border-amber-200 bg-[#fffcf2] px-4 py-4 text-amber-950 shadow-sm md:px-6"
				role="status"
			>
				<div class="rounded-2xl bg-amber-100 p-3 text-amber-700"><CloudOff class="size-5" /></div>
				<div class="min-w-0">
					<div class="flex flex-wrap items-center gap-2">
						<span
							class="rounded-full bg-amber-200/70 px-2.5 py-1 font-mono text-xs font-bold tracking-[0.12em] text-amber-900"
							>LOCAL OFFLINE MODE ACTIVE</span
						>
					</div>
					<p class="mt-2 text-[15px] leading-7 font-medium sm:text-base">
						ระบบไม่สามารถเชื่อมต่อ CouchDB ได้ คำตอบที่กำลังแก้ไขจะยังอยู่ในหน้านี้
						กรุณาตรวจสอบเครือข่าย แล้วกดสลับโหมดเน็ตเพื่อเชื่อมต่อก่อนบันทึกอีกครั้ง
					</p>
				</div>
			</div>
		{/if}

		{#if view === 'history'}
			<section class="overflow-hidden rounded-[28px] border border-black/[0.04] bg-white shadow-sm">
				<div
					class="flex flex-col gap-4 border-b border-slate-100 px-5 py-6 sm:flex-row sm:items-center sm:justify-between md:px-8"
				>
					<div class="flex items-start gap-3">
						<div class="rounded-xl bg-slate-100 p-2.5 text-[#013365]">
							<ClipboardCheck class="size-5" />
						</div>
						<div>
							<h2 class="text-lg font-bold tracking-tight text-[#1d1d1f] md:text-xl">
								ประวัติการประเมินมาตรฐานประจำวัน (SOP & Lifelines)
							</h2>
							<p class="mt-1 text-sm text-[#86868b]">
								ดูประวัติหรือสร้างแบบประเมินสำหรับวันนี้ เพื่ออัปเดตสถานะให้เป็นปัจจุบัน
							</p>
						</div>
					</div>
					<button
						type="button"
						class="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-[#013365] px-5 text-sm font-bold text-white shadow-sm transition hover:bg-[#002244] focus-visible:ring-2 focus-visible:ring-[#013365] focus-visible:ring-offset-2"
						onclick={startAssessment}
					>
						<Activity class="size-4" /> เริ่มการประเมิน
					</button>
				</div>

				{#if historyQuery.isLoading && history.length === 0}
					<div class="px-6 py-16 text-center text-sm text-slate-500">
						กำลังโหลดประวัติการประเมิน...
					</div>
				{:else if historyQuery.isError && history.length === 0}
					<div class="px-6 py-16 text-center text-sm text-rose-600">
						ไม่สามารถโหลดประวัติได้ กรุณาตรวจสอบการเชื่อมต่อ
					</div>
				{:else if history.length === 0}
					<div class="px-6 py-16 text-center text-sm text-slate-500">ยังไม่มีประวัติการประเมิน</div>
				{:else}
					<div class="overflow-x-auto">
						<table class="w-full min-w-[860px] border-collapse text-left text-sm">
							<thead class="border-b border-black/[0.04] bg-slate-50 text-xs text-[#1d1d1f]">
								<tr>
									<th class="px-6 py-4 font-bold whitespace-nowrap">วันที่ประเมิน</th>
									<th class="px-6 py-4 font-bold whitespace-nowrap">ศูนย์พักพิง</th>
									<th class="px-6 py-4 font-bold whitespace-nowrap">ผู้ประเมิน</th>
									<th class="px-6 py-4 text-center font-bold whitespace-nowrap">ความคืบหน้า</th>
									<th class="px-6 py-4 text-center font-bold whitespace-nowrap">สถานะ</th>
									<th class="px-6 py-4 text-right font-bold whitespace-nowrap">จัดการ</th>
								</tr>
							</thead>
							<tbody class="divide-y divide-black/[0.04] text-[#333336]">
								{#each history as item (item._id)}
									<tr class="group transition-colors hover:bg-[#f5f5f7]" data-testid="history-row">
										<td class="px-6 py-4">
											<div class="flex items-center gap-2 whitespace-nowrap">
												<CalendarDays class="size-4 shrink-0 text-[#86868b]" />
												<span class="text-sm font-semibold text-[#1d1d1f]"
													>{formatDate(item.assessed_at)}</span
												>
												<span class="text-xs text-[#86868b]">{formatTime(item.assessed_at)} น.</span
												>
											</div>
										</td>
										<td class="px-6 py-4 font-medium">{shelterName}</td>
										<td class="px-6 py-4">
											<div class="flex items-start gap-2">
												<UserRound class="mt-0.5 size-4 shrink-0 text-[#86868b]" />
												<span>{item.assessor_name}</span>
											</div>
										</td>
										<td class="min-w-[150px] px-6 py-4 text-center">
											<div
												class="mx-auto flex w-[132px] flex-col items-center gap-2"
												aria-label={`ความคืบหน้า ${item.progress_percent}% — ${historyProgressLabel(item.progress_percent)}`}
												title={historyProgressLabel(item.progress_percent)}
											>
												<span class="text-sm font-semibold text-[#1d1d1f]"
													>{item.progress_percent}%</span
												>
												<div class="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
													<div
														class={`h-full rounded-full transition-all ${historyProgressTone(item.progress_percent)}`}
														style={`width: ${Math.max(0, Math.min(100, item.progress_percent))}%`}
													></div>
												</div>
											</div>
										</td>
										<td class="px-6 py-4 text-center">
											<span
												class={`inline-flex items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-bold ${assessmentStatusClass(item.status)}`}
												><CheckCircle2 class="size-3.5" />
												{assessmentStatusLabel(item.status)}</span
											>
										</td>
										<td class="px-6 py-4 text-right">
											<button
												type="button"
												class="inline-flex items-center gap-1.5 rounded-lg border border-blue-100 bg-blue-50 px-3 py-1.5 text-xs font-bold text-[#013365] shadow-sm hover:bg-[#013365] hover:text-white"
												onclick={() => openEdit(item)}>จัดการ</button
											>
										</td>
									</tr>
								{/each}
							</tbody>
						</table>
					</div>
				{/if}
			</section>
		{:else if view === 'menu' || view === 'snapshot-menu' || view === 'edit-menu'}
			<section class="flex flex-col gap-5">
				<div
					class="flex flex-col gap-4 rounded-[24px] border border-black/[0.04] bg-white px-5 py-5 shadow-sm sm:flex-row sm:items-center sm:justify-between md:px-7"
				>
					<div class="flex min-w-0 flex-1 items-start gap-3">
						<button
							type="button"
							aria-label="กลับสู่ประวัติการประเมิน"
							class="mt-0.5 rounded-full bg-[#f5f5f7] p-2 text-[#1d1d1f] hover:bg-[#e8e8ed]"
							onclick={() => navigate('history')}><ArrowLeft class="size-5" /></button
						>
						<div class="min-w-0">
							<h2 class="text-xl font-bold text-[#1d1d1f]">
								{isReadOnly
									? 'รายละเอียดการประเมิน'
									: isEditing
										? 'แก้ไขผลการประเมิน'
										: 'หน้าหลักแบบประเมิน (Assessment Menu)'}
							</h2>
							<p class="mt-1 text-sm text-[#86868b]">
								{isReadOnly
									? `ดูผลการประเมินของ ${snapshot?.assessor_name ?? 'รายการที่เลือก'}`
									: isEditing
										? 'เลือกหมวดที่ต้องการแก้ไข แล้วบันทึกผลอีกครั้ง'
										: `เลือกหมวดหมู่ที่ต้องการประเมินสำหรับ ${formatDate(new Date().toISOString())}`}
							</p>
						</div>
					</div>
				</div>
				<div class="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
					{#each DAILY_SOP_SECTIONS_WITH_ITEMS as section (section.id)}
						{@const stat = isReadOnly
							? snapshotSectionStatus(section.id)
							: sectionStatus(section.id)}
						<button
							type="button"
							data-testid="sop-card"
							class="group flex min-h-44 flex-col rounded-[20px] border border-black/[0.04] bg-white p-5 text-left shadow-sm transition hover:border-[#013365]/30 hover:shadow-md"
							onclick={() =>
								navigate(
									isReadOnly ? 'snapshot-section' : isEditing ? 'edit-section' : 'section',
									section.id
								)}
							><div class="flex items-start justify-between gap-3">
								<div
									class="flex size-12 items-center justify-center rounded-full bg-[#f5f5f7] text-[#013365]"
								>
									<ClipboardCheck class="size-6" />
								</div>
								<span
									data-testid="card-progress"
									class={`rounded-lg border px-2.5 py-1 text-xs font-bold ${progressTone(stat.done, stat.total)}`}
									>{cardProgressLabel(stat.done, stat.total)}</span
								>
							</div>
							<h3 class="mt-6 text-base font-bold text-[#1d1d1f]">{section.label}</h3>
							<div class="mt-auto flex items-center gap-3 pt-4">
								<div class="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
									<div
										class={`h-full rounded-full transition-all ${progressBarTone(stat.done, stat.total)}`}
										style={`width: ${stat.total ? (stat.done / stat.total) * 100 : 0}%`}
									></div>
								</div>
								<ChevronRight class="size-5 text-[#86868b] group-hover:text-[#013365]" />
							</div></button
						>
					{/each}
					{#if isReadOnly}
						{@const stat = snapshotSectionStatus('lifelines')}
						<button
							type="button"
							data-testid="sop-card"
							class="group flex min-h-44 flex-col rounded-[20px] border border-black/[0.04] bg-white p-5 text-left shadow-sm transition hover:border-[#013365]/30 hover:shadow-md"
							onclick={() => navigate('snapshot-section', 'lifelines')}
							><div class="flex items-start justify-between gap-3">
								<div
									class="flex size-12 items-center justify-center rounded-full bg-[#f5f5f7] text-[#013365]"
								>
									<Radio class="size-6" />
								</div>
								<span
									data-testid="card-progress"
									class={`rounded-lg border px-2.5 py-1 text-xs font-bold ${progressTone(stat.done, stat.total)}`}
									>{cardProgressLabel(stat.done, stat.total)}</span
								>
							</div>
							<h3 class="mt-6 text-base font-bold text-[#1d1d1f]">
								7. สถานะสาธารณูปโภค (Lifelines)
							</h3>
							<div class="mt-auto flex items-center gap-3 pt-4">
								<div class="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
									<div
										class={`h-full rounded-full transition-all ${progressBarTone(stat.done, stat.total)}`}
										style={`width: ${stat.total ? (stat.done / stat.total) * 100 : 0}%`}
									></div>
								</div>
								<ChevronRight class="size-5 text-[#86868b] group-hover:text-[#013365]" />
							</div></button
						>
					{:else}
						{@const stat = sectionStatus('lifelines')}
						<button
							type="button"
							data-testid="sop-card"
							class="group flex min-h-44 flex-col rounded-[20px] border border-black/[0.04] bg-white p-5 text-left shadow-sm transition hover:border-[#013365]/30 hover:shadow-md"
							onclick={() => navigate(isEditing ? 'edit-section' : 'section', 'lifelines')}
							><div class="flex items-start justify-between gap-3">
								<div
									class="flex size-12 items-center justify-center rounded-full bg-[#f5f5f7] text-[#013365]"
								>
									<Radio class="size-6" />
								</div>
								<span
									data-testid="card-progress"
									class={`rounded-lg border px-2.5 py-1 text-xs font-bold ${progressTone(stat.done, stat.total)}`}
									>{cardProgressLabel(stat.done, stat.total)}</span
								>
							</div>
							<h3 class="mt-6 text-base font-bold text-[#1d1d1f]">
								7. สถานะสาธารณูปโภค (Lifelines)
							</h3>
							<div class="mt-auto flex items-center gap-3 pt-4">
								<div class="h-1 flex-1 overflow-hidden rounded-full bg-slate-100">
									<div
										class={`h-full rounded-full transition-all ${progressBarTone(stat.done, stat.total)}`}
										style={`width: ${stat.total ? (stat.done / stat.total) * 100 : 0}%`}
									></div>
								</div>
								<ChevronRight class="size-5 text-[#86868b] group-hover:text-[#013365]" />
							</div></button
						>
					{/if}
				</div>
				{#if view === 'edit-menu'}
					<DailySopActionBar
						mode="edit"
						pending={updateMutation.isPending}
						testId="save-edited-assessment"
						showBack={false}
						onSave={updateAssessment}
						onBack={() => navigate('history')}
					/>
				{:else if view === 'menu'}
					<DailySopActionBar
						mode="draft"
						pending={createMutation.isPending}
						testId="complete-assessment"
						showBack={false}
						saveLabel={canComplete(draft) ? 'บันทึกผลการประเมิน' : 'บันทึกการประเมิน'}
						onSave={saveNewAssessment}
						onBack={() => navigate('history')}
					/>
				{/if}
			</section>
		{:else if view === 'section' || view === 'snapshot-section' || view === 'edit-section'}
			<section class="flex flex-col gap-5 pb-24">
				<div class="rounded-[24px] border border-black/[0.04] bg-white px-5 py-5 shadow-sm md:px-7">
					<div class="flex items-start gap-3">
						<button
							type="button"
							aria-label="กลับสู่เมนูแบบประเมิน"
							class="mt-0.5 rounded-full bg-[#f5f5f7] p-2 text-[#1d1d1f] hover:bg-[#e8e8ed]"
							onclick={() =>
								navigate(isReadOnly ? 'snapshot-menu' : isEditing ? 'edit-menu' : 'menu')}
							><ArrowLeft class="size-5" /></button
						>
						<div>
							<h2 class="text-xl font-bold text-[#1d1d1f]">
								{activeSection === 'lifelines'
									? '7. สถานะสาธารณูปโภค (Lifelines)'
									: selectedSection?.label}
							</h2>
							<p class="mt-1 text-sm text-[#86868b]">
								{isReadOnly
									? 'ผลการประเมินที่บันทึกไว้ — อ่านอย่างเดียว'
									: isEditing
										? 'แก้ไขสถานะได้ทุกข้อ แล้วกลับไปบันทึกการแก้ไข'
										: 'ทำเครื่องหมายตรวจสอบหัวข้อการปฏิบัติงาน'}
							</p>
						</div>
					</div>
				</div>
				<div class="rounded-[24px] border border-black/[0.04] bg-white p-4 shadow-sm md:p-6">
					<div class="mb-5 flex items-center gap-3 rounded-2xl bg-[#f5f5f7] p-4">
						<span class="text-sm font-bold text-[#1d1d1f]">ผู้ประเมิน:</span><span
							class="text-sm font-bold text-[#1d1d1f]"
							>{isReadOnly ? snapshot?.assessor_name : assessorName}</span
						>
					</div>
					{#if activeSection === 'lifelines'}
						<div class="grid gap-4 md:grid-cols-2">
							{#each DAILY_SOP_LIFELINES as lifeline (lifeline.id)}<article
									class="rounded-2xl border border-black/[0.04] p-4"
								>
									<div class="flex items-start justify-between">
										<div>
											<h3 class="font-bold text-[#1d1d1f]">{lifeline.label}</h3>
										</div>
										<Radio class="size-6 text-[#013365]" />
									</div>
									{#if isReadOnly}<div
											class="mt-4 rounded-xl bg-[#f5f5f7] px-3 py-2 text-sm font-bold text-[#1d1d1f]"
										>
											{lifelineStatusLabel(snapshot?.lifelines[lifeline.id])}
										</div>{:else}<select
											data-testid="lifeline-select"
											class="mt-4 h-11 w-full rounded-xl border border-black/[0.06] bg-[#f5f5f7] px-3 text-sm font-bold text-[#1d1d1f]"
											value={draft.lifelines[lifeline.id] ?? ''}
											onchange={(event) =>
												selectLifeline(lifeline.id, event.currentTarget.value as LifelineStatus)}
											><option value="" disabled>เลือกสถานะ</option>
											>{#each ['Operational', 'Interrupted', 'Critical'] as status (status)}<option
													value={status}>{lifelineStatusLabel(status as LifelineStatus)}</option
												>
											{/each}</select
										>{/if}
								</article>{/each}
						</div>
					{:else if isReadOnly}
						<div class="space-y-4">
							{#each snapshot?.controls.filter((control) => control.section_id === activeSection) ?? [] as item (item.id)}
								{@const uiStatus = toUiStatus(item.status)}
								<article
									class={`grid gap-3 rounded-2xl border p-4 md:grid-cols-[minmax(0,1fr)_14rem] md:items-center md:gap-6 md:p-5 ${controlCardClass(uiStatus)}`}
								>
									<div class="min-w-0">
										<p
											data-testid="sop-question"
											class="text-sm leading-6 font-bold text-[#1d1d1f] md:text-base"
										>
											{item.question}
										</p>
										<p class={`mt-2 text-xs font-bold ${controlAuditClass(uiStatus)}`}>
											✓ ประเมินโดย {item.checked_by} ({formatTime(item.checked_at)} น.)
										</p>
									</div>
									<div
										data-testid="snapshot-answer"
										class={`inline-flex min-h-11 items-center rounded-xl border px-4 py-2 text-sm font-bold md:justify-center ${controlStatusClass(uiStatus)}`}
									>
										{storedStatusLabel(item.status)}
									</div>
								</article>
							{/each}
						</div>
					{:else}
						<div class="space-y-4">
							{#each activeQuestions as item (item.id)}
								{@const itemStatus = draft.controls[item.id]}
								{@const audit = draft.controlAudit[item.id]}
								<article
									class={`grid gap-3 rounded-2xl border p-4 md:grid-cols-[minmax(0,1fr)_14rem] md:items-center md:gap-6 md:p-5 ${controlCardClass(itemStatus)}`}
								>
									<div class="min-w-0">
										<p
											data-testid="sop-question"
											class="text-sm leading-6 font-bold text-[#1d1d1f] md:text-base"
										>
											{item.prompt}
										</p>
										{#if audit}
											<p class={`mt-2 text-xs font-bold ${controlAuditClass(itemStatus)}`}>
												✓ ประเมินโดย {audit.checkedBy} ({formatTime(audit.checkedAt)} น.)
											</p>
										{/if}
									</div>
									<select
										data-testid="status-select"
										class={`h-11 w-full rounded-xl border px-3 text-sm font-bold md:w-56 md:justify-self-end ${controlStatusClass(itemStatus)}`}
										value={draft.controls[item.id]}
										onchange={(event) =>
											selectControl(item.id, event.currentTarget.value as SopUiStatus)}
									>
										{#each SOP_UI_STATUSES as status (status)}<option value={status}
												>{statusLabel(status)}</option
											>
										{/each}
									</select>
								</article>
							{/each}
						</div>
					{/if}
				</div>
				{#if !isReadOnly}
					<DailySopActionBar
						mode={isEditing ? 'edit' : 'draft'}
						pending={isEditing ? updateMutation.isPending : createMutation.isPending}
						testId={isEditing ? 'save-edited-section' : 'save-section-draft'}
						saveLabel={!isEditing && canComplete(draft) ? 'บันทึกผลการประเมิน' : undefined}
						onSave={isEditing ? updateAssessment : saveNewAssessment}
						onBack={() => navigate(isEditing ? 'edit-menu' : 'menu')}
					/>
				{/if}
			</section>
		{/if}
	</div>
</div>

<Dialog.Root bind:open={saveDialogOpen}>
	<Dialog.Content class="sm:max-w-md" data-testid="save-result-dialog">
		<Dialog.Header>
			<div
				class="mb-1 flex size-10 items-center justify-center rounded-full bg-rose-100 text-rose-700"
			>
				<CloudOff class="size-5" />
			</div>
			<Dialog.Title>{saveDialogTitle}</Dialog.Title>
			<Dialog.Description>{saveDialogDescription}</Dialog.Description>
		</Dialog.Header>
		<Dialog.Footer>
			<button
				type="button"
				class="h-10 rounded-lg bg-[#013365] px-5 text-sm font-bold text-white hover:bg-[#002244]"
				onclick={() => (saveDialogOpen = false)}>ปิด</button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
