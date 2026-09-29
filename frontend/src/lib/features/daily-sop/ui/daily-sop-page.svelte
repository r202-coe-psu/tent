<!-- Hallmark · pre-emit critique: P4 H4 E3 S4 R4 V4 -->
<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import { ArrowLeft, CheckCircle2, ClipboardCheck, Save, TriangleAlert } from '@lucide/svelte';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { useDashboardOccupancy } from '$lib/features/dashboard';
	import { useShelter } from '$lib/features/shelters';
	import { useActiveSopRatio } from '$lib/features/sop-ratios';
	import { buildDailySopRoleId } from '../data/daily-sop.remote';
	import {
		DAILY_SOP_ROLES,
		assessableRoles,
		canCompleteRoleDraft,
		createEmptyRoleDraft,
		dailySopBangkokDate,
		dailySopReviewDates,
		hasRoleDraftInput,
		metricParameterForQuestion,
		metricForQuestion,
		promptForQuestion,
		questionsForRole,
		roleAssessmentProgress,
		roleDraftFromAssessment,
		roleForCode,
		summarizeRoleDraft,
		type DailySopRoleAssessment,
		type DailySopRoleControlDraft,
		type DailySopRoleCode,
		type DailySopRoleDraft,
		type DailySopRoleStatus
	} from '../domain/daily-sop';
	import {
		useDailySopRoleAssessment,
		useDailySopRoleAssessments,
		useSaveDailySopRoleAssessment
	} from '../application/queries';

	const shelterCode = $derived(getShelterCode());
	const occupancyQuery = useDashboardOccupancy(() => shelterCode);
	const shelterQuery = useShelter(() => shelterCode);
	const sopRatioQuery = useActiveSopRatio(() => shelterCode);
	const sopRatios = $derived(sopRatioQuery.data?.ratios ?? null);
	const user = $derived(authStore.user);
	const userRoles = $derived(user?.roles ?? []);
	const availableRoles = $derived(assessableRoles(userRoles, shelterCode));
	const today = dailySopBangkokDate();
	const date = $derived(page.url.searchParams.get('date') ?? today);
	const isCurrentDate = $derived(date === today);
	const isHistoricalDate = $derived(date < today);
	const landingView = $derived(page.url.searchParams.get('view') === 'roles' ? 'roles' : 'days');
	const roleParam = $derived(page.url.searchParams.get('role'));
	const selectedRole = $derived(roleParam ? roleForCode(roleParam) : null);
	const historyQuery = useDailySopRoleAssessments(() => shelterCode);

	let draft = $state<DailySopRoleDraft>({});
	let hydratedId = $state('');
	let isSaving = $state(false);
	let saveSuccessOpen = $state(false);
	let savedAssessment = $state<DailySopRoleAssessment | null>(null);

	const history = $derived(historyQuery.data ?? []);
	const historyRows = $derived.by(() => {
		return [...history].sort(
			(a, b) =>
				b.assessment_date.localeCompare(a.assessment_date) ||
				b.updated_at.localeCompare(a.updated_at)
		);
	});
	const assessmentByDateRole = $derived.by(
		() => new Map(historyRows.map((item) => [`${item.assessment_date}:${item.role_code}`, item]))
	);
	const canAssessSelectedRole = $derived(
		Boolean(selectedRole && availableRoles.some((role) => role.code === selectedRole.code))
	);
	const hasSelectedAssessment = $derived(
		Boolean(selectedRole && assessmentByDateRole.has(`${date}:${selectedRole.code}`))
	);
	const canEditSelectedRole = $derived(Boolean(isCurrentDate && canAssessSelectedRole));
	const canReviewSelectedRole = $derived(
		Boolean((isHistoricalDate || isCurrentDate) && hasSelectedAssessment)
	);
	const canOpenSelectedRole = $derived(Boolean(canEditSelectedRole || canReviewSelectedRole));
	const selectedId = $derived(
		selectedRole && (canEditSelectedRole || canReviewSelectedRole)
			? buildDailySopRoleId(shelterCode, date, selectedRole.code)
			: null
	);
	const selectedQuery = useDailySopRoleAssessment(() => selectedId);
	const saveMutation = useSaveDailySopRoleAssessment();
	const roleRows = $derived.by(() => rowsForDate(date));
	const dailySummary = $derived.by(() => summarizeRows(roleRows));
	const dayRows = $derived.by(() => {
		return dailySopReviewDates(
			historyRows.map((item) => item.assessment_date),
			today
		).map((assessmentDate) => {
			const roles = rowsForDate(assessmentDate);
			return {
				date: assessmentDate,
				roles,
				...summarizeRows(roles),
				lastUpdatedAt: roles.reduce<string | null>((latest, row) => {
					const updatedAt = row.assessment?.updated_at;
					return updatedAt && (!latest || updatedAt > latest) ? updatedAt : latest;
				}, null)
			};
		});
	});
	const activeAssessment = $derived(selectedQuery.data ?? null);
	const isLoadingAssessment = $derived(Boolean(selectedId && selectedQuery.isLoading));
	const capacityMetricValues = $derived.by(() => {
		const occupancy = occupancyQuery.data;
		const shelter = shelterQuery.data;
		const capacity = shelter?.capacity;
		if (
			occupancy?.shelter_code !== shelterCode ||
			shelter?.code !== shelterCode ||
			typeof capacity !== 'number' ||
			!Number.isFinite(capacity) ||
			typeof occupancy.active !== 'number' ||
			!Number.isFinite(occupancy.active)
		)
			return null;
		return { occupants: occupancy.active, capacity };
	});
	const isLoadingCapacityValues = $derived(occupancyQuery.isLoading || shelterQuery.isLoading);
	const effectiveDraft = $derived.by(() => {
		if (selectedRole?.code !== 'SM' || !isCurrentDate || isLoadingAssessment) return draft;
		const answer = draft['D-SM-02'];
		const saved = activeAssessment?.controls.find((control) => control.id === 'D-SM-02');
		if (!answer || hasRecordedControl(saved) || !capacityMetricValues) return draft;
		const calculated = metricForQuestion('D-SM-02')?.evaluate(capacityMetricValues) ?? null;
		return {
			...draft,
			'D-SM-02': {
				...answer,
				status: answer.status ?? (calculated === null ? null : calculated ? 'Pass' : 'Fail'),
				measured_values: { ...answer.measured_values, ...capacityMetricValues }
			}
		};
	});
	const questions = $derived.by(() => {
		if (!selectedRole) return [];
		if (activeAssessment)
			return activeAssessment.controls.map(({ id, question }) => ({ id, prompt: question }));
		return questionsForRole(selectedRole.code).map((question) => ({
			id: question.id,
			prompt: promptForQuestion(question, sopRatios)
		}));
	});
	const progress = $derived(
		selectedRole ? roleAssessmentProgress(effectiveDraft, selectedRole.code) : null
	);
	const counts = $derived(
		selectedRole ? summarizeRoleDraft(effectiveDraft, selectedRole.code) : null
	);
	const isComplete = $derived(
		Boolean(selectedRole && canCompleteRoleDraft(effectiveDraft, selectedRole.code))
	);
	const canSave = $derived(
		Boolean(
			selectedRole &&
			isCurrentDate &&
			hasRoleDraftInput(effectiveDraft, selectedRole.code) &&
			questions.every((question) => {
				const answer = effectiveDraft[question.id];
				return (
					!answer ||
					(answer.status !== 'Fail' && answer.status !== 'Pending') ||
					Boolean(answer.notes.trim())
				);
			})
		)
	);
	const statusOptions = [
		{ value: 'Pass', label: 'ผ่าน' },
		{ value: 'Fail', label: 'ไม่ผ่าน' },
		{ value: 'Pending', label: 'รอตรวจ' }
	] as const;

	$effect(() => {
		const id = selectedId;
		const role = selectedRole;
		const assessment = selectedQuery.data;
		if (!id || !role) {
			hydratedId = '';
			draft = {};
			return;
		}
		if (isLoadingAssessment || hydratedId === id) return;
		draft = assessment ? roleDraftFromAssessment(assessment) : createEmptyRoleDraft(role.code);
		hydratedId = id;
	});

	function updateUrl(
		role: DailySopRoleCode | null,
		nextDate = date,
		nextLandingView: 'days' | 'roles' = role ? 'roles' : landingView
	): void {
		const params = new SvelteURLSearchParams();
		params.set('view', nextLandingView);
		if (role) params.set('role', role);
		if (nextDate) params.set('date', nextDate);
		void goto(`/back-office/dailysop${params.size ? `?${params.toString()}` : ''}`, {
			keepFocus: true,
			noScroll: true
		});
	}

	function rowsForDate(assessmentDate: string) {
		return DAILY_SOP_ROLES.map((role) => {
			const assessment = assessmentByDateRole.get(`${assessmentDate}:${role.code}`);
			const questionCount = assessment?.controls.length || questionsForRole(role.code).length;
			const answeredCount = assessment
				? Math.max(0, questionCount - assessment.unanswered_count)
				: 0;
			return {
				role,
				assessment,
				questionCount,
				answeredCount,
				percent: questionCount ? Math.floor((answeredCount / questionCount) * 100) : 0,
				canAssess: availableRoles.some((item) => item.code === role.code)
			};
		});
	}

	function summarizeRows(rows: ReturnType<typeof rowsForDate>) {
		return {
			roleCount: rows.length,
			recordedRoles: rows.filter((row) => row.assessment).length,
			completedRoles: rows.filter((row) => row.assessment?.status === 'Completed').length,
			inProgressRoles: rows.filter((row) => row.assessment?.status === 'InProgress').length,
			answered: rows.reduce((sum, row) => sum + row.answeredCount, 0),
			total: rows.reduce((sum, row) => sum + row.questionCount, 0),
			fail: rows.reduce((sum, row) => sum + (row.assessment?.fail_count ?? 0), 0),
			pending: rows.reduce((sum, row) => sum + (row.assessment?.pending_count ?? 0), 0)
		};
	}

	function setStatus(id: string, status: DailySopRoleStatus): void {
		const current = draft[id];
		if (!current) return;
		draft = { ...draft, [id]: { ...current, status } };
	}

	function setText(id: string, key: 'notes' | 'observations', text: string): void {
		const current = draft[id];
		if (!current) return;
		draft = { ...draft, [id]: { ...current, [key]: text } };
	}

	function setMeasuredValue(id: string, key: string, text: string): void {
		const current = draft[id];
		if (!current) return;
		const parsed = text.trim() === '' ? null : Number(text);
		draft = {
			...draft,
			[id]: {
				...current,
				measured_values: {
					...current.measured_values,
					[key]: parsed !== null && Number.isFinite(parsed) ? parsed : null
				}
			}
		};
	}

	function hasRecordedControl(control: DailySopRoleControlDraft | undefined): boolean {
		return Boolean(
			control &&
			(control.status !== null ||
				control.notes.trim() ||
				control.observations.trim() ||
				Object.values(control.measured_values).some((value) => value !== null))
		);
	}

	function isQuestionDirty(questionId: string): boolean {
		const current = effectiveDraft[questionId];
		if (!current) return false;
		const saved = activeAssessment?.controls.find((control) => control.id === questionId);
		if (!saved) return hasRecordedControl(current);
		const measuredKeys = new Set([
			...Object.keys(saved.measured_values),
			...Object.keys(current.measured_values)
		]);
		return (
			current.status !== saved.status ||
			current.notes !== saved.notes ||
			current.observations !== saved.observations ||
			[...measuredKeys].some(
				(key) => (current.measured_values[key] ?? null) !== (saved.measured_values[key] ?? null)
			)
		);
	}

	function formatAuditDateTime(value: string): string {
		return new Intl.DateTimeFormat('th-TH', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Asia/Bangkok'
		}).format(new Date(value));
	}

	function missingNoteQuestionId(): string | null {
		if (!selectedRole) return null;
		for (const question of questions) {
			const answer = effectiveDraft[question.id];
			if (
				answer &&
				(answer.status === 'Fail' || answer.status === 'Pending') &&
				!answer.notes.trim()
			)
				return question.id;
		}
		return null;
	}

	async function save(): Promise<void> {
		if (!selectedRole || !user) return;
		if (!isCurrentDate) {
			toast.error('วันที่ผ่านมาเปิดดูได้อย่างเดียว ไม่สามารถบันทึกผลได้');
			return;
		}
		const missingNoteId = missingNoteQuestionId();
		if (missingNoteId) {
			const question = questions.find((item) => item.id === missingNoteId);
			toast.error(`กรุณาระบุหมายเหตุ: ${question?.id ?? missingNoteId}`);
			document
				.getElementById(`role-question-${missingNoteId}`)
				?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			return;
		}
		if (!hasRoleDraftInput(effectiveDraft, selectedRole.code)) {
			toast.error('กรุณาบันทึกผลตรวจหรือค่าที่ตรวจได้อย่างน้อยหนึ่งข้อ');
			return;
		}
		isSaving = true;
		try {
			const saved = await saveMutation.mutateAsync({
				role: selectedRole.code,
				draft: effectiveDraft,
				date,
				ctx: {
					shelterCode,
					createdBy: user.name,
					assessorName: user.display_name?.trim() || user.name,
					roles: user.roles,
					sopRatios: sopRatios ?? undefined
				}
			});
			savedAssessment = saved;
			saveSuccessOpen = true;
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'บันทึกผลตรวจไม่สำเร็จ');
		} finally {
			isSaving = false;
		}
	}

	function roleStatusLabel(status: DailySopRoleAssessment['status'] | undefined): string {
		if (!status) return 'ยังไม่เริ่มตรวจ';
		return status === 'Completed' ? 'ตรวจครบแล้ว' : 'ตรวจยังไม่ครบ';
	}

	function roleStatusClass(status: DailySopRoleAssessment['status'] | undefined): string {
		const base = 'inline-flex whitespace-nowrap rounded-full px-2.5 py-1 text-xs font-medium';
		if (status === 'Completed') return base + ' bg-emerald-50 text-emerald-800';
		if (status === 'InProgress') return base + ' bg-amber-50 text-amber-900';
		return base + ' bg-muted text-muted-foreground';
	}

	function formatAssessmentDate(value: string): string {
		const dateAtNoon = new Date(value + 'T12:00:00+07:00');
		return new Intl.DateTimeFormat('th-TH', {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			timeZone: 'Asia/Bangkok'
		}).format(dateAtNoon);
	}

	function formatAssessmentTime(value: string): string {
		return new Intl.DateTimeFormat('th-TH', {
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Asia/Bangkok'
		}).format(new Date(value));
	}

	function ratioValuesForQuestion(questionId: string) {
		const storedParameter = activeAssessment?.controls.find((control) => control.id === questionId)
			?.metric_spec?.parameter;
		return storedParameter
			? { ...(sopRatios ?? {}), [storedParameter.key]: storedParameter.value }
			: sopRatios;
	}
