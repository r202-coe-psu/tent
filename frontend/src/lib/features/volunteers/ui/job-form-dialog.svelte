<script lang="ts">
	/**
	 * Job create/edit dialog — "ประกาศภารกิจงานอาสาใหม่"
	 * (CR-094 FR-VOL-09.1/09.5, 01-tab-job-board.md §01.4).
	 *
	 * Superforms + Zod 4 (`zod4`, `sveltekit-superforms/adapters`) against
	 * `jobInputSchema`, the same shape every other feature form in this codebase
	 * uses (`people/ui/household-form.svelte`, `catalog/ui/item-master-form.svelte`).
	 * Errors surface through the Superforms `$errors` store via
	 * `Form.FieldErrors` — never hand-rolled.
	 *
	 * `tier` and `auto_accept` are NOT on this form (owner decision 2026-08-27):
	 * every job created here is `operational` with `auto_accept: false`, the
	 * schema defaults. A `staff-capable` job — the tier that grants time-bound
	 * write access (FR-VOL-05R) — therefore cannot be created from this screen
	 * and needs its own UI later.
	 *
	 * Capacity comes from the sub-shift rows (`shifts[]`, schema_v 3): the job's
	 * `quota` is their headcount sum, so there is no separate total to keep in
	 * sync. Rows are added one at a time or generated over a date range by
	 * `domain/shift-batch.ts`, which is pure and unit-tested.
	 */
	import { untrack } from 'svelte';
	import { defaults, superForm, setError } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { z } from 'zod';
	import X from '@lucide/svelte/icons/x';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Plus from '@lucide/svelte/icons/plus';
	import Zap from '@lucide/svelte/icons/zap';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import Check from '@lucide/svelte/icons/check';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import DatePicker from '$lib/components/date-picker.svelte';
	import TimePicker from '$lib/components/time-picker.svelte';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { ulid } from '$lib/db/ulid';
	import { jobInputSchema, totalShiftQuota } from '../domain/job.schema';
	import type { Job, JobShift } from '../domain/job.schema';
	import { toSkillCode, toSkillCodes } from '../domain/skill-catalog';
	import { jobShiftQuotaSplits } from '../domain/capacity';
	import JobShiftEditDialog from './job-shift-edit-dialog.svelte';
	import {
		ALL_WEEKDAYS,
		WEEKDAYS,
		WEEKDAYS_MON_FRI,
		WEEKENDS,
		appendShifts,
		defaultShiftEndDate,
		generateBatchShifts,
		isDuplicateShift,
		type Weekday
	} from '../domain/shift-batch';
	import { useCreateJob, useSkillOptions, useUpdateJob } from '../application/queries';

	/** Superforms holds the schema's OUTPUT shape — defaults already materialised. */
	type JobFormValues = z.output<typeof jobInputSchema>;

	let {
		open = $bindable(false),
		job = null
	}: {
		open?: boolean;
		job?: Job | null;
	} = $props();

	const queryClient = useQueryClient();
	const createMutation = useCreateJob(queryClient);
	const updateMutation = useUpdateJob(queryClient);

	/**
	 * Master Data `volunteer_skills`, effective for this shelter (CR-100) —
	 * global list merged with the shelter's own additions and minus the ones it
	 * disabled. The ticked value stored on the job is the master **code**;
	 * `skill-catalog.ts` resolves it back to a label everywhere it is shown.
	 */
	const skillCatalog = useSkillOptions();
	const skillsList = $derived(skillCatalog.options);

	const isEdit = $derived(job !== null);

	/**
	 * LIFECYCLE STATUS control. Every option is persisted exactly as picked;
	 * `full` is the only one the quota flow may reassert on its own, and only
	 * once the last seat is actually taken.
	 */
	/**
	 * `selectedClass` is written out in full per option — Tailwind scans source
	 * text, so a class name assembled at runtime would never be generated.
	 */
	const STATUS_OPTIONS: {
		value: JobFormValues['status'];
		label: string;
		selectedClass: string;
	}[] = [
		{
			value: 'draft',
			label: 'ร่าง',
			selectedClass: 'border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100'
		},
		{
			value: 'open',
			label: 'เปิดรับ',
			selectedClass: 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
		},
		{
			value: 'paused',
			label: 'พักรับ',
			selectedClass: 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
		},
		{
			value: 'full',
			label: 'เต็มโควตา',
			selectedClass: 'border-violet-300 bg-violet-50 text-violet-700 hover:bg-violet-100'
		},
		{
			value: 'closed',
			label: 'ปิดงาน',
			selectedClass: 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
		}
	];

	function newShiftId(): string {
		return `js-${ulid()}`;
	}

	function emptyValues(): JobFormValues {
		return {
			title: '',
			description: '',
			tier: 'operational',
			required_roles: [],
			skills_required: [],
			shifts: [],
			auto_accept: false,
			is_urgent: false,
			status: 'open'
		};
	}

	function valuesFromJob(source: Job): JobFormValues {
		return {
			title: source.title,
			description: source.description,
			tier: source.tier,
			required_roles: [...source.required_roles],
			// A job written before CR-100 stored labels — canonicalise to codes so
			// the right cards tick, and so saving migrates the value quietly.
			skills_required: toSkillCodes(source.skills_required ?? [], skillCatalog.options),
			shifts: source.shifts.map((s) => ({ ...s })),
			auto_accept: source.auto_accept,
			is_urgent: source.is_urgent,
			// `cancelled` is terminal and not choosable on this control — show the
			// nearest editable state instead.
			status: STATUS_OPTIONS.some((o) => o.value === source.status)
				? (source.status as JobFormValues['status'])
				: 'open'
		};
	}

	/**
	 * Explicit `id`: without one, Superforms derives an id from the schema
	 * shape, and every `JobFormDialog` instance shares `jobInputSchema` — so
	 * the create dialog on the job board tab and an edit dialog on a job's
	 * detail page collide ("Duplicate form id's found") whenever both stay
	 * mounted at once (SvelteKit keeps the previous route's components alive
	 * for a beat during a client-side navigation). Each job gets its own id;
	 * the create form (no `job`) gets a fixed one, since only one create
	 * dialog exists per screen.
	 *
	 * `warnings.duplicateId: false`: Superforms tracks registered ids per
	 * SvelteKit `page` object and never clears an entry on unmount
	 * (sveltekit-superforms `superForm.js`). `back-office/volunteers/+page.svelte`
	 * keeps its 3 tabs on one `page` and unmounts/remounts `JobBoardTab` (and
	 * this dialog with it) every time the "จัดการงาน" tab is switched away and
	 * back — which re-registers the SAME id against the same lingering entry
	 * and fires this warning even though only one `JobFormDialog` is ever
	 * mounted at a time. The `id` above still does its real job (keeping this
	 * form's data separate from every other form on the page); this only
	 * silences the stale-registration false positive from the tab remount.
	 */
	const form = superForm(defaults(emptyValues(), zod4(jobInputSchema)), {
		// `untrack`: this id is fixed for the lifetime of the dialog instance —
		// reading `job` here is a one-time initialization, not a reactive
		// dependency (`job-detail-page.svelte` swaps its `job` object on every
		// refetch without ever remounting this dialog).
		id: untrack(() => (job ? `volunteer-job-edit-${job._id}` : 'volunteer-job-create')),
		warnings: { duplicateId: false },
		SPA: true,
		dataType: 'json',
		validators: zod4(jobInputSchema),
		resetForm: false,
		onUpdate: async ({ form: validated }) => {
			if (!validated.valid) return;
			const data = validated.data;

			if (data.shifts.length === 0) {
				setError(validated, 'shifts._errors', 'ต้องเพิ่มกะย่อยอย่างน้อย 1 กะ');
				return;
			}
			const quota = totalShiftQuota(data.shifts);

			try {
				if (isEdit && job) {
					const claimed = job.slots_confirmed + job.slots_dispatched;
					if (quota < claimed) {
						setError(
							validated,
							'shifts._errors',
							`จำนวนรับรวม ${quota} คน น้อยกว่าที่รับไปแล้ว ${claimed} คน — กรุณาเพิ่มจำนวนรับหรือคงกะเดิมไว้`
						);
						return;
					}
					await updateMutation.mutateAsync({
						...job,
						title: data.title,
						description: data.description,
						tier: data.tier,
						required_roles: data.required_roles,
						// Persist master codes even if the form was hydrated with legacy
						// labels before Master Data answered (CR-100).
						skills_required: toSkillCodes(data.skills_required, skillsList),
						quota,
						slots_remaining: quota - claimed,
						shifts: data.shifts,
						auto_accept: data.auto_accept,
						is_urgent: data.is_urgent,
						status: data.status
					});
					toast.success(`บันทึกการแก้ไขงาน "${data.title}" แล้ว`);
				} else {
					await createMutation.mutateAsync(data);
					toast.success(`ประกาศงาน "${data.title}" แล้ว`);
				}
				open = false;
			} catch (err) {
				const message = err instanceof Error ? err.message : 'บันทึกงานไม่สำเร็จ';
				setError(validated, message);
				toast.error(message);
			}
		}
	});

	const { form: formData, errors, submitting } = form;

	let lastOpenedKey = $state<string | null>(null);

	// Shift builder local state
	let shiftMode = $state<'single' | 'batch'>('single');
	let singleDate = $state('');
	let singleEndDate = $state('');
	let singleStart = $state('08:00');
	let singleEnd = $state('16:00');
	let singleSeats = $state(5);
	let batchStart = $state('');
	let batchEnd = $state('');
	let batchStartTime = $state('08:00');
	let batchEndTime = $state('16:00');
	let batchSeats = $state(5);
	let batchWeekdays = $state<Weekday[]>([...ALL_WEEKDAYS]);

	const shifts = $derived($formData.shifts);
	const totalSeats = $derived(totalShiftQuota(shifts));
	const selectedSkillCount = $derived($formData.skills_required.length);

	const isPending = $derived($submitting || createMutation.isPending || updateMutation.isPending);

	// Rehydrate on open — the dialog instance is reused across create/edit
	// (same pattern as `people/ui/evacuee-personal-modal.svelte`).
	$effect(() => {
		if (!open) {
			lastOpenedKey = null;
			return;
		}
		const key = job?._id ?? 'create';
		if (lastOpenedKey === key) return;
		$formData = job ? valuesFromJob(job) : emptyValues();
		shiftMode = 'single';
		singleDate = '';
		batchStart = '';
		batchEnd = '';
		batchWeekdays = [...ALL_WEEKDAYS];
		lastOpenedKey = key;
	});

	/**
	 * Tick/untick one master skill. Comparison goes through the catalog, not
	 * string equality: the form may already hold a pre-CR-100 label (either
	 * from a legacy job or from a hydration that ran before Master Data
	 * answered), and that label must still tick — and untick — its card.
	 */
	function toggleSkill(code: string) {
		const current = $formData.skills_required;
		const held = current.filter((v) => toSkillCode(v, skillsList) === code);
		$formData.skills_required =
			held.length > 0 ? current.filter((v) => !held.includes(v)) : [...current, code];
	}

	function mergeShifts(incoming: JobShift[]) {
		const { shifts: merged, added, skipped } = appendShifts($formData.shifts, incoming);
		$formData.shifts = merged;
		if (added > 0) {
			toast.success(
				skipped > 0 ? `เพิ่ม ${added} กะ (ข้ามที่ซ้ำ ${skipped} กะ)` : `เพิ่ม ${added} กะแล้ว`
			);
		} else {
			toast.info('กะที่สร้างซ้ำกับรายการเดิมทั้งหมด');
		}
	}

	// Prefill the end date from the start date + times; a shift that crosses
	// midnight lands on the next day. Editable afterwards.
	$effect(() => {
		if (!singleDate) {
			singleEndDate = '';
			return;
		}
		singleEndDate = defaultShiftEndDate(singleDate, singleStart, singleEnd);
	});

	const canAddSingle = $derived(
		singleDate !== '' &&
			singleEndDate !== '' &&
			singleStart !== '' &&
			singleEnd !== '' &&
			Number.isInteger(singleSeats) &&
			singleSeats > 0
	);

	function addSingleShift() {
		if (!canAddSingle) return;
		const row: JobShift = {
			id: newShiftId(),
			date: singleDate,
			end_date: singleEndDate,
			start_time: singleStart,
			end_time: singleEnd,
			quota: singleSeats
		};
		if (`${row.end_date}T${row.end_time}` <= `${row.date}T${row.start_time}`) {
			toast.error('เวลาสิ้นสุดกะต้องอยู่หลังเวลาเริ่มกะ');
			return;
		}
		if (isDuplicateShift(row, $formData.shifts)) {
			toast.info('มีกะวันและเวลานี้อยู่แล้ว');
			return;
		}
		$formData.shifts = [...$formData.shifts, row];
		singleDate = '';
		singleEndDate = '';
	}

	const canGenerateBatch = $derived(
		batchStart !== '' &&
			batchEnd !== '' &&
			batchStartTime !== '' &&
			batchEndTime !== '' &&
			batchWeekdays.length > 0 &&
			Number.isInteger(batchSeats) &&
			batchSeats > 0
	);

	function generateBatch() {
		if (!canGenerateBatch) return;
		try {
			const rows = generateBatchShifts(
				{
					startDate: batchStart,
					endDate: batchEnd,
					weekdays: batchWeekdays,
					start_time: batchStartTime,
					end_time: batchEndTime,
					quota: batchSeats
				},
				() => newShiftId()
			);
			if (rows.length === 0) {
				toast.info('ไม่มีวันใดในช่วงที่เลือกตรงกับวันในสัปดาห์ที่เลือกไว้');
				return;
			}
			mergeShifts(rows);
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'สร้างชุดกะย่อยไม่สำเร็จ');
		}
	}

	function toggleWeekday(day: Weekday) {
		batchWeekdays = batchWeekdays.includes(day)
			? batchWeekdays.filter((d) => d !== day)
			: [...batchWeekdays, day];
	}

	/**
	 * Shift editing reopens the standalone `JobShiftEditDialog` used on the job
	 * detail tab — NOT inline in the row. It was inline at first, but editing a
	 * row changes that row's height while the surrounding scroll container is
	 * this dialog's own body: expanding a row near the bottom of a long list
	 * pushed content below the fold, and on at least one browser the layout
	 * shift jumped the scroll position back to the top of the form. A second
	 * `Dialog.Root` avoids that — bits-ui portals dialog content to
	 * `document.body`, so it never actually nests inside THIS dialog's DOM,
	 * and both stay independently scrollable.
	 */
	let editShiftId = $state<string | null>(null);
	let editShiftOpen = $state(false);

	const editShift = $derived($formData.shifts.find((s) => s.id === editShiftId) ?? null);
	/** Every OTHER row — the edit dialog's duplicate check must not match itself. */
	const editSiblings = $derived($formData.shifts.filter((s) => s.id !== editShiftId));

	/**
	 * Seats already held per PERSISTED shift, so editing an existing job cannot
	 * cut a shift below what volunteers hold. Keyed by shift id off the same
	 * chronological ordering `jobShiftQuotaSplits` assumes (it allocates
	 * "earliest shift first" BY POSITION, so it must be handed sorted rows).
	 * Empty while creating — a job that does not exist yet holds nothing.
	 */
	const heldSeatsById = $derived.by<Record<string, number>>(() => {
		if (!job) return {};
		const ordered = [...job.shifts].sort((a, b) =>
			`${a.date}T${a.start_time}`.localeCompare(`${b.date}T${b.start_time}`)
		);
		const splits = jobShiftQuotaSplits({ ...job, shifts: ordered });
		return Object.fromEntries(
			ordered.map((shift, index) => {
				const split = splits[index];
				return [shift.id, split ? split.confirmed + split.dispatched : 0];
			})
		);
	});

	const editMinQuota = $derived(editShiftId ? (heldSeatsById[editShiftId] ?? 0) : 0);

	function openEditShift(shift: JobShift) {
		editShiftId = shift.id;
		editShiftOpen = true;
	}

	/** Replace in place — row order drives the per-shift seat split. */
	function saveShiftEdit(updated: JobShift) {
		$formData.shifts = $formData.shifts.map((s) => (s.id === updated.id ? updated : s));
		editShiftOpen = false;
	}

	function removeShift(id: string) {
		if (editShiftId === id) editShiftOpen = false;
		$formData.shifts = $formData.shifts.filter((s) => s.id !== id);
	}

	function clearShifts() {
		$formData.shifts = [];
	}

	function handleOpenChange(next: boolean) {
		open = next;
	}
