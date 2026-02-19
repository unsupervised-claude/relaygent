#!/usr/bin/env node
/**
 * Relaygent interactive setup TUI.
 * Walks a new user through configuration and first launch.
 */
import { createInterface } from 'readline';
import { execSync, spawnSync } from 'child_process';
import { mkdirSync, writeFileSync, readFileSync, copyFileSync, existsSync, chmodSync, appendFileSync } from 'fs';
import { join, resolve } from 'path';
import { homedir } from 'os';
import { setupHammerspoon, setupHooks, setupSecrets, envFromConfig } from './setup-helpers.mjs';

const REPO_DIR = process.argv[2] || resolve('.');
const HOME = homedir();
const CONFIG_DIR = join(HOME, '.relaygent');
const CONFIG_FILE = join(CONFIG_DIR, 'config.json');
const KB_DIR = join(REPO_DIR, 'knowledge', 'topics');
const LOGS_DIR = join(REPO_DIR, 'logs');
const DATA_DIR = join(REPO_DIR, 'data');

const C = { reset: '\x1b[0m', bold: '\x1b[1m', dim: '\x1b[2m', cyan: '\x1b[36m', green: '\x1b[32m', yellow: '\x1b[33m', red: '\x1b[31m' };

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise(r => rl.question(q, r));

