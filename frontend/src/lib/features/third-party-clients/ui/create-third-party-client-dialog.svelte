<script lang="ts">
	import { Button } from '$lib/components/ui/button/index.js';
	import { Input } from '$lib/components/ui/input/index.js';
	import { Label } from '$lib/components/ui/label/index.js';
	import { Checkbox } from '$lib/components/ui/checkbox/index.js';
	import * as Dialog from '$lib/components/ui/dialog/index.js';
	import * as Select from '$lib/components/ui/select/index.js';
	import { toast } from 'svelte-sonner';
	import {
		GRANTABLE_SCOPES,
		PARTNER_MODULES,
		PARTNER_MODULE_LABEL,
		SCOPE_LABEL,
		createThirdPartyClientSchema,
		type CreatedThirdPartyClient,
		type GrantableScope,
		type PartnerModule
	} from '../domain/third-party-client';
	import { useCreateThirdPartyClient } from '../application/queries';

	let {
		open = $bindable(false),
		oncreated
	}: {
		open?: boolean;
		oncreated: (created: CreatedThirdPartyClient) => void;
	} = $props();

	const createMutation = useCreateThirdPartyClient();

	let clientId = $state('');
	let moduleName = $state<PartnerModule | ''>('');
	let selectedScopes = $state<GrantableScope[]>([]);

	function resetForm() {
		clientId = '';
		moduleName = '';
		selectedScopes = [];
	}

	function handleOpenChange(next: boolean) {
		open = next;
		if (!next) resetForm();
	}

	function toggleScope(scope: GrantableScope, checked: boolean) {
		selectedScopes = checked
			? [...selectedScopes, scope]
			: selectedScopes.filter((s) => s !== scope);
	}

	function handleCreate() {
		const parsed = createThirdPartyClientSchema.safeParse({
			client_id: clientId,
			module_name: moduleName,
			allowed_scopes: selectedScopes
		});
		if (!parsed.success) {
			const first = parsed.error.issues[0]?.message ?? 'Invalid input';
			toast.error(first);
			return;
		}

		createMutation.mutate(parsed.data, {
			onSuccess: (created) => {
				toast.success('Third-party client created');
				open = false;
				resetForm();
				oncreated(created);
			},
			onError: (err) => {
				toast.error(err instanceof Error ? err.message : 'Failed to create client');
			}
		});
	}
</script>

<Dialog.Root bind:open={() => open, handleOpenChange}>
	<Dialog.Content class="overflow-hidden p-0 sm:max-w-[480px]">
		<div class="border-b border-border bg-muted/30 p-6 pb-4">
			<Dialog.Title class="text-xl">Create partner OAuth2 client</Dialog.Title>
			<Dialog.Description class="mt-1.5">
				The full secret is shown once after creation. Store it securely — it cannot be recovered.
			</Dialog.Description>
		</div>
		<div class="grid gap-5 p-6">
			<div class="grid gap-2">
				<Label for="tpc-client-id" class="text-sm font-semibold"
					>Client ID <span class="text-destructive">*</span></Label
				>
				<Input
					id="tpc-client-id"
					bind:value={clientId}
					placeholder="e.g. m6-warehouse-logistics"
					class="font-mono focus-visible:ring-primary"
				/>
			</div>
			<div class="grid gap-2">
				<Label for="tpc-module-name" class="text-sm font-semibold"
					>Name <span class="text-destructive">*</span></Label
				>
				<Select.Root type="single" bind:value={moduleName}>
					<Select.Trigger id="tpc-module-name" class="w-full">
						{moduleName ? PARTNER_MODULE_LABEL[moduleName] : '-- เลือกหน่วยงาน --'}
					</Select.Trigger>
					<Select.Content>
						{#each PARTNER_MODULES as module (module)}
							<Select.Item value={module} label={PARTNER_MODULE_LABEL[module]} />
						{/each}
					</Select.Content>
				</Select.Root>
			</div>
			<div class="grid gap-2">
				<span class="text-sm font-semibold">Scopes <span class="text-destructive">*</span></span>
				<div class="grid gap-2">
					{#each GRANTABLE_SCOPES as scope (scope)}
						<label
							class="flex items-center gap-3 rounded-lg border border-border bg-background p-3 text-sm"
						>
							<Checkbox
								checked={selectedScopes.includes(scope)}
								onCheckedChange={(v) => toggleScope(scope, v === true)}
							/>
							<span>{SCOPE_LABEL[scope]}</span>
						</label>
					{/each}
				</div>
				<p class="text-xs text-muted-foreground">
					<code class="rounded bg-muted px-1">occupancy-pii-read</code> is never grantable here stays
					denied by default.
				</p>
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
					Create client
				{/if}
			</Button>
		</div>
	</Dialog.Content>
</Dialog.Root>
