<script lang="ts">
	import { untrack } from 'svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Combobox } from '$lib/components/ui/combobox/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { defaults, setError, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		STAFF_CAPABILITIES,
		SHELTER_CAPABILITIES,
		SA_GRANTABLE_CAPABILITIES,
		isAppSystemAdmin,
		roleDisplayLabel,
		SYSTEM_ADMIN
	} from '$lib/auth/roles';
	import { createUserSchema, editUserSchema, type UserFormInput } from '../domain/schema';
	import type { UserSummary } from '../data/users.api';
	import { useShelters } from '$lib/features/shelters';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Save } from '@lucide/svelte';
	import Building2 from '@lucide/svelte/icons/building-2';
	import CircleAlert from '@lucide/svelte/icons/circle-alert';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import Lock from '@lucide/svelte/icons/lock';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';

	const sheltersQuery = useShelters();

	let {
		user,
		onsubmit,
		oncancel,
		isSA = false,
		allowSystemAdminRole = false,
		lockedShelterCode = null,
		pending = false
	}: {
		/** Omit to create a user; pass one to edit it (username becomes read-only). */
		user?: UserSummary;
		/** Rejects with the reason the save failed — shown as a form-level error. */
		onsubmit: (input: UserFormInput) => Promise<void> | void;
		oncancel?: () => void;
		/** System admin: may grant shelter_manager as well as staff capabilities. */
		isSA?: boolean;
		/** Portal-only: include `system_admin` in the role picker. */
		allowSystemAdminRole?: boolean;
		/** When set, this code is always shelter_id — hide the picker even for SA. */
		lockedShelterCode?: string | null;
		pending?: boolean;
	} = $props();

	const shelterLocked = $derived(Boolean(lockedShelterCode));
	const canPickShelter = $derived(isSA && !shelterLocked);
	const capabilities = $derived(
		isSA && allowSystemAdminRole
			? SA_GRANTABLE_CAPABILITIES
			: isSA
				? SHELTER_CAPABILITIES
				: STAFF_CAPABILITIES
	);

	/** The mode is fixed for the lifetime of the component — each dialog mounts a fresh form. */
	const editing = untrack(() => user);

	function initialCapability(target: UserSummary) {
		if (isAppSystemAdmin(target.roles)) return SYSTEM_ADMIN;
		const granted = target.roles.find((r) => (capabilities as readonly string[]).includes(r));
		return granted ?? capabilities[0];
	}

	const adapter = zod4(editing ? editUserSchema : createUserSchema);
	const form = superForm(
		editing
			? defaults(
					untrack(() => ({
						username: editing.name,
						password: '',
						display_name: editing.display_name ?? '',
						capability: initialCapability(editing) as UserFormInput['capability'],
						shelter_id: lockedShelterCode ?? editing.shelter_id ?? undefined,
						affiliation_tags: $state.snapshot(editing.affiliation_tags)
					})),
					adapter
				)
			: defaults(adapter),
		{
			SPA: true,
			validators: adapter,
			resetForm: false,
			onUpdate: async ({ form }) => {
				if (!form.valid) return;
				const shelter_id = lockedShelterCode ?? (isSA ? form.data.shelter_id : undefined);
				if (!shelter_id && form.data.capability !== SYSTEM_ADMIN) {
					if (canPickShelter) setError(form, 'shelter_id', 'กรุณาเลือกศูนย์พักพิง');
					else setError(form, 'ไม่พบรหัสศูนย์พักพิงของบัญชีนี้ — ติดต่อผู้ดูแลระบบ');
					return;
				}
				try {
					await onsubmit({ ...form.data, shelter_id });
					// Only the create form is reused for another entry; the edit dialog closes on success.
					if (!editing) reset();
				} catch (err) {
					setError(
						form,
						err instanceof Error
							? err.message
							: editing
								? 'ไม่สามารถบันทึกข้อมูลผู้ใช้งานได้'
								: 'ไม่สามารถสร้างผู้ใช้งานได้'
					);
				}
			}
		}
	);

	const { form: formData, errors, submitting, reset } = form;
	const formErrors = $derived($errors._errors ?? []);

	const isSaCapability = $derived($formData.capability === SYSTEM_ADMIN);

	/** `label` is what the trigger shows once picked — the name, not the raw code. */
	const shelterItems = $derived(
		(sheltersQuery.data ?? [])
			.map((s) => ({ value: s.code, label: s.name, province: s.province }))
			.sort((a, b) => a.label.localeCompare(b.label, 'th'))
	);

	/** The shelter the form is bound to, resolved to a name whenever the registry is loaded. */
	const boundShelterCode = $derived(lockedShelterCode ?? $formData.shelter_id ?? null);
	const boundShelter = $derived(
		boundShelterCode
			? (sheltersQuery.data ?? []).find((s) => s.code === boundShelterCode)
			: undefined
	);
	const shelterMeta = $derived(
		[
			boundShelterCode ? `รหัส ${boundShelterCode}` : null,
			boundShelter?.province ? `จ.${boundShelter.province}` : null
		]
			.filter(Boolean)
			.join(' · ')
	);

	/**
	 * `data-[size=default]:h-11` is needed on top of `h-11`: Select.Trigger sets its height with
	 * `data-[size=default]:h-8`, which tailwind-merge can't dedupe against a plain `h-*` and which
	 * wins on specificity. The plain `h-11` is the one the Combobox button picks up.
	 */
	const fieldControlClass =
		'h-11 w-full rounded-md border border-input bg-slate-50 px-3 text-sm data-[size=default]:h-11';

	let showPassword = $state(false);
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
						disabled={Boolean(editing)}
						class={editing
							? 'h-11 cursor-not-allowed bg-slate-100 text-slate-500'
							: 'h-11 bg-slate-50'}
						placeholder="user123"
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
					<Form.Label class="font-bold">
						{editing ? 'รหัสผ่านใหม่ (หากต้องการเปลี่ยน)' : 'รหัสผ่าน (Password)'}
					</Form.Label>
					<div class="relative">
						<Input
							{...props}
							type={showPassword ? 'text' : 'password'}
							bind:value={$formData.password}
							class="h-11 bg-slate-50 pr-10"
							placeholder="••••••"
						/>
						<Button
							type="button"
							variant="ghost"
							size="icon"
							class="absolute top-0 right-0 h-full px-3 hover:bg-transparent"
							aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
							onclick={() => (showPassword = !showPassword)}
						>
							{#if showPassword}
								<EyeOff class="size-4 text-muted-foreground" />
							{:else}
								<Eye class="size-4 text-muted-foreground" />
							{/if}
						</Button>
					</div>
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
							{$formData.capability ? roleDisplayLabel($formData.capability) : 'เลือกบทบาท'}
						</Select.Trigger>
						<Select.Content>
							{#each capabilities as cap (cap)}
								<Select.Item value={cap} label={roleDisplayLabel(cap)} />
							{/each}
						</Select.Content>
					</Select.Root>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>

		{#if isSaCapability}
			<Field.Field>
				<Field.Label class="font-bold">ศูนย์พักพิง (Shelter)</Field.Label>
				<div
					class="flex items-start gap-3 rounded-md border border-dashed border-input bg-slate-50 p-3"
				>
					<ShieldCheck class="mt-0.5 size-5 shrink-0 text-muted-foreground" />
					<div class="min-w-0">
						<p class="text-sm font-medium">สิทธิ์ทั้งระบบ</p>
						<p class="text-xs text-muted-foreground">
							ผู้ดูแลระบบเข้าถึงได้ทุกศูนย์ จึงไม่ต้องเลือกศูนย์พักพิง
						</p>
					</div>
				</div>
			</Field.Field>
		{:else if canPickShelter}
			<Form.Field {form} name="shelter_id">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class="font-bold">ศูนย์พักพิง (Shelter)</Form.Label>
						<Combobox
							items={shelterItems}
							bind:value={
								() => $formData.shelter_id ?? '', (v) => ($formData.shelter_id = v || undefined)
							}
							placeholder={sheltersQuery.isLoading
								? 'กำลังโหลดรายชื่อศูนย์พักพิง...'
								: 'เลือกศูนย์พักพิง'}
							searchPlaceholder="ค้นหาจากชื่อหรือรหัสศูนย์..."
							emptyText="ไม่พบศูนย์พักพิง"
							disabled={sheltersQuery.isLoading}
							controlProps={props}
							class={fieldControlClass}
						>
							{#snippet children({ item })}
								<div class="flex min-w-0 flex-col">
									<span class="truncate text-sm font-medium">{item.label}</span>
									<span class="truncate text-xs text-muted-foreground">
										{item.value}{item.province ? ` · จ.${item.province}` : ''}
									</span>
								</div>
							{/snippet}
						</Combobox>
					{/snippet}
				</Form.Control>
				<Form.Description>
					{boundShelter ? shelterMeta : 'ผู้ใช้จะเข้าถึงข้อมูลได้เฉพาะศูนย์ที่เลือก'}
				</Form.Description>
				<Form.FieldErrors />
			</Form.Field>
		{:else}
			<Field.Field>
				<Field.Label class="font-bold">ศูนย์พักพิง (Shelter)</Field.Label>
				<div class="flex items-start gap-3 rounded-md border border-input bg-slate-50 p-3">
					<Building2 class="mt-0.5 size-5 shrink-0 text-muted-foreground" />
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">
							{boundShelter?.name ?? boundShelterCode ?? 'ไม่ได้ระบุศูนย์พักพิง'}
						</p>
						<p class="truncate text-xs text-muted-foreground">
							{#if boundShelter}
								{shelterMeta}
							{:else if boundShelterCode && sheltersQuery.isLoading}
								กำลังโหลดชื่อศูนย์พักพิง...
							{:else if boundShelterCode}
								ไม่พบชื่อศูนย์ในทะเบียน
							{:else}
								ติดต่อผู้ดูแลระบบเพื่อผูกบัญชีกับศูนย์พักพิง
							{/if}
						</p>
					</div>
					<Lock class="mt-0.5 size-4 shrink-0 text-muted-foreground" />
				</div>
			</Field.Field>
		{/if}

		{#if formErrors.length > 0}
			<Alert.Root variant="destructive">
				<CircleAlert />
				<Alert.Description>
					{#each formErrors as error (error)}
						<p>{error}</p>
					{/each}
				</Alert.Description>
			</Alert.Root>
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
			<Form.Button disabled={$submitting || pending} class="h-11 flex-1">
				<Save class="mr-2 h-4 w-4" />
				บันทึกข้อมูล
			</Form.Button>
		</div>
	</Field.FieldGroup>
</form>