</script>

<Dialog.Root bind:open onOpenChange={handleOpenChange}>
	<Dialog.Content class="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-5xl">
		<div class="flex items-center gap-2 border-b border-border px-4 py-4 pr-12 sm:px-6">
			<Dialog.Title class="flex items-center gap-2 text-lg font-semibold">
				<Briefcase class="size-5 text-primary" />
				{isEdit ? 'แก้ไขภารกิจงานอาสา' : 'ประกาศภารกิจงานอาสาใหม่'}
			</Dialog.Title>
		</div>

		<form
			method="POST"
			use:form.enhance
			class="max-h-[70vh] space-y-6 overflow-y-auto px-4 py-5 sm:px-6"
		>
			<Form.Field {form} name="title">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>หัวข้อภารกิจอาสา <span class="text-destructive">*</span></Form.Label>
						<Input
							{...props}
							bind:value={$formData.title}
							class="!h-11"
							placeholder="เช่น ช่วยแจกจ่ายอาหารประจำวัน, สตาฟคัดกรองประชากร"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<Form.Field {form} name="description">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>
							รายละเอียดงาน / SOP เบื้องต้น <span class="text-destructive">*</span>
						</Form.Label>
						<Textarea
							{...props}
							bind:value={$formData.description}
							rows={3}
							placeholder="อธิบายภาระหน้าที่ ความปลอดภัย และสถานที่ปฏิบัติงานอย่างชัดเจน..."
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<div class="space-y-2">
				<span class="text-sm font-medium">ความด่วนของภารกิจ / URGENCY</span>
				<div class="grid grid-cols-2 gap-2">
					<Button
						type="button"
						variant="outline"
						class="!h-11 justify-center gap-1 {!$formData.is_urgent
							? 'border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100'
							: ''}"
						aria-pressed={!$formData.is_urgent}
						onclick={() => ($formData.is_urgent = false)}
					>
						🟢 งานทั่วไป <span class="hidden sm:inline">(Normal)</span>
					</Button>
					<Button
						type="button"
						variant="outline"
						class="!h-11 justify-center gap-1 {$formData.is_urgent
							? 'border-red-300 bg-red-50 text-red-700 hover:bg-red-100'
							: ''}"
						aria-pressed={$formData.is_urgent}
						onclick={() => ($formData.is_urgent = true)}
					>
						🚨 ด่วนพิเศษ <span class="hidden sm:inline">(Urgent)</span>
					</Button>
				</div>
			</div>

			<div class="space-y-2">
				<span class="text-sm font-medium">สถานะการรับสมัคร (LIFECYCLE STATUS)</span>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
					{#each STATUS_OPTIONS as option (option.value)}
						{@const selected = $formData.status === option.value}
						<Button
							type="button"
							variant="outline"
							class="!h-11 justify-center {selected ? option.selectedClass : ''}"
							aria-pressed={selected}
							onclick={() => ($formData.status = option.value)}
						>
							{option.label}
						</Button>
					{/each}
				</div>
				<p class="text-[11px] text-muted-foreground">
					ค่าที่เลือกที่นี่จะถูกบันทึกตามที่เลือก — ระบบจะปรับเป็น "เต็มโควตา" ให้เองก็ต่อเมื่อ
					โควตาถูกจองครบจริงในการมอบหมาย/ตอบรับครั้งถัดไป
				</p>
				<Form.Field {form} name="status">
					<Form.FieldErrors />
				</Form.Field>
			</div>

			<div class="space-y-2">
				<div class="flex items-center justify-between gap-2">
					<span class="text-sm font-medium">
						🧍 ทักษะที่ต้องการเป็นพิเศษ (VOLUNTEER SKILL MASTER LIST)
					</span>
					<Badge variant="secondary">เลือกแล้ว {selectedSkillCount} ทักษะ</Badge>
				</div>
				<p class="text-xs text-muted-foreground">
					คลิกเพื่อเลือกทักษะที่อ้างอิงจาก Master List
					(ระบบจะใช้ในการแมตช์และคัดกรองจิตอาสาที่มีทักษะรับรอง):
				</p>
				<div class="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-2">
					{#each skillsList as skill (skill.code)}
						{@const checked = $formData.skills_required.some(
							(v) => toSkillCode(v, skillsList) === skill.code
						)}
						<label
							class="flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors {checked
								? 'border-primary bg-primary/5'
								: 'border-border hover:bg-muted/40'}"
						>
							<Checkbox {checked} onCheckedChange={() => toggleSkill(skill.code)} />
							<span class="min-w-0 text-xs">
								<span class="flex items-center gap-1.5 font-medium">
									<span aria-hidden="true">{skill.icon}</span>
									<span class="truncate">{skill.label}</span>
									{#if skill.controlled}
										<Badge variant="outline" class="shrink-0 text-[10px]">🔒 ควบคุม</Badge>
									{/if}
								</span>
								<span class="mt-0.5 block text-muted-foreground">{skill.description}</span>
							</span>
						</label>
					{/each}
				</div>
				<Form.Field {form} name="skills_required">
					<Form.FieldErrors />
				</Form.Field>
			</div>

			<div class="space-y-3 rounded-xl border border-border p-4">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div class="min-w-0">
						<p class="text-sm font-semibold">📚 กำหนดกะย่อย (Shifts Schedule Configuration)</p>
						<p class="text-xs text-muted-foreground">
							เลือกโหมดการสร้างกะย่อย: เพิ่มทีละวัน หรือสร้างอัตโนมัติเป็นช่วงเวลาต่อเนื่อง
						</p>
					</div>
					<!-- Full-width 2-up on narrow screens; the English suffixes are the
					     first thing to go, since they only restate the Thai label. -->
					<div class="grid w-full grid-cols-2 gap-1 rounded-lg bg-muted p-1 sm:flex sm:w-auto">
						<Button
							type="button"
							size="sm"
							variant={shiftMode === 'single' ? 'default' : 'ghost'}
							class="w-full justify-center text-xs sm:w-auto"
							onclick={() => (shiftMode = 'single')}
						>
							<Plus class="mr-1 size-3.5 shrink-0" />
							<span class="truncate"
								>เพิ่มทีละวัน<span class="hidden lg:inline"> (Single)</span></span
							>
						</Button>
						<Button
							type="button"
							size="sm"
							variant={shiftMode === 'batch' ? 'default' : 'ghost'}
							class="w-full justify-center text-xs sm:w-auto"
							onclick={() => (shiftMode = 'batch')}
						>
							<Zap class="mr-1 size-3.5 shrink-0" />
							<span class="truncate">
								สร้างเป็นช่วงวัน<span class="hidden lg:inline"> (Batch Generator)</span>
							</span>
						</Button>
					</div>
				</div>

				{#if shiftMode === 'single'}
					<div class="grid items-end gap-3 rounded-lg border border-border p-3 sm:grid-cols-12">
						<label class="space-y-1 sm:col-span-3">
							<span class="text-xs font-medium">วันที่ทำงาน</span>
							<DatePicker bind:value={singleDate} />
						</label>
						<label class="space-y-1 sm:col-span-3">
							<span class="text-xs font-medium">วันที่สิ้นสุดกะ</span>
							<DatePicker bind:value={singleEndDate} />
						</label>
						<label class="space-y-1 sm:col-span-2">
							<span class="text-xs font-medium">เวลาเข้ากะ</span>
							<TimePicker bind:value={singleStart} />
						</label>
						<label class="space-y-1 sm:col-span-2">
							<span class="text-xs font-medium">เวลาออกกะ</span>
							<TimePicker bind:value={singleEnd} />
						</label>
						<label class="space-y-1 sm:col-span-2">
							<span class="text-xs font-medium">จำนวนรับ (คน)</span>
							<Input type="number" min="1" bind:value={singleSeats} class="!h-11" />
						</label>
						<Button
							type="button"
							class="!h-11 sm:col-span-2 sm:col-start-11"
							disabled={!canAddSingle}
							onclick={addSingleShift}
						>
							<Plus class="mr-1 size-4" /> เพิ่มกะ
						</Button>
					</div>
				{:else}
					<div class="space-y-3 rounded-lg border border-border p-3">
						<div class="grid gap-3 sm:grid-cols-2">
							<label class="space-y-1">
								<span class="text-xs font-medium">📅 วันที่เริ่มสร้างกะ (Start Date)</span>
								<DatePicker bind:value={batchStart} />
							</label>
							<label class="space-y-1">
								<span class="text-xs font-medium">🏁 วันที่สิ้นสุดกะ (End Date)</span>
								<DatePicker bind:value={batchEnd} />
							</label>
						</div>
						<div class="grid gap-3 sm:grid-cols-3">
							<label class="space-y-1">
								<span class="text-xs font-medium">⏰ เวลาเข้ากะ (Start)</span>
								<TimePicker bind:value={batchStartTime} />
							</label>
							<label class="space-y-1">
								<span class="text-xs font-medium">⏰ เวลาออกกะ (End)</span>
								<TimePicker bind:value={batchEndTime} />
							</label>
							<label class="space-y-1">
								<span class="text-xs font-medium">👥 จำนวนคนต่อกะ (Seats)</span>
								<Input type="number" min="1" bind:value={batchSeats} class="!h-11" />
							</label>
						</div>

						<div class="space-y-2">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<span class="text-xs font-medium">📅 วันในสัปดาห์ที่ต้องการเปิดกะ</span>
								<div class="flex flex-wrap gap-1">
									<Button
										type="button"
										size="sm"
										variant="ghost"
										class="text-primary"
										onclick={() => (batchWeekdays = [...ALL_WEEKDAYS])}
									>
										ทุกวัน
									</Button>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										class="text-primary"
										onclick={() => (batchWeekdays = [...WEEKDAYS_MON_FRI])}
									>
										จันทร์ - ศุกร์
									</Button>
									<Button
										type="button"
										size="sm"
										variant="ghost"
										class="text-amber-600"
										onclick={() => (batchWeekdays = [...WEEKENDS])}
									>
										เสาร์ - อาทิตย์
									</Button>
								</div>
							</div>
							<div class="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
								{#each WEEKDAYS as day (day.value)}
									{@const active = batchWeekdays.includes(day.value)}
									<Button
										type="button"
										size="sm"
										variant={active ? 'default' : 'outline'}
										aria-pressed={active}
										class="w-full justify-center px-1 text-xs"
										onclick={() => toggleWeekday(day.value)}
									>
										{#if active}<Check class="mr-1 size-3" />{/if}
										{day.label}
									</Button>
								{/each}
							</div>
						</div>

						<Button
							type="button"
							class="!h-11 w-full"
							disabled={!canGenerateBatch}
							onclick={generateBatch}
						>
							<Zap class="mr-1 size-4 shrink-0" />
							<span class="sm:hidden">สร้างชุดกะย่อย</span>
							<span class="hidden sm:inline">ประมวลผลสร้างชุดกะย่อย (Generate Batch Shifts)</span>
						</Button>
					</div>
				{/if}

				<div class="space-y-2">
					<div class="flex items-center justify-between gap-2">
						<span class="text-xs font-medium">📋 รายการกะย่อยทั้งหมด ({shifts.length} กะ)</span>
						{#if shifts.length > 0}
							<button
								type="button"
								class="text-xs font-medium text-destructive hover:underline"
								onclick={clearShifts}
							>
								ลบทั้งหมด ({shifts.length})
							</button>
						{/if}
					</div>

					{#if shifts.length === 0}
						<p
							class="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground"
						>
							ยังไม่มีกะย่อย — เพิ่มอย่างน้อย 1 กะก่อนบันทึก
						</p>
					{:else}
						<ul class="max-h-72 space-y-2 overflow-y-auto pr-1">
							{#each shifts as shift, index (shift.id)}
								<li
									class="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-xl border border-border bg-muted/20 px-4 py-3 text-sm"
								>
									<span
										class="flex size-7 shrink-0 items-center justify-center rounded-full bg-background text-xs font-semibold text-muted-foreground"
									>
										{index + 1}
									</span>
									<span class="font-semibold text-primary">📅 {shift.date}</span>
									<span class="hidden text-muted-foreground/50 sm:inline">|</span>
									<span class="font-semibold text-destructive">
										⏰ {shift.start_time} - {shift.end_time}
									</span>
									{#if shift.end_date !== shift.date}
										<Badge variant="outline" class="shrink-0 text-[10px]">
											ถึง {shift.end_date}
										</Badge>
									{/if}
									<span class="hidden text-muted-foreground/50 sm:inline">|</span>
									<span class="font-semibold text-emerald-600">👥 รับ {shift.quota} คน</span>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										class="ml-auto shrink-0 text-muted-foreground hover:text-foreground"
										aria-label={`แก้ไขกะวันที่ ${shift.date}`}
										onclick={() => openEditShift(shift)}
									>
										<Pencil class="size-3.5" />
									</Button>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										class="shrink-0 text-muted-foreground hover:text-destructive"
										aria-label={`ลบกะวันที่ ${shift.date}`}
										onclick={() => removeShift(shift.id)}
									>
										<X class="size-4" />
									</Button>
								</li>
							{/each}
						</ul>
						<p class="text-right text-xs text-muted-foreground">
							รวมจำนวนรับทั้งงาน <span class="font-semibold text-foreground">{totalSeats}</span> คน
						</p>
					{/if}
					<Form.Field {form} name="shifts">
						<Form.FieldErrors />
					</Form.Field>
				</div>
			</div>

			{#if $errors._errors && $errors._errors.length > 0}
				<p class="text-sm font-medium text-destructive">{$errors._errors.join(', ')}</p>
			{/if}
		</form>

		<div
			class="flex flex-col-reverse gap-2 border-t border-border px-4 py-4 sm:flex-row sm:items-center sm:justify-end sm:px-6"
		>
			<Button
				type="button"
				variant="ghost"
				class="w-full sm:w-auto"
				onclick={() => handleOpenChange(false)}
			>
				ยกเลิก
			</Button>
			<Button
				type="submit"
				class="!h-11 w-full sm:w-auto sm:min-w-[220px]"
				disabled={isPending}
				onclick={() => form.submit()}
			>
				{#if isPending}
					กำลังบันทึก...
				{:else}
					<Check class="mr-1 size-4" />
					<span class="sm:hidden">{isEdit ? 'บันทึกการแก้ไข' : 'บันทึกและเผยแพร่'}</span>
					<span class="hidden sm:inline"
						>{isEdit ? 'บันทึกการแก้ไข' : 'บันทึกและเผยแพร่ (Save & Post)'}</span
					>
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>

<JobShiftEditDialog
	bind:open={editShiftOpen}
	shift={editShift}
	siblings={editSiblings}
	minQuota={editMinQuota}
	onsave={saveShiftEdit}
/>
