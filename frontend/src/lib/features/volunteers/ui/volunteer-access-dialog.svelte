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
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import {
		COORDINATOR_GRANTABLE_CAPABILITIES,
		STAFF_CAPABILITIES,
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
		accountPhones,
		coordinatorAccessSchema,
		grantVolunteerAccess,
		grantVolunteerAccessAsCoordinator,
		revokeVolunteerGrant,
		volunteerAccessSchema,
		volunteerPasswordError
	} from '../application/volunteer-access';
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

	const queryClient = useQueryClient();
	let pending = $state(false);

	const phones = $derived(accountPhones(volunteer.phone));
	const loginPhone = $derived(phones.login);
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
	// Identity verified in another shelter (same phone AND national ID) is only known to the
	// server, so a volunteer with both may still be granted; one missing either cannot be.
	const unverifiedHere = $derived(identityVerificationStatus(volunteer) !== 'verified');
	const canCheckElsewhere = $derived(
		accountPhones(volunteer.phone).contact !== null &&
			Boolean(volunteer.national_id_hash || volunteer.national_id)
	);
	const blockedReason = $derived(
		limited && unverifiedHere && !canCheckElsewhere
			? 'อาสาสมัครยังไม่ยืนยันตัวตนในศูนย์นี้ และไม่มีเบอร์โทรหรือเลขบัตรประชาชนให้ตรวจผลยืนยันจากศูนย์อื่น จึงออกสิทธิ์ไม่ได้'
			: null
	);
	// The caller's own grants can be taken back here (FR-8); the BFF refuses anyone else's.
	const grantsQuery = useVolunteerGrants(
		() => volunteer,
		() => open && limited
	);
	const grantedAccount = $derived(grantsQuery.data?.email ?? null);
	// A linked profile already has an account: the server keeps its password, so the field is
	// hidden. Only while the phone default stands in: should the account turn out to be gone,
	// it is recreated with that phone password and a forced change, never an unknown one.
	const keepsPassword = $derived(Boolean(volunteer.user_name) && loginPhone !== null);
	const grants = $derived(grantsQuery.data?.grants ?? []);
	let confirmRevoke = $state<string | null>(null);

	let expiresOn = $state('');
	let submitError = $state<string | null>(null);

	let email = $state('');
	let showPassword = $state(false);
	let role = $state<StaffCapability>('registration_staff');
	let password = $state('');
	let passwordError = $state<string | null>(null);

	let lastOpenedId = $state<string | null>(null);
	$effect(() => {
		if (!open) {
			lastOpenedId = null;
			return;
		}
		if (lastOpenedId === volunteer._id) return;
		email = volunteer.user_name ?? volunteer.email ?? '';
		role = 'registration_staff';
		password = loginPhone ?? '';
		expiresOn = '';
		confirmRevoke = null;
		submitError = null;
		passwordError = null;
		showPassword = false;
		lastOpenedId = volunteer._id;
	});

	async function submit() {
		if (pending) return;
		submitError = null;
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
		if (passwordError) return;
		pending = true;
		try {
			const result = await grantVolunteerAccess(volunteer, parsed.data);
			toast.success(
				result.created
					? `สร้างบัญชี (${parsed.data.email}) และออกสิทธิ์แล้ว`
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
			password,
			role,
			expires_on: expiresOn
		});
		if (!parsed.success) {
			submitError = parsed.error.issues[0]?.message ?? 'กรุณาตรวจสอบข้อมูล';
			return;
		}
		passwordError = volunteerPasswordError(parsed.data.password, loginPhone);
		if (passwordError) return;
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
				<Dialog.Title class="text-base font-bold">ออกสิทธิ์ใช้งานระบบหลังบ้าน</Dialog.Title>
				<p class="text-xs text-muted-foreground">{fullName} ({volunteer.volunteer_code})</p>
			</div>
		</div>

		<div class="max-h-[70vh] space-y-5 overflow-y-auto px-6 py-5">
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
				<p class="text-xs font-bold text-foreground">บทบาท/สิทธิ์ใช้งานระบบ (ROLE ASSIGNMENT)</p>
				<Select.Root type="single" bind:value={role} disabled={pending}>
					<Select.Trigger class="h-11 w-full rounded-xl bg-background px-3">
						<span class="truncate">{roleOptionLabel(role)}</span>
					</Select.Trigger>
					<Select.Content>
						{#each roleChoices as capability (capability)}
							<Select.Item value={capability} label={roleOptionLabel(capability)} />
						{/each}
					</Select.Content>
				</Select.Root>
				<p class="text-[11px] text-muted-foreground">
					{#if limited}
						* ผู้ประสานงานออกสิทธิ์ได้เฉพาะ 4 บทบาทนี้ ในศูนย์พักพิงนี้
						ถอนหรือย่นอายุได้เฉพาะสิทธิ์ที่ตนเองออก (สิทธิ์อื่นหมดอายุเอง หรือให้ผู้จัดการศูนย์ถอน)
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
									<p class="text-muted-foreground">{grantExpiryLabel(grant)}</p>
								</div>
								{#if !grant.mine}
									<span class="text-muted-foreground">ออกโดยผู้ประสานงานคนอื่น</span>
								{:else if confirmRevoke === grant.role}
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
						class="text-xs font-bold text-foreground"
					>
						วันหมดอายุของสิทธิ์ <span class="text-destructive">*</span>
					</label>
					<Input
						id={`volunteer-access-expiry-${volunteer._id}`}
						type="date"
						bind:value={expiresOn}
						min={expiryRange.min}
						max={expiryRange.max}
						required
						disabled={pending}
						class="h-11 sm:max-w-xs"
					/>
					<p class="text-[11px] text-muted-foreground">
						เลือกได้ตั้งแต่วันนี้ถึง {MAX_GRANT_DAYS} วันข้างหน้า สิทธิ์หมดอายุตอนสิ้นวันที่เลือก ต่ออายุได้ด้วยการออกสิทธิ์ซ้ำ
					</p>
				</div>

				{#if blockedReason}
					<p role="alert" class="text-sm font-medium text-destructive">{blockedReason}</p>
				{:else if unverifiedHere}
					<p class="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs text-amber-800">
						อาสาสมัครยังไม่ยืนยันตัวตนในศูนย์นี้
						ระบบจะตรวจผลยืนยันจากศูนย์อื่นที่เบอร์โทรและเลขบัตรประชาชนตรงกัน หากไม่พบ
						จะออกสิทธิ์ไม่ได้
					</p>
				{/if}
				{#if submitError}
					<p role="alert" class="text-sm font-medium text-destructive">{submitError}</p>
				{/if}
			{/if}

			<div class="space-y-3 rounded-xl border border-border p-4">
				<p class="flex items-center gap-1.5 text-xs font-bold text-foreground">
					<Lock class="h-3.5 w-3.5" />
					กำหนดบัญชีผู้ใช้งานระบบ (AUTHENTICATION &amp; CREDENTIALS)
				</p>

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

				{#if keepsPassword && !passwordError}
					<p
						class="flex items-center gap-1.5 rounded-lg border border-border p-3 text-xs text-muted-foreground"
					>
						<KeyRound class="h-3.5 w-3.5 shrink-0" />
						บัญชีนี้มีอยู่แล้ว การออกสิทธิ์ไม่เปลี่ยนรหัสผ่านเดิม
					</p>
				{:else}
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
								{phones.contact
									? 'เบอร์โทรศัพท์ของอาสาสมัครไม่ใช่มือถือ 10 หลัก จะบันทึกลงบัญชีเป็นเบอร์ติดต่อ แต่ใช้เข้าสู่ระบบหรือเป็นรหัสผ่านเริ่มต้นไม่ได้'
									: 'อาสาสมัครไม่มีเบอร์มือถือ 10 หลัก จึงใช้เบอร์เป็นรหัสผ่านเริ่มต้นไม่ได้'}
								กรุณาตั้งรหัสผ่านเองหรือกด "สร้างรหัส" (อย่างน้อย 10 ตัวอักษร พร้อมตัวพิมพ์ใหญ่ ตัวพิมพ์เล็ก
								ตัวเลข และอักขระพิเศษ) บัญชีนี้ใช้อีเมลเข้าสู่ระบบเท่านั้น และเมื่อเข้าสู่ระบบครั้งแรกจะต้องตั้งรหัสผ่านใหม่และคำถามความปลอดภัยเหมือนบัญชีอื่น
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
					บันทึกและออกสิทธิ์ใหม่
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
