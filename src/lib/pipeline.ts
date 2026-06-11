import { supabase } from "./supabase";

export type Stage =
  | "queued"
  | "researching"
  | "writing"
  | "voiceover"
  | "footage"
  | "rendering"
  | "done"
  | "error";

export interface ScriptSection {
  id: number;
  narration: string;
  visual_keyword: string;
  visual_keywords: string[];
  on_screen_text: string;
  duration: number;
  section_type: string;
  key_point: string | null;
}

export interface Script {
  title: string;
  hook: string;
  sections: ScriptSection[];
  outro: string;
  description: string;
  mood?: string;
  thumbnail_hook?: string;
}

export interface Clip {
  id: number;
  keyword: string;
  thumbUrl: string;
  status: "pending" | "downloading" | "ready" | "failed";
}

export interface RenderStep {
  label: string;
  done: boolean;
}

export interface VideoRow {
  id: string;
  title: string;
  voice: string;
  length: string;
  theme?: string;
  background?: string;
  mode?: string;
  stage: string;
  progress: number;
  message: string;
  script: Record<string, unknown> | null;
  clips: Clip[] | null;
  render_steps: RenderStep[] | null;
  render_progress: number;
  video_url: string | null;
  thumbnail_url: string | null;
  duration_seconds: number | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

export interface Job {
  id: string;
  topic: string;
  voice: string;
  length: string;
  theme?: string;
  background?: string;
  mode?: string;
  stage: Stage;
  progress: number;
  message: string;
  script?: Script;
  clips?: Clip[];
  renderSteps?: RenderStep[];
  renderProgress?: number;
  videoUrl?: string;
  thumbnailUrl?: string;
  durationSec?: number;
  createdAt: number;
}

function normalizeSection(s: Record<string, unknown>, idx: number): ScriptSection {
  const keywords = Array.isArray(s.visual_keywords)
    ? (s.visual_keywords as string[])
    : [String(s.visual_keyword || s.visual_keywords || "")];
  const words = Number(s.estimated_words) || 60;
  return {
    id: Number(s.id) || idx + 1,
    narration: String(s.narration || ""),
    visual_keyword: keywords[0] || "",
    visual_keywords: keywords,
    on_screen_text: keywords[0]?.toUpperCase() || "",
    duration: Math.round(words / 2.5),
    section_type: String(s.section_type || "broll"),
    key_point: (s.key_point as string) || null,
  };
}

function normalizeScript(raw: Record<string, unknown> | null): Script | undefined {
  if (!raw) return undefined;
  const sections = Array.isArray(raw.sections)
    ? (raw.sections as Record<string, unknown>[]).map(normalizeSection)
    : [];
  return {
    title: String(raw.title || ""),
    hook: String(raw.thumbnail_hook || raw.hook || ""),
    sections,
    outro: sections[sections.length - 1]?.narration || "",
    description: String(raw.description || ""),
    mood: String(raw.mood || "neutral"),
    thumbnail_hook: String(raw.thumbnail_hook || ""),
  };
}

export function normalizeVideoRow(data: VideoRow): Job {
  return {
    id: data.id,
    topic: data.title,
    voice: data.voice || "presenter_female",
    length: data.length || "medium",
    theme: data.theme || "modern",
    background: data.background || "gradient_dark",
    mode: data.mode || "auto",
    stage: (data.stage as Stage) || "queued",
    progress: data.progress || 0,
    message: data.message || "",
    script: normalizeScript(data.script),
    clips: data.clips || undefined,
    renderSteps: data.render_steps || undefined,
    renderProgress: data.render_progress || 0,
    videoUrl: data.video_url || undefined,
    thumbnailUrl: data.thumbnail_url || undefined,
    durationSec: data.duration_seconds || undefined,
    createdAt: data.created_at ? new Date(data.created_at).getTime() : Date.now(),
  };
}

export async function createJob(input: {
  topic: string;
  voice: string;
  length: string;
  theme?: string;
  background?: string;
  mode?: string;
}): Promise<string> {
  const id = crypto.randomUUID();

  const { error } = await supabase.from("videos").insert({
    id,
    title: input.topic.trim(),
    voice: input.voice || "presenter_female",
    length: input.length || "medium",
    theme: input.theme || "modern",
    background: input.background || "gradient_dark",
    mode: input.mode || "auto",
    stage: "queued",
    message: "Initializing pipeline...",
  });

  if (error) {
    throw new Error(error.message || "Failed to create video");
  }

  return id;
}

export async function fetchJob(id: string): Promise<Job | null> {
  const { data, error } = await supabase
    .from("videos")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) return null;
  return normalizeVideoRow(data as VideoRow);
}

export async function fetchAllJobs(): Promise<Job[]> {
  const { data, error } = await supabase
    .from("videos")
    .select("id, title, stage, progress, message, video_url, thumbnail_url, duration_seconds, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error || !data) return [];
  return data.map((row) => ({
    id: row.id,
    topic: row.title,
    stage: row.stage as Stage,
    progress: row.progress || 0,
    message: row.message || "",
    videoUrl: row.video_url || undefined,
    thumbnailUrl: row.thumbnail_url || undefined,
    durationSec: row.duration_seconds || undefined,
    createdAt: row.created_at ? new Date(row.created_at).getTime() : Date.now(),
    voice: "presenter_female",
    length: "medium",
  }));
}
