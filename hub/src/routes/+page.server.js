import { listTopics, getKbDir } from '$lib/kb.js';
import { getRelayActivity } from '$lib/relayActivity.js';
import { getServiceHealth } from '$lib/serviceHealth.js';
import fs from 'fs';
import path from 'path';

const CONFIG_PATH = path.join(process.env.HOME, '.relaygent', 'config.json');

function getModel() {
	try {
		const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
		return config.model || null;
	} catch { return null; }
}

function getMainGoal() {
	const handoffPath = path.join(getKbDir(), 'handoff.md');
	try {
		const raw = fs.readFileSync(handoffPath, 'utf-8');
		const goalMatch = raw.match(/^#{1,3} MAIN GOAL[^\n]*\n([\s\S]*?)(?=\n---|\n#{1,3} [^M])/m);
		if (goalMatch) {
			return goalMatch[1].trim()
				.replace(/\*\*/g, '')
				.split('\n')
				.filter(l => l.trim())
				.slice(0, 3)
				.join(' | ');
		}
	} catch { /* handoff.md doesn't exist */ }
	return null;
}

function getAttentionItems() {
	const attentionPath = path.join(getKbDir(), 'attention.md');
	try {
		const raw = fs.readFileSync(attentionPath, 'utf-8');
		const activeMatch = raw.match(/## Active\n([\s\S]*?)(?=\n## |$)/);
		if (activeMatch) {
			return activeMatch[1]
				.split('\n')
				.filter(line => line.startsWith('- '))
				.map(line => line.replace(/^- \*\*([^*]+)\*\*:?\s*/, '<strong>$1:</strong> ').replace(/^- /, ''));
		}
	} catch { /* attention.md doesn't exist */ }
	return [];
}

function getContextPct() {
	try {
		const raw = fs.readFileSync('/tmp/relaygent-context-pct', 'utf-8').trim();
		const pct = parseInt(raw, 10);
		return isNaN(pct) ? null : pct;
	} catch { return null; }
}

export async function load() {
	const topics = listTopics();
	const clockActivity = getRelayActivity();
	const services = await getServiceHealth();

	return {
		topicCount: topics.length,
		attentionItems: getAttentionItems(),
		mainGoal: getMainGoal(),
		relayActivity: clockActivity?.recentActivity || [],
		contextPct: getContextPct(),
		services,
		currentModel: getModel(),
	};
}
