<script lang="ts">
	import type { SuperForm } from 'sveltekit-superforms';
	import type { SuperFormData } from 'sveltekit-superforms/client';
	import type { z } from 'zod';
	import type { publicConfigBodySchema } from '../domain/config';
	
	type ConfigBody = z.infer<typeof publicConfigBodySchema>;

	import * as Card from '$lib/components/ui/card';
	import * as Form from '$lib/components/ui/form';
	import { Input } from '$lib/components/ui/input';
	import Share2 from '@lucide/svelte/icons/share-2';

	let {
		form,
		formData
	}: {
		form: SuperForm<ConfigBody, any>;
		formData: SuperFormData<ConfigBody>;
	} = $props();
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

<Card.Root class="overflow-hidden border-none py-0 shadow-md transition-shadow hover:shadow-lg">
	<div class="border-b border-border/50 bg-primary/5 px-6 py-4">
		<div class="flex items-center gap-3">
			<div class="rounded-lg bg-primary/10 p-2 text-primary">
				<Share2 class="h-5 w-5" />
			</div>
			<div>
				<Card.Title class="text-lg">ช่องทางการติดต่อ (Social Media)</Card.Title>
				<Card.Description class="mt-1">
					ลิงก์สำหรับติดต่อผ่าน LINE OA และ Facebook (จะแสดงในหน้า Public)
				</Card.Description>
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
