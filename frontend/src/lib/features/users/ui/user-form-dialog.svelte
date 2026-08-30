<script lang="ts">
	/**
	 * User create/edit dialog — "เพิ่มผู้ใช้ใหม่ในระบบ" / "แก้ไขข้อมูลผู้ใช้งาน" (CR-096 §2.2).
	 *
	 * Shell, density and control sizing follow `volunteers/ui/job-form-dialog.svelte`: a
	 * `max-h-[92vh]` content box with a fixed header, a `max-h-[70vh]` scrolling `space-y-6` form
	 * and a pinned footer that submits through Superforms (`form.submit()`), with every control on
	 * `!h-11`.
	 *
	 * Unlike the job dialog this one does NOT own its mutations: creating a user is a two-document
	 * write (`_users` through the BFF, then `volunteer.user_name`) and demoting the last system
	 * admin needs a second confirmation, so that orchestration stays in `user-management-page`
	 * and arrives here as `onsubmit`, which rejects with the reason a save failed.
	 */
	import { untrack } from 'svelte';
	import { defaults, setError, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Switch } from '$lib/components/ui/switch/index.js';
	import { Combobox } from '$lib/components/ui/combobox/index.js';
	import DatePicker from '$lib/components/date-picker.svelte';
	import TimePicker from '$lib/components/time-picker.svelte';
	import Check from '@lucide/svelte/icons/check';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import Globe from '@lucide/svelte/icons/globe';
	import Lock from '@lucide/svelte/icons/lock';
	import Search from '@lucide/svelte/icons/search';
	import UserCog from '@lucide/svelte/icons/user-cog';
	import {
		STAFF_CAPABILITIES,
		SHELTER_CAPABILITIES,
		SA_GRANTABLE_CAPABILITIES,
		isAppSystemAdmin,
		roleDescription,
		roleOptionLabel,
		SYSTEM_ADMIN
	} from '$lib/auth/roles';
	import { useShelters } from '$lib/features/shelters';
	import { useVolunteers } from '$lib/features/volunteers';
	import {
		createUserSchema,
		editUserSchema,
		isVolunteerAccount,
		PLATFORM_WIDE,
		toDateTimeLocal,
		type PersonnelType,
		type UserFormInput
	} from '../domain/schema';
	import type { UserSummary } from '../data/users.api';

	let {
		open = $bindable(false),
		user = null,
		onsubmit,
		isSA = false,
		allowSystemAdminRole = false,
		lockedShelterCode = null,
		pending = false
	}: {
		open?: boolean;
		/** `null` creates a user; a summary edits it (username becomes read-only). */
		user?: UserSummary | null;
		/** Rejects with the reason the save failed — shown as a form-level error. */
		onsubmit: (input: UserFormInput) => Promise<void> | void;
		/** System admin: may grant shelter_manager as well as staff capabilities. */
		isSA?: boolean;
		/** Portal-only: include `system_admin` in the role picker. */
		allowSystemAdminRole?: boolean;
		/** When set, this code is always shelter_id — hide the picker even for SA. */
		lockedShelterCode?: string | null;
		pending?: boolean;
	} = $props();

	const sheltersQuery = useShelters();
	// The registry lives in the volunteers slice (CR-096 §2.4) — read it through that barrel rather
	// than re-implementing a second reader. `active` only: a retired profile is not something to
	// hand a fresh login to. Scoped to the shelter *this form* targets, not the one the sidebar is
	// viewing: an SA who picks another shelter must see that shelter's roster, and the link must be
	// written into that shelter's DB.
	const volunteersQuery = useVolunteers({ status: 'active' }, () => volunteerShelterCode);

	const isEdit = $derived(user !== null);
	const shelterLocked = $derived(Boolean(lockedShelterCode));
	const canPickShelter = $derived(isSA && !shelterLocked);
	const capabilities = $derived(
		isSA && allowSystemAdminRole
			? SA_GRANTABLE_CAPABILITIES
			: isSA
				? SHELTER_CAPABILITIES
				: STAFF_CAPABILITIES
	);

	/** The mode is fixed for the lifetime of the component — the host keys a fresh instance. */
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
						personnel_type: (isVolunteerAccount(editing.affiliation_tags)
							? 'volunteer'
							: 'staff') as PersonnelType,
						capability: initialCapability(editing) as UserFormInput['capability'],
						shelter_id: isAppSystemAdmin(editing.roles)
							? PLATFORM_WIDE
							: (lockedShelterCode ?? editing.shelter_id ?? undefined),
						volunteer_id: editing.volunteer_id ?? undefined,
						duty_start: toDateTimeLocal(editing.duty_window?.start_ts),
						duty_end: toDateTimeLocal(editing.duty_window?.end_ts),
						active: editing.active ?? true
					})),
					adapter
				)
			: defaults(
					// Read once, like the edit branch: the form is seeded when the dialog mounts and
					// must not re-initialise if a prop changes underneath an operator mid-typing.
					untrack(() => ({
						personnel_type: 'staff' as PersonnelType,
						capability: (isSA && allowSystemAdminRole
							? SYSTEM_ADMIN
							: capabilities[0]) as UserFormInput['capability'],
						shelter_id: lockedShelterCode ?? undefined,
						active: true
					})),
					adapter
				),
		{
			SPA: true,
			validators: adapter,
			resetForm: false,
			onUpdate: async ({ form }) => {
				if (!form.valid) return;
				const platformWide = form.data.shelter_id === PLATFORM_WIDE;
				const shelter_id = platformWide
					? PLATFORM_WIDE
					: (lockedShelterCode ?? (isSA ? form.data.shelter_id : undefined));
				if (!shelter_id && form.data.capability !== SYSTEM_ADMIN) {
					if (canPickShelter) setError(form, 'shelter_id', 'กรุณาเลือกศูนย์พักพิง');
					else setError(form, 'ไม่พบรหัสศูนย์พักพิงของบัญชีนี้ — ติดต่อผู้ดูแลระบบ');
					return;
				}
				try {
					await onsubmit({ ...form.data, shelter_id });
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

	const { form: formData, errors, submitting } = form;
	const formErrors = $derived($errors._errors ?? []);

	const isSaCapability = $derived($formData.capability === SYSTEM_ADMIN);
	const isVolunteer = $derived($formData.personnel_type === 'volunteer');
	const isPending = $derived($submitting || pending);

	/**
	 * Personnel type is metadata only (R-AFFIL-5) — switching it never rewrites the capability.
	 * It does drop a stale volunteer link, so a staff account cannot keep pointing at a profile.
	 */
	function setPersonnelType(next: PersonnelType) {
		$formData.personnel_type = next;
		if (next === 'staff') $formData.volunteer_id = undefined;
	}

	/**
	 * Role drives affiliation, not the other way round: `system_admin` is global by definition, so
	 * picking it snaps the shelter to platform-wide and picking anything else releases that
	 * sentinel — otherwise the schema would reject the pair the operator can plainly see.
	 */
	function setCapability(next: string) {
		$formData.capability = next as UserFormInput['capability'];
		if (next === SYSTEM_ADMIN) $formData.shelter_id = PLATFORM_WIDE;
		else if ($formData.shelter_id === PLATFORM_WIDE) $formData.shelter_id = undefined;
	}

	const volunteerItems = $derived(
		(volunteersQuery.data ?? []).map((v) => ({
			value: v._id,
			label: `[${v.volunteer_code}] ${v.first_name} ${v.last_name}`.trim(),
			phone: v.phone,
			user_name: v.user_name ?? null
		}))
	);

	/**
	 * One picker does both jobs the mockup drew separately: it searches the registry and it is the
	 * stored link. Selecting a profile fills the identity fields the operator would otherwise
	 * retype.
	 */
	/**
	 * A profile only exists inside one shelter's registry, so changing the affiliation invalidates
	 * whatever was picked — clearing it here stops a save from writing `volunteer_id` into an
	 * account whose shelter no longer holds that profile.
	 */
	function setShelter(code: string) {
		const next = code || undefined;
		if (next !== $formData.shelter_id) $formData.volunteer_id = undefined;
		$formData.shelter_id = next;
	}

	function applyVolunteer(id: string) {
		$formData.volunteer_id = id || undefined;
		const picked = (volunteersQuery.data ?? []).find((v) => v._id === id);
		if (!picked) return;
		$formData.display_name = `${picked.first_name} ${picked.last_name}`.trim();
		// A volunteer's phone number is the identifier they already know — the mandated username.
		// An existing `user_name` wins: that profile already has a login and this is a rename risk.
		if (!editing) $formData.username = picked.user_name ?? picked.phone ?? '';
	}

	const linkedVolunteer = $derived(
		$formData.volunteer_id
			? (volunteersQuery.data ?? []).find((v) => v._id === $formData.volunteer_id)
			: undefined
	);
	const relinkWarning = $derived(
		linkedVolunteer?.user_name && linkedVolunteer.user_name !== $formData.username
			? `โปรไฟล์นี้ผูกกับบัญชี "${linkedVolunteer.user_name}" อยู่แล้ว — บันทึกแล้วจะถูกเปลี่ยนเป็น "${$formData.username}"`
			: ''
	);

	const shelterItems = $derived([
		...(isSA && allowSystemAdminRole
			? [{ value: PLATFORM_WIDE, label: 'ทุกศูนย์ (Platform-wide / ศูนย์บัญชาการกลาง EOC)' }]
			: []),
		...(sheltersQuery.data ?? [])
			.map((s) => ({ value: s.code, label: s.name }))
			.sort((a, b) => a.label.localeCompare(b.label, 'th'))
	]);

	const boundShelterCode = $derived(lockedShelterCode ?? $formData.shelter_id ?? null);
	/**
	 * Which shelter's volunteer registry to read and write. Platform-wide accounts have no
	 * registry of their own, so they fall back to the active shelter (`undefined`).
	 */
	const volunteerShelterCode = $derived(
		boundShelterCode && boundShelterCode !== PLATFORM_WIDE ? boundShelterCode : undefined
	);
	const boundShelter = $derived(
		boundShelterCode && boundShelterCode !== PLATFORM_WIDE
			? (sheltersQuery.data ?? []).find((s) => s.code === boundShelterCode)
			: undefined
	);

	/**
	 * `data-[size=default]:h-11` is needed on top of `!h-11`: Select.Trigger sets its height with
	 * `data-[size=default]:h-8`, which tailwind-merge can't dedupe against a plain `h-*`.
	 */
	const controlClass = '!h-11 w-full data-[size=default]:h-11';

	/**
	 * Duty window editing state. The schema stores each end as one `YYYY-MM-DDTHH:mm` string, but
	 * the shared pickers bind `YYYY-MM-DD` and `HH:mm` separately — so the halves live here and are
	 * recombined on every change. A time with no date is held locally rather than written: joining
	 * it would produce an unparseable instant, and "no date" plainly means "no window".
	 */
	function datePart(v: string | undefined): string {
		return v?.slice(0, 10) ?? '';
	}
	function timePart(v: string | undefined): string {
		return v && v.length >= 16 ? v.slice(11, 16) : '';
	}

	let startDate = $state(untrack(() => datePart($formData.duty_start)));
	let startTime = $state(untrack(() => timePart($formData.duty_start)));
	let endDate = $state(untrack(() => datePart($formData.duty_end)));
	let endTime = $state(untrack(() => timePart($formData.duty_end)));

	function syncDutyWindow() {
		$formData.duty_start = startDate ? `${startDate}T${startTime || '00:00'}` : undefined;
		$formData.duty_end = endDate ? `${endDate}T${endTime || '00:00'}` : undefined;
	}

	let showPassword = $state(false);
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-3xl">
		<div class="flex items-center gap-2 border-b border-border px-6 py-4 pr-12">
			<Dialog.Title class="flex items-center gap-2 text-lg font-semibold">
				<UserCog class="size-5 text-primary" />
				{isEdit ? 'แก้ไขข้อมูลผู้ใช้งาน' : 'เพิ่มผู้ใช้ใหม่ในระบบ'}
			</Dialog.Title>
		</div>

		<form method="POST" use:form.enhance class="max-h-[70vh] space-y-6 overflow-y-auto px-6 py-5">
			<!-- Personnel classification — R-AFFIL-1/2: never inferred from the RoleKey. -->
			<div class="space-y-2">
				<span class="text-sm font-medium">
					ชนิดคน (PERSONNEL CLASSIFICATION) <span class="text-destructive">*</span>
				</span>
				<div class="grid grid-cols-2 gap-2">
					<Button
						type="button"
						variant="outline"
						class="!h-11 justify-center {!isVolunteer
							? 'border-sky-300 bg-sky-50 text-sky-700 hover:bg-sky-100'
							: ''}"
						aria-pressed={!isVolunteer}
						onclick={() => setPersonnelType('staff')}
					>
						เจ้าหน้าที่ประจำ (Staff)
					</Button>
					<Button
						type="button"
						variant="outline"
						class="!h-11 justify-center {isVolunteer
							? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
							: ''}"
						aria-pressed={isVolunteer}
						onclick={() => setPersonnelType('volunteer')}
					>
						อาสาสมัคร (Volunteer)
					</Button>
				</div>
				<p class="text-[11px] text-muted-foreground">
					ชนิดคนเป็นข้อมูลกำกับเท่านั้น — สิทธิ์การเข้าถึงกำหนดโดย Role ด้านล่างเท่านั้น (R-AFFIL-5)
				</p>
			</div>

			{#if isVolunteer}
				<!-- Amber panel: this block only exists for volunteer accounts, so it carries the same
				     amber cue as the "อาสาสมัคร" toggle above rather than reading as a normal field. -->
				<Form.Field
					{form}
					name="volunteer_id"
					class="gap-2 rounded-xl border border-amber-300 bg-amber-50/50 p-3"
				>
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="flex items-center gap-2 font-semibold text-amber-900">
								<Search class="size-4" />
								ผูกโปรไฟล์จากทะเบียนจิตอาสา (ผูกข้อมูลอัตโนมัติ)
							</Form.Label>
							<Combobox
								items={volunteerItems}
								bind:value={() => $formData.volunteer_id ?? '', (v) => applyVolunteer(v)}
								placeholder={volunteersQuery.isLoading
									? 'กำลังโหลดทะเบียนอาสา...'
									: 'ค้นหาด้วยชื่อ หรือ เบอร์โทร...'}
								searchPlaceholder="พิมพ์ชื่อ หรือ เบอร์โทร..."
								emptyText="ไม่พบรายชื่อในทะเบียนอาสาของศูนย์นี้"
								disabled={volunteersQuery.isLoading}
								controlProps={props}
								class="{controlClass} border-amber-300 bg-background"
							>
								{#snippet children({ item })}
									<div class="flex min-w-0 flex-col">
										<span class="truncate text-sm font-medium">{item.label}</span>
										<span class="truncate text-xs text-muted-foreground">
											{item.phone ?? 'ไม่มีเบอร์โทร'}{item.user_name
												? ` · มีบัญชีแล้ว (${item.user_name})`
												: ''}
										</span>
									</div>
								{/snippet}
							</Combobox>
						{/snippet}
					</Form.Control>
					<Form.Description class="text-[11px] text-amber-800/80">
						เลือกแล้วระบบจะเติม Username และชื่อ-สกุลให้อัตโนมัติ และเขียนกลับที่
						<code>volunteer.user_name</code> เมื่อบันทึก
					</Form.Description>
					{#if relinkWarning}
						<p class="text-[11px] font-medium text-amber-700">{relinkWarning}</p>
					{/if}
					<Form.FieldErrors />
				</Form.Field>
			{/if}

			<div class="grid gap-4 sm:grid-cols-2">
				<Form.Field {form} name="username">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>Username <span class="text-destructive">*</span></Form.Label>
							<Input
								{...props}
								bind:value={$formData.username}
								disabled={isEdit}
								class="!h-11"
								placeholder={isVolunteer ? '081-9992211' : 'e.g. somchai_ops'}
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="display_name">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>ชื่อ-สกุล <span class="text-destructive">*</span></Form.Label>
							<Input
								{...props}
								bind:value={$formData.display_name}
								class="!h-11"
								placeholder="e.g. นาย สมชาย เกียรติอนันต์"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
			</div>

			<Form.Field {form} name="password">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>
							{isEdit ? 'รหัสผ่านใหม่ (เว้นว่างหากไม่เปลี่ยน)' : 'รหัสผ่าน (Password)'}
							{#if !isEdit}<span class="text-destructive">*</span>{/if}
						</Form.Label>
						<div class="relative">
							<Input
								{...props}
								type={showPassword ? 'text' : 'password'}
								bind:value={$formData.password}
								class="!h-11 pr-10"
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

			<!-- Role first: it decides whether an affiliation may be chosen at all. -->
			<Form.Field {form} name="capability">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label>
							บทบาทและสิทธิ์การเข้าถึง (SYSTEM ROLE) <span class="text-destructive">*</span>
						</Form.Label>
						<Select.Root
							type="single"
							bind:value={() => $formData.capability ?? '', (v) => setCapability(v)}
						>
							<Select.Trigger {...props} class={controlClass}>
								<span class="truncate">
									{$formData.capability ? roleOptionLabel($formData.capability) : 'เลือกบทบาท'}
								</span>
							</Select.Trigger>
							<Select.Content class="max-h-80">
								{#each capabilities as cap (cap)}
									<Select.Item value={cap} label={roleOptionLabel(cap)}>
										<span class="truncate">
											<span class="font-medium">{roleOptionLabel(cap)}</span>
											<span class="text-muted-foreground"> — {roleDescription(cap)}</span>
										</span>
									</Select.Item>
								{/each}
							</Select.Content>
						</Select.Root>
					{/snippet}
				</Form.Control>
				<Form.Description class="text-[11px]">
					{$formData.capability ? roleDescription($formData.capability) : ''}
				</Form.Description>
				<Form.FieldErrors />
			</Form.Field>

			{#if isSaCapability}
				<div class="space-y-2">
					<span class="text-sm font-medium">สังกัดศูนย์ปฏิบัติการ (SHELTER AFFILIATION)</span>
					<div
						class="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5"
					>
						<Globe class="size-4 shrink-0 text-primary" />
						<span class="min-w-0 flex-1 truncate text-sm">
							ทุกศูนย์ (Platform-wide / ศูนย์บัญชาการกลาง EOC)
						</span>
						<Lock class="size-3.5 shrink-0 text-muted-foreground" />
					</div>
					<p class="text-[11px] text-muted-foreground">
						ผู้ดูแลระบบเข้าถึงได้ทุกศูนย์ — ระบบตั้งสังกัดให้อัตโนมัติตามบทบาทที่เลือก
					</p>
				</div>
			{:else if canPickShelter}
				<Form.Field {form} name="shelter_id">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>
								สังกัดศูนย์ปฏิบัติการ (SHELTER AFFILIATION) <span class="text-destructive">*</span>
							</Form.Label>
							<Combobox
								items={shelterItems}
								bind:value={() => $formData.shelter_id ?? '', (v) => setShelter(v)}
								placeholder={sheltersQuery.isLoading
									? 'กำลังโหลดรายชื่อศูนย์พักพิง...'
									: 'เลือกศูนย์พักพิง'}
								searchPlaceholder="ค้นหาจากชื่อหรือรหัสศูนย์..."
								emptyText="ไม่พบศูนย์พักพิง"
								disabled={sheltersQuery.isLoading}
								controlProps={props}
								class={controlClass}
							/>
						{/snippet}
					</Form.Control>
					<Form.Description class="text-[11px]">
						ผู้ใช้จะเข้าถึงข้อมูลได้เฉพาะศูนย์ที่เลือก
					</Form.Description>
					<Form.FieldErrors />
				</Form.Field>
			{:else}
				<div class="space-y-2">
					<span class="text-sm font-medium">สังกัดศูนย์ปฏิบัติการ (SHELTER AFFILIATION)</span>
					<div class="flex items-center gap-2 rounded-lg border border-border px-3 py-2.5">
						<span class="min-w-0 flex-1 truncate text-sm">
							{boundShelter?.name ?? boundShelterCode ?? 'ไม่ได้ระบุศูนย์พักพิง'}
						</span>
						<Lock class="size-3.5 shrink-0 text-muted-foreground" />
					</div>
				</div>
			{/if}

			<!-- Duty-Access B (CR-092 D-DUTY-ACCESS=B): recorded here, enforced at the BFF later. -->
			<div class="space-y-2">
				<div class="flex items-center justify-between gap-2">
					<span class="text-sm font-medium">สิทธิ์ตามช่วงเวลาปฏิบัติงาน (DUTY-ACCESS B)</span>
					<Badge variant="secondary">ปล่อยว่าง = สิทธิ์ถาวร</Badge>
				</div>
				<div class="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-2">
					<label class="space-y-1">
						<span class="text-xs font-medium">วันที่เริ่มต้น</span>
						<DatePicker
							bind:value={
								() => startDate,
								(v) => {
									startDate = v;
									syncDutyWindow();
								}
							}
						/>
					</label>
					<label class="space-y-1">
						<span class="text-xs font-medium">เวลาเริ่มต้น</span>
						<TimePicker
							bind:value={
								() => startTime,
								(v) => {
									startTime = v;
									syncDutyWindow();
								}
							}
						/>
					</label>
					<label class="space-y-1">
						<span class="text-xs font-medium">วันที่สิ้นสุด</span>
						<DatePicker
							bind:value={
								() => endDate,
								(v) => {
									endDate = v;
									syncDutyWindow();
								}
							}
						/>
					</label>
					<label class="space-y-1">
						<span class="text-xs font-medium">เวลาสิ้นสุด</span>
						<TimePicker
							bind:value={
								() => endTime,
								(v) => {
									endTime = v;
									syncDutyWindow();
								}
							}
						/>
					</label>
				</div>
				<Form.Field {form} name="duty_start">
					<Form.FieldErrors />
				</Form.Field>
				<Form.Field {form} name="duty_end">
					<Form.FieldErrors />
				</Form.Field>
			</div>

			<Form.Field {form} name="active">
				<Form.Control>
					{#snippet children({ props })}
						<div
							class="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5"
						>
							<div class="min-w-0">
								<Form.Label class="text-sm font-medium">สถานะบัญชีการใช้งาน</Form.Label>
								<p class="text-[11px] text-muted-foreground">
									{$formData.active
										? 'เปิดใช้งานปกติ (Active)'
										: 'ระงับการใช้งานชั่วคราว (Suspended)'}
								</p>
							</div>
							<Switch {...props} bind:checked={$formData.active} />
						</div>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			{#if formErrors.length > 0}
				<p class="text-sm font-medium text-destructive">{formErrors.join(', ')}</p>
			{/if}
		</form>

		<div class="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
			<Button type="button" variant="ghost" onclick={() => (open = false)}>ยกเลิก</Button>
			<Button
				type="submit"
				class="!h-11 min-w-[200px]"
				disabled={isPending}
				onclick={() => form.submit()}
			>
				{#if isPending}
					กำลังบันทึก...
				{:else}
					<Check class="mr-1 size-4" />
					{isEdit ? 'บันทึกการแก้ไข' : 'บันทึกข้อมูล'}
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