</script>

<svelte:head>
	<title>
		{selectedRole
			? `ประเมิน ${selectedRole.label} | Daily SOP`
			: landingView === 'roles'
				? 'ความคืบหน้าแต่ละ Role | Daily SOP'
				: 'ความคืบหน้า Daily SOP รายวัน'}
	</title>
</svelte:head>

<main
	class="flex w-full flex-1 flex-col gap-4 px-4 pt-4 pb-[calc(9rem+env(safe-area-inset-bottom))] sm:gap-6 sm:px-6 sm:pt-6 sm:pb-28"
>
	{#if (!selectedRole && landingView === 'roles') || (selectedRole && !canOpenSelectedRole)}
		<section class="space-y-5">
			<div class="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
				<div class="min-w-0 border-l-4 border-primary pl-3">
					<div class="flex items-center gap-2">
						<button
							class="inline-flex min-h-11 items-center gap-2 rounded-lg border bg-background px-3 text-sm font-semibold hover:bg-muted"
							type="button"
							onclick={() => updateUrl(null, date, 'days')}
						>
							<ArrowLeft class="size-4" aria-hidden="true" /> ดูทุกวัน
						</button>
					</div>
					<h2 class="mt-3 text-lg font-semibold">ความคืบหน้าวันที่ {formatAssessmentDate(date)}</h2>
					<p class="mt-1 text-sm text-muted-foreground">
						{#if isHistoricalDate}
							วันย้อนหลังเปิดดู Review ได้ทุก Role โดยไม่มีสิทธิ์แก้ไข
						{:else if isCurrentDate}
							ดูสถานะได้ทุก Role · เปิดแบบประเมินเพื่อบันทึกได้ตามสิทธิ์ของแต่ละ Role
						{:else}
							ดูผลตรวจได้ถึงวันที่ปัจจุบันเท่านั้น
						{/if}
					</p>
				</div>
			</div>

			<section
				class="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4"
				aria-label="สรุปผลตรวจวันที่ {formatAssessmentDate(date)}"
			>
				<div class="min-w-0 rounded-xl border bg-card p-3 sm:p-4">
					<p class="text-xs text-muted-foreground sm:text-sm">Role ที่มีผลบันทึก</p>
					<p class="mt-1 text-lg font-semibold tabular-nums sm:text-xl">
						{dailySummary.recordedRoles}<span class="font-normal text-muted-foreground">
							/ {dailySummary.roleCount}</span
						>
					</p>
				</div>
				<div class="min-w-0 rounded-xl border bg-card p-3 sm:p-4">
					<p class="text-xs text-muted-foreground sm:text-sm">ตอบแล้วรวม</p>
					<p class="mt-1 text-lg font-semibold tabular-nums sm:text-xl">
						{dailySummary.answered}<span class="font-normal text-muted-foreground">
							/ {dailySummary.total} ข้อ</span
						>
					</p>
					<div
						class="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
						role="progressbar"
						aria-label="ความคืบหน้ารวมของทุก Role"
						aria-valuemin="0"
						aria-valuemax={dailySummary.total}
						aria-valuenow={dailySummary.answered}
					>
						<div
							class="h-full rounded-full bg-primary transition-[width]"
							style:width="{dailySummary.total
								? (dailySummary.answered / dailySummary.total) * 100
								: 0}%"
						></div>
					</div>
				</div>
				<div class="min-w-0 rounded-xl border bg-card p-3 sm:p-4">
					<p class="text-xs text-muted-foreground sm:text-sm">ไม่ผ่าน</p>
					<p class="mt-1 text-lg font-semibold text-rose-800 tabular-nums sm:text-xl">
						{dailySummary.fail}<span class="font-normal text-muted-foreground"> ข้อ</span>
					</p>
				</div>
				<div class="min-w-0 rounded-xl border bg-card p-3 sm:p-4">
					<p class="text-xs text-muted-foreground sm:text-sm">รอตรวจ</p>
					<p class="mt-1 text-lg font-semibold text-amber-900 tabular-nums sm:text-xl">
						{dailySummary.pending}<span class="font-normal text-muted-foreground"> ข้อ</span>
					</p>
				</div>
			</section>

			<section aria-labelledby="today-role-list-heading">
				<div class="mb-3 flex flex-wrap items-end justify-between gap-2">
					<div>
						<h2 id="today-role-list-heading" class="font-semibold">ผลตรวจแยกตาม Role</h2>
						<p class="mt-1 text-sm text-muted-foreground">
							{#if isHistoricalDate}
								วันย้อนหลังเปิดดู Review ได้ทุก Role โดยไม่มีสิทธิ์แก้ไข
							{:else if availableRoles.length === DAILY_SOP_ROLES.length}
								ดูสถานะและเปิดประเมินได้ทุก Role
							{:else}
								ดูสถานะได้ทุก Role · เปิดประเมินได้ตามหน้าที่ที่ได้รับมอบหมาย
							{/if}
						</p>
					</div>
				</div>

				{#if historyQuery.isLoading}
					<div class="rounded-xl border bg-card p-4 text-sm text-muted-foreground" role="status">
						กำลังโหลดรายการตรวจ...
					</div>
				{:else if historyQuery.isError}
					<div
						class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-card p-4"
						role="alert"
					>
						<p class="text-sm">โหลดรายการตรวจไม่สำเร็จ</p>
						<button
							class="min-h-11 rounded-md border bg-background px-3 text-sm font-semibold whitespace-nowrap hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
							type="button"
							onclick={() => historyQuery.refetch()}
						>
							ลองอีกครั้ง
						</button>
					</div>
				{:else}
					<div class="role-progress-table" role="table" aria-label="ผลตรวจแยกตาม Role">
						<div class="role-progress-header" role="row">
							<span role="columnheader">หน้าที่</span>
							<span role="columnheader">ความคืบหน้า</span>
							<span role="columnheader">สถานะ</span>
							<span role="columnheader">ผลล่าสุด</span>
							<span role="columnheader">การเข้าถึง</span>
						</div>
						<div class="role-progress-rows" role="rowgroup">
							{#each roleRows as row (row.role.code)}
								<div class="role-progress-row" role="row">
									<div class="role-progress-identity" role="cell">
										<p class="text-xs font-semibold tracking-wide text-muted-foreground">
											{row.role.code} · {row.questionCount} ข้อ
										</p>
										<h3 class="mt-1 font-semibold break-words">{row.role.label}</h3>
									</div>
									<div class="role-progress-meter" role="cell">
										<div class="role-progress-label">
											<span>ความคืบหน้า</span>
											<strong class="tabular-nums">
												{row.answeredCount}/{row.questionCount} ข้อ · {row.percent}%
											</strong>
										</div>
										<div
											class="role-progress-track"
											role="progressbar"
											aria-label="ความคืบหน้า {row.role.label}"
											aria-valuemin="0"
											aria-valuemax="100"
											aria-valuenow={row.percent}
										>
											<div class="role-progress-fill" style:width="{row.percent}%"></div>
										</div>
									</div>
									<div class="role-progress-status" role="cell">
										<span class={roleStatusClass(row.assessment?.status)}>
											{roleStatusLabel(row.assessment?.status)}
										</span>
									</div>
									<div class="role-progress-summary" role="cell">
										{#if row.assessment}
											ผ่าน {row.assessment.pass_count} · ไม่ผ่าน {row.assessment.fail_count} · รอตรวจ
											{row.assessment.pending_count} · บันทึกล่าสุด
											{formatAssessmentTime(row.assessment.updated_at)}
										{:else}
											ยังไม่มีผลตรวจที่บันทึกไว้
										{/if}
									</div>
									<div class="role-progress-action" role="cell">
										{#if isHistoricalDate}
											{#if row.assessment}
												<button
													class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/5 px-3 text-sm font-semibold whitespace-nowrap text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
													type="button"
													aria-label="ดูผลย้อนหลัง: {row.role.label}"
													onclick={() => updateUrl(row.role.code)}
												>
													ดูผลย้อนหลัง
												</button>
											{:else}
												<span class="text-xs font-medium text-muted-foreground">ยังไม่มีผลตรวจ</span
												>
											{/if}
										{:else if isCurrentDate && (row.canAssess || row.assessment)}
											<button
												class="inline-flex min-h-11 shrink-0 items-center justify-center rounded-md border border-primary/25 bg-primary/5 px-3 text-sm font-semibold whitespace-nowrap text-primary hover:bg-primary/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
												type="button"
												aria-label="{row.assessment
													? row.canAssess
														? row.assessment.status === 'Completed'
															? 'เปิดผลตรวจ'
															: 'ตรวจต่อ'
														: 'ดูผลตรวจ'
													: 'เริ่มตรวจ'}: {row.role.label}"
												onclick={() => updateUrl(row.role.code)}
											>
												{row.assessment
													? row.canAssess
														? row.assessment.status === 'Completed'
															? 'เปิดผลตรวจ'
															: 'ตรวจต่อ'
														: 'ดูผลตรวจ'
													: 'เริ่มตรวจ'}
											</button>
										{:else}
											<span class="text-xs font-medium text-muted-foreground">ดูสถานะได้</span>
										{/if}
									</div>
								</div>
							{/each}
						</div>
					</div>
				{/if}
			</section>
		</section>
	{:else if !selectedRole}
		<section class="space-y-4" data-testid="daily-sop-days-view">
			<header class="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-end sm:justify-between">
				<div class="min-w-0">
					<h1 class="text-xl font-semibold tracking-tight sm:text-2xl">ประเมินมาตรฐานประจำวัน</h1>
					<p class="mt-1 text-sm text-muted-foreground">
						เลือกวันที่จากรายการด้านล่าง เพื่อดูความคืบหน้าแยกตามหน้าที่
					</p>
				</div>
			</header>

			{#if historyQuery.isLoading}
				<div class="rounded-xl border bg-card p-4 text-sm text-muted-foreground" role="status">
					กำลังโหลดความคืบหน้ารายวัน...
				</div>
			{:else if historyQuery.isError}
				<div
					class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-card p-4"
					role="alert"
				>
					<p class="text-sm">โหลดความคืบหน้าไม่สำเร็จ</p>
					<button
						class="min-h-11 rounded-md border bg-background px-3 text-sm font-semibold whitespace-nowrap hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
						type="button"
						onclick={() => historyQuery.refetch()}
					>
						ลองอีกครั้ง
					</button>
				</div>
			{:else}
				<div class="overflow-hidden rounded-xl border bg-card" data-testid="daily-sop-day-list">
					{#each dayRows as day (day.date)}
						{@const isToday = day.date === today}
						{@const percent = day.total ? Math.floor((day.answered / day.total) * 100) : 0}
						<article
							class="grid min-w-0 gap-3 border-b p-3.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-5 sm:px-5 sm:py-4"
						>
							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
									<h2 class="font-semibold tabular-nums">{formatAssessmentDate(day.date)}</h2>
									{#if isToday}<span
											class="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
											>วันนี้</span
										>{/if}
									<span
										class={roleStatusClass(
											day.recordedRoles === 0
												? undefined
												: day.completedRoles === day.roleCount
													? 'Completed'
													: 'InProgress'
										)}
									>
										{day.recordedRoles === 0
											? 'ยังไม่เริ่มตรวจ'
											: day.completedRoles === day.roleCount
												? 'ตรวจครบทุก Role'
												: 'กำลังตรวจ'}
									</span>
								</div>
								<div
									class="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"
								>
									<p>
										ตรวจครบ <span class="font-semibold tabular-nums"
											>{day.completedRoles}/{day.roleCount} Role</span
										>
										<span class="text-muted-foreground">· ตอบแล้ว</span>
										<span class="font-semibold tabular-nums">{day.answered}/{day.total} ข้อ</span>
									</p>
									<span class="font-medium text-muted-foreground tabular-nums">{percent}%</span>
								</div>
								<div
									class="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
									role="progressbar"
									aria-label="ความคืบหน้าของวันที่ {formatAssessmentDate(day.date)}"
									aria-valuemin="0"
									aria-valuemax="100"
									aria-valuenow={percent}
								>
									<div class="h-full rounded-full bg-primary" style:width="{percent}%"></div>
								</div>
								<p
									class="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground"
								>
									ไม่ผ่าน {day.fail} · รอตรวจ {day.pending} · ยังไม่เริ่ม {day.roleCount -
										day.recordedRoles} Role
									{#if day.lastUpdatedAt}
										<span>บันทึกล่าสุด {formatAssessmentTime(day.lastUpdatedAt)}</span>{/if}
								</p>
							</div>
							<button
								class="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary/25 px-4 text-sm font-semibold whitespace-nowrap text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:w-auto"
								type="button"
								aria-label="{isToday
									? day.recordedRoles === 0
										? 'เริ่มตรวจ'
										: 'ดูความคืบหน้า'
									: 'ดูผลย้อนหลัง'} วันที่ {formatAssessmentDate(day.date)}"
								onclick={() => updateUrl(null, day.date, 'roles')}
							>
								{isToday
									? day.recordedRoles === 0
										? 'เริ่มตรวจ'
										: 'ดูความคืบหน้า'
									: 'ดูผลย้อนหลัง'}
								<ClipboardCheck class="size-4" aria-hidden="true" />
							</button>
						</article>
					{/each}
				</div>
			{/if}
		</section>
	{:else}
		<section class="space-y-4">
			<div class="flex flex-col gap-3 border-b pb-4 sm:flex-row sm:items-center sm:justify-between">
				<button
					class="inline-flex min-h-11 w-fit items-center gap-2 rounded-lg border bg-card px-3 text-sm font-medium hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
					type="button"
					onclick={() => updateUrl(null, date, 'roles')}
				>
					<ArrowLeft class="size-4" aria-hidden="true" /> กลับภาพรวม
				</button>
				<p class="text-sm font-medium text-muted-foreground">
					วันที่ประเมิน · {formatAssessmentDate(date)}
				</p>
			</div>

			<div class="rounded-xl border bg-card p-4 sm:p-5">
				<div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
					<div class="min-w-0">
						<p class="text-sm font-medium text-muted-foreground">
							{selectedRole.code} <span aria-hidden="true">·</span>
							{questions.length} คำถาม
						</p>
						<h1 class="mt-1 text-xl font-semibold tracking-tight sm:text-2xl">
							{selectedRole.label}
						</h1>
						{#if isHistoricalDate || !canEditSelectedRole}
							<p class="mt-1 text-sm text-muted-foreground">
								{isHistoricalDate
									? 'วันย้อนหลังเปิดดูได้อย่างเดียว · แก้ไขหรือบันทึกทับไม่ได้'
									: 'เปิดดูผลของ Role นี้ได้ · การแก้ไขจำกัดตามหน้าที่ที่ได้รับมอบหมาย'}
							</p>
						{/if}
					</div>
					<div class="grid gap-1 text-sm sm:justify-items-end">
						{#if activeAssessment}
							<span class={roleStatusClass(activeAssessment.status)}>
								{roleStatusLabel(activeAssessment.status)}
							</span>
							<p class="text-muted-foreground sm:text-right">
								บันทึกล่าสุดโดย {activeAssessment.assessor_name ||
									user?.display_name?.trim() ||
									user?.name}
								·
								<time datetime={activeAssessment.updated_at}>
									{formatAuditDateTime(activeAssessment.updated_at)}
								</time>
							</p>
						{:else}
							<p class="text-muted-foreground">
								ผู้ตรวจ: {user?.display_name?.trim() || user?.name}
							</p>
						{/if}
					</div>
				</div>
				{#if progress && counts}
					<div class="mt-4 space-y-3 border-t pt-3">
						<div>
							<div class="flex items-center justify-between gap-3 text-sm">
								<span class="font-semibold">ความคืบหน้า</span>
								<span class="shrink-0 font-medium text-muted-foreground tabular-nums">
									{progress.total - progress.unanswered}/{progress.total} ข้อ · {progress.percent}%
								</span>
							</div>
							<div
								class="mt-2 h-2 overflow-hidden rounded-full bg-muted"
								role="progressbar"
								aria-label="ความคืบหน้าของ {selectedRole.label}"
								aria-valuemin="0"
								aria-valuemax="100"
								aria-valuenow={progress.percent}
								aria-valuetext="{progress.total -
									progress.unanswered} จาก {progress.total} ข้อ, {progress.percent}%"
							>
								<div class="h-full rounded-full bg-primary" style:width="{progress.percent}%"></div>
							</div>
						</div>
						<div class="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
							<div class="flex items-baseline justify-between gap-2">
								<span class="text-muted-foreground">ผ่าน</span>
								<strong class="text-emerald-800 tabular-nums">{counts.pass}</strong>
							</div>
							<div class="flex items-baseline justify-between gap-2">
								<span class="text-muted-foreground">ไม่ผ่าน</span>
								<strong class="text-rose-800 tabular-nums">{counts.fail}</strong>
							</div>
							<div class="flex items-baseline justify-between gap-2">
								<span class="text-muted-foreground">รอตรวจ</span>
								<strong class="text-amber-800 tabular-nums">{counts.pending}</strong>
							</div>
							<div class="flex items-baseline justify-between gap-2">
								<span class="text-muted-foreground">ยังไม่ตอบ</span>
								<strong class="tabular-nums">{counts.unanswered}</strong>
							</div>
						</div>
					</div>
				{/if}
			</div>

			{#if isLoadingAssessment}
				<div class="rounded-xl border p-6 text-sm text-muted-foreground">
					กำลังโหลดแบบตรวจของ Role นี้...
				</div>
			{:else}
				<section
					class="overflow-hidden rounded-xl border bg-card"
					aria-label="คำถามสำหรับ {selectedRole.label}"
				>
					<div
						class="hidden grid-cols-[minmax(0,1fr)_repeat(3,minmax(5rem,6rem))] items-center gap-x-4 border-b bg-muted/40 px-4 py-3 text-sm font-semibold text-muted-foreground sm:grid"
						aria-hidden="true"
					>
						<span>คำถาม</span>
						<span class="text-center">ผ่าน</span>
						<span class="text-center">ไม่ผ่าน</span>
						<span class="text-center">รอตรวจ</span>
					</div>
					<div>
						{#each questions as question, index (question.id)}
							{@const answer = effectiveDraft[question.id]}
							{@const savedControl = activeAssessment?.controls.find(
								(control) => control.id === question.id
							)}
							{@const hasSavedControl = hasRecordedControl(savedControl)}
							{@const isDirty = isQuestionDirty(question.id)}
							{@const metric = metricForQuestion(question.id, ratioValuesForQuestion(question.id))}
							{@const parameterRequired = metricParameterForQuestion(question.id) !== null}
							{@const parameterUnavailable = parameterRequired && !metric}
							{@const calculated = metric?.evaluate(answer?.measured_values ?? {}) ?? null}
							{@const calculationUnavailable =
								question.id === 'D-SM-02' && calculated === null && !answer?.status}
							<section
								id={`role-question-${question.id}`}
								class="grid scroll-mt-6 grid-cols-1 gap-y-3 border-b p-3 last:border-b-0 sm:p-4 md:grid-cols-[minmax(0,1fr)_repeat(3,minmax(5rem,6rem))] md:items-start md:gap-x-4"
							>
								<div class="col-start-1 row-start-1 flex min-w-0 items-start gap-2 sm:gap-3">
									<span
										class="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold sm:size-8 sm:text-sm"
										>{index + 1}</span
									>
									<div class="min-w-0 flex-1">
										<p class="text-xs font-semibold tracking-wide text-muted-foreground sm:text-sm">
											{question.id}
										</p>
										<h3 class="mt-1 text-sm leading-relaxed font-medium sm:text-base">
											{question.prompt}
										</h3>
										{#if parameterUnavailable}
											<p
												class="mt-2 text-xs leading-relaxed text-amber-800 sm:text-sm"
												role="status"
											>
												{sopRatioQuery.isLoading
													? 'กำลังโหลดค่ากำหนดของศูนย์'
													: 'ไม่พบค่ากำหนดของศูนย์สำหรับข้อนี้ ให้เลือกรอตรวจ'}
											</p>
										{/if}
										{#if (hasSavedControl && savedControl) || isDirty}
											<div
												class="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-relaxed text-muted-foreground sm:text-sm"
											>
												{#if hasSavedControl && savedControl}
													<span
														>บันทึกล่าสุดโดย {savedControl.checked_by_name ||
															savedControl.checked_by}</span
													>
													<span aria-hidden="true">·</span>
													<time datetime={savedControl.checked_at}>
														{formatAuditDateTime(savedControl.checked_at)}
													</time>
												{/if}
												{#if isDirty}
													<span class="font-semibold text-amber-800">ยังไม่บันทึก</span>
												{/if}
											</div>
										{/if}
									</div>
								</div>

								<fieldset
									class="min-w-0 md:col-span-3 md:col-start-2 md:row-start-1"
									disabled={!canEditSelectedRole}
								>
									<legend class="sr-only">ผลตรวจ: {question.prompt}</legend>
									<div class="grid grid-cols-3 gap-1.5 sm:gap-2">
										{#each statusOptions as option (option.value)}
											{@const isSelected = answer?.status === option.value}
											{@const optionDisabled =
												!canEditSelectedRole ||
												((parameterUnavailable || calculationUnavailable) &&
													option.value !== 'Pending')}
											<label
												class={`flex min-h-11 min-w-0 items-center justify-center gap-1.5 rounded-md border px-1.5 text-xs font-semibold transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring sm:mx-auto sm:size-11 sm:gap-0 sm:rounded-full sm:px-0 sm:text-sm ${
													optionDisabled
														? 'cursor-not-allowed opacity-50'
														: 'cursor-pointer active:translate-y-px'
												} ${
													isSelected
														? option.value === 'Pass'
															? 'border-emerald-700 bg-emerald-50 text-emerald-900'
															: option.value === 'Fail'
																? 'border-rose-700 bg-rose-50 text-rose-900'
																: 'border-amber-700 bg-amber-50 text-amber-950'
														: 'border-border bg-background text-muted-foreground hover:bg-muted/50'
												}`}
											>
												<input
													class="peer sr-only"
													type="radio"
													name={`daily-sop-${question.id}`}
													value={option.value}
													checked={isSelected}
													disabled={optionDisabled}
													aria-label={option.label}
													onchange={() => setStatus(question.id, option.value)}
												/>
												<span
													aria-hidden="true"
													class={`inline-flex size-4 shrink-0 items-center justify-center rounded-full border-2 ${
														option.value === 'Pass'
															? 'border-emerald-700 text-emerald-800'
															: option.value === 'Fail'
																? 'border-rose-700 text-rose-800'
																: 'border-amber-700 text-amber-900'
													}`}
												>
													{#if isSelected}<span class="size-1.5 rounded-full bg-current"
														></span>{/if}
												</span>
												<span class="whitespace-nowrap sm:sr-only">{option.label}</span>
											</label>
										{/each}
									</div>
								</fieldset>

								<details
									class="col-span-full row-start-3 mt-1 rounded-lg border bg-muted/20 px-3 py-1.5 md:row-start-2 md:mt-0 md:px-4"
									open={answer?.status === 'Fail' ||
										answer?.status === 'Pending' ||
										(question.id === 'D-SM-02' && calculated !== null)}
								>
									<summary class="min-h-11 cursor-pointer py-3 text-xs font-medium sm:text-sm">
										{#if answer?.status === 'Fail' || answer?.status === 'Pending'}
											รายละเอียดและหมายเหตุ
											<span class="font-normal text-destructive">— ต้องระบุหมายเหตุ</span>
										{:else}
											รายละเอียดและบันทึกเพิ่มเติม
											<span class="font-normal text-muted-foreground">(ไม่บังคับ)</span>
										{/if}
									</summary>
									<div class="mt-3 grid gap-3 md:grid-cols-2">
										{#if metric && answer}
											<div class="rounded-lg border border-sky-200 bg-sky-50/60 p-3 md:col-span-2">
												<p class="text-sm font-semibold">
													{question.id === 'D-SM-02' ? 'ข้อมูลที่ใช้คำนวณ' : 'ค่าที่ตรวจได้'}
													{#if question.id !== 'D-SM-02'}<span
															class="font-normal text-muted-foreground">(ไม่บังคับ)</span
														>{/if}
												</p>
												{#if question.id === 'D-SM-02'}
													<div class="mt-3 grid gap-3 sm:grid-cols-2">
														{#each metric.fields as field (field.key)}
															<div class="rounded-md border bg-background px-3 py-2.5">
																<p class="text-sm text-muted-foreground">{field.label}</p>
																<p class="mt-1 font-semibold tabular-nums">
																	{answer.measured_values[field.key] ?? '—'}
																	{field.unit}
																</p>
															</div>
														{/each}
													</div>
													<p class="mt-2 text-xs text-muted-foreground">
														เทียบจำนวนผู้พักพิงที่เข้าพักอยู่กับความจุที่กำหนดของศูนย์
													</p>
													{#if calculated === null}
														<p class="mt-2 text-sm text-amber-800" role="status">
															{#if isHistoricalDate}
																ข้อมูลที่บันทึกไว้ไม่ครบ จึงคำนวณย้อนหลังไม่ได้
															{:else if isLoadingCapacityValues}
																กำลังโหลดจำนวนผู้พักพิงและความจุของศูนย์...
															{:else}
																ยังคำนวณไม่ได้
																เนื่องจากยังไม่มีข้อมูลจำนวนผู้พักพิงหรือความจุของศูนย์
															{/if}
														</p>
													{/if}
												{:else}
													<div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
														{#each metric.fields as field (field.key)}
															<label class="grid gap-1.5 text-sm">
																<span
																	>{field.label}
																	<span class="text-muted-foreground">({field.unit})</span></span
																>
																<Input
																	id={`daily-sop-${question.id}-${field.key}`}
																	type="number"
																	min="0"
																	step={field.step ?? 'any'}
																	value={answer.measured_values[field.key] ?? ''}
																	disabled={!canEditSelectedRole}
																	oninput={(event) =>
																		setMeasuredValue(
																			question.id,
																			field.key,
																			event.currentTarget.value
																		)}
																/>
															</label>
														{/each}
													</div>
												{/if}
												{#if calculated !== null}
													<p class="mt-2 text-sm font-medium">
														ผลคำนวณ{question.id === 'D-SM-02' ? 'จากข้อมูลศูนย์' : 'จากค่าที่กรอก'}: {calculated
															? 'ผ่านเกณฑ์'
															: 'ไม่ผ่านเกณฑ์'}
													</p>
													{#if answer.status && answer.status !== 'Pending' && (answer.status === 'Pass') !== calculated}
														<p class="mt-1 flex items-center gap-1 text-sm text-amber-800">
															<TriangleAlert class="size-4" aria-hidden="true" /> ผลที่เลือกไม่ตรงกับผลคำนวณ
															กรุณาตรวจค่าหรือหมายเหตุ
														</p>
													{/if}
												{/if}
											</div>
										{/if}
										<label class="grid gap-1.5 text-sm">
											<span
												>รายละเอียดที่ตรวจพบ <span class="font-normal text-muted-foreground"
													>(ถ้ามี)</span
												></span
											>
											<Textarea
												id={`daily-sop-${question.id}-observations`}
												rows={3}
												value={answer?.observations ?? ''}
												disabled={!canEditSelectedRole}
												oninput={(event) =>
													setText(question.id, 'observations', event.currentTarget.value)}
												placeholder="เช่น จำนวนที่ตรวจพบ เวลา หรือจุดที่ตรวจ"
											/>
										</label>
										<label class="grid gap-1.5 text-sm">
											<span>
												หมายเหตุ
												{#if answer?.status === 'Fail' || answer?.status === 'Pending'}
													<span class="text-destructive">(จำเป็น)</span>
												{:else}
													<span class="font-normal text-muted-foreground">(ถ้ามี)</span>
												{/if}
											</span>
											<Textarea
												id={`daily-sop-${question.id}-notes`}
												rows={3}
												disabled={!canEditSelectedRole}
												class={(answer?.status === 'Fail' || answer?.status === 'Pending') &&
												!answer?.notes.trim()
													? 'border-destructive'
													: ''}
												value={answer?.notes ?? ''}
												oninput={(event) =>
													setText(question.id, 'notes', event.currentTarget.value)}
												placeholder={answer?.status === 'Pending'
													? 'ระบุว่ารออะไร เพราะอะไร และใคร/เมื่อไรต้องติดตาม'
													: answer?.status === 'Fail'
														? 'ระบุสิ่งที่พบ จุดที่ไม่ผ่าน และการแก้ไขหรือผู้รับผิดชอบ'
														: 'บันทึกเพิ่มเติม (ถ้ามี)'}
											/>
										</label>
									</div>
								</details>
							</section>
						{/each}
					</div>
				</section>

				{#if canEditSelectedRole}
					<div
						class="fixed inset-x-0 bottom-[var(--testing-banner-height)] z-20 border-t bg-background/95 px-3 py-2 backdrop-blur sm:px-4 sm:py-3"
					>
						<div
							class="mx-auto grid max-w-6xl grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3"
						>
							{#if progress}
								<div class="min-w-0">
									<div class="flex items-center justify-between gap-2 text-xs">
										<span class="font-medium text-muted-foreground">ความคืบหน้า</span>
										<span class="shrink-0 font-semibold tabular-nums">
											{progress.total - progress.unanswered}/{progress.total} · {progress.percent}%
										</span>
									</div>
									<div
										class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
										role="progressbar"
										aria-label="ความคืบหน้าของ {selectedRole.label}"
										aria-valuemin="0"
										aria-valuemax="100"
										aria-valuenow={progress.percent}
										aria-valuetext="{progress.total -
											progress.unanswered} จาก {progress.total} ข้อ, {progress.percent}%"
									>
										<div
											class="h-full rounded-full bg-primary"
											style:width="{progress.percent}%"
										></div>
									</div>
								</div>
							{/if}
							<button
								class="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-primary px-3 py-2 text-sm font-semibold whitespace-nowrap text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:translate-y-px disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto sm:px-4"
								type="button"
								disabled={!canSave || isSaving}
								onclick={save}
							>
								<Save class="size-4" aria-hidden="true" />
								{isSaving ? 'กำลังบันทึก...' : isComplete ? 'บันทึกผลตรวจ' : 'บันทึกความคืบหน้า'}
							</button>
						</div>
					</div>
				{/if}
			{/if}
		</section>
	{/if}
</main>

<Dialog.Root bind:open={saveSuccessOpen}>
	<Dialog.Content
		class="inset-x-0 top-auto bottom-0 left-0 w-full max-w-none translate-x-0 translate-y-0 gap-5 rounded-t-3xl rounded-b-none p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:top-1/2 sm:bottom-auto sm:left-1/2 sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl sm:p-6"
		data-testid="role-save-success-dialog"
	>
		<Dialog.Header class="text-left">
			<div
				class="mb-1 flex size-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-800"
			>
				<CheckCircle2 class="size-5" aria-hidden="true" />
			</div>
			<Dialog.Title>
				{savedAssessment?.status === 'Completed' ? 'บันทึกผลตรวจแล้ว' : 'บันทึกความคืบหน้าแล้ว'}
			</Dialog.Title>
			<Dialog.Description>
				{selectedRole?.label} · {formatAssessmentDate(savedAssessment?.assessment_date ?? date)}
			</Dialog.Description>
			<p class="text-sm text-muted-foreground">
				บันทึกโดย {savedAssessment?.assessor_name ?? user?.display_name?.trim() ?? user?.name} · เวลา
				{formatAssessmentTime(savedAssessment?.updated_at ?? new Date().toISOString())}
			</p>
		</Dialog.Header>
		<Dialog.Footer class="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
			<button
				type="button"
				class="min-h-11 w-full rounded-xl border px-4 text-sm font-semibold whitespace-nowrap hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:w-auto"
				onclick={() => (saveSuccessOpen = false)}>ทำต่อหน้านี้</button
			>
			<button
				type="button"
				class="min-h-11 w-full rounded-xl bg-primary px-4 text-sm font-semibold whitespace-nowrap text-primary-foreground hover:bg-primary/90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:w-auto"
				onclick={() => {
					saveSuccessOpen = false;
					updateUrl(null, date, 'roles');
				}}>กลับภาพรวม</button
			>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<style>
	.role-progress-table {
		min-width: 0;
	}

	.role-progress-header {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}

	.role-progress-rows {
		display: grid;
		gap: 0.5rem;
	}

	.role-progress-row {
		display: grid;
		grid-template-areas:
			'identity status'
			'meter meter'
			'summary action';
		grid-template-columns: minmax(0, 1fr) auto;
		align-items: center;
		gap: 0.75rem;
		min-width: 0;
		border: 1px solid var(--border);
		border-radius: 0.75rem;
		background: var(--card);
		padding: 0.75rem;
	}

	.role-progress-identity {
		grid-area: identity;
		min-width: 0;
	}

	.role-progress-meter {
		grid-area: meter;
		min-width: 0;
	}

	.role-progress-label {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.5rem;
		font-size: 0.75rem;
	}

	.role-progress-label span {
		color: var(--muted-foreground);
	}

	.role-progress-label strong {
		flex-shrink: 0;
		font-weight: 600;
	}

	.role-progress-track {
		height: 0.375rem;
		margin-top: 0.4rem;
		overflow: hidden;
		border-radius: 9999px;
		background: var(--muted);
	}

	.role-progress-fill {
		height: 100%;
		border-radius: inherit;
		background: var(--primary);
	}

	.role-progress-status {
		grid-area: status;
		justify-self: end;
	}

	.role-progress-summary {
		grid-area: summary;
		min-width: 0;
		font-size: 0.7rem;
		line-height: 1.5;
		color: var(--muted-foreground);
	}

	.role-progress-action {
		grid-area: action;
		justify-self: end;
	}

	@media (min-width: 80rem) {
		.role-progress-table {
			overflow: hidden;
			border: 1px solid var(--border);
			border-radius: 0.75rem;
			background: var(--card);
		}

		.role-progress-header,
		.role-progress-row {
			display: grid;
			grid-template-columns:
				minmax(0, 1.3fr) minmax(0, 1.2fr) minmax(7rem, 0.7fr) minmax(0, 1.5fr)
				auto;
			align-items: center;
			gap: 0.85rem;
		}

		.role-progress-header {
			position: static;
			width: auto;
			height: auto;
			margin: 0;
			padding: 0.75rem 1rem;
			overflow: visible;
			clip: auto;
			white-space: normal;
			border: 0;
			background: color-mix(in srgb, var(--muted) 60%, transparent);
			color: var(--muted-foreground);
			font-size: 0.75rem;
			font-weight: 600;
		}

		.role-progress-header > :last-child {
			text-align: right;
		}

		.role-progress-rows {
			display: block;
		}

		.role-progress-row {
			grid-template-areas: none;
			grid-template-columns:
				minmax(0, 1.3fr) minmax(0, 1.2fr) minmax(7rem, 0.7fr) minmax(0, 1.5fr)
				auto;
			gap: 0.85rem;
			border: 0;
			border-top: 1px solid var(--border);
			border-radius: 0;
			background: transparent;
			padding: 0.9rem 1rem;
		}

		.role-progress-identity,
		.role-progress-meter,
		.role-progress-status,
		.role-progress-summary,
		.role-progress-action {
			grid-area: auto;
		}

		.role-progress-action {
			justify-self: end;
		}

		.role-progress-label span {
			display: none;
		}

		.role-progress-summary {
			font-size: 0.68rem;
		}
	}
</style>
