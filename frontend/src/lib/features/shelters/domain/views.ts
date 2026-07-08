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
				if (doc.type !== 'evacuee') return;

				if (!doc.birth_year) {
					emit('unknown', 1);
					return;
				}

				var ceYear = doc.birth_year - 543;
				var currentYear = new Date().getFullYear();
				var age = currentYear - ceYear;
				var bucket;

				if (age <= 4) {
					bucket = '0-4';
				} else if (age <= 11) {
					bucket = '5-11';
				} else if (age <= 17) {
					bucket = '12-17';
				} else if (age <= 59) {
					bucket = '18-59';
				} else {
					bucket = '60+';
				}

				emit(bucket, 1);
			}`,
			reduce: '_count'
		},
		demographics_by_country: {
			map: `function (doc) {
				if (doc.type !== 'evacuee') return;
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
		}
	}
};
