import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_DIR = path.join(__dirname, '..', '..');
const HITS_FILE = path.join(process.env.RELAYGENT_DATA_DIR || path.join(REPO_DIR, 'data'), 'page_hits.json');

function recordHit(pathname) {
	const date = new Date().toISOString().split('T')[0];
	let data = {};
	try { data = JSON.parse(fs.readFileSync(HITS_FILE, 'utf-8')); } catch {}
	if (!data[date]) data[date] = {};
	data[date][pathname] = (data[date][pathname] || 0) + 1;
	try {
		fs.mkdirSync(path.dirname(HITS_FILE), { recursive: true });
		fs.writeFileSync(HITS_FILE, JSON.stringify(data, null, 2));
	} catch { /* ignore */ }
}

export async function handle({ event, resolve }) {
	const { pathname } = event.url;
	if (!pathname.startsWith('/_') && !pathname.includes('.')) {
		recordHit(pathname);
	}
	return resolve(event);
}
