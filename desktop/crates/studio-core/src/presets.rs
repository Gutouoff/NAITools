use serde::{Deserialize, Serialize};
use crate::{dto::{valid_id, EditorDraft}, error::AppError, generation::{GenerationInput, GenerationMode}};

/// Reusable drawing settings. Accounts, references and paid consent are deliberately excluded.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DrawingPreset {
    pub id: String,
    pub name: String,
    pub draft: EditorDraft,
    pub model: String,
    pub width: u32,
    pub height: u32,
    pub steps: u32,
    pub guidance: f64,
    pub sampler: String,
    pub seed: Option<u32>,
    pub strength: f64,
    pub noise: f64,
}
impl DrawingPreset {
    pub fn validate(&self) -> Result<(), AppError> {
        if !valid_id(&self.id) || self.name.trim().is_empty() || self.name.chars().count() > 80 {
            return Err(AppError::invalid());
        }
        GenerationInput {
            connection_id: None, draft: self.draft.clone(), model: self.model.clone(),
            mode: GenerationMode::Txt2img, width: self.width, height: self.height,
            steps: self.steps, guidance: self.guidance, sampler: self.sampler.clone(),
            seed: self.seed, image_id: None, strength: self.strength, noise: self.noise,
            vibes: vec![], confirm_paid: true,
        }.validate()
    }
}
