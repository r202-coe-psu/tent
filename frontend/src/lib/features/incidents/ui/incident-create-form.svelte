<script lang="ts">
	import * as Form from '$lib/components/ui/form/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Textarea } from '$lib/components/ui/textarea/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import * as Card from '$lib/components/ui/card/index.js';
	import DatePicker from '$lib/components/date-picker.svelte';
	import TimePicker from '$lib/components/time-picker.svelte';
	import { resolve } from '$app/paths';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import {
		COMPLAINANT_TYPE_LABELS,
		COMPLAINANT_TYPES,
		INCIDENT_CATEGORIES,
		INCIDENT_CATEGORY_LABELS,
		INCIDENT_SEVERITIES,
		INCIDENT_SEVERITY_LABELS,
		RESPONDENT_STATUS_LABELS,
		RESPONDENT_STATUSES,
		INCIDENT_TITLE_MAX,
		incidentCreateSchema,
		type ShelterIncident
	} from '../domain/incident';
	import { useCreateIncident } from '../application/queries';
	import { currentIncidentActor, localInputToIso, nowLocalInput } from './incident.ui-helpers';
	import EnumSelect from './enum-select.svelte';
	import EvacueePicker from './evacuee-picker.svelte';

	const { oncreated }: { oncreated?: (incident: ShelterIncident) => void } = $props();

	const createMutation = useCreateIncident();

	const LABEL = 'text-sm font-semibold text-foreground';
	const CARD = 'gap-4 border-border/80 shadow-sm';
	const CARD_TITLE = 'text-lg font-bold text-foreground';

	const form = superForm(
		defaults(
			{
				title: '',
				location_detail: '',
				category: 'other' as const,
				severity: 'medium' as const,
				occurred_at: nowLocalInput(),
				description: '',
				complainant: { type: 'evacuee' as const, evacuee_id: null, name_or_detail: null },
				respondent: {
					status: 'unknown' as const,
					evacuee_id: null,
					name_or_detail: null,
					unknown_description: null
				}
			},
			zod4(incidentCreateSchema)
		),
		{
			SPA: true,
			dataType: 'json',
			validators: zod4(incidentCreateSchema),
			resetForm: false,
			onUpdate: async ({ form: validated }) => {
				if (!validated.valid) {
					toast.error('กรุณาตรวจสอบข้อมูลในฟอร์ม');
					return;
				}
				try {
					const created = await createMutation.mutateAsync({
						data: { ...validated.data, occurred_at: localInputToIso(validated.data.occurred_at) },
						actor: currentIncidentActor()
					});
					toast.success(`บันทึกเหตุการณ์ ${created.incident_no} แล้ว — คุณเป็นผู้รับผิดชอบเคสนี้`);
					oncreated?.(created);
				} catch (err) {
					toast.error(err instanceof Error ? err.message : 'บันทึกเหตุการณ์ไม่สำเร็จ');
				}
			}
		}
	);

	const { form: formData, errors, submitting, enhance } = form;

	const complainantType = $derived($formData.complainant.type);
	const respondentStatus = $derived($formData.respondent.status);
</script>

<form method="POST" use:enhance class="space-y-6">
	<Card.Root class={CARD}>
		<Card.Header>
			<Card.Title class={CARD_TITLE}>ข้อมูลเหตุการณ์</Card.Title>
			<Card.Description>เขียนตามข้อเท็จจริงที่พบ — แก้ไขภายหลังไม่ได้</Card.Description>
		</Card.Header>
		<Card.Content class="space-y-4">
			<Form.Field {form} name="title">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class={LABEL}
							>หัวข้อเหตุการณ์ <span class="text-destructive">*</span></Form.Label
						>
						<Input
							{...props}
							bind:value={$formData.title}
							maxlength={INCIDENT_TITLE_MAX}
							placeholder="เช่น ชายชุดดำขโมยรองเท้าหน้าโรงอาหาร"
							class="h-11 rounded-xl bg-background text-sm shadow-xs"
						/>
					{/snippet}
				</Form.Control>
				<Form.Description class="text-xs">
					สั้น ๆ ให้ค้นหาเจอง่าย — ไม่ต้องใส่ชื่อ-นามสกุลผู้เสียหาย
				</Form.Description>
				<Form.FieldErrors />
			</Form.Field>

			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<Form.Field {form} name="category">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class={LABEL}>หมวดหมู่ <span class="text-destructive">*</span></Form.Label
							>
							<EnumSelect
								bind:value={$formData.category}
								options={INCIDENT_CATEGORIES}
								labels={INCIDENT_CATEGORY_LABELS}
								triggerProps={props}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="severity">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class={LABEL}
								>ระดับความรุนแรง <span class="text-destructive">*</span></Form.Label
							>
							<EnumSelect
								bind:value={$formData.severity}
								options={INCIDENT_SEVERITIES}
								labels={INCIDENT_SEVERITY_LABELS}
								triggerProps={props}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="occurred_at">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class={LABEL}
								>วันเวลาที่เกิดเหตุ <span class="text-destructive">*</span></Form.Label
							>
							<div class="grid grid-cols-[3fr_2fr] gap-2">
								<DatePicker
									id={props.id}
									bind:value={
										() => $formData.occurred_at.slice(0, 10),
										(date) =>
											($formData.occurred_at = `${date}T${$formData.occurred_at.slice(11, 16) || '00:00'}`)
									}
									class="rounded-xl shadow-xs"
								/>
								<TimePicker
									minuteStep={1}
									bind:value={
										() => $formData.occurred_at.slice(11, 16),
										(time) =>
											($formData.occurred_at = `${$formData.occurred_at.slice(0, 10)}T${time}`)
									}
									class="rounded-xl shadow-xs"
								/>
							</div>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="location_detail">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class={LABEL}
								>จุดเกิดเหตุ <span class="text-destructive">*</span></Form.Label
							>
							<Input
								{...props}
								bind:value={$formData.location_detail}
								placeholder="เช่น โซนเต็นท์ชาย แถว 3, หน้าโรงอาหาร"
								class="h-11 rounded-xl bg-background text-sm shadow-xs"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
			</div>

			<Form.Field {form} name="description">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class={LABEL}
							>รายละเอียดตามข้อเท็จจริง <span class="text-destructive">*</span></Form.Label
						>
						<Textarea
							{...props}
							bind:value={$formData.description}
							rows={4}
							placeholder="เกิดอะไรขึ้น ใครพบเห็น ได้ทำอะไรไปแล้วบ้าง"
							class="rounded-xl bg-background text-base shadow-xs"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		</Card.Content>
	</Card.Root>

	<div class="grid grid-cols-1 gap-6 lg:grid-cols-2">
		<Card.Root class={CARD}>
			<Card.Header>
				<Card.Title class={CARD_TITLE}>ฝั่งผู้แจ้ง / ผู้เสียหาย</Card.Title>
				<Card.Description>ไม่ถูกบันทึกเป็นประวัติพฤติกรรมเชิงลบ</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<Form.Field {form} name="complainant.type">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class={LABEL}>ประเภท <span class="text-destructive">*</span></Form.Label>
							<EnumSelect
								bind:value={$formData.complainant.type}
								options={COMPLAINANT_TYPES}
								labels={COMPLAINANT_TYPE_LABELS}
								triggerProps={props}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				{#if complainantType === 'evacuee'}
					<Form.Field {form} name="complainant.evacuee_id">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class={LABEL}
									>ผู้เข้าพัก <span class="text-destructive">*</span></Form.Label
								>
								<EvacueePicker
									id={props.id}
									bind:value={$formData.complainant.evacuee_id}
									invalid={!!$errors.complainant?.evacuee_id}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				{:else if complainantType !== 'anonymous'}
					<Form.Field {form} name="complainant.name_or_detail">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class={LABEL}>
									{#if complainantType === 'shelter_property'}
										ทรัพย์สินที่เสียหาย
									{:else}
										ชื่อ / ข้อมูลติดต่อ <span class="text-destructive">*</span>
									{/if}
								</Form.Label>
								<Input
									{...props}
									value={$formData.complainant.name_or_detail ?? ''}
									oninput={(e) => ($formData.complainant.name_or_detail = e.currentTarget.value)}
									placeholder={complainantType === 'shelter_property'
										? 'เช่น ประตูห้องน้ำโซน B'
										: 'ชื่อ-นามสกุล'}
									class="h-11 rounded-xl bg-background text-sm shadow-xs"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				{/if}
			</Card.Content>
		</Card.Root>

		<Card.Root class={CARD}>
			<Card.Header>
				<Card.Title class={CARD_TITLE}>ฝั่งคู่กรณี / ผู้ถูกร้องเรียน</Card.Title>
				<Card.Description>ยังไม่ทราบตัวตนได้ — ระบุภายหลังจากหน้ารายละเอียดเคส</Card.Description>
			</Card.Header>
			<Card.Content class="space-y-4">
				<Form.Field {form} name="respondent.status">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class={LABEL}
								>สถานะคู่กรณี <span class="text-destructive">*</span></Form.Label
							>
							<EnumSelect
								bind:value={$formData.respondent.status}
								options={RESPONDENT_STATUSES}
								labels={RESPONDENT_STATUS_LABELS}
								triggerProps={props}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				{#if respondentStatus === 'known_evacuee'}
					<Form.Field {form} name="respondent.evacuee_id">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class={LABEL}
									>ผู้เข้าพัก <span class="text-destructive">*</span></Form.Label
								>
								<EvacueePicker
									id={props.id}
									bind:value={$formData.respondent.evacuee_id}
									invalid={!!$errors.respondent?.evacuee_id}
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				{:else if respondentStatus === 'known_external'}
					<Form.Field {form} name="respondent.name_or_detail">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class={LABEL}
									>ชื่อ / ข้อมูลติดต่อ <span class="text-destructive">*</span></Form.Label
								>
								<Input
									{...props}
									value={$formData.respondent.name_or_detail ?? ''}
									oninput={(e) => ($formData.respondent.name_or_detail = e.currentTarget.value)}
									class="h-11 rounded-xl bg-background text-sm shadow-xs"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				{:else if respondentStatus === 'unknown'}
					<Form.Field {form} name="respondent.unknown_description">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class={LABEL}>รูปพรรณสัณฐาน</Form.Label>
								<Textarea
									{...props}
									value={$formData.respondent.unknown_description ?? ''}
									oninput={(e) =>
										($formData.respondent.unknown_description = e.currentTarget.value)}
									rows={3}
									placeholder="เช่น ชายสูงประมาณ 170 ซม. สวมเสื้อสีแดง"
									class="rounded-xl bg-background text-base shadow-xs"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				{/if}
			</Card.Content>
		</Card.Root>
	</div>

	<div
		class="flex flex-col-reverse gap-2 border-t border-border/60 pt-5 sm:flex-row sm:justify-end"
	>
		<Button variant="outline" href={resolve('/back-office/incidents')} class="min-h-11 rounded-xl">
			ยกเลิก
		</Button>
		<Form.Button
			disabled={$submitting}
			class="min-h-11 gap-2 rounded-xl px-6 font-semibold shadow-sm"
		>
			{$submitting ? 'กำลังบันทึก…' : 'บันทึกเหตุการณ์'}
		</Form.Button>
	</div>
</form>
