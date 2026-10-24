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
		}
	}
};
