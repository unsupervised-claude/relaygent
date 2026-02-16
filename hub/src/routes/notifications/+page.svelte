<script>
	let { data } = $props();
	let reminders = $state(data.reminders || []);
	let error = $state(data.error);
	let newMessage = $state('');
	let newTime = $state('');
	let creating = $state(false);

	function formatTime(iso) {
		try {
			const d = new Date(iso);
			return d.toLocaleString(undefined, {
				month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'
			});
		} catch { return iso; }
	}

	function isPast(iso) {
		try { return new Date(iso) <= new Date(); } catch { return false; }
	}

	async function refresh() {
		try {
			const res = await fetch('/api/notifications');
			const json = await res.json();
			reminders = json.reminders || [];
			error = json.error || null;
		} catch (e) { error = e.message; }
	}

	async function create() {
		if (!newMessage.trim() || !newTime) return;
		creating = true;
		try {
			const triggerTime = new Date(newTime).toISOString();
			const res = await fetch('/api/notifications', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ trigger_time: triggerTime, message: newMessage.trim() })
			});
			if (res.ok) {
				newMessage = '';
				newTime = '';
				await refresh();
			}
		} catch (e) { error = e.message; }
		creating = false;
	}

	async function cancel(id) {
		try {
			await fetch(`/api/notifications?id=${id}`, { method: 'DELETE' });
			await refresh();
		} catch (e) { error = e.message; }
	}
</script>

<svelte:head><title>Notifications</title></svelte:head>

<h1>Notifications</h1>

{#if error}
	<p class="error">{error}</p>
{/if}

<div class="create-form">
	<h2>New Reminder</h2>
	<div class="form-row">
		<input type="text" bind:value={newMessage} placeholder="Reminder message..." class="msg-input" />
		<input type="datetime-local" bind:value={newTime} class="time-input" />
		<button onclick={create} disabled={creating || !newMessage.trim() || !newTime} class="create-btn">
			{creating ? 'Creating...' : 'Set'}
		</button>
	</div>
</div>

<h2>Pending Reminders ({reminders.length})</h2>

{#if reminders.length === 0}
	<p class="empty">No pending reminders.</p>
{:else}
	<ul class="reminder-list">
		{#each reminders as r (r.id)}
			<li class="reminder" class:due={isPast(r.trigger_time)}>
				<div class="reminder-info">
					<span class="reminder-msg">{r.message}</span>
					<span class="reminder-time">
						{formatTime(r.trigger_time)}
						{#if r.recurrence}<span class="badge">{r.recurrence}</span>{/if}
						{#if isPast(r.trigger_time)}<span class="badge due-badge">due</span>{/if}
					</span>
				</div>
				<button onclick={() => cancel(r.id)} class="cancel-btn" title="Cancel reminder">x</button>
			</li>
		{/each}
	</ul>
{/if}

<style>
	h1 { margin-bottom: 0.5em; }
	h2 { margin-top: 1.5em; margin-bottom: 0.5em; font-size: 1.1em; }
	.error { color: #ef4444; background: #fef2f2; padding: 0.5em 0.75em; border-radius: 6px; }
	.empty { color: var(--text-muted); font-style: italic; }
	.create-form {
		background: var(--bg-surface); border: 1px solid var(--border);
		border-radius: 8px; padding: 1em; margin-bottom: 1em;
	}
	.create-form h2 { margin-top: 0; }
	.form-row { display: flex; gap: 0.5em; flex-wrap: wrap; }
	.msg-input {
		flex: 1; min-width: 200px; padding: 0.5em 0.75em;
		border: 1px solid var(--border); border-radius: 6px;
		background: var(--bg); color: var(--text); font-size: 0.9em;
	}
	.time-input {
		padding: 0.5em; border: 1px solid var(--border); border-radius: 6px;
		background: var(--bg); color: var(--text); font-size: 0.9em;
	}
	.create-btn {
		padding: 0.5em 1em; background: var(--link); color: #fff;
		border: none; border-radius: 6px; cursor: pointer; font-weight: 500;
	}
	.create-btn:disabled { opacity: 0.5; cursor: not-allowed; }
	.reminder-list { list-style: none; padding: 0; margin: 0; }
	.reminder {
		display: flex; align-items: center; justify-content: space-between;
		padding: 0.6em 0.75em; border: 1px solid var(--border);
		border-radius: 6px; margin-bottom: 0.4em; background: var(--bg-surface);
	}
	.reminder.due { border-left: 3px solid #f59e0b; }
	.reminder-info { display: flex; flex-direction: column; gap: 0.15em; }
	.reminder-msg { font-weight: 500; }
	.reminder-time { font-size: 0.8em; color: var(--text-muted); }
	.badge {
		display: inline-block; font-size: 0.75em; padding: 0.1em 0.4em;
		border-radius: 4px; background: var(--code-bg); margin-left: 0.4em;
	}
	.due-badge { background: #fef3c7; color: #92400e; }
	.cancel-btn {
		background: none; border: 1px solid var(--border); border-radius: 4px;
		color: var(--text-muted); cursor: pointer; padding: 0.2em 0.5em; font-size: 0.85em;
	}
	.cancel-btn:hover { color: #ef4444; border-color: #ef4444; }
</style>
