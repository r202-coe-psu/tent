<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import ArrowRightLeft from '@lucide/svelte/icons/arrow-right-left';
	import MessageSquarePlus from '@lucide/svelte/icons/message-square-plus';
	import UserSearch from '@lucide/svelte/icons/user-search';
	import NotebookPen from '@lucide/svelte/icons/notebook-pen';
	import {
		COMPLAINANT_TYPE_LABELS,
		INCIDENT_CATEGORY_LABELS,
		INCIDENT_STATUS_LABELS,
		RESPONDENT_STATUS_LABELS,
		TIMELINE_ENTRY_TYPE_LABELS,
		incidentTitle,
		isTerminalStatus,
		type IncidentStatus
	} from '../domain/incident';
	import {
		availableTransitions,
		canAddNote,
		canIdentifyRespondent,
		canReassign,
		isIncidentOwner
	} from '../domain/incident.policy';
	import { useIncident, useShelterStaff } from '../application/queries';
	import { currentIncidentActor, formatDateTime, type ActionMode } from './incident.ui-helpers';
	import EvacueeName from './evacuee-name.svelte';
	import IncidentActionDialog from './incident-action-dialog.svelte';
	import IncidentSeverityBadge from './incident-severity-badge.svelte';
	import IncidentStatusBadge from './incident-status-badge.svelte';

	const CARD = 'gap-4 border-border/80 shadow-sm';
	const CARD_TITLE = 'text-lg font-bold text-foreground';

	const { shelterCode, id }: { shelterCode: string; id: string } = $props();

	const incidentQuery = useIncident(
		() => shelterCode,
		() => id
	);
	const staffQuery = useShelterStaff(() => shelterCode);

	const actor = currentIncidentActor();
	const incident = $derived(incidentQuery.data ?? null);
	const staffNames = $derived(
		new Map((staffQuery.data ?? []).map((s) => [s.name, s.display_name ?? s.name]))
	);
	const nameOf = (user: string | undefined): string =>
		user ? (staffNames.get(user) ?? user) : '—';

	const transitions = $derived(incident ? availableTransitions(incident, actor) : []);
	const timeline = $derived(incident ? [...incident.timeline].reverse() : []);

	const TRANSITION_VERB: Record<IncidentStatus, string> = {
		reported: 'รับแจ้งเหตุ',
		action_in_progress: 'เริ่ม / กลับมาดำเนินการ',
		resolved: 'จัดการเรียบร้อย',
		closed: 'ปิดเคส',
		cancelled: 'ยกเลิกเคส'
	};

	let dialogOpen = $state(false);
	let mode = $state<ActionMode>({ kind: 'note' });

	function openAction(next: ActionMode) {
		mode = next;
		dialogOpen = true;
	}
</script>

