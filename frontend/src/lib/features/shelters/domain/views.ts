export const SHELTER_DASHBOARD_VIEWS = {
	_id: '_design/app',
	views: {
		occupancy: {
			map: `function (doc) {
				if (doc.type !== 'evacuee' || !doc.current_stay) return;
				emit(doc.current_stay.status, 1);
			}`,
			reduce: '_count'
		},
		demographics_by_age: {
			map: `function (doc) {
				// In the shelter = active + room_confirmed (CR-170), matching the occupancy KPI.
				if (doc.type !== 'evacuee' || !doc.current_stay) return;
				var s = doc.current_stay.status;
				if (s !== 'active' && s !== 'room_confirmed') return;
				emit(doc.birth_year || null, 1);
			}`,
			reduce: '_count'
		},
		demographics_by_country: {
			map: `function (doc) {
				// In the shelter = active + room_confirmed (CR-170), matching the occupancy KPI.
				if (doc.type !== 'evacuee' || !doc.current_stay) return;
				var s = doc.current_stay.status;
				if (s !== 'active' && s !== 'room_confirmed') return;
				var c = (doc.country || '').trim().toUpperCase() || 'UNKNOWN';
				emit(c, 1);
			}`,
			reduce: '_count'
		},
		registrations_by_date_status: {
			map: `function (doc) {
				// preregister: evacuees registered in advance (web / kiosk / api), counted on the day
				// the registration was created. 'staff' is onsite registration, so it is not counted.
				if (doc.type === 'evacuee') {
					var via = doc.registered_via;
					if (via !== 'web' && via !== 'kiosk' && via !== 'api') return;
					if (!doc.created_at) return;
					if (doc.current_stay && doc.current_stay.status === 'cancelled') return;
					var created = new Date(doc.created_at);
					created.setUTCHours(created.getUTCHours() + 7);
					emit([created.toISOString().slice(0, 10), 'preregister'], 1);
					return;
				}

				if (doc.type !== 'movement' || !doc.occurred_at) return;

				// ปรับ Timezone +07:00 (Thailand) ก่อนตัดวันที่ เพื่อไม่ให้ movement ตอนเช้าตรู่ตกไปอยู่วันก่อนหน้า (UTC offset)
				var dt = new Date(doc.occurred_at);
				dt.setUTCHours(dt.getUTCHours() + 7);
				var date = dt.toISOString().slice(0, 10);

				var series;

				if (doc.action === 'check_in' || doc.action === 'transfer_in') {
					series = 'checkin';
				} else if (doc.action === 'check_out' || doc.action === 'transfer_out') {
					series = 'checkout';
				} else {
					return;
				}

				emit([date, series], 1);
			}`,
			reduce: '_count'
		},
		// #658: per-pool item totals over the append-only entry/move/void event log.
		// A void subtracts the entry from the pool it resolved to at void time (nets it out).
		// value = [qty, entry_count]; a move subtracts from the source pool and adds to the target.
		// group_level=1 -> per pool, 2 -> per item, 3 -> per entry (net count 1 = present).
		bulk_return_pool_item_totals: {
			map: `function (doc) {
				if (doc.type === 'bulk_return_entry') {
					emit([doc.pool_id, doc.item_id, doc._id], [parseFloat(doc.qty), 1]);
				} else if (doc.type === 'bulk_return_entry_move') {
					var moved = parseFloat(doc.qty);
					emit([doc.from_pool_id, doc.item_id, doc.entry_id], [-moved, -1]);
					emit([doc.to_pool_id, doc.item_id, doc.entry_id], [moved, 1]);
					} else if (doc.type === 'bulk_return_entry_void') {
						emit([doc.pool_id, doc.item_id, doc.entry_id], [-parseFloat(doc.qty), -1]);
				}
			}`,
			reduce: '_sum'
		},
		// #821 (view manifest v7): the "รับแล้ว" search by donor name and by item. A Mango index
		// cannot match one word of `donor.name` or one entry of `items[]`; a view emits one row
		// per key. Each key at most once per donation, so a paged read never repeats a document.
		// Key = [searched value, received_at], value null (the document comes via include_docs).
		donation_received_by_name: {
			// The normalization is `normalizeDonorNameKey` (donations/domain/received-search.ts):
			// NFKC, lowercase, trim, collapse runs of whitespace. Keep the two in step.
			map: `function (doc) {
				if (doc.type !== 'donation' || doc.status !== 'received') return;
				if (!doc.donor || typeof doc.donor.name !== 'string') return;
				var whole = doc.donor.name.normalize('NFKC').toLowerCase().trim().replace(/\\s+/g, ' ');
				if (!whole) return;
				var receivedAt = doc.received_at || '';
				var keys = [whole].concat(whole.split(' '));
				var seen = {};
				for (var i = 0; i < keys.length; i++) {
					var k = keys[i];
					if (!k || seen['k:' + k]) continue;
					seen['k:' + k] = true;
					emit([k, receivedAt], null);
				}
			}`
		},
		donation_received_by_item: {
			map: `function (doc) {
				if (doc.type !== 'donation' || doc.status !== 'received') return;
				if (!doc.items || !doc.items.length) return;
				var receivedAt = doc.received_at || '';
				var seen = {};
				for (var i = 0; i < doc.items.length; i++) {
					var itemId = doc.items[i] && doc.items[i].item_id;
					if (typeof itemId !== 'string' || !itemId || seen['i:' + itemId]) continue;
					seen['i:' + itemId] = true;
					emit([itemId, receivedAt], null);
				}
			}`
		},
		station_logs_by_station: {
			// CR-192: raw per-event rows; start/complete pairing happens in the BFF (a map cannot
			// join across docs). Date-first key so the range is filtered inside CouchDB.
			map: `function (doc) {
				if (doc.type !== 'station_log' || !doc.occurred_at) return;
				var dt = new Date(doc.occurred_at);
				if (isNaN(dt.getTime())) return;
				// +07:00 (Thailand) before cutting the date, same as registrations_by_date_status.
				dt.setUTCHours(dt.getUTCHours() + 7);
				// Amendment 2 (FR-STL-30): the actor is the kiosk device or the staff user.
				var actor = doc.channel === 'kiosk' ? doc.device_id : doc.created_by;
				emit(
					[dt.toISOString().slice(0, 10), doc.station, doc.channel, doc.evacuee_id],
					{ action: doc.action, occurred_at: doc.occurred_at, actor: actor || null }
				);
			}`
		}
	}
};
