<script lang="ts">
	import * as Table from '$lib/components/ui/table/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import Search from '@lucide/svelte/icons/search';
	import PaginationControls from '$lib/components/pagination-controls.svelte';
	import { resolve } from '$app/paths';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import UserRound from '@lucide/svelte/icons/user-round';
	import NotebookPen from '@lucide/svelte/icons/notebook-pen';
	import {
		INCIDENT_CATEGORIES,
		INCIDENT_CATEGORY_LABELS,
		INCIDENT_SEVERITIES,
		INCIDENT_SEVERITY_LABELS,
		INCIDENT_STATUS_LABELS,
		INCIDENT_STATUSES,
		filterIncidents,
		incidentTitle,
		sortIncidents,
		type IncidentCategory,
		type IncidentSeverity,
		type IncidentStatusFilter
	} from '../domain/incident';
	import { useIncidents, useShelterStaff } from '../application/queries';
	import { currentIncidentActor, formatDateTime } from './incident.ui-helpers';
	import EnumSelect from './enum-select.svelte';
	import IncidentSeverityBadge from './incident-severity-badge.svelte';
	import IncidentStatusBadge from './incident-status-badge.svelte';

	const { shelterCode }: { shelterCode: string } = $props();

	const PAGE_SIZE = 20;

	const incidentsQuery = useIncidents(() => shelterCode);
	const staffQuery = useShelterStaff(() => shelterCode);

	const STATUS_FILTERS = ['open', 'all', ...INCIDENT_STATUSES] as const;
	const STATUS_FILTER_LABELS: Record<IncidentStatusFilter, string> = {
		open: 'ยังไม่ปิด (ส่งเวร)',
		all: 'ทุกสถานะ',
		...INCIDENT_STATUS_LABELS
	};
	const SEVERITY_FILTERS = ['all', ...INCIDENT_SEVERITIES] as const;
	const CATEGORY_FILTERS = ['all', ...INCIDENT_CATEGORIES] as const;

	let status = $state<IncidentStatusFilter>('open');
	let severity = $state<IncidentSeverity | 'all'>('all');
	let category = $state<IncidentCategory | 'all'>('all');
	let mineOnly = $state(false);
	let query = $state('');
	let currentPage = $state(1);

	const me = currentIncidentActor().name;

	const staffNames = $derived(
		new Map((staffQuery.data ?? []).map((s) => [s.name, s.display_name ?? s.name]))
	);
	const items = $derived(
		sortIncidents(
			filterIncidents(incidentsQuery.data ?? [], {
				status,
				severity,
				category,
				assignedTo: mineOnly ? me : null,
				query
			})
		)
	);
	// Clamp instead of resetting in an effect — a filter change that shrinks the list lands on its last page.
	const pageCount = $derived(Math.max(1, Math.ceil(items.length / PAGE_SIZE)));
	const page = $derived(Math.min(currentPage, pageCount));
	const pageItems = $derived(items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE));

	const assigneeName = (user: string) => staffNames.get(user) ?? user;
</script>

