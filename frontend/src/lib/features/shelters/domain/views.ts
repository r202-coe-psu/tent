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
		// #658: per-pool item totals over the append-only entry/move event log.
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
				}
			}`,
			reduce: '_sum'
		}
	}
};
