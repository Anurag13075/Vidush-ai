import { spawn } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import type { ScriptSection, RenderStep } from "./types.js";

type ProgressFn = (step: number, total: number, label: string) => void;

const TRANSITIONS = [
  "fade", "fadeblack", "fadegrays",
  "slideleft", "slideright", "slideup", "slidedown",
  "wipeleft", "wiperight", "wipeup", "wipedown",
  "smoothleft", "smoothright", "smoothup", "smoothdown",
  "circlecrop", "rectcrop", "distance", "dissolve",
];

function pickTransition(idx: number): string {
  const pool = [
    TRANSITIONS[idx % TRANSITIONS.length],
    TRANSITIONS[(idx * 3 + 7) % TRANSITIONS.length],
    TRANSITIONS[(idx * 5 + 2) % TRANSITIONS.length],
  ];
  return pool[idx % pool.length];
}

function escapeText(s: string): string {
  return s
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "")
    .replace(/"/g, "")
    .replace(/:/g, "\\:")
    .replace(/\[/g, "\\[")
    .replace(/\]/g, "\\]")
    .replace(/,/g, "\\,")
    .replace(/%/g, "")
    .slice(0, 52);
}

function ffmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    proc.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`FFmpeg error (${code}): ${stderr.slice(-800)}`));
    });
    proc.on("error", (e) => reject(new Error(`FFmpeg not found: ${e.message}`)));
  });
}

async function ffprobe(filePath: string): Promise<number> {
  return new Promise((resolve) => {
    const proc = spawn("ffprobe", [
      "-v", "error", "-show_entries", "format=duration",
      "-of", "default=noprint_wrappers=1:nokey=1", filePath,
    ]);
    let out = "";
    proc.stdout.on("data", (d: Buffer) => { out += d.toString(); });
    proc.on("close", () => resolve(parseFloat(out.trim()) || 5));
    proc.on("error", () => resolve(5));
  });
}

// 4 Ken Burns patterns — each returns { z, x, y } expressions valid in zoompan
function kenBurnsPattern(idx: number): { z: string; x: string; y: string } {
  const patterns: { z: string; x: string; y: string }[] = [
    // 0: slow zoom-in, locked center
    { z: "min(zoom+0.0015,1.5)", x: "iw/2-(iw/zoom/2)", y: "ih/2-(ih/zoom/2)" },
    // 1: zoom-in, pan right
    { z: "1.25", x: "min(on*0.6,iw-(iw/zoom))", y: "ih/2-(ih/zoom/2)" },
    // 2: zoom-in, pan left
    { z: "1.25", x: "max(iw-(iw/zoom)-on*0.6,0)", y: "ih/2-(ih/zoom/2)" },
    // 3: zoom-in, pan down
    { z: "min(zoom+0.001,1.3)", x: "iw/2-(iw/zoom/2)", y: "min(on*0.4,ih-(ih/zoom))" },
  ];
  return patterns[idx % patterns.length];
}

function buildGraphicText(section: ScriptSection): string {
  if (section.section_type === "graphic") {
    return section.key_point ? escapeText(section.key_point) : escapeText(section.narration.slice(0, 60));
  }
  return section.key_point ? escapeText(section.key_point) : escapeText(section.narration.slice(0, 80));
}

