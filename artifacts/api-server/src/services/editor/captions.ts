const seconds = (value: string) => {
  const [h, m, s] = value.split(":").map(Number);
  return h! * 3600 + m! * 60 + s!;
};
const stamp = (seconds: number) => {
  const ms = Math.round(seconds * 1000);
  return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};
export function combineCaptions(scenes: { text: string; duration: number }[]) {
  let offset = 0, count = 0;
  const cues: string[] = [];
  for (const scene of scenes) {
    let sceneCount = 0;
    for (const block of scene.text.split(/\r?\n\r?\n/)) {
      const lines = block.split(/\r?\n/);
      const index = lines.findIndex(line => line.includes("-->"));
      if (index < 0) continue;
      const timing = /^(\d{2}:\d{2}:\d{2}\.\d{3}) --> (\d{2}:\d{2}:\d{2}\.\d{3})/.exec(lines[index]!);
      if (!timing) throw new Error("Source captions contain invalid timing.");
      const start = seconds(timing[1]!), end = seconds(timing[2]!);
      if (end <= start || end > scene.duration + .05) throw new Error("Source captions exceed narration timing.");
      cues.push(`${++count}\n${stamp(start + offset)} --> ${stamp(end + offset)}\n${lines.slice(index + 1).join("\n")}`);
      sceneCount++;
    }
    if (!sceneCount) throw new Error("Scene captions are missing; render cannot silently omit them.");
    offset += scene.duration;
  }
  return Buffer.from(`WEBVTT\n\n${cues.join("\n\n")}\n`);
}
