<script lang="ts">
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Combobox } from '$lib/components/ui/combobox/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { STAFF_CAPABILITIES, SHELTER_CAPABILITIES } from '$lib/auth/roles';
	import { editUserSchema, type EditUserInput } from '../domain/schema';
	import { useShelters } from '$lib/features/shelters';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Save } from '@lucide/svelte';
	import type { UserSummary } from '../data/users.api';
	import { untrack } from 'svelte';

	const sheltersQuery = useShelters();

	let {
		user,
		onsubmit,
		oncancel,
		isSA = false,
		lockedShelterCode = null,
		pending = false
	}: {
		user: UserSummary;
		onsubmit: (input: EditUserInput) => void;
		oncancel?: () => void;
		/** System admin: may grant shelter_manager as well as staff capabilities. */
		isSA?: boolean;
		/** When set, this code is always shelter_id — hide the picker even for SA. */
		lockedShelterCode?: string | null;
		pending?: boolean;
	} = $props();

	const shelterLocked = $derived(Boolean(lockedShelterCode));
	// SA may grant shelter_manager too; a manager only staff capabilities.
	const capabilities = $derived(isSA ? SHELTER_CAPABILITIES : STAFF_CAPABILITIES);

	// Find the user's capability from their roles
	const userCapability = $derived(
		user.roles.find((r) => (capabilities as readonly string[]).includes(r)) ?? capabilities[0]
	);

	const form = superForm(
		defaults(
			untrack(() => ({
				username: user.name,
				password: '',
				display_name: user.display_name ?? '',
				capability: userCapability as EditUserInput['capability'],
				shelter_id: lockedShelterCode ?? user.shelter_id ?? undefined,
				affiliation_tags: $state.snapshot(user.affiliation_tags)
			})),
			zod4(editUserSchema)
		),
		{
			SPA: true,
			validators: zod4(editUserSchema),
			resetForm: false,
			onUpdate: async ({ form }) => {
				if (!form.valid) return;
				const shelter_id = lockedShelterCode ?? (isSA ? form.data.shelter_id : undefined);
				onsubmit({ ...form.data, shelter_id });
			}
		}
	);

	const { form: formData, submitting } = form;

	const shelterItems = $derived(
		(sheltersQuery.data ?? []).map((s) => ({
			value: s.code,
			label: `${s.name} (${s.code})`
		}))
	);

	const fieldControlClass = 'h-11 w-full rounded-md border border-input bg-slate-50 px-3 text-sm';
</script>

<form method="POST" use:form.enhance>
	<Field.FieldGroup class="space-y-4">
		<Form.Field {form} name="username">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="font-bold">Username</Form.Label>
					<Input
						{...props}
						bind:value={$formData.username}
						disabled
						class="h-11 cursor-not-allowed bg-slate-100 text-slate-500"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="display_name">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="font-bold">ชื่อ-สกุล</Form.Label>
					<Input
						{...props}
						bind:value={$formData.display_name}
						class="h-11 bg-slate-50"
						placeholder="นาย สมชาย"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="password">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="font-bold">รหัสผ่านใหม่ (หากต้องการเปลี่ยน)</Form.Label>
					<Input
						{...props}
						type="password"
						bind:value={$formData.password}
						class="h-11 bg-slate-50"
						placeholder="••••••"
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="capability">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="font-bold">บทบาท (Role)</Form.Label>
					<Select.Root type="single" bind:value={$formData.capability}>
						<Select.Trigger {...props} class={fieldControlClass}>
							{$formData.capability}
						</Select.Trigger>
						<Select.Content>
							{#each capabilities as cap (cap)}
								<Select.Item value={cap} label={cap} />
							{/each}
						</Select.Content>
					</Select.Root>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		{#if isSA && !shelterLocked}
			<Form.Field {form} name="shelter_id">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class="font-bold">Shelter ID (Code)</Form.Label>
						<Combobox
							items={shelterItems}
							bind:value={
								() => $formData.shelter_id ?? '', (v) => ($formData.shelter_id = v || undefined)
							}
							placeholder={sheltersQuery.isLoading ? 'กำลังโหลด...' : '-- Select Shelter --'}
							searchPlaceholder="ค้นหาศูนย์พักพิง..."
							emptyText="ไม่พบศูนย์พักพิง"
							disabled={sheltersQuery.isLoading}
							controlProps={props}
							class={fieldControlClass}
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		{:else}
			<Field.Field>
				<Field.Label class="font-bold">Shelter</Field.Label>
				<p class="text-sm text-muted-foreground">{lockedShelterCode ?? '—'}</p>
			</Field.Field>
		{/if}

		<div class="mt-2 flex gap-4 pt-4">
			{#if oncancel}
				<Button
					type="button"
					variant="outline"
					class="h-11 flex-1 border-slate-200"
					onclick={oncancel}
				>
					ยกเลิก
				</Button>
			{/if}
			<Form.Button
				disabled={$submitting || pending}
				class="h-11 flex-1 bg-slate-500 hover:bg-slate-600"
			>
				<Save class="mr-2 h-4 w-4" />
				บันทึกข้อมูล
			</Form.Button>
		</div>
	</Field.FieldGroup>
</form>
