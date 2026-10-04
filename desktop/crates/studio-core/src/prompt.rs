use serde::{Deserialize, Serialize};
use crate::error::AppError;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptBlock {
    pub id: String,
    pub title: String,
    pub enabled: bool,
    pub text: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PromptDocument {
    pub mode: PromptMode,
    pub raw: String,
    // Application editor data only. The provider receives the compiled prompt.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub style_prompt: Option<String>,
    pub blocks: Vec<PromptBlock>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PromptMode { Raw, Layered }

impl PromptDocument {
    pub fn compile(&self) -> Result<String, AppError> {
        let style_len = self.style_prompt.as_ref().map_or(0, |style| style.len());
        if self.raw.len() > 131_072 || style_len > 131_072 || self.blocks.len() > 24 {
            return Err(AppError::invalid());
        }
        let mut seen = std::collections::HashSet::new();
        let mut total = self.raw.len() + style_len;
        for block in &self.blocks {
            total += block.text.len();
            if !crate::dto::valid_id(&block.id) || !seen.insert(&block.id)
                || block.title.len() > 160 || block.text.len() > 131_072 {
                return Err(AppError::invalid());
            }
        }
        if total > 262_144 { return Err(AppError::invalid()); }
        let mut out = String::new();
        if self.mode == PromptMode::Raw {
            out = self.raw.clone();
        } else {
            for block in self.blocks.iter().filter(|block| block.enabled) {
                let text = block.text.trim();
                if text.is_empty() { continue; }
                if !out.is_empty() {
                    out.push_str(if out.ends_with(',') || text.starts_with(',') { "\n" } else { ",\n" });
                }
                out.push_str(text);
            }
        }
        let style = self.style_prompt.as_deref().unwrap_or("").trim();
        if !style.is_empty() {
            let separator = if out.is_empty() { "" }
                else if style.ends_with(',') || out.starts_with(',') { "\n" }
                else { ",\n" };
            out = format!("{style}{separator}{out}");
        }
        if out.len() > 131_072 { return Err(AppError::invalid()); }
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shared_prompt_fixtures() {
        let fixtures: serde_json::Value = serde_json::from_str(include_str!("../../../contracts/prompt-v1.fixture.json")).unwrap();
        for fixture in fixtures.as_array().unwrap() {
            let doc: PromptDocument = serde_json::from_value(fixture["document"].clone()).unwrap();
            assert_eq!(doc.compile().unwrap(), fixture["expected"].as_str().unwrap());
        }
    }

    #[test]
    fn artist_text_is_bounded_and_must_match_the_compiled_draft() {
        let mut doc = PromptDocument { mode: PromptMode::Raw, raw: "body".into(), style_prompt: Some("artist:a".into()), blocks: vec![] };
        let draft = crate::dto::EditorDraft { prompt: "body".into(), negative_prompt: String::new(), prompt_document: Some(doc.clone()) };
        assert_eq!(draft.validate().unwrap_err().code, "prompt_mismatch");
        doc.style_prompt = Some("a".repeat(131_073));
        assert!(doc.compile().is_err());
        doc.style_prompt = Some("a".repeat(131_070));
        assert!(doc.compile().is_err());
    }
}
