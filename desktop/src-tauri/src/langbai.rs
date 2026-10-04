//! Narrow commands for the original renderer. No arbitrary Electron IPC router.
use crate::{service, Runtime};
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;
use studio_core::error::AppError;
use tauri::{Manager, State, WebviewWindow};

#[tauri::command]
pub async fn langbai_settings_get(
    app: tauri::AppHandle,
    state: State<'_, Arc<Runtime>>,
) -> Result<Value, AppError> {
    // Same per-user database as the existing PC app. A read failure is not
    // replaced by defaults or a different storage directory.
    let output = app.path().picture_dir()
        .map_err(|_| AppError::storage())?
        .join("NAITools")
        .to_string_lossy()
        .into_owned();
    service(state.inner().clone(), move |native| {
        let mut settings = native.with_store(|store| store.langbai_settings())?;
        settings["outputDir"] = Value::String(output);
        Ok(settings)
    }).await
}

#[tauri::command]
pub async fn langbai_setting_set(
    state: State<'_, Arc<Runtime>>,
    key: String,
    value: Value,
) -> Result<Value, AppError> {
    service(state.inner().clone(), move |native| {
        native.with_store(|store| store.langbai_set_setting(&key, &value))?;
        Ok(value)
    }).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum WindowAction {
    Minimize,
    Maximize,
    Close,
    StartDragging,
}

#[tauri::command]
pub fn langbai_window_action(window: WebviewWindow, action: WindowAction) -> Result<(), AppError> {
    if window.label() != "main" {
        return Err(AppError::invalid());
    }
    let result = match action {
        WindowAction::Minimize => window.minimize(),
        WindowAction::Maximize => window.is_maximized().and_then(|maximized| {
            if maximized { window.unmaximize() } else { window.maximize() }
        }),
        WindowAction::Close => window.close(),
        WindowAction::StartDragging => window.start_dragging(),
    };
    result.map_err(|_| AppError::new("window_action_failed", "窗口操作未完成。"))
}
