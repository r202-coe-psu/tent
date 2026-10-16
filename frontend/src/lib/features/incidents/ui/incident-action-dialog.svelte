<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { toast } from 'svelte-sonner';
	import {
		INCIDENT_STATUS_LABELS,
		RESPONDENT_STATUS_LABELS,
		incidentNoteSchema,
		type ShelterIncident
	} from '../domain/incident';
	import { useIncidentAction, useShelterStaff, type IncidentAction } from '../application/queries';
	import { currentIncidentActor, type ActionMode } from './incident.ui-helpers';
	import EnumSelect from './enum-select.svelte';
	import SearchSelect from '$lib/components/search-select.svelte';
	import EvacueePicker from './evacuee-picker.svelte';

	let {
		open = $bindable(false),
		mode,
		incident
	}: { open?: boolean; mode: ActionMode; incident: ShelterIncident } = $props();

	const actionMutation = useIncidentAction();
	const staffQuery = useShelterStaff(() => incident.shelter_code);

	let note = $state('');
	let assignee = $state('');
	let respondentStatus = $state<'known_evacuee' | 'known_external' | undefined>('known_evacuee');
	let respondentEvacuee = $state<string | null>(null);
	let respondentName = $state('');
	let error = $state<string | null>(null);

	const IDENTIFY_OPTIONS = ['known_evacuee', 'known_external'] as const;

	// Label carries the username too — SearchSelect filters on the label, so either can be typed.
	const staffOptions = $derived(
		(staffQuery.data ?? [])
			.filter((s) => s.name !== incident.assigned_to)
			.map((s) => ({
				value: s.name,
				label:
					s.display_name && s.display_name !== s.name ? `${s.display_name} (${s.name})` : s.name
			}))
	);

	const title = $derived(
		mode.kind === 'status'
			? `เปลี่ยนสถานะเป็น "${INCIDENT_STATUS_LABELS[mode.to]}"`
			: mode.kind === 'reassign'
				? 'ส่งต่อเคส / มอบหมายผู้รับผิดชอบ'
				: mode.kind === 'identify'
					? 'ระบุคู่กรณี'
					: 'เพิ่มบันทึกสังเกตการณ์'
	);
	const noteLabel = $derived(
		mode.kind === 'reassign'
			? 'เหตุผลในการส่งต่อ'
			: mode.kind === 'note'
				? 'บันทึก / เบาะแส'
				: 'เหตุผล / สิ่งที่ได้ดำเนินการ'
	);

	function buildAction(): IncidentAction | string {
		const parsed = incidentNoteSchema.safeParse(note);
		if (!parsed.success) return parsed.error.issues[0].message;
		switch (mode.kind) {
			case 'status':
				return { kind: 'status', to: mode.to, note: parsed.data };
			case 'note':
				return { kind: 'note', note: parsed.data };
			case 'reassign':
				if (!assignee) return 'กรุณาเลือกผู้รับผิดชอบคนใหม่';
				return { kind: 'reassign', to: assignee, note: parsed.data };
			case 'identify':
				if (respondentStatus === 'known_evacuee' && !respondentEvacuee)
					return 'กรุณาเลือกผู้เข้าพัก';
				if (respondentStatus === 'known_external' && !respondentName.trim())
					return 'กรุณาระบุชื่อ / ข้อมูลติดต่อ';
				return {
					kind: 'identify',
					respondent: {
						status: respondentStatus ?? 'known_evacuee',
						evacuee_id: respondentEvacuee,
						name_or_detail: respondentName
					},
					note: parsed.data
				};
		}
	}

	async function submit(event: SubmitEvent) {
		event.preventDefault();
		const action = buildAction();
		if (typeof action === 'string') {
			error = action;
			return;
		}
		error = null;
		try {
			await actionMutation.mutateAsync({
				id: incident._id,
				action,
				actor: currentIncidentActor()
			});
			toast.success('บันทึกลงไทม์ไลน์แล้ว');
			note = '';
			open = false;
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'บันทึกไม่สำเร็จ');
		}
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[90vh] overflow-y-auto rounded-2xl sm:max-w-lg">
		<Dialog.Header class="border-b border-border/60 pb-4">
			<Dialog.Title class="text-xl font-bold">{title}</Dialog.Title>
			<Dialog.Description>
				{incident.incident_no} — ทุกการกระทำจะถูกบันทึกในไทม์ไลน์พร้อมชื่อผู้ทำรายการ
			</Dialog.Description>
		</Dialog.Header>

		<form class="space-y-4" onsubmit={submit}>
			{#if mode.kind === 'reassign'}
				<Field.Field>
					<Field.Label for="incident-reassign-to" class="text-sm font-semibold text-foreground"
						>ผู้รับผิดชอบคนใหม่ <span class="text-destructive">*</span></Field.Label
					>
					{#if staffQuery.isLoading}
						<p class="text-sm text-muted-foreground">กำลังโหลดรายชื่อเจ้าหน้าที่…</p>
					{:else if staffQuery.isError}
						<p class="text-sm text-destructive">โหลดรายชื่อเจ้าหน้าที่ไม่สำเร็จ</p>
					{:else if staffOptions.length === 0}
						<p class="text-sm text-muted-foreground">ไม่มีเจ้าหน้าที่คนอื่นในศูนย์นี้</p>
					{:else}
						<SearchSelect
							name="assigned_to"
							bind:value={assignee}
							options={staffOptions}
							placeholder="-- เลือกเจ้าหน้าที่ --"
							searchPlaceholder="พิมพ์ชื่อหรือ username เพื่อค้นหา..."
							emptyText="ไม่พบเจ้าหน้าที่ที่ตรงกับคำค้น"
							controlProps={{ id: 'incident-reassign-to' }}
							class="h-11 rounded-xl bg-background shadow-xs"
						/>
					{/if}
				</Field.Field>
			{/if}

			{#if mode.kind === 'identify'}
				<Field.Field>
					<Field.Label class="text-sm font-semibold text-foreground"
						>ผลการระบุตัวตน <span class="text-destructive">*</span></Field.Label
					>
					<EnumSelect
						bind:value={respondentStatus}
						options={IDENTIFY_OPTIONS}
						labels={RESPONDENT_STATUS_LABELS}
					/>
				</Field.Field>
				{#if respondentStatus === 'known_evacuee'}
					<Field.Field>
						<Field.Label class="text-sm font-semibold text-foreground" for="identify-evacuee"
							>ผู้เข้าพัก <span class="text-destructive">*</span></Field.Label
						>
						<EvacueePicker id="identify-evacuee" bind:value={respondentEvacuee} />
					</Field.Field>
				{:else}
					<Field.Field>
						<Field.Label class="text-sm font-semibold text-foreground" for="identify-name"
							>ชื่อ / ข้อมูลติดต่อ <span class="text-destructive">*</span></Field.Label
						>
						<Input
							id="identify-name"
							bind:value={respondentName}
							class="h-11 rounded-xl bg-background text-sm shadow-xs"
						/>
					</Field.Field>
				{/if}
			{/if}

			<Field.Field data-invalid={!!error}>
				<Field.Label class="text-sm font-semibold text-foreground" for="incident-action-note"
					>{noteLabel} <span class="text-destructive">*</span></Field.Label
				>
				<Textarea
					id="incident-action-note"
					bind:value={note}
					rows={4}
					aria-invalid={!!error}
					class="rounded-xl bg-background text-base shadow-xs"
				/>
				{#if error}
					<Field.Error>{error}</Field.Error>
				{/if}
			</Field.Field>

			<Dialog.Footer class="gap-2">
				<Button
					type="button"
					variant="outline"
					class="min-h-11 rounded-xl"
					onclick={() => (open = false)}
				>
					ยกเลิก
				</Button>
				<Button
					type="submit"
					class="min-h-11 rounded-xl font-semibold"
					variant={mode.kind === 'status' && mode.to === 'cancelled' ? 'destructive' : 'default'}
					disabled={actionMutation.isPending}
				>
					{actionMutation.isPending ? 'กำลังบันทึก…' : 'ยืนยัน'}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
