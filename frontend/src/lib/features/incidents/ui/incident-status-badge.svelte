<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { INCIDENT_STATUS_LABELS, type IncidentStatus } from '../domain/incident';
	import { STATUS_BADGE_CLASS } from './incident.ui-helpers';

	const { status }: { status: IncidentStatus } = $props();
</script>

<Badge variant="outline" class="font-semibold {STATUS_BADGE_CLASS[status]}">
	{INCIDENT_STATUS_LABELS[status]}
</Badge>
