<script lang="ts">
	/**
	 * "People" tab search + filter row (owner-approved mockup, 2026-08-28).
	 *
	 * `search`/`skill`/`shiftStatus`/`source` are wired to real data: `search`
	 * and `source` map onto `VolunteerFilter` (`data/volunteer.repository.ts`)
	 * and re-query the server; `skill` and `shiftStatus` filter the already-
	 * fetched list client-side (there is no server-side index for either).
	 *
	 * "ทุกศูนย์พักพิง" stays single-option/disabled — flagged for a CR, not
	 * wired: `volunteerRepository().list()` only ever reads the *active*
	 * shelter's CouchDB (`getShelterDb()`, per CONTRIBUTING.md §4 remote-first
	 * model) — there is no cross-shelter roster query to back a shelter
	 * picker here.
	 *
	 * "บุคลากร" (personnel type) filters on `volunteer.personnel_type`
	 * (CR-095, schema_v 3) client-side, same pattern as `source`.
	 */
	import Search from '@lucide/svelte/icons/search';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { useSkillOptions } from '../application/queries';
	import { shiftAssignmentStatusSchema } from '../domain/shift-assignment.schema';
	import {
		volunteerSourceSchema,
		personnelTypeSchema,
		type VolunteerSource,
		type PersonnelType
	} from '../domain/volunteer.schema';
	import type { ShiftAssignmentStatus } from '../domain/shift-assignment.schema';

	let {
		search = $bindable(''),
		skill = $bindable(''),
		shiftStatus = $bindable<ShiftAssignmentStatus | ''>(''),
		source = $bindable<VolunteerSource | ''>(''),
		personnelType = $bindable<PersonnelType | ''>('')
	}: {
		search?: string;
		skill?: string;
		shiftStatus?: ShiftAssignmentStatus | '';
		source?: VolunteerSource | '';
		personnelType?: PersonnelType | '';
	} = $props();

	// `volunteer.skills` stores the master **label**, not the code (CR-100
	// compat rule — see `application/queries.ts#useSkillOptions`), so the
	// filter value must match on label too, same as the old static list did
	// (`SKILL_MASTER`'s `key` and `label` were always identical).
	const skillCatalog = useSkillOptions();
	const skillOptions = $derived([
		{ value: '', label: 'ทุกทักษะ' },
		...skillCatalog.options.map((s) => ({ value: s.label, label: s.label }))
	]);

	const SHIFT_STATUS_LABELS: Record<ShiftAssignmentStatus, string> = {
		assigned: 'รับกะแล้ว',
		standby: 'รอสแตนด์บาย',
		checked_in: 'ปฏิบัติหน้าที่อยู่',
		completed: 'เสร็จสิ้นภารกิจ',
		no_show: 'ขาดปฏิบัติงาน',
		cancelled: 'ยกเลิก'
	};
	const shiftStatusOptions = [
		{ value: '', label: 'ทุกสถานะกะ' },
		...shiftAssignmentStatusSchema.options.map((v) => ({ value: v, label: SHIFT_STATUS_LABELS[v] }))
	];

	const SOURCE_LABELS: Record<VolunteerSource, string> = {
		public_apply: 'สมัครออนไลน์',
		walk_in: 'Walk-in',
		staff_entry: 'เจ้าหน้าที่บันทึก',
		transfer: 'โอนย้ายจากศูนย์อื่น'
	};
	const sourceOptions = [
		{ value: '', label: 'แหล่งที่มา: ทั้งหมด' },
		...volunteerSourceSchema.options.map((v) => ({ value: v, label: SOURCE_LABELS[v] }))
	];

	const PERSONNEL_TYPE_LABELS: Record<PersonnelType, string> = {
		volunteer: 'อาสาสมัคร',
		staff: 'จนท.ประจำ'
	};
	const personnelTypeOptions = [
		{ value: '', label: 'บุคลากร: ทั้งหมด' },
		...personnelTypeSchema.options.map((v) => ({ value: v, label: PERSONNEL_TYPE_LABELS[v] }))
	];

	const selectTriggerClass = 'h-11 w-full min-w-0 rounded-xl bg-background px-3 shadow-xs';
</script>

<div class="space-y-3">
	<div class="relative">
		<Search
			class="pointer-events-none absolute top-1/2 left-3 h-4 w-4 -translate-y-1/2 text-muted-foreground"
		/>
		<Input
			type="search"
			placeholder="ค้นหาชื่อ นามสกุล เบอร์โทร, รหัส..."
			bind:value={search}
			class="h-11 rounded-xl bg-background pl-9 shadow-xs"
		/>
	</div>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-3">
		<Select.Root type="single" value="" disabled>
			<Select.Trigger class={selectTriggerClass} aria-label="ศูนย์พักพิง">
				<span class="truncate">ทุกศูนย์พักพิง</span>
			</Select.Trigger>
			<Select.Content>
				<Select.Item value="" label="ทุกศูนย์พักพิง" />
			</Select.Content>
		</Select.Root>

		<Select.Root type="single" bind:value={skill}>
			<Select.Trigger class={selectTriggerClass} aria-label="ทักษะ">
				<span class="truncate">
					{skillOptions.find((o) => o.value === skill)?.label ?? 'ทุกทักษะ'}
				</span>
			</Select.Trigger>
			<Select.Content>
				{#each skillOptions as opt (opt.value)}
					<Select.Item value={opt.value} label={opt.label} />
				{/each}
			</Select.Content>
		</Select.Root>

		<Select.Root type="single" bind:value={shiftStatus}>
			<Select.Trigger class={selectTriggerClass} aria-label="สถานะกะ">
				<span class="truncate">
					{shiftStatusOptions.find((o) => o.value === shiftStatus)?.label ?? 'ทุกสถานะกะ'}
				</span>
			</Select.Trigger>
			<Select.Content>
				{#each shiftStatusOptions as opt (opt.value)}
					<Select.Item value={opt.value} label={opt.label} />
				{/each}
			</Select.Content>
		</Select.Root>
	</div>

	<div class="grid grid-cols-1 gap-3 sm:grid-cols-2">
		<Select.Root type="single" bind:value={source}>
			<Select.Trigger class={selectTriggerClass} aria-label="แหล่งที่มา">
				<span class="truncate">
					{sourceOptions.find((o) => o.value === source)?.label ?? 'แหล่งที่มา: ทั้งหมด'}
				</span>
			</Select.Trigger>
			<Select.Content>
				{#each sourceOptions as opt (opt.value)}
					<Select.Item value={opt.value} label={opt.label} />
				{/each}
			</Select.Content>
		</Select.Root>

		<Select.Root type="single" bind:value={personnelType}>
			<Select.Trigger class={selectTriggerClass} aria-label="บุคลากร">
				<span class="truncate">
					{personnelTypeOptions.find((o) => o.value === personnelType)?.label ?? 'บุคลากร: ทั้งหมด'}
				</span>
			</Select.Trigger>
			<Select.Content>
				{#each personnelTypeOptions as opt (opt.value)}
					<Select.Item value={opt.value} label={opt.label} />
				{/each}
			</Select.Content>
		</Select.Root>
	</div>
</div>
