use serde::Serialize;
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: &'static str,
    pub message: &'static str,
    pub retryable: bool,
}
impl AppError {
    pub const fn new(code: &'static str, message: &'static str) -> Self {
        Self { code, message, retryable: false }
    }
    pub fn storage() -> Self {
        // No raw SQL, credentials, or filesystem paths cross the WebView boundary.
        Self::new("storage_unavailable", "本地存储暂不可用；请勿重复提交生图任务。")
    }
    pub fn invalid() -> Self { Self::new("invalid_input", "输入格式或长度不符合本地接口约束。") }
}
impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { write!(f, "{}", self.code) }
}
impl std::error::Error for AppError {}
