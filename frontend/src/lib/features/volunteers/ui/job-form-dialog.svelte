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
	 * Capacity comes from the sub-shift rows (`shifts[]`, schema_v 3): the job's
	 * `quota` is their headcount sum, so there is no separate total to keep in
	 * sync. Rows are added one at a time or generated over a date range by
	 * `domain/shift-batch.ts`, which is pure and unit-tested.
	 */
	import { defaults, superForm, setError } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import { useQueryClient } from '@tanstack/svelte-query';
	import { z } from 'zod';
	import X from '@lucide/svelte/icons/x';
	import Plus from '@lucide/svelte/icons/plus';
	import Zap from '@lucide/svelte/icons/zap';
	import Briefcase from '@lucide/svelte/icons/briefcase';
	import Check from '@lucide/svelte/icons/check';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Separator } from '$lib/components/ui/separator/index.js';
	import { ulid } from '$lib/db/ulid';
	import { jobInputSchema, totalShiftQuota } from '../domain/job.schema';
	import type { Job, JobShift } from '../domain/job.schema';
	import { SKILL_MASTER } from '../domain/skill-master';
	import {
		ALL_WEEKDAYS,
		WEEKDAYS,
		WEEKDAYS_MON_FRI,
		WEEKENDS,
		appendShifts,
		generateBatchShifts,
		isDuplicateShift,
		type Weekday
	} from '../domain/shift-batch';
	import { useCreateJob, useUpdateJob } from '../application/queries';

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

	const isEdit = $derived(job !== null);

	/**
	 * LIFECYCLE STATUS control. `almost_full` is absent by design — only
	 * `deriveJobStatus` produces it, and it will overwrite `full` too on the
	 * next dispatch/accept/decline.
	 */
	const STATUS_OPTIONS: { value: JobFormValues['status']; label: string }[] = [
		{ value: 'draft', label: 'ร่าง' },
		{ value: 'open', label: 'เปิดรับ' },
		{ value: 'paused', label: 'พักรับ' },
		{ value: 'full', label: 'เต็มโควตา' },
		{ value: 'closed', label: 'ปิดงาน' }
	];

	const TIER_OPTIONS: { value: 'operational' | 'staff-capable'; label: string }[] = [
		{ value: 'operational', label: 'งานปฏิบัติการ (ไม่ต้องมีบัญชีระบบ)' },
		{ value: 'staff-capable', label: 'งานช่วยงานระบบ (ต้องได้รับสิทธิ์หลังบ้าน)' }
	];

	const selectTriggerClass =
		"flex !h-11 w-full items-center rounded-md border border-input bg-background px-3 text-sm font-medium shadow-xs focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-placeholder:text-muted-foreground [&_svg]:self-center [&_svg:not([class*='size-'])]:size-4";

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
			skills_required: [...(source.skills_required ?? [])],
			shifts: source.shifts.map((s) => ({ ...s })),
			auto_accept: source.auto_accept,
			is_urgent: source.is_urgent,
			// `almost_full`/`cancelled` are not choosable on this control — show the
			// nearest editable state and let `deriveJobStatus` reassert itself.
			status: STATUS_OPTIONS.some((o) => o.value === source.status)
				? (source.status as JobFormValues['status'])
				: 'open'
		};
	}

	const form = superForm(defaults(emptyValues(), zod4(jobInputSchema)), {
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
						skills_required: data.skills_required,
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

	let newRole = $state('');
	let lastOpenedKey = $state<string | null>(null);

	// Shift builder local state
	let shiftMode = $state<'single' | 'batch'>('single');
	let singleDate = $state('');
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
		newRole = '';
		shiftMode = 'single';
		singleDate = '';
		batchStart = '';
		batchEnd = '';
		batchWeekdays = [...ALL_WEEKDAYS];
		lastOpenedKey = key;
	});

	// F-AUTO: force auto_accept off the instant tier becomes staff-capable, so a
	// tainted `true` from before the tier switch can never reach submit.
	$effect(() => {
		if ($formData.tier === 'staff-capable' && $formData.auto_accept) {
			$formData.auto_accept = false;
		}
	});

	function toggleSkill(key: string) {
		const current = $formData.skills_required;
		$formData.skills_required = current.includes(key)
			? current.filter((s) => s !== key)
			: [...current, key];
	}

	function addRole() {
		const value = newRole.trim();
		if (!value || $formData.required_roles.includes(value)) return;
		$formData.required_roles = [...$formData.required_roles, value];
		newRole = '';
	}

	function removeRole(role: string) {
		$formData.required_roles = $formData.required_roles.filter((r) => r !== role);
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

	const canAddSingle = $derived(
		singleDate !== '' &&
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
			start_time: singleStart,
			end_time: singleEnd,
			quota: singleSeats
		};
		if (isDuplicateShift(row, $formData.shifts)) {
			toast.info('มีกะวันและเวลานี้อยู่แล้ว');
			return;
		}
		$formData.shifts = [...$formData.shifts, row];
		singleDate = '';
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

	function removeShift(id: string) {
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
	<Dialog.Content class="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
		<div class="flex items-center gap-2 border-b border-border px-6 py-4 pr-12">
			<Dialog.Title class="flex items-center gap-2 text-lg font-semibold">
				<Briefcase class="size-5 text-primary" />
				{isEdit ? 'แก้ไขภารกิจงานอาสา' : 'ประกาศภารกิจงานอาสาใหม่'}
			</Dialog.Title>
		</div>

		<form method="POST" use:form.enhance class="max-h-[70vh] space-y-6 overflow-y-auto px-6 py-5">
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
						variant={$formData.is_urgent ? 'outline' : 'secondary'}
						class="!h-11 justify-center"
						aria-pressed={!$formData.is_urgent}
						onclick={() => ($formData.is_urgent = false)}
					>
						🟢 งานทั่วไป (Normal)
					</Button>
					<Button
						type="button"
						variant={$formData.is_urgent ? 'secondary' : 'outline'}
						class="!h-11 justify-center {$formData.is_urgent
							? 'border-destructive/40 text-destructive'
							: ''}"
						aria-pressed={$formData.is_urgent}
						onclick={() => ($formData.is_urgent = true)}
					>
						🚨 ด่วนพิเศษ (Urgent)
					</Button>
				</div>
			</div>

			<div class="space-y-2">
				<span class="text-sm font-medium">สถานะการรับสมัคร (LIFECYCLE STATUS)</span>
				<div class="grid grid-cols-2 gap-2 sm:grid-cols-5">
					{#each STATUS_OPTIONS as option (option.value)}
						<Button
							type="button"
							variant={$formData.status === option.value ? 'secondary' : 'outline'}
							class="!h-11 justify-center {$formData.status === option.value
								? 'border-primary text-primary'
								: ''}"
							aria-pressed={$formData.status === option.value}
							onclick={() => ($formData.status = option.value)}
						>
							{option.label}
						</Button>
					{/each}
				</div>
				<p class="text-[11px] text-muted-foreground">
					"เต็มโควตา" และ "ใกล้เต็ม" ปกติระบบคำนวณให้อัตโนมัติจากโควตาที่รับไปแล้ว —
					ค่าที่เลือกไว้ที่นี่จะถูกคำนวณใหม่เมื่อมีการมอบหมาย/ตอบรับ/ปฏิเสธงานครั้งถัดไป
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
					{#each SKILL_MASTER as skill (skill.key)}
						{@const checked = $formData.skills_required.includes(skill.key)}
						<label
							class="flex cursor-pointer items-start gap-2 rounded-lg border p-3 transition-colors {checked
								? 'border-primary bg-primary/5'
								: 'border-border hover:bg-muted/40'}"
						>
							<Checkbox {checked} onCheckedChange={() => toggleSkill(skill.key)} />
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

			<Separator />

			<div class="grid gap-4 sm:grid-cols-2">
				<Form.Field {form} name="tier">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>ระดับงาน (TIER)</Form.Label>
							<Select.Root type="single" bind:value={$formData.tier}>
								<Select.Trigger {...props} class={selectTriggerClass}>
									{TIER_OPTIONS.find((o) => o.value === $formData.tier)?.label ??
										'— เลือกระดับงาน —'}
								</Select.Trigger>
								<Select.Content>
									{#each TIER_OPTIONS as opt (opt.value)}
										<Select.Item value={opt.value} label={opt.label} />
									{/each}
								</Select.Content>
							</Select.Root>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<div class="space-y-1.5">
					<span class="text-sm font-medium">การตอบรับอัตโนมัติ</span>
					<label
						class="flex h-11 items-center gap-2 rounded-md border border-input px-3 {$formData.tier ===
						'staff-capable'
							? 'opacity-60'
							: ''}"
					>
						<Checkbox
							bind:checked={$formData.auto_accept}
							disabled={$formData.tier === 'staff-capable'}
						/>
						<span class="text-xs">
							ตอบรับผู้สมัครทันที (auto-accept)
							{#if $formData.tier === 'staff-capable'}
								<span class="block text-muted-foreground">งานช่วยงานระบบต้องผ่านการอนุมัติเสมอ</span
								>
							{/if}
						</span>
					</label>
					<Form.Field {form} name="auto_accept">
						<Form.FieldErrors />
					</Form.Field>
				</div>
			</div>

			{#if $formData.tier === 'staff-capable'}
				<div class="space-y-1.5">
					<span class="text-sm font-medium">สิทธิ์ระบบที่ต้องได้รับ (required_roles)</span>
					<div class="flex gap-2">
						<Input
							bind:value={newRole}
							class="!h-11"
							placeholder="เช่น registration_staff"
							onkeydown={(e: KeyboardEvent) => {
								if (e.key === 'Enter') {
									e.preventDefault();
									addRole();
								}
							}}
						/>
						<Button type="button" variant="secondary" class="!h-11" onclick={addRole}>เพิ่ม</Button>
					</div>
					{#if $formData.required_roles.length > 0}
						<div class="flex flex-wrap gap-1.5">
							{#each $formData.required_roles as role (role)}
								<Badge variant="secondary" class="gap-1">
									{role}
									<button type="button" aria-label={`ลบ ${role}`} onclick={() => removeRole(role)}>
										<X class="size-3" />
									</button>
								</Badge>
							{/each}
						</div>
					{/if}
					<Form.Field {form} name="required_roles">
						<Form.FieldErrors />
					</Form.Field>
				</div>
			{/if}

			<div class="space-y-3 rounded-xl border border-border p-4">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<p class="text-sm font-semibold">📚 กำหนดกะย่อย (Shifts Schedule Configuration)</p>
						<p class="text-xs text-muted-foreground">
							เลือกโหมดการสร้างกะย่อย: เพิ่มทีละวัน หรือสร้างอัตโนมัติเป็นช่วงเวลาต่อเนื่อง
						</p>
					</div>
					<div class="flex gap-1 rounded-lg bg-muted p-1">
						<Button
							type="button"
							size="sm"
							variant={shiftMode === 'single' ? 'default' : 'ghost'}
							onclick={() => (shiftMode = 'single')}
						>
							<Plus class="mr-1 size-3.5" /> เพิ่มทีละวัน (Single)
						</Button>
						<Button
							type="button"
							size="sm"
							variant={shiftMode === 'batch' ? 'default' : 'ghost'}
							onclick={() => (shiftMode = 'batch')}
						>
							<Zap class="mr-1 size-3.5" /> สร้างเป็นช่วงวัน (Batch Generator)
						</Button>
					</div>
				</div>

				{#if shiftMode === 'single'}
					<div class="grid items-end gap-3 rounded-lg border border-border p-3 sm:grid-cols-9">
						<label class="space-y-1 sm:col-span-3">
							<span class="text-xs font-medium">วันที่ทำงาน</span>
							<Input type="date" bind:value={singleDate} class="!h-11" />
						</label>
						<label class="space-y-1 sm:col-span-2">
							<span class="text-xs font-medium">เวลาเข้ากะ</span>
							<Input type="time" bind:value={singleStart} class="!h-11" />
						</label>
						<label class="space-y-1 sm:col-span-2">
							<span class="text-xs font-medium">เวลาออกกะ</span>
							<Input type="time" bind:value={singleEnd} class="!h-11" />
						</label>
						<label class="space-y-1 sm:col-span-1">
							<span class="text-xs font-medium">จำนวนรับ (คน)</span>
							<Input type="number" min="1" bind:value={singleSeats} class="!h-11" />
						</label>
						<Button
							type="button"
							class="!h-11 sm:col-span-1"
							disabled={!canAddSingle}
							aria-label="เพิ่มกะย่อย"
							onclick={addSingleShift}
						>
							<Plus class="size-4" />
						</Button>
					</div>
				{:else}
					<div class="space-y-3 rounded-lg border border-border p-3">
						<div class="grid gap-3 sm:grid-cols-2">
							<label class="space-y-1">
								<span class="text-xs font-medium">📅 วันที่เริ่มสร้างกะ (Start Date)</span>
								<Input type="date" bind:value={batchStart} class="!h-11" />
							</label>
							<label class="space-y-1">
								<span class="text-xs font-medium">🏁 วันที่สิ้นสุดกะ (End Date)</span>
								<Input type="date" bind:value={batchEnd} class="!h-11" />
							</label>
						</div>
						<div class="grid gap-3 sm:grid-cols-3">
							<label class="space-y-1">
								<span class="text-xs font-medium">⏰ เวลาเข้ากะ (Start)</span>
								<Input type="time" bind:value={batchStartTime} class="!h-11" />
							</label>
							<label class="space-y-1">
								<span class="text-xs font-medium">⏰ เวลาออกกะ (End)</span>
								<Input type="time" bind:value={batchEndTime} class="!h-11" />
							</label>
							<label class="space-y-1">
								<span class="text-xs font-medium">👥 จำนวนคนต่อกะ (Seats)</span>
								<Input type="number" min="1" bind:value={batchSeats} class="!h-11" />
							</label>
						</div>

						<div class="space-y-2">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<span class="text-xs font-medium">📅 วันในสัปดาห์ที่ต้องการเปิดกะ</span>
								<div class="flex gap-1">
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
							<div class="flex flex-wrap gap-2">
								{#each WEEKDAYS as day (day.value)}
									{@const active = batchWeekdays.includes(day.value)}
									<Button
										type="button"
										size="sm"
										variant={active ? 'default' : 'outline'}
										aria-pressed={active}
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
							<Zap class="mr-1 size-4" /> ประมวลผลสร้างชุดกะย่อย (Generate Batch Shifts)
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
						<ul class="space-y-1.5">
							{#each shifts as shift, index (shift.id)}
								<li
									class="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs"
								>
									<span class="text-muted-foreground">#{index + 1}</span>
									<span class="font-semibold text-primary">📅 {shift.date}</span>
									<span class="text-muted-foreground">|</span>
									<span class="font-semibold text-destructive">
										⏰ {shift.start_time} - {shift.end_time}
									</span>
									<span class="text-muted-foreground">|</span>
									<span class="font-semibold text-emerald-600">👥 รับ {shift.quota} คน</span>
									<button
										type="button"
										class="ml-auto text-muted-foreground hover:text-destructive"
										aria-label={`ลบกะวันที่ ${shift.date}`}
										onclick={() => removeShift(shift.id)}
									>
										<X class="size-4" />
									</button>
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

		<div class="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
			<Button type="button" variant="ghost" onclick={() => handleOpenChange(false)}>ยกเลิก</Button>
			<Button
				type="submit"
				class="!h-11 min-w-[220px]"
				disabled={isPending}
				onclick={() => form.submit()}
			>
				{#if isPending}
					กำลังบันทึก...
				{:else}
					<Check class="mr-1 size-4" />
					{isEdit ? 'บันทึกการแก้ไข' : 'บันทึกและเผยแพร่ (Save & Post)'}
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