async function createMotionGraphicClip(
  section: ScriptSection,
  outputPath: string,
  clipDuration: number
): Promise<number> {
  const headline = buildGraphicText(section);
  const detail = section.section_type === "stat"
    ? escapeText(section.narration.slice(0, 120))
    : "";
  const fadeOut = Math.max(clipDuration - 0.8, 0).toFixed(1);

  const parts: string[] = [
    "format=yuv420p",
    `drawbox=x=0:y=0:w=iw:h=ih:color=0x071a2b:t=fill`,
    `drawbox=x=60:y=100:w=1160:h=8:color=0x7C3AED:t=fill`,
    `drawtext=text='${headline}':fontsize=44:fontcolor=white:x=(w-text_w)/2:y=h*0.30`,
  ];

  if (detail) {
    parts.push(
      `drawtext=text='${detail}':fontsize=22:fontcolor=0xCCCCCC:x=(w-text_w)/2:y=h*0.56`
    );
  }

  parts.push(
    `fade=t=in:st=0:d=0.6`,
    `fade=t=out:st=${fadeOut}:d=0.6`,
    `format=yuv420p`
  );

  // Changed: 1280x720 instead of 1920x1080, crf 28 instead of 22
  await ffmpeg([
    "-f", "lavfi",
    "-i", `color=c=0x071a2b:s=1280x720:r=25`,
    "-t", String(clipDuration),
    "-vf", parts.join(","),
    "-c:v", "libx264", "-crf", "28", "-preset", "ultrafast",
    "-an", "-y", outputPath,
  ]);

  return clipDuration;
}

async function processClip(
  footagePath: string,
  audioPath: string,
  section: ScriptSection,
  sectionIndex: number,
  outputPath: string,
  videoTitle?: string
): Promise<number> {
  const audioDuration = await ffprobe(audioPath);
  const clipDuration = Math.max(audioDuration + 0.5, 3.5);

  if (section.section_type === "stat" || section.section_type === "graphic") {
    return await createMotionGraphicClip(section, outputPath, clipDuration);
  }

  const { z: zExpr, x: xExpr, y: yExpr } = kenBurnsPattern(sectionIndex);

  // Changed: 1280x720 throughout instead of 1920x1080
  const filters: string[] = [
    "scale=1280:720:force_original_aspect_ratio=decrease",
    "pad=1280:720:(ow-iw)/2:(oh-ih)/2:color=black",
    `zoompan=z='${zExpr}':x='${xExpr}':y='${yExpr}':d=75:fps=25`,
    "scale=1280:720",
    "format=yuv420p",
    "eq=contrast=1.10:brightness=0.02:saturation=1.08",
    "unsharp=5:5:0.8:3:3:0.0",
  ];

  if (section.section_type === "intro" && videoTitle) {
    const tLine1 = escapeText(videoTitle.slice(0, 38));
    const tLine2 = videoTitle.length > 38 ? escapeText(videoTitle.slice(38, 72)) : "";
    const showEnd = Math.min(audioDuration - 0.4, 5.0).toFixed(1);
    const en04  = `gte(t\\,0.4)*lte(t\\,${showEnd})`;
    const en07  = `gte(t\\,0.7)*lte(t\\,${showEnd})`;

    filters.push(
      `drawbox=x=0:y=ih*0.28:w=iw:h=ih*0.44:color=0x000000B8:t=fill:enable='${en04}'`,
      `drawbox=x=0:y=ih*0.28:w=iw:h=4:color=0x7C3AED:t=fill:enable='${en04}'`,
      `drawbox=x=0:y=ih*0.72:w=iw:h=4:color=0x7C3AED:t=fill:enable='${en04}'`,
      `drawtext=text='${tLine1}':fontsize=46:fontcolor=white:x=(w-text_w)/2:y=h*0.38:enable='${en07}'`
    );
    if (tLine2) {
      filters.push(
        `drawtext=text='${tLine2}':fontsize=46:fontcolor=white:x=(w-text_w)/2:y=h*0.48:enable='${en07}'`
      );
    }
  }

  if (section.key_point) {
    const showEnd = Math.min(audioDuration - 0.4, 5.5).toFixed(1);
    const en10 = `gte(t\\,1.0)*lte(t\\,${showEnd})`;
    const en13 = `gte(t\\,1.3)*lte(t\\,${showEnd})`;
    filters.push(
      `drawbox=x=16:y=ih-76:w=iw-32:h=68:color=0x000000A6:t=fill:enable='${en10}'`,
      `drawbox=x=16:y=ih-76:w=8:h=68:color=0x7C3AED:t=fill:enable='${en10}'`,
      `drawtext=text='${escapeText(section.key_point)}':fontsize=28:fontcolor=white:x=30:y=h-54:enable='${en13}'`
    );
  }

  // Changed: crf 28 instead of 22
  await ffmpeg([
    "-stream_loop", "-1", "-i", footagePath,
    "-vf", filters.join(","),
    "-t", String(clipDuration),
    "-r", "25",
    "-c:v", "libx264", "-crf", "28", "-preset", "ultrafast",
    "-an", "-y", outputPath,
  ]);

  return clipDuration;
}

