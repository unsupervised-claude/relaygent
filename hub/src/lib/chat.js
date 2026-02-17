import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { encrypt, decryptOrPassthrough } from './chatCrypto.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.join(__dirname, '..', '..', '..');
const DB_DIR = path.join(process.env.RELAYGENT_DATA_DIR || path.join(REPO_DIR, 'data'), 'hub-chat');
const DB_PATH = path.join(DB_DIR, 'chat.db');

let db;

function getDb() {
	if (db) return db;
	fs.mkdirSync(DB_DIR, { recursive: true });
	db = new Database(DB_PATH, { timeout: 5000 });
	db.pragma('journal_mode = WAL');
	db.exec(`
		CREATE TABLE IF NOT EXISTS messages (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			role TEXT NOT NULL CHECK(role IN ('human', 'assistant')),
			content TEXT NOT NULL,
			created_at TEXT NOT NULL DEFAULT (datetime('now')),
			read INTEGER NOT NULL DEFAULT 0
		)
	`);
	migrateToEncrypted(db);
	return db;
}

/** Migrate existing plaintext messages to encrypted */
function migrateToEncrypted(d) {
	const rows = d.prepare('SELECT id, content FROM messages').all();
	if (!rows.length) return;
	if (/^[0-9a-f]{58,}$/i.test(rows[0].content)) return;
	const stmt = d.prepare('UPDATE messages SET content = ? WHERE id = ?');
	const tx = d.transaction(() => {
		for (const row of rows) {
			stmt.run(encrypt(row.content), row.id);
		}
	});
	tx();
}

function decryptRow(row) {
	if (!row) return row;
	return { ...row, content: decryptOrPassthrough(row.content) };
}

export function sendHumanMessage(content) {
	const d = getDb();
	const stmt = d.prepare('INSERT INTO messages (role, content) VALUES (?, ?)');
	const result = stmt.run('human', encrypt(content));
	return getMessage(result.lastInsertRowid);
}

export function sendAssistantMessage(content) {
	const d = getDb();
	const stmt = d.prepare('INSERT INTO messages (role, content, read) VALUES (?, ?, 1)');
	const result = stmt.run('assistant', encrypt(content));
	return getMessage(result.lastInsertRowid);
}

export function getMessage(id) {
	return decryptRow(getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id));
}

export function getMessages(limit = 50, before = null) {
	const d = getDb();
	const safeLimit = Math.max(1, Math.min(limit, 200));
	const rows = before
		? d.prepare('SELECT * FROM messages WHERE id < ? ORDER BY id DESC LIMIT ?').all(before, safeLimit)
		: d.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?').all(safeLimit);
	return rows.map(decryptRow);
}

export function getUnreadHumanMessages() {
	return getDb().prepare(
		"SELECT * FROM messages WHERE role = 'human' AND read = 0 ORDER BY id ASC"
	).all().map(decryptRow);
}

export function markAsRead(ids) {
	if (!ids?.length) return;
	const safeIds = ids.map(id => Number(id)).filter(id => Number.isInteger(id) && id > 0);
	if (!safeIds.length) return;
	const d = getDb();
	const placeholders = safeIds.map(() => '?').join(',');
	d.prepare(`UPDATE messages SET read = 1 WHERE id IN (${placeholders})`).run(...safeIds);
}

export function markAllRead() {
	getDb().prepare("UPDATE messages SET read = 1 WHERE role = 'human' AND read = 0").run();
}
