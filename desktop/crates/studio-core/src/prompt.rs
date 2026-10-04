use serde::{Deserialize,Serialize};
use crate::error::AppError;
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PromptBlock {pub id:String,pub title:String,pub enabled:bool,pub text:String}
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct PromptDocument {pub mode:PromptMode,pub raw:String,pub blocks:Vec<PromptBlock>}
#[derive(Debug,Clone,PartialEq,Eq,Serialize,Deserialize)]
#[serde(rename_all="snake_case")]
pub enum PromptMode {Raw,Layered}
impl PromptDocument {
    pub fn compile(&self)->Result<String,AppError>{
        if self.raw.len()>131_072 || self.blocks.len()>24 {return Err(AppError::invalid());}
        let mut seen=std::collections::HashSet::new();
        let mut total=self.raw.len();
        for b in &self.blocks {
            total+=b.text.len();
            if !crate::dto::valid_id(&b.id)||!seen.insert(&b.id)||b.title.len()>160||b.text.len()>131_072 {return Err(AppError::invalid());}
        }
        if total>262_144 {return Err(AppError::invalid());}
        if self.mode==PromptMode::Raw {return Ok(self.raw.clone());}
        let mut out=String::new();
        for b in self.blocks.iter().filter(|b|b.enabled) {
            let t=b.text.trim();if t.is_empty(){continue;}
            if !out.is_empty(){out.push_str(if out.ends_with(',')||t.starts_with(','){"\n"}else{",\n"});}
            out.push_str(t);
        }
        if out.len()>131_072 {return Err(AppError::invalid());}Ok(out)
    }
}
#[cfg(test)]mod tests {
    use super::*;
    #[test]fn shared_prompt_fixtures(){
        let fixtures:serde_json::Value=serde_json::from_str(include_str!("../../../contracts/prompt-v1.fixture.json")).unwrap();
        for f in fixtures.as_array().unwrap(){let doc:PromptDocument=serde_json::from_value(f["document"].clone()).unwrap();assert_eq!(doc.compile().unwrap(),f["expected"].as_str().unwrap());}
    }
}
