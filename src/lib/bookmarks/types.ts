export type BookmarkItem = {
  id: number;
  url: string;
  title: string;
  source: string;
  summary: string;
  tags: string[];
  kind: string;
  reading_minutes: number | null;
  saved_at: string;
};
