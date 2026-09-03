<script lang="ts">
	import User from '@lucide/svelte/icons/user';
	import Pencil from '@lucide/svelte/icons/pencil';
	import { evacueeAgeYears, maskNationalId, type Evacuee } from '$lib/features/people';
	import { COUNTRIES } from '$lib/utils/country';

	let {
		evacuee,
		readonly,
		onOpenEdit
	}: { evacuee: Evacuee; readonly: boolean; onOpenEdit: () => void } = $props();

	const documentLabels: Record<string, string> = {
		national_id: 'บัตรประชาชน',
		passport: 'หนังสือเดินทาง',
		pink_card: 'บัตรชมพู',
		other: 'เอกสารอื่นๆ'
	};

	const ageYears = $derived(evacueeAgeYears(evacuee));

	function countryLabel(value: string): string {
		return COUNTRIES.find((country) => country.value === value)?.label ?? value;
	}
</script>

<section class="space-y-4 rounded-lg border border-border bg-card p-5">
	<div class="flex items-center justify-between border-b border-border pb-2">
		<div class="flex items-center gap-2.5">
			<User class="size-4.5 text-primary" />
			<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">ข้อมูลส่วนบุคคล</h3>
		</div>
		{#if !readonly}
			<button
				type="button"
				aria-label="แก้ไขข้อมูลส่วนบุคคล"
				title="แก้ไขข้อมูลส่วนบุคคล"
				onclick={onOpenEdit}
				class="inline-flex size-8 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
			>
				<Pencil class="size-4" />
			</button>
		{/if}
	</div>
	<div class="grid grid-cols-2 gap-x-4 gap-y-4">
		<div class="col-span-2 border-b border-border/50 pb-3">
			<span class="block text-xs font-medium text-muted-foreground">ชื่อ - นามสกุล</span>
			<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
				{evacuee.first_name}
				{evacuee.last_name}
			</span>
		</div>
		<div>
			<span class="block text-xs font-medium text-muted-foreground">ชื่อเล่น</span>
			<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
				{evacuee.nickname || 'ไม่ระบุ'}
			</span>
		</div>
		<div>
			<span class="block text-xs font-medium text-muted-foreground">เอกสารยืนยันตัวตน</span>
			<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
				{documentLabels[evacuee.person_id?.cardType ?? 'national_id'] ?? 'เอกสารอื่นๆ'}
			</span>
		</div>
		<div class="col-span-2">
			<span class="block text-xs font-medium text-muted-foreground">เลขที่เอกสาร</span>
			<span class="mt-0.5 block font-mono text-sm font-semibold text-slate-800 dark:text-slate-200">
				{maskNationalId(evacuee.person_id?.number)}
			</span>
		</div>
		<div>
			<span class="block text-xs font-medium text-muted-foreground">เพศ</span>
			<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
				{evacuee.gender === 'male' ? 'ชาย' : evacuee.gender === 'female' ? 'หญิง' : 'อื่นๆ'}
			</span>
		</div>
		<div>
			<span class="block text-xs font-medium text-muted-foreground">อายุ</span>
			<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
				{ageYears !== null ? `${ageYears} ปี` : 'ไม่ระบุ'}
			</span>
		</div>
		<div>
			<span class="block text-xs font-medium text-muted-foreground">ปีเกิด</span>
			<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
				{evacuee.birth_year ? `พ.ศ. ${evacuee.birth_year}` : 'ไม่ระบุ'}
			</span>
		</div>
		<div>
			<span class="block text-xs font-medium text-muted-foreground">สัญชาติ</span>
			<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
				{countryLabel(evacuee.country)}
			</span>
		</div>
		<div>
			<span class="block text-xs font-medium text-muted-foreground">ศาสนา</span>
			<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
				{evacuee.religion === 'buddhist'
					? 'พุทธ'
					: evacuee.religion === 'muslim'
						? 'อิสลาม'
						: evacuee.religion === 'christian'
							? 'คริสต์'
							: evacuee.religion === 'other'
								? 'อื่นๆ'
								: 'ไม่ระบุ'}
			</span>
		</div>
		<div class="col-span-2 border-t border-border/50 pt-3">
			<span class="block text-xs font-medium text-muted-foreground">เบอร์โทรศัพท์</span>
			<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
				{evacuee.phone || 'ไม่มีเบอร์ติดต่อ'}
			</span>
		</div>
	</div>
</section>
