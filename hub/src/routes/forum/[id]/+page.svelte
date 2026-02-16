<script>
	import { marked } from 'marked';
	import { sanitizeHtml } from '$lib/sanitize.js';
	import { invalidateAll } from '$app/navigation';
	let { data } = $props();
	marked.setOptions({ breaks: true, gfm: true });
	function renderMarkdown(text) { return text ? sanitizeHtml(marked(text)) : ''; }
	const categoryColors = { discussion: '#6b7280', proposal: '#8b5cf6', question: '#f59e0b', idea: '#10b981' };

	let replyingTo = $state(null);
	let replyAuthor = $state('');
	let replyContent = $state('');
	let submitting = $state(false);
	let error = $state('');
	let justPosted = $state(false);

	function formatDate(iso) {
		return new Date(iso.endsWith('Z') ? iso : iso + 'Z').toLocaleString();
	}
	function flattenComments(comments, depth = 0) {
		let result = [];
		for (const c of comments) {
			result.push({ ...c, depth });
			if (c.replies?.length) result = result.concat(flattenComments(c.replies, depth + 1));
		}
		return result;
	}
	let flatComments = $derived(data.post ? flattenComments(data.post.comments || []) : []);
	let replyTarget = $derived(replyingTo ? flatComments.find(c => c.id === replyingTo) : null);

	function startReply(id = null) { replyingTo = id; replyContent = ''; error = ''; }
	function cancelReply() { replyingTo = null; replyContent = ''; error = ''; }
	async function submitReply() {
		if (!replyContent.trim() || !replyAuthor.trim()) { error = 'Author and content are required'; return; }
		submitting = true; error = '';
		try {
			const body = { author: replyAuthor.trim(), content: replyContent.trim() };
			if (replyingTo !== null) body.parent_id = replyingTo;
			const res = await fetch(`/api/forum/posts/${data.post.id}/comments`, {
				method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
			});
			if (!res.ok) { const err = await res.json(); throw new Error(err.detail || 'Failed to post comment'); }
			replyingTo = null; replyContent = '';
			justPosted = true;
			await invalidateAll();
			setTimeout(() => { justPosted = false; }, 2000);
		} catch (e) { error = e.message; } finally { submitting = false; }
	}
</script>

<svelte:head><title>{data.post?.title || 'Post'} - Forum</title></svelte:head>

<a href="/forum" class="back">&larr; Back to forum</a>

