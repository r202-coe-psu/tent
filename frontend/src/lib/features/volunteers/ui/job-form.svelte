<script lang="ts">
	/**
	 * Job create/edit form — "ประกาศงานอาสาสมัครใหม่"
	 * (CR-094 FR-VOL-09.1/09.5, 01-tab-job-board.md §01.4). Rendered on its own
	 * page (`job-create-page.svelte` / `job-edit-page.svelte`, #639) rather than in
	 * a modal: the form is long, and a stray click outside a modal lost the input.
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
	import { beforeNavigate } from '$app/navigation';
	import { defaults, superForm, setError } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { z } from 'zod';
	import Check from '@lucide/svelte/icons/check';
	import * as Form from '$lib/components/ui/form/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { ulid } from '$lib/db/ulid';
	import { errorMessage } from '$lib/utils/errors';
	import { jobInputSchema, totalShiftQuota } from '../domain/job.schema';
	import type { Job } from '../domain/job.schema';
	import { toSkillCode, toSkillCodes } from '../domain/skill-catalog';
	import { assignmentCountForShift } from '../domain/shift-roster';
	import { firstShiftCardError, shiftCardErrors } from '../domain/shift-draft';
	import ShiftCardList from './shift-card-list.svelte';
	import {
		useCreateJob,
		useShiftAssignments,
		useSkillOptions,
		useUpdateJob
	} from '../application/queries';

	/** Superforms holds the schema's OUTPUT shape — defaults already materialised. */
	type JobFormValues = z.output<typeof jobInputSchema>;

	let {
		job = null,
		oncancel,
		onsaved
	}: {
		/**
		 * The job being edited (`null` = create). The edit page mounts this form only
		 * once the job has loaded, so the initial values are read once at setup; later
		 * refetches still update `job` (fresh `_rev` and claimed seats for the save)
		 * without overwriting what the user has typed.
		 */
		job?: Job | null;
		oncancel: () => void;
		/**
		 * Called with the saved job once the create/update mutation resolves. The
		 * leave warning is already off by then, so the caller may navigate away.
		 */
		onsaved: (saved: Job) => void;
	} = $props();

	const queryClient = useQueryClient();
	const createMutation = useCreateJob(queryClient);
	const updateMutation = useUpdateJob(queryClient);
	const assignmentsQuery = useShiftAssignments();

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
	 * Explicit `id`: without one, Superforms derives an id from the schema shape,
	 * and the create page and a job's edit page share `jobInputSchema` — they can
	 * both be mounted for a beat during a client-side navigation and collide
	 * ("Duplicate form id's found"). Each job gets its own id; create gets a fixed one.
	 */
	// `untrack`: the initial values and id are read once at setup, not as a reactive
	// dependency — `job` is swapped for a fresh object on every refetch.
	const initialJob = untrack(() => job);
	const form = superForm(
		defaults(initialJob ? valuesFromJob(initialJob) : emptyValues(), zod4(jobInputSchema)),
		{
			id: initialJob ? `volunteer-job-edit-${initialJob._id}` : 'volunteer-job-create',
			SPA: true,
			// Client-only form (data comes from TanStack Query, not a SvelteKit load):
			// with `SPA: true` Superforms would still `invalidateAll()` + `applyAction()`
			// after a successful submit, which cancels the navigation `onsaved` starts.
			invalidateAll: false,
			applyAction: false,
			dataType: 'json',
			validators: zod4(jobInputSchema),
			resetForm: false,
			onUpdate: async ({ form: validated }) => {
				const data = validated.data;

				// Shift problems first, named by card ("กะที่ 2: …"), so the toast points
				// at the card that is red — the schema alone would only say "invalid".
				const shiftProblem =
					data.shifts.length === 0
						? 'ต้องเพิ่มกะย่อยอย่างน้อย 1 กะ'
						: firstShiftCardError(
								data.shifts,
								shiftCardErrors(data.shifts, { minQuotaById: heldSeatsById })
							);
				if (shiftProblem) {
					showShiftErrors = true;
					setError(validated, 'shifts._errors', shiftProblem);
					toast.error(`บันทึกไม่ได้ — ${shiftProblem}`);
					return;
				}
				if (!validated.valid) {
					toast.error(`บันทึกไม่ได้ — ${firstFieldError(validated.errors)}`);
					return;
				}
				const quota = totalShiftQuota(data.shifts);
				let saved: Job;

				try {
					if (isEdit && job) {
						const claimed = job.slots_confirmed + job.slots_dispatched;
						if (quota < claimed) {
							const message = `จำนวนรับรวม ${quota} คน น้อยกว่าที่รับไปแล้ว ${claimed} คน — กรุณาเพิ่มจำนวนรับหรือคงกะเดิมไว้`;
							setError(validated, 'shifts._errors', message);
							toast.error(`บันทึกไม่ได้ — ${message}`);
							return;
						}
						saved = await updateMutation.mutateAsync({
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
						saved = await createMutation.mutateAsync(data);
						toast.success(`ประกาศงาน "${data.title}" แล้ว`);
					}
					savedOnce = true;
					onsaved(saved);
				} catch (err) {
					const message = errorMessage(err);
					setError(validated, message);
					toast.error(`บันทึกงานไม่สำเร็จ: ${message}`);
				}
			}
		}
	);

	const { form: formData, errors, submitting } = form;

	/** Set by a save attempt — from then on every shift card shows its error. */
	let showShiftErrors = $state(false);

	/** First field message for the toast when the rest of the form is invalid. */
	function firstFieldError(fieldErrors: typeof $errors): string {
		return (
			fieldErrors.title?.[0] ??
			fieldErrors.description?.[0] ??
			'กรอกข้อมูลไม่ครบ — ตรวจสอบช่องที่มีข้อความสีแดง'
		);
	}
	const selectedSkillCount = $derived($formData.skills_required.length);

	const isPending = $derived($submitting || createMutation.isPending || updateMutation.isPending);

	/** Set once the save resolves, so the navigation that follows skips the warning. */
	let savedOnce = false;

	// Ask before leaving with unsaved changes — the reason this form left its modal
	// (#639): a stray click outside it used to throw the input away.
	beforeNavigate((nav) => {
		if (savedOnce || !form.isTainted()) return;
		// Refresh / closing the tab: the browser shows its own prompt when cancelled.
		if (nav.type === 'leave') {
			nav.cancel();
			return;
		}
		if (!confirm('มีข้อมูลที่ยังไม่ได้บันทึก ต้องการออกจากหน้านี้หรือไม่?')) nav.cancel();
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

	/**
	 * Seats already held per PERSISTED shift, so editing an existing job cannot
	 * cut a shift below what volunteers hold. This must use the concrete roster;
	 * job-level counters cannot tell which sub-shift owns a confirmed seat.
	 * Empty while creating — a job that does not exist yet holds nothing.
	 */
	const heldSeatsById = $derived.by<Record<string, number>>(() => {
		if (!job || !assignmentsQuery.data) return {};
		return Object.fromEntries(
			job.shifts.map((shift) => [
				shift.id,
				assignmentCountForShift(shift, job._id, assignmentsQuery.data ?? [])
			])
		);
	});

	/**
	 * Editing an existing job must not unlock the cards before the roster is in:
	 * until then `heldSeatsById` is empty and a held shift could be cut or removed.
	 */
	const shiftsLocked = $derived(
		isPending || (isEdit && (assignmentsQuery.isPending || assignmentsQuery.isError))
	);
</script>

{#snippet jobFormFields()}
	<form method="POST" use:form.enhance class="space-y-6 px-4 py-5 sm:px-6">
		<Form.Field {form} name="title">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>หัวข้องานอาสาสมัคร <span class="text-destructive">*</span></Form.Label>
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
			<span class="text-sm font-medium">ความด่วนของงานอาสาสมัคร / URGENCY</span>
			<div class="grid grid-cols-2 gap-2">
				<Button
					type="button"
					variant="outline"
					class="min-h-11 justify-center gap-1 {!$formData.is_urgent
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
					class="min-h-11 justify-center gap-1 {$formData.is_urgent
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
			<div class="grid grid-cols-2 gap-2 md:grid-cols-5">
				{#each STATUS_OPTIONS as option (option.value)}
					{@const selected = $formData.status === option.value}
					<Button
						type="button"
						variant="outline"
						class="min-h-11 justify-center {selected ? option.selectedClass : ''}"
						aria-pressed={selected}
						onclick={() => ($formData.status = option.value)}
					>
						{option.label}
					</Button>
				{/each}
			</div>
			<p class="text-xs text-muted-foreground">
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
			<div class="grid grid-cols-1 gap-2 rounded-xl border border-border p-3 md:grid-cols-2">
				{#each skillsList as skill (skill.code)}
					{@const checked = $formData.skills_required.some(
						(v) => toSkillCode(v, skillsList) === skill.code
					)}
					<label
						class="flex min-h-11 cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors {checked
							? 'border-primary bg-primary/5'
							: 'border-border hover:bg-muted/40'}"
					>
						<Checkbox {checked} onCheckedChange={() => toggleSkill(skill.code)} />
						<span class="min-w-0 text-xs">
							<span class="flex items-center gap-1.5 font-medium">
								<span aria-hidden="true">{skill.icon}</span>
								<span class="truncate">{skill.label}</span>
								{#if skill.controlled}
									<Badge variant="outline" class="shrink-0 text-xs">🔒 ควบคุม</Badge>
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
			<div class="min-w-0">
				<p class="text-sm font-semibold">📚 กำหนดกะย่อย (Shifts Schedule Configuration)</p>
				<p class="text-sm text-muted-foreground">
					แต่ละกะแก้ไขได้ในการ์ด — กด "เพิ่มกะ" เพื่อเพิ่มทีละกะ หรือสร้างหลายกะตามช่วงวัน
				</p>
			</div>

			{#if isEdit && assignmentsQuery.isError}
				<p class="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
					โหลดรายชื่ออาสาที่ถือที่นั่งไม่สำเร็จ — แก้ไขกะได้หลังโหลดหน้าใหม่
				</p>
			{/if}

			<ShiftCardList
				bind:shifts={$formData.shifts}
				minQuotaById={heldSeatsById}
				showAllErrors={showShiftErrors}
				idFactory={newShiftId}
				disabled={shiftsLocked}
				emptyHint="ยังไม่มีกะย่อย — เพิ่มอย่างน้อย 1 กะก่อนบันทึก"
			/>
			<Form.Field {form} name="shifts">
				<Form.FieldErrors />
			</Form.Field>
		</div>

		{#if $errors._errors && $errors._errors.length > 0}
			<p class="text-sm font-medium text-destructive">{$errors._errors.join(', ')}</p>
		{/if}
	</form>
{/snippet}

{#snippet jobFormActions()}
	<div
		class="flex flex-col-reverse gap-2 border-t border-border px-4 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:items-center sm:justify-end sm:px-6"
	>
		<Button type="button" variant="ghost" class="min-h-11 w-full sm:w-auto" onclick={oncancel}>
			ยกเลิก
		</Button>
		<Button
			type="submit"
			class="min-h-11 w-full sm:w-auto sm:min-w-[220px]"
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
{/snippet}

<div class="rounded-xl border border-slate-200/80 bg-white shadow-2xs">
	{@render jobFormFields()}
</div>

<!-- Sticky so Save stays in reach at the end of a long shift list, on phones too. -->
<div
	class="sticky bottom-0 z-10 mt-4 rounded-xl border border-slate-200/80 bg-white/95 shadow-xs backdrop-blur"
>
	{@render jobFormActions()}
</div>
