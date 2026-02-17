/**
 * Tests for secrets vault — auto-generated master key, encrypt/decrypt round-trip.
 * Run: node --test secrets/test_vault.mjs
 */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, rmSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Use isolated temp dir so tests don't touch ~/.relaygent
const TEST_DIR = join(tmpdir(), `relaygent-vault-test-${process.pid}`);
process.env.HOME = TEST_DIR;

const { vaultExists, createVault, getSecret, setSecret, listSecrets, deleteSecret } =
	await import('./vault.mjs');

const RELAYGENT_DIR = join(TEST_DIR, '.relaygent');

describe('vault', () => {
	before(() => mkdirSync(TEST_DIR, { recursive: true }));
	after(() => rmSync(TEST_DIR, { recursive: true, force: true }));

	it('vault does not exist before creation', () => {
		assert.equal(vaultExists(), false);
	});

	it('createVault creates secrets file and master key', () => {
		createVault();
		assert.equal(vaultExists(), true);
		assert.equal(existsSync(join(RELAYGENT_DIR, 'master.key')), true);
	});

	it('createVault is idempotent', () => {
		createVault();
		assert.equal(vaultExists(), true);
	});

	it('setSecret and getSecret round-trip', () => {
		setSecret('test-key', 'hello world');
		assert.equal(getSecret('test-key'), 'hello world');
	});

	it('secrets are encrypted on disk', () => {
		const raw = readFileSync(join(RELAYGENT_DIR, 'secrets.json'), 'utf-8');
		const parsed = JSON.parse(raw);
		assert.notEqual(parsed['test-key'], 'hello world');
		assert.match(parsed['test-key'], /^[0-9a-f]{58,}$/i);
	});

	it('listSecrets returns stored key names', () => {
		setSecret('another', 'value');
		const keys = listSecrets();
		assert.ok(keys.includes('test-key'));
		assert.ok(keys.includes('another'));
	});

	it('deleteSecret removes a key', () => {
		deleteSecret('another');
		assert.equal(getSecret('another'), null);
		assert.equal(listSecrets().includes('another'), false);
	});

	it('getSecret returns null for missing key', () => {
		assert.equal(getSecret('nonexistent'), null);
	});

	it('special characters in values round-trip', () => {
		const val = 'p@$$w0rd!#%&*()[]{}';
		setSecret('special', val);
		assert.equal(getSecret('special'), val);
	});

	it('unicode values round-trip', () => {
		const val = 'héllo wörld 🔑';
		setSecret('unicode', val);
		assert.equal(getSecret('unicode'), val);
	});
});
