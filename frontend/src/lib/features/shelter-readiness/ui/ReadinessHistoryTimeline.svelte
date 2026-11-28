<script lang="ts">
	import type { ShelterReadinessAssessmentDoc } from '../domain/readiness.types';
	import ReadinessStatusBadge from './ReadinessStatusBadge.svelte';
	import StaffPageShell from '$lib/components/staff-page-shell.svelte';
	import { Button } from '$lib/components/ui/button';
	import ClipboardCheck from '@lucide/svelte/icons/clipboard-check';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import { formatThaiDateTime } from '$lib/utils/date';

	interface Props {
		shelterName: string;
		shelterCode: string;
		assessments: ShelterReadinessAssessmentDoc[];
		onOpenStartModal: () => void;
		onSelectAssessment: (doc: ShelterReadinessAssessmentDoc) => void;
	}

	let { shelterName, shelterCode, assessments, onOpenStartModal, onSelectAssessment }: Props =
		$props();

	const latestSubmitted = $derived(assessments.find((d) => d.status === 'submitted') ?? null);

	function formatDate(isoStr?: string): string {
		if (!isoStr) return '-';
		return formatThaiDateTime(isoStr) || isoStr;
	}

	const tierLabel = (tier: ShelterReadinessAssessmentDoc['tier']) =>
		tier === 'community' ? 'ระดับชุมชน' : tier === 'local_admin' ? 'ระดับ อปท.' : 'ระดับเมือง';

	function percentReady(doc: ShelterReadinessAssessmentDoc): number {
		const { fully_ready_count: a, partial_count: b, none_count: c } = doc.summary;
		const total = a + b + c;
		return total ? Math.floor((a / total) * 100) : 0;
	}
</script>

<StaffPageShell
	title="การประเมินความพร้อมศูนย์"
	description="{shelterName} · ประวัติการตรวจประเมินตามมาตรฐานศูนย์พักพิงอัจฉริยะ"
>
	{#snippet meta()}
		<div class="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
			<span class="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
				>{shelterCode}</span
			>
			<span
				>ตรวจแล้ว <span class="font-semibold text-foreground tabular-nums"
					>{assessments.length}</span
				> รอบ</span
			>
			{#if latestSubmitted}
				<span>· ล่าสุด</span>
				<ReadinessStatusBadge
					verdict={latestSubmitted.verdict}
					status={latestSubmitted.status}
					size="sm"
				/>
			{/if}
		</div>
	{/snippet}
	{#snippet actions()}
		<Button onclick={onOpenStartModal} class="min-h-11 gap-2 px-4 text-sm font-semibold">
			<PlusCircle class="size-4" aria-hidden="true" />
			เริ่มทำแบบประเมิน
		</Button>
	{/snippet}

	{#if assessments.length === 0}
		<div class="rounded-xl border bg-card p-6 text-sm text-muted-foreground">
			ยังไม่มีประวัติการตรวจประเมิน กด “เริ่มทำแบบประเมิน” เพื่อเริ่มรอบแรก
		</div>
	{:else}
		<div class="overflow-hidden rounded-xl border bg-card">
			{#each assessments as doc (doc._id)}
				{@const percent = percentReady(doc)}
				<article
					class="grid min-w-0 gap-3 border-b p-3.5 last:border-b-0 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center sm:gap-5 sm:px-5 sm:py-4"
				>
					<div class="min-w-0">
						<div class="flex flex-wrap items-center gap-x-2 gap-y-1">
							<h2 class="font-semibold tabular-nums">
								{formatDate(doc.submitted_at ?? doc.created_at)}
							</h2>
							<span
								class="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-semibold text-primary"
								>{tierLabel(doc.tier)}</span
							>
							<ReadinessStatusBadge verdict={doc.verdict} status={doc.status} size="sm" />
						</div>
						<div class="mt-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm">
							<p>
								<span class="font-semibold text-emerald-700 tabular-nums"
									>มีครบ {doc.summary.fully_ready_count}</span
								>
								<span class="text-muted-foreground">·</span>
								<span class="font-semibold text-amber-700 tabular-nums"
									>มีบางส่วน {doc.summary.partial_count}</span
								>
								<span class="text-muted-foreground">·</span>
								<span class="font-semibold text-rose-700 tabular-nums"
									>ไม่มี {doc.summary.none_count}</span
								>
							</p>
							<span class="font-medium text-muted-foreground tabular-nums">{percent}%</span>
						</div>
						<div
							class="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"
							role="progressbar"
							aria-label="สัดส่วนข้อที่มีครบ"
							aria-valuemin="0"
							aria-valuemax="100"
							aria-valuenow={percent}
						>
							<div class="h-full rounded-full bg-primary" style:width="{percent}%"></div>
						</div>
						<p class="mt-2 text-xs text-muted-foreground">
							ผู้ประเมิน {doc.submitted_by ?? doc.header.assessor_name ?? doc.created_by}
						</p>
					</div>
					<button
						class="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-lg border border-primary/25 px-4 text-sm font-semibold whitespace-nowrap text-primary hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring sm:w-auto"
						type="button"
						onclick={() => onSelectAssessment(doc)}
					>
						{doc.status === 'draft' ? 'ทำต่อ (Draft)' : 'ดูผลการตรวจ'}
						<ClipboardCheck class="size-4" aria-hidden="true" />
					</button>
				</article>
			{/each}
		</div>
	{/if}
</StaffPageShell>
