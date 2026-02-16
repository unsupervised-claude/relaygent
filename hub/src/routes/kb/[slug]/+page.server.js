import { getTopic, saveTopic, getKbDir } from '$lib/kb.js';
import { error } from '@sveltejs/kit';
import fs from 'fs';
import path from 'path';
import matter from 'gray-matter';

const KB_DIR = getKbDir();

function validateSlug(slug) {
	const filepath = path.join(KB_DIR, `${slug}.md`);
	const resolved = path.resolve(filepath);
	if (!resolved.startsWith(path.resolve(KB_DIR))) {
		throw error(400, 'Invalid slug');
	}
	return filepath;
}

export function load({ params }) {
	const filepath = validateSlug(params.slug);
	const topic = getTopic(params.slug);
	if (!topic) throw error(404, 'Topic not found');

	// Also load raw content for editing
	const raw = fs.readFileSync(filepath, 'utf-8');
	const { content } = matter(raw);

	return { topic, rawContent: content };
}

export const actions = {
	save: async ({ params, request }) => {
		const filepath = validateSlug(params.slug);
		const formData = await request.formData();
		const content = formData.get('content');
		const title = formData.get('title');

		const raw = fs.readFileSync(filepath, 'utf-8');
		const { data: frontmatter } = matter(raw);

		if (title) frontmatter.title = title;
		saveTopic(params.slug, frontmatter, content);

		return { success: true };
	}
};