async function mergeAudio(audioPaths: string[], outputPath: string): Promise<void> {
  if (audioPaths.length === 0) {
    await ffmpeg([
      "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
      "-t", "5", "-q:a", "9", "-acodec", "libmp3lame",
      "-y", outputPath,
    ]);
    return;
  }
  if (audioPaths.length === 1) {
    await fs.copyFile(audioPaths[0], outputPath);
    return;
  }

  const inputs: string[] = [];
  audioPaths.forEach((p) => inputs.push("-i", p));

  const filterComplex = audioPaths
    .map((_, i) => `[${i}:a]`)
    .join("") + `concat=n=${audioPaths.length}:v=0:a=1[a]`;

  await ffmpeg([
    ...inputs,
    "-filter_complex", filterComplex,
    "-map", "[a]",
    "-c:a", "libmp3lame", "-q:a", "4",
    "-y", outputPath,
  ]);
}

async function concatWithTransitions(
  clipPaths: string[],
  clipDurations: number[],
  outputPath: string
): Promise<void> {
  if (clipPaths.length === 1) {
    await fs.copyFile(clipPaths[0], outputPath);
    return;
  }

  const inputs: string[] = [];
  clipPaths.forEach((p) => inputs.push("-i", p));

  const TRANS_DUR = 0.5;
  let filterGraph = "";
  let prevLabel = "[0:v]";
  let timeOffset = 0;

  for (let i = 1; i < clipPaths.length; i++) {
    const outLabel = i === clipPaths.length - 1 ? "[vout]" : `[v${i}]`;
    timeOffset += clipDurations[i - 1] - TRANS_DUR;
    const transition = pickTransition(i - 1);
    filterGraph += `${prevLabel}[${i}:v]xfade=transition=${transition}:duration=${TRANS_DUR}:offset=${timeOffset.toFixed(3)}${outLabel};`;
    prevLabel = outLabel;
  }

  // Changed: ultrafast instead of fast, crf 26 instead of 21
  await ffmpeg([
    ...inputs,
    "-filter_complex", filterGraph.slice(0, -1),
    "-map", "[vout]",
    "-c:v", "libx264", "-crf", "26", "-preset", "ultrafast",
    "-r", "25", "-an", "-y", outputPath,
  ]);
}

async function finalMix(
  videoPath: string,
  voiceoverPath: string,
  bgmPath: string | null,
  outputPath: string
): Promise<void> {
  const hasBgm = bgmPath !== null;
  const inputs = ["-i", videoPath, "-i", voiceoverPath];
  if (hasBgm) inputs.push("-i", bgmPath!);

  if (hasBgm) {
    await ffmpeg([
      ...inputs,
      "-filter_complex", "[2:a]volume=0.08[bgm];[1:a][bgm]amix=inputs=2:duration=shortest[a]",
      "-map", "0:v",
      "-map", "[a]",
      "-c:v", "copy",
      "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
      "-shortest",
      "-movflags", "+faststart",
      "-y", outputPath,
    ]);
  } else {
    await ffmpeg([
      ...inputs,
      "-map", "0:v",
      "-map", "1:a",
      "-c:v", "copy",
      "-c:a", "aac", "-b:a", "128k", "-ar", "44100",
      "-shortest",
      "-movflags", "+faststart",
      "-y", outputPath,
    ]);
  }
}

