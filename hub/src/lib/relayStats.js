import fs from 'fs';
import path from 'path';

const CLAUDE_PROJECTS = path.join(process.env.HOME, '.claude', 'projects');
const CACHE_TTL = 5 * 60 * 1000;
let cached = null;
let cacheTime = 0;

function parseSession(jsonlPath) {
	try {
		const stat = fs.statSync(jsonlPath);
		if (stat.size < 500) return null;

		const content = fs.readFileSync(jsonlPath, 'utf-8');
		const lines = content.trim().split('\n');
		if (lines.length < 2) return null;

		let startTs = null, endTs = null, totalTokens = 0, outputTokens = 0;
		const tools = {};
		let toolCalls = 0, textBlocks = 0, turns = 0;

		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				const ts = entry.timestamp;
				if (ts) {
					if (!startTs) startTs = ts;
					endTs = ts;
				}
				if (entry.type === 'assistant') {
					turns++;
					const usage = entry.message?.usage;
					if (usage) {
						totalTokens += (usage.input_tokens || 0)
							+ (usage.cache_creation_input_tokens || 0)
							+ (usage.cache_read_input_tokens || 0);
						outputTokens += usage.output_tokens || 0;
					}
					const content = entry.message?.content;
					if (Array.isArray(content)) {
						for (const item of content) {
							if (item?.type === 'tool_use') {
								const name = item.name || 'unknown';
								tools[name] = (tools[name] || 0) + 1;
								toolCalls++;
							} else if (item?.type === 'text' && item.text?.length > 5) {
								textBlocks++;
							}
						}
					}
				}
			} catch { /* skip bad lines */ }
		}

		if (!startTs) return null;

		const start = new Date(startTs);
		const end = new Date(endTs);
		const durationMin = Math.round((end - start) / 60000);

		return {
			start: startTs, durationMin, totalTokens, outputTokens,
			toolCalls, textBlocks, turns, tools,
			contextPct: Math.round(totalTokens / 2000),
		};
	} catch { return null; }
}

function getAllWorkspaces() {
	try {
		return fs.readdirSync(CLAUDE_PROJECTS)
			.map(d => path.join(CLAUDE_PROJECTS, d))
			.filter(p => { try { return fs.statSync(p).isDirectory(); } catch { return false; } });
	} catch { return []; }
}

export function getRelayStats() {
	if (cached && Date.now() - cacheTime < CACHE_TTL) return cached;

	const workspaces = getAllWorkspaces();
	const sessions = [];
	const globalTools = {};
	let totalTokensAll = 0, totalOutputAll = 0, totalToolCalls = 0;

	for (const ws of workspaces) {
		try {
			for (const f of fs.readdirSync(ws)) {
				if (!f.endsWith('.jsonl')) continue;
				const s = parseSession(path.join(ws, f));
				if (!s) continue;
				sessions.push(s);
				totalTokensAll += s.totalTokens;
				totalOutputAll += s.outputTokens;
				totalToolCalls += s.toolCalls;
				for (const [name, count] of Object.entries(s.tools)) {
					globalTools[name] = (globalTools[name] || 0) + count;
				}
			}
		} catch { /* skip */ }
	}

	sessions.sort((a, b) => a.start.localeCompare(b.start));

	const durations = sessions.map(s => s.durationMin).filter(d => d > 0);
	const contexts = sessions.map(s => s.contextPct).filter(c => c > 0);
	const toolsSorted = Object.entries(globalTools)
		.sort((a, b) => b[1] - a[1])
		.slice(0, 15)
		.map(([name, count]) => ({ name, count }));

	const daily = {};
	for (const s of sessions) {
		const day = s.start.slice(0, 10);
		daily[day] = (daily[day] || 0) + 1;
	}
	const today = new Date();
	const dailySeries = [];
	for (let i = 13; i >= 0; i--) {
		const d = new Date(today);
		d.setDate(d.getDate() - i);
		const key = d.toISOString().slice(0, 10);
		dailySeries.push({ date: key, count: daily[key] || 0 });
	}

	cached = {
		totalSessions: sessions.length,
		totalWorkspaces: workspaces.length,
		totalTokens: totalTokensAll,
		totalOutput: totalOutputAll,
		totalToolCalls,
		avgDuration: durations.length ? Math.round(durations.reduce((a, b) => a + b, 0) / durations.length) : 0,
		avgContext: contexts.length ? Math.round(contexts.reduce((a, b) => a + b, 0) / contexts.length) : 0,
		medianDuration: durations.length ? durations.sort((a, b) => a - b)[Math.floor(durations.length / 2)] : 0,
		topTools: toolsSorted,
		dailySessions: dailySeries,
		firstSession: sessions[0]?.start || null,
		lastSession: sessions[sessions.length - 1]?.start || null,
	};
	cacheTime = Date.now();
	return cached;
}