{#if incidentQuery.isLoading}
	<div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
		<Skeleton class="h-72 w-full rounded-xl lg:col-span-7" />
		<Skeleton class="h-72 w-full rounded-xl lg:col-span-5" />
	</div>
{:else if incidentQuery.isError}
	<div
		class="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
		role="alert"
	>
		โหลดบันทึกเหตุการณ์ไม่สำเร็จ — ตรวจสอบการเชื่อมต่อแล้วลองใหม่
	</div>
{:else if !incident}
	<div
		class="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border py-20"
	>
		<NotebookPen class="h-10 w-10 text-muted-foreground/30" />
		<p class="text-sm text-muted-foreground">ไม่พบบันทึกเหตุการณ์นี้</p>
	</div>
{:else}
	<div class="grid grid-cols-1 gap-6 lg:grid-cols-12">
		<div class="space-y-6 lg:col-span-7">
			<Card.Root class={CARD}>
				<Card.Header class="gap-3">
					<div class="flex flex-wrap items-center gap-2">
						<span class="text-sm font-bold text-muted-foreground tabular-nums">
							{incident.incident_no}
						</span>
						<IncidentSeverityBadge severity={incident.severity} />
						<IncidentStatusBadge status={incident.current_status} />
					</div>
					<Card.Title class="text-xl leading-snug font-bold text-foreground">
						{incidentTitle(incident)}
					</Card.Title>
					<Card.Description>{INCIDENT_CATEGORY_LABELS[incident.category]}</Card.Description>
				</Card.Header>
				<Card.Content class="space-y-5">
					<p class="text-base whitespace-pre-line text-foreground">{incident.description}</p>
					<dl class="grid grid-cols-1 gap-4 border-t border-border/60 pt-4 text-sm sm:grid-cols-2">
						<div class="space-y-0.5">
							<dt class="text-xs font-semibold text-muted-foreground">เกิดเหตุเมื่อ</dt>
							<dd class="text-foreground tabular-nums">{formatDateTime(incident.occurred_at)}</dd>
						</div>
						<div class="space-y-0.5">
							<dt class="text-xs font-semibold text-muted-foreground">จุดเกิดเหตุ</dt>
							<dd class="text-foreground">{incident.location_detail}</dd>
						</div>
						<div class="space-y-0.5">
							<dt class="text-xs font-semibold text-muted-foreground">ผู้บันทึก</dt>
							<dd class="text-foreground">{nameOf(incident.reported_by)}</dd>
						</div>
						<div class="space-y-0.5">
							<dt class="text-xs font-semibold text-muted-foreground">ผู้รับผิดชอบปัจจุบัน</dt>
							<dd class="text-foreground">
								{nameOf(incident.assigned_to)}
								{#if isIncidentOwner(incident, actor)}
									<span class="text-muted-foreground">(คุณ)</span>
								{/if}
							</dd>
						</div>
					</dl>
				</Card.Content>
			</Card.Root>

			<div class="grid grid-cols-1 gap-6 sm:grid-cols-2">
				<Card.Root class={CARD}>
					<Card.Header>
						<Card.Title class="text-base font-bold text-foreground">ผู้แจ้ง / ผู้เสียหาย</Card.Title
						>
						<Card.Description>{COMPLAINANT_TYPE_LABELS[incident.complainant.type]}</Card.Description
						>
					</Card.Header>
					<Card.Content class="space-y-1 text-sm">
						{#if incident.complainant.evacuee_id}
							<p class="font-semibold text-foreground">
								<EvacueeName evacueeId={incident.complainant.evacuee_id} />
							</p>
						{/if}
						{#if incident.complainant.name_or_detail}
							<p class="text-foreground">{incident.complainant.name_or_detail}</p>
						{/if}
						{#if !incident.complainant.evacuee_id && !incident.complainant.name_or_detail}
							<p class="text-muted-foreground">—</p>
						{/if}
					</Card.Content>
				</Card.Root>

				<Card.Root class={CARD}>
					<Card.Header>
						<Card.Title class="text-base font-bold text-foreground">
							คู่กรณี / ผู้ถูกร้องเรียน
						</Card.Title>
						<Card.Description>
							{RESPONDENT_STATUS_LABELS[incident.respondent.status]}
						</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-3 text-sm">
						{#if incident.respondent.evacuee_id}
							<p class="font-semibold text-foreground">
								<EvacueeName evacueeId={incident.respondent.evacuee_id} />
							</p>
						{/if}
						{#if incident.respondent.name_or_detail}
							<p class="text-foreground">{incident.respondent.name_or_detail}</p>
						{/if}
						{#if incident.respondent.unknown_description}
							<p class="text-muted-foreground">
								<span class="font-semibold text-foreground">รูปพรรณ:</span>
								{incident.respondent.unknown_description}
							</p>
						{/if}
						{#if canIdentifyRespondent(incident, actor)}
							<Button
								variant="outline"
								class="min-h-11 w-full gap-2 rounded-xl"
								onclick={() => openAction({ kind: 'identify' })}
							>
								<UserSearch class="size-4" /> ระบุคู่กรณี
							</Button>
						{/if}
					</Card.Content>
				</Card.Root>
			</div>
		</div>

		<div class="space-y-6 lg:col-span-5">
			<Card.Root class={CARD}>
				<Card.Header>
					<Card.Title class={CARD_TITLE}>การดำเนินการ</Card.Title>
				</Card.Header>
				<Card.Content class="space-y-3">
					{#if isTerminalStatus(incident.current_status)}
						<p
							class="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground"
						>
							เคสนี้{INCIDENT_STATUS_LABELS[incident.current_status]}แล้ว — แก้ไขเพิ่มเติมไม่ได้
						</p>
					{:else}
						<div class="flex flex-col gap-2">
							{#each transitions as to (to)}
								<Button
									class="min-h-11 w-full rounded-xl font-semibold"
									variant={to === 'cancelled' ? 'destructive' : 'default'}
									onclick={() => openAction({ kind: 'status', to })}
								>
									{TRANSITION_VERB[to]}
								</Button>
							{/each}
							{#if canReassign(incident, actor)}
								<Button
									variant="outline"
									class="min-h-11 w-full gap-2 rounded-xl"
									onclick={() => openAction({ kind: 'reassign' })}
								>
									<ArrowRightLeft class="size-4" /> ส่งต่อเคส
								</Button>
							{/if}
							{#if canAddNote(incident, actor)}
								<Button
									variant="outline"
									class="min-h-11 w-full gap-2 rounded-xl"
									onclick={() => openAction({ kind: 'note' })}
								>
									<MessageSquarePlus class="size-4" /> เพิ่มบันทึกสังเกตการณ์
								</Button>
							{/if}
						</div>
						{#if transitions.length === 0 && !canReassign(incident, actor)}
							<p class="text-sm text-muted-foreground">
								เฉพาะผู้รับผิดชอบเคสหรือผู้จัดการศูนย์เท่านั้นที่เปลี่ยนสถานะได้ —
								คุณเพิ่มบันทึกเบาะแสได้
							</p>
						{/if}
					{/if}
				</Card.Content>
			</Card.Root>

			<Card.Root class={CARD}>
				<Card.Header>
					<Card.Title class={CARD_TITLE}>ไทม์ไลน์</Card.Title>
					<Card.Description>ล่าสุดอยู่บนสุด</Card.Description>
				</Card.Header>
				<Card.Content>
					<ol class="space-y-3">
						{#each timeline as entry (`${entry.timestamp}|${entry.actor_id}|${entry.type}`)}
							<li class="space-y-1 rounded-xl border border-border/80 px-4 py-3">
								<div class="flex flex-wrap items-center justify-between gap-2 text-sm">
									<span class="font-semibold text-foreground">
										{TIMELINE_ENTRY_TYPE_LABELS[entry.type]}
										{#if entry.type === 'status_change' && entry.to_status}
											→ {INCIDENT_STATUS_LABELS[entry.to_status]}
										{:else if entry.type === 'reassignment'}
											→ {nameOf(entry.to_assignee)}
										{/if}
									</span>
									<span class="text-xs text-muted-foreground tabular-nums">
										{formatDateTime(entry.timestamp)}
									</span>
								</div>
								<p class="text-sm whitespace-pre-line text-foreground">{entry.details}</p>
								<p class="text-xs text-muted-foreground">โดย {nameOf(entry.actor_id)}</p>
							</li>
						{/each}
						<li class="space-y-1 rounded-xl border border-border/80 bg-muted/40 px-4 py-3">
							<div class="flex flex-wrap items-center justify-between gap-2 text-sm">
								<span class="font-semibold text-foreground">เปิดบันทึกเหตุการณ์</span>
								<span class="text-xs text-muted-foreground tabular-nums">
									{formatDateTime(incident.created_at)}
								</span>
							</div>
							<p class="text-xs text-muted-foreground">โดย {nameOf(incident.reported_by)}</p>
						</li>
					</ol>
				</Card.Content>
			</Card.Root>
		</div>
	</div>

	<IncidentActionDialog bind:open={dialogOpen} {mode} {incident} />
{/if}
