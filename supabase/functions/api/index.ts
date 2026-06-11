import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";
import { v4 as uuidv4 } from "https://esm.sh/uuid@9";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const url = new URL(req.url);
  const path = url.pathname.replace("/api", "");

  try {
    // GET /videos - list all videos
    if (req.method === "GET" && path === "/videos") {
      const { data, error } = await supabase
        .from("videos")
        .select("id, title, stage, progress, message, video_url, thumbnail_url, duration_seconds, created_at")
        .order("created_at", { ascending: false })
        .limit(50);

      if (error) throw error;
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /videos/:id - get single video
    const videoMatch = path.match(/^\/videos\/([a-f0-9-]+)$/);
    if (req.method === "GET" && videoMatch) {
      const id = videoMatch[1];
      const { data, error } = await supabase
        .from("videos")
        .select("*")
        .eq("id", id)
        .single();

      if (error) {
        return new Response(JSON.stringify({ error: "Not found" }), {
          status: 404,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify(data), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // POST /videos - create new video
    if (req.method === "POST" && path === "/videos") {
      const body = await req.json();
      const { title, voice, length, theme, background, mode } = body;

      if (!title?.trim()) {
        return new Response(JSON.stringify({ error: "title is required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const id = uuidv4();
      const validVoice = voice || "presenter_female";
      const validLength = ["short", "medium", "long"].includes(length) ? length : "medium";
      const validTheme = theme || "modern";
      const validBackground = background || "gradient_dark";
      const validMode = mode || "auto";

      const { error } = await supabase.from("videos").insert({
        id,
        title: title.trim(),
        voice: validVoice,
        length: validLength,
        theme: validTheme,
        background: validBackground,
        mode: validMode,
        stage: "queued",
        message: "Initializing pipeline...",
      });

      if (error) throw error;

      // Trigger background processing (in real Bolt deployment, this would be a separate function)
      // For now, we'll just return the created video
      return new Response(JSON.stringify({
        id,
        title: title.trim(),
        voice: validVoice,
        length: validLength,
        theme: validTheme,
        background: validBackground,
        mode: validMode,
      }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // DELETE /videos/:id
    const deleteMatch = path.match(/^\/videos\/([a-f0-9-]+)$/);
    if (req.method === "DELETE" && deleteMatch) {
      const id = deleteMatch[1];
      const { error } = await supabase
        .from("videos")
        .update({ stage: "error", message: "Deleted" })
        .eq("id", id);

      if (error) throw error;
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // GET /voices - list available voices
    if (req.method === "GET" && path === "/voices") {
      const voices = [
        { id: "presenter_female", label: "Aria · Warm Female", tags: ["Female", "Warm", "American"] },
        { id: "audiobook_female_1", label: "Ava · Natural Female", tags: ["Female", "Natural", "American"] },
        { id: "presenter_male", label: "Brian · Deep Male", tags: ["Male", "Deep", "American"] },
        { id: "audiobook_male_1", label: "Christopher · Authoritative", tags: ["Male", "Authoritative", "American"] },
        { id: "newscast_male", label: "Guy · Neutral Male", tags: ["Male", "Neutral", "American"] },
        { id: "casual_guy", label: "Andrew · Conversational Male", tags: ["Male", "Young", "American"] },
        { id: "wise_woman", label: "Eleanor · Wise Female", tags: ["Female", "Mature", "British"] },
        { id: "deep_space_master", label: "Magnus · Epic Narrator", tags: ["Male", "Epic", "American"] },
        { id: "calm_woman", label: "Serenity · Calm Female", tags: ["Female", "Calm", "American"] },
        { id: "audiobook_female_2", label: "Grace · Storyteller Female", tags: ["Female", "Young", "American"] },
        { id: "audiobook_male_2", label: "Drake · Documentary Male", tags: ["Male", "Mature", "American"] },
        { id: "newscast_female", label: "Natalie · Professional Female", tags: ["Female", "Professional", "American"] },
      ];
      return new Response(JSON.stringify(voices), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Not found" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("API error:", err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
