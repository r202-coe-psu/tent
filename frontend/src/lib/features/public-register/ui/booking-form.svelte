<script lang="ts">
	import AlertTriangle from '@lucide/svelte/icons/alert-triangle';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Minus from '@lucide/svelte/icons/minus';
	import PawPrint from '@lucide/svelte/icons/paw-print';
	import Plus from '@lucide/svelte/icons/plus';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Users from '@lucide/svelte/icons/users';
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { env } from '$env/dynamic/public';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import * as Form from '$lib/components/ui/form/index.js';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select/index.js';
	import type { PublicShelterCardModel } from '$lib/features/public-portal';
	import { useCreateBooking } from '../application/queries';
	import { isCaptchaKeyConfigured, publicBookingInputSchema } from '../domain/booking';
	import type { BookingTicket } from '../application/booking-store.svelte';

	interface VulnerableGroup {
		code: string;
		label: string;
	}

	interface Props {
		shelters: PublicShelterCardModel[];
		vulnerableGroups: VulnerableGroup[];
		/** Preselect and lock the shelter (opened from a shelter detail page). */
		lockedShelterCode?: string;
		onbooked: (ticket: BookingTicket) => void;
	}

	const { shelters, vulnerableGroups, lockedShelterCode = '', onbooked }: Props = $props();

	const createBooking = useCreateBooking();
	const siteKey = env.PUBLIC_RECAPTCHA_SITE_KEY || '';
	const captchaEnabled = isCaptchaKeyConfigured(siteKey);

	const GENDERS = [
		{ value: 'male', label: 'ชาย' },
		{ value: 'female', label: 'หญิง' },
		{ value: 'other', label: 'อื่น ๆ' }
	] as const;

	const PET_SPECIES = [
		{ value: 'dog', label: '🐶 สุนัข' },
		{ value: 'cat', label: '🐱 แมว' },
		{ value: 'bird', label: '🐦 นก' },
		{ value: 'other', label: '🐾 อื่น ๆ' }
	] as const;

	function blankMember() {
		return {
			first_name: '',
			last_name: '',
			gender: 'male' as const,
			special_needs: [] as string[]
		};
	}

	// `dataType: 'json'` is required for the nested `members[]` / `pets[]` arrays —
	// same as the shelter wizard, which carries `zones[]` the same way.
	const form = superForm(defaults(zod4(publicBookingInputSchema)), {
		SPA: true,
		dataType: 'json',
		validators: zod4Client(publicBookingInputSchema),
		resetForm: false,
		onUpdate: async ({ form: validated }) => {
			if (!validated.valid) {
				toast.error('กรุณากรอกข้อมูลให้ครบถ้วนและถูกต้อง');
				return;
			}
			await submit(validated.data);
		}
	});
	const { form: formData, submitting, enhance } = form;

	// Seed the shapes the schema requires before the first render — done at init
	// rather than in an $effect to avoid a read-then-write loop on $formData.
	$formData.shelter_code = untrack(() => lockedShelterCode);
	$formData.members = [blankMember()];
	$formData.pets = [];

	let bringsPets = $state(false);
	let submitError = $state('');

	// `CLOSED` is the only hard block (FR-72) — a full shelter stays bookable and
	// warns instead, matching the warning-only occupancy guardrail of T-51.
	const bookable = $derived(shelters.filter((s) => s.status !== 'CLOSED'));
	const selected = $derived(shelters.find((s) => s.code === $formData.shelter_code) ?? null);

	/**
	 * Which tags this shelter accepts. The shelter declares the vulnerable groups
	 * it can support (`admission_policy.supported_vulnerable_groups`), so the
	 * choices follow the selection above rather than being a fixed list — there is
	 * no point offering "ผู้ป่วยติดเตียง" at a centre that cannot take one.
	 *
	 * FastAPI sends the literal sentinel `"none"` when a shelter has no groups to
	 * offer (see `public-shelter-card.svelte`, which filters the same sentinel) —
	 * without dropping it here it would render as a tag literally labeled "none".
	 */
	const availableTags = $derived.by(() => {
		const codes = (selected?.vulnerable_groups ?? []).filter((code) => code && code !== 'none');
		if (codes.length === 0) return [];
		const byCode = new Map(vulnerableGroups.map((g) => [g.code, g.label]));
		return codes.map((code) => byCode.get(code) ?? code).filter(Boolean);
	});

	const petsAllowed = $derived((selected?.pet_policy ?? null) !== 'no_pets');

	function setMemberCount(next: number) {
		const target = Math.max(1, Math.min(20, next));
		const current = $formData.members;
		if (target > current.length) {
			$formData.members = [
				...current,
				...Array.from({ length: target - current.length }, blankMember)
			];
		} else if (target < current.length) {
			$formData.members = current.slice(0, target);
		}
	}

	function toggleTag(idx: number, tag: string, checked: boolean) {
		const tags = $formData.members[idx].special_needs;
		$formData.members[idx].special_needs = checked ? [...tags, tag] : tags.filter((t) => t !== tag);
	}

	/** Resolve a reCAPTCHA token. `''` = not configured here, `null` = it failed. */
	async function captchaToken(): Promise<string | null> {
		// An injected token wins before we touch the network — that is the E2E hook.
		// Not a bypass: the BFF still verifies whatever token it receives.
		const injected = window.__captchaToken || '';
		if (injected) return injected;
		if (!captchaEnabled) return '';
		if (window.grecaptcha) {
			try {
				return await window.grecaptcha.execute(siteKey, { action: 'register' });
			} catch {
				return null;
			}
		}
		return null;
	}

	async function submit(data: typeof $formData) {
		submitError = '';
		try {
			const token = await captchaToken();
			if (token === null) {
				submitError = 'ระบบยืนยันตัวตน (reCAPTCHA) ขัดข้อง กรุณาลองใหม่อีกครั้ง';
				toast.error(submitError);
				return;
			}

			const ticket = await createBooking.mutateAsync({
				...data,
				pets: bringsPets ? data.pets : [],
				...(token ? { captchaToken: token } : {})
			});
			toast.success('จองเข้าศูนย์สำเร็จ');
			onbooked(ticket);
		} catch (err) {
			submitError = err instanceof Error ? err.message : 'จองไม่สำเร็จ กรุณาลองใหม่';
			toast.error(submitError);
		}
	}
