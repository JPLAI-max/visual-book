// Production-life-stage variants do not mutate or rewrite the original Book Intelligence records.
export function childhoodReference(name:string,data:Record<string,unknown>) {
  return {...data,life_stage:"childhood",role:`${name} at the childhood life stage, not the later adult`,
    age_or_age_range:"A five-year-old child (exact age is an explicitly labeled production interpretation).",
    clothing:"A modest fully clothed late-eighteenth-century child's frock or child's suit, age appropriate, with sleeves and covered body. No adult tailoring or cosmetics.",
    height_build:"Visibly small five-year-old child's body, short limbs, child-sized hands and feet, round head proportionately large for a child's body. Not an adolescent.",
    facial_structure:"Round young child's cheeks and small nose; no mature adult or adolescent facial anatomy. Proposed visual design, not an asserted source fact.",
    body_language:"Quiet, natural child posture in a neutral reference pose.",relationships:[],
    canonical_visual_description:`${name} as a very young fully clothed child, visibly approximately five, not a teenager or adult. ${data.hair}; ${data.eyes}.`,
    canonical_generation_prompt:`A full-length reference study of a fully clothed FIVE-YEAR-OLD CHILD ${name}, unmistakably small and young, rounded child face and proportionately large head. ${data.hair}; ${data.eyes}. Modest authentic eighteenth-century child's clothing. Neutral plain painterly backdrop. No adults in the image. Not a teenager. No adult face. No makeup.`,
    consistency_notes:"Childhood production variant. Preserve explicitly source-supported hair/eyes. Unspecified physical appearance is an acknowledged casting/design choice. Neutral reference background is intentional.",
  };
}
export function lakeComoReference(data:Record<string,unknown>,sceneId:number) {
  return {...data,life_stage:"lake_como_adoption",name:"Lake Como — Elizabeth's adoption",location:"Lake Como, northern Italy; NOT Lake Geneva or Belrive",
    mood:"Tender, luminous, restrained",type:"Northern Italian lakeside peasant home and path",weather:"Mild clear daylight; production choice",
    architecture:"Modest late-eighteenth-century northern Italian rural stone and plaster dwelling with simple wooden doorway. Architectural details are proposed production choices.",
    exterior_description:"Humble peasant household beside a northern Italian lake, rural path, Alpine foothills and softly lit water. Lake Como geography, no Swiss chateau or prosperous Belrive mansion.",
    interior_description:"Simple impoverished peasant dwelling, not an affluent Geneva residence.",furniture:"A few simple wooden household furnishings; proposed design choices",important_props:[],
    canonical_generation_prompt:"Wide establishing reference of a humble rural dwelling and path near Lake Como in late-eighteenth-century northern Italy. Painterly cinematic realism, luminous quiet daylight, Alpine foothills and lake water. Modest peasant setting. No characters, no captions, no modern boats, no Belrive mansion.",
    consistency_notes:"Production-only grounding correction. Saved blueprint erroneously linked the Como adoption scene to Belrive / Lake Geneva. Use source-described Lake Como; retain original analysis for audit.",
    source_blueprint_scene_id:sceneId,source_blueprint_environment_id:5,
  };
}