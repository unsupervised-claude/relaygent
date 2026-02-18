import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';
import { marked } from 'marked';
import { sanitizeHtml } from './sanitize.js';

// Resolve repo root from cwd (hub dir when started normally) or from source __dirname.
// __dirname inside the build resolves into build/server/chunks, so cwd is more reliable.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const HUB_DIR = path.resolve(process.cwd()).endsWith('hub')
	? process.cwd()
	: path.join(__dirname, '..', '..');
const KB_DIR = process.env.RELAYGENT_KB_DIR || path.join(HUB_DIR, '..', 'knowledge', 'topics');

/** Get the KB directory path (for use by other modules) */
export function getKbDir() { return KB_DIR; }
/** Validate a slug resolves within KB_DIR (prevent path traversal) */
function safeSlugPath(slug) {
	const filepath = path.join(KB_DIR, `${slug}.md`);
	const resolved = path.resolve(filepath);
	if (!resolved.startsWith(path.resolve(KB_DIR))) {
		throw new Error('Invalid slug');
	}
	return filepath;
}

/** Parse a markdown file with frontmatter */
function parseFile(filepath) {
	const raw = fs.readFileSync(filepath, 'utf-8');
	const { data, content } = matter(raw);
	for (const key of Object.keys(data)) {
		if (data[key] instanceof Date) data[key] = data[key].toISOString().split('T')[0];
	}
	return { meta: data, content };
}

/** Convert wiki-links [[topic]] and [[slug|display]] to HTML links */
function renderWikiLinks(html) {
	return html.replace(/\[\[([^\]]+)\]\]/g, (_, inner) => {
		const parts = inner.split('|');
		const slug = parts[0].toLowerCase().replace(/\s+/g, '-');
		const display = parts.length > 1 ? parts[1] : parts[0];
		return `<a href="/kb/${slug}" class="wiki-link">${display}</a>`;
	});
}

/** Recursively find all .md files under a directory */
function findMarkdownFiles(dir, base = dir) {
	let results = [];
	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			results = results.concat(findMarkdownFiles(full, base));
		} else if (entry.name.endsWith('.md')) {
			const rel = path.relative(base, full);
			results.push({ filepath: full, slug: rel.replace(/\.md$/, '') });
		}
	}
	return results;
}

/** Get all KB topics (metadata only) */
export function listTopics() {
	if (!fs.existsSync(KB_DIR)) return [];
	return findMarkdownFiles(KB_DIR)
		.map(({ filepath, slug }) => {
			try {
				const { meta } = parseFile(filepath);
				const mtime = fs.statSync(filepath).mtimeMs;
				return { slug, mtime, ...meta };
			} catch {
				return { slug, mtime: 0, title: slug };
			}
		})
		.sort((a, b) => {
			const dateA = a.updated || a.created || '';
			const dateB = b.updated || b.created || '';
			if (dateA !== dateB) return dateB.localeCompare(dateA);
			return b.mtime - a.mtime;
		});
}

/** Get a single KB topic with rendered HTML */
export function getTopic(slug) {
	const filepath = safeSlugPath(slug);
	if (!fs.existsSync(filepath)) return null;
	let meta, content;
	try {
		({ meta, content } = parseFile(filepath));
	} catch {
		return { slug, title: slug, html: '<p>Error: could not parse this topic file.</p>', backlinks: [] };
	}
	const html = sanitizeHtml(renderWikiLinks(marked(content)));
	const allFiles = findMarkdownFiles(KB_DIR).filter(({ slug: s }) => s !== slug);
	const backlinks = allFiles.filter(({ filepath: fp }) => {
		try {
			const raw = fs.readFileSync(fp, 'utf-8');
			return raw.includes(`[[${slug}]]`) || raw.includes(`[[${slug}|`) || raw.includes(`[[${meta.title}]]`);
		} catch { return false; }
	}).map(({ filepath: fp, slug: s }) => {
		try {
			const { meta: m } = parseFile(fp);
			return { slug: s, title: m.title || s };
		} catch {
			return { slug: s, title: s };
		}
	});
	return { slug, ...meta, html, backlinks };
}

/** Save a KB topic */
export function saveTopic(slug, frontmatter, content) {
	const filepath = safeSlugPath(slug);
	const fm = { ...frontmatter, updated: new Date().toISOString().split('T')[0] };
	const raw = matter.stringify(content, fm);
	fs.writeFileSync(filepath, raw);
}

/** Search KB topics */
export function searchTopics(query) {
	if (!query) return [];
	const q = query.toLowerCase();
	return listTopics().map(t => {
		const filepath = safeSlugPath(t.slug);
		let raw;
		try { raw = fs.readFileSync(filepath, 'utf-8'); } catch { return null; }
		const lower = raw.toLowerCase();
		const idx = lower.indexOf(q);
		if (idx === -1) return null;
		const contentStart = raw.indexOf('---', 3);
		const content = contentStart > -1 ? raw.slice(contentStart + 3) : raw;
		const cLower = content.toLowerCase();
		const cIdx = cLower.indexOf(q);
		let snippet = '';
		if (cIdx > -1) {
			const start = Math.max(0, cIdx - 60);
			const end = Math.min(content.length, cIdx + q.length + 60);
			snippet = (start > 0 ? '...' : '') + content.slice(start, end).replace(/\n/g, ' ').trim() + (end < content.length ? '...' : '');
		}
		return { ...t, type: 'topic', snippet };
	}).filter(Boolean);
}

