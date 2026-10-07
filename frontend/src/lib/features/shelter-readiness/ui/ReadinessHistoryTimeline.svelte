<script lang="ts">
	import type { ShelterReadinessAssessmentDoc } from '../domain/readiness.types';
	import ReadinessStatusBadge from './ReadinessStatusBadge.svelte';
	import * as Card from '$lib/components/ui/card';
	import { Button } from '$lib/components/ui/button';
	import Calendar from '@lucide/svelte/icons/calendar';
	import User from '@lucide/svelte/icons/user';
	import ExternalLink from '@lucide/svelte/icons/external-link';
	import PlusCircle from '@lucide/svelte/icons/plus-circle';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Edit3 from '@lucide/svelte/icons/edit-3';

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
		try {
			const d = new Date(isoStr);
			return d.toLocaleDateString('th-TH', {
				year: 'numeric',
				month: 'short',
				day: 'numeric',
				hour: '2-digit',
				minute: '2-digit'
			});
		} catch {
			return isoStr;
		}
	}
</script>

<div class="space-y-6">
	<!-- Shelter Overview Banner -->
	<Card.Root class="overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xs">
		<Card.Content class="space-y-4 p-5 sm:p-6">
			<div class="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
				<div class="space-y-1">
					<div class="flex items-center gap-2">
						<span class="rounded-md bg-sky-100 px-2 py-0.5 text-2xs font-bold text-sky-800">
							{shelterCode}
						</span>
						<h1 class="text-lg font-bold text-slate-900 sm:text-xl">
							{shelterName}
						</h1>
					</div>
					<p class="text-xs text-slate-500">
						ประวัติการตรวจประเมินความพร้อมตามมาตรฐานศูนย์พักพิงอัจฉริยะ (Smart Shelter Readiness
						Checklist)
					</p>
				</div>

				<Button
					onclick={onOpenStartModal}
					class="min-h-11 shrink-0 cursor-pointer gap-2 bg-sky-700 px-4 text-xs font-bold text-white shadow-2xs hover:bg-sky-800"
				>
					<PlusCircle class="size-4" />
					<span>เริ่มทำแบบประเมิน</span>
				</Button>
			</div>

			<!-- Status KPIs Row -->
			<div class="grid grid-cols-1 gap-3 border-t border-slate-100 pt-2 sm:grid-cols-3">
				<!-- KPI 1: สถานะความพร้อมล่าสุด -->
				<div class="space-y-1 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
					<span class="block text-2xs font-semibold text-slate-500">สถานะความพร้อมล่าสุด</span>
					<div>
						{#if latestSubmitted}
							<ReadinessStatusBadge
								verdict={latestSubmitted.verdict}
								status={latestSubmitted.status}
								size="sm"
							/>
						{:else}
							<span class="text-xs text-slate-500 italic">ยังไม่มีผลตรวจที่สมบูรณ์</span>
						{/if}
					</div>
				</div>

				<!-- KPI 2: รอบการตรวจทั้งหมด -->
				<div class="space-y-1 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
					<span class="block text-2xs font-semibold text-slate-500">จำนวนรอบที่ตรวจ</span>
					<span class="text-base font-bold text-slate-800 tabular-nums">
						{assessments.length} รอบ
					</span>
				</div>

				<!-- KPI 3: ผู้ตรวจล่าสุด -->
				<div class="space-y-1 rounded-xl border border-slate-200 bg-slate-50/60 p-3">
					<span class="block text-2xs font-semibold text-slate-500">ผู้ตรวจรอบล่าสุด</span>
					<span class="block truncate text-xs font-medium text-slate-800">
						{latestSubmitted?.submitted_by ?? latestSubmitted?.created_by ?? '-'}
					</span>
				</div>
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Table / List Section -->
	<div class="space-y-3">
		<div class="flex items-center justify-between">
			<h2 class="flex items-center gap-1.5 text-sm font-bold text-slate-800">
				<ShieldCheck class="size-4 text-sky-600" />
				<span>รายการประวัติการตรวจประเมินทั้งหมด ({assessments.length} รายการ)</span>
			</h2>
		</div>

		{#if assessments.length === 0}
			<Card.Root class="border border-dashed border-slate-300 bg-white p-12 text-center">
				<div class="mx-auto max-w-sm space-y-3">
					<div
						class="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-sky-50 text-sky-600"
					>
						<ShieldCheck class="size-6" />
					</div>
					<h3 class="text-sm font-bold text-slate-800">ยังไม่มีประวัติการตรวจประเมิน</h3>
					<p class="text-xs text-slate-500">
						เริ่มต้นการตรวจประเมินความพร้อมศูนย์พักพิงเพื่อขึ้นทะเบียนและยกระดับมาตรฐานตามเกณฑ์ ปภ.
					</p>
					<Button
						onclick={onOpenStartModal}
						size="sm"
						class="mt-2 gap-1.5 bg-sky-700 text-xs font-bold text-white hover:bg-sky-800"
					>
						<PlusCircle class="size-3.5" />
						เริ่มการประเมินรอบแรก
					</Button>
				</div>
			</Card.Root>
		{:else}
			<!-- Desktop Table (md+) -->
			<div
				class="hidden overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xs md:block"
			>
				<table class="w-full text-left text-xs">
					<thead class="border-b border-slate-200 bg-slate-50/80 font-bold text-slate-700">
						<tr>
							<th class="px-5 py-3.5">วันที่ตรวจ / บันทึก</th>
							<th class="px-4 py-3.5">ระดับ (Tier)</th>
							<th class="px-4 py-3.5">ผู้ประเมิน</th>
							<th class="px-4 py-3.5 text-center">สรุปผลการตรวจ</th>
							<th class="px-4 py-3.5 text-center">สถานะความพร้อม</th>
							<th class="px-5 py-3.5 text-right">การจัดการ</th>
						</tr>
					</thead>
					<tbody class="divide-y divide-slate-100 text-slate-700">
						{#each assessments as doc (doc._id)}
							<tr class="transition-colors hover:bg-slate-50/70">
								<!-- วันที่ -->
								<td class="px-5 py-3.5">
									<div class="flex items-center gap-1.5 font-medium text-slate-900">
										<Calendar class="size-3.5 text-slate-400" />
										<span>{formatDate(doc.submitted_at ?? doc.created_at)}</span>
									</div>
								</td>

								<!-- ระดับ Tier -->
								<td class="px-4 py-3.5 font-semibold text-slate-800">
									<span class="rounded-md bg-slate-100 px-2 py-0.5 text-2xs">
										{doc.tier === 'community'
											? 'ระดับชุมชน'
											: doc.tier === 'local_admin'
												? 'ระดับ อปท.'
												: 'ระดับเมือง'}
									</span>
								</td>

								<!-- ผู้ประเมิน -->
								<td class="px-4 py-3.5">
									<div class="flex items-center gap-1.5 text-slate-600">
										<User class="size-3.5 text-slate-400" />
										<span>{doc.submitted_by ?? doc.header.assessor_name ?? doc.created_by}</span>
									</div>
								</td>

								<!-- สรุปผลตรวจ -->
								<td class="px-4 py-3.5 text-center">
									<div class="inline-flex items-center gap-1 text-2xs tabular-nums">
										<span class="font-semibold text-emerald-700"
											>มีครบ {doc.summary.fully_ready_count}</span
										>
										<span class="text-slate-300">•</span>
										<span class="font-semibold text-amber-700"
											>มีบางส่วน {doc.summary.partial_count}</span
										>
										<span class="text-slate-300">•</span>
										<span class="font-semibold text-rose-700">ไม่มี {doc.summary.none_count}</span>
									</div>
								</td>

								<!-- สถานะความพร้อม -->
								<td class="px-4 py-3.5 text-center">
									<ReadinessStatusBadge verdict={doc.verdict} status={doc.status} size="sm" />
								</td>

								<!-- จัดการ / ดู -->
								<td class="px-5 py-3.5 text-right">
									<Button
										variant="outline"
										size="sm"
										onclick={() => onSelectAssessment(doc)}
										class="h-8 gap-1.5 border-slate-200 text-xs font-semibold hover:bg-sky-50 hover:text-sky-800"
									>
										{#if doc.status === 'draft'}
											<Edit3 class="size-3.5 text-amber-600" />
											<span>ทำต่อ (Draft)</span>
										{:else}
											<ExternalLink class="size-3.5 text-slate-500" />
											<span>ดูผลการตรวจ</span>
										{/if}
									</Button>
								</td>
							</tr>
						{/each}
					</tbody>
				</table>
			</div>

			<!-- Mobile Cards View (< md) -->
			<div class="grid grid-cols-1 gap-3 md:hidden">
				{#each assessments as doc (doc._id)}
					<Card.Root class="space-y-3 border border-slate-200 bg-white p-4">
						<div class="flex items-start justify-between gap-2">
							<div class="space-y-1">
								<ReadinessStatusBadge verdict={doc.verdict} status={doc.status} size="sm" />
								<div class="pt-1 text-xs font-bold text-slate-800">
									{doc.tier === 'community'
										? 'ระดับชุมชน'
										: doc.tier === 'local_admin'
											? 'ระดับ อปท.'
											: 'ระดับเมือง'}
								</div>
							</div>
							<span class="text-2xs text-slate-500">
								{formatDate(doc.submitted_at ?? doc.created_at)}
							</span>
						</div>

						<div class="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-1 text-2xs">
							<span class="font-semibold text-emerald-700"
								>มีครบ: {doc.summary.fully_ready_count}</span
							>
							<span>•</span>
							<span class="font-semibold text-amber-700"
								>มีบางส่วน: {doc.summary.partial_count}</span
							>
							<span>•</span>
							<span class="font-semibold text-rose-700">ไม่มี: {doc.summary.none_count}</span>
						</div>

						<div class="pt-2">
							<Button
								variant="outline"
								size="sm"
								onclick={() => onSelectAssessment(doc)}
								class="w-full gap-1.5 border-slate-200 text-xs font-semibold"
							>
								{#if doc.status === 'draft'}
									<Edit3 class="size-3.5 text-amber-600" />
									<span>ทำแบบประเมินต่อ (Draft)</span>
								{:else}
									<ExternalLink class="size-3.5 text-slate-500" />
									<span>ดูผลการตรวจ</span>
								{/if}
							</Button>
						</div>
					</Card.Root>
				{/each}
			</div>
		{/if}
	</div>
</div>
