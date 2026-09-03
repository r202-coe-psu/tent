<script lang="ts">
	import { UserEditPage } from '$lib/features/users';

	let { data } = $props();
</script>

<UserEditPage name={data.name} allowSystemAdminRole backHref="/portal/system-management/users" />
