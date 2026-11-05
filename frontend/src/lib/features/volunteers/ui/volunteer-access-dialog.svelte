<script lang="ts">
	import { useQueryClient } from '@tanstack/svelte-query';
	import { toast } from 'svelte-sonner';
	import Eye from '@lucide/svelte/icons/eye';
	import EyeOff from '@lucide/svelte/icons/eye-off';
	import KeyRound from '@lucide/svelte/icons/key-round';
	import Mail from '@lucide/svelte/icons/mail';
	import Lock from '@lucide/svelte/icons/lock';
	import RefreshCw from '@lucide/svelte/icons/refresh-cw';
	import Save from '@lucide/svelte/icons/save';
	import UserMinus from '@lucide/svelte/icons/user-minus';
	import Info from '@lucide/svelte/icons/info';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as RadioGroup from '$lib/components/ui/radio-group/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Popover from '$lib/components/ui/popover/index.js';
	import DatePicker from '$lib/components/date-picker.svelte';
	import PasswordRuleChecklist from '$lib/components/password-rule-checklist.svelte';
	import {
		COORDINATOR_GRANTABLE_CAPABILITIES,
		STAFF_CAPABILITIES,
		STAFF_CAPABILITY_DESCRIPTIONS,
		isShelterManager,
		isSystemAdmin,
		roleOptionLabel,
		type StaffCapability
	} from '$lib/auth/roles';
	import { MAX_GRANT_DAYS, grantExpiryLabel, grantExpiryRange } from '$lib/auth/role-grants';
	import { authStore } from '$lib/stores/auth.svelte';
	import { formatThaiShortDate } from '$lib/utils/date';
	import { generateTemporaryPassphrase } from '$lib/auth/passphrase-generator';
	import { useVolunteerGrants, volunteerKeys } from '../application/queries';
	import { errorMessage } from '$lib/utils/errors';
	import {
		ROLE_REQUIRED_MESSAGE,
		accessState,
		currentGrantRole,
		VOLUNTEER_ACCESS_PHONE_MESSAGE,
		accountPhone,
		coordinatorAccessSchema,
		grantVolunteerAccess,
		grantVolunteerAccessAsCoordinator,
		hasInvalidAccessPhone,
		revokeVolunteerGrant,
		volunteerAccessSchema,
		volunteerPasswordError
	} from '../application/volunteer-access';
	import { accessEndingParts } from '../domain/volunteer-access-status';
	import { identityVerificationStatus } from '../domain/verification';
	import type { Volunteer } from '../domain/volunteer.schema';

	let {
		open = $bindable(false),
		volunteer,
		shelterLine
	}: {
		open?: boolean;
		volunteer: Volunteer;
		shelterLine: string;
	} = $props();

	/** FR-21 / FR-9: a closed profile is reopened first (card button "เปิดใช้งานอีกครั้ง"). */
	const INACTIVE_PROFILE_MESSAGE = 'เปิดใช้งานอาสาสมัครก่อนจึงจะออกสิทธิ์ได้';
	/** FR-16: a role a shelter manager gave cannot be changed by a coordinator. */
	const MANAGER_GIVEN_NOTE = 'ผู้จัดการศูนย์เป็นผู้ให้ แก้ไขได้ที่หน้าผู้ใช้งาน';

	const queryClient = useQueryClient();
	let pending = $state(false);

	const loginPhone = $derived(accountPhone(volunteer.phone));
	const phoneBlocksAccess = $derived(hasInvalidAccessPhone(volunteer.phone));
	const fullName = $derived(`${volunteer.first_name} ${volunteer.last_name}`.trim());

	// A coordinator (not SM/SA) grants a limited role with a required expiry (#955); the BFF
	// enforces the same limits, this only shapes the form.
	const limited = $derived.by(() => {
		const roles = authStore.user?.roles ?? [];
		return !(isSystemAdmin(roles) || isShelterManager(roles, volunteer.shelter_code));
	});
	const roleChoices = $derived<readonly StaffCapability[]>(
		limited ? COORDINATOR_GRANTABLE_CAPABILITIES : STAFF_CAPABILITIES
	);
	const expiryRange = $derived(grantExpiryRange());
	// Access is first given, or given again, only once the identity is verified in this shelter
	// (#1044), whoever grants. Editing or revoking a grant the account already holds stays open
	// (CR-221 FR-3), so `blockedReason` below checks it only while the account holds no grant here:
	// a grant beside a manager's permanent role is a new one (A1-2).
	const unverifiedHere = $derived(identityVerificationStatus(volunteer) !== 'verified');
	// Any grant in this shelter can be taken back here, whoever issued it (FR-17); a role a manager
	// gave has no grant and is changed on the users page (FR-16).
	const grantsQuery = useVolunteerGrants(
		() => volunteer,
		() => open && limited
	);
	const grantedAccount = $derived(grantsQuery.data?.email ?? null);
	// SM / SA do not read the grants view, so their only sign of an existing account is the
	// profile's `user_name`; they treat it as existing only while the phone default stands in:
	// should the account turn out to be gone, it is recreated with that phone password and a
	// forced change, never an unknown one.
	const linkedAccountKnown = $derived(Boolean(volunteer.user_name) && loginPhone !== null);
	const grants = $derived(grantsQuery.data?.grants ?? []);
	// Where the volunteer stands here (#1044): drives the title, the save label and the note.
	const standing = $derived(limited ? accessState(grantsQuery.data ?? null) : accessState(null));
	// Roles a manager gave here: shown but not selectable, and the server refuses a grant of one
	// (CR-221 A1-2). Any other role may be granted beside them; revoking a grant stays open.
	const permanentRoles = $derived(standing.kind === 'active' ? standing.permanentRoles : []);
	// CR-221 FR-10: an account that already exists (standing `active` / `lapsed`; for SM / SA, the
	// profile's link) shows its username read-only and asks for no password. Until the grants view
	// has answered (loading or failed) a coordinator falls back to the profile's own link, as SM / SA
	// do, so a linked profile never flashes an editable email and a password; the save path reads
	// the same value, so it asks for no password then either (the server keeps an existing one).
	const accountExists = $derived(
		limited && grantsQuery.data ? standing.kind !== 'none' : linkedAccountKnown
	);
	// CR-221 FR-13: the grant being edited, shown as "เดิม: …" under the expiry picker, which
	// itself starts empty so the expiry is chosen again on every edit.
	const currentGrant = $derived(
		standing.kind === 'active'
			? ([...grants].sort((a, b) => Date.parse(b.expires_at) - Date.parse(a.expires_at))[0] ?? null)
			: null
	);
	const pickedManagerRole = $derived(limited && role !== '' && permanentRoles.includes(role));
	// A closed profile is reopened before it can be given access (CR-221 FR-21, FR-9).
	const profileClosed = $derived(volunteer.status === 'inactive');
	const blockedReason = $derived(
		profileClosed
			? INACTIVE_PROFILE_MESSAGE
			: phoneBlocksAccess
				? VOLUNTEER_ACCESS_PHONE_MESSAGE
				: unverifiedHere && grants.length === 0
					? 'อาสาสมัครยังไม่ยืนยันตัวตนในศูนย์นี้ กรุณายืนยันตัวตนก่อนจึงจะออกสิทธิ์ได้'
					: pickedManagerRole
						? MANAGER_GIVEN_NOTE
						: null
	);
	// Copy per FR-14.
	const title = $derived(
		standing.kind === 'active'
			? 'แก้ไขสิทธิ์'
			: standing.kind === 'lapsed'
				? 'ออกสิทธิ์อีกครั้ง'
				: 'ออกสิทธิ์ใช้งานระบบ'
	);
	const saveLabel = $derived(
		standing.kind === 'active'
			? 'บันทึกการแก้ไข'
			: standing.kind === 'lapsed'
				? 'ออกสิทธิ์อีกครั้ง'
				: 'บันทึกและออกสิทธิ์ใหม่'
	);
	const lastEndedParts = $derived(
		standing.kind === 'lapsed' ? accessEndingParts(standing.lastEnded) : null
	);
	let confirmRevoke = $state<string | null>(null);

	let expiresOn = $state('');
	let submitError = $state<string | null>(null);

	let email = $state('');
	let showPassword = $state(false);
	/** Empty until the grantor picks one: no role is preselected (#1072). */
	let role = $state<StaffCapability | ''>('');
	let roleError = $state<string | null>(null);
	let password = $state('');
	let passwordError = $state<string | null>(null);

	let lastOpenedId = $state<string | null>(null);
	/** Editing an account that already holds a grant here starts on its current role (#1044). */
	let roleSeededFor = $state<string | null>(null);
	$effect(() => {
		if (!open) {
			lastOpenedId = null;
			return;
		}
		if (lastOpenedId === volunteer._id) return;
		email = volunteer.user_name ?? volunteer.email ?? '';
		role = '';
		roleError = null;
		roleSeededFor = null;
		password = loginPhone ?? '';
		expiresOn = '';
		confirmRevoke = null;
		submitError = null;
		passwordError = null;
		showPassword = false;
		lastOpenedId = volunteer._id;
	});
	$effect(() => {
		if (!open || roleSeededFor === volunteer._id || !grantsQuery.data) return;
		roleSeededFor = volunteer._id;
		if (!role) role = currentGrantRole(grants, roleChoices);
	});

	async function submit() {
		if (pending) return;
		submitError = null;
		if (blockedReason) {
			toast.error(blockedReason);
			return;
		}
		if (!role) {
			// Every refusal is a toast (it fades) and stays written next to its field until fixed.
			roleError = ROLE_REQUIRED_MESSAGE;
			toast.error(ROLE_REQUIRED_MESSAGE);
			return;
		}
		if (limited) {
			await submitLimited();
			return;
		}
		const parsed = volunteerAccessSchema.safeParse({ email, password, role });
		if (!parsed.success) {
			toast.error(parsed.error.issues[0]?.message ?? 'กรุณาตรวจสอบข้อมูล');
			return;
		}
		passwordError = volunteerPasswordError(parsed.data.password, loginPhone);
		if (passwordError) {
			toast.error(passwordError);
			return;
		}
		pending = true;
		try {
			const result = await grantVolunteerAccess(volunteer, parsed.data);
			toast.success(
				result.created
					? `สร้างบัญชี (${parsed.data.email}) และออกสิทธิ์แล้ว`
					: result.roleAdded
						? `ออกสิทธิ์ให้บัญชี (${parsed.data.email}) แล้ว รหัสผ่านเดิมไม่เปลี่ยนแปลง`
						: `ผูกบัญชี (${parsed.data.email}) แล้ว รหัสผ่านเดิมไม่เปลี่ยนแปลง`
			);
			password = '';
			open = false;
		} catch (err) {
			toast.error(errorMessage(err));
		} finally {
			await refresh();
		}
	}

	async function submitLimited() {
		const parsed = coordinatorAccessSchema.safeParse({
			email,
			password: accountExists ? '' : password,
			role,
			expires_on: expiresOn,
			account_exists: accountExists
		});
		if (!parsed.success) {
			submitError = parsed.error.issues[0]?.message ?? 'กรุณาตรวจสอบข้อมูล';
			toast.error(submitError);
			return;
		}
		passwordError = accountExists ? null : volunteerPasswordError(parsed.data.password, loginPhone);
		if (passwordError) {
			toast.error(passwordError);
			return;
		}
		pending = true;
		try {
			const result = await grantVolunteerAccessAsCoordinator(volunteer, parsed.data);
			const until = formatThaiShortDate(parsed.data.expires_on);
			toast.success(
				result.unchanged
					? `บัญชี (${parsed.data.email}) มีสิทธิ์นี้อยู่แล้ว ไม่เปลี่ยนแปลง`
					: result.created
						? `สร้างบัญชี (${parsed.data.email}) และออกสิทธิ์ถึงสิ้นวันที่ ${until} แล้ว`
						: `ออกสิทธิ์ให้บัญชี (${parsed.data.email}) ถึงสิ้นวันที่ ${until} แล้ว รหัสผ่านเดิมไม่เปลี่ยนแปลง`
			);
			password = '';
			open = false;
		} catch (err) {
			submitError = errorMessage(err);
			toast.error(submitError);
		} finally {
			await refresh();
		}
	}

	async function revoke(grantedRole: string) {
		if (pending || !grantedAccount) return;
		submitError = null;
		pending = true;
		try {
			await revokeVolunteerGrant(volunteer, { email: grantedAccount, role: grantedRole });
			toast.success(
				`ถอนสิทธิ์ ${roleOptionLabel(grantedRole)} จากบัญชี (${grantedAccount}) แล้ว บัญชียังอยู่`
			);
			confirmRevoke = null;
		} catch (err) {
			submitError = errorMessage(err);
			toast.error(submitError);
		} finally {
			await refresh();
		}
	}

	async function refresh() {
		await Promise.allSettled([
			queryClient.invalidateQueries({ queryKey: ['users'] }),
			queryClient.invalidateQueries({ queryKey: volunteerKeys.all })
		]);
		pending = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
		<div class="flex items-center gap-2 border-b border-border px-6 py-4 pr-12">
			<div
				class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-domain-volunteer-subtle text-domain-volunteer-strong"
			>
				<KeyRound class="h-4.5 w-4.5" />
			</div>
			<div class="min-w-0">
				<Dialog.Title class="text-base font-bold">{title}</Dialog.Title>
				<p class="text-xs text-muted-foreground">{fullName} ({volunteer.volunteer_code})</p>
			</div>
		</div>

		<div class="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
			{#if standing.kind === 'active'}
				<div
					role="status"
					class="rounded-xl border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-800"
				>
					<p class="font-semibold">บัญชี ({grantedAccount}) มีสิทธิ์ในศูนย์นี้อยู่แล้ว</p>
					<p class="mt-0.5 text-xs">
						{#if grants.length > 0}
							เลือกบทบาทและวันหมดอายุใหม่เพื่อแก้ไขหรือต่ออายุ บทบาทที่เลือกจะแทนที่บทบาทเดิม
						{:else}
							เลือกบทบาทและวันหมดอายุเพื่อออกสิทธิ์ชั่วคราวเพิ่มจากสิทธิ์ถาวร
						{/if}
					</p>
					{#if standing.permanentRoles.length > 0}
						<p class="mt-1 text-xs">
							สิทธิ์ถาวรจากผู้จัดการศูนย์: {standing.permanentRoles.map(roleOptionLabel).join(', ')}
							(แก้ได้ที่หน้าผู้ใช้งาน)
						</p>
					{/if}
				</div>
			{:else if standing.kind === 'lapsed'}
				<div
					role="status"
					class="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900"
				>
					<p class="font-semibold">
						บัญชี ({grantedAccount}) มีอยู่แล้ว แต่ยังไม่มีสิทธิ์ในศูนย์นี้
					</p>
					{#if standing.lastEnded && lastEndedParts}
						<p class="mt-0.5 text-xs">
							สิทธิ์ล่าสุด{standing.lastEnded.role
								? ` (${roleOptionLabel(standing.lastEnded.role)})`
								: ''}
							{lastEndedParts.how}เมื่อ {formatThaiShortDate(standing.lastEnded.at)}
							{#if standing.lastEnded.reason === 'revoked' && standing.lastEnded.by}
								<!-- The sweep revokes as `worker`; staff read that as the system. -->
								โดย{standing.lastEnded.by === 'worker' ? 'ระบบ' : ` ${standing.lastEnded.by}`}
							{/if}
						</p>
					{/if}
					<p class="mt-0.5 text-xs">ออกสิทธิ์อีกครั้งได้เลย รหัสผ่านเดิมของบัญชีไม่เปลี่ยน</p>
				</div>
			{/if}
			<div
				class="space-y-3 rounded-xl border border-domain-volunteer-border bg-domain-volunteer-subtle p-3"
			>
				<p class="text-xs font-bold text-domain-volunteer-text">
					ข้อมูลผู้ใช้งานใหม่ (Auto-filled)
				</p>
				<div class="grid grid-cols-1 gap-3 text-xs sm:grid-cols-2">
					<div>
						<p class="text-domain-volunteer-text">ชนิดคน:</p>
						<p class="font-semibold text-foreground">🎫 อาสาสมัคร</p>
					</div>
					<div>
						<p class="text-domain-volunteer-text">ชื่อ-นามสกุล:</p>
						<p class="font-semibold text-foreground">{fullName}</p>
					</div>
					<div>
						<p class="text-domain-volunteer-text">เบอร์โทรศัพท์:</p>
						<p class="font-semibold text-foreground">{volunteer.phone ?? '—'}</p>
					</div>
					<div>
						<p class="text-domain-volunteer-text">สังกัดศูนย์พักพิง:</p>
						<p class="font-semibold text-foreground">{shelterLine}</p>
					</div>
				</div>
			</div>

			<div class="space-y-1.5">
				<p
					id={`volunteer-access-role-label-${volunteer._id}`}
					class="text-xs font-bold text-foreground"
				>
					บทบาท/สิทธิ์ใช้งานระบบ (ROLE ASSIGNMENT) <span class="text-destructive">*</span>
				</p>
				<RadioGroup.Root
					bind:value={role}
					onValueChange={() => (roleError = null)}
					disabled={pending}
					aria-labelledby={`volunteer-access-role-label-${volunteer._id}`}
					aria-invalid={roleError ? true : undefined}
					aria-describedby={roleError ? `volunteer-access-role-error-${volunteer._id}` : undefined}
					class="grid grid-cols-1 gap-2 sm:grid-cols-2"
				>
					{#each roleChoices as capability (capability)}
						<div
							class="flex min-h-11 items-center gap-1 rounded-xl border border-border bg-background pr-1"
						>
							<Label
								for={`volunteer-access-role-${volunteer._id}-${capability}`}
								class="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2.5 px-3 py-2 text-sm font-medium text-foreground"
							>
								<RadioGroup.Item
									id={`volunteer-access-role-${volunteer._id}-${capability}`}
									value={capability}
									disabled={permanentRoles.includes(capability)}
								/>
								<span class="flex min-w-0 flex-col">
									<span>{roleOptionLabel(capability)}</span>
									{#if permanentRoles.includes(capability)}
										<span class="text-[11px] font-normal text-muted-foreground"
											>{MANAGER_GIVEN_NOTE}</span
										>
									{/if}
								</span>
							</Label>
							<!-- Same wording as the users page role picker (STAFF_CAPABILITY_DESCRIPTIONS). -->
							<Popover.Root>
								<Popover.Trigger
									type="button"
									class="inline-flex size-9 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
									aria-label={`รายละเอียด${roleOptionLabel(capability)}`}
								>
									<Info class="size-4" />
								</Popover.Trigger>
								<Popover.Content class="max-w-[280px] p-3 text-sm" align="end" side="top">
									{STAFF_CAPABILITY_DESCRIPTIONS[capability]}
								</Popover.Content>
							</Popover.Root>
						</div>
					{/each}
				</RadioGroup.Root>
				{#if roleError}
					<p
						id={`volunteer-access-role-error-${volunteer._id}`}
						class="text-sm font-medium text-destructive"
					>
						{roleError}
					</p>
				{/if}
				<p class="text-[11px] text-muted-foreground">
					{#if limited}
						* ผู้ประสานงานออกสิทธิ์ได้เฉพาะบทบาทเหล่านี้ ในศูนย์พักพิงนี้ แก้ไข ต่ออายุ ย่นอายุ
						หรือถอนสิทธิ์ที่ออกให้ในศูนย์นี้ได้ ไม่ว่าใครเป็นผู้ออก (สิทธิ์ที่ผู้จัดการศูนย์ให้
						ให้ผู้จัดการศูนย์แก้ไข)
					{:else}
						* บัญชีใช้สิทธิ์ที่เลือกในศูนย์พักพิงนี้ จัดการสิทธิ์เพิ่มเติมได้ผ่านหน้าผู้ใช้งาน
					{/if}
				</p>
			</div>

			{#if limited && grantedAccount && grants.length > 0}
				<div class="space-y-2 rounded-xl border border-border p-4">
					<p class="text-xs font-bold text-foreground">
						สิทธิ์ที่ออกให้บัญชี ({grantedAccount}) แล้ว
					</p>
					<ul class="divide-y divide-border">
						{#each grants as grant (grant.role)}
							<li class="flex flex-wrap items-center justify-between gap-2 py-2 text-xs">
								<div class="min-w-0">
									<p class="font-semibold text-foreground">{roleOptionLabel(grant.role)}</p>
									<p class="text-muted-foreground">
										{grantExpiryLabel(grant)}{grant.mine ? ' · ออกโดยคุณ' : ''}
									</p>
								</div>
								{#if confirmRevoke === grant.role}
									<div class="flex gap-2">
										<Button
											type="button"
											variant="ghost"
											size="sm"
											disabled={pending}
											onclick={() => (confirmRevoke = null)}>ไม่ถอน</Button
										>
										<Button
											type="button"
											variant="destructive"
											size="sm"
											disabled={pending}
											onclick={() => revoke(grant.role)}>ยืนยันถอนสิทธิ์</Button
										>
									</div>
								{:else}
									<Button
										type="button"
										variant="outline"
										size="sm"
										class="gap-1.5 text-destructive"
										disabled={pending}
										onclick={() => (confirmRevoke = grant.role)}
									>
										<UserMinus class="size-4" />
										ถอนสิทธิ์
									</Button>
								{/if}
							</li>
						{/each}
					</ul>
				</div>
			{/if}

			{#if limited}
				<div class="space-y-1.5">
					<label
						for={`volunteer-access-expiry-${volunteer._id}`}
						class="block text-xs font-bold text-foreground"
					>
						วันหมดอายุของสิทธิ์ <span class="text-destructive">*</span>
					</label>
					<div class="sm:max-w-xs">
						<DatePicker
							id={`volunteer-access-expiry-${volunteer._id}`}
							bind:value={expiresOn}
							min={expiryRange.min}
							max={expiryRange.max}
							disabled={pending}
							placeholder="เลือกวันหมดอายุ"
							format={formatThaiShortDate}
						/>
					</div>
					{#if currentGrant}
						<p class="text-xs font-medium text-foreground" data-testid="previous-expiry">
							เดิม: {grantExpiryLabel(currentGrant)}{currentGrant.granted_by
								? ` · ออกโดย ${currentGrant.granted_by}`
								: ''}
						</p>
					{/if}
					<p class="text-[11px] text-muted-foreground">
						เลือกได้ตั้งแต่วันนี้ถึง {MAX_GRANT_DAYS} วันข้างหน้า สิทธิ์หมดอายุตอนสิ้นวันที่เลือก ต่ออายุได้ด้วยการออกสิทธิ์ซ้ำ
					</p>
				</div>

				{#if submitError}
					<p role="alert" class="text-sm font-medium text-destructive">{submitError}</p>
				{/if}
			{/if}
			{#if blockedReason}
				<p role="alert" class="text-sm font-medium text-destructive">{blockedReason}</p>
			{/if}

			<div class="space-y-3 rounded-xl border border-border p-4">
				<p class="flex items-center gap-1.5 text-xs font-bold text-foreground">
					<Lock class="h-3.5 w-3.5" />
					กำหนดบัญชีผู้ใช้งานระบบ (AUTHENTICATION &amp; CREDENTIALS)
				</p>

				{#if accountExists}
					<div class="space-y-1.5">
						<span
							id={`volunteer-access-username-label-${volunteer._id}`}
							class="flex items-center gap-1.5 text-xs font-semibold text-foreground"
						>
							<Mail class="h-3.5 w-3.5" />
							Username เข้าสู่ระบบ
						</span>
						<p
							id={`volunteer-access-username-${volunteer._id}`}
							aria-labelledby={`volunteer-access-username-label-${volunteer._id}`}
							data-testid="existing-username"
							class="min-h-11 rounded-lg border border-border bg-muted px-3 py-2.5 text-sm font-medium break-all text-foreground"
						>
							{email}
						</p>
					</div>
					<p
						class="flex items-center gap-1.5 rounded-lg border border-border p-3 text-xs text-muted-foreground"
					>
						<KeyRound class="h-3.5 w-3.5 shrink-0" />
						บัญชีนี้มีอยู่แล้ว การออกสิทธิ์ไม่เปลี่ยนรหัสผ่านเดิม
					</p>
				{:else}
					<div class="space-y-1.5">
						<div class="flex flex-wrap items-center justify-between gap-2">
							<span class="flex items-center gap-1.5 text-xs font-semibold text-foreground">
								<Mail class="h-3.5 w-3.5" />
								อีเมลสำหรับใช้เป็น Username เข้าสู่ระบบ <span class="text-destructive">*</span>
							</span>
							<Badge variant="outline" class="border-amber-300 text-[10px] text-amber-700">
								กรอกอีเมลเพื่ออัปเดตลงโปรไฟล์อัตโนมัติ
							</Badge>
						</div>
						<Input
							type="email"
							bind:value={email}
							disabled={pending}
							autocomplete="off"
							aria-label="อีเมลสำหรับเข้าสู่ระบบ"
							class="h-11"
							placeholder="เช่น volunteer@example.com หรือ volunteer@gmail.com"
						/>
						<p class="text-[11px] text-muted-foreground">
							* เมื่อบันทึก ระบบจะใช้อีเมลนี้เป็น Username เข้าสู่ระบบ
							และบันทึกอัปเดตลงในโปรไฟล์จิตอาสาให้อัตโนมัติ
						</p>
					</div>

					<div class="space-y-1.5 rounded-lg border border-border p-3">
						<label
							for={`volunteer-access-password-${volunteer._id}`}
							class="flex items-center gap-1.5 text-xs font-semibold text-foreground"
						>
							<KeyRound class="h-3.5 w-3.5" />
							รหัสผ่านสำหรับบัญชีใหม่ <span class="text-destructive">*</span>
						</label>
						<div class="flex flex-col gap-2 sm:flex-row sm:items-stretch">
							<div class="relative min-w-0 flex-1">
								<Input
									id={`volunteer-access-password-${volunteer._id}`}
									type={showPassword ? 'text' : 'password'}
									bind:value={password}
									oninput={() => (passwordError = null)}
									disabled={pending}
									autocomplete="new-password"
									aria-invalid={passwordError ? true : undefined}
									aria-describedby={passwordError
										? `volunteer-access-password-error-${volunteer._id}`
										: undefined}
									class="h-11 pr-10"
									placeholder="กำหนดรหัสผ่านสำหรับเข้าสู่ระบบ"
								/>
								<Button
									type="button"
									variant="ghost"
									size="icon"
									class="absolute top-0 right-0 h-full px-3 hover:bg-transparent"
									aria-label={showPassword ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}
									aria-pressed={showPassword}
									onclick={() => (showPassword = !showPassword)}
								>
									{#if showPassword}
										<EyeOff class="size-4 text-muted-foreground" />
									{:else}
										<Eye class="size-4 text-muted-foreground" />
									{/if}
								</Button>
							</div>
							<Button
								type="button"
								variant="outline"
								class="h-11 shrink-0 gap-1.5 sm:px-3"
								disabled={pending}
								onclick={() => {
									password = generateTemporaryPassphrase();
									passwordError = null;
									showPassword = true;
								}}
							>
								<RefreshCw class="size-4" />
								สร้างรหัส
							</Button>
						</div>
						<!-- The volunteer's own mobile is accepted as a one-time default; any other password
						     must meet the policy, so only then show the checklist (#1045). -->
						{#if password.trim() && password.trim() !== loginPhone}
							<PasswordRuleChecklist {password} />
						{/if}
						{#if passwordError}
							<p
								id={`volunteer-access-password-error-${volunteer._id}`}
								class="text-sm font-medium text-destructive"
							>
								{passwordError}
							</p>
						{/if}
						{#if loginPhone}
							<p class="text-[11px] text-muted-foreground">
								ค่าเริ่มต้นคือเบอร์โทรศัพท์ของอาสาสมัคร
								และจะบังคับเปลี่ยนรหัสผ่านในการเข้าสู่ระบบครั้งแรก หากเปลี่ยนเป็นรหัสอื่น
								ต้องมีอย่างน้อย 10 ตัวอักษร พร้อมตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก ตัวเลข และอักขระพิเศษ
							</p>
						{:else}
							<p class="text-[11px] text-muted-foreground">
								อาสาสมัครไม่มีเบอร์มือถือ 10 หลัก จึงใช้เบอร์เป็นรหัสผ่านเริ่มต้นไม่ได้
								และบัญชีจะไม่มีเบอร์ กรุณาตั้งรหัสผ่านเองหรือกด "สร้างรหัส" (อย่างน้อย 10 ตัวอักษร
								พร้อมตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก ตัวเลข และอักขระพิเศษ)
								บัญชีนี้ใช้อีเมลเข้าสู่ระบบเท่านั้น
								และเมื่อเข้าสู่ระบบครั้งแรกจะต้องตั้งรหัสผ่านใหม่และคำถามความปลอดภัยเหมือนบัญชีอื่น
							</p>
						{/if}
						<p class="text-[11px] text-muted-foreground">
							หากสร้างบัญชีแล้วแต่บันทึกโปรไฟล์ไม่สำเร็จ ให้ลองอีกครั้งด้วยอีเมลและบทบาทเดิม
							ระบบจะผูกบัญชีที่สร้างไว้โดยไม่เปลี่ยนรหัสผ่านเดิม
						</p>
					</div>
				{/if}
			</div>
		</div>

		<div class="flex items-center justify-end gap-2 border-t border-border px-6 py-4">
			<Button type="button" variant="ghost" disabled={pending} onclick={() => (open = false)}
				>ยกเลิก</Button
			>
			<Button
				type="button"
				class="gap-1.5 bg-domain-volunteer-strong text-white hover:bg-domain-volunteer-text"
				disabled={pending || blockedReason !== null}
				onclick={submit}
			>
				{#if pending}
					กำลังบันทึก...
				{:else}
					<Save class="h-4 w-4" />
					{saveLabel}
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
