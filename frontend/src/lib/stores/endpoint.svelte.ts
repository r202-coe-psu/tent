import { browser } from '$app/environment';
import { probeCentral } from '$lib/db/couch-db';
import { getSession } from '$lib/db/couch';
import { CannotConnectError } from '$lib/utils/errors';

export type EndpointStatus = 'connecting' | 'connected' | 'disconnected';
export type ActiveEndpoint = 'central';

class EndpointStore {
	private state = $state<{
		status: EndpointStatus;
		active: ActiveEndpoint;
	}>({
		status: 'connecting',
		active: 'central'
	});

	get status(): EndpointStatus {
		return this.state.status;
	}

	get active(): ActiveEndpoint {
		return this.state.active;
	}

	get isWritable(): boolean {
		return this.state.status === 'connected';
	}

	assertWritable(): void {
		if (!this.isWritable) {
			throw new CannotConnectError();
		}
	}

	async probe(fetchFn?: typeof fetch): Promise<boolean> {
		if (!browser) return false;
		this.state.status = 'connecting';
		const up = await probeCentral({ fetch: fetchFn });
		if (up) {
			this.state.status = 'connected';
			return true;
		}
		this.state.status = 'disconnected';
		return false;
	}

	async forceRetry(fetchFn?: typeof fetch): Promise<boolean> {
		const session = await getSession(fetchFn).catch(() => null);
		if (!session) {
			this.state.status = 'disconnected';
			return false;
		}
		return this.probe(fetchFn);
	}

	markDisconnected(): void {
		this.state.status = 'disconnected';
	}

	markConnected(): void {
		this.state.status = 'connected';
	}
}

export const endpointStore = new EndpointStore();
