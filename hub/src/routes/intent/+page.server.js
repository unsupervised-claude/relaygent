import { error } from '@sveltejs/kit';
import { getKbDir } from '$lib/kb.js';
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';
import { marked } from 'marked';
import { sanitizeHtml } from '$lib/sanitize.js';

const INTENT_PATH = path.join(getKbDir(), 'intent.md');

export function load() {
	if (!fs.existsSync(INTENT_PATH)) throw error(404, 'Intent file not found');
	const raw = fs.readFileSync(INTENT_PATH, 'utf-8');
	const { data: frontmatter, content } = matter(raw);
	const html = sanitizeHtml(marked(content));
	return {
		title: frontmatter.title || 'Intent',
		updated: frontmatter.updated || null,
		html,
		rawContent: content
	};
}

export const actions = {
	save: async ({ request }) => {
		if (!fs.existsSync(INTENT_PATH)) throw error(404, 'Intent file not found');
		const formData = await request.formData();
		const content = formData.get('content');

		const raw = fs.readFileSync(INTENT_PATH, 'utf-8');
		const { data: frontmatter } = matter(raw);
		frontmatter.updated = new Date().toISOString().split('T')[0];
		const output = matter.stringify(content, frontmatter);
		fs.writeFileSync(INTENT_PATH, output);

		return { success: true };
	}
};