async function main() {
	// Step 0: Claude Code — must be installed and authenticated before anything else
	if (spawnSync('claude', ['--version'], { stdio: 'pipe' }).status !== 0) {
		console.log(`${C.red}Claude Code required. Install: ${C.bold}npm install -g @anthropic-ai/claude-code${C.reset}`);
		console.log(`Then run ${C.bold}claude${C.reset} to log in, then ${C.bold}./setup.sh${C.reset} again.`);
		process.exit(1);
	}
	const claudeVer = spawnSync('claude', ['--version'], { stdio: 'pipe' });
	console.log(`${C.green}Claude Code found: ${claudeVer.stdout.toString().trim()}${C.reset}`);

	// Check authentication
	if (spawnSync('claude', ['-p', 'hi'], { stdio: 'pipe', timeout: 15000 }).status !== 0) {
		console.log(`${C.red}Claude Code not logged in. Run ${C.bold}claude${C.reset}${C.red} first.${C.reset}`);
		process.exit(1);
	}
	console.log(`${C.green}Claude Code authenticated.${C.reset}\n`);

	console.log(`Sets up a persistent AI agent with a web dashboard.\n`);

	const agentName = 'relaygent';
	const hubPort = 8080;

	// Write config
	console.log(`${C.yellow}Setting up directories...${C.reset}`);
	mkdirSync(CONFIG_DIR, { recursive: true });
	mkdirSync(KB_DIR, { recursive: true });
	mkdirSync(LOGS_DIR, { recursive: true });
	mkdirSync(DATA_DIR, { recursive: true });

	const config = {
		agent: { name: agentName },
		hub: { port: hubPort },
		services: {
			notifications: { port: hubPort + 3 },
			hammerspoon: { port: hubPort + 17 },
		},
		paths: { repo: REPO_DIR, kb: KB_DIR, logs: LOGS_DIR, data: DATA_DIR },
		created: new Date().toISOString(),
	};
	writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
	console.log(`  Config: ${CONFIG_FILE}`);

	// Copy KB templates
	const templatesDir = join(REPO_DIR, 'templates');
	const today = new Date().toISOString().split('T')[0];
	for (const f of ['handoff.md', 'working-state.md', 'intent.md', 'tasks.md', 'curiosities.md', 'dead-ends.md']) {
		const dest = join(KB_DIR, f);
		if (!existsSync(dest)) {
			let content = readFileSync(join(templatesDir, f), 'utf-8');
			content = content.replace(/YYYY-MM-DD/g, today);
			writeFileSync(dest, content);
		}
	}
	const kbRoot = join(REPO_DIR, 'knowledge');
	const commitSh = join(kbRoot, 'commit.sh');
	if (!existsSync(commitSh)) {
		copyFileSync(join(templatesDir, 'commit.sh'), commitSh);
		chmodSync(commitSh, 0o755);
	}
	console.log(`  KB templates: ${KB_DIR}`);

	// Init git for KB (use spawnSync to avoid shell injection from user input)
	if (!existsSync(join(kbRoot, '.git'))) {
		const gitOpts = { cwd: kbRoot, stdio: 'pipe' };
		spawnSync('git', ['init'], gitOpts);
		spawnSync('git', ['config', 'user.name', agentName], gitOpts);
		spawnSync('git', ['config', 'user.email', `${agentName}@localhost`], gitOpts);
		spawnSync('git', ['add', '-A'], gitOpts);
		spawnSync('git', ['commit', '-m', 'Initial KB'], gitOpts);
		console.log(`  KB git: initialized`);
	}

	// Set up pre-commit hook for 200-line enforcement
	try {
		execSync('git config core.hooksPath scripts', { cwd: REPO_DIR, stdio: 'pipe' });
		console.log(`  Git hooks: ${C.green}200-line pre-commit enabled${C.reset}`);
	} catch { /* not a git repo yet, skip */ }

	// Install Node.js dependencies
	for (const sub of ['hub', 'notifications', 'computer-use', 'email', 'slack', 'secrets']) {
		console.log(`  Installing ${sub} dependencies...`);
		execSync('npm install', { cwd: join(REPO_DIR, sub), stdio: 'pipe' });
		console.log(`  ${sub}: ${C.green}deps installed${C.reset}`);
	}
	// Install Python dependencies (notifications Flask server)
	for (const sub of ['notifications']) {
		const dir = join(REPO_DIR, sub);
		const venv = join(dir, '.venv');
		console.log(`  Setting up ${sub} Python venv...`);
		try {
			execSync(`python3 -m venv "${venv}" && "${venv}/bin/pip" install -q -r requirements.txt`,
				{ cwd: dir, stdio: 'pipe' });
			console.log(`  ${sub}: ${C.green}venv ready${C.reset}`);
		} catch {
			console.log(`  ${sub}: ${C.red}venv failed${C.reset}. Debian/Ubuntu: sudo apt install python3-venv`);
			console.log(`  ${C.red}Cannot continue without ${sub}. Fix the error above and re-run setup.${C.reset}`);
			rl.close();
			process.exit(1);
		}
	}
	console.log(`  Building hub...`);
	execSync('npm run build', { cwd: join(REPO_DIR, 'hub'), stdio: 'pipe' });
	console.log(`  Hub: ${C.green}built${C.reset}`);

	// Create secrets file and store credentials
	await setupSecrets(REPO_DIR, C);

	// Set up Hammerspoon (computer-use)
	await setupHammerspoon(config, REPO_DIR, HOME, C, ask);

	// Set up Claude CLI hooks + MCP servers
	setupHooks(config, REPO_DIR, HOME, C);

	// Symlink CLI into PATH (or add to shell rc as fallback)
	const cliSrc = join(REPO_DIR, 'bin', 'relaygent');
	const cliDst = '/usr/local/bin/relaygent';
	let cliOk = false;
	try {
		execSync(`ln -sf "${cliSrc}" "${cliDst}"`, { stdio: 'pipe' });
		console.log(`  CLI: ${C.green}relaygent${C.reset} command available`);
		cliOk = true;
	} catch { /* no write access to /usr/local/bin */ }
	if (!cliOk) {
		const binDir = join(REPO_DIR, 'bin');
		const rcFile = join(HOME, process.env.SHELL?.includes('zsh') ? '.zshrc' : '.bashrc');
		const pathLine = `export PATH="${binDir}:$PATH"  # relaygent`;
		try {
			const rc = existsSync(rcFile) ? readFileSync(rcFile, 'utf-8') : '';
			if (!rc.includes(binDir)) {
				appendFileSync(rcFile, `\n${pathLine}\n`);
				console.log(`  CLI: added ${binDir} to PATH in ${rcFile}`);
				console.log(`  ${C.yellow}Restart your shell or run: source ${rcFile}${C.reset}`);
			}
		} catch {
			console.log(`  CLI: add ${binDir} to your PATH manually`);
		}
	}

	console.log(`\n${C.green}Setup complete!${C.reset} Dashboard: http://localhost:${hubPort}/`);
	console.log(`  ${C.bold}relaygent start${C.reset} / ${C.bold}stop${C.reset} / ${C.bold}status${C.reset} / ${C.bold}restart${C.reset}\n`);

	const launch = (await ask(`${C.cyan}Launch now? [Y/n]:${C.reset} `)).trim().toLowerCase();
	if (launch !== 'n') {
		console.log(`\nStarting Relaygent...\n`);
		spawnSync(join(REPO_DIR, 'bin', 'relaygent'), ['start'],
			{ stdio: 'inherit', env: { ...process.env, ...envFromConfig(config) } });
	}

	rl.close();
}

main().catch(e => { console.error(`${C.red}Setup failed: ${e.message}${C.reset}`); process.exit(1); });
