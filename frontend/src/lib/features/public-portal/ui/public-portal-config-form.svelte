<script lang="ts">
	import { superForm } from 'sveltekit-superforms';
	import { zod4 } from 'sveltekit-superforms/adapters';
	import { publicConfigSchema } from '../domain/config';
	import * as Card from '$lib/components/ui/card';
	import * as Form from '$lib/components/ui/form';
	import { Input } from '$lib/components/ui/input';
	import { Button } from '$lib/components/ui/button';
	import { Switch } from '$lib/components/ui/switch';
	import { Textarea } from '$lib/components/ui/textarea';
	import MapPin from '@lucide/svelte/icons/map-pin';
	import Eye from '@lucide/svelte/icons/eye';
	import Navigation from '@lucide/svelte/icons/navigation';
	import Dog from '@lucide/svelte/icons/dog';
	import Car from '@lucide/svelte/icons/car';
	import Share2 from '@lucide/svelte/icons/share-2';
	import MessageCircleQuestion from '@lucide/svelte/icons/message-circle-question';
	import Plus from '@lucide/svelte/icons/plus';
	import GripVertical from '@lucide/svelte/icons/grip-vertical';
	import Trash2 from '@lucide/svelte/icons/trash-2';
	import Save from '@lucide/svelte/icons/save';
	import { toast } from 'svelte-sonner';
	import { invalidateAll } from '$app/navigation';

	let { data } = $props();

	const form = superForm(data.form, {
		validators: zod4(publicConfigSchema),
		dataType: 'json',
		onUpdated: async ({ form }) => {
			if (form.valid) {
				toast.success(form.message || 'บันทึกสำเร็จ');
				await invalidateAll();
			} else {
				toast.error(form.message || 'เกิดข้อผิดพลาดในการบันทึกข้อมูล');
			}
		}
	});

	const { form: formData, enhance, submitting } = form;

	function addFaq() {
		$formData.faqs = [
			...$formData.faqs,
			{
				id: crypto.randomUUID(),
				question: '',
				answer: '',
				is_published: true,
				order: $formData.faqs.length
			}
		];
	}

	function removeFaq(index: number) {
		$formData.faqs = $formData.faqs.filter((_: unknown, i: number) => i !== index);
	}
</script>