async function extractThumbnail(videoPath: string, thumbPath: string): Promise<void> {
  await ffmpeg([
    "-ss", "6", "-i", videoPath,
    "-vframes", "1",
    // Changed: 854x480 thumbnail instead of 1280x720 (smaller, faster)
    "-vf", "scale=854:480",
    "-y", thumbPath,
  ]);
}

export const RENDER_STEPS: RenderStep[] = [
  { label: "Processing video clips (Ken Burns + overlays)", done: false },
  { label: "Merging voiceover audio tracks", done: false },
  { label: "Concatenating clips with transitions", done: false },
  { label: "Mixing audio (voiceover + music bed)", done: false },
  { label: "Generating thumbnail", done: false },
  { label: "Encoding final H.264 MP4", done: false },
];

export async function assemble(
  videoId: string,
  videoTitle: string,
  sections: ScriptSection[],
  audioPaths: (string | null)[],
  footagePaths: (string | null)[],
  bgmPath: string | null,
  outputDir: string,
  onProgress: ProgressFn
): Promise<{ videoPath: string; thumbPath: string }> {
  const tmpDir = path.join("/tmp/vidrush", videoId);
  await fs.mkdir(tmpDir, { recursive: true });
  await fs.mkdir(outputDir, { recursive: true });

  const total = RENDER_STEPS.length;

  // Step 1: Process each clip
  onProgress(0, total, RENDER_STEPS[0].label);
  const processedClips: string[] = [];
  const clipDurations: number[] = [];
  const validAudio: string[] = [];

  for (let i = 0; i < sections.length; i++) {
    const section = sections[i];
    const audioPath = audioPaths[i];
    let footagePath = footagePaths[i];

    if (!audioPath) continue;

    if (!footagePath && section.section_type !== "stat" && section.section_type !== "graphic") {
      footagePath = path.join(tmpDir, `black_${i}.mp4`);
      const dur = await ffprobe(audioPath) + 0.5;
      // Changed: 1280x720 black fallback clip
      await ffmpeg([
        "-f", "lavfi", "-i", `color=c=black:size=1280x720:rate=25`,
        "-t", String(dur), "-c:v", "libx264", "-an", "-y", footagePath,
      ]);
    }

    const outClip = path.join(tmpDir, `processed_${i}.mp4`);
    const duration = await processClip(
      footagePath || "",
      audioPath,
      section,
      i,
      outClip,
      i === 0 ? videoTitle : undefined
    );
    processedClips.push(outClip);
    clipDurations.push(duration);
    validAudio.push(audioPath);
  }

  if (processedClips.length === 0) {
    throw new Error("No clips could be processed — all audio and footage failed. Check MINIMAX_API_KEY, PEXELS_API_KEY and PIXABAY_API_KEY.");
  }

  // Step 2: Merge audio
  onProgress(1, total, RENDER_STEPS[1].label);
  const mergedAudio = path.join(tmpDir, "voiceover_merged.mp3");
  await mergeAudio(validAudio, mergedAudio);

  // Step 3: Concatenate video
  onProgress(2, total, RENDER_STEPS[2].label);
  const concatVideo = path.join(tmpDir, "concat.mp4");
  await concatWithTransitions(processedClips, clipDurations, concatVideo);

  // Step 4: Mix audio
  onProgress(3, total, RENDER_STEPS[3].label);
  const finalMp4 = path.join(outputDir, "final.mp4");
  await finalMix(concatVideo, mergedAudio, bgmPath, finalMp4);

  // Step 5: Thumbnail
  onProgress(4, total, RENDER_STEPS[4].label);
  const thumbPath = path.join(outputDir, "thumb.jpg");
  await extractThumbnail(finalMp4, thumbPath);

  onProgress(5, total, RENDER_STEPS[5].label);

  return { videoPath: finalMp4, thumbPath };
}