{#if data.error}
	<div class="error">{data.error}</div>
{:else if data.post}
	<article class="post">
		<div class="post-header">
			<span class="category" style="background: {categoryColors[data.post.category]}">{data.post.category}</span>
			{#if data.post.tags?.length}
				{#each data.post.tags as tag}<a href="/forum?tag={tag}" class="tag">#{tag}</a>{/each}
			{/if}
			<span class="score">{data.post.score} point{data.post.score !== 1 ? 's' : ''}</span>
			{#if data.post.citation_count > 0}
				<span class="citations">{data.post.citation_count} citation{data.post.citation_count !== 1 ? 's' : ''}</span>
			{/if}
		</div>
		<h1>{data.post.title}</h1>
		<div class="meta">
			<span class="author">{data.post.author}</span>
			<span class="time">{formatDate(data.post.created_at)}</span>
		</div>
		<div class="content markdown">{@html renderMarkdown(data.post.content)}</div>
	</article>

	<section class="comments">
		<h2>Comments ({flatComments.length}){#if justPosted}<span class="posted-flash">Posted!</span>{/if}</h2>
		{#if flatComments.length > 0}
			{#each flatComments as comment}
				<div class="comment" style="margin-left: {Math.min(comment.depth, 4) * 1.25}em">
					<div class="comment-meta">
						<span class="comment-author">{comment.author}</span>
						<span class="comment-time">{formatDate(comment.created_at)}</span>
						<span class="comment-score">{comment.score} pts</span>
						<button class="reply-btn" onclick={() => startReply(comment.id)}>Reply</button>
					</div>
					<div class="comment-content markdown">{@html renderMarkdown(comment.content)}</div>
				</div>
			{/each}
		{:else}
			<p class="no-comments">No comments yet. Be the first!</p>
		{/if}
		<div class="reply-form top-level">
			{#if replyTarget}
				<div class="reply-indicator">
					Replying to <strong>{replyTarget.author}</strong>
					<button class="cancel-reply" onclick={cancelReply}>&times;</button>
				</div>
			{/if}
			{#if error}<div class="form-error">{error}</div>{/if}
			<input type="text" bind:value={replyAuthor} placeholder="Your name" class="author-input" />
			<textarea bind:value={replyContent} placeholder={replyTarget ? 'Write your reply...' : 'Add a comment...'} rows="3"></textarea>
			<div class="form-actions">
				{#if replyTarget}<button onclick={cancelReply} disabled={submitting}>Cancel</button>{/if}
				<button onclick={submitReply} disabled={submitting || !replyContent.trim()} class="submit-btn">
					{submitting ? 'Posting...' : replyTarget ? 'Post Reply' : 'Post Comment'}
				</button>
			</div>
		</div>
	</section>
{/if}

<style>
	.back { display: inline-block; margin-bottom: 1em; color: var(--text-muted); font-size: 0.9em; }
	.error, .form-error { background: #fee2e2; color: #dc2626; border-radius: 6px; }
	.error { padding: 0.75em 1em; }
	.form-error { padding: 0.5em; border-radius: 4px; margin-bottom: 0.5em; font-size: 0.9em; }
	.post { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 8px; padding: 1.5em; margin-bottom: 1.5em; }
	.post-header { display: flex; flex-wrap: wrap; gap: 0.5em; align-items: center; margin-bottom: 0.5em; }
	.category { padding: 0.2em 0.6em; border-radius: 10px; color: white; font-size: 0.8em; }
	.tag { color: var(--link); font-size: 0.85em; }
	.tag:hover { text-decoration: underline; }
	.score { color: var(--text-muted); font-size: 0.9em; }
	.citations { color: #059669; font-weight: 500; font-size: 0.9em; }
	h1 { margin: 0.25em 0; font-size: 1.5em; }
	.meta { display: flex; gap: 1em; color: var(--text-muted); font-size: 0.9em; margin-bottom: 1em; }
	.content { line-height: 1.7; }
	.markdown :global(p) { margin: 0.5em 0; }
	.markdown :global(p:first-child) { margin-top: 0; }
	.markdown :global(p:last-child) { margin-bottom: 0; }
	.markdown :global(h2), .markdown :global(h3) { margin: 1em 0 0.5em; font-weight: 600; }
	.markdown :global(h2) { font-size: 1.2em; }
	.markdown :global(h3) { font-size: 1.1em; }
	.markdown :global(ul), .markdown :global(ol) { margin: 0.5em 0; padding-left: 1.5em; }
	.markdown :global(li) { margin: 0.25em 0; }
	.markdown :global(code) { background: var(--code-bg); padding: 0.15em 0.3em; border-radius: 3px; font-size: 0.9em; }
	.markdown :global(pre) { background: #1f2937; color: #e5e7eb; padding: 1em; border-radius: 6px; overflow-x: auto; margin: 0.75em 0; }
	.markdown :global(pre code) { background: none; padding: 0; color: inherit; }
	.markdown :global(blockquote) { border-left: 3px solid var(--border); margin: 0.5em 0; padding-left: 1em; color: var(--text-muted); }
	.markdown :global(a) { color: var(--link); }
	.markdown :global(a:hover) { text-decoration: underline; }
	.markdown :global(strong) { font-weight: 600; }
	.markdown :global(hr) { border: none; border-top: 1px solid var(--border); margin: 1em 0; }
	.comments h2 { font-size: 1.1em; margin-bottom: 1em; display: flex; align-items: center; gap: 0.75em; }
	.posted-flash { font-size: 0.8em; color: #059669; font-weight: 500; animation: flashFade 2s ease-out forwards; }
	@keyframes flashFade { 0% { opacity: 1; } 70% { opacity: 1; } 100% { opacity: 0; } }
	.comment { background: var(--bg-surface); border: 1px solid var(--border); border-radius: 6px; padding: 0.75em 1em; margin-bottom: 0.5em; }
	.comment-meta { display: flex; flex-wrap: wrap; gap: 0.5em; font-size: 0.85em; color: var(--text-muted); margin-bottom: 0.4em; }
	.comment-author { font-weight: 500; color: var(--text); }
	.comment-content { line-height: 1.5; }
	.no-comments { color: var(--text-muted); font-style: italic; }
	.reply-btn { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 0.85em; padding: 0; }
	.reply-btn:hover { color: var(--link); text-decoration: underline; }
	.reply-form { margin-top: 0.75em; padding: 0.75em; background: var(--code-bg); border-radius: 6px; border: 1px solid var(--border); }
	.reply-form.top-level { margin-top: 1.5em; }
	.reply-indicator { display: flex; align-items: center; gap: 0.5em; font-size: 0.85em; color: var(--text-muted); margin-bottom: 0.5em; padding: 0.4em 0.6em; background: var(--bg-surface); border-radius: 4px; border-left: 3px solid var(--link); }
	.cancel-reply { background: none; border: none; color: var(--text-muted); cursor: pointer; font-size: 1.1em; padding: 0 0.25em; margin-left: auto; }
	.cancel-reply:hover { color: var(--text); }
	.author-input { max-width: 200px; width: 100%; padding: 0.4em 0.6em; border: 1px solid var(--border); border-radius: 4px; margin-bottom: 0.5em; font-size: 0.9em; background: var(--bg-surface); color: var(--text); box-sizing: border-box; }
	.reply-form textarea { width: 100%; padding: 0.5em; border: 1px solid var(--border); border-radius: 4px; font-family: inherit; font-size: 0.95em; resize: vertical; box-sizing: border-box; background: var(--bg-surface); color: var(--text); }
	.form-actions { display: flex; gap: 0.5em; margin-top: 0.5em; justify-content: flex-end; }
	.form-actions button { padding: 0.4em 0.8em; border-radius: 4px; border: 1px solid var(--border); background: var(--bg-surface); color: var(--text); cursor: pointer; font-size: 0.9em; }
	.form-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
	.submit-btn { background: var(--link) !important; color: white !important; border-color: var(--link) !important; }
	.submit-btn:hover:not(:disabled) { opacity: 0.9; }
	@media (max-width: 600px) {
		.post { padding: 1em; }
		h1 { font-size: 1.25em; }
		.comment { margin-left: 0 !important; border-left: 3px solid var(--border); }
		.post-header { gap: 0.4em; }
	}
</style>
