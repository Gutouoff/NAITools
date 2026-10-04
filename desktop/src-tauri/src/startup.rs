use std::path::{Path, PathBuf};

// PC Preview uses an executable-adjacent browser cache. This does not relocate
// SQLite, saved images or the Windows credential manager. No paid journal may
// be duplicated by copying/moving the executable.
pub fn webview_cache_dir(executable: &Path) -> std::io::Result<PathBuf> {
    executable.parent().filter(|p| !p.as_os_str().is_empty())
        .map(|parent| parent.join(".webview2-cache"))
        .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput,
            "Executable directory is unavailable"))
}

pub fn report_failure(error: &str) {
    // Called only for host/window initialization errors, never request bodies,
    // credentials or other service errors. Do not advise clearing user data.
    let log = std::env::current_exe().ok()
        .and_then(|exe| exe.parent().map(|p| p.join("startup-error.log")));
    let saved = log.as_ref().filter(|path| {
        std::fs::write(path, format!("NAITools host initialization failed\n{error}\n")).is_ok()
    });
    let details = match saved {
        Some(path) => format!("启动日志：{}", path.display()),
        None => format!("无法写入启动日志。错误：{error}"),
    };
    rfd::MessageDialog::new()
        .set_title("NAITools · 启动失败")
        .set_level(rfd::MessageLevel::Error)
        .set_description(format!(
            "未能初始化桌面窗口。请确认程序所在文件夹可写。\n\n{details}\n\n无需清空旧版账号、图片或任务记录。"))
        .show();
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cache_is_next_to_executable_and_independent_of_working_directory() {
        let executable = Path::new("release").join("naitools.exe");
        assert_eq!(webview_cache_dir(&executable).unwrap(),
            Path::new("release").join(".webview2-cache"));
    }
    #[test]
    fn cache_is_not_a_durable_store_file() {
        let executable = Path::new("pc-preview").join("naitools.exe");
        let cache = webview_cache_dir(&executable).unwrap();
        assert_ne!(cache.file_name().unwrap(), "studio.sqlite3");
        assert_ne!(cache.file_name().unwrap(), "outputs");
    }
    #[test]
    fn missing_executable_parent_is_rejected() {
        assert!(webview_cache_dir(Path::new("naitools.exe")).is_err());
    }
}
