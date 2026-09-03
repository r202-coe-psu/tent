<script lang="ts">
	/**
	 * Job detail — Tab 1 "ภาพรวม (Overview)" (01-tab-job-board.md §01.5,
	 * approved mockup 2026-08-27): the SOP text, the required skills read off
	 * Master Data `volunteer_skills` (CR-100), and the LIFECYCLE switcher.
	 *
	 * The lifecycle write goes through `useUpdateJob` → `JobRepository#update`,
	 * which re-reads the latest revision and re-derives `status`/`slots_*`
	 * itself, so this screen never sends a quota it computed locally.
	 */
	import { toast } from 'svelte-sonner';
	import { useQueryClient } from '@tanstack/svelte-query';
	import FileText from '@lucide/svelte/icons/file-text';
	import Award from '@lucide/svelte/icons/award';
	import Target from '@lucide/svelte/icons/target';
	import JobLifecyclePanel from './job-lifecycle-panel.svelte';
	import { resolveSkillOption } from '../domain/skill-catalog';
	import type { Job, JobStatus } from '../domain/job.schema';
	import { useSkillOptions, useUpdateJob } from '../application/queries';

	let { job }: { job: Job } = $props();

	const queryClient = useQueryClient();
	const updateMutation = useUpdateJob(queryClient);

	/**
	 * Master Data entry per required skill (CR-100 — `skills_required` stores
	 * codes, with pre-CR-100 labels still resolving). A value Master Data no
	 * longer carries still renders, unlabelled.
	 */
	const skillCatalog = useSkillOptions();
	const skills = $derived(
		(job.skills_required ?? []).map((key) => ({
			key,
			entry: resolveSkillOption(key, skillCatalog.options)
		}))
	);

	/** Thai label per stored status — the toast must not show the raw enum value. */
	const STATUS_LABEL: Record<JobStatus, string> = {
		draft: 'ร่าง',
		open: 'เปิดรับ',
		paused: 'พักรับ',
		almost_full: 'ใกล้เต็ม',
		full: 'เต็มโควตา',
		closed: 'ปิดงาน',
		cancelled: 'ยกเลิก'
	};

	let statusError = $state<string | null>(null);

	async function changeStatus(status: JobStatus) {
		if (status === job.status) return;
		statusError = null;
		try {
			const saved = await updateMutation.mutateAsync({ ...job, status });
			toast.success(
				saved.status === status
					? `เปลี่ยนสถานะเป็น "${STATUS_LABEL[status]}" แล้ว`
					: `ระบบปรับสถานะเป็น "${STATUS_LABEL[saved.status]}" ตามยอดที่รับไปจริง (ไม่ใช่ "${STATUS_LABEL[status]}")`
			);
		} catch (err) {
			// Surface it on the panel as well as the toast: a failed status change
			// otherwise looks like a dead button.
			statusError = err instanceof Error ? err.message : 'อัปเดตสถานะไม่สำเร็จ';
			toast.error(statusError);
		}
	}
</script>

<!-- `min-w-0` on both columns: a grid item defaults to `min-width: auto`, so a
     long unbroken description would widen the track instead of wrapping. -->
<div class="grid grid-cols-1 gap-4 lg:grid-cols-3">
	<div class="min-w-0 space-y-4 lg:col-span-2">
		<div class="rounded-2xl border border-border bg-card p-4 shadow-xs">
			<h3 class="inline-flex items-center gap-2 text-sm font-bold text-foreground">
				<FileText class="h-4 w-4 text-primary" />
				รายละเอียดภารกิจ และแนวทางปฏิบัติ (SOP)
			</h3>
			<p class="mt-3 text-sm leading-relaxed break-words whitespace-pre-line text-muted-foreground">
				{job.description}
			</p>
		</div>

		<div class="rounded-2xl border border-border bg-card p-4 shadow-xs">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<h3 class="inline-flex items-center gap-2 text-sm font-bold text-foreground">
					<Award class="h-4 w-4 text-primary" />
					ทักษะที่ต้องการเป็นพิเศษ (Volunteer Skill Master List)
				</h3>
				<span class="text-xs text-muted-foreground">{skills.length} ทักษะที่ต้องการ</span>
			</div>

			{#if skills.length === 0}
				<p
					class="mt-3 rounded-xl border border-dashed border-border p-4 text-xs text-muted-foreground"
				>
					งานนี้ไม่ระบุทักษะเฉพาะ — อาสาสมัครทั่วไปสมัครได้
				</p>
			{:else}
				<div class="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
					{#each skills as skill (skill.key)}
						<div class="min-w-0 rounded-xl border border-border bg-muted/30 p-3">
							<p class="flex items-start gap-1.5 text-sm font-bold break-words text-foreground">
								<Target class="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-500" />
								<span>
									{#if skill.entry}<span aria-hidden="true">{skill.entry.icon}</span>
									{/if}{skill.entry?.label ?? skill.key}
								</span>
							</p>
							{#if skill.entry}
								<p class="mt-1 pl-5 text-xs leading-relaxed break-words text-muted-foreground">
									{skill.entry.description}
								</p>
							{/if}
						</div>
					{/each}
				</div>
			{/if}
		</div>
	</div>

	<div class="min-w-0 space-y-2">
		<JobLifecyclePanel {job} pending={updateMutation.isPending} onselect={changeStatus} />
		{#if statusError}
			<p
				class="rounded-xl border border-destructive/20 bg-destructive/5 p-3 text-xs break-words text-destructive"
			>
				{statusError}
			</p>
		{/if}
	</div>
</div>
