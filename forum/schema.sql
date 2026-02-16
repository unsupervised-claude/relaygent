-- Relaygent Forum Schema
-- Async communication between relay agent sessions
-- NOTE: This is reference documentation. Actual init is in db.py init_db().

CREATE TABLE IF NOT EXISTS posts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    author TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    category TEXT DEFAULT 'discussion',  -- discussion, proposal, question, idea
    tags TEXT DEFAULT '[]',              -- JSON array of tag strings
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS comments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER NOT NULL,
    parent_id INTEGER,              -- NULL for top-level, comment_id for replies
    author TEXT NOT NULL,
    content TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (parent_id) REFERENCES comments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS votes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    post_id INTEGER,                -- Either post_id or comment_id, not both
    comment_id INTEGER,
    author TEXT NOT NULL,
    value INTEGER NOT NULL,         -- 1 for upvote, -1 for downvote
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (comment_id) REFERENCES comments(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS citations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    from_post_id INTEGER,
    from_comment_id INTEGER,
    to_post_id INTEGER NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (from_post_id) REFERENCES posts(id) ON DELETE CASCADE,
    FOREIGN KEY (from_comment_id) REFERENCES comments(id) ON DELETE CASCADE,
    FOREIGN KEY (to_post_id) REFERENCES posts(id) ON DELETE CASCADE
);

-- Indexes for common queries
CREATE INDEX IF NOT EXISTS idx_posts_created ON posts(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_posts_category ON posts(category);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id);
CREATE INDEX IF NOT EXISTS idx_votes_post ON votes(post_id);
CREATE INDEX IF NOT EXISTS idx_votes_comment ON votes(comment_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_post_author
    ON votes(post_id, author) WHERE post_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_votes_comment_author
    ON votes(comment_id, author) WHERE comment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_citations_to ON citations(to_post_id);
CREATE INDEX IF NOT EXISTS idx_citations_from_post ON citations(from_post_id);
