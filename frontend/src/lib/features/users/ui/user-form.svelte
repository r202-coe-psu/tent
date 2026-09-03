<script lang="ts">
	import { untrack } from 'svelte';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { Combobox } from '$lib/components/ui/combobox/index.js';
	import * as Alert from '$lib/components/ui/alert/index.js';
	import * as AlertDialog from '$lib/components/ui/alert-dialog/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import { defaults, setError, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import {
		SA_GRANTABLE_CAPABILITIES,
		type SaGrantableCapability,
		type ShelterCapability,
		isAppSystemAdmin,
		SYSTEM_ADMIN,
		SHELTER_MANAGER,
		roleDisplayLabel,
		assignmentsFromRoles,
		capabilitiesForShelter
	} from '$lib/auth/roles';
	import {
		createUserSchema,
		editUserSchema,
		type UserFormInput,
		type PersonnelType,
		type ShelterAssignmentInput
	} from '../domain/schema';
	import type { UserSummary } from '../data/users.api';
	import { useShelters } from '$lib/features/shelters';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import {
		Save,
		UserCheck,
		Users,
		Building,
		Phone,
		Mail,
		Briefcase,
		FileText,
		Plus,
		Trash2,
		Info
	} from '@lucide/svelte';
	import { SvelteMap, SvelteSet } from 'svelte/reactivity';
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
		pending = false,
		layout = 'dialog'
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
		/** Dialog keeps an inner scroll; page lets the document scroll. */
		layout?: 'dialog' | 'page';
	} = $props();

	const shelterLocked = $derived(Boolean(lockedShelterCode));
	/** SA portal: multi-shelter assignments. SM / locked: single shelter. */
	const multiShelter = $derived(isSA && !shelterLocked);

	/** The mode is fixed for the lifetime of the component. */
	const editing = untrack(() => user);

	function initialAssignments(target: UserSummary): ShelterAssignmentInput[] {
		if (isAppSystemAdmin(target.roles)) return [];
		const all = assignmentsFromRoles(target.roles);
		if (lockedShelterCode) {
			const caps = capabilitiesForShelter(target.roles, lockedShelterCode);
			return caps.length > 0
				? [{ shelter_code: lockedShelterCode, capabilities: caps }]
				: [{ shelter_code: lockedShelterCode, capabilities: ['registration_staff'] }];
		}
		return all.length > 0
			? all
			: [{ shelter_code: '', capabilities: ['registration_staff'] as ShelterCapability[] }];
	}

	function initialCapabilities(target: UserSummary): string[] {
		if (isAppSystemAdmin(target.roles)) return [SYSTEM_ADMIN];
		const code = lockedShelterCode ?? target.shelter_id;
		if (code) {
			const caps = capabilitiesForShelter(target.roles, code);
			return caps.length > 0 ? caps : ['registration_staff'];
		}
		const grantable = target.roles.filter(
			(r) =>
				!r.startsWith('shelter:') &&
				!r.includes(':') &&
				(SA_GRANTABLE_CAPABILITIES as readonly string[]).includes(r)
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
						is_system_admin: isAppSystemAdmin(editing.roles),
						assignments: initialAssignments(editing),
						capabilities: initialCapabilities(editing) as UserFormInput['capabilities'],
						shelter_id: lockedShelterCode ?? editing.shelter_id ?? undefined,
						volunteer_id: editing.volunteer_id ?? undefined,
						duty_window: editing.duty_window ?? undefined,
						affiliation_tags: $state.snapshot(editing.affiliation_tags)
					})),
					adapter
				)
			: defaults(
					untrack(() => ({
						personnel_type: 'staff' as PersonnelType,
						is_system_admin: false,
						assignments: lockedShelterCode
							? [
									{
										shelter_code: lockedShelterCode,
										capabilities: ['registration_staff'] as ShelterCapability[]
									}
								]
							: ([] as ShelterAssignmentInput[]),
						capabilities: (lockedShelterCode
							? ['registration_staff']
							: []) as UserFormInput['capabilities'],
						shelter_id: lockedShelterCode ?? undefined
					})),
					adapter
				),
		{
			SPA: true,
			/** Nested `assignments[]` requires JSON transport (not URLSearchParams). */
			dataType: 'json',
			id: editing ? `user-edit-${editing.name}` : 'user-create',
			validators: adapter,
			resetForm: false,
			onUpdate: async ({ form }) => {
				if (!form.valid) return;
				const isSa = form.data.is_system_admin || form.data.capabilities?.includes(SYSTEM_ADMIN);

				if (!isSa && multiShelter) {
					const assignments = (form.data.assignments ?? []).filter(
						(a) => a.shelter_code && a.capabilities.length > 0
					);
					if (assignments.length === 0) {
						setError(form, 'กรุณาเพิ่มอย่างน้อย 1 ศูนย์พร้อมบทบาท');
						return;
					}
					form.data.assignments = assignments;
				} else if (!isSa) {
					const shelter_id = lockedShelterCode ?? form.data.shelter_id;
					if (!shelter_id) {
						if (isSA) setError(form, 'shelter_id', 'กรุณาเลือกศูนย์พักพิง');
						else setError(form, 'ไม่พบรหัสศูนย์พักพิงของบัญชีนี้ — ติดต่อผู้ดูแลระบบ');
						return;
					}
					form.data.shelter_id = shelter_id;
					form.data.assignments = [
						{
							shelter_code: shelter_id,
							capabilities: (form.data.capabilities ?? []).filter(
								(c) => c !== SYSTEM_ADMIN
							) as ShelterCapability[]
						}
					];
				}

				try {
					await onsubmit({
						...form.data,
						is_system_admin: Boolean(isSa),
						shelter_id: isSa ? undefined : (lockedShelterCode ?? form.data.shelter_id)
					});
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

	const isSaRoleSelected = $derived(
		Boolean($formData.is_system_admin || $formData.capabilities?.includes(SYSTEM_ADMIN))
	);

	function setSystemAdmin(checked: boolean) {
		$formData.is_system_admin = checked;
		if (checked) {
			$formData.capabilities = [SYSTEM_ADMIN];
			$formData.shelter_id = undefined;
			$formData.assignments = [];
		} else if (lockedShelterCode) {
			$formData.capabilities = ['registration_staff'];
			$formData.shelter_id = lockedShelterCode;
			$formData.assignments = [
				{ shelter_code: lockedShelterCode, capabilities: ['registration_staff'] }
			];
		} else {
			$formData.capabilities = [];
			$formData.assignments = [];
		}
	}

	function addAssignment() {
		const used = new SvelteSet(($formData.assignments ?? []).map((a) => a.shelter_code));
		const next = (sheltersQuery.data ?? []).find((s) => !used.has(s.code));
		if (!next) return;
		$formData.assignments = [
			...($formData.assignments ?? []),
			{ shelter_code: next.code, capabilities: ['registration_staff'] }
		];
	}

	function removeAssignment(index: number) {
		$formData.assignments = ($formData.assignments ?? []).filter((_, i) => i !== index);
	}

	let pendingRemoveIndex = $state<number | null>(null);

	function requestRemoveAssignment(index: number) {
		pendingRemoveIndex = index;
	}

	function confirmRemoveAssignment() {
		if (pendingRemoveIndex === null) return;
		removeAssignment(pendingRemoveIndex);
		pendingRemoveIndex = null;
	}

	const pendingRemoveShelter = $derived.by(() => {
		if (pendingRemoveIndex === null) return null;
		const code = $formData.assignments?.[pendingRemoveIndex]?.shelter_code ?? '';
		if (!code) return { code: '', name: null as string | null };
		const shelter = (sheltersQuery.data ?? []).find((s) => s.code === code);
		return { code, name: shelter?.name ?? null };
	});

	function setAssignmentShelter(index: number, code: string) {
		const list = [...($formData.assignments ?? [])];
		if (!list[index]) return;
		list[index] = { ...list[index], shelter_code: code };
		$formData.assignments = list;
	}

	function toggleAssignmentRole(index: number, roleId: string, checked: boolean) {
		const list = [...($formData.assignments ?? [])];
		const row = list[index];
		if (!row) return;

		if (roleId === SHELTER_MANAGER) {
			list[index] = {
				...row,
				capabilities: checked ? [SHELTER_MANAGER] : ['registration_staff']
			};
			$formData.assignments = list;
			return;
		}

		const caps = new SvelteSet(row.capabilities);
		const cap = roleId as ShelterCapability;
		if (checked) caps.add(cap);
		else caps.delete(cap);
		list[index] = { ...row, capabilities: [...caps] };
		$formData.assignments = list;
	}

	function isAssignmentRoleChecked(index: number, roleId: string): boolean {
		return ($formData.assignments?.[index]?.capabilities ?? []).includes(
			roleId as ShelterCapability
		);
	}

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
	const dutiesReady = $derived(isSaRoleSelected || Boolean(boundShelterCode) || multiShelter);

	const fieldControlClass =
		'h-11 w-full rounded-md border border-input bg-slate-50 px-3 text-sm data-[size=default]:h-11';

	let showPassword = $state(false);

	const SHELTER_MANAGER_DESCRIPTION =
		'ควบคุมการปฏิบัติงานทั้งหมดภายในศูนย์ของตนเอง มีอำนาจครอบคลุมสิทธิ์ของบทบาทเจ้าหน้าที่ทั้งหมดในศูนย์นั้น รวมถึงงานคัดกรองและการแพทย์';

	/** Compact role picker — checkbox names + PRD descriptions. */
	const ROLE_OPTIONS = [
		{
			id: 'registration_staff',
			name: 'เจ้าหน้าที่รับลงทะเบียน',
			description:
				'บันทึกข้อมูลทะเบียนประวัติผู้อพยพ (Evacuees), ข้อมูลครัวเรือน, ยานพาหนะ, สัตว์เลี้ยง, การเช็คอิน-เช็คเอาต์ประจำวัน และออกบัตรประจำตัว'
		},
		{
			id: 'triage_staff',
			name: 'เจ้าหน้าที่คัดกรอง',
			description:
				'คัดกรองกลุ่มเปราะบาง (ผู้สูงอายุ, ผู้พิการ, เด็ก, สตรีมีครรภ์) และคัดแยกผู้ป่วยเบื้องต้นเพื่อส่งต่อไปยังพื้นที่พักพิงที่เหมาะสม'
		},
		{
			id: 'medical_staff',
			name: 'เจ้าหน้าที่การแพทย์และพยาบาล',
			description:
				'บันทึกข้อมูลสุขภาพ, ประวัติการรักษาพยาบาลเบื้องต้น, การจ่ายยา, การเฝ้าระวังโรคติดต่อ และการส่งต่อผู้ป่วยไปยังโรงพยาบาลภายนอก'
		},
		{
			id: 'kitchen_staff',
			name: 'เจ้าหน้าที่ครัวกลาง',
			description:
				'วางแผนรายการอาหารประจำวัน (Meal Planning), คำนวณวัตถุดิบและแก๊สหุงต้ม, เบิกจ่ายวัตถุดิบ, และบันทึกยอดการแจกจ่ายอาหาร'
		},
		{
			id: 'supply_coordinator',
			name: 'ผู้ประสานงานพัสดุและคลัง',
			description:
				'รับมอบสิ่งของบริจาค, จัดการคลังพัสดุ, ตัดจ่ายสิ่งของจำเป็น, เบิกถุงยังชีพ, และควบคุมระดับสต็อกขั้นต่ำ'
		},
		{
			id: 'warehouse_staff',
			name: 'เจ้าหน้าที่คลัง',
			description: 'ดูแลคลังสินค้า รับ-จ่ายวัสดุ และบันทึกสต็อกภายในศูนย์'
		},
		{
			id: 'facility_staff',
			name: 'เจ้าหน้าที่ฝ่ายอาคารสถานที่',
			description:
				'จัดการโซนที่พัก (Zoning), บริหารจัดการเต็นท์และพื้นที่นอน, ดูแลระบบไฟฟ้า น้ำประปา สุขาภิบาล และการซ่อมบำรุงอาคาร'
		},
		{
			id: 'volunteer_coordinator',
			name: 'ผู้ประสานงานจิตอาสา',
			description:
				'สร้างประกาศภารกิจงานอาสา, ดูแลกระดานงาน, จัดสรรกะงาน, ดูแลจุดเช็คอินแท็บเล็ตหน้าศูนย์, และออกสิทธิ์ระบบให้อาสาช่วยงาน'
		},
		{
			id: 'security_officer',
			name: 'เจ้าหน้าที่รักษาความปลอดภัย',
			description:
				'ควบคุมความสงบเรียบร้อย, บันทึกเหตุการณ์ความไม่ปลอดภัย (Incidents), จัดการพื้นที่หวงห้าม, และเฝ้าระวังจุดเข้า-ออกศูนย์'
		}
	] as const;

	function toggleRole(roleId: string, checked: boolean) {
		const cap = roleId as SaGrantableCapability;
		if (cap === SYSTEM_ADMIN) {
			setSystemAdmin(checked);
			return;
		}

		if (cap === SHELTER_MANAGER) {
			$formData.is_system_admin = false;
			$formData.capabilities = checked ? [SHELTER_MANAGER] : ['registration_staff'];
			return;
		}

		const current = new SvelteSet<SaGrantableCapability>(
			($formData.capabilities ?? []) as SaGrantableCapability[]
		);
		current.delete(SYSTEM_ADMIN);
		$formData.is_system_admin = false;

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

	/** Prefer the form's long Thai labels; fall back to shared roleDisplayLabel. */
	const roleLabelById = (() => {
		const map = new SvelteMap<string, string>();
		map.set(SYSTEM_ADMIN, 'ผู้ดูแลระบบส่วนกลาง (System Admin)');
		map.set(SHELTER_MANAGER, 'ผู้จัดการศูนย์พักพิง (Shelter Manager)');
		for (const role of ROLE_OPTIONS) {
			map.set(role.id, role.name);
		}
		return map;
	})();

	const selectedRoleChips = $derived.by(() => {
		if (isSaRoleSelected) {
			return [{ id: SYSTEM_ADMIN, label: roleLabelById.get(SYSTEM_ADMIN) ?? SYSTEM_ADMIN }];
		}
		if (multiShelter) {
			return ($formData.assignments ?? []).flatMap((a) =>
				a.capabilities.map((id) => ({
					id: `${a.shelter_code}:${id}`,
					label: `${roleLabelById.get(id) ?? roleDisplayLabel(id)} (${a.shelter_code})`
				}))
			);
		}
		return ($formData.capabilities ?? []).map((id) => ({
			id,
			label: roleLabelById.get(id) ?? roleDisplayLabel(id)
		}));
	});

	const unusedShelterItems = $derived.by(() => {
		const used = new SvelteSet(($formData.assignments ?? []).map((a) => a.shelter_code));
		return shelterItems.filter((s) => !used.has(s.value));
	});
</script>

{#snippet roleInfoButton(description: string, ariaLabel: string)}
	<Popover.Root>
		<Popover.Trigger
			type="button"
			class="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-slate-100 hover:text-slate-700"
			aria-label={ariaLabel}
		>
			<Info class="size-3.5" />
		</Popover.Trigger>
		<Popover.Content class="max-w-[280px] p-3 text-sm" align="start" side="top">
			{description}
		</Popover.Content>
	</Popover.Root>
{/snippet}

<form
	method="POST"
	use:form.enhance
	class={layout === 'page' ? 'flex flex-col' : 'flex min-h-0 flex-1 flex-col'}
>
	<div class={['space-y-6 px-6 pt-6 pb-8', layout !== 'page' && 'min-h-0 flex-1 overflow-y-auto']}>
		<!-- 1. ประเภทบุคลากร (Personnel Type) -->
		<fieldset>
			<legend class="mb-2 block text-sm font-bold text-slate-800">ประเภทผู้ปฏิบัติงาน</legend>
			<div class="grid grid-cols-2 gap-3">
				<button
					type="button"
					class="flex items-center justify-center gap-2 rounded-lg border-2 p-3 text-sm font-medium transition-all {$formData.personnel_type ===
					'staff'
						? 'border-blue-600 bg-blue-50 text-blue-800'
						: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}"
					onclick={() => ($formData.personnel_type = 'staff')}
				>
					<Building class="size-4" />
					<span>เจ้าหน้าที่ประจำ (Staff)</span>
				</button>
				<button
					type="button"
					class="flex items-center justify-center gap-2 rounded-lg border-2 p-3 text-sm font-medium transition-all {$formData.personnel_type ===
					'volunteer'
						? 'border-emerald-600 bg-emerald-50 text-emerald-800'
						: 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}"
					onclick={() => ($formData.personnel_type = 'volunteer')}
				>
					<Users class="size-4" />
					<span>อาสาสมัครช่วยงานระบบ</span>
				</button>
			</div>
		</fieldset>

		<!-- 2. ข้อมูลติดต่อและโปรไฟล์ -->
		<div class="space-y-4 rounded-xl border border-slate-200 bg-slate-50/50 p-4">
			<h4 class="flex items-center gap-2 text-sm font-bold text-slate-700">
				<UserCheck class="size-4 text-blue-600" />
				ข้อมูลบัญชีและประวัติผู้ปฏิบัติงาน
			</h4>

			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<!-- Phone (Username) -->
				<Form.Field {form} name="phone">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="flex items-center gap-1 font-bold">
								<Phone class="size-3.5" /> เบอร์โทรศัพท์ (ใช้เป็น Username)
								<span class="text-red-500">*</span>
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
							<Form.Label class="font-bold"
								>ชื่อ-นามสกุล <span class="text-red-500">*</span></Form.Label
							>
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

			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
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
							<Form.Label class="flex items-center gap-1 font-bold">
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

			<div class="grid grid-cols-1 gap-4 md:grid-cols-2">
				<!-- Email -->
				<Form.Field {form} name="email">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label class="flex items-center gap-1 font-bold">
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

				{#if !editing}
					<!-- Password (create only — edit uses admin reset-password flow) -->
					<Form.Field {form} name="password">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class="flex items-center justify-between font-bold">
									<span>
										รหัสผ่าน (Password)
										<span class="text-red-500">*</span>
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
				{/if}
			</div>

			<!-- Notes -->
			<Form.Field {form} name="notes">
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class="flex items-center gap-1 font-bold">
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

		<!-- 3. สรุปบทบาท → ศูนย์ → ตำแหน่งหน้าที่ -->
		<div class="space-y-4">
			<!-- 3.1 สรุปบทบาท -->
			<div class="rounded-lg border border-slate-200 bg-slate-50/80 p-3">
				<div class="mb-2 flex items-baseline justify-between gap-2">
					<p class="text-xs font-bold tracking-wide text-slate-500 uppercase">สรุปบทบาท</p>
					{#if isSaRoleSelected}
						<span class="text-xs text-slate-500">สิทธิ์ส่วนกลางทุกศูนย์</span>
					{:else if multiShelter}
						<span class="text-xs text-slate-500">หลายศูนย์ / บทบาทแยกรายศูนย์</span>
					{:else if boundShelterCode}
						<span class="truncate text-xs text-slate-500">
							ในศูนย์ {boundShelter?.name ?? boundShelterCode}
						</span>
					{:else}
						<span class="text-xs text-slate-500">เลือกศูนย์เพื่อกำหนดบทบาท</span>
					{/if}
				</div>
				{#if selectedRoleChips.length > 0}
					<div class="flex flex-wrap gap-1.5">
						{#each selectedRoleChips as chip (chip.id)}
							<Badge
								variant={chip.id === SYSTEM_ADMIN ? 'default' : 'secondary'}
								class={chip.id === SYSTEM_ADMIN
									? 'h-auto max-w-full rounded-md bg-amber-600 px-2.5 py-1 text-xs font-semibold whitespace-normal text-white'
									: 'h-auto max-w-full rounded-md bg-slate-200/80 px-2.5 py-1 text-xs font-semibold whitespace-normal text-slate-800'}
							>
								{chip.label}
							</Badge>
						{/each}
					</div>
				{:else}
					<p class="text-sm text-slate-500">ยังไม่มีตำแหน่งหน้าที่ — เลือกด้านล่าง</p>
				{/if}
			</div>

			{#if isSA && allowSystemAdminRole}
				<div
					class="rounded-lg border-2 p-3 transition-all {isSaRoleSelected
						? 'border-amber-500 bg-amber-50/50'
						: 'border-slate-200 bg-white'}"
				>
					<label class="flex cursor-pointer items-start gap-3">
						<input
							type="checkbox"
							class="mt-1 size-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
							checked={isSaRoleSelected}
							onchange={(e) => setSystemAdmin(e.currentTarget.checked)}
						/>
						<div>
							<span class="text-sm font-bold text-slate-900"
								>ผู้ดูแลระบบส่วนกลาง (System Admin)</span
							>
							<p class="text-xs text-slate-500">
								มีสิทธิ์สูงสุดระดับสากล เข้าถึงและจัดการได้ทุกศูนย์พักพิงในระบบ
							</p>
						</div>
					</label>
				</div>
			{/if}

			{#if isSaRoleSelected}
				<div
					class="flex items-start gap-3 rounded-lg border border-dashed border-input bg-slate-50 p-4"
				>
					<ShieldCheck class="mt-0.5 size-5 shrink-0 text-blue-600" />
					<div>
						<p class="text-sm font-bold text-slate-800">สิทธิ์ส่วนกลางทุกศูนย์ (System Admin)</p>
						<p class="text-xs text-slate-500">
							ผู้ดูแลระบบเข้าถึงได้ทุกศูนย์พักพิงในระบบ จึงไม่ต้องระบุสังกัดศูนย์
						</p>
					</div>
				</div>
			{:else if multiShelter}
				<div class="space-y-3">
					<div
						class="sticky top-0 z-10 -mx-1 flex items-center justify-between gap-2 border-b border-border bg-white/95 px-1 py-2 backdrop-blur supports-backdrop-filter:bg-white/80"
					>
						<p class="text-sm font-bold text-slate-800">
							ศูนย์พักพิงและตำแหน่งหน้าที่ <span class="text-red-500">*</span>
						</p>
						<Button
							type="button"
							variant="outline"
							size="sm"
							class="h-8"
							disabled={unusedShelterItems.length === 0 || sheltersQuery.isLoading}
							onclick={addAssignment}
						>
							<Plus class="mr-1 size-3.5" /> เพิ่มศูนย์
						</Button>
					</div>

					{#if ($formData.assignments ?? []).length === 0}
						<div
							class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center"
						>
							<p class="text-sm font-medium text-slate-700">ยังไม่ได้มอบหมายศูนย์</p>
							<p class="mt-1 text-xs text-slate-500">
								กด「เพิ่มศูนย์」แล้วเลือกบทบาทแยกรายศูนย์ เช่น ศูนย์ A = ลงทะเบียน, ศูนย์ B =
								การแพทย์
							</p>
						</div>
					{/if}

					{#each $formData.assignments ?? [] as assignment, index (index)}
						{@const shelter = (sheltersQuery.data ?? []).find(
							(s) => s.code === assignment.shelter_code
						)}
						{@const isShelterManager = isAssignmentRoleChecked(index, SHELTER_MANAGER)}
						<div class="space-y-2.5 rounded-xl border border-slate-200 bg-white p-3 shadow-xs">
							<div class="flex items-start gap-2">
								<div class="min-w-0 flex-1">
									<p class="mb-1 text-xs font-bold text-slate-500 uppercase">ศูนย์พักพิง</p>
									<Combobox
										items={shelterItems.filter(
											(s) =>
												s.value === assignment.shelter_code ||
												!($formData.assignments ?? []).some(
													(a, i) => i !== index && a.shelter_code === s.value
												)
										)}
										bind:value={
											() => assignment.shelter_code, (v) => setAssignmentShelter(index, v)
										}
										placeholder="เลือกศูนย์พักพิง"
										searchPlaceholder="ค้นหาจากชื่อหรือรหัสศูนย์..."
										emptyText="ไม่พบศูนย์พักพิง"
										disabled={sheltersQuery.isLoading}
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
									{#if shelter}
										<p class="mt-1 truncate text-xs text-muted-foreground">
											รหัส {shelter.code}{shelter.province ? ` · จ.${shelter.province}` : ''}
										</p>
									{/if}
								</div>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									class="mt-5 shrink-0 text-red-500 hover:bg-red-50 hover:text-red-600"
									onclick={() => requestRemoveAssignment(index)}
									aria-label="ลบศูนย์นี้"
								>
									<Trash2 class="size-4" />
								</Button>
							</div>

							<div
								class="flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50/30 px-3 py-2"
							>
								<label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
									<input
										type="checkbox"
										class="size-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
										checked={isShelterManager}
										onchange={(e) =>
											toggleAssignmentRole(index, SHELTER_MANAGER, e.currentTarget.checked)}
									/>
									<span class="text-sm font-semibold text-slate-900"
										>ผู้จัดการศูนย์พักพิง (Shelter Manager)</span
									>
								</label>
								{@render roleInfoButton(
									SHELTER_MANAGER_DESCRIPTION,
									'รายละเอียดผู้จัดการศูนย์พักพิง'
								)}
							</div>

							{#if !isShelterManager}
								<div class="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
									{#each ROLE_OPTIONS as role (role.id)}
										<div
											class="flex items-center gap-1 rounded-md px-1.5 py-1.5 transition-colors hover:bg-slate-50"
										>
											<label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
												<input
													type="checkbox"
													class="size-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
													checked={isAssignmentRoleChecked(index, role.id)}
													onchange={(e) =>
														toggleAssignmentRole(index, role.id, e.currentTarget.checked)}
												/>
												<span class="text-sm text-slate-800">{role.name}</span>
											</label>
											{@render roleInfoButton(role.description, `รายละเอียด${role.name}`)}
										</div>
									{/each}
								</div>
							{/if}
						</div>
					{/each}
				</div>
			{:else}
				<!-- Single-shelter (SM / locked) -->
				{#if shelterLocked || !isSA}
					<div>
						<p class="mb-1 block text-sm font-bold text-slate-800">ศูนย์พักพิงที่สังกัด</p>
						<div class="flex items-center gap-3 rounded-md border border-input bg-slate-50 p-3">
							<Building2 class="size-5 shrink-0 text-muted-foreground" />
							<div class="min-w-0 flex-1">
								<p class="truncate text-sm font-medium">
									{boundShelter?.name ?? boundShelterCode ?? 'ศูนย์ปัจจุบัน'}
								</p>
								{#if shelterMeta}
									<p class="truncate text-xs text-muted-foreground">
										{shelterMeta}
									</p>
								{/if}
							</div>
							<Lock class="size-4 text-muted-foreground" />
						</div>
					</div>
				{:else}
					<Form.Field {form} name="shelter_id">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class="font-bold"
									>ศูนย์พักพิงที่สังกัด <span class="text-red-500">*</span></Form.Label
								>
								<Combobox
									items={shelterItems}
									bind:value={
										() => $formData.shelter_id ?? '', (v) => ($formData.shelter_id = v || undefined)
									}
									placeholder={sheltersQuery.isLoading
										? 'กำลังโหลดรายชื่อศูนย์...'
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
						<Form.FieldErrors />
					</Form.Field>
				{/if}

				<div class="space-y-3">
					<p class="text-sm font-bold text-slate-800">
						ตำแหน่งหน้าที่ <span class="text-red-500">*</span>
					</p>

					{#if !dutiesReady}
						<div
							class="rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center"
						>
							<p class="text-sm font-medium text-slate-700">เลือกศูนย์พักพิงก่อน</p>
						</div>
					{:else}
						{@const isShelterManager = isRoleChecked(SHELTER_MANAGER)}
						{#if isSA}
							<div
								class="flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50/30 px-3 py-2"
							>
								<label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5">
									<input
										type="checkbox"
										class="size-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
										checked={isShelterManager}
										onchange={(e) => toggleRole(SHELTER_MANAGER, e.currentTarget.checked)}
									/>
									<span class="text-sm font-semibold text-slate-900"
										>ผู้จัดการศูนย์พักพิง (Shelter Manager)</span
									>
								</label>
								{@render roleInfoButton(
									SHELTER_MANAGER_DESCRIPTION,
									'รายละเอียดผู้จัดการศูนย์พักพิง'
								)}
							</div>
						{/if}

						{#if !isShelterManager}
							<div class="grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">
								{#each ROLE_OPTIONS as role (role.id)}
									<div
										class="flex items-center gap-1 rounded-md px-1.5 py-1.5 transition-colors hover:bg-slate-50"
									>
										<label class="flex min-w-0 flex-1 cursor-pointer items-center gap-2">
											<input
												type="checkbox"
												class="size-4 shrink-0 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
												checked={isRoleChecked(role.id)}
												onchange={(e) => toggleRole(role.id, e.currentTarget.checked)}
											/>
											<span class="text-sm text-slate-800">{role.name}</span>
										</label>
										{@render roleInfoButton(role.description, `รายละเอียด${role.name}`)}
									</div>
								{/each}
							</div>
						{/if}
					{/if}
				</div>
			{/if}
		</div>

		<!-- 4. ข้อความแจ้งเตือนความผิดพลาด -->
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
	</div>

	<!-- 5. ปุ่มดำเนินการ (sticky bottom + safe-area offset) -->
	<div
		class="sticky bottom-0 z-10 flex shrink-0 gap-4 border-t border-border bg-background/95 px-6 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur supports-backdrop-filter:bg-background/80"
	>
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
			class="h-11 flex-1 bg-blue-700 hover:bg-blue-800"
		>
			<Save class="mr-2 h-4 w-4" />
			บันทึกข้อมูล
		</Form.Button>
	</div>
</form>

<AlertDialog.Root
	open={pendingRemoveIndex !== null}
	onOpenChange={(open) => {
		if (!open) pendingRemoveIndex = null;
	}}
>
	<AlertDialog.Content>
		<AlertDialog.Header>
			<AlertDialog.Title>ลบศูนย์นี้ออก?</AlertDialog.Title>
			<AlertDialog.Description>
				{#if pendingRemoveShelter?.name}
					จะลบการมอบหมายศูนย์「{pendingRemoveShelter.name}」({pendingRemoveShelter.code})
					ออกจากการตั้งค่าผู้ใช้งานนี้
				{:else if pendingRemoveShelter?.code}
					จะลบการมอบหมายศูนย์รหัส {pendingRemoveShelter.code} ออกจากการตั้งค่าผู้ใช้งานนี้
				{:else}
					จะลบการมอบหมายศูนย์นี้ออกจากการตั้งค่าผู้ใช้งานนี้
				{/if}
			</AlertDialog.Description>
		</AlertDialog.Header>
		<AlertDialog.Footer>
			<AlertDialog.Cancel>ยกเลิก</AlertDialog.Cancel>
			<AlertDialog.Action
				class="bg-destructive text-white hover:bg-destructive/90"
				onclick={confirmRemoveAssignment}
			>
				ลบออก
			</AlertDialog.Action>
		</AlertDialog.Footer>
	</AlertDialog.Content>
</AlertDialog.Root>
