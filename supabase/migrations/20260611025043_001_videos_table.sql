-- Videos table for tracking video generation jobs
CREATE TABLE IF NOT EXISTS videos (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  voice TEXT NOT NULL DEFAULT 'presenter_female',
  length TEXT NOT NULL DEFAULT 'medium',
  theme TEXT DEFAULT 'modern',
  background TEXT DEFAULT 'gradient_dark',
  mode TEXT DEFAULT 'auto',
  stage TEXT NOT NULL DEFAULT 'queued',
  progress INTEGER DEFAULT 0,
  message TEXT DEFAULT '',
  script JSONB,
  clips JSONB,
  render_steps JSONB,
  render_progress INTEGER DEFAULT 0,
  video_url TEXT,
  thumbnail_url TEXT,
  duration_seconds INTEGER,
  error_message TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE videos ENABLE ROW LEVEL SECURITY;

-- Create policies for public access (since this demo doesn't have auth)
CREATE POLICY "select_videos" ON videos FOR SELECT USING (true);
CREATE POLICY "insert_videos" ON videos FOR INSERT WITH CHECK (true);
CREATE POLICY "update_videos" ON videos FOR UPDATE USING (true);
CREATE POLICY "delete_videos" ON videos FOR DELETE USING (true);

-- Create updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER videos_updated_at
  BEFORE UPDATE ON videos
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at();