{#snippet socialInput(name: 'line_oa_url' | 'facebook_url', label: string, placeholder: string)}
	<Form.Field {form} {name}>
		<Form.Control>
			{#snippet children({ props })}
				<Form.Label class="text-sm font-semibold text-muted-foreground">{label}</Form.Label>
				<Input
					{...props}
					bind:value={$formData[name]}
					{placeholder}
					class="mt-1.5 transition-all focus-visible:ring-primary/30"
				/>
			{/snippet}
		</Form.Control>
		<Form.Description class="text-xs">เว้นว่างไว้หากไม่มี</Form.Description>
		<Form.FieldErrors />
	</Form.Field>
{/snippet}

{#snippet faqItem(i: number)}
	<div
		class="group relative flex items-start space-x-4 rounded-xl border border-border/50 bg-background p-5 shadow-sm transition-all hover:border-primary/30 hover:shadow-md"
	>
		<!-- Accent Left Border -->
		<div
			class="absolute inset-y-0 left-0 w-1.5 rounded-l-xl bg-primary/20 transition-colors group-hover:bg-primary"
		></div>

		<div
			class="mt-1 cursor-grab pl-2 text-muted-foreground/40 hover:text-foreground active:cursor-grabbing"
		>
			<GripVertical class="h-6 w-6" />
		</div>

		<div class="flex-1 space-y-5">
			<div class="flex flex-col items-end gap-4 sm:flex-row">
				<div class="w-full">
					<Form.Field {form} name={`faqs[${i}].question`}>
						<Form.Control>
							{#snippet children({ props })}
								<Form.Label class="text-sm font-semibold text-muted-foreground">คำถาม</Form.Label>
								<Input
									{...props}
									bind:value={$formData.faqs[i].question}
									placeholder="เช่น วิธีการลงทะเบียน?"
									class="mt-1.5 font-medium transition-all focus-visible:ring-primary/30"
								/>
							{/snippet}
						</Form.Control>
						<Form.FieldErrors />
					</Form.Field>
				</div>

				<div
					class="mb-1 flex h-fit w-36 items-center justify-center space-x-3 rounded-lg border border-border/50 bg-slate-50 px-3 py-2 dark:bg-slate-900"
				>
					<span
						class="text-sm font-medium {$formData.faqs[i].is_published
							? 'text-primary'
							: 'text-muted-foreground'}"
					>
						{$formData.faqs[i].is_published ? 'เผยแพร่' : 'ซ่อน'}
					</span>
					<Switch bind:checked={$formData.faqs[i].is_published} />
				</div>
			</div>

			<Form.Field {form} name={`faqs[${i}].answer`}>
				<Form.Control>
					{#snippet children({ props })}
						<Form.Label class="text-sm font-semibold text-muted-foreground">คำตอบ</Form.Label>
						<Textarea
							{...props}
							bind:value={$formData.faqs[i].answer}
							placeholder="คำตอบที่ต้องการอธิบาย..."
							rows={3}
							class="mt-1.5 resize-y leading-relaxed transition-all focus-visible:ring-primary/30"
						/>
					{/snippet}
				</Form.Control>
				<Form.FieldErrors />
			</Form.Field>
		</div>

		<Button
			type="button"
			variant="ghost"
			size="icon"
			class="text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 hover:bg-destructive/10 hover:text-destructive"
			onclick={() => removeFaq(i)}
			title="ลบคำถาม"
		>
			<Trash2 class="h-4 w-4" />
		</Button>
	</div>
{/snippet}

<form method="POST" use:enhance class="space-y-8 pb-24">
	<!-- Social Links Section -->
	<Card.Root class="overflow-hidden border-none py-0 shadow-md transition-shadow hover:shadow-lg">
		<div class="border-b border-border/50 bg-primary/5 px-6 py-4">
			<div class="flex items-center gap-3">
				<div class="rounded-lg bg-primary/10 p-2 text-primary">
					<Share2 class="h-5 w-5" />
				</div>
				<div>
					<Card.Title class="text-lg">ช่องทางการติดต่อ (Social Media)</Card.Title>
					<Card.Description class="mt-1"
						>ลิงก์สำหรับติดต่อผ่าน LINE OA และ Facebook (จะแสดงในหน้า Public)</Card.Description
					>
				</div>
			</div>
		</div>
		<Card.Content class="space-y-6 p-6">
			<div class="grid gap-6 md:grid-cols-2">
				{@render socialInput('line_oa_url', 'LINE OA URL', 'https://line.me/ti/p/...')}
				{@render socialInput('facebook_url', 'Facebook URL', 'https://facebook.com/...')}
			</div>
		</Card.Content>
	</Card.Root>

	<!-- FAQs Section -->
	<Card.Root class="overflow-hidden border-none py-0! shadow-md transition-shadow hover:shadow-lg">
		<div
			class="flex flex-col justify-between gap-4 border-b border-border/50 bg-primary/5 px-6 py-4 sm:flex-row sm:items-center"
		>
			<div class="flex items-center gap-3">
				<div class="rounded-lg bg-primary/10 p-2 text-primary">
					<MessageCircleQuestion class="h-5 w-5" />
				</div>
				<div>
					<Card.Title class="text-lg">คำถามที่พบบ่อย (FAQ)</Card.Title>
					<Card.Description class="mt-1"
						>ตั้งค่ารายการคำถาม-คำตอบที่แสดงในหน้า Public</Card.Description
					>
				</div>
			</div>
			<Button
				type="button"
				variant="default"
				size="sm"
				onclick={addFaq}
				class="shrink-0 shadow-sm transition-all hover:shadow-md"
			>
				<Plus class="mr-2 h-4 w-4" /> เพิ่มคำถาม
			</Button>
		</div>

		<Card.Content class="space-y-6 bg-slate-50/50 p-6 dark:bg-slate-900/20">
			{#if $formData.faqs.length === 0}
				<div
					class="flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-border/60 bg-background/50 py-12 text-center text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/5"
				>
					<MessageCircleQuestion class="mb-3 h-10 w-10 text-muted-foreground/40" />
					<p class="font-medium text-foreground">ยังไม่มีรายการคำถามที่พบบ่อย</p>
					<p class="mt-1 text-sm">คลิกปุ่ม "เพิ่มคำถาม" ด้านบนเพื่อเริ่มต้นเพิ่มข้อมูล</p>
				</div>
			{/if}

			<div class="space-y-4">
				{#each $formData.faqs as faq, i (faq.id || i)}
					{@render faqItem(i)}
				{/each}
			</div>
		</Card.Content>
	</Card.Root>

	<!-- Sticky Bottom Action Bar -->
	<div
		class="fixed right-0 bottom-0 left-0 border-t border-border/50 bg-background/80 p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.05)] backdrop-blur-md md:left-72"
	>
		<div class="mx-auto flex max-w-7xl items-center justify-end space-x-4 pr-4">
			<Button type="button" variant="ghost" class="font-medium">ยกเลิก</Button>
			<Button
				type="submit"
				disabled={$submitting}
				class="min-w-[140px] shadow-md transition-all hover:shadow-lg"
			>
				{#if $submitting}
					<div
						class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent"
					></div>
					กำลังบันทึก...
				{:else}
					<Save class="mr-2 h-4 w-4" /> บันทึกการเปลี่ยนแปลง
				{/if}
			</Button>
		</div>
	</div>
</form>
