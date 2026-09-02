/**
 * T-13 — Who may drive which `stock_transfer` transitions (CR-059 Flow 1).
 *
 * Pure TypeScript — no I/O. Mirrors `referrals/domain/referral.authorization.ts`.
 */

import type { StockTransfer, TransferStatus } from './operations';

export class TransferAuthorizationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'TransferAuthorizationError';
	}
}

function sameShelter(a: string, b: string): boolean {
	return a.trim().toUpperCase() === b.trim().toUpperCase();
}

function isValidTransition(from: TransferStatus, to: TransferStatus): boolean {
	if (from === 'requested') return to === 'shipped' || to === 'cancelled' || to === 'disputed';
	// CR-089 FR-07 — `disputed` leads back to `requested` and nowhere else, so a held transfer
	// can never reach `shipped`/`received`/`cancelled` without being resumed first.
	if (from === 'disputed') return to === 'requested';
	if (from === 'shipped') return to === 'received';
	return false;
}

/**
 * Whether the actor's shelter may perform `to` on this transfer.
 * Dispatch/cancel/dispute (`requested` → `shipped`/`cancelled`/`disputed`) and resume
 * (`disputed` → `requested`) → source (`from_shelter`) only.
 * Receive (`shipped` → `received`) → destination (`to_shelter`) only.
 *
 * CR-089 FR-06 — the destination is read-only while a transfer is `disputed`: every transition
 * out of `disputed` is source-only, so no extra branch is needed to hold that rule.
 */
export function assertActorMayTransition(
	transfer: StockTransfer,
	to: TransferStatus,
	actorShelter: string
): void {
	if (!isValidTransition(transfer.status, to)) {
		// The domain transition guard (dispatchTransfer/receiveTransfer/cancelTransfer) still owns
		// the status error; callers may check first.
		return;
	}

	if (to === 'shipped' || to === 'cancelled' || to === 'disputed' || to === 'requested') {
		if (!sameShelter(transfer.from_shelter, actorShelter)) {
			throw new TransferAuthorizationError(
				'Only the source shelter can dispatch, cancel, dispute or resume this transfer'
			);
		}
		return;
	}

	if (to === 'received') {
		if (!sameShelter(transfer.to_shelter, actorShelter)) {
			throw new TransferAuthorizationError(
				'Only the destination shelter can receive this transfer'
			);
		}
	}
}
