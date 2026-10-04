use serde::{Deserialize, Serialize};

use crate::error::AppError;

pub const IPC_SCHEMA_VERSION: u32 = 2;

// LOCAL editor draft, NOT a NovelAI request. No guessed model/sampler/seed defaults.

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]

#[serde(rename_all = "camelCase", deny_unknown_fields)]

pub struct EditorDraft {

    pub prompt: String, pub negative_prompt: String,

    #[serde(default, skip_serializing_if = "Option::is_none")]

    pub prompt_document: Option<crate::prompt::PromptDocument>,

}

impl EditorDraft {

    pub fn validate(&self) -> Result<(), AppError> {

        if self.prompt.len() > 131_072 || self.negative_prompt.len() > 131_072 { return Err(AppError::invalid()); }

        if let Some(doc) = &self.prompt_document {

            if doc.compile()? != self.prompt { return Err(AppError::new("prompt_mismatch", "分层预览与实际提示词不一致；未保存或提交。")); }

        }

        Ok(())

    }

}

#[derive(Debug, Clone, Serialize, Deserialize)]

#[serde(rename_all = "camelCase", deny_unknown_fields)]

pub struct HistoryCursor { pub created_at_ms: i64, pub id: String }

#[derive(Debug, Clone, Default, Serialize, Deserialize)]

#[serde(rename_all = "camelCase", deny_unknown_fields)]

pub struct HistoryQuery { pub limit: Option<u32>, pub before: Option<HistoryCursor> }

impl HistoryQuery {

    pub fn page_size(&self) -> Result<u32, AppError> {

        let limit = self.limit.unwrap_or(50);

        if !(1..=100).contains(&limit) { return Err(AppError::invalid()); }

        if self.before.as_ref().is_some_and(|c| c.created_at_ms < 0 || !valid_id(&c.id)) { return Err(AppError::invalid()); }

        Ok(limit)

    }

}

pub fn valid_id(id: &str) -> bool {

    !id.is_empty() && id.len() <= 64 && id.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')

}

#[derive(Debug, Clone, Serialize, Deserialize)]

#[serde(rename_all = "camelCase", deny_unknown_fields)]

pub struct HistoryItem { pub id: String, pub created_at_ms: i64, pub prompt: String, pub artifact_id: String }

#[derive(Debug, Clone, Serialize, Deserialize)]

#[serde(rename_all = "camelCase", deny_unknown_fields)]

pub struct HistoryPage { pub items: Vec<HistoryItem>, pub next_cursor: Option<HistoryCursor> }

