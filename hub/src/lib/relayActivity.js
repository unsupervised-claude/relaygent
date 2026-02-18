import fs from 'fs';
import path from 'path';

/** Short human-readable summary for the collapsed feed view. */
export function summarizeInput(toolName, input) {
	if (!input) return '';
	if (toolName === 'Bash') return input.command?.slice(0, 120) || '';
	if (toolName === 'Read') return input.file_path?.replace(process.env.HOME, '~') || '';
	if (toolName === 'Edit' || toolName === 'Write') return input.file_path?.replace(process.env.HOME, '~') || '';
	if (toolName === 'Grep') return `/${input.pattern}/${input.path ? ' in ' + input.path.split('/').pop() : ''}`;
	if (toolName === 'Glob') return input.pattern || '';
	if (toolName === 'TodoWrite') return input.todos?.find(t => t.status === 'in_progress')?.content || '';
	if (toolName === 'WebFetch') return input.url?.replace(/^https?:\/\//, '').slice(0, 60) || '';
	if (toolName === 'WebSearch') return input.query || '';
	if (toolName === 'Task') return input.description || '';
	// MCP tools — extract the meaningful param
	const n = toolName;
	if (n.startsWith('mcp__wake-triggers__')) return input.message?.slice(0, 40) || '';
	if (n.startsWith('mcp__')) {
		// Generic MCP tool summary
		const firstVal = Object.values(input || {})[0];
		return typeof firstVal === 'string' ? firstVal.slice(0, 60) : '';
	}
	return '';
}

/** Extract full text from a tool result (for expanded view). */
export function extractResultText(content) {
	if (!content) return '';
	if (typeof content === 'string') return content.replace(/^\s+\d+→/gm, '').trim();
	if (Array.isArray(content)) {
		const texts = content.filter(c => c.type === 'text').map(c => c.text);
		const hasImage = content.some(c => c.type === 'image');
		let full = texts.join('\n').trim();
		if (hasImage) full = (full ? full + '\n' : '') + '[image]';
		return full;
	}
	return '';
}

/** Short summary of a tool result for collapsed view. */
export function summarizeResult(content) {
	const full = extractResultText(content);
	if (full.length <= 80) return full;
	return full.slice(0, 80) + '…';
}

function getRunsPrefix() {
	try {
		const cfg = JSON.parse(fs.readFileSync(path.join(process.env.HOME, '.relaygent', 'config.json'), 'utf-8'));
		// Claude CLI replaces both '/' and '.' with '-' in project slugs
		return path.join(cfg.paths.repo, 'harness', 'runs').replace(/[/.]/g, '-');
	} catch { return null; }
}

export function findLatestSession() {
	const claudeProjects = path.join(process.env.HOME, '.claude', 'projects');
	const prefix = getRunsPrefix();
	let latestSession = null;
	let latestTime = 0;

	try {
		for (const dir of fs.readdirSync(claudeProjects)) {
			if (prefix && !dir.startsWith(prefix)) continue;
			const fullPath = path.join(claudeProjects, dir);
			try { if (!fs.statSync(fullPath).isDirectory()) continue; } catch { continue; }
			for (const f of fs.readdirSync(fullPath)) {
				if (!f.endsWith('.jsonl')) continue;
				const fstat = fs.statSync(path.join(fullPath, f));
				if (fstat.mtimeMs > latestTime && fstat.size > 200) {
					latestTime = fstat.mtimeMs;
					latestSession = path.join(fullPath, f);
				}
			}
		}
	} catch { /* ignore */ }

	return latestSession;
}

/** Parse session JSONL into activity items with tool results matched. */
export function parseSession(sessionFile, lastN = 150) {
	const activity = [];
	const toolResults = new Map();

	try {
		const content = fs.readFileSync(sessionFile, 'utf-8');
		const lines = content.trim().split('\n').slice(-lastN);

		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === 'user' && entry.message?.content) {
					const items = Array.isArray(entry.message.content) ? entry.message.content : [entry.message.content];
					for (const item of items) {
						if (item?.type === 'tool_result' && item.tool_use_id) {
							toolResults.set(item.tool_use_id, item.content);
						}
					}
				}
			} catch { /* skip */ }
		}

		for (const line of lines) {
			try {
				const entry = JSON.parse(line);
				if (entry.type === 'assistant' && entry.message?.content) {
					const items = Array.isArray(entry.message.content) ? entry.message.content : [entry.message.content];
					for (const item of items) {
						if (item?.type === 'tool_use') {
							const result = toolResults.get(item.id);
							activity.push({
								type: 'tool', name: item.name, time: entry.timestamp,
								input: summarizeInput(item.name, item.input),
								params: item.input || {},
								result: summarizeResult(result),
								fullResult: extractResultText(result),
							});
						} else if (item?.type === 'text' && item.text?.length > 10) {
							activity.push({ type: 'text', time: entry.timestamp, text: item.text });
						}
					}
				}
			} catch { /* skip */ }
		}
	} catch { /* ignore */ }

	return activity;
}

export function getRelayActivity() {
	const latestSession = findLatestSession();
	if (!latestSession) return null;

	const activity = parseSession(latestSession, 100);
	const stat = fs.statSync(latestSession);
	const runMatch = latestSession.match(/(\d{4}-\d{2}-\d{2})-(\d{2})-(\d{2})/);
	const runTime = runMatch ? `${runMatch[1]} ${runMatch[2]}:${runMatch[3]}` : 'Unknown';

	return {
		runTime,
		lastActivity: stat.mtimeMs ? new Date(stat.mtimeMs).toISOString() : null,
		recentActivity: activity.slice(-15).reverse(),
	};
}
