import { z } from "zod/v4";
const str=z.string().min(1);
const list=z.array(str);
const nullable=z.string().nullable();
export const overviewSchema=z.object({
  book_id:z.number().int(),title:str,author:str,genre:str,fiction_or_nonfiction:z.enum(["fiction","nonfiction"]),
  time_period:str,setting:str,tone:str,visual_style_recommendation:str,narration_style:str,
  target_runtime:z.number().min(60).max(86400),target_audience:str,story_summary:str,
  central_themes:list,major_concepts:list,historical_context:str,content_warnings:list,analysis_version:z.number().int(),
});
export const chapterSchema=z.object({
  chapter_number:z.number().int().positive(),chapter_title:str,summary:str,key_events:list,key_characters:list,key_locations:list,
  themes:list,learning_objectives:list,emotional_tone:str,estimated_visual_runtime:z.number().min(20).max(7200).describe("Visual chapter runtime in SECONDS, never minutes. At least 20 seconds, at most 7200."),
  importance_score:z.number().min(0).max(10),
  // Source-supported evidence aids canonical extraction without sending the
  // entire novel repeatedly to every subsequent stage.
  character_evidence:z.array(z.object({name:str,aliases:list,role:str,source_description:str,relationships:list})),
  environment_evidence:z.array(z.object({name:str,location:str,source_description:str})),
});
export const characterSchema=z.object({
  name:str,aliases:list,role:str,age_or_age_range:str,height_build:str,hair:str,eyes:str,
  skin_tone:nullable,facial_structure:str,clothing:str,era:str,personality:str,body_language:str,
  distinctive_traits:list,relationships:list,canonical_visual_description:str,canonical_generation_prompt:str,
  reference_image_url:z.string().max(0),consistency_notes:str,
});
export const environmentSchema=z.object({
  name:str,type:str,location:str,time_period:str,architecture:str,interior_description:str,exterior_description:str,
  lighting:str,weather:str,mood:str,furniture:list,important_props:list,visual_style:str,canonical_generation_prompt:str,
  reference_image_url:z.string().max(0),consistency_notes:str,
});
export const sceneSchema=z.object({
  scene_number:z.number().int().positive(),scene_title:str,chapter_id:z.number().int().positive(),purpose:str,summary:str,narration:str,
  characters_present:z.array(z.number().int().positive()),environment_id:z.number().int().positive().nullable(),
  visual_description:str,camera_direction:str,action:str,mood:str,estimated_duration:z.number().min(10).max(300).describe("Scene duration in SECONDS, between 10 and 300."),
  importance:z.number().min(0).max(10),educational_goal:str,source_reference:str,spoiler_level:str,transition_in:str,transition_out:str,
});
export const visualSchema=z.object({
  overall_visual_tone:str,cinematic_style:str,realism_level:str,era_accuracy_requirements:list,camera_style:str,
  lens_style_recommendations:list,lighting_philosophy:str,aspect_ratio:z.enum(["16:9","4:3","2.39:1"]),
  character_consistency_rules:list,environment_consistency_rules:list,transition_philosophy:str,motion_philosophy:str,
});
export const narrationSchema=z.object({
  narrator_tone:str,voice_gender_preference:nullable,pace:str,reading_level:str,dramatic_intensity:str,pronunciation_notes:list,
  dialogue_treatment:str,original_text_quotation_policy:str,summary_phrasing:str,educational_explanation_policy:str,
});
export const themesSchema=z.object({central_themes:list,major_concepts:list,historical_context:str,content_warnings:list});
export const structureSchema=z.object({story_or_learning_arc:str,timeline:list,relationships:list,concept_hierarchy:list,chapter_roles:z.array(z.object({chapter_number:z.number().int().positive(),role:str}))});
export const stageSchemas={
  overview:overviewSchema,
  chapter_analysis:chapterSchema,
  characters:z.object({characters:z.array(characterSchema).max(40)}),
  character_roster:z.object({characters:z.array(z.object({name:str,aliases:list,role:str})).min(1).max(30)}),
  environments:z.object({environments:z.array(environmentSchema).max(40)}),
  themes:themesSchema,structure:structureSchema,
  scene_plan:z.object({scenes:z.array(sceneSchema).min(1).max(12)}),
  visual_style:visualSchema,narration_style:narrationSchema,
};
export type Stage=keyof typeof stageSchemas | "chapter_detection";