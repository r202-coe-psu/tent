import { MongoClient } from 'mongodb';
import { env } from '$env/dynamic/private';

const uri = env.MONGODB_URI || 'mongodb://localhost:27017';
const client = new MongoClient(uri);

let dbName = 'smart_shelter';

async function getDb() {
	await client.connect();
	return client.db(dbName);
}

export async function saveDonation(donation: any) {
	const db = await getDb();
	const collection = db.collection('donations');
	const now = new Date().toISOString();
	const expires_at = new Date(Date.now() + 72 * 60 * 60 * 1000).toISOString(); // 72 hours expiration

	const doc = {
		...donation,
		status: 'declared',
		created_at: now,
		expires_at,
		synced_to_couch: false
	};

	const result = await collection.insertOne(doc);
	return {
		...doc,
		_id: result.insertedId
	};
}

export async function getDonationByHash(hash: string) {
	const db = await getDb();
	const collection = db.collection('donations');
	return await collection.findOne({ tracking_token_hash: hash });
}
