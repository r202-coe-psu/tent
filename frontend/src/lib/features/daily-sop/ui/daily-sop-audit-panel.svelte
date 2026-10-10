<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Sheet from '$lib/components/ui/sheet';
	import type { DailySopRoleAssessment } from '../domain/daily-sop';

	interface Props {
		assessment: DailySopRoleAssessment;
		formatDateTime: (value: string) => string;
	}

	let { assessment, formatDateTime }: Props = $props();
	let open = $state(false);
</script>

<Sheet.Root bind:open>
	<Sheet.Trigger>
		{#snippet child({ props })}
			<Button variant="link" class="min-h-11 px-0 text-sm sm:hidden" {...props}
				>ข้อมูลการบันทึก</Button
			>
		{/snippet}
	</Sheet.Trigger>
	<Sheet.Content
		side="bottom"
		class="flex max-h-[72dvh] flex-col gap-0 overflow-hidden rounded-t-2xl border-slate-200 bg-white p-0 [&>button:last-child]:flex [&>button:last-child]:size-12 [&>button:last-child]:items-center [&>button:last-child]:justify-center"
		data-testid="daily-sop-audit-panel"
	>
		<Sheet.Header class="relative shrink-0 border-b border-slate-200/80 p-4 pr-14 sm:p-5">
			<Sheet.Title class="text-lg font-bold text-slate-900">ข้อมูลการบันทึก</Sheet.Title>
			<Sheet.Description class="text-sm text-slate-500"
				>รายละเอียดผู้ประเมินและเวลาบันทึกแบบอ่านอย่างเดียว</Sheet.Description
			>
		</Sheet.Header>
		<div class="min-h-0 flex-1 overflow-y-auto p-4 sm:p-5">
			<dl class="grid gap-3 text-sm">
				<div>
					<dt class="font-semibold text-slate-700">ผู้เริ่มประเมิน</dt>
					<dd class="mt-0.5 text-slate-600">{assessment.assessor_name || 'ไม่ระบุชื่อ'}</dd>
				</div>
				<div>
					<dt class="font-semibold text-slate-700">เวลาเริ่ม</dt>
					<dd class="mt-0.5 text-slate-600">{formatDateTime(assessment.assessed_at)}</dd>
				</div>
				<div>
					<dt class="font-semibold text-slate-700">เวลาอัปเดต</dt>
					<dd class="mt-0.5 text-slate-600">{formatDateTime(assessment.updated_at)}</dd>
				</div>
			</dl>
			{#if assessment.controls.length}
				<div class="mt-4 border-t border-slate-200/80 pt-3">
					<h3 class="text-sm font-semibold text-slate-800">ผู้บันทึกแต่ละข้อ</h3>
					<ul class="mt-2 divide-y divide-slate-200/80">
						{#each assessment.controls as control (control.id)}
							<li class="py-2 text-sm">
								<p class="font-medium text-slate-800">{control.id} · {control.question}</p>
								<p class="mt-0.5 text-slate-600">
									{control.checked_by_name || control.checked_by} · {formatDateTime(
										control.checked_at
									)}
								</p>
							</li>
						{/each}
					</ul>
				</div>
			{/if}
		</div>
		<Sheet.Footer class="shrink-0 border-t border-slate-200/80 bg-slate-50 p-4 sm:p-5">
			<Sheet.Close>
				{#snippet child({ props })}
					<Button variant="outline" class="min-h-12 w-full sm:min-h-11 sm:w-auto" {...props}
						>ปิด</Button
					>
				{/snippet}
			</Sheet.Close>
		</Sheet.Footer>
	</Sheet.Content>
</Sheet.Root>
