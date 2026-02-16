// Setup helper functions extracted from setup.mjs to stay under 200 lines
import { spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, copyFileSync } from 'fs';
import { join } from 'path';

export function setupHammerspoon(config, REPO_DIR, HOME, C, ask) {
	if (process.platform !== 'darwin') {
		console.log(`  Computer-use: ${C.yellow}Linux detected${C.reset} — uses python linux-server.py (started automatically)`);
		console.log(`  ${C.dim}Debian/Ubuntu: sudo apt install xdotool scrot wmctrl imagemagick${C.reset}`);
		return;
	}
	const hsDir = join(HOME, '.hammerspoon');
	const srcDir = join(REPO_DIR, 'hammerspoon');
	mkdirSync(hsDir, { recursive: true });
	for (const f of ['init.lua', 'input_handlers.lua', 'ax_handler.lua', 'ax_press.lua']) {
		copyFileSync(join(srcDir, f), join(hsDir, f));
	}
	console.log(`  Hammerspoon: lua files installed to ${hsDir}`);

	const hs = spawnSync('open', ['-Ra', 'Hammerspoon'], { stdio: 'pipe' });
	if (hs.status === 0) {
		console.log(`  Hammerspoon: ${C.green}found${C.reset}`);
		showPermissionGuide(C);
		return;
	}
	// Not installed — try to install via brew
	const brew = spawnSync('which', ['brew'], { stdio: 'pipe' });
	if (brew.status !== 0) {
		console.log(`  ${C.yellow}Hammerspoon not installed and Homebrew not found.${C.reset}`);
		console.log(`  ${C.yellow}Install manually: https://www.hammerspoon.org/${C.reset}`);
		showPermissionGuide(C);
		return;
	}
	console.log(`  ${C.yellow}Hammerspoon not installed. Computer-use (screenshot, click, type) requires it.${C.reset}`);
	return installHammerspoon(C, ask);
}

async function installHammerspoon(C, ask) {
	const answer = (await ask(`  ${C.cyan}Install Hammerspoon now? [Y/n]:${C.reset} `)).trim().toLowerCase();
	if (answer === 'n') {
		console.log(`  ${C.dim}Skipped. Install later: brew install --cask hammerspoon${C.reset}`);
		return;
	}
	console.log(`  Installing Hammerspoon...`);
	const res = spawnSync('brew', ['install', '--cask', 'hammerspoon'], { stdio: 'inherit' });
	if (res.status === 0) {
		console.log(`  Hammerspoon: ${C.green}installed${C.reset}`);
		console.log(`  Launching Hammerspoon...`);
		spawnSync('open', ['-a', 'Hammerspoon'], { stdio: 'pipe' });
	} else {
		console.log(`  ${C.red}Install failed. Try manually: brew install --cask hammerspoon${C.reset}`);
	}
	showPermissionGuide(C);
}

function showPermissionGuide(C) {
	console.log('');
	console.log(`  ${C.yellow}┌─ Hammerspoon Permissions ────────────────────────────────────┐${C.reset}`);
	console.log(`  ${C.yellow}│${C.reset}  Hammerspoon is how your agent interacts with the screen.    ${C.yellow}│${C.reset}`);
	console.log(`  ${C.yellow}│${C.reset}  It needs two macOS permissions to take screenshots,         ${C.yellow}│${C.reset}`);
	console.log(`  ${C.yellow}│${C.reset}  click buttons, and type text on your behalf.                ${C.yellow}│${C.reset}`);
	console.log(`  ${C.yellow}│${C.reset}                                                              ${C.yellow}│${C.reset}`);
	console.log(`  ${C.yellow}│${C.reset}  Go to ${C.bold}System Settings > Privacy & Security${C.reset} and grant:       ${C.yellow}│${C.reset}`);
	console.log(`  ${C.yellow}│${C.reset}    1. ${C.bold}Accessibility${C.reset} — lets the agent click and type          ${C.yellow}│${C.reset}`);
	console.log(`  ${C.yellow}│${C.reset}    2. ${C.bold}Screen Recording${C.reset} — lets the agent see your screen      ${C.yellow}│${C.reset}`);
	console.log(`  ${C.yellow}│${C.reset}                                                              ${C.yellow}│${C.reset}`);
	console.log(`  ${C.yellow}│${C.reset}  Without these, computer-use tools won't work.               ${C.yellow}│${C.reset}`);
	console.log(`  ${C.yellow}└──────────────────────────────────────────────────────────────┘${C.reset}`);
	console.log('');
}

export function setupHooks(config, REPO_DIR, HOME, C) {
	const hooksDir = join(REPO_DIR, 'hooks');
	const checkNotif = join(hooksDir, 'check-notifications');
	const projectHash = REPO_DIR.replace(/\//g, '-');
	const settingsDir = join(HOME, '.claude', 'projects', projectHash);
	mkdirSync(settingsDir, { recursive: true });
	const settings = {
		hooks: {
			PostToolUse: [{
				matcher: "*",
				hooks: [{ type: "command", command: checkNotif }],
			}],
		},
	};
	writeFileSync(join(settingsDir, 'settings.json'), JSON.stringify(settings, null, 2));
	writeFileSync(join(REPO_DIR, 'harness', 'settings.json'), JSON.stringify(settings, null, 2));
	console.log(`  Hooks: configured`);

	const claudeJson = join(HOME, '.claude.json');
	let claudeConfig = {};
	try { claudeConfig = JSON.parse(readFileSync(claudeJson, 'utf-8')); } catch { /* new file */ }
	if (!claudeConfig.mcpServers) claudeConfig.mcpServers = {};
	claudeConfig.mcpServers['hub-chat'] = {
		command: 'node',
		args: [join(REPO_DIR, 'hub', 'mcp-chat.mjs')],
		env: { HUB_PORT: String(config.hub.port) },
	};
	claudeConfig.mcpServers['relaygent-notifications'] = {
		command: 'node',
		args: [join(REPO_DIR, 'notifications', 'mcp-server.mjs')],
		env: { RELAYGENT_NOTIFICATIONS_PORT: String(config.services.notifications.port) },
	};
	claudeConfig.mcpServers['computer-use'] = {
		command: 'node',
		args: [join(REPO_DIR, 'computer-use', 'mcp-server.mjs')],
		env: { HAMMERSPOON_PORT: String(config.services?.hammerspoon?.port || 8097) },
	};
	writeFileSync(claudeJson, JSON.stringify(claudeConfig, null, 2));
	console.log(`  MCP: hub-chat + notifications + computer-use registered`);
}

export function envFromConfig(config) {
	return {
		RELAYGENT_HUB_PORT: String(config.hub.port),
		RELAYGENT_DATA_DIR: config.paths.data,
		RELAYGENT_KB_DIR: config.paths.kb,
	};
}
