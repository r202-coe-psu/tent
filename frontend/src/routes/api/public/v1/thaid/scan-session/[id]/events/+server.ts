import type { RequestHandler } from './$types';
import { getScanSession } from '$lib/server/thaid-scan-session';
import type { ThaiDAutofillProfile } from '$lib/features/people/domain/thaid-profile';

export const prerender = false;

/**
 * GET /api/public/v1/thaid/scan-session/[id]/events
 * Server-Sent Events (SSE) stream for real-time notification when member scans and confirms ThaiD.
 */
export const GET: RequestHandler = async ({ params }) => {
	const session = getScanSession(params.id);
	if (!session) {
		return new Response('event: expired\ndata: {"status":"expired"}\n\n', {
			status: 404,
			headers: {
				'Content-Type': 'text/event-stream',
				'Cache-Control': 'no-cache, no-transform',
				Connection: 'keep-alive'
			}
		});
	}

	let isClosed = false;
	let heartbeatTimer: NodeJS.Timeout | null = null;

	const stream = new ReadableStream({
		start(controller) {
			const encoder = new TextEncoder();

			function sendEvent(event: string, data: unknown) {
				if (isClosed) return;
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					cleanup();
				}
			}

			function sendPing() {
				if (isClosed) return;
				try {
					controller.enqueue(encoder.encode(': ping\n\n'));
				} catch {
					cleanup();
				}
			}

			function handleCompleted(profile: ThaiDAutofillProfile) {
				sendEvent('completed', { status: 'completed', profile });
				cleanup();
				try {
					controller.close();
				} catch {
					// Controller already closed
				}
			}

			function handleExpired() {
				sendEvent('expired', { status: 'expired' });
				cleanup();
				try {
					controller.close();
				} catch {
					// Controller already closed
				}
			}

			function cleanup() {
				if (isClosed) return;
				isClosed = true;
				if (heartbeatTimer) {
					clearInterval(heartbeatTimer);
					heartbeatTimer = null;
				}
				session?.emitter.removeListener('completed', handleCompleted);
				session?.emitter.removeListener('expired', handleExpired);
			}

			// If already completed or expired when connecting
			if (session.status === 'completed' && session.profile) {
				sendEvent('completed', { status: 'completed', profile: session.profile });
				try {
					controller.close();
				} catch {}
				return;
			}
			if (session.status === 'expired') {
				sendEvent('expired', { status: 'expired' });
				try {
					controller.close();
				} catch {}
				return;
			}

			// Send initial connected state
			sendEvent('init', { status: 'pending', expiresAt: session.expiresAt });

			// Subscribe to session events
			session.emitter.on('completed', handleCompleted);
			session.emitter.on('expired', handleExpired);

			// Heartbeat every 15 seconds to keep connection alive
			heartbeatTimer = setInterval(sendPing, 15_000);
			if (heartbeatTimer.unref) {
				heartbeatTimer.unref();
			}
		},
		cancel() {
			isClosed = true;
			if (heartbeatTimer) {
				clearInterval(heartbeatTimer);
				heartbeatTimer = null;
			}
		}
	});

	return new Response(stream, {
		headers: {
			'Content-Type': 'text/event-stream',
			'Cache-Control': 'no-cache, no-transform',
			Connection: 'keep-alive'
		}
	});
};
