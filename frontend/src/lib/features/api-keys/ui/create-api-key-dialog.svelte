<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import { toast } from 'svelte-sonner';
	import {
		DURATION_PRESETS,
		createApiKeySchema,
		resolveExpiresAt,
		type DurationPresetDays
	} from '../domain/api-key';
	import { useCreateApiKey } from '../application/queries';
	import type { CreatedApiKey } from '../domain/api-key';

	let {
		open = $bindable(false),
		oncreated
	}: {
		open?: boolean;
		oncreated: (created: CreatedApiKey) => void;
	} = $props();

	const createMutation = useCreateApiKey();

	let name = $state('');
	let owner = $state('');
	let durationDays = $state(90);

	function resetForm() {
		name = '';
		owner = '';
		durationDays = 90;
	}

	function handleOpenChange(next: boolean) {
		open = next;
		if (!next) resetForm();
	}

	function applyPreset(days: DurationPresetDays) {
		durationDays = days;
	}

	function handleCreate() {
		const parsed = createApiKeySchema.safeParse({
			name,
			owner,
			duration_days: durationDays
		});
		if (!parsed.success) {
			const first = parsed.error.issues[0]?.message ?? 'Invalid input';
			toast.error(first);
			return;
		}

		const expires_at = resolveExpiresAt(parsed.data);

		createMutation.mutate(
			{ name: parsed.data.name, owner: parsed.data.owner, expires_at },
			{
				onSuccess: (created) => {
					toast.success('API key created');
					open = false;
					resetForm();
					oncreated(created);
				},
				onError: (err) => {
					toast.error(err instanceof Error ? err.message : 'Failed to create API key');
				}
			}
		);
	}
</script>

<Dialog.Root bind:open={() => open, handleOpenChange}>
	<Dialog.Content class="overflow-hidden p-0 sm:max-w-[480px]">
		<div class="border-b border-border bg-muted/30 p-6 pb-4">
			<Dialog.Title class="text-xl">Create API key</Dialog.Title>
			<Dialog.Description class="mt-1.5">
				The full secret is shown once after creation. Store it securely — it cannot be recovered.
			</Dialog.Description>
		</div>
		<div class="grid gap-5 p-6">
			<div class="grid gap-2">
				<Label for="api-key-name" class="text-sm font-semibold"
					>Name <span class="text-destructive">*</span></Label
				>
				<Input
					id="api-key-name"
					bind:value={name}
					placeholder="e.g. Hat Yai ROD"
					class="focus-visible:ring-primary"
				/>
			</div>
			<div class="grid gap-2">
				<Label for="api-key-owner" class="text-sm font-semibold"
					>Owner <span class="text-destructive">*</span></Label
				>
				<Input
					id="api-key-owner"
					bind:value={owner}
					placeholder="Organization or contact"
					class="focus-visible:ring-primary"
				/>
			</div>
			<div class="grid gap-2">
				<Label for="api-key-duration" class="text-sm font-semibold"
					>Duration (days) <span class="text-destructive">*</span></Label
				>
				<div class="flex flex-wrap gap-2">
					{#each DURATION_PRESETS as days (days)}
						<Button
							type="button"
							size="sm"
							variant={durationDays === days ? 'default' : 'outline'}
							onclick={() => applyPreset(days)}
						>
							{days}
						</Button>
					{/each}
				</div>
				<Input
					id="api-key-duration"
					type="number"
					min="1"
					max="3650"
					step="1"
					bind:value={durationDays}
					placeholder="Days until expiry"
					class="focus-visible:ring-primary"
				/>
			</div>
		</div>
		<div class="flex items-center justify-end gap-2 border-t border-border bg-muted/30 p-4">
			<Button variant="ghost" onclick={() => handleOpenChange(false)}>Cancel</Button>
			<Button onclick={handleCreate} disabled={createMutation.isPending} class="min-w-[120px]">
				{#if createMutation.isPending}
					<div
						class="mr-2 h-4 w-4 animate-spin rounded-full border-2 border-primary-foreground border-t-transparent"
					></div>
					Creating…
				{:else}
					Create key
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
