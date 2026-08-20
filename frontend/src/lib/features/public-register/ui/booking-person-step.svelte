<script lang="ts">
	import ArrowLeft from '@lucide/svelte/icons/arrow-left';
	import * as Field from '$lib/components/ui/field/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4, zod4Client } from 'sveltekit-superforms/adapters';
	import { toast } from 'svelte-sonner';
	import { env } from '$env/dynamic/public';
	import { getBookingStore } from '../application/booking-store.svelte';
	import { useCreateBooking } from '../application/queries';
	import { publicBookingInputSchema } from '../domain/booking';

	const booking = getBookingStore();
	const createBooking = useCreateBooking();
	const siteKey = env.PUBLIC_RECAPTCHA_SITE_KEY || '';

	const genderOptions = [
		{ value: 'male', label: 'ชาย' },
		{ value: 'female', label: 'หญิง' },
		{ value: 'other', label: 'อื่น ๆ' }
	] as const;

	// The wizard owns `shelter_code` and the captcha token; this form only collects
	// the T-48 minimum, so it validates against the same schema minus those two.
	const personSchema = publicBookingInputSchema.omit({ shelter_code: true, captchaToken: true });

	const form = superForm(defaults(zod4(personSchema)), {
		SPA: true,
		validators: zod4Client(personSchema),
		resetForm: false,
		onUpdate: async ({ form: f }) => {
			if (!f.valid) return;
			await submit(f.data);
		}
	});
	const { form: formData, submitting } = form;

	const genderLabel = $derived(
		genderOptions.find((o) => o.value === $formData.gender)?.label ?? 'เลือกเพศ'
	);

	/** Resolve a reCAPTCHA token, or `null` so the caller can surface why it failed. */
	async function captchaToken(): Promise<string | null> {
		// An injected token wins before we touch the network — that is the E2E hook,
		// and honouring it first keeps tests off Google. Not a bypass: the BFF still
		// verifies whatever token it receives, so a fake one is rejected server-side.
		const injected = window.__captchaToken || '';
		if (injected) return injected;

		// Otherwise require real reCAPTCHA — no silent skip, not even in dev.
		if (siteKey && window.grecaptcha) {
			try {
				return await window.grecaptcha.execute(siteKey, { action: 'register' });
			} catch {
				return null;
			}
		}
		return null;
	}

	async function submit(data: {
		first_name: string;
		last_name: string;
		gender: string;
		phone: string;
	}) {
		booking.errorMessage = '';
		booking.isSubmitting = true;
		try {
			const token = await captchaToken();
			if (!token) {
				booking.errorMessage = siteKey
					? 'ระบบยืนยันตัวตน (reCAPTCHA) ขัดข้อง กรุณาลองใหม่อีกครั้ง'
					: 'ยังไม่ได้ตั้งค่า reCAPTCHA (PUBLIC_RECAPTCHA_SITE_KEY) — ไม่สามารถส่งแบบฟอร์มได้';
				toast.error(booking.errorMessage);
				return;
			}

			const ticket = await createBooking.mutateAsync({
				shelter_code: booking.shelterCode,
				first_name: data.first_name,
				last_name: data.last_name,
				gender: data.gender as 'male' | 'female' | 'other',
				phone: data.phone,
				captchaToken: token
			});

			booking.ticket = ticket;
			booking.shelterName = ticket.shelter_name;
			booking.goTo('ticket', 3);
			toast.success('จองเข้าศูนย์สำเร็จ');
		} catch (err) {
			booking.errorMessage = err instanceof Error ? err.message : 'จองไม่สำเร็จ กรุณาลองใหม่';
			toast.error(booking.errorMessage);
		} finally {
			booking.isSubmitting = false;
		}
	}
</script>

<div class="space-y-4 rounded-2xl border border-black/[0.04] bg-card p-5 shadow-sm sm:p-6">
	<div>
		<h2 class="text-lg font-bold text-foreground">ข้อมูลผู้จอง</h2>
		<p class="mt-1 text-sm text-muted-foreground">
			กรอกเฉพาะข้อมูลที่จำเป็นสำหรับกันที่ ข้อมูลส่วนที่เหลือเจ้าหน้าที่จะเก็บที่ประตูศูนย์
		</p>
		{#if booking.shelterName}
			<p class="mt-2 rounded-lg bg-primary-muted px-3 py-2 text-xs font-semibold text-primary">
				ศูนย์ที่เลือก: {booking.shelterName}
			</p>
		{/if}
	</div>

	<form method="POST" use:form.enhance class="space-y-4">
		<Field.FieldGroup>
			<div class="grid gap-4 sm:grid-cols-2">
				<Form.Field {form} name="first_name">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>ชื่อ</Form.Label>
							<Input {...props} bind:value={$formData.first_name} autocomplete="given-name" />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="last_name">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>นามสกุล</Form.Label>
							<Input {...props} bind:value={$formData.last_name} autocomplete="family-name" />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="gender">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>เพศ</Form.Label>
							<Select.Root type="single" bind:value={$formData.gender}>
								<Select.Trigger {...props}>{genderLabel}</Select.Trigger>
								<Select.Content>
									{#each genderOptions as option (option.value)}
										<Select.Item value={option.value} label={option.label} />
									{/each}
								</Select.Content>
							</Select.Root>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>

				<Form.Field {form} name="phone">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label>เบอร์โทรศัพท์</Form.Label>
							<Input
								{...props}
								bind:value={$formData.phone}
								inputmode="numeric"
								maxlength={10}
								placeholder="0812345678"
								autocomplete="tel"
							/>
						{/snippet}
					</Form.Control>
					<Form.Description>
						ใช้คู่กับรหัสการจองเพื่อตรวจสอบสถานะภายหลัง จึงต้องกรอกเบอร์ที่ติดต่อได้จริง
					</Form.Description>
					<Form.FieldErrors />
				</Form.Field>
			</div>
		</Field.FieldGroup>

		{#if booking.errorMessage}
			<p
				class="rounded-xl border border-danger/30 bg-danger-muted/40 p-3 text-sm text-danger"
				role="alert"
			>
				{booking.errorMessage}
			</p>
		{/if}

		<div class="flex items-center justify-between gap-3 pt-1">
			<Button
				type="button"
				variant="ghost"
				disabled={booking.shelterLocked || booking.isSubmitting}
				onclick={() => booking.goTo('shelter', 1)}
			>
				<ArrowLeft class="h-4 w-4" />
				ย้อนกลับ
			</Button>
			<Form.Button disabled={$submitting || booking.isSubmitting}>
				{booking.isSubmitting ? 'กำลังจอง…' : 'ยืนยันการจอง'}
			</Form.Button>
		</div>
	</form>
</div>
