import { createServer } from 'http';
import { handler } from './build/handler.js';
import { WebSocketServer } from 'ws';
import fs from 'fs';
import path from 'path';
import { summarizeInput, summarizeResult, extractResultText, findLatestSession } from './src/lib/relayActivity.js';

const server = createServer(handler);

// Two WebSocket endpoints: relay activity + chat
const relayWss = new WebSocketServer({ noServer: true });
const chatWss = new WebSocketServer({ noServer: true });

server.on('upgrade', (req, socket, head) => {
	if (req.url === '/ws/relay') {
		relayWss.handleUpgrade(req, socket, head, ws => relayWss.emit('connection', ws));
	} else if (req.url === '/ws/chat') {
		chatWss.handleUpgrade(req, socket, head, ws => chatWss.emit('connection', ws));
	} else {
		socket.destroy();
	}
});

const pendingTools = new Map();

function parseSessionLine(line) {
	try {
		const entry = JSON.parse(line);
		if (entry.type === 'assistant' && entry.message?.content) {
			const items = Array.isArray(entry.message.content) ? entry.message.content : [entry.message.content];
			const activities = [];
			for (const item of items) {
				if (item?.type === 'tool_use') {
					const activity = {
						type: 'tool', name: item.name, time: entry.timestamp,
						input: summarizeInput(item.name, item.input),
						params: item.input || {},
						result: '',
						toolUseId: item.id,
					};
					pendingTools.set(item.id, activity);
					activities.push(activity);
				} else if (item?.type === 'text' && item.text?.length > 10) {
					activities.push({ type: 'text', time: entry.timestamp, text: item.text });
				}
			}
			return activities;
		}
		if (entry.type === 'user' && entry.message?.content) {
			const items = Array.isArray(entry.message.content) ? entry.message.content : [entry.message.content];
			for (const item of items) {
				if (item?.type === 'tool_result' && item.tool_use_id && pendingTools.has(item.tool_use_id)) {
					const result = summarizeResult(item.content);
					const fullResult = extractResultText(item.content);
					if (result || fullResult) {
						broadcastRelay({ type: 'result', toolUseId: item.tool_use_id, result, fullResult });
					}
					pendingTools.delete(item.tool_use_id);
				}
			}
		}
	} catch { /* ignore */ }
	return [];
}

let watchedFile = null, fileWatcher = null, lastSize = 0, incompleteLine = '';

function startWatching() {
	const sessionFile = findLatestSession();
	if (!sessionFile) return;
	if (watchedFile === sessionFile && fileWatcher) return;
	if (fileWatcher) fileWatcher.close();

	watchedFile = sessionFile;
	lastSize = fs.statSync(sessionFile).size;
	pendingTools.clear();
	incompleteLine = '';

	fileWatcher = fs.watch(sessionFile, (eventType) => {
		if (eventType !== 'change') return;
		try {
			const stat = fs.statSync(sessionFile);
			if (stat.size <= lastSize) return;
			const fd = fs.openSync(sessionFile, 'r');
			const buffer = Buffer.alloc(stat.size - lastSize);
			fs.readSync(fd, buffer, 0, buffer.length, lastSize);
			fs.closeSync(fd);
			lastSize = stat.size;

			const chunk = incompleteLine + buffer.toString('utf-8');
			const lines = chunk.split('\n');
			// Last element may be incomplete if chunk didn't end with newline
			incompleteLine = chunk.endsWith('\n') ? '' : lines.pop();
			for (const line of lines.filter(l => l.trim())) {
				for (const activity of parseSessionLine(line)) {
					broadcastRelay({ type: 'activity', data: activity });
				}
			}
			try {
				const pct = parseInt(fs.readFileSync('/tmp/relaygent-context-pct', 'utf-8').trim(), 10);
				if (!isNaN(pct)) broadcastRelay({ type: 'context', pct });
			} catch { /* no context file */ }
		} catch { /* ignore */ }
	});
	console.log(`Watching: ${sessionFile}`);
}

function broadcastRelay(message) {
	const data = JSON.stringify(message);
	relayWss.clients.forEach(c => { if (c.readyState === 1) c.send(data); });
}

// --- Chat WebSocket: watch trigger file for new messages ---
const CHAT_TRIGGER = '/tmp/hub-chat-new.json';

function broadcastChat(message) {
	const data = JSON.stringify(message);
	chatWss.clients.forEach(c => { if (c.readyState === 1) c.send(data); });
}

let chatWatcher = null;
function startChatWatcher() {
	if (chatWatcher) return;
	if (!fs.existsSync(CHAT_TRIGGER)) fs.writeFileSync(CHAT_TRIGGER, '{}');
	chatWatcher = fs.watch(CHAT_TRIGGER, () => {
		try {
			const raw = fs.readFileSync(CHAT_TRIGGER, 'utf-8').trim();
			if (!raw || raw === '{}') return;
			const msg = JSON.parse(raw);
			if (msg.id) broadcastChat({ type: 'message', data: msg });
		} catch { /* ignore */ }
	});
}

setInterval(() => {
	const current = findLatestSession();
	if (current && current !== watchedFile) {
		startWatching();
		// Notify clients that a session was found (triggers page data reload)
		broadcastRelay({ type: 'session', status: 'found', file: current });
	}
}, 3000);

relayWss.on('connection', (ws) => {
	startWatching();
	// Tell the client whether we have a session or not
	const session = findLatestSession();
	ws.send(JSON.stringify({ type: 'session', status: session ? 'found' : 'waiting' }));
});
chatWss.on('connection', () => { startChatWatcher(); });

server.listen(parseInt(process.env.PORT || '8080', 10));
console.log(`Relaygent Hub running on port ${process.env.PORT || 8080}`);
