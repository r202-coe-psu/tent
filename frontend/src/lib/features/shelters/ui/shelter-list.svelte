<script lang="ts">
	import { useMasterData, formatMasterLabel } from '$lib/features/master-data';
	import { SITE_KIND_LABELS } from '../domain/schema';
	import { Button } from '$lib/components/ui/button/index.js';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Building from '@lucide/svelte/icons/building';
	import Phone from '@lucide/svelte/icons/phone';
	import type { ShelterSummary } from '../data/shelters.repository';
	import type { ProjectLevel } from '../domain/schema';
	import ShelterOccupancyCell from './shelter-occupancy-cell.svelte';

	let {
		shelters,
		onedit,
		ondelete,
		emptyLabel = 'ศูนย์พักพิง'
	}: {
		shelters: ShelterSummary[];
		onedit: (shelter: ShelterSummary) => void;
		ondelete?: (shelter: ShelterSummary) => void;
		emptyLabel?: string;
	} = $props();

	// Resolve shelter_type codes to human labels via the master-data engine.
	const shelterTypeQuery = useMasterData(() => 'shelter_type');
	const typeLabel = (code: string | null) => {
		if (!code) return '—';
		const items = shelterTypeQuery.data?.items;
		// Still loading — show the raw code rather than falsely reporting it as deleted.
		if (!items) return code;
		// Not found once the master list has loaded means it was deleted upstream.
		const item = items.find((i) => i.code === code);
		return item ? formatMasterLabel(item, 'th') : '—';
	};

	const projectLevelLabel: Record<ProjectLevel, string> = {
		community: 'ระดับชุมชน',
		lao: 'ระดับ อปท.',
		provincial: 'ระดับเมือง/จังหวัด'
	};

	function locationLine(s: ShelterSummary): string {
		return [s.subdistrict, s.district, s.province].filter(Boolean).join(' · ');
	}
</script>

{#if shelters.length === 0}
	<div class="flex flex-col items-center justify-center gap-2 bg-white py-12 text-center">
		<div
			class="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-slate-50"
		>
			<Building class="h-5 w-5 text-slate-400" />
		</div>
		<p class="text-sm font-semibold text-slate-800">ยังไม่มี{emptyLabel}ในระบบ</p>
		<p class="text-xs text-slate-500">เริ่มต้นด้วยการเพิ่ม{emptyLabel}ใหม่ หรือตรวจสอบคำค้นหา</p>
	</div>
{:else}
	<div class="overflow-x-auto">
		<table class="w-full border-collapse text-left text-sm">
			<thead>
				<tr
					class="border-b border-slate-200/80 bg-slate-50/75 text-xs font-semibold text-slate-500"
				>
					<th class="px-3.5 py-2.5">ศูนย์พักพิง</th>
					<th class="px-3.5 py-2.5">ประเภท / ที่ตั้ง</th>
					<th class="px-3.5 py-2.5">ผู้พักปัจจุบัน / ความจุ</th>
					<th class="px-3.5 py-2.5">ผู้จัดการ / ติดต่อ</th>
					<th class="px-3.5 py-2.5 text-right">จัดการ</th>
				</tr>
			</thead>
			<tbody class="divide-y divide-slate-100 bg-white">
				{#each shelters as shelter (shelter.code)}
					<tr class="group transition-colors hover:bg-slate-50/70">
						<!-- Name & Code -->
						<td class="px-3.5 py-2.5 align-middle">
							<div class="font-semibold text-slate-900 group-hover:text-[#0A2647]">
								{shelter.name}
							</div>
							<div class="text-xs text-slate-400 tabular-nums">รหัส: {shelter.code}</div>
						</td>

						<!-- Type / location -->
						<td class="px-3.5 py-2.5 align-middle">
							<div class="flex flex-col items-start gap-1">
								<!-- Site Kind Badge -->
								{#if shelter.site_kind === 'host_house'}
									<span
										class="inline-flex items-center rounded-full border border-purple-200 bg-purple-50 px-2 py-0.5 text-xs font-semibold text-purple-900"
									>
										{SITE_KIND_LABELS.host_house}
									</span>
								{:else}
									<span
										class="inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-xs font-semibold text-sky-900"
									>
										{SITE_KIND_LABELS.evacuation_center}
									</span>
								{/if}

								<!-- Project Level Badge -->
								{#if shelter.project_level}
									<span
										class="inline-flex items-center rounded border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs font-medium text-slate-600"
									>
										{projectLevelLabel[shelter.project_level]}
									</span>
								{/if}

								<!-- Shelter Type (ประเภทสถานที่) -->
								<div
									class="text-xs font-medium {shelter.shelter_type
										? 'text-slate-800'
										: 'text-slate-400'}"
								>
									{typeLabel(shelter.shelter_type)}
								</div>

								<!-- Location line (ที่ตั้ง) -->
								{#if locationLine(shelter)}
									<div class="max-w-xs truncate text-xs text-slate-500">
										{locationLine(shelter)}
									</div>
								{/if}
							</div>
						</td>

						<!-- Capacity / live occupancy -->
						<td class="px-3.5 py-2.5 align-middle">
							<ShelterOccupancyCell code={shelter.code} capacity={shelter.capacity} />
						</td>

						<!-- Manager / phone -->
						<td class="px-3.5 py-2.5 align-middle">
							<div class="text-xs font-medium text-slate-900">{shelter.contact?.name ?? '—'}</div>
							{#if shelter.contact?.phone}
								<div class="mt-0.5 flex items-center gap-1 text-xs text-slate-500 tabular-nums">
									<Phone class="size-3 shrink-0 text-slate-400" />
									<span>{shelter.contact.phone}</span>
								</div>
							{/if}
						</td>

						<!-- Actions -->
						<td class="px-3.5 py-2.5 text-right align-middle">
							<div class="flex items-center justify-end gap-1.5">
								<Button
									variant="outline"
									size="sm"
									onclick={() => onedit(shelter)}
									class="h-7 border-slate-200/80 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
								>
									<Pencil class="mr-1 size-3.5" />
									จัดการ
								</Button>
								{#if ondelete}
									<Button
										variant="ghost"
										size="sm"
										onclick={() => ondelete(shelter)}
										class="h-7 px-2 text-xs text-red-600 hover:bg-red-50 hover:text-red-700"
										aria-label="ลบศูนย์พักพิง"
									>
										<Trash2 class="size-3.5" />
									</Button>
								{/if}
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
