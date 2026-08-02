<script lang="ts">
	import { untrack } from 'svelte';
	import { toast } from 'svelte-sonner';
	import X from '@lucide/svelte/icons/x';
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { evacueeEmergencyEditFormSchema, type Evacuee } from '$lib/features/people';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';

	export type EvacueeEmergencyEditData = {
		emergencyContact:
			| {
					name: string;
					phone: string;
					relation: string;
			  }
			| undefined;
	};

	let {
		show,
		evacuee,
		onClose,
		onSave
	}: {
		show: boolean;
		evacuee: Evacuee;
		onClose: () => void;
		onSave: (data: EvacueeEmergencyEditData) => Promise<void>;
	} = $props();

	const initial = untrack(() => ({
		name: evacuee.emergency_contact?.name ?? '',
		phone: evacuee.emergency_contact?.phone ?? '',
		relation: evacuee.emergency_contact?.relation ?? ''
	}));

	let name = $state(initial.name);
	let phone = $state(initial.phone);
	let relation = $state(initial.relation);
	let saving = $state(false);
	let lastOpenedEvacueeId = $state<string | null>(null);
	const hasContact = $derived(Boolean(name.trim() || phone.trim() || relation.trim()));
	const form = superForm(defaults(initial, zod4(evacueeEmergencyEditFormSchema)), {
		SPA: true,
		validators: zod4(evacueeEmergencyEditFormSchema),
		resetForm: false
	});
	const { form: formData, validateForm } = form;

	$effect(() => {
		if (!show) {
			lastOpenedEvacueeId = null;
			return;
		}
		if (lastOpenedEvacueeId === evacuee._id) return;

		name = evacuee.emergency_contact?.name ?? '';
		phone = evacuee.emergency_contact?.phone ?? '';
		relation = evacuee.emergency_contact?.relation ?? '';
		$formData = { name, phone, relation };
		lastOpenedEvacueeId = evacuee._id;
	});

	function digits(value: string): string {
		return value.replace(/\D/g, '');
	}

	async function save() {
		$formData = { name, phone, relation };
		const validation = await validateForm({ update: true, focusOnError: true });
		if (!validation.valid) {
			toast.error('กรุณากรอกข้อมูลผู้ติดต่อให้ถูกต้องและครบถ้วน');
			return;
		}
		const contactProvided = Boolean(
			validation.data.name || validation.data.phone || validation.data.relation
		);
		if (contactProvided && (!name.trim() || digits(phone).length !== 10 || !relation.trim())) {
			toast.error('กรุณากรอกชื่อ เบอร์โทร 10 หลัก และความสัมพันธ์ให้ครบ');
			return;
		}

		saving = true;
		try {
			await onSave({
				emergencyContact: contactProvided
					? {
							name: validation.data.name,
							phone: digits(validation.data.phone),
							relation: validation.data.relation
						}
					: undefined
			});
		} finally {
			saving = false;
		}
	}
</script>

{#if show}
	<div
		class="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4 backdrop-blur-xs"
	>
		<div
			role="dialog"
			aria-modal="true"
			aria-labelledby="emergency-modal-title"
			class="w-full max-w-lg overflow-hidden rounded-lg border border-border bg-card shadow-2xl"
		>
			<header class="flex items-start justify-between border-b border-border px-5 py-4">
				<h3 id="emergency-modal-title" class="text-base font-bold text-foreground">
					แก้ไขผู้ติดต่อฉุกเฉิน
				</h3>
				<button
					type="button"
					aria-label="ปิด"
					title="ปิด"
					onclick={onClose}
					class="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<X class="size-4" />
				</button>
			</header>

			<div class="space-y-4 p-5">
				<Form.Field {form} name="name">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label
								>ชื่อผู้ติดต่อ {#if hasContact}<span class="text-destructive">*</span
									>{/if}</Form.Label
							>
							<Input {...props} bind:value={name} autocomplete="name" />
						{/snippet}
					</Form.Control>
					<Form.FieldErrors />
				</Form.Field>
				<div class="grid gap-3 sm:grid-cols-2">
					<Form.Field {form} name="phone">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label
									>เบอร์โทรศัพท์ {#if hasContact}<span class="text-destructive">*</span
										>{/if}</Form.Label
								>
								<Input
									{...props}
									bind:value={phone}
									inputmode="numeric"
									maxlength={10}
									autocomplete="tel"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
					<Form.Field {form} name="relation">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label
									>ความสัมพันธ์ {#if hasContact}<span class="text-destructive">*</span
										>{/if}</Form.Label
								>
								<Input {...props} bind:value={relation} placeholder="เช่น บิดา มารดา คู่สมรส" />
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>
			</div>

			<footer class="flex justify-end gap-2 border-t border-border px-5 py-4">
				<Button type="button" variant="outline" onclick={onClose}>ยกเลิก</Button>
				<Button type="button" disabled={saving} onclick={save}>
					{saving ? 'กำลังบันทึก...' : 'บันทึกผู้ติดต่อ'}
				</Button>
			</footer>
		</div>
	</div>
{/if}
