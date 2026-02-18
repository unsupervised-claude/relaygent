import { json } from '@sveltejs/kit';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.env.HOME, '.relaygent', 'config.json');

const VALID_MODELS = [
	'claude-opus-4-6',
	'claude-sonnet-4-5-20250929',
	'claude-haiku-4-5-20251001',
];

function readConfig() {
	try {
		return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
	} catch {
		return {};
	}
}

function writeConfig(config) {
	fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}

export function GET() {
	const config = readConfig();
	return json({ model: config.model || null, models: VALID_MODELS });
}

export async function POST({ request }) {
	const { model } = await request.json();
	if (!VALID_MODELS.includes(model)) {
		return json({ error: `Invalid model. Valid: ${VALID_MODELS.join(', ')}` }, { status: 400 });
	}
	const config = readConfig();
	config.model = model;
	writeConfig(config);
	return json({ model, status: 'ok' });
}
