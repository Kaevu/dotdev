-- bookmarks D1 schema
CREATE TABLE IF NOT EXISTS bookmarks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  source TEXT NOT NULL,
  summary TEXT NOT NULL,
  tags TEXT NOT NULL,            -- JSON array of tag paths, e.g. ["cs","cs/courses"]
  kind TEXT NOT NULL,            -- article | paper | book | site | video
  reading_minutes INTEGER,       -- estimated read time; NULL if unknown
  saved_at TEXT NOT NULL         -- ISO date
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_saved_at ON bookmarks (saved_at DESC);
