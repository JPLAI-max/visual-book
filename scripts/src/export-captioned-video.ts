import { execFile } from "node:child_process";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const [inputArg, captionsArg, outputArg] = process.argv.slice(2);
if (!inputArg || !captionsArg || !outputArg) throw new Error("Usage: export-captioned-video <video> <synchronized.vtt> <output.webm>");
const input = resolve(inputArg), output = resolve(outputArg);
if (input === output) throw new Error("Keep the original clean render; use a distinct captioned export path.");
const { stdout } = await exec("ffprobe", ["-v", "error", "-show_streams", "-show_format", "-of", "json", input]);
const probe = JSON.parse(stdout);
const video = probe.streams.find((s: { codec_type: string }) => s.codec_type === "video");
if (!video || !probe.streams.some((s: { codec_type: string }) => s.codec_type === "audio")) throw new Error("Expected a narrated video.");
const seconds = (s: string) => s.split(":").reduce((n, v) => n * 60 + Number(v), 0);
const assTime = (s: string) => {
  const cs = Math.round(seconds(s) * 100);
  return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, "0")}:${String(Math.floor(cs / 100) % 60).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`;
};
const vtt = await readFile(resolve(captionsArg), "utf8");
let previousEnd = 0;
const events = vtt.split(/\r?\n\r?\n/).flatMap(block => {
  const lines = block.split(/\r?\n/);
  const i = lines.findIndex(line => line.includes("-->"));
  if (i < 0) return [];
  const [a, b] = lines[i]!.split("-->").map(s => s.trim().split(/\s+/)[0]!);
  const start = seconds(a!), end = seconds(b!);
  if (!Number.isFinite(start + end) || start < previousEnd - .02 || end <= start || end > Number(probe.format.duration) + .1) throw new Error("Invalid or out-of-order caption timing.");
  previousEnd = end;
  const text = lines.slice(i + 1).join(" ").replace(/<[^>]+>/g, "").replace(/[{}]/g, "").replace(/\\/g, "\\\\");
  return [`Dialogue: 0,${assTime(a!)},${assTime(b!)},Caption,,0,0,0,,${text}`];
});
if (!events.length || previousEnd < Number(probe.format.duration) - 1) throw new Error("Captions do not cover the chapter.");
const temp = await mkdtemp(join(tmpdir(), "folio-visible-captions-"));
try {
  const ass = join(temp, "captions.ass");
  await writeFile(ass, `[Script Info]
ScriptType: v4.00+
PlayResX: ${video.width}
PlayResY: ${video.height}
WrapStyle: 0

[V4+ Styles]
Format: Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding
Style: Caption,DejaVu Sans,${Math.round(video.height * .036)},&H00FFFFFF,&H00FFFFFF,&H70000000,&H70000000,0,0,0,0,100,100,0,0,3,8,0,2,${Math.round(video.width * .085)},${Math.round(video.width * .085)},${Math.round(video.height * .07)},1

[Events]
Format: Layer,Start,End,Style,Name,MarginL,MarginR,MarginV,Effect,Text
${events.join("\n")}
`);
  await exec("ffmpeg", ["-y", "-v", "error", "-i", input, "-vf", `ass=${ass}`, "-map", "0:v:0", "-map", "0:a:0",
    "-c:v", "libvpx-vp9", "-b:v", "0", "-crf", "28", "-deadline", "realtime", "-cpu-used", "5", "-row-mt", "1",
    "-threads", "2", "-pix_fmt", "yuv420p", "-c:a", "copy", output], { timeout: 600000, maxBuffer: 1024 * 1024 });
  console.log(JSON.stringify({ output, captionCues: events.length, narrationCopiedWithoutRegeneration: true }));
} finally {
  await rm(temp, { recursive: true, force: true });
}