</script>

<svelte:head>
	{#if captchaEnabled}
		<script src="https://www.google.com/recaptcha/api.js?render={siteKey}" async defer></script>
	{/if}
</svelte:head>

<form method="POST" use:enhance class="space-y-5">
	<!-- ── 1. ศูนย์พักพิงและผู้ติดต่อหลัก ───────────────────────────────── -->
	<section class="space-y-4 rounded-2xl border border-border bg-card p-5">
		<h3 class="flex items-center gap-2 text-base font-bold text-foreground">
			<span
				class="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
				>1</span
			>
			ศูนย์พักพิงและข้อมูลผู้ติดต่อหลัก
		</h3>

		<Form.Field {form} name="shelter_code">
			<Form.Control>
				{#snippet children({ props })}
					<div class="flex items-center justify-between gap-2">
						<Form.Label>ศูนย์พักพิงที่ต้องการเข้าพัก</Form.Label>
						{#if selected && selected.capacity > 0}
							<span
								class="rounded-full border border-success/30 bg-success-muted/40 px-2 py-0.5 text-[11px] font-bold text-success"
							>
								ความจุ {selected.capacity} ที่
							</span>
						{/if}
					</div>
					<Select.Root
						type="single"
						value={$formData.shelter_code}
						onValueChange={(v) => ($formData.shelter_code = v)}
						disabled={Boolean(lockedShelterCode)}
					>
						<Select.Trigger {...props} class="!h-11 w-full font-semibold">
							{selected?.name ?? '— เลือกศูนย์พักพิง —'}
						</Select.Trigger>
						<Select.Content>
							{#each bookable as shelter (shelter.code)}
								<Select.Item
									value={shelter.code}
									label="{shelter.name}{shelter.status === 'FULL' ? ' (เต็ม)' : ''}"
								/>
							{/each}
						</Select.Content>
					</Select.Root>
				{/snippet}
			</Form.Control>
			{#if selected}
				<Form.Description class="flex items-start gap-1">
					<MapPin class="mt-0.5 h-3 w-3 shrink-0" />
					<span>{selected.address}</span>
				</Form.Description>
			{/if}
			<Form.FieldErrors />
		</Form.Field>

		{#if selected?.status === 'FULL'}
			<p
				class="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-muted/40 p-2.5 text-xs text-danger"
			>
				<AlertTriangle class="mt-0.5 h-3.5 w-3.5 shrink-0" />
				<span>ศูนย์นี้เต็มความจุแล้ว ยังจองได้ แต่เจ้าหน้าที่อาจจัดสรรพื้นที่ใหม่เมื่อไปถึง</span>
			</p>
		{/if}

		<Form.Field {form} name="phone">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>เบอร์โทรศัพท์มือถือ</Form.Label>
					<Input
						{...props}
						bind:value={$formData.phone}
						class="!h-11"
						inputmode="numeric"
						maxlength={10}
						placeholder="08X-XXX-XXXX"
						autocomplete="tel"
					/>
				{/snippet}
			</Form.Control>
			<Form.Description>ใช้คู่กับรหัสการจองเพื่อตรวจสอบสถานะภายหลัง</Form.Description>
			<Form.FieldErrors />
		</Form.Field>

		<Form.Field {form} name="national_id">
			<Form.Control>
				{#snippet children({ props })}
					<Form.Label>เลขบัตรประจำตัวประชาชน (ถ้ามี)</Form.Label>
					<Input
						{...props}
						bind:value={$formData.national_id}
						class="!h-11"
						inputmode="numeric"
						maxlength={13}
						placeholder="X-XXXX-XXXXX-XX-X"
						autocomplete="off"
					/>
				{/snippet}
			</Form.Control>
			<Form.Description>ทางเลือก — ช่วยเจ้าหน้าที่ดึงประวัติได้เร็วขึ้น</Form.Description>
			<Form.FieldErrors />
		</Form.Field>
	</section>

	<!-- ── 2. สมาชิกครอบครัว ────────────────────────────────────────────── -->
	<section class="space-y-4 rounded-2xl border border-border bg-card p-5">
		<h3 class="flex items-center gap-2 text-base font-bold text-foreground">
			<span
				class="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
				>2</span
			>
			จำนวนสมาชิกครอบครัว และความต้องการพิเศษ
		</h3>

		<div class="flex items-center justify-between gap-4 rounded-xl bg-muted/40 p-4">
			<div class="flex items-start gap-2">
				<Users class="mt-0.5 h-4 w-4 text-muted-foreground" />
				<div>
					<p class="text-sm font-bold text-foreground">จำนวนผู้พักพิงรวม</p>
					<p class="text-xs text-muted-foreground">รวมตัวท่านเองและสมาชิกครอบครัวที่มาด้วยกัน</p>
				</div>
			</div>
			<div class="flex items-center gap-1">
				<Button
					type="button"
					variant="outline"
					size="icon-sm"
					aria-label="ลดจำนวนผู้พักพิง"
					disabled={$formData.members.length <= 1}
					onclick={() => setMemberCount($formData.members.length - 1)}
				>
					<Minus class="h-4 w-4" />
				</Button>
				<div class="w-12 text-center">
					<span class="block text-lg font-bold text-foreground">{$formData.members.length}</span>
					<span class="block text-[10px] text-muted-foreground">คน</span>
				</div>
				<Button
					type="button"
					variant="outline"
					size="icon-sm"
					aria-label="เพิ่มจำนวนผู้พักพิง"
					disabled={$formData.members.length >= 20}
					onclick={() => setMemberCount($formData.members.length + 1)}
				>
					<Plus class="h-4 w-4" />
				</Button>
			</div>
		</div>

		{#each $formData.members as member, idx (idx)}
			{@const who = idx === 0 ? 'ผู้ติดต่อหลัก (ท่านเอง)' : `สมาชิกคนที่ ${idx + 1}`}
			<div class="space-y-3 rounded-xl border border-border p-4">
				<p class="flex items-center gap-2 text-sm font-bold text-foreground">
					<span
						class="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground"
						>{idx + 1}</span
					>
					{who}
				</p>

				<div class="grid gap-3 sm:grid-cols-3">
					<Form.Field {form} name={`members[${idx}].first_name`} class="space-y-1.5">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>ชื่อ</Form.Label>
								<Input
									{...props}
									bind:value={member.first_name}
									class="!h-11"
									placeholder="เช่น สมศักดิ์"
									autocomplete="off"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<Form.Field {form} name={`members[${idx}].last_name`} class="space-y-1.5">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>นามสกุล</Form.Label>
								<Input
									{...props}
									bind:value={member.last_name}
									class="!h-11"
									placeholder="เช่น มีสุข"
									autocomplete="off"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>

					<Form.Field {form} name={`members[${idx}].gender`} class="space-y-1.5">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label>เพศ</Form.Label>
								<Select.Root
									type="single"
									value={member.gender}
									onValueChange={(v) => ($formData.members[idx].gender = v as typeof member.gender)}
								>
									<Select.Trigger {...props} class="!h-11 w-full" aria-label="เพศ — {who}">
										{GENDERS.find((g) => g.value === member.gender)?.label ?? '— เลือกเพศ —'}
									</Select.Trigger>
									<Select.Content>
										{#each GENDERS as option (option.value)}
											<Select.Item value={option.value} label={option.label} />
										{/each}
									</Select.Content>
								</Select.Root>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>

				{#if availableTags.length > 0}
					<!-- A group of checkboxes is a fieldset, not a single control: `Form.Label`
					     only works inside `Form.Control`, and using it here throws in formsnap. -->
					<Form.Fieldset {form} name={`members[${idx}].special_needs`} class="space-y-1.5">
						<Form.Legend>ความต้องการพิเศษเฉพาะบุคคล</Form.Legend>
						<div class="grid gap-2 sm:grid-cols-3">
							{#each availableTags as tag (tag)}
								{@const id = `m${idx}-${tag}`}
								<label
									for={id}
									class="flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm transition-colors hover:bg-muted/40"
								>
									<Checkbox
										{id}
										aria-label="{tag} — {who}"
										checked={member.special_needs.includes(tag)}
										onCheckedChange={(v) => toggleTag(idx, tag, v === true)}
									/>
									<span class="text-foreground">{tag}</span>
								</label>
							{/each}
						</div>
						<Form.FieldErrors />
					</Form.Fieldset>
				{/if}
			</div>
		{/each}
	</section>

	<!-- ── 3. สัตว์เลี้ยง ──────────────────────────────────────────────── -->
	{#if petsAllowed}
		<section class="space-y-4 rounded-2xl border border-border bg-card p-5">
			<h3 class="flex items-center gap-2 text-base font-bold text-foreground">
				<span
					class="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground"
					>3</span
				>
				สัตว์เลี้ยงที่นำมาด้วย
			</h3>

			<label
				for="brings-pets"
				class="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground"
			>
				<Checkbox
					id="brings-pets"
					checked={bringsPets}
					onCheckedChange={(v) => {
						bringsPets = v === true;
						if (bringsPets && $formData.pets.length === 0) {
							$formData.pets = [{ species: 'dog', notes: '', has_cage: false }];
						}
					}}
				/>
				<PawPrint class="h-4 w-4 text-muted-foreground" />
				นำสัตว์เลี้ยงมาด้วย
			</label>

			{#if bringsPets}
				{#each $formData.pets as pet, idx (idx)}
					<div class="space-y-3 rounded-xl border border-warning/40 bg-warning-muted/20 p-4">
						<div class="flex items-center justify-between">
							<p class="text-sm font-bold text-foreground">สัตว์เลี้ยงตัวที่ {idx + 1}</p>
							<Button
								type="button"
								variant="outline"
								size="xs"
								onclick={() => ($formData.pets = $formData.pets.filter((_, i) => i !== idx))}
							>
								<Trash2 class="h-3.5 w-3.5" />
								ลบ
							</Button>
						</div>

						<div class="grid gap-3 sm:grid-cols-2">
							<Form.Field {form} name={`pets[${idx}].species`} class="space-y-1.5">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>ชนิดสัตว์เลี้ยง</Form.Label>
										<Select.Root
											type="single"
											value={pet.species}
											onValueChange={(v) => ($formData.pets[idx].species = v as typeof pet.species)}
										>
											<Select.Trigger
												{...props}
												class="!h-11 w-full"
												aria-label="ชนิดสัตว์เลี้ยงตัวที่ {idx + 1}"
											>
												{PET_SPECIES.find((s) => s.value === pet.species)?.label ?? '— เลือก —'}
											</Select.Trigger>
											<Select.Content>
												{#each PET_SPECIES as option (option.value)}
													<Select.Item value={option.value} label={option.label} />
												{/each}
											</Select.Content>
										</Select.Root>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>

							<Form.Field {form} name={`pets[${idx}].notes`} class="space-y-1.5">
								<Form.Control>
									{#snippet children({ props })}
										<Form.Label>ชื่อ / พันธุ์ / รายละเอียด</Form.Label>
										<Input
											{...props}
											bind:value={pet.notes}
											class="!h-11"
											placeholder="เช่น โกโก้ / ชิวาว่า 1 ตัว"
										/>
									{/snippet}
								</Form.Control>
								<Form.FieldErrors />
							</Form.Field>
						</div>

						<label
							for="pet-cage-{idx}"
							class="flex cursor-pointer items-center gap-2 text-sm text-foreground"
						>
							<Checkbox
								id="pet-cage-{idx}"
								checked={pet.has_cage}
								onCheckedChange={(v) => (pet.has_cage = v === true)}
							/>
							นำกรง/สายจูง/ตะกร้าติดตัวมาด้วย
						</label>
					</div>
				{/each}

				<Button
					type="button"
					variant="outline"
					class="w-full"
					disabled={$formData.pets.length >= 20}
					onclick={() =>
						($formData.pets = [...$formData.pets, { species: 'dog', notes: '', has_cage: false }])}
				>
					<Plus class="h-4 w-4" />
					เพิ่มสัตว์เลี้ยงตัวถัดไป
				</Button>
			{/if}
		</section>
	{/if}

	{#if submitError}
		<p
			class="rounded-xl border border-danger/30 bg-danger-muted/40 p-3 text-sm text-danger"
			role="alert"
		>
			{submitError}
		</p>
	{/if}

	<Form.Button class="w-full" size="lg" disabled={$submitting}>
		{$submitting ? 'กำลังจอง…' : 'ยืนยันการจองเข้าศูนย์'}
	</Form.Button>
</form>
