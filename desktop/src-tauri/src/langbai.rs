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


use studio_nai::local_images::{self, LocalImage, MetadataSnapshot};

fn update_workbench(runtime: &Runtime, image: &LocalImage) -> Result<(), AppError> {
    *runtime.workbench.lock().map_err(|_| AppError::storage())? = Some(image.file_path.clone());
    Ok(())
}

#[tauri::command]
pub async fn langbai_image_pick(state: State<'_, Arc<Runtime>>) -> Result<Option<LocalImage>, AppError> {
    let runtime = state.inner().clone();
    service(runtime.clone(), move |native| {
        let Some(path) = rfd::FileDialog::new()
            .set_title("选择图像")
            .add_filter("图像文件", &["png", "jpg", "jpeg", "webp"])
            .pick_file() else { return Ok(None); };
        // Only this user-selected path grants filesystem access. The renderer
        // receives an owned opaque reference, never a general-purpose FS API.
        let bytes = studio_nai::assets::read_bounded(&path, studio_nai::assets::MAX_IMAGE)?;
        let image = local_images::import_bytes(&native.root, &bytes)?;
        update_workbench(&runtime, &image)?;
        Ok(Some(image))
    }).await
}

#[tauri::command]
pub async fn langbai_image_read(state: State<'_, Arc<Runtime>>, reference: String) -> Result<LocalImage, AppError> {
    let runtime = state.inner().clone();
    service(runtime.clone(), move |native| {
        let image = local_images::read_image(&native.root, &reference)?;
        update_workbench(&runtime, &image)?;
        Ok(image)
    }).await
}

#[tauri::command]
pub fn langbai_workbench_clear(state: State<'_, Arc<Runtime>>) -> Result<(), AppError> {
    // Forget the session's selected input, not the original image or history.
    *state.workbench.lock().map_err(|_| AppError::storage())? = None;
    Ok(())
}

#[tauri::command]
pub async fn langbai_metadata_read(
    state: State<'_, Arc<Runtime>>, reference: String, persist: bool,
) -> Result<MetadataSnapshot, AppError> {
    service(state.inner().clone(), move |native| {
        let snapshot = local_images::snapshot_from_reference(&native.root, &reference)?;
        if persist { local_images::save_snapshot(&native.root, &snapshot)?; }
        // Reading metadata must never replace the active workbench input.
        Ok(snapshot)
    }).await
}

#[tauri::command]
pub async fn langbai_metadata_save(
    state: State<'_, Arc<Runtime>>, snapshot: MetadataSnapshot,
) -> Result<(), AppError> {
    service(state.inner().clone(), move |native| local_images::save_snapshot(&native.root, &snapshot)).await
}

#[tauri::command]
pub async fn langbai_metadata_load(state: State<'_, Arc<Runtime>>) -> Result<Option<MetadataSnapshot>, AppError> {
    service(state.inner().clone(), |native| local_images::load_snapshot(&native.root)).await
}

use studio_core::langbai_history::{HistoryFilter, HistoryGroup, ReceiptPage};

#[tauri::command]
pub async fn langbai_history_page(state: State<'_, Arc<Runtime>>, filter: HistoryFilter) -> Result<ReceiptPage, AppError> {
    service(state.inner().clone(), move |n| n.with_store(|s| s.langbai_history_page(&filter))).await
}
#[tauri::command]
pub async fn langbai_history_days(state: State<'_, Arc<Runtime>>) -> Result<Vec<i64>, AppError> {
    service(state.inner().clone(), |n| n.with_store(|s| s.langbai_history_days())).await
}
#[tauri::command]
pub async fn langbai_history_groups(state: State<'_, Arc<Runtime>>) -> Result<Vec<HistoryGroup>, AppError> {
    service(state.inner().clone(), |n| n.with_store(|s| s.langbai_history_groups())).await
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase")]
pub enum GroupAction { Create, Rename, Delete }
#[tauri::command]
pub async fn langbai_history_group_edit(state: State<'_, Arc<Runtime>>, action: GroupAction, id: Option<String>, name: Option<String>) -> Result<Vec<HistoryGroup>, AppError> {
    service(state.inner().clone(), move |n| n.with_store(|s| match action {
        GroupAction::Create => {
            let at=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|AppError::storage())?.as_millis().try_into().map_err(|_|AppError::storage())?;
            s.langbai_create_history_group(&studio_nai::new_local_id(),&name.ok_or_else(AppError::invalid)?,at)
        },
        GroupAction::Rename => s.langbai_rename_history_group(&id.ok_or_else(AppError::invalid)?,&name.ok_or_else(AppError::invalid)?),
        GroupAction::Delete => s.langbai_delete_history_group(&id.ok_or_else(AppError::invalid)?),
    })).await
}
#[tauri::command]
pub async fn langbai_history_group_set(state: State<'_, Arc<Runtime>>, id: String, group_id: Option<String>) -> Result<(), AppError> {
    service(state.inner().clone(), move |n| n.with_store(|s| s.langbai_set_history_group(&id,group_id.as_deref()))).await
}

#[tauri::command]
pub async fn langbai_references_list(state: State<'_, Arc<Runtime>>) -> Result<studio_core::reference_presets::ReferenceLibrary, AppError> {
    service(state.inner().clone(), |native| studio_nai::reference_presets::list(&native.root)).await
}
#[tauri::command]
pub async fn langbai_reference_save(state: State<'_, Arc<Runtime>>, request: studio_nai::reference_presets::SaveRequest) -> Result<studio_core::reference_presets::ReferenceLibrary, AppError> {
    service(state.inner().clone(), move |native| studio_nai::reference_presets::save(&native.root,request)).await
}
#[tauri::command]
pub async fn langbai_reference_read(state: State<'_, Arc<Runtime>>, id: String) -> Result<studio_nai::reference_presets::ReadResult, AppError> {
    service(state.inner().clone(), move |native| studio_nai::reference_presets::read(&native.root,&id)).await
}
#[tauri::command]
pub async fn langbai_reference_edit(state: State<'_, Arc<Runtime>>, action: studio_nai::reference_presets::EditAction, id: Option<String>, group: Option<String>) -> Result<studio_core::reference_presets::ReferenceLibrary, AppError> {
    service(state.inner().clone(), move |native| studio_nai::reference_presets::edit(&native.root,action,id.as_deref(),group.as_deref())).await
}