<div class="space-y-4">
	<div class="relative">
		<Search
			class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
		/>
		<Input
			type="search"
			bind:value={query}
			aria-label="ค้นหาบันทึกเหตุการณ์"
			placeholder="ค้นหาหัวข้อเหตุการณ์ เลขที่บันทึก หรือจุดเกิดเหตุ..."
			class="h-11 rounded-xl bg-background pl-9 shadow-xs"
		/>
	</div>

	<div class="grid w-full grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
		<div class="space-y-2">
			<span class="text-xs font-semibold text-foreground">สถานะ</span>
			<EnumSelect bind:value={status} options={STATUS_FILTERS} labels={STATUS_FILTER_LABELS} />
		</div>
		<div class="space-y-2">
			<span class="text-xs font-semibold text-foreground">ความรุนแรง</span>
			<EnumSelect
				bind:value={severity}
				options={SEVERITY_FILTERS}
				labels={{ all: 'ทุกระดับ', ...INCIDENT_SEVERITY_LABELS }}
			/>
		</div>
		<div class="space-y-2">
			<span class="text-xs font-semibold text-foreground">หมวดหมู่</span>
			<EnumSelect
				bind:value={category}
				options={CATEGORY_FILTERS}
				labels={{ all: 'ทุกหมวดหมู่', ...INCIDENT_CATEGORY_LABELS }}
			/>
		</div>
		<div class="flex min-h-11 items-center gap-3 self-end">
			<Switch id="incident-mine-only" bind:checked={mineOnly} />
			<Label for="incident-mine-only" class="text-sm font-semibold text-foreground">
				เฉพาะเคสที่ฉันรับผิดชอบ
			</Label>
		</div>
	</div>

	{#if incidentsQuery.isLoading}
		<div class="flex items-center justify-center py-16">
			<p class="text-sm text-muted-foreground">กำลังโหลดข้อมูล...</p>
		</div>
	{:else if incidentsQuery.isError}
		<div
			class="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
			role="alert"
		>
			โหลดบันทึกเหตุการณ์ไม่สำเร็จ — ตรวจสอบการเชื่อมต่อแล้วลองใหม่
		</div>
	{:else if items.length === 0}
		<div
			class="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20"
		>
			<NotebookPen class="h-10 w-10 text-muted-foreground/30" />
			<p class="text-sm text-muted-foreground">
				{query.trim()
					? `ไม่พบบันทึกเหตุการณ์ที่ตรงกับ "${query.trim()}"`
					: status === 'open'
						? 'ไม่มีเคสค้างอยู่ในขณะนี้'
						: 'ไม่พบบันทึกเหตุการณ์ตามตัวกรอง'}
			</p>
		</div>
	{:else}
		<!-- Mobile card list (< md) -->
		<ul class="space-y-3 md:hidden">
			{#each pageItems as incident (incident._id)}
				<li>
					<a
						href={resolve(`/back-office/incidents/${encodeURIComponent(incident._id)}`)}
						class="block space-y-2 rounded-xl border border-slate-200/80 bg-white px-4 py-3 shadow-2xs transition-colors hover:border-slate-300 focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 focus-visible:outline-none"
					>
						<div class="flex flex-wrap items-center gap-2">
							<span class="text-sm font-bold text-foreground tabular-nums">
								{incident.incident_no}
							</span>
							<IncidentSeverityBadge severity={incident.severity} />
							<IncidentStatusBadge status={incident.current_status} />
						</div>
						<p class="font-semibold text-foreground">{incidentTitle(incident)}</p>
						<p class="text-sm text-muted-foreground">
							{INCIDENT_CATEGORY_LABELS[incident.category]}
						</p>
						<div class="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
							<span class="tabular-nums">{formatDateTime(incident.occurred_at)}</span>
							<span class="inline-flex items-center gap-1">
								<MapPin class="size-3.5" />
								{incident.location_detail}
							</span>
							<span class="inline-flex items-center gap-1">
								<UserRound class="size-3.5" />
								{assigneeName(incident.assigned_to)}
								{#if incident.assigned_to === me}(คุณ){/if}
							</span>
						</div>
					</a>
				</li>
			{/each}
		</ul>

		<!-- Desktop table (≥ md) -->
		<div class="hidden overflow-x-auto rounded-xl border border-border shadow-sm md:block">
			<Table.Root>
				<Table.Header>
					<Table.Row class="bg-muted/40 hover:bg-muted/40">
						<Table.Head class="font-semibold text-foreground">หัวข้อเหตุการณ์</Table.Head>
						<Table.Head class="font-semibold text-foreground">หมวดหมู่ / จุดเกิดเหตุ</Table.Head>
						<Table.Head class="font-semibold text-foreground">ความรุนแรง</Table.Head>
						<Table.Head class="font-semibold text-foreground">สถานะ</Table.Head>
						<Table.Head class="font-semibold text-foreground">เกิดเหตุเมื่อ</Table.Head>
						<Table.Head class="font-semibold text-foreground">ผู้รับผิดชอบ</Table.Head>
					</Table.Row>
				</Table.Header>
				<Table.Body>
					{#each pageItems as incident (incident._id)}
						<Table.Row class="transition-colors hover:bg-muted/20">
							<Table.Cell class="max-w-sm">
								<a
									href={resolve(`/back-office/incidents/${encodeURIComponent(incident._id)}`)}
									class="block truncate rounded-sm font-semibold text-foreground hover:underline focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:outline-none"
								>
									{incidentTitle(incident)}
								</a>
								<p class="text-xs text-muted-foreground tabular-nums">{incident.incident_no}</p>
							</Table.Cell>
							<Table.Cell class="max-w-xs">
								<p class="text-sm text-foreground">
									{INCIDENT_CATEGORY_LABELS[incident.category]}
								</p>
								<p class="truncate text-xs text-muted-foreground">{incident.location_detail}</p>
							</Table.Cell>
							<Table.Cell><IncidentSeverityBadge severity={incident.severity} /></Table.Cell>
							<Table.Cell><IncidentStatusBadge status={incident.current_status} /></Table.Cell>
							<Table.Cell class="text-sm text-muted-foreground tabular-nums">
								{formatDateTime(incident.occurred_at)}
							</Table.Cell>
							<Table.Cell class="text-sm text-foreground">
								{assigneeName(incident.assigned_to)}
								{#if incident.assigned_to === me}
									<span class="text-xs text-muted-foreground">(คุณ)</span>
								{/if}
							</Table.Cell>
						</Table.Row>
					{/each}
				</Table.Body>
			</Table.Root>
		</div>

		<PaginationControls
			bind:page={() => page, (next) => (currentPage = next)}
			count={items.length}
			perPage={PAGE_SIZE}
		/>
	{/if}
</div>
