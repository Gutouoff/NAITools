use serde::{Deserialize,Serialize};
use serde_json::{json,Value};
use crate::{dto::{valid_id,EditorDraft},error::AppError};
// Deliberately bounded local product subset, NOT the service's universal limits.
pub const MODELS:[&str;2]=["nai-diffusion-4-5-full","nai-diffusion-4-5-curated"];
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct VibeInput {pub encoding_id:String,pub strength:f64}
#[derive(Debug,Clone,Copy,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum GenerationMode{Txt2img,I2i}
#[derive(Debug,Clone,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct GenerationInput {
    #[serde(default)] pub connection_id:Option<String>,
    pub draft:EditorDraft,pub model:String,pub mode:GenerationMode,
    pub width:u32,pub height:u32,pub steps:u32,pub guidance:f64,pub sampler:String,
    pub seed:Option<u32>,pub image_id:Option<String>,pub strength:f64,pub noise:f64,
    pub vibes:Vec<VibeInput>,pub confirm_paid:bool,
}
impl GenerationInput {
    pub fn validate(&self)->Result<(),AppError>{
        self.draft.validate()?;
        if self.connection_id.as_ref().is_some_and(|id|!valid_id(id)){return Err(AppError::invalid());}
        if !self.confirm_paid{return Err(AppError::new("confirmation_required","需要用户显式确认可能产生费用；未发送请求。"));}
        if self.draft.prompt.trim().is_empty(){return Err(AppError::new("empty_prompt","请输入正向提示词。"));}
        if !MODELS.contains(&self.model.as_str())||!["k_euler","k_euler_ancestral"].contains(&self.sampler.as_str()){
            return Err(AppError::new("unsupported_profile","当前仅支持已核验的 V4.5 Full/Curated 与 Euler/Euler a 子集。"));
        }
        if !(256..=1536).contains(&self.width)||!(256..=1536).contains(&self.height)||self.width%64!=0||self.height%64!=0||self.width as u64*self.height as u64>1_048_576||!(1..=28).contains(&self.steps)||!self.guidance.is_finite()||!(1.0..=10.0).contains(&self.guidance){
            return Err(AppError::new("local_safety_limit","参数超出本版本的保守安全范围；这是应用限制，不是 NAI 全部规格。"));
        }
        if self.vibes.len()>4||!self.strength.is_finite()||!(0.0..=1.0).contains(&self.strength)||!self.noise.is_finite()||!(0.0..=1.0).contains(&self.noise){return Err(AppError::invalid());}
        if self.mode==GenerationMode::I2i && self.image_id.is_none(){return Err(AppError::new("image_required","i2i 需要导入底图。"));}
        if self.mode==GenerationMode::Txt2img && self.image_id.is_some(){return Err(AppError::invalid());}
        if self.image_id.as_ref().is_some_and(|id|!valid_id(id)){return Err(AppError::invalid());}
        let mut total=0.0;let mut ids=std::collections::HashSet::new();
        for v in &self.vibes {if !valid_id(&v.encoding_id)||!ids.insert(&v.encoding_id)||!v.strength.is_finite()||!(0.0..=1.0).contains(&v.strength){return Err(AppError::invalid());}total+=v.strength;}
        if total>1.000001{return Err(AppError::new("vibe_strength_sum","当前版本要求氛围参考总强度不超过 1；不会自动归一化或改变您的权重。"));}Ok(())
    }
}
pub struct ResolvedVibe{pub data:String,pub information_extracted:f64,pub strength:f64}
// Only data resolved by native storage can reach these fields; UI cannot submit raw remote JSON.
pub fn build_wire(input:&GenerationInput,seed:u32,image:Option<String>,vibes:Vec<ResolvedVibe>)->Result<Value,AppError>{
    input.validate()?;
    if vibes.len()!=input.vibes.len()||image.is_some()!=(input.mode==GenerationMode::I2i){return Err(AppError::invalid());}
    let mut p=json!({"params_version":4,"width":input.width,"height":input.height,"steps":input.steps,"scale":input.guidance,
        "sampler":input.sampler,"seed":seed,"n_samples":1,"noise_schedule":"karras","cfg_rescale":0,
        "negative_prompt":input.draft.negative_prompt,"dynamic_thresholding":false,"image_format":"png",
        "v4_prompt":{"caption":{"base_caption":input.draft.prompt,"char_captions":[]},"use_coords":false,"use_order":true},
        "v4_negative_prompt":{"caption":{"base_caption":input.draft.negative_prompt,"char_captions":[]},"legacy_uc":false}});
    if input.sampler=="k_euler_ancestral"{p["deliberate_euler_ancestral_bug"]=json!(false);p["prefer_brownian"]=json!(true);}
    if let Some(image)=image{p["image"]=json!(image);p["strength"]=json!(input.strength);p["noise"]=json!(input.noise);p["extra_noise_seed"]=json!(i64::from(seed)-1);p["color_correct"]=json!(false);}
    if !vibes.is_empty(){p["reference_image_multiple"]=json!(vibes.iter().map(|v|&v.data).collect::<Vec<_>>());// Information extraction was already applied by /ai/encode-vibe. Do not apply it twice.
        p["reference_strength_multiple"]=json!(vibes.iter().map(|v|v.strength).collect::<Vec<_>>());}
    Ok(json!({"input":input.draft.prompt,"model":input.model,"action":if input.mode==GenerationMode::I2i{"img2img"}else{"generate"},"parameters":p}))
}
#[cfg(test)]mod tests{
    use super::*;
    fn input()->GenerationInput{serde_json::from_value(serde_json::from_str::<Value>(include_str!("../../../contracts/generation-v1.fixture.json")).unwrap()["input"].clone()).unwrap()}
    #[test]fn shared_wire_fixture(){let fixture:Value=serde_json::from_str(include_str!("../../../contracts/generation-v1.fixture.json")).unwrap();assert_eq!(build_wire(&input(),42,None,vec![]).unwrap(),fixture["expectedWire"]);}
    #[test]fn reject_unreviewed_or_unconfirmed(){let mut i=input();i.confirm_paid=false;assert_eq!(i.validate().unwrap_err().code,"confirmation_required");i.confirm_paid=true;i.model="made-up-model".into();assert!(i.validate().is_err());}
    #[test]fn i2i_and_vibes_are_not_conflated(){let mut i=input();i.mode=GenerationMode::I2i;i.image_id=Some("input-1".into());i.vibes=vec![VibeInput{encoding_id:"encoded-1".into(),strength:0.5}];let w=build_wire(&i,7,Some("PNG_INPUT".into()),vec![ResolvedVibe{data:"ENCODED_BINARY".into(),information_extracted:0.8,strength:0.5}]).unwrap();assert_eq!(w["action"],"img2img");assert_eq!(w["parameters"]["image"],"PNG_INPUT");assert_eq!(w["parameters"]["reference_image_multiple"][0],"ENCODED_BINARY");assert!(w["parameters"].get("reference_information_extracted_multiple").is_none());}
    #[test]fn local_bounds_reject_overload_and_invalid_numbers(){let mut i=input();i.width=1536;i.height=1536;assert!(i.validate().is_err());i=input();i.guidance=f64::NAN;assert!(i.validate().is_err());i=input();i.seed=Some(u32::MAX);assert!(i.validate().is_ok());}
}
