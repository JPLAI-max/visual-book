import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { MotionType } from "./config";
const exec=promisify(execFile);
const ffmpeg=(args:string[])=>exec("ffmpeg",["-hide_banner","-loglevel","error","-threads","2",...args],{timeout:240000,maxBuffer:1024*1024});
export async function audioDuration(bytes:Buffer) {
  const dir=await mkdtemp(join(tmpdir(),"folio-audio-"));
  try {
    const path=join(dir,"audio.wav");await writeFile(path,bytes);
    const {stdout}=await exec("ffprobe",["-v","error","-show_entries","format=duration","-of","default=nw=1:nk=1",path],{timeout:15000});
    const duration=Number(stdout.trim());if(!Number.isFinite(duration)||duration<=0)throw new Error("Invalid narration duration");
    return duration;
  } finally {await rm(dir,{recursive:true,force:true});}
}
export async function renderMotion(input:{images:Buffer[];audio:Buffer;duration:number;motionType:MotionType;resolution:string;motionPrompt:string;foreground?:Buffer}) {
  if(input.motionType==="AI_VIDEO")throw new Error("Use a connected AI video adapter for AI_VIDEO");
  if(input.motionType==="PARALLAX"&&!input.foreground)throw new Error("PARALLAX requires a real approved transparent foreground layer. No fake character animation is generated. Use PAN_ZOOM.");
  const dir=await mkdtemp(join(tmpdir(),"folio-motion-"));
  const [w,h]=input.resolution==="720p"?[1280,720]:[1920,1080];
  try {
    await writeFile(join(dir,"audio.wav"),input.audio);
    // Three restrained compositions, including a real environment establishing image when available.
    const shotImages=input.motionType==="STATIC"?[input.images[0]]:input.images.length>1?[input.images[1],input.images[0],input.images[0]]:[input.images[0],input.images[0]];
    const weights=shotImages.length===3?[.22,.5,.28]:shotImages.length===2?[.58,.42]:[1];
    const shots:Record<string,unknown>[]=[];
    for(let i=0;i<shotImages.length;i++){
      const image=join(dir,`image-${i}.png`);await writeFile(image,shotImages[i]);
      const seconds=input.duration*weights[i];const frames=Math.max(1,Math.ceil(seconds*24));
      const move=(input.motionPrompt.match(/pan|horizontal/i)&&i===1)?"horizontal pan":(input.motionPrompt.match(/reveal|vertical/i)&&i===1)?"vertical reveal":i%2?"slow pull-out":"slow push-in";
      const z=input.motionType==="STATIC"?"1.02":move==="slow pull-out"?`1.075-0.05*on/${frames}`:`1.025+0.05*on/${frames}`;
      const x=move==="horizontal pan"?`(iw-iw/zoom)*on/${frames}`:"iw/2-iw/zoom/2";
      const y=move==="vertical reveal"?`(ih-ih/zoom)*on/${frames}`:"ih/2-ih/zoom/2";
      const path=join(dir,`shot-${i}.webm`);
      let filter=`scale=${w*2}:${h*2}:force_original_aspect_ratio=increase,crop=${w*2}:${h*2},zoompan=z='${z}':x='${x}':y='${y}':d=${frames}:s=${w}x${h}:fps=24,setsar=1`;
      const args=["-y","-i",image];
      if(input.motionType==="PARALLAX"){
        await writeFile(join(dir,"foreground.png"),input.foreground!);
        args.push("-loop","1","-i",join(dir,"foreground.png"));
        filter=`[0:v]${filter}[bg];[1:v]scale=${w}:${h}:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=x='(W-w)/2+4*sin(t/12)':y='(H-h)/2':shortest=1`;
        args.push("-filter_complex",filter);
      }else args.push("-vf",filter);
      await ffmpeg([...args,"-t",String(seconds),"-c:v","libvpx-vp9","-threads","2","-row-mt","1","-cpu-used","4","-b:v","0","-crf","20","-pix_fmt","yuv420p","-an",path]);
      shots.push({shot:i+1,sourceImageIndex:input.images.indexOf(shotImages[i]),duration:seconds,camera:input.motionType==="STATIC"?"static":move});
    }
    await writeFile(join(dir,"concat.txt"),shots.map((_,i)=>`file '${join(dir,`shot-${i}.webm`)}'`).join("\n"));
    const output=join(dir,"scene.webm");
    await ffmpeg(["-y","-f","concat","-safe","0","-i",join(dir,"concat.txt"),"-i",join(dir,"audio.wav"),
      "-c:v","copy","-c:a","libopus","-b:a","128k","-t",String(input.duration),output]);
    return {bytes:await readFile(output),shots};
  }finally{await rm(dir,{recursive:true,force:true});}
}
const stamp=(seconds:number)=>{
  const ms=Math.round(seconds*1000);return `${String(Math.floor(ms/3600000)).padStart(2,"0")}:${String(Math.floor(ms/60000)%60).padStart(2,"0")}:${String(Math.floor(ms/1000)%60).padStart(2,"0")}.${String(ms%1000).padStart(3,"0")}`;
};
export async function captionTiming(input:{text:string;duration:number;audio:Buffer}) {
  const dir=await mkdtemp(join(tmpdir(),"folio-captions-"));
  try{
    const path=join(dir,"audio.wav");await writeFile(path,input.audio);
    const {stderr}=await exec("ffmpeg",["-hide_banner","-i",path,"-af","silencedetect=noise=-35dB:d=0.18","-f","null","-"],{timeout:30000,maxBuffer:1024*1024});
    const pauses=[...stderr.matchAll(/silence_end: ([\d.]+)/g)].map(m=>Number(m[1]));
    const words=input.text.split(/\s+/);const groups:string[][]=[];
    let chunk:string[]=[];
    for(const word of words){chunk.push(word);if(chunk.length>=11||(/[.!?;]$/.test(word)&&chunk.length>=5)){groups.push(chunk);chunk=[];}}
    if(chunk.length)groups.push(chunk);
    let consumed=0,start=0;const cues:string[]=[];
    groups.forEach((group,i)=>{
      consumed+=group.length;const ideal=input.duration*consumed/words.length;
      const nearest=pauses.filter(p=>p>start+.6&&Math.abs(p-ideal)<.6).sort((a,b)=>Math.abs(a-ideal)-Math.abs(b-ideal))[0];
      const end=i===groups.length-1?input.duration:Math.min(input.duration,Math.max(start+.5,nearest ?? ideal));
      cues.push(`${i+1}\n${stamp(start)} --> ${stamp(end)}\n${group.join(" ")}\n`);start=end;
    });
    return {bytes:Buffer.from("WEBVTT\n\n"+cues.join("\n")),method:"Narration-transcript verified; word-weighted timing aligned to nearby detected speech pauses. Editorial timing review required."};
  }finally{await rm(dir,{recursive:true,force:true});}
}
export async function assembleVideos(videos:Buffer[]) {
  const dir=await mkdtemp(join(tmpdir(),"folio-chapter-"));
  try{
    for(let i=0;i<videos.length;i++){
      const input=join(dir,`${i}.input`);await writeFile(input,videos[i]);
      const output=join(dir,`${i}.webm`);
      if(videoMime(videos[i])==="video/webm")await writeFile(output,videos[i]);
      else await ffmpeg(["-y","-i",input,"-c:v","libvpx-vp9","-threads","2","-row-mt","1","-cpu-used","4","-crf","20","-b:v","0","-pix_fmt","yuv420p","-c:a","libopus","-b:a","128k",output]);
    }
    await writeFile(join(dir,"concat.txt"),videos.map((_,i)=>`file '${join(dir,`${i}.webm`)}'`).join("\n"));
    const path=join(dir,"chapter.webm");
    await ffmpeg(["-y","-f","concat","-safe","0","-i",join(dir,"concat.txt"),"-c","copy",path]);
    return await readFile(path);
  }finally{await rm(dir,{recursive:true,force:true});}
}
export function videoMime(bytes:Buffer):"video/webm"|"video/mp4"{
  if(bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3]))&&bytes.subarray(0,256).includes(Buffer.from("webm")))return "video/webm";
  if(bytes.subarray(4,8).toString()==="ftyp")return "video/mp4";
  throw new Error("Video adapter must return a valid WebM or MP4 container");
}