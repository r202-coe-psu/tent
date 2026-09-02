<script lang="ts">
	import { untrack } from 'svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Field from '$lib/components/ui/field/index.js';
	import { Combobox } from '$lib/components/ui/combobox/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import { defaults, setError, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		STAFF_CAPABILITIES,
		SHELTER_CAPABILITIES,
		SA_GRANTABLE_CAPABILITIES,
		type SaGrantableCapability,
		isAppSystemAdmin,
		roleDisplayLabel,
		SYSTEM_ADMIN,
		SHELTER_MANAGER
	} from '$lib/auth/roles';
	import {
		createUserSchema,
		editUserSchema,
		type UserFormInput,
		type PersonnelType
	} from '../domain/schema';
	import type { UserSummary } from '../data/users.api';
	import { useShelters } from '$lib/features/shelters';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Save, UserCheck, Shield, Clock, Users, Building, Phone, Mail, Briefcase, FileText } from '@lucide/svelte';
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

	/** The mode is fixed for the lifetime of the component. */
	const editing = untrack(() => user);

	function initialCapabilities(target: UserSummary): string[] {
		if (isAppSystemAdmin(target.roles)) return [SYSTEM_ADMIN];
		const grantable = target.roles.filter(
			(r) => !r.startsWith('shelter:') && (SA_GRANTABLE_CAPABILITIES as readonly string[]).includes(r)
		);
		return grantable.length > 0 ? grantable : ['registration_staff'];
	}

	const adapter = zod4(editing ? editUserSchema : createUserSchema);
	const form = superForm(
		editing
			? defaults(
					untrack(() => ({
						username: editing.name,
						password: '',
						display_name: editing.display_name ?? '',
						personnel_type: (editing.personnel_type ?? 'staff') as PersonnelType,
						organization: editing.organization ?? '',
						position: editing.position ?? '',
						phone: editing.phone ?? editing.name,
						email: editing.email ?? '',
						notes: editing.notes ?? '',
						capabilities: initialCapabilities(editing) as UserFormInput['capabilities'],
						shelter_id: lockedShelterCode ?? editing.shelter_id ?? undefined,
						volunteer_id: editing.volunteer_id ?? undefined,
						duty_window: editing.duty_window ?? undefined,
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
				const isSa = form.data.capabilities?.includes(SYSTEM_ADMIN);
				const shelter_id = lockedShelterCode ?? (isSA ? form.data.shelter_id : undefined);

				if (!shelter_id && !isSa) {
					if (canPickShelter) setError(form, 'shelter_id', 'กรุณาเลือกศูนย์พักพิง');
					else setError(form, 'ไม่พบรหัสศูนย์พักพิงของบัญชีนี้ — ติดต่อผู้ดูแลระบบ');
					return;
				}

				try {
					await onsubmit({ ...form.data, shelter_id });
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

	const isSaRoleSelected = $derived($formData.capabilities?.includes(SYSTEM_ADMIN) ?? false);

	// Sync username with phone if not editing and not SA role
	$effect(() => {
		if (!editing && !isSaRoleSelected && $formData.phone) {
			$formData.username = $formData.phone;
		}
	});

	/** `label` is what the trigger shows once picked — the name, not the raw code. */
	const shelterItems = $derived(
		(sheltersQuery.data ?? [])
			.map((s) => ({ value: s.code, label: s.name, province: s.province }))
			.sort((a, b) => a.label.localeCompare(b.label, 'th'))
	);

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

	const fieldControlClass =
		'h-11 w-full rounded-md border border-input bg-slate-50 px-3 text-sm data-[size=default]:h-11';

	let showPassword = $state(false);

	// Role categories
	const ROLE_CATEGORIES = [
		{
			title: '📋 ทะเบียนและคัดกรองหน้าด่าน',
			roles: [
				{ id: 'registration_staff', name: 'เจ้าหน้าที่รับลงทะเบียน', desc: 'ลงทะเบียนผู้อพยพ ครัวเรือน และเช็คอินหน้าศูนย์' },
				{ id: 'triage_staff', name: 'เจ้าหน้าที่คัดกรอง', desc: 'คัดกรองกลุ่มเปราะบางและส่งต่อไปยังพื้นที่เหมาะสม' }
			]
		},
		{
			title: '🩺 การแพทย์และพยาบาล',
			roles: [
				{ id: 'medical_staff', name: 'เจ้าหน้าที่การแพทย์และพยาบาล', desc: 'บันทึกข้อมูลสุขภาพ ประวัติการรักษา และการจ่ายยา' }
			]
		},
		{
			title: '📦 คลังและครัวกลาง',
			roles: [
				{ id: 'kitchen_staff', name: 'เจ้าหน้าที่ครัวกลาง', desc: 'วางแผนเมนูอาหาร เบิกจ่ายวัตถุดิบ และบันทึกแจกอาหาร' },
				{ id: 'supply_coordinator', name: 'ผู้ประสานงานพัสดุและคลัง', desc: 'รับบริจาค ตัดจ่ายสิ่งของ และควบคุมสต็อก' },
				{ id: 'facility_staff', name: 'เจ้าหน้าที่ฝ่ายอาคารสถานที่', desc: 'จัดโซนที่พัก ดูแลเต็นท์ และสุขาภิบาล' }
			]
		},
		{
			title: '🤝 ประสานงานและความปลอดภัย',
			roles: [
				{ id: 'volunteer_coordinator', name: 'ผู้ประสานงานจิตอาสา', desc: 'ดูแลกระดานงาน จัดสรรกะ และออกสิทธิ์ให้อาสา' },
				{ id: 'security_officer', name: 'เจ้าหน้าที่รักษาความปลอดภัย', desc: 'ดูแลความสงบเรียบร้อยและบันทึกเหตุการณ์ฉุกเฉิน' }
			]
		}
	];

	function toggleRole(roleId: string, checked: boolean) {
		const cap = roleId as SaGrantableCapability;
		const current = new Set<SaGrantableCapability>(
			(($formData.capabilities ?? []) as SaGrantableCapability[])
		);
		if (cap === SYSTEM_ADMIN) {
			if (checked) {
				$formData.capabilities = [SYSTEM_ADMIN];
			} else {
				$formData.capabilities = ['registration_staff'];
			}
			return;
		}

		// Remove system_admin if picking regular roles
		current.delete(SYSTEM_ADMIN);

		if (checked) {
			current.add(cap);
		} else {
			current.delete(cap);
		}
		$formData.capabilities = Array.from(current);
	}

	function isRoleChecked(roleId: string): boolean {
		return (($formData.capabilities ?? []) as string[]).includes(roleId);
	}
</script>

<form method="POST" use:form.enhance class="space-y-6">
	<!-- 1. ประเภทบุคลากร (Personnel Type) -->
	<div>
		<label class="mb-2 block text-sm font-bold text-slate-800">ประเภทผู้ปฏิบัติงาน</label>
		<div class="grid grid-cols-2 gap-3">
			<button
				type="button"
				class="flex items-center justify-center gap-2 rounded-lg border-2 p-3 text-sm font-medium transition-all {$formData.personnel_type === 'staff' ? 'border-blue-600 bg-blue-50 text-blue-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}"
				onclick={() => ($formData.personnel_type = 'staff')}
			>
				<Building class="size-4" />
				<span>เจ้าหน้าที่ประจำ (Staff)</span>
			</button>
			<button
				type="button"
				class="flex items-center justify-center gap-2 rounded-lg border-2 p-3 text-sm font-medium transition-all {$formData.personnel_type === 'volunteer' ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}"
				onclick={() => ($formData.personnel_type = 'volunteer')}
			>
				<Users class="size-4" />
				<span>อาสาสมัครช่วยงานระบบ</span>
			</button>
		</div>
	</div>

	<!-- 2. ข้อมูลติดต่อและโปรไฟล์ -->
	<div class="rounded-xl border border-slate-200 bg-slate-50/50 p-4 space-y-4">
		<h4 class="flex items-center gap-2 text-sm font-bold text-slate-700">
			<UserCheck class="size-4 text-blue-600" />
			ข้อมูลบัญชีและประวัติผู้ปฏิบัติงาน
		</h4>

		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			<!-- Phone (Username) -->
			<Form.Field {form} name="phone">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class="font-bold flex items-center gap-1">
							<Phone class="size-3.5" /> เบอร์โทรศัพท์ (ใช้เป็น Username) <span class="text-red-500">*</span>
						</Form.Label>
						<Input
							{...props}
							bind:value={$formData.phone}
							type="tel"
							maxlength={10}
							class="h-11 bg-white"
							placeholder="0812345678"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<!-- Display Name -->
			<Form.Field {form} name="display_name">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class="font-bold">ชื่อ-นามสกุล <span class="text-red-500">*</span></Form.Label>
						<Input
							{...props}
							bind:value={$formData.display_name}
							class="h-11 bg-white"
							placeholder="นาย สมชาย ใจดี"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		</div>

		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			<!-- Organization -->
			<Form.Field {form} name="organization">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class="font-bold">
							หน่วยงาน / องค์กรต้นสังกัด
							{#if $formData.personnel_type === 'staff'}
								<span class="text-red-500">*</span>
							{:else}
								<span class="text-xs font-normal text-slate-500">(ไม่บังคับสำหรับอาสา)</span>
							{/if}
						</Form.Label>
						<Input
							{...props}
							bind:value={$formData.organization}
							class="h-11 bg-white"
							placeholder="เช่น กรมป้องกันและบรรเทาสาธารณภัย, มูลนิธิกระจกเงา"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<!-- Position -->
			<Form.Field {form} name="position">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class="font-bold flex items-center gap-1">
							<Briefcase class="size-3.5" /> ตำแหน่ง / วิชาชีพ
						</Form.Label>
						<Input
							{...props}
							bind:value={$formData.position}
							class="h-11 bg-white"
							placeholder="เช่น พยาบาลวิชาชีพ, เจ้าหน้าที่ป้องกันฯ"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		</div>

		<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
			<!-- Email -->
			<Form.Field {form} name="email">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class="font-bold flex items-center gap-1">
							<Mail class="size-3.5" /> อีเมลติดต่อ (Optional)
						</Form.Label>
						<Input
							{...props}
							type="email"
							bind:value={$formData.email}
							class="h-11 bg-white"
							placeholder="user@example.com"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>

			<!-- Password -->
			<Form.Field {form} name="password">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class="font-bold flex items-center justify-between">
							<span>
								{editing ? 'รหัสผ่านใหม่ (หากต้องการเปลี่ยน)' : 'รหัสผ่าน (Password)'}
								{#if !editing}
									<span class="text-red-500">*</span>
								{/if}
							</span>
						</Form.Label>
						<div class="relative">
							<Input
								{...props}
								type={showPassword ? 'text' : 'password'}
								bind:value={$formData.password}
								class="h-11 bg-white pr-10"
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
		</div>

		<!-- Notes -->
		<Form.Field {form} name="notes">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label class="font-bold flex items-center gap-1">
						<FileText class="size-3.5" /> หมายเหตุเพิ่มเติม
					</Form.Label>
					<Input
						{...props}
						bind:value={$formData.notes}
						class="h-11 bg-white"
						placeholder="บันทึกรายละเอียดเพิ่มเติม..."
					/>
				{/snippet}
			</Form.Control>
			<Form.FieldErrors />
		</Form.Field>
	</div>

	<!-- 3. ศูนย์พักพิง (Shelter) -->
	<div>
		{#if isSaRoleSelected}
			<div class="flex items-start gap-3 rounded-lg border border-dashed border-input bg-slate-50 p-4">
				<ShieldCheck class="mt-0.5 size-5 shrink-0 text-blue-600" />
				<div>
					<p class="text-sm font-bold text-slate-800">สิทธิ์ส่วนกลางทุกศูนย์ (System Admin)</p>
					<p class="text-xs text-slate-500">
						ผู้ดูแลระบบเข้าถึงได้ทุกศูนย์พักพิงในระบบ จึงไม่ต้องระบุสังกัดศูนย์
					</p>
				</div>
			</div>
		{:else if canPickShelter}
			<Form.Field {form} name="shelter_id">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class="font-bold">ศูนย์พักพิงที่สังกัด <span class="text-red-500">*</span></Form.Label>
						<Combobox
							items={shelterItems}
							bind:value={
								() => $formData.shelter_id ?? '', (v) => ($formData.shelter_id = v || undefined)
							}
							placeholder={sheltersQuery.isLoading ? 'กำลังโหลดรายชื่อศูนย์...' : 'เลือกศูนย์พักพิง'}
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
				<Form.FieldErrors />
			</Form.Field>
		{:else}
			<div>
				<label class="mb-1 block text-sm font-bold text-slate-800">ศูนย์พักพิงที่สังกัด</label>
				<div class="flex items-center gap-3 rounded-md border border-input bg-slate-50 p-3">
					<Building2 class="size-5 shrink-0 text-muted-foreground" />
					<div class="min-w-0 flex-1">
						<p class="truncate text-sm font-medium">
							{boundShelter?.name ?? boundShelterCode ?? 'ศูนย์ปัจจุบัน'}
						</p>
						<p class="truncate text-xs text-muted-foreground">
							{shelterMeta}
						</p>
					</div>
					<Lock class="size-4 text-muted-foreground" />
				</div>
			</div>
		{/if}
	</div>

	<!-- 4. การเลือกบทบาทแบบ Multiple Roles (Categorized Cards) -->
	<div class="space-y-4">
		<div class="flex items-center justify-between">
			<label class="text-sm font-bold text-slate-800">
				บทบาทและสิทธิ์การเข้าถึง (Multiple Roles) <span class="text-red-500">*</span>
			</label>
			<span class="text-xs text-slate-500">เลือกได้มากกว่า 1 บทบาท</span>
		</div>

		{#if isSA && allowSystemAdminRole}
			<div class="rounded-lg border-2 p-3 transition-all {isSaRoleSelected ? 'border-amber-500 bg-amber-50/50' : 'border-slate-200 bg-white'}">
				<label class="flex items-start gap-3 cursor-pointer">
					<input
						type="checkbox"
						class="mt-1 size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
						checked={isSaRoleSelected}
						onchange={(e) => toggleRole(SYSTEM_ADMIN, e.currentTarget.checked)}
					/>
					<div>
						<span class="text-sm font-bold text-slate-900">ผู้ดูแลระบบส่วนกลาง (System Admin)</span>
						<p class="text-xs text-slate-500">มีสิทธิ์สูงสุดระดับสากล เข้าถึงและจัดการได้ทุกศูนย์พักพิงในระบบ</p>
					</div>
				</label>
			</div>
		{/if}

		{#if !isSaRoleSelected}
			{#if isSA}
				<div class="rounded-lg border-2 p-3 border-blue-200 bg-blue-50/30">
					<label class="flex items-start gap-3 cursor-pointer">
						<input
							type="checkbox"
							class="mt-1 size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
							checked={isRoleChecked(SHELTER_MANAGER)}
							onchange={(e) => toggleRole(SHELTER_MANAGER, e.currentTarget.checked)}
						/>
						<div>
							<span class="text-sm font-bold text-slate-900">ผู้จัดการศูนย์พักพิง (Shelter Manager)</span>
							<p class="text-xs text-slate-500">อำนาจสูงสุดในการบริหารจัดการทุกบทบาทและภารกิจภายในศูนย์ของตนเอง</p>
						</div>
					</label>
				</div>
			{/if}

			<div class="grid grid-cols-1 md:grid-cols-2 gap-4">
				{#each ROLE_CATEGORIES as category}
					<div class="rounded-xl border border-slate-200 bg-white p-4 space-y-3 shadow-xs">
						<h5 class="text-xs font-bold uppercase tracking-wider text-slate-500">
							{category.title}
						</h5>
						<div class="space-y-2.5">
							{#each category.roles as role}
								<label class="flex items-start gap-2.5 cursor-pointer rounded-lg p-2 hover:bg-slate-50 transition-colors">
									<input
										type="checkbox"
										class="mt-0.5 size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
										checked={isRoleChecked(role.id)}
										onchange={(e) => toggleRole(role.id, e.currentTarget.checked)}
									/>
									<div class="min-w-0 flex-1">
										<p class="text-sm font-semibold text-slate-800">{role.name}</p>
										<p class="text-xs text-slate-500 leading-relaxed">{role.desc}</p>
									</div>
								</label>
							{/each}
						</div>
					</div>
				{/each}
			</div>
		{/if}
	</div>

	<!-- 5. ข้อความแจ้งเตือนความผิดพลาด -->
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

	<!-- 6. ปุ่มดำเนินการ -->
	<div class="flex gap-4 pt-2">
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
		<Form.Button disabled={$submitting || pending} class="h-11 flex-1 bg-blue-700 hover:bg-blue-800">
			<Save class="mr-2 h-4 w-4" />
			บันทึกข้อมูล
		</Form.Button>
	</div>
</form>
