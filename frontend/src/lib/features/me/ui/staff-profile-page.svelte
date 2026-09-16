<script lang="ts">
	import { onMount } from 'svelte';
	import { page } from '$app/state';
	import { toast } from 'svelte-sonner';
	import { authStore } from '$lib/stores/auth.svelte';
	import { formatRoleList, COUCH_ADMIN } from '$lib/auth/roles';
	import {
		fetchAuthStatus,
		updateOwnProfile,
		googleOAuthStartHref,
		unlinkGoogleMfa,
		type AuthStatus
	} from '$lib/features/users';
	import { ownProfileSchema, type OwnProfileInput } from '../domain/profile-schema';
	import * as Card from '$lib/components/ui/card/index.js';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Badge } from '$lib/components/ui/badge/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import ShieldCheck from '@lucide/svelte/icons/shield-check';
	import Link2 from '@lucide/svelte/icons/link-2';
	import Unlink from '@lucide/svelte/icons/unlink';
	import Pencil from '@lucide/svelte/icons/pencil';

	let profile = $state<AuthStatus | null>(null);
	let loading = $state(true);
	let loadError = $state<string | null>(null);

	let editing = $state(false);
	let saving = $state(false);
	let fieldErrors = $state<Partial<Record<keyof OwnProfileInput, string>>>({});

	let form = $state({
		display_name: '',
		phone: '',
		email: '',
		organization: '',
		position: ''
	});

	let unlinkOpen = $state(false);
	let unlinking = $state(false);

	const displayTitle = $derived(profile?.display_name?.trim() || profile?.name?.trim() || '—');
	const initials = $derived(computeInitials(displayTitle, profile?.name));
	const roleBadges = $derived(roleLines(profile?.roles));
	const personnelLabel = $derived(personnelTypeLabel(profile?.personnel_type));
	const isImmutable = $derived(Boolean(profile?.roles?.includes(COUCH_ADMIN)));

	function computeInitials(title: string, username?: string | null): string {
		const source = title !== '—' ? title : (username ?? '');
		const parts = source.trim().split(/\s+/).filter(Boolean);
		if (parts.length === 0) return '?';
		if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
		return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
	}

	function roleLines(roles: string[] | undefined): string[] {
		const formatted = formatRoleList(roles);
		return formatted
			.split(/\n|,/)
			.map((s) => s.trim())
			.filter(Boolean);
	}

	function personnelTypeLabel(type: AuthStatus['personnel_type']): string {
		if (type === 'staff') return 'พนักงาน';
		if (type === 'volunteer') return 'อาสาสมัคร';
		return '—';
	}

	function displayOrDash(value: string | null | undefined): string {
		const trimmed = value?.trim();
		return trimmed ? trimmed : '—';
	}

	function syncFormFromProfile(data: AuthStatus) {
		form = {
			display_name: data.display_name?.trim() || '',
			phone: data.phone?.trim() || '',
			email: data.email?.trim() || '',
			organization: data.organization?.trim() || '',
			position: data.position?.trim() || ''
		};
		fieldErrors = {};
	}

	async function refreshProfile() {
		loading = true;
		loadError = null;
		try {
			profile = await fetchAuthStatus();
			if (!editing) syncFormFromProfile(profile);
		} catch (err) {
			profile = null;
			loadError = err instanceof Error ? err.message : 'โหลดข้อมูลโปรไฟล์ไม่สำเร็จ';
		} finally {
			loading = false;
		}
	}

	function startEdit() {
		if (!profile) return;
		syncFormFromProfile(profile);
		editing = true;
	}

	function cancelEdit() {
		if (profile) syncFormFromProfile(profile);
		editing = false;
		fieldErrors = {};
	}

	async function handleSave() {
		const parsed = ownProfileSchema.safeParse(form);
		if (!parsed.success) {
			const next: Partial<Record<keyof OwnProfileInput, string>> = {};
			for (const issue of parsed.error.issues) {
				const key = issue.path[0];
				if (typeof key === 'string' && !(key in next)) {
					next[key as keyof OwnProfileInput] = issue.message;
				}
			}
			fieldErrors = next;
			toast.error('กรุณาตรวจสอบข้อมูลที่กรอก');
			return;
		}

		fieldErrors = {};
		saving = true;
		try {
			const result = await updateOwnProfile({
				display_name: parsed.data.display_name,
				phone: parsed.data.phone || null,
				email: parsed.data.email || null,
				organization: parsed.data.organization || null,
				position: parsed.data.position || null
			});
			authStore.setDisplayName(result.display_name);
			toast.success('บันทึกโปรไฟล์สำเร็จ');
			editing = false;
			await refreshProfile();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'บันทึกโปรไฟล์ไม่สำเร็จ');
		} finally {
			saving = false;
		}
	}

	async function handleUnlink() {
		unlinking = true;
		try {
			await unlinkGoogleMfa();
			toast.success('ถอดการผูก Google MFA แล้ว');
			unlinkOpen = false;
			await refreshProfile();
		} catch (err) {
			toast.error(err instanceof Error ? err.message : 'ถอดการผูกไม่สำเร็จ');
		} finally {
			unlinking = false;
		}
	}

	onMount(async () => {
		if (page.url.searchParams.get('mfa') === 'linked') {
			toast.success('ผูกบัญชี Google สำหรับ MFA สำเร็จ');
		} else if (page.url.searchParams.get('mfa') === 'conflict') {
			toast.error('บัญชี Google นี้ถูกผูกกับผู้ใช้อื่นแล้ว');
		}
		await refreshProfile();
	});
</script>

<div class="min-h-full bg-[#F8FAFC] px-4 py-6 sm:px-6">
	<div class="mx-auto flex max-w-4xl flex-col gap-6">
		{#if loading && !profile}
			<p class="text-base text-slate-500">กำลังโหลดโปรไฟล์...</p>
		{:else if loadError && !profile}
			<div
				class="rounded-xl border border-red-200 bg-white p-4 text-base text-red-900 shadow-2xs"
				role="alert"
			>
				<p class="font-semibold">โหลดข้อมูลไม่สำเร็จ</p>
				<p class="mt-1 text-sm text-red-800">{loadError}</p>
				<Button class="mt-4 min-h-11" variant="outline" onclick={refreshProfile}>
					ลองอีกครั้ง
				</Button>
			</div>
		{:else if profile}
			<!-- Hero / identity -->
			<section class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs sm:p-6">
				<div class="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
					<div class="flex items-start gap-4">
						<div
							class="flex size-16 shrink-0 items-center justify-center rounded-full bg-[#0A2647] text-lg font-bold text-white"
							aria-hidden="true"
						>
							{initials}
						</div>
						<div class="min-w-0 space-y-2">
							<h1 class="text-2xl font-bold text-[#0A2647]">{displayTitle}</h1>
							<p class="text-base text-slate-500">{profile.name}</p>
							<div class="flex flex-wrap items-center gap-2">
								{#each roleBadges as badge (badge)}
									<Badge
										variant="outline"
										class="border-slate-200/80 bg-slate-50 text-xs font-semibold text-slate-800"
									>
										{badge}
									</Badge>
								{/each}
								<span
									class="inline-flex items-center rounded-full border border-slate-200/80 bg-white px-2.5 py-0.5 text-xs font-semibold text-slate-600"
								>
									{personnelLabel}
								</span>
							</div>
						</div>
					</div>
					{#if !editing && !isImmutable}
						<Button
							class="min-h-11 w-full gap-2 bg-[#0A2647] text-white hover:bg-[#051930] sm:w-auto"
							onclick={startEdit}
						>
							<Pencil class="size-4" />
							แก้ไขข้อมูล
						</Button>
					{/if}
				</div>
			</section>

			<!-- Contact & affiliation -->
			<section class="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-2xs sm:p-6">
				<h2 class="mb-4 text-lg font-bold text-slate-900 sm:text-xl">ข้อมูลติดต่อและสังกัด</h2>

				{#if editing}
					<form
						class="space-y-4"
						onsubmit={(e) => {
							e.preventDefault();
							void handleSave();
						}}
					>
						<div class="grid gap-4 sm:grid-cols-2">
							<div class="space-y-2 sm:col-span-2">
								<Label for="profile-display-name" class="text-sm font-semibold text-slate-700">
									ชื่อที่แสดง
								</Label>
								<Input
									id="profile-display-name"
									class="min-h-11"
									bind:value={form.display_name}
									disabled={saving}
									autocomplete="name"
									aria-invalid={fieldErrors.display_name ? 'true' : undefined}
								/>
								{#if fieldErrors.display_name}
									<p class="text-sm text-red-600">{fieldErrors.display_name}</p>
								{/if}
							</div>
							<div class="space-y-2">
								<Label for="profile-phone" class="text-sm font-semibold text-slate-700">
									เบอร์โทรศัพท์
								</Label>
								<Input
									id="profile-phone"
									class="min-h-11"
									bind:value={form.phone}
									disabled={saving}
									inputmode="tel"
									autocomplete="tel"
									placeholder="0XXXXXXXXX"
									aria-invalid={fieldErrors.phone ? 'true' : undefined}
								/>
								{#if fieldErrors.phone}
									<p class="text-sm text-red-600">{fieldErrors.phone}</p>
								{/if}
							</div>
							<div class="space-y-2">
								<Label for="profile-email" class="text-sm font-semibold text-slate-700">
									อีเมล
								</Label>
								<Input
									id="profile-email"
									type="email"
									class="min-h-11"
									bind:value={form.email}
									disabled={saving}
									autocomplete="email"
									aria-invalid={fieldErrors.email ? 'true' : undefined}
								/>
								{#if fieldErrors.email}
									<p class="text-sm text-red-600">{fieldErrors.email}</p>
								{/if}
							</div>
							<div class="space-y-2">
								<Label for="profile-organization" class="text-sm font-semibold text-slate-700">
									หน่วยงาน / องค์กร
								</Label>
								<Input
									id="profile-organization"
									class="min-h-11"
									bind:value={form.organization}
									disabled={saving}
									autocomplete="organization"
									aria-invalid={fieldErrors.organization ? 'true' : undefined}
								/>
								{#if fieldErrors.organization}
									<p class="text-sm text-red-600">{fieldErrors.organization}</p>
								{/if}
							</div>
							<div class="space-y-2">
								<Label for="profile-position" class="text-sm font-semibold text-slate-700">
									ตำแหน่ง
								</Label>
								<Input
									id="profile-position"
									class="min-h-11"
									bind:value={form.position}
									disabled={saving}
									autocomplete="organization-title"
									aria-invalid={fieldErrors.position ? 'true' : undefined}
								/>
								{#if fieldErrors.position}
									<p class="text-sm text-red-600">{fieldErrors.position}</p>
								{/if}
							</div>
						</div>
						<div class="flex flex-col gap-3 pt-2 sm:flex-row sm:justify-end">
							<Button
								type="button"
								variant="outline"
								class="min-h-11 w-full sm:w-auto"
								disabled={saving}
								onclick={cancelEdit}
							>
								ยกเลิก
							</Button>
							<Button
								type="submit"
								class="min-h-11 w-full bg-[#0A2647] text-white hover:bg-[#051930] sm:w-auto"
								disabled={saving}
							>
								{saving ? 'กำลังบันทึก...' : 'บันทึก'}
							</Button>
						</div>
					</form>
				{:else}
					<dl class="grid gap-4 sm:grid-cols-2">
						<div class="space-y-1">
							<dt class="text-sm font-semibold text-slate-700">เบอร์โทรศัพท์</dt>
							<dd class="text-base text-slate-900">{displayOrDash(profile.phone)}</dd>
						</div>
						<div class="space-y-1">
							<dt class="text-sm font-semibold text-slate-700">อีเมล</dt>
							<dd class="text-base text-slate-900">{displayOrDash(profile.email)}</dd>
						</div>
						<div class="space-y-1">
							<dt class="text-sm font-semibold text-slate-700">หน่วยงาน / องค์กร</dt>
							<dd class="text-base text-slate-900">{displayOrDash(profile.organization)}</dd>
						</div>
						<div class="space-y-1">
							<dt class="text-sm font-semibold text-slate-700">ตำแหน่ง</dt>
							<dd class="text-base text-slate-900">{displayOrDash(profile.position)}</dd>
						</div>
					</dl>
				{/if}
			</section>

			<!-- Security / Google MFA -->
			<section>
				<Card.Root
					class={profile.mfa_enrolled
						? 'rounded-2xl border border-emerald-200 bg-white shadow-2xs'
						: 'rounded-2xl border border-slate-200/80 bg-white shadow-2xs'}
				>
					<Card.Header>
						<Card.Title class="flex items-center gap-2 text-lg font-bold text-slate-900">
							<ShieldCheck
								class={profile.mfa_enrolled ? 'size-5 text-emerald-700' : 'size-5 text-[#0A2647]'}
							/>
							ความปลอดภัย — Google MFA
						</Card.Title>
						<Card.Description class="text-base text-slate-600">
							ผูกบัญชี Google เพื่อยืนยันตัวตนหลังเข้าสู่ระบบด้วยรหัสผ่าน (เลือกได้ — Phase 1)
						</Card.Description>
					</Card.Header>
					<Card.Content class="space-y-4">
						{#if profile.mfa_enrolled}
							<div
								class="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-base text-emerald-900"
							>
								ผูกแล้ว
								{#if profile.mfa_provider_email}
									— <span class="font-medium">{profile.mfa_provider_email}</span>
								{/if}
							</div>
							<Dialog.Root bind:open={unlinkOpen}>
								<Dialog.Trigger>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="outline"
											class="min-h-11 w-full gap-2 text-red-700 sm:w-auto"
										>
											<Unlink class="size-4" />
											ถอดการผูก Google
										</Button>
									{/snippet}
								</Dialog.Trigger>
								<Dialog.Content class="sm:max-w-md">
									<Dialog.Header>
										<Dialog.Title>ถอดการผูก Google MFA?</Dialog.Title>
										<Dialog.Description>
											หลังถอดแล้ว จะไม่ต้องยืนยัน Google ตอนเข้าสู่ระบบ จนกว่าจะผูกใหม่
										</Dialog.Description>
									</Dialog.Header>
									<div class="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
										<Button variant="outline" class="min-h-11" onclick={() => (unlinkOpen = false)}>
											ยกเลิก
										</Button>
										<Button
											variant="destructive"
											class="min-h-11"
											disabled={unlinking}
											onclick={handleUnlink}
										>
											{unlinking ? 'กำลังถอด...' : 'ยืนยันถอดการผูก'}
										</Button>
									</div>
								</Dialog.Content>
							</Dialog.Root>
						{:else if isImmutable}
							<p class="text-base text-slate-500">
								บัญชีผู้ดูแลระบบเซิร์ฟเวอร์ (CouchDB Admin)
								ได้รับการจัดการผ่านไฟล์การตั้งค่าเซิร์ฟเวอร์ และไม่รองรับ Google MFA
							</p>
						{:else}
							<p class="text-base text-slate-500">ยังไม่ได้ผูกบัญชี Google</p>
							<Button
								href={googleOAuthStartHref('link')}
								class="min-h-11 w-full gap-2 bg-[#0A2647] text-white hover:bg-[#051930] sm:w-auto"
							>
								<Link2 class="size-4" />
								ผูกบัญชี Google
							</Button>
						{/if}
					</Card.Content>
				</Card.Root>
			</section>

			<!-- Read-only note -->
			<p class="text-sm text-slate-500">
				ไม่สามารถแก้ไขชื่อผู้ใช้หรือบทบาทได้ที่นี่ — ติดต่อผู้ดูแลระบบหากต้องการเปลี่ยนแปลง
			</p>
		{/if}
	</div>
</div>
