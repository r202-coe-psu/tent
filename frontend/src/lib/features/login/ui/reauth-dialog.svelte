<script lang="ts">
	import * as Dialog from '$lib/components/ui/dialog';
	import LoginForm from './login-form.svelte';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	function handleSuccess() {
		open = false;
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content class="sm:max-w-sm">
		<Dialog.Header>
			<Dialog.Title>เข้าสู่ระบบอีกครั้ง</Dialog.Title>
			<Dialog.Description>Session หมดอายุแล้ว กรุณาเข้าสู่ระบบเพื่อใช้งานต่อ</Dialog.Description>
		</Dialog.Header>
		<LoginForm navigateOnSuccess={false} showCard={false} onSuccess={handleSuccess} />
	</Dialog.Content>
</Dialog.Root>
