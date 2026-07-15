<script lang="ts">
	import X from '@lucide/svelte/icons/x';
	import Megaphone from '@lucide/svelte/icons/megaphone';
	import { Input } from '$lib/components/ui/input/index.js';
	import * as Form from '$lib/components/ui/form/index.js';
	import { defaults, superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { specialRequestSchema, type SpecialRequestInput } from '$lib/features/operations';

	let {
		open = false,
		onclose,
		onsubmit
	}: {
		open: boolean;
		onclose: () => void;
		onsubmit: (input: SpecialRequestInput) => void;
	} = $props();

	const form = superForm(
		defaults(
			{
				name: '',
				target: '1000',
				location: 'คลังช่วยเหลือภัยพิบัติ EOC'
			},
			zod4(specialRequestSchema)
		),
		{
			SPA: true,
			validators: zod4(specialRequestSchema),
			resetForm: true,
			onUpdate: ({ form: f }) => {
				if (!f.valid) return;
				onsubmit(f.data);
				onclose();
				reset();
			}
		}
	);

	const { form: formData, submitting, enhance, reset } = form;
</script>

{#if open}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div
		class="fixed inset-0 z-50 flex animate-in items-center justify-center bg-black/40 p-4 backdrop-blur-xs duration-200 fade-in"
		onclick={onclose}
	>
		<div
			class="relative w-full max-w-md animate-in rounded-3xl border border-border bg-card p-6 text-foreground shadow-2xl duration-200 zoom-in-95"
			onclick={(e) => e.stopPropagation()}
		>
			<div class="mb-5 flex items-center justify-between border-b border-border/60 pb-4">
				<h3 class="flex items-center gap-2 text-sm font-bold text-foreground">
					<Megaphone class="h-4 w-4 text-primary" />
					สร้างประกาศความต้องการใหม่
				</h3>
				<button
					type="button"
					onclick={onclose}
					class="cursor-pointer rounded-lg p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
				>
					<X class="h-4 w-4" />
				</button>
			</div>

			<form use:enhance class="space-y-4">
				<Form.Field {form} name="name">
					<Form.Control>
						{#snippet children({ props })}
							<Form.Label
								class="mb-1.5 block text-[11px] font-bold text-muted-foreground uppercase"
							>
								รายการพัสดุ / ประกาศพิเศษ
							</Form.Label>
							<Input
								{...props}
								type="text"
								placeholder="เช่น ยาสามัญประจำบ้าน, แพมเพิสเด็กแรกเกิด"
								bind:value={$formData.name}
								class="w-full rounded-xl border border-border bg-muted/20 px-3.5 py-2.5 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
							/>
						{/snippet}
					</Form.Control>
					<Form.FieldErrors class="mt-1 text-xs text-destructive" />
				</Form.Field>

				<div class="grid grid-cols-2 gap-4">
					<Form.Field {form} name="target">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label
									class="mb-1.5 block text-[11px] font-bold text-muted-foreground uppercase"
								>
									เป้าหมายจำนวนที่ต้องการ
								</Form.Label>
								<Input
									{...props}
									type="text"
									inputmode="decimal"
									bind:value={$formData.target}
									class="w-full rounded-xl border border-border bg-muted/20 px-3.5 py-2.5 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors class="mt-1 text-xs text-destructive" />
					</Form.Field>

					<Form.Field {form} name="location">
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label
									class="mb-1.5 block text-[11px] font-bold text-muted-foreground uppercase"
								>
									คลังเป้าหมาย
								</Form.Label>
								<select
									{...props}
									bind:value={$formData.location}
									class="h-9 w-full rounded-xl border border-border bg-muted/20 px-3 py-1.5 text-xs text-foreground outline-hidden focus:border-primary focus:ring-1 focus:ring-primary"
								>
									<option value="คลังช่วยเหลือภัยพิบัติ EOC">คลัง EOC</option>
									<option value="คลังย่อยโรงเรียนเทศบาล 2">คลังโรงเรียนเทศบาล 2</option>
									<option value="คลังกลางเทศบาล">คลังกลางเทศบาล</option>
								</select>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors class="mt-1 text-xs text-destructive" />
					</Form.Field>
				</div>

				<div class="flex justify-end gap-2.5 border-t border-border/60 pt-4">
					<button
						type="button"
						onclick={onclose}
						class="cursor-pointer rounded-xl border border-border px-4 py-2.5 text-xs font-bold text-foreground transition-colors hover:bg-muted"
					>
						ยกเลิก
					</button>
					<button
						type="submit"
						disabled={$submitting}
						class="cursor-pointer rounded-xl bg-primary px-5 py-2.5 text-xs font-bold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
					>
						เพิ่มความต้องการ
					</button>
				</div>
			</form>
		</div>
	</div>
{/if}
