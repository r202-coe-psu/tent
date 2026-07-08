<script lang="ts">
	import { useMasterData } from '$lib/features/master-data';
	import Pencil from '@lucide/svelte/icons/pencil';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Building from '@lucide/svelte/icons/building';
	import type { ShelterSummary } from '../data/shelters.repository';
	import type { ProjectLevel } from '../domain/schema';

	let {
		shelters,
		onedit,
		ondelete
	}: {
		shelters: ShelterSummary[];
		onedit: (shelter: ShelterSummary) => void;
		ondelete?: (shelter: ShelterSummary) => void;
	} = $props();

	// Resolve shelter_type codes to human labels via the master-data engine.
	const shelterTypeQuery = useMasterData(() => 'shelter_type');
	const typeLabel = (code: string | null) => {
		if (!code) return '—';
		return shelterTypeQuery.data?.items.find((i) => i.code === code)?.label ?? code;
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
	<div class="flex flex-col items-center justify-center gap-2 py-16 text-center">
		<div class="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
			<Building class="h-5 w-5 text-muted-foreground" />
		</div>
		<p class="text-sm font-medium text-foreground">ยังไม่มีศูนย์พักพิงในระบบ</p>
		<p class="text-xs text-muted-foreground">เริ่มต้นด้วยการเพิ่มศูนย์พักพิงใหม่</p>
	</div>
{:else}
	<div class="overflow-x-auto">
		<table class="w-full border-collapse text-sm">
			<thead>
				<tr
					class="border-b border-shelter-border text-left text-xs font-bold text-muted-foreground"
				>
					<th class="px-4 py-3">ชื่อศูนย์พักพิง</th>
					<th class="px-4 py-3">ประเภท / ที่ตั้ง</th>
					<th class="px-4 py-3">ความจุ (คน)</th>
					<th class="px-4 py-3">ผู้จัดการ / เบอร์โทร</th>
					<th class="px-4 py-3 text-right">จัดการ</th>
				</tr>
			</thead>
			<tbody>
				{#each shelters as shelter (shelter.code)}
					<tr
						class="group border-b border-shelter-border/60 transition-colors last:border-0 hover:bg-muted/40"
					>
						<!-- Name -->
						<td class="px-4 py-4 align-top">
							<span class="font-bold text-foreground">{shelter.name}</span>
						</td>

						<!-- Type / location -->
						<td class="px-4 py-4 align-top">
							<div class="font-medium text-foreground">{typeLabel(shelter.shelter_type)}</div>
							{#if locationLine(shelter)}
								<div class="mt-0.5 text-xs text-muted-foreground">{locationLine(shelter)}</div>
							{/if}
							{#if shelter.project_level}
								<span
									class="mt-1.5 inline-block rounded-md bg-violet-100 px-2 py-0.5 text-[11px] font-bold text-violet-700 dark:bg-violet-500/15 dark:text-violet-300"
								>
									{projectLevelLabel[shelter.project_level]}
								</span>
							{/if}
						</td>

						<!-- Capacity -->
						<td class="px-4 py-4 align-top">
							<div class="font-semibold text-foreground">รองรับสูงสุด {shelter.capacity} คน</div>
							<div class="mt-0.5 text-xs text-muted-foreground">ยังไม่แสดงจำนวนผู้พักปัจจุบัน</div>
						</td>

						<!-- Manager / phone -->
						<td class="px-4 py-4 align-top">
							<div class="font-medium text-foreground">{shelter.contact?.name ?? '—'}</div>
							{#if shelter.contact?.phone}
								<div class="mt-0.5 text-xs text-muted-foreground">{shelter.contact.phone}</div>
							{/if}
						</td>

						<!-- Actions -->
						<td class="px-4 py-4 text-right align-top">
							<div class="flex items-center justify-end gap-2">
								<button
									type="button"
									onclick={() => onedit(shelter)}
									class="inline-flex items-center gap-1.5 rounded-lg border border-shelter-blue-text/25 bg-shelter-blue-bg px-3 py-1.5 text-xs font-bold text-shelter-blue-text transition hover:brightness-95 active:scale-95"
								>
									<Pencil class="h-3.5 w-3.5" />
									จัดการ
								</button>
								{#if ondelete}
									<button
										type="button"
										onclick={() => ondelete?.(shelter)}
										class="inline-flex items-center gap-1.5 rounded-lg border border-shelter-rose-text/25 bg-shelter-rose-bg px-3 py-1.5 text-xs font-bold text-shelter-rose-text transition hover:brightness-95 active:scale-95"
									>
										<Trash2 class="h-3.5 w-3.5" />
										ลบ
									</button>
								{/if}
							</div>
						</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
{/if}
