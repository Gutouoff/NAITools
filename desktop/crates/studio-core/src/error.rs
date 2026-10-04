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
        Self::new("storage_unavailable", "无法打开或写入本地数据；请求不会自动重试。")
    }
    pub fn storage_io(error: &std::io::Error) -> Self {
        if error.kind() == std::io::ErrorKind::PermissionDenied {
            Self::new("storage_access_denied", "当前进程无权读写本地数据。请检查 Windows 账户及应用数据目录的写入权限；未自动重试。")
        } else { Self::storage() }
    }
    pub fn storage_database(error: &rusqlite::Error) -> Self {
        use rusqlite::ErrorCode;
        let Some(code) = error.sqlite_error_code() else { return Self::storage(); };
        match code {
            ErrorCode::PermissionDenied | ErrorCode::AuthorizationForStatementDenied => Self::new("storage_access_denied", "本地数据库访问被拒绝。请检查应用数据目录的访问权限；未自动重试。"),
            ErrorCode::ReadOnly => Self::new("storage_read_only", "本地数据库处于只读状态。请检查数据库及其所在目录的写入权限；未自动重试。"),
            ErrorCode::DatabaseBusy | ErrorCode::DatabaseLocked => Self::new("storage_busy", "本地数据库被占用。请关闭其他 NAITools 实例后手动重试；未自动重试。"),
            ErrorCode::DiskFull => Self::new("storage_full", "本地数据所在磁盘空间不足。请释放磁盘空间后手动重试；未自动重试。"),
            ErrorCode::DatabaseCorrupt | ErrorCode::NotADatabase => Self::new("storage_corrupt", "本地数据库格式异常或损坏。请保留数据库及日志文件并备份，不要删除任务记录或重新提交付费请求。"),
            _ => Self::storage(),
        }
    }
    pub fn invalid() -> Self { Self::new("invalid_input", "输入格式或长度不符合本地接口约束。") }
}
impl std::fmt::Display for AppError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { write!(f, "{}", self.code) }
}
impl std::error::Error for AppError {}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn storage_errors_are_actionable_without_raw_details() {
        let io = std::io::Error::new(std::io::ErrorKind::PermissionDenied, "private path and data");
        let error = AppError::storage_io(&io);
        assert_eq!(error.code, "storage_access_denied");
        assert!(!error.retryable);
        assert!(!serde_json::to_string(&error).unwrap().contains("private"));
        assert_eq!(AppError::storage_io(&std::io::Error::from(std::io::ErrorKind::Other)).code, "storage_unavailable");
        for (number, expected) in [(8, "storage_read_only"), (5, "storage_busy"), (6, "storage_busy"), (13, "storage_full"), (11, "storage_corrupt"), (26, "storage_corrupt")] {
            let sql = rusqlite::Error::SqliteFailure(rusqlite::ffi::Error::new(number), Some("private SQL".into()));
            let error = AppError::storage_database(&sql);
            assert_eq!(error.code, expected);
            assert!(!error.retryable);
            assert!(!serde_json::to_string(&error).unwrap().contains("private"));
        }
    }
}
