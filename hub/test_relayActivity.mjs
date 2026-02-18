/**
 * Tests for hub relayActivity utility functions.
 * Run: node --test hub/test_relayActivity.mjs
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeInput, extractResultText, summarizeResult } from './src/lib/relayActivity.js';

describe('summarizeInput', () => {
	it('summarizes Bash commands', () => {
		assert.equal(summarizeInput('Bash', { command: 'git status' }), 'git status');
	});

	it('truncates long Bash commands', () => {
		const long = 'x'.repeat(200);
		assert.equal(summarizeInput('Bash', { command: long }).length, 120);
	});

	it('summarizes Read with tilde replacement', () => {
		const home = process.env.HOME;
		assert.equal(summarizeInput('Read', { file_path: `${home}/foo.txt` }), '~/foo.txt');
	});

	it('summarizes Edit files', () => {
		const home = process.env.HOME;
		assert.equal(summarizeInput('Edit', { file_path: `${home}/bar.py` }), '~/bar.py');
	});

	it('summarizes Write files', () => {
		const home = process.env.HOME;
		assert.equal(summarizeInput('Write', { file_path: `${home}/out.js` }), '~/out.js');
	});

	it('summarizes Grep with pattern and path', () => {
		assert.equal(summarizeInput('Grep', { pattern: 'TODO', path: '/a/b/src' }), '/TODO/ in src');
	});

	it('summarizes Grep pattern only', () => {
		assert.equal(summarizeInput('Grep', { pattern: 'error' }), '/error/');
	});

	it('summarizes Glob', () => {
		assert.equal(summarizeInput('Glob', { pattern: '**/*.py' }), '**/*.py');
	});

	it('summarizes TodoWrite with in-progress task', () => {
		const todos = [
			{ content: 'Done', status: 'completed' },
			{ content: 'Working on X', status: 'in_progress' },
		];
		assert.equal(summarizeInput('TodoWrite', { todos }), 'Working on X');
	});

	it('summarizes WebFetch', () => {
		assert.equal(
			summarizeInput('WebFetch', { url: 'https://example.com/page' }),
			'example.com/page',
		);
	});

	it('summarizes WebSearch', () => {
		assert.equal(summarizeInput('WebSearch', { query: 'relaygent' }), 'relaygent');
	});

	it('summarizes Task', () => {
		assert.equal(summarizeInput('Task', { description: 'Run tests' }), 'Run tests');
	});

	it('summarizes wake-triggers MCP tools', () => {
		assert.equal(
			summarizeInput('mcp__wake-triggers__set_reminder', { message: 'Check later' }),
			'Check later',
		);
	});

	it('summarizes generic MCP tools', () => {
		assert.equal(
			summarizeInput('mcp__slack__slack_send', { channel: 'C123', text: 'hello' }),
			'C123',
		);
	});

	it('returns empty for null input', () => {
		assert.equal(summarizeInput('Bash', null), '');
	});

	it('returns empty for unknown tool without MCP prefix', () => {
		assert.equal(summarizeInput('UnknownTool', { foo: 'bar' }), '');
	});
});

describe('extractResultText', () => {
	it('handles null', () => {
		assert.equal(extractResultText(null), '');
	});

	it('handles plain string', () => {
		assert.equal(extractResultText('hello world'), 'hello world');
	});

	it('strips line number prefixes', () => {
		assert.equal(extractResultText('  1→foo\n  2→bar'), 'foo\nbar');
	});

	it('handles content array with text items', () => {
		const content = [
			{ type: 'text', text: 'line1' },
			{ type: 'text', text: 'line2' },
		];
		assert.equal(extractResultText(content), 'line1\nline2');
	});

	it('handles content array with image', () => {
		const content = [
			{ type: 'text', text: 'caption' },
			{ type: 'image', source: {} },
		];
		assert.equal(extractResultText(content), 'caption\n[image]');
	});

	it('handles image-only content', () => {
		const content = [{ type: 'image', source: {} }];
		assert.equal(extractResultText(content), '[image]');
	});

	it('handles empty array', () => {
		assert.equal(extractResultText([]), '');
	});
});

describe('summarizeResult', () => {
	it('returns short results as-is', () => {
		assert.equal(summarizeResult('short'), 'short');
	});

	it('truncates long results with ellipsis', () => {
		const long = 'x'.repeat(100);
		const result = summarizeResult(long);
		assert.equal(result.length, 81);
		assert.ok(result.endsWith('…'));
	});

	it('handles null content', () => {
		assert.equal(summarizeResult(null), '');
	});

	it('handles array content', () => {
		const content = [{ type: 'text', text: 'ok' }];
		assert.equal(summarizeResult(content), 'ok');
	});
});
