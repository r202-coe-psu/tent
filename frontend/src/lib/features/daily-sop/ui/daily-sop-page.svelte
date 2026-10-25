<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { page } from '$app/state';
	import { onMount, tick } from 'svelte';
	import { SvelteURLSearchParams } from 'svelte/reactivity';
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import CheckCircle2 from '@lucide/svelte/icons/circle-check';
	import CircleDashed from '@lucide/svelte/icons/circle-dashed';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import Clock from '@lucide/svelte/icons/clock';
	import Eye from '@lucide/svelte/icons/eye';
	import Package from '@lucide/svelte/icons/package';
	import Save from '@lucide/svelte/icons/save';
	import { toast } from 'svelte-sonner';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button/index.js';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { roleDisplayLabel } from '$lib/auth/roles';
	import { authStore } from '$lib/stores/auth.svelte';
	import { getShelterCode } from '$lib/db/shelter';
	import { ConflictError } from '$lib/utils/errors';
	import { useDashboardOccupancy } from '$lib/features/dashboard';
	import { useShelter } from '$lib/features/shelters';
	import { useActiveSopRatio } from '$lib/features/sop-ratios';
	import { buildDailySopRoleId } from '../data/daily-sop.remote';
	import DailySopStockPanel from './daily-sop-stock-panel.svelte';
	import {
		DAILY_SOP_CAPACITY_QUESTION_ID,
		DAILY_SOP_OCCUPANCY_QUESTION_IDS,
		DAILY_SOP_STOCK_QUESTION_ID,
		applySystemMetricSuggestionsForEditedControls,
		assessableRoles,
		canCompleteRoleDraft,
		createEmptyRoleDraft,
		dailySopBangkokDate,
		historyNeedsMorePages,
		hasRoleDraftInput,
		metricParameterForQuestion,
		notesRequired,
		metricForQuestion,
		questionText,
		requiredForMetric,
		questionsForRole,
		roleAssessmentProgress,
		daySummaryStatus,
		personDisplayName,
		roleDraftFromAssessment,
		roleForCode,
		roleRowAccess,
		roleUsesOccupancy,
		roleUsesShelterCapacity,
		roleUsesStockCheck,
		summarizeRoleDraft,
		visibleHistoryDates,
		type DailySopRoleAssessment,
		type DailySopRoleControlDraft,
		type DailySopRoleCode,
		type DailySopRoleDraft,
		type DailySopRoleStatus
	} from '../domain/daily-sop';
	import {
		useDailySopRoleAssessment,
		useDailySopRoleAssessments,
		useDailySopStockStatus,
		useResetDailySopRoleList,
		useSaveDailySopRoleAssessment
	} from '../application/queries';

	const shelterCode = $derived(getShelterCode());
	const sopRatioQuery = useActiveSopRatio(() => shelterCode);
	const sopRatios = $derived(sopRatioQuery.data?.ratios ?? null);
	const user = $derived(authStore.user);
	const userRoles = $derived(user?.roles ?? []);
	const availableRoles = $derived(assessableRoles(userRoles, shelterCode));
	let today = $state(dailySopBangkokDate());
	const date = $derived(page.url.searchParams.get('date') ?? today);
	const isCurrentDate = $derived(date === today);
	const isHistoricalDate = $derived(date < today);
	const viewHint = $derived(
		isHistoricalDate
			? 'วันย้อนหลังดูได้อย่างเดียว'
			: isCurrentDate
				? 'แสดงเฉพาะตำแหน่งที่บัญชีนี้ประเมินได้'
				: 'ดูผลประเมินได้ถึงวันที่ปัจจุบันเท่านั้น'
	);
	const landingView = $derived(page.url.searchParams.get('view') === 'roles' ? 'roles' : 'days');
	const roleParam = $derived(page.url.searchParams.get('role'));
	const selectedRole = $derived(roleParam ? roleForCode(roleParam) : null);
	const historyQuery = useDailySopRoleAssessments(
		() => shelterCode,
		() => today
	);

	const resetHistory = useResetDailySopRoleList();

	let draft = $state<DailySopRoleDraft>({});
	let hydratedId = $state('');
	let isSaving = $state(false);
	let saveSuccessOpen = $state(false);
	let savedAssessment = $state<DailySopRoleAssessment | null>(null);
	/** Context the success dialog belongs to; it never shows for another user/role/date. */
	let savedContextKey = $state('');
	let baseAssessment = $state<DailySopRoleAssessment | null>(null);
	let baseDraft = $state<DailySopRoleDraft | null>(null);
	let revisionConflict = $state(false);
	let latestConflictAssessment = $state<DailySopRoleAssessment | null | undefined>(undefined);
	let mergeChoices = $state<Record<string, 'local' | 'server'>>({});
	let stockPanelOpen = $state(false);
	let stockTrigger: HTMLButtonElement | null = $state(null);
	let detailsOpen = $state<Record<string, boolean>>({});
	let metricFieldsTouched = $state<Record<string, string[]>>({});

	const history = $derived(historyQuery.data?.pages.flatMap((page) => page.items) ?? []);
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
	const canEditSelectedRole = $derived(Boolean(isCurrentDate && canAssessSelectedRole));
	const canOpenSelectedRole = $derived(
		Boolean(selectedRole && canAssessSelectedRole && (isHistoricalDate || isCurrentDate))
	);
	const occupancyQuery = useDashboardOccupancy(
		() => shelterCode,
		() => canEditSelectedRole && Boolean(selectedRole && roleUsesOccupancy(selectedRole.code))
	);
	const shelterQuery = useShelter(
		() => shelterCode,
		() => canEditSelectedRole && Boolean(selectedRole && roleUsesShelterCapacity(selectedRole.code))
	);
	const selectedId = $derived(
		selectedRole && canOpenSelectedRole
			? buildDailySopRoleId(shelterCode, date, selectedRole.code)
			: null
	);
	const selectedQuery = useDailySopRoleAssessment(() => selectedId);
	/** Session + role context; a change discards the open form state (CR-153 access loss). */
	const formContextKey = $derived(
		`${user?.name ?? ''}|${[...userRoles].sort().join(',')}|${selectedId ?? ''}`
	);
	const saveMutation = useSaveDailySopRoleAssessment();
	const roleRows = $derived.by(() => rowsForDate(date));
	const dailySummary = $derived.by(() => summarizeRows(roleRows));
	const dayRows = $derived.by(() => {
		return visibleHistoryDates(historyRows, availableRoles, today).map((assessmentDate) => {
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
	const historyNeedsMore = $derived(
		historyNeedsMorePages(historyRows, availableRoles, Boolean(historyQuery.hasNextPage))
	);
	const activeAssessment = $derived(selectedQuery.data ?? null);
	const stockShelterCode = $derived(activeAssessment?.shelter_code ?? shelterCode);
	const stockQuery = useDailySopStockStatus(
		() => stockShelterCode,
		() =>
			Boolean(selectedRole && canAssessSelectedRole && roleUsesStockCheck(selectedRole.code)) &&
			stockPanelOpen
	);
	const isLoadingAssessment = $derived(Boolean(selectedId && selectedQuery.isLoading));
	const effectiveDraft = $derived(draft);
	const questions = $derived.by(() => {
		if (!selectedRole) return [];
		if (activeAssessment)
			return activeAssessment.controls.map(({ id, question }) => ({ id, text: question }));
		return questionsForRole(selectedRole.code).map((question) => ({
			id: question.id,
			text: questionText(question, sopRatios)
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
			!revisionConflict &&
			hasRoleDraftInput(effectiveDraft, selectedRole.code) &&
			questions.every((question) => {
				const answer = effectiveDraft[question.id];
				const parameterMissing =
					metricParameterForQuestion(question.id) !== null &&
					!metricForQuestion(question.id, ratioValuesForQuestion(question.id))?.parameter;
				const parameterUnavailable =
					parameterMissing &&
					(Boolean(activeAssessment) || sopRatioQuery.isSuccess || sopRatioQuery.isError);
				const parameterUnresolved =
					parameterMissing &&
					!activeAssessment &&
					!sopRatioQuery.isSuccess &&
					!sopRatioQuery.isError;
				return !parameterUnresolved && (!parameterUnavailable || answer?.status === 'Pending');
			})
		)
	);
	const statusOptions = [
		{ value: 'Pass', label: 'ผ่าน' },
		{ value: 'Fail', label: 'ไม่ผ่าน' }
	] as const;
	const pendingStatusOption = { value: 'Pending', label: 'รอข้อมูล' } as const;
	function statusOptionsForQuestion(
		parameterUnavailable: boolean,
		currentStatus: DailySopRoleStatus | null | undefined
	) {
		return parameterUnavailable || currentStatus === 'Pending'
			? [...statusOptions, pendingStatusOption]
			: statusOptions;
	}
	const conflictingQuestions = $derived.by(() => {
		if (!selectedRole || !latestConflictAssessment) return [];
		const latestDraft = roleDraftFromAssessment(latestConflictAssessment);
		const initialDraft = baseDraft ?? createEmptyRoleDraft(selectedRole.code);
		return questionsForRole(selectedRole.code).flatMap((question) => {
			const initial = initialDraft[question.id];
			const local = draft[question.id];
			const server = latestDraft[question.id];
			const localChanged = !sameControlAnswer(initial, local);
			const serverChanged = !sameControlAnswer(initial, server);
			return localChanged && serverChanged && !sameControlAnswer(local, server)
				? [
						{
							id: question.id,
							text: question.text,
							choice: mergeChoices[question.id]
						}
					]
				: [];
		});
	});
	const canApplyConflictMerge = $derived(
		Boolean(
			latestConflictAssessment &&
			conflictingQuestions.every((question) => mergeChoices[question.id])
		)
	);

	onMount(() => {
		const timer = setInterval(() => (today = dailySopBangkokDate()), 60_000);
		return () => clearInterval(timer);
	});

	$effect(() => {
		const id = selectedId;
		const contextKey = formContextKey;
		const role = selectedRole;
		const assessment = selectedQuery.data;
		if (!id || !role) {
			hydratedId = '';
			draft = {};
			baseAssessment = null;
			baseDraft = null;
			revisionConflict = false;
			latestConflictAssessment = undefined;
			mergeChoices = {};
			stockPanelOpen = false;
			detailsOpen = {};
			metricFieldsTouched = {};
			return;
		}
		if (isLoadingAssessment || hydratedId === contextKey) return;
		baseAssessment = assessment ?? null;
		baseDraft = cloneRoleDraft(
			assessment ? roleDraftFromAssessment(assessment) : createEmptyRoleDraft(role.code)
		);
		draft = cloneRoleDraft(baseDraft);
		hydratedId = contextKey;
		revisionConflict = false;
		latestConflictAssessment = undefined;
		mergeChoices = {};
		stockPanelOpen = false;
		detailsOpen = {};
		metricFieldsTouched = {};
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
		void goto(
			resolve(`/back-office/dailysop?${params.toString()}` as `/back-office/dailysop?${string}`),
			{ keepFocus: true, noScroll: true }
		);
	}

	function rowsForDate(assessmentDate: string) {
		return roleRowAccess(availableRoles).map(({ role, canAssess }) => {
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
				canAssess
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
			fail: rows.reduce((sum, row) => sum + (row.assessment?.fail_count ?? 0), 0)
		};
	}

	function setStatus(id: string, status: DailySopRoleStatus): void {
		const current = draft[id];
		if (!current) return;
		draft = { ...draft, [id]: { ...current, status } };
		if (status === 'Fail' || notesRequired(status)) detailsOpen[id] = true;
	}

	function setText(id: string, key: 'notes' | 'observations', text: string): void {
		const current = draft[id];
		if (!current) return;
		draft = { ...draft, [id]: { ...current, [key]: text } };
	}

	function setMeasuredValue(id: string, key: string, text: string): void {
		const current = draft[id];
		if (!current) return;
		metricFieldsTouched = {
			...metricFieldsTouched,
			[id]: [...new Set([...(metricFieldsTouched[id] ?? []), key])]
		};
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

	function systemMetricValuesForQuestion(questionId: string): Record<string, number> {
		if (!canEditSelectedRole) return {};
		const occupants =
			DAILY_SOP_OCCUPANCY_QUESTION_IDS.includes(questionId) &&
			occupancyQuery.data?.shelter_code === shelterCode
				? occupancyQuery.data.active
				: undefined;
		const capacity =
			questionId === DAILY_SOP_CAPACITY_QUESTION_ID && shelterQuery.data?.code === shelterCode
				? shelterQuery.data.capacity
				: undefined;
		const suggestions = {
			...(occupants !== undefined ? { occupants } : {}),
			...(capacity !== undefined && capacity > 0 ? { capacity } : {})
		};
		const answer = draft[questionId];
		const touched = new Set(metricFieldsTouched[questionId] ?? []);
		return Object.fromEntries(
			Object.entries(suggestions).filter(
				([key]) =>
					!touched.has(key) &&
					(answer?.measured_values[key] === null || answer?.measured_values[key] === undefined)
			)
		);
	}

	function cloneRoleDraft(source: DailySopRoleDraft | null): DailySopRoleDraft {
		return Object.fromEntries(
			Object.entries(source ?? {}).map(([id, answer]) => [
				id,
				{ ...answer, measured_values: { ...answer.measured_values } }
			])
		);
	}

	function sameControlAnswer(
		left: DailySopRoleControlDraft | undefined,
		right: DailySopRoleControlDraft | undefined
	): boolean {
		if (!left || !right)
			return (
				(!left && !right) ||
				([left?.status ?? null, left?.notes ?? '', left?.observations ?? ''].join('\u0000') ===
					[right?.status ?? null, right?.notes ?? '', right?.observations ?? ''].join('\u0000') &&
					Object.values(left?.measured_values ?? {}).every((value) => value === null) &&
					Object.values(right?.measured_values ?? {}).every((value) => value === null))
			);
		const keys = [
			...new Set([...Object.keys(left.measured_values), ...Object.keys(right.measured_values)])
		].sort();
		return (
			left.status === right.status &&
			left.notes === right.notes &&
			left.observations === right.observations &&
			keys.every(
				(key) => (left.measured_values[key] ?? null) === (right.measured_values[key] ?? null)
			)
		);
	}

	async function loadLatestAfterConflict(): Promise<void> {
		try {
			const result = await selectedQuery.refetch();
			latestConflictAssessment = result.data ?? null;
			if (!latestConflictAssessment)
				toast.error('ไม่พบเอกสารล่าสุดบน server; เก็บ draft นี้ไว้แล้ว');
		} catch (error) {
			toast.error(error instanceof Error ? error.message : 'โหลดข้อมูลล่าสุดไม่สำเร็จ');
		}
	}

	function applyConflictMerge(): void {
		if (!selectedRole || !latestConflictAssessment || !canApplyConflictMerge) return;
		const initial = baseDraft ?? createEmptyRoleDraft(selectedRole.code);
		const server = roleDraftFromAssessment(latestConflictAssessment);
		const merged = cloneRoleDraft(server);
		for (const question of questionsForRole(selectedRole.code)) {
			const baseAnswer = initial[question.id];
			const localAnswer = draft[question.id];
			const serverAnswer = server[question.id];
			const localChanged = !sameControlAnswer(baseAnswer, localAnswer);
			const serverChanged = !sameControlAnswer(baseAnswer, serverAnswer);
			if (!localChanged) continue;
			if (serverChanged && !sameControlAnswer(localAnswer, serverAnswer)) {
				if (mergeChoices[question.id] === 'local') merged[question.id] = localAnswer;
			} else {
				merged[question.id] = localAnswer;
			}
		}
		baseAssessment = latestConflictAssessment;
		baseDraft = cloneRoleDraft(server);
		draft = cloneRoleDraft(merged);
		revisionConflict = false;
		latestConflictAssessment = undefined;
		mergeChoices = {};
		toast.success('รวม draft กับข้อมูลล่าสุดแล้ว ทบทวนคำตอบก่อนกดบันทึกอีกครั้ง');
	}

	function isQuestionDirty(questionId: string): boolean {
		const current = effectiveDraft[questionId];
		if (!current) return false;
		return !sameControlAnswer(baseDraft?.[questionId], current);
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
			if (answer && notesRequired(answer.status) && !answer.notes.trim()) return question.id;
		}
		return null;
	}

	async function save(): Promise<void> {
		if (!selectedRole || !user || revisionConflict) return;
		if (!isCurrentDate) {
			toast.error('วันที่ผ่านมาเปิดดูได้อย่างเดียว ไม่สามารถบันทึกผลได้');
			return;
		}
		const missingNoteId = missingNoteQuestionId();
		if (missingNoteId) {
			const position = questions.findIndex((item) => item.id === missingNoteId) + 1;
			detailsOpen[missingNoteId] = true;
			toast.error(`ข้อ ${position}: กรุณาระบุข้อมูลที่ยังรอ`);
			await tick();
			document
				.getElementById(`role-question-${missingNoteId}`)
				?.scrollIntoView({ behavior: 'smooth', block: 'center' });
			document.getElementById(`daily-sop-${missingNoteId}-notes`)?.focus({ preventScroll: true });
			return;
		}
		const saveContextKey = formContextKey;
		if (!hasRoleDraftInput(effectiveDraft, selectedRole.code)) {
			toast.error('กรุณาบันทึกผลประเมินหรือค่าที่ประเมินได้อย่างน้อยหนึ่งข้อ');
			return;
		}
		const draftBeforeSave = cloneRoleDraft(effectiveDraft);
		const suggestions = Object.fromEntries(
			questionsForRole(selectedRole.code).map((question) => [
				question.id,
				systemMetricValuesForQuestion(question.id)
			])
		);
		const draftForSave = applySystemMetricSuggestionsForEditedControls(
			draftBeforeSave,
			baseDraft ?? createEmptyRoleDraft(selectedRole.code),
			selectedRole.code,
			suggestions,
			sopRatios ?? undefined
		);
		isSaving = true;
		try {
			const saved = await saveMutation.mutateAsync({
				role: selectedRole.code,
				draft: draftForSave,
				date,
				baseAssessment,
				ctx: {
					shelterCode,
					createdBy: user.name,
					assessorName: user.display_name?.trim() || user.name,
					roles: user.roles,
					sopRatios: sopRatios ?? undefined
				}
			});
			// The user, shelter, date or role changed while saving: never touch the new form.
			if (formContextKey !== saveContextKey) return;
			savedAssessment = saved;
			savedContextKey = saveContextKey;
			baseAssessment = saved;
			const savedDraft = cloneRoleDraft(roleDraftFromAssessment(saved));
			baseDraft = savedDraft;
			if (
				questionsForRole(selectedRole.code).every((question) =>
					sameControlAnswer(draftBeforeSave[question.id], draft[question.id])
				)
			) {
				draft = cloneRoleDraft(savedDraft);
				metricFieldsTouched = {};
			}
			saveSuccessOpen = true;
		} catch (error) {
			if (formContextKey !== saveContextKey) return;
			if (
				error instanceof ConflictError ||
				(typeof error === 'object' &&
					error !== null &&
					'code' in error &&
					error.code === 'CONFLICT')
			) {
				revisionConflict = true;
				latestConflictAssessment = undefined;
				mergeChoices = {};
				toast.error(
					'ข้อมูลบน server เปลี่ยนแล้ว draft ยังอยู่ เปิดข้อมูลล่าสุดและรวมก่อนบันทึกใหม่'
				);
			} else {
				toast.error(error instanceof Error ? error.message : 'บันทึกผลประเมินไม่สำเร็จ');
			}
		} finally {
			isSaving = false;
		}
	}

	function roleStatusLabel(status: DailySopRoleAssessment['status'] | undefined): string {
		if (!status) return 'ยังไม่เริ่มประเมิน';
		return status === 'Completed' ? 'ประเมินครบแล้ว' : 'ประเมินยังไม่ครบ';
	}

	function roleStatusClass(status: DailySopRoleAssessment['status'] | undefined): string {
		const base =
			'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1 text-xs font-semibold';
		if (status === 'Completed') return base + ' border-emerald-200 bg-emerald-50 text-emerald-900';
		if (status === 'InProgress') return base + ' border-amber-200 bg-amber-50 text-amber-900';
		return base + ' border-slate-200 bg-muted text-muted-foreground';
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

	function formatUpdatedAt(value: string): string {
		return dailySopBangkokDate(new Date(value)) === date
			? `${formatAssessmentTime(value)} น.`
			: formatAuditDateTime(value);
	}

	function assessorDisplayName(assessment: DailySopRoleAssessment): string {
		return personDisplayName(assessment.assessor_name || user?.display_name?.trim() || user?.name);
	}

	function ratioValuesForQuestion(questionId: string) {
		const storedControl = activeAssessment?.controls.find((control) => control.id === questionId);
		const storedParameter = storedControl?.metric_spec?.parameter;
		if (
			storedControl &&
			metricParameterForQuestion(questionId) &&
			storedControl.metric_spec === null
		)
			return {};
		return storedParameter
			? { ...(sopRatios ?? {}), [storedParameter.key]: storedParameter.value }
			: sopRatios;
	}
</script>

{#snippet statusIcon(status: DailySopRoleAssessment['status'] | undefined)}
	{#if status === 'Completed'}
		<CheckCircle2 class="size-3.5" aria-hidden="true" />
	{:else if status === 'InProgress'}
		<Clock class="size-3.5" aria-hidden="true" />
	{:else}
		<CircleDashed class="size-3.5" aria-hidden="true" />
	{/if}
{/snippet}

<svelte:head>
	<title>
		{selectedRole
			? `ประเมิน ${roleDisplayLabel(selectedRole.key)} | Daily SOP`
			: landingView === 'roles'
				? 'ความคืบหน้าแต่ละตำแหน่ง | Daily SOP'
				: 'ความคืบหน้า Daily SOP รายวัน'}
	</title>
</svelte:head>

{#if selectedRole && !canAssessSelectedRole}
	<StaffPageShell title="แบบประเมินการดำเนินงานประจำวัน">
		<div
			class="space-y-3 rounded-xl border bg-card p-4"
			role="alert"
			data-testid="daily-sop-role-no-access"
		>
			<p class="text-sm">บัญชีนี้ไม่สามารถเปิดแบบประเมินของตำแหน่งนี้ได้</p>
			<Button
				variant="outline"
				class="min-h-11 gap-2 px-3"
				onclick={() => updateUrl(null, date, 'roles')}
			>
				<ArrowLeft class="size-4" aria-hidden="true" /> กลับภาพรวม
			</Button>
		</div>
	</StaffPageShell>
{:else if (!selectedRole && landingView === 'roles') || (selectedRole && !canOpenSelectedRole)}
	<StaffPageShell
		title="รายการประเมินประจำวันที่ {formatAssessmentDate(date)}"
		description={viewHint}
	>
		{#snippet meta()}
			<Button
				variant="outline"
				class="min-h-11 gap-2 px-3"
				onclick={() => updateUrl(null, date, 'days')}
			>
				<ArrowLeft class="size-4" aria-hidden="true" /> ย้อนกลับ
			</Button>
		{/snippet}
		<div class="space-y-5">
			<section
				class="overflow-hidden rounded-xl border bg-card shadow-2xs"
				aria-label="สรุปผลประเมินวันที่ {formatAssessmentDate(date)}"
			>
				<dl class="grid grid-cols-3 divide-x">
					<div class="px-2 py-2 text-center sm:px-4">
						<dt class="text-xs text-muted-foreground sm:text-sm">บันทึกแล้ว</dt>
						<dd class="text-sm font-semibold tabular-nums sm:text-lg">
							{dailySummary.recordedRoles}&nbsp;<span class="font-normal text-muted-foreground"
								>/ {dailySummary.roleCount} ตำแหน่ง</span
							>
						</dd>
					</div>
					<div class="px-2 py-2 text-center sm:px-4">
						<dt class="text-xs text-muted-foreground sm:text-sm">ตอบแล้ว</dt>
						<dd class="text-sm font-semibold tabular-nums sm:text-lg">
							{dailySummary.answered}&nbsp;<span class="font-normal text-muted-foreground"
								>/ {dailySummary.total} ข้อ</span
							>
						</dd>
					</div>
					<div class="px-2 py-2 text-center sm:px-4">
						<dt class="text-xs text-muted-foreground sm:text-sm">ไม่ผ่าน</dt>
						<dd class="text-sm font-semibold text-rose-800 tabular-nums sm:text-lg">
							{dailySummary.fail}&nbsp;<span class="font-normal text-muted-foreground">ข้อ</span>
						</dd>
					</div>
				</dl>
				<div
					class="h-1 bg-muted"
					role="progressbar"
					aria-label="ความคืบหน้าการตอบรวม"
					aria-valuemin="0"
					aria-valuemax={dailySummary.total}
					aria-valuenow={dailySummary.answered}
				>
					<div
						class="h-full bg-primary transition-[width]"
						style:width="{dailySummary.total
							? (dailySummary.answered / dailySummary.total) * 100
							: 0}%"
					></div>
				</div>
			</section>

			<section aria-labelledby="today-role-list-heading">
				<div class="mb-3 flex flex-wrap items-end justify-between gap-2">
					<div>
						<h2 id="today-role-list-heading" class="font-semibold">ผลประเมินแยกตามตำแหน่ง</h2>
					</div>
				</div>

				{#if historyQuery.isLoading}
					<div class="rounded-xl border bg-card p-4 text-sm text-muted-foreground" role="status">
						กำลังโหลดรายการประเมิน...
					</div>
				{:else if historyQuery.isError}
					<div
						class="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-destructive/30 bg-card p-4"
						role="alert"
					>
						<p class="text-sm">โหลดรายการประเมินไม่สำเร็จ</p>
						<Button
							variant="outline"
							class="min-h-11 px-3 whitespace-nowrap"
							onclick={() => resetHistory(shelterCode)}
						>
							ลองอีกครั้ง
						</Button>
					</div>
				{:else if roleRows.length === 0}
					<div
						class="rounded-xl border bg-card p-4 text-sm text-muted-foreground"
						data-testid="daily-sop-no-roles"
					>
						บัญชีนี้ยังไม่มีแบบประเมินที่สามารถทำได้ในศูนย์นี้
					</div>
				{:else}
					<div class="role-progress-table" role="table" aria-label="ผลประเมินแยกตามตำแหน่ง">
						<div class="role-progress-header" role="row">
							<span role="columnheader">หน้าที่</span>
							<span role="columnheader">ความคืบหน้า</span>
							<span role="columnheader">สถานะ</span>
							<span role="columnheader">ผลล่าสุด</span>
							<span role="columnheader">การเข้าถึง</span>
						</div>
						<div class="role-progress-rows" role="rowgroup">
							{#each roleRows as row (row.role.code)}
								{@const canAssessNow = isCurrentDate && row.canAssess}
								{@const actionLabel = canAssessNow ? 'ประเมิน' : 'ดูผลประเมิน'}
								<div class="role-progress-row" role="row">
									<div class="role-progress-identity" role="cell">
										<p class="text-xs font-semibold tracking-wide text-muted-foreground">
											{row.questionCount} ข้อ
										</p>
										<h3 class="mt-1 font-semibold break-words">{roleDisplayLabel(row.role.key)}</h3>
									</div>
									<div class="role-progress-meter" role="cell">
										<div class="role-progress-label">
											<span>ความคืบหน้า</span>
											<strong class="tabular-nums">
												{row.answeredCount} / {row.questionCount} ข้อ · {row.percent}%
											</strong>
										</div>
										<div
											class="role-progress-track"
											role="progressbar"
											aria-label="ความคืบหน้า {roleDisplayLabel(row.role.key)}"
											aria-valuemin="0"
											aria-valuemax="100"
											aria-valuenow={row.percent}
										>
											<div class="role-progress-fill" style:width="{row.percent}%"></div>
										</div>
									</div>
									<div class="role-progress-status" role="cell">
										<span class={roleStatusClass(row.assessment?.status)}>
											{@render statusIcon(row.assessment?.status)}
											{roleStatusLabel(row.assessment?.status)}
										</span>
									</div>
									<div class="role-progress-summary" role="cell">
										{#if row.assessment}
											ผ่าน {row.assessment.pass_count} · ไม่ผ่าน {row.assessment.fail_count} · บันทึกล่าสุด
											{formatAssessmentTime(row.assessment.updated_at)}
										{:else}
											ยังไม่มีผลประเมินที่บันทึกไว้
										{/if}
									</div>
									<div class="role-progress-action" role="cell">
										<Button
											variant={canAssessNow ? 'default' : 'outline'}
											class={`min-h-12 w-full shrink-0 px-3 xl:min-h-11 ${
												canAssessNow
													? ''
													: 'border-primary/25 bg-primary/5 text-primary hover:bg-primary/10'
											}`}
											aria-label="{actionLabel}: {roleDisplayLabel(row.role.key)}"
											onclick={() => updateUrl(row.role.code)}
										>
											{actionLabel}
										</Button>
									</div>
								</div>
							{/each}
						</div>
					</div>
					{#if historyQuery.hasNextPage}
						<button
							class="mt-3 min-h-11 rounded-md border bg-background px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50"
							type="button"
							disabled={historyQuery.isFetchingNextPage}
							onclick={() => historyQuery.fetchNextPage()}
							>{historyQuery.isFetchingNextPage ? 'กำลังโหลด...' : 'โหลดเพิ่มเติม'}</button
						>
					{/if}
				{/if}
			</section>
		</div>
	</StaffPageShell>
{:else if !selectedRole}
	<StaffPageShell
		title="แบบประเมินการดำเนินงานประจำวัน"
		description="เลือกวันที่จากรายการด้านล่าง เพื่อดูความคืบหน้าแยกตามหน้าที่"
	>
		<div class="space-y-4" data-testid="daily-sop-days-view">
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
						onclick={() => resetHistory(shelterCode)}
					>
						ลองอีกครั้ง
					</button>
				</div>
			{:else if availableRoles.length === 0}
				<div
					class="rounded-xl border bg-card p-4 text-sm text-muted-foreground"
					data-testid="daily-sop-no-roles"
				>
					บัญชีนี้ยังไม่มีแบบประเมินที่สามารถทำได้ในศูนย์นี้
				</div>
			{:else}
				<div class="overflow-hidden rounded-xl border bg-card" data-testid="daily-sop-day-list">
					{#each dayRows as day (day.date)}
						{@const isToday = day.date === today}
						{@const percent = day.total ? Math.floor((day.answered / day.total) * 100) : 0}
						{@const dayStatus = daySummaryStatus(day)}
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
									<span class={roleStatusClass(dayStatus)}>
										{@render statusIcon(dayStatus)}
										{day.recordedRoles === 0
											? 'ยังไม่เริ่มประเมิน'
											: day.completedRoles === day.roleCount
												? 'ประเมินครบทุกตำแหน่ง'
												: 'กำลังประเมิน'}
									</span>
								</div>
								<div
									class="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"
								>
									<p>
										ประเมินครบ <span class="font-semibold tabular-nums"
											>{day.completedRoles} / {day.roleCount} ตำแหน่ง</span
										>
										<span class="text-muted-foreground">· ตอบแล้ว</span>
										<span class="font-semibold tabular-nums">{day.answered} / {day.total} ข้อ</span>
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
									ไม่ผ่าน {day.fail} · ยังไม่เริ่ม {day.roleCount - day.recordedRoles} ตำแหน่ง
									{#if day.lastUpdatedAt}
										<span>บันทึกล่าสุด {formatAssessmentTime(day.lastUpdatedAt)}</span>{/if}
								</p>
							</div>
							<button
								class="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary/25 px-4 text-sm font-semibold whitespace-nowrap text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:w-auto"
								type="button"
								aria-label="{isToday
									? day.recordedRoles === 0
										? 'ประเมิน'
										: 'ดูความคืบหน้า'
									: 'ดูผลย้อนหลัง'} วันที่ {formatAssessmentDate(day.date)}"
								onclick={() => updateUrl(null, day.date, 'roles')}
							>
								{isToday ? (day.recordedRoles === 0 ? 'ประเมิน' : 'ดูความคืบหน้า') : 'ดูผลย้อนหลัง'}
								<ClipboardCheck class="size-4" aria-hidden="true" />
							</button>
						</article>
					{/each}
				</div>
				{#if historyQuery.hasNextPage}
					<p class="text-sm text-muted-foreground" data-testid="daily-sop-history-needs-more">
						{historyNeedsMore
							? 'ยังไม่พบประวัติที่เกี่ยวข้อง กด “โหลดเพิ่มเติม” เพื่อตรวจสอบวันก่อนหน้า'
							: 'วันที่เก่าที่สุดที่แสดงอาจยังโหลดไม่ครบทุกหน้าที่ — โหลดเพิ่มเพื่อดูครบ'}
					</p>
					<button
						class="min-h-11 rounded-md border bg-background px-4 text-sm font-semibold hover:bg-muted disabled:opacity-50"
						type="button"
						disabled={historyQuery.isFetchingNextPage}
						onclick={() => historyQuery.fetchNextPage()}
						>{historyQuery.isFetchingNextPage ? 'กำลังโหลด...' : 'โหลดเพิ่มเติม'}</button
					>
				{/if}
			{/if}
		</div>
	</StaffPageShell>
{:else}
	<StaffPageShell
		title={roleDisplayLabel(selectedRole.key)}
		maxWidth="7xl"
		class="pb-[calc(9rem+env(safe-area-inset-bottom))] sm:pb-28"
	>
		{#snippet meta()}
			<div class="space-y-2">
				<div class="flex flex-wrap items-center gap-x-3 gap-y-2">
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
				<div class="flex flex-wrap items-center gap-2">
					{#if activeAssessment}
						<span class={roleStatusClass(activeAssessment.status)}>
							{@render statusIcon(activeAssessment.status)}
							{roleStatusLabel(activeAssessment.status)}
						</span>
					{/if}
					{#if isHistoricalDate || !canEditSelectedRole}
						<span
							class="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-muted px-2.5 py-1 text-xs font-semibold whitespace-nowrap text-muted-foreground"
						>
							<Eye class="size-3.5" aria-hidden="true" />
							ดูอย่างเดียว
						</span>
					{/if}
				</div>
				{#if isCurrentDate && !canEditSelectedRole}
					<p class="text-sm text-muted-foreground">
						ดูสถานะทุกตำแหน่งได้ · ประเมินได้เฉพาะตำแหน่งที่ได้รับมอบหมาย
					</p>
				{/if}
				{#if activeAssessment}
					<p class="text-sm text-muted-foreground">
						เริ่มโดย {assessorDisplayName(activeAssessment)} <span aria-hidden="true">·</span>
						อัปเดตล่าสุด
						<time datetime={activeAssessment.updated_at}>
							{formatUpdatedAt(activeAssessment.updated_at)}
						</time>
					</p>
				{:else if canEditSelectedRole}
					<p class="text-sm text-muted-foreground">
						ผู้ประเมิน: {personDisplayName(user?.display_name?.trim() || user?.name)}
					</p>
				{:else}
					<p class="text-sm text-muted-foreground">ยังไม่มีผลประเมินที่บันทึกไว้</p>
				{/if}
			</div>
		{/snippet}
		<div class="space-y-4">
			{#if revisionConflict || (progress && counts)}
				<div class="space-y-4 rounded-xl border bg-card p-4 sm:p-5">
					{#if revisionConflict}
						<section
							class="space-y-3 rounded-xl border border-amber-300 bg-amber-50 p-4"
							aria-label="จัดการข้อมูลชนกัน"
						>
							<div role="alert">
								<h2 class="font-semibold text-amber-950">
									ข้อมูลบน server เปลี่ยนระหว่างที่คุณกำลังแก้
								</h2>
								<p class="mt-1 text-sm text-amber-900">
									เก็บ draft ของคุณไว้แล้ว ระบบหยุดการบันทึกเพื่อไม่ให้เขียนทับข้อมูลใหม่
								</p>
							</div>
							<Button
								variant="outline"
								class="min-h-12 border-amber-800/30 bg-background px-3 hover:bg-amber-100"
								onclick={loadLatestAfterConflict}
							>
								โหลดข้อมูลล่าสุด
							</Button>
							{#if latestConflictAssessment === null}
								<p class="text-sm text-amber-950" role="status">
									ยังไม่พบเอกสารล่าสุด; draft ยังอยู่
									กรุณารีเฟรชหน้าหรือให้ผู้ดูแลยืนยันรายการก่อนเริ่มบันทึกใหม่
								</p>
							{:else if latestConflictAssessment}
								{#if conflictingQuestions.length}
									<p class="text-sm text-amber-950">
										เลือกคำตอบที่จะเก็บสำหรับแต่ละข้อที่ทั้งสองฝ่ายแก้ แล้วกดรวมข้อมูล
									</p>
									{#each conflictingQuestions as conflict (conflict.id)}
										<fieldset class="rounded-lg border border-amber-300 bg-background p-3">
											<legend class="px-1 text-sm font-semibold"
												>{conflict.id} · {conflict.text}</legend
											>
											<RadioGroup.Root
												value={mergeChoices[conflict.id] ?? ''}
												onValueChange={(value) => {
													if (value === 'local' || value === 'server') {
														mergeChoices = { ...mergeChoices, [conflict.id]: value };
													}
												}}
												class="gap-2 sm:grid-cols-2"
											>
												{#each [{ value: 'local', label: 'ใช้ draft ของฉัน' }, { value: 'server', label: 'ใช้ข้อมูลล่าสุดจาก server' }] as choice (choice.value)}
													{@const selected = mergeChoices[conflict.id] === choice.value}
													<div
														class={`relative flex min-h-12 items-center rounded-md border px-3 text-sm ${selected ? 'border-amber-700 bg-amber-50 text-amber-950' : 'border-slate-300 bg-background text-slate-800'}`}
													>
														<RadioGroup.Item
															id={`merge-${choice.value}-${conflict.id}`}
															value={choice.value}
															aria-label={choice.label}
															class="absolute inset-0 z-10 size-full rounded-md border-0 bg-transparent text-transparent shadow-none data-[state=checked]:border-0 data-[state=checked]:bg-transparent"
														/>
														<span class="pointer-events-none relative">{choice.label}</span>
													</div>
												{/each}
											</RadioGroup.Root>
										</fieldset>
									{/each}
								{:else}
									<p class="text-sm text-amber-950">
										ไม่พบข้อที่ทั้งสองฝ่ายแก้ต่างกัน; รวมคำตอบของคุณเข้ากับข้อมูลล่าสุดได้
									</p>
								{/if}
								<Button
									class="min-h-12 bg-amber-900 px-4 text-white hover:bg-amber-950"
									disabled={!canApplyConflictMerge}
									onclick={applyConflictMerge}
								>
									รวม draft กับข้อมูลล่าสุด
								</Button>
							{/if}
						</section>
					{/if}

					{#if progress && counts}
						<div class="space-y-3">
							<div class={canEditSelectedRole ? 'hidden sm:block' : 'block'}>
								<div class="flex items-center justify-between gap-3 text-sm">
									<span class="font-semibold">ความคืบหน้า</span>
									<span class="shrink-0 font-medium text-muted-foreground tabular-nums">
										{progress.total - progress.unanswered} / {progress.total} ข้อ · {progress.percent}%
									</span>
								</div>
								<div
									class="mt-2 h-2 overflow-hidden rounded-full bg-muted"
									role="progressbar"
									aria-label="ความคืบหน้าของ {roleDisplayLabel(selectedRole.key)}"
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
							<div class="grid grid-cols-3 gap-1.5 text-center sm:gap-2">
								<div class="min-w-0 rounded-lg border bg-muted/20 px-1 py-2">
									<strong class="block text-sm text-emerald-800 tabular-nums">{counts.pass}</strong>
									<span class="block text-xs text-muted-foreground">ผ่าน</span>
								</div>
								<div class="min-w-0 rounded-lg border bg-muted/20 px-1 py-2">
									<strong class="block text-sm text-rose-800 tabular-nums">{counts.fail}</strong>
									<span class="block text-xs text-muted-foreground">ไม่ผ่าน</span>
								</div>
								<div class="min-w-0 rounded-lg border bg-muted/20 px-1 py-2">
									<strong class="block text-sm tabular-nums">{counts.unanswered}</strong>
									<span class="block text-xs text-muted-foreground">ยังไม่ตอบ</span>
								</div>
							</div>
						</div>
					{/if}
				</div>
			{/if}

			{#if isLoadingAssessment}
				<div class="rounded-xl border p-6 text-sm text-muted-foreground">
					กำลังโหลดแบบประเมินของตำแหน่งนี้...
				</div>
			{:else}
				<section
					class="overflow-hidden rounded-xl border bg-card"
					aria-label="คำถามสำหรับ {roleDisplayLabel(selectedRole.key)}"
				>
					<div
						class="hidden grid-cols-[minmax(0,1fr)_repeat(2,minmax(5rem,6rem))] items-center gap-x-4 border-b bg-muted/40 px-4 py-3 text-sm font-semibold text-muted-foreground sm:grid"
						aria-hidden="true"
					>
						<span class="text-center">คำถาม</span>
						<span class="text-center">ผ่าน</span>
						<span class="text-center">ไม่ผ่าน</span>
					</div>
					<div>
						{#each questions as question, index (question.id)}
							{@const answer = effectiveDraft[question.id]}
							{@const savedControl = activeAssessment?.controls.find(
								(control) => control.id === question.id
							)}
							{@const isDirty = isQuestionDirty(question.id)}
							{@const metric = metricForQuestion(question.id, ratioValuesForQuestion(question.id))}
							{@const parameterRequired = metricParameterForQuestion(question.id) !== null}
							{@const parameterMissing = parameterRequired && !metric?.parameter}
							{@const parameterLoading =
								parameterMissing &&
								!activeAssessment &&
								!sopRatioQuery.isSuccess &&
								!sopRatioQuery.isError}
							{@const parameterUnavailable =
								parameterMissing &&
								(Boolean(activeAssessment) || sopRatioQuery.isSuccess || sopRatioQuery.isError)}
							{@const systemMetricValues = systemMetricValuesForQuestion(question.id)}
							{@const displayedMetricValues = {
								...(answer?.measured_values ?? {}),
								...systemMetricValues
							}}
							{@const calculated = metric?.evaluate(displayedMetricValues) ?? null}
							{@const requirement = requiredForMetric(metric, displayedMetricValues)}
							<section
								id={`role-question-${question.id}`}
								data-question-id={question.id}
								class="grid scroll-mt-6 grid-cols-1 gap-y-3 border-b p-3 last:border-b-0 sm:p-4 md:grid-cols-[minmax(0,1fr)_repeat(2,minmax(5rem,6rem))] md:items-start md:gap-x-4"
							>
								<div class="col-start-1 row-start-1 flex min-w-0 items-start gap-2 sm:gap-3">
									<span
										class="mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold sm:size-8 sm:text-sm"
										>{index + 1}</span
									>
									<div class="min-w-0 flex-1">
										<h3 class="text-sm leading-relaxed font-medium sm:text-base">
											{question.text}
										</h3>
										{#if parameterUnavailable}
											<p
												class="mt-2 text-xs leading-relaxed text-amber-800 sm:text-sm"
												role="status"
											>
												{#if sopRatioQuery.isError}
													โหลดข้อมูลเกณฑ์ของศูนย์ไม่สำเร็จ โปรดลองอีกครั้ง หากยังไม่มีข้อมูลให้เลือก
													“รอข้อมูล” และระบุสิ่งที่ขาด
												{:else}
													ไม่พบค่ากำหนดของศูนย์สำหรับข้อนี้ จึงยังประเมินไม่ได้
												{/if}
											</p>
											{#if sopRatioQuery.isError}
												<Button
													variant="outline"
													class="mt-2 min-h-11 px-3"
													onclick={() => sopRatioQuery.refetch()}
												>
													ลองโหลดใหม่
												</Button>
											{/if}
										{:else if parameterLoading}
											<div
												class="mt-2 flex flex-wrap items-center gap-2 text-xs leading-relaxed text-muted-foreground sm:text-sm"
												role="status"
											>
												<p>กำลังโหลดค่ากำหนดของศูนย์</p>
											</div>
										{/if}
										{#if savedControl || isDirty}
											<div
												class="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs leading-relaxed text-muted-foreground sm:text-sm"
											>
												{#if savedControl}
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
									class="min-w-0 md:col-span-2 md:col-start-2 md:row-start-1"
									disabled={!canEditSelectedRole || revisionConflict}
								>
									<legend class="sr-only">ผลประเมิน: {question.text}</legend>
									<div class="grid grid-cols-2 gap-1.5 sm:gap-2">
										{#each statusOptionsForQuestion(parameterUnavailable, answer?.status) as option (option.value)}
											{@const isSelected = answer?.status === option.value}
											{@const optionDisabled =
												!canEditSelectedRole ||
												revisionConflict ||
												(parameterUnavailable && option.value !== 'Pending')}
											<label
												class={`flex min-h-12 min-w-0 items-center justify-center gap-1.5 rounded-md border px-1.5 text-sm font-semibold transition-colors focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring sm:mx-auto sm:size-11 sm:min-h-11 sm:min-w-11 sm:gap-0 sm:rounded-full sm:px-0 md:size-12 md:min-h-12 md:min-w-12 ${
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
									open={detailsOpen[question.id] ??
										(answer?.status === 'Fail' ||
											notesRequired(answer?.status) ||
											(question.id === DAILY_SOP_CAPACITY_QUESTION_ID && calculated !== null) ||
											question.id === DAILY_SOP_STOCK_QUESTION_ID)}
									ontoggle={(event) => (detailsOpen[question.id] = event.currentTarget.open)}
								>
									<summary class="min-h-11 cursor-pointer py-3 text-xs font-medium sm:text-sm">
										{#if notesRequired(answer?.status)}
											ระบุข้อมูลที่ยังรอ
											<span class="font-normal text-destructive">(จำเป็น)</span>
										{:else}
											รายละเอียดเพิ่มเติม
											<span class="font-normal text-muted-foreground">(ไม่บังคับ)</span>
										{/if}
									</summary>
									<div class="mt-3 grid gap-3 md:grid-cols-2">
										{#if question.id === DAILY_SOP_STOCK_QUESTION_ID}
											<div
												class="flex flex-col items-start gap-2 rounded-lg border border-slate-200/80 bg-white p-3 sm:flex-row sm:items-center sm:gap-x-4 md:col-span-2"
											>
												<Button
													variant="outline"
													bind:ref={stockTrigger}
													class="min-h-12 w-full sm:w-auto"
													data-testid="daily-sop-stock-trigger"
													onclick={() => (stockPanelOpen = true)}
												>
													<Package class="size-4" aria-hidden="true" />
													ดูยอดคงเหลือในระบบ
												</Button>
												<div class="text-sm text-slate-500">
													<p>อ่านอย่างเดียว · ไม่แก้ไขสต็อก</p>
													{#if stockQuery.data}
														<p class="text-xs">
															<span class="tabular-nums">{stockQuery.data.items.length}</span>
															รายการ
															{#if stockQuery.data.last_updated}
																· อัปเดต {formatAuditDateTime(stockQuery.data.last_updated)}
															{/if}
														</p>
													{/if}
												</div>
											</div>
										{/if}
										{#if metric && answer}
											<div class="rounded-lg border border-sky-200 bg-sky-50/60 p-3 md:col-span-2">
												<div class="flex flex-wrap items-center justify-between gap-2">
													<p class="text-sm font-semibold">
														ข้อมูลตัวเลขสำหรับตรวจสอบ
														<span class="font-normal text-muted-foreground">(ไม่บังคับ)</span>
													</p>
													{#if canEditSelectedRole && systemMetricValues && Object.keys(systemMetricValues).length > 0}
														<span class="text-xs text-muted-foreground">
															ระบบกรอกข้อมูลบางส่วนให้แล้ว โปรดตรวจสอบและแก้ไขหากไม่ตรงกับข้อมูลจริง
														</span>
													{/if}
												</div>
												<div class="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
													{#each metric.fields as field (field.key)}
														<label class="grid gap-1.5 text-sm">
															<span
																>{field.label}
																<span class="text-muted-foreground">({field.unit})</span></span
															>
															<Input
																id={'daily-sop-' + question.id + '-' + field.key}
																type="number"
																min="0"
																step={field.step}
																value={answer.measured_values[field.key] ??
																	systemMetricValues[field.key] ??
																	''}
																disabled={!canEditSelectedRole || revisionConflict}
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
												{#if requirement}
													<p class="mt-1 text-sm" data-testid="metric-required">
														ต้องการอย่างน้อย {requirement.amount}
														{requirement.unit}
													</p>
												{/if}
												{#if calculated !== null}
													<p class="mt-2 text-sm font-medium" data-testid="metric-result">
														ผลตรวจสอบจากตัวเลข: {calculated ? metric.passText : metric.failText}
													</p>
													{@const hint = metric.hint(displayedMetricValues)}
													{#if hint}
														<p class="mt-1 text-sm" data-testid="metric-hint">{hint}</p>
													{/if}
													<p class="mt-1 text-xs text-muted-foreground">
														ตัวเลขช่วยตรวจสอบเบื้องต้น โปรดดูสถานการณ์จริงก่อนเลือกผล
													</p>
												{/if}
											</div>
										{/if}
										<label class="grid gap-1.5 text-sm">
											<span
												>สิ่งที่พบจากการตรวจ <span class="font-normal text-muted-foreground"
													>(ถ้ามี)</span
												></span
											>
											<Textarea
												id={'daily-sop-' + question.id + '-observations'}
												rows={3}
												value={answer?.observations ?? ''}
												disabled={!canEditSelectedRole || revisionConflict}
												oninput={(event) =>
													setText(question.id, 'observations', event.currentTarget.value)}
												placeholder="เช่น จำนวน เวลา หรือจุดที่เกี่ยวข้อง"
											/>
										</label>
										<label class="grid gap-1.5 text-sm">
											<span>
												{#if notesRequired(answer?.status)}
													ข้อมูลที่ยังรอ <span class="text-destructive">(จำเป็น)</span>
												{:else}
													หมายเหตุเพิ่มเติม
													<span class="font-normal text-muted-foreground">(ถ้ามี)</span>
												{/if}
											</span>
											<Textarea
												id={'daily-sop-' + question.id + '-notes'}
												rows={3}
												disabled={!canEditSelectedRole || revisionConflict}
												class={notesRequired(answer?.status) && !answer?.notes.trim()
													? 'border-destructive'
													: ''}
												aria-invalid={notesRequired(answer?.status) && !answer?.notes.trim()}
												value={answer?.notes ?? ''}
												oninput={(event) =>
													setText(question.id, 'notes', event.currentTarget.value)}
												placeholder={answer?.status === 'Pending'
													? 'ระบุข้อมูลที่ยังขาด เหตุผลที่ต้องรอ และผู้รับผิดชอบติดตาม'
													: answer?.status === 'Fail'
														? 'เช่น พบปัญหาอะไร ดำเนินการแก้อย่างไร หรือใครรับผิดชอบ'
														: 'บันทึกเพิ่มเติม (ถ้ามี)'}
											/>
											{#if notesRequired(answer?.status) && !answer?.notes.trim()}
												<span class="text-xs text-destructive">กรุณาระบุข้อมูลที่ยังรอ</span>
											{/if}
										</label>
									</div>
								</details>
							</section>
						{/each}
					</div>
				</section>

				{#if canEditSelectedRole}
					<div
						class="sticky bottom-[var(--testing-banner-height)] z-20 -mx-4 -mb-[calc(9rem+env(safe-area-inset-bottom))] border-t bg-background/95 px-3 py-2 backdrop-blur sm:-mx-6 sm:-mb-28 sm:px-4 sm:py-3"
					>
						<div
							class="mx-auto grid max-w-6xl grid-cols-1 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:gap-3"
						>
							{#if progress}
								<div class="min-w-0">
									<div class="flex items-center justify-between gap-2 text-xs">
										<span class="font-medium text-muted-foreground">ความคืบหน้า</span>
										<span class="shrink-0 font-semibold tabular-nums">
											{progress.total - progress.unanswered} / {progress.total} · {progress.percent}%
										</span>
									</div>
									<div
										class="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted"
										role="progressbar"
										aria-label="ความคืบหน้าของ {roleDisplayLabel(selectedRole.key)}"
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
							<div class="grid gap-2 sm:flex sm:justify-end">
								<Button
									class="min-h-12 w-full gap-2 px-3 py-2 text-sm sm:min-h-11 sm:w-auto sm:px-4"
									disabled={!canSave || isSaving}
									onclick={save}
								>
									<Save class="size-4" aria-hidden="true" />
									{isSaving
										? 'กำลังบันทึก...'
										: isComplete
											? 'บันทึกผลประเมิน'
											: 'บันทึกความคืบหน้า'}
								</Button>
							</div>
						</div>
					</div>
				{/if}
			{/if}
		</div>
	</StaffPageShell>
{/if}

{#if selectedRole && canAssessSelectedRole && roleUsesStockCheck(selectedRole.code)}
	<DailySopStockPanel
		bind:open={stockPanelOpen}
		shelterCode={stockShelterCode}
		status={stockQuery.data ? 'ready' : stockQuery.isError ? 'error' : 'loading'}
		refreshFailed={Boolean(stockQuery.data && stockQuery.isError)}
		items={stockQuery.data?.items ?? []}
		updatedLabel={stockQuery.data?.last_updated
			? formatAuditDateTime(stockQuery.data.last_updated)
			: null}
		isRefreshing={stockQuery.isFetching}
		onRefresh={() => stockQuery.refetch()}
		onReturnFocus={() => stockTrigger?.focus()}
	/>
{/if}

{#if canAssessSelectedRole && savedContextKey === formContextKey}
	<Dialog.Root bind:open={saveSuccessOpen}>
		<Dialog.Content data-testid="role-save-success-dialog">
			<Dialog.Header class="text-left">
				<div
					class="mb-1 flex size-11 items-center justify-center rounded-full bg-emerald-100 text-emerald-800"
				>
					<CheckCircle2 class="size-5" aria-hidden="true" />
				</div>
				<Dialog.Title>
					{savedAssessment?.status === 'Completed'
						? 'บันทึกผลประเมินแล้ว'
						: 'บันทึกความคืบหน้าแล้ว'}
				</Dialog.Title>
				<Dialog.Description>
					{selectedRole ? roleDisplayLabel(selectedRole.key) : ''} · {formatAssessmentDate(
						savedAssessment?.assessment_date ?? date
					)}
				</Dialog.Description>
				<p class="text-sm text-muted-foreground">
					บันทึกโดย {savedAssessment?.assessor_name ?? user?.display_name?.trim() ?? user?.name} · เวลา
					{formatAssessmentTime(savedAssessment?.updated_at ?? new Date().toISOString())}
				</p>
			</Dialog.Header>
			<Dialog.Footer class="flex-col-reverse gap-2 sm:flex-row sm:justify-end">
				<Button
					variant="outline"
					class="min-h-12 w-full px-4 sm:min-h-11 sm:w-auto"
					onclick={() => (saveSuccessOpen = false)}
				>
					ทำต่อหน้านี้
				</Button>
				<Button
					class="min-h-12 w-full px-4 sm:min-h-11 sm:w-auto"
					onclick={() => {
						saveSuccessOpen = false;
						updateUrl(null, date, 'roles');
					}}
				>
					กลับภาพรวม
				</Button>
			</Dialog.Footer>
		</Dialog.Content>
	</Dialog.Root>
{/if}

<style>
	.role-progress-table {
		min-width: 0;
		--role-progress-columns: minmax(0, 1fr) auto;
	}

	.role-progress-header {
		display: grid;
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

	.role-progress-header,
	.role-progress-row {
		grid-template-columns: var(--role-progress-columns);
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
			'summary summary'
			'action action';
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
		width: 100%;
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
		font-size: 0.875rem;
		line-height: 1.5;
		font-variant-numeric: tabular-nums;
		color: var(--muted-foreground);
	}

	.role-progress-action {
		grid-area: action;
		justify-self: stretch;
	}

	@media (min-width: 80rem) {
		.role-progress-table {
			--role-progress-columns: minmax(0, 1.3fr) 12rem minmax(7rem, 0.7fr) minmax(0, 1fr) 8rem;
			overflow: hidden;
			border: 1px solid var(--border);
			border-radius: 0.75rem;
			background: var(--card);
		}

		.role-progress-header,
		.role-progress-row {
			display: grid;
			grid-template-columns: var(--role-progress-columns);
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

		.role-progress-header > * {
			text-align: center;
		}

		.role-progress-rows {
			display: block;
		}

		.role-progress-row {
			grid-template-areas: none;
			grid-template-columns: var(--role-progress-columns);
			gap: 0.85rem;
			border: 0;
			border-top: 1px solid color-mix(in srgb, var(--border) 65%, var(--card));
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

		.role-progress-status {
			justify-self: start;
		}

		.role-progress-action {
			justify-self: stretch;
		}

		.role-progress-label span {
			display: none;
		}
	}
</style>
