use serde::{Deserialize, Serialize};
use crate::{dto::valid_id, error::AppError};

pub const DEFAULT_CONNECTION: &str = "default-novelai";
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ConnectionProfile {
    pub id: String,
    pub name: String,
    pub kind: ConnectionKind,
    pub base_url: String,
    pub generation_path: String,
    pub encode_path: Option<String>,
    pub generation_usd: Option<f64>,
    pub encoding_usd: Option<f64>,
}
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionKind { Official, RelayNative }
impl ConnectionProfile {
    pub fn official() -> Self {
        Self { id: DEFAULT_CONNECTION.into(), name: "NovelAI 默认账号".into(), kind: ConnectionKind::Official,
            base_url: "https://image.novelai.net".into(), generation_path: "/ai/generate-image".into(),
            encode_path: Some("/ai/encode-vibe".into()), generation_usd: None, encoding_usd: None }
    }
    pub fn validate(&self) -> Result<(), AppError> {
        if !valid_id(&self.id) || self.id.len() > 80 || self.name.trim().is_empty() || self.name.len() > 160
            || self.name.chars().any(char::is_control) || self.base_url.len() > 2048
            || !self.base_url.starts_with("https://") || self.base_url.chars().any(|c|c.is_whitespace() || c.is_control()) {
            return Err(AppError::new("connection_invalid", "连接名称、标识或 HTTPS 地址无效。"));
        }
        fn path_ok(p: &str) -> bool {
            p.starts_with('/') && !p.starts_with("//") && p.len() <= 512
                && !p.contains(['?', '#', '%', '\\']) && !p.contains("..")
                && !p.chars().any(|c|c.is_whitespace() || c.is_control())
        }
        if !path_ok(&self.generation_path) || self.encode_path.as_ref().is_some_and(|p|!path_ok(p))
            || [self.generation_usd, self.encoding_usd].iter().flatten().any(|p|!p.is_finite() || !(0.0..=100.0).contains(p)) {
            return Err(AppError::new("connection_invalid", "请输入文档确认的接口路径与非负费用；不可包含查询参数或密钥。"));
        }
        if self.kind == ConnectionKind::Official && (self.base_url != "https://image.novelai.net"
            || self.generation_path != "/ai/generate-image" || self.encode_path.as_deref() != Some("/ai/encode-vibe")
            || self.generation_usd.is_some() || self.encoding_usd.is_some()) {
            return Err(AppError::new("connection_invalid", "官方账号使用固定 NovelAI 地址，费用由官方账户决定。"));
        }
        Ok(())
    }
}
