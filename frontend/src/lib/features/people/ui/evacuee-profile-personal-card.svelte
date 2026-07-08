<script lang="ts">
	import User from '@lucide/svelte/icons/user';
	import type { Evacuee } from '$lib/features/people';

	let { evacuee }: { evacuee: Evacuee } = $props();
</script>

<div class="space-y-4 rounded-3xl border border-border bg-card p-6 shadow-sm">
	<div class="flex items-center gap-2.5 border-b border-border pb-2">
		<User class="size-4.5 text-primary" />
		<h3 class="text-sm font-bold text-slate-900 dark:text-slate-50">ข้อมูลส่วนบุคคล</h3>
	</div>
	<div class="grid grid-cols-2 gap-x-2 gap-y-4">
		<div>
			<span class="block text-xs font-medium text-muted-foreground">เพศ</span>
			<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
				{evacuee.gender === 'male' ? 'Male' : evacuee.gender === 'female' ? 'Female' : 'Other'}
			</span>
		</div>
		<div>
			<span class="block text-xs font-medium text-muted-foreground">อายุ</span>
			<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
				{evacuee.birth_year
					? `${new Date().getFullYear() + 543 - evacuee.birth_year} ปี`
					: 'ไม่ระบุ'}
			</span>
		</div>
		<div>
			<span class="block text-xs font-medium text-muted-foreground">สัญชาติ</span>
			<span class="mt-0.5 block text-sm font-semibold text-slate-800 dark:text-slate-200">
				{evacuee.country === 'THAILAND' ? 'ไทย' : evacuee.country}
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
</div>
