<script lang="ts">
	import { Badge } from '$lib/components/ui/badge/index.js';
	import { INCIDENT_SEVERITY_LABELS, type IncidentSeverity } from '../domain/incident';
	import { SEVERITY_BADGE_CLASS } from './incident.ui-helpers';

	const { severity }: { severity: IncidentSeverity } = $props();
</script>

<Badge variant="outline" class="font-semibold {SEVERITY_BADGE_CLASS[severity]}">
	ความรุนแรง: {INCIDENT_SEVERITY_LABELS[severity]}
</Badge>
