import test from "node:test";
import assert from "node:assert/strict";
import { materializeReferences, validateDirectorPlan } from "./planner";
import type { directorContext } from "./context";
import { definitionHash } from "./types";
import { hasShotVideoProvider, shotVideoProvider } from "./video";
const context={
  scenes:[{playback_scene_id:9,duration:10,narration:"A sheltered child remembers a warm home.",data:{characters_present:[3,5],allowed_environment_ids:[-23]},
    references:[
      {id:4,canonical_id:5,kind:"character"},
      {id:7,canonical_id:3,kind:"character_child"},
      {id:8,canonical_id:-23,kind:"environment"},
    ]}],
} as unknown as Awaited<ReturnType<typeof directorContext>>;
function proposal(){
  const shot={shot_number:1,shot_type:"MEDIUM" as const,start_time:0,duration:5,visual_subject:"A sheltered childhood memory",
    character_reference_ids:[4,7],environment_reference_id:8,composition:"Child and parent in the courtyard",
    camera_angle:"Eye level",camera_distance:"Medium",camera_movement:"Slow Push In" as const,action:"A still representative moment",
    emotion:"Gentle warmth",lighting:"Soft daylight",continuity_notes:"Keep the approved child life stage",generation_prompt:"One independent cinematic illustrated-book image",
    narration_beat:"A sheltered child remembers",motion_recommendation:"PAN_ZOOM" as const};
  return {scenes:[{scene_id:9,continuity:{characters:[{reference_id:7,wardrobe:"Modest child clothes",appearance:"Young child",props:[]}],
    environment:{reference_id:8,time_of_day:"Day",weather:"Clear",props:[]},visual_style:"Historical oil illustration",continuity_notes:"Same courtyard"},
    shots:[shot,{...shot,shot_number:2,start_time:5,narration_beat:"a warm home",character_reference_ids:[]}]}]};
}
test("derive canonical identities and locations from one unambiguous approved-reference namespace",()=>{
  const plan=materializeReferences(proposal(),context);
  assert.deepEqual(plan.scenes[0]!.shots[0]!.characters,[5,3]);
  assert.equal(plan.scenes[0]!.shots[0]!.environment,-23);
  assert.deepEqual(plan.scenes[0]!.shots[0]!.reference_ids,[8,4,7]);
  validateDirectorPlan(plan,context);
});
test("cannot substitute an adult reference for the child variant",()=>{
  const p=proposal();p.scenes[0]!.shots[0]!.character_reference_ids=[1];
  assert.throws(()=>materializeReferences(p,context),/unapproved|life-stage/);
});
test("cannot substitute an environment image for a character",()=>{
  const p=proposal();p.scenes[0]!.shots[0]!.character_reference_ids=[8];
  assert.throws(()=>materializeReferences(p,context),/unapproved/);
});
test("direction cannot change narration duration, create gaps, or invent narration anchors",()=>{
  for(const kind of ["duration","gap","anchor"]){
    const plan=materializeReferences(proposal(),context);
    if(kind==="duration")plan.scenes[0]!.shots[1]!.duration=6;
    if(kind==="gap")plan.scenes[0]!.shots[1]!.start_time=5.5;
    if(kind==="anchor")plan.scenes[0]!.shots[1]!.narration_beat="The monster awakens";
    assert.throws(()=>validateDirectorPlan(plan,context),/duration|gap|narration/);
  }
});
test("chapter review fingerprints ignore object key order, not visual changes",()=>{
  assert.equal(definitionHash({a:1,b:2}),definitionHash({b:2,a:1}));
  assert.notEqual(definitionHash({zoom:1.03}),definitionHash({zoom:1.05}));
});
test("absent image-to-video provider fails explicitly, never returns a fake generated clip",()=>{
  assert.equal(hasShotVideoProvider(""),false);
  assert.throws(()=>shotVideoProvider(""),/No image-to-video provider/);
});
