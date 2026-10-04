fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(tauri_build::AppManifest::new().commands(&["desktop_bootstrap", "desktop_mark_ready", "draft_load", "draft_save", "history_list", "history_request", "generation_submit", "credentials_status", "credentials_set", "credentials_delete", "image_import", "vibe_encode", "artifact_read", "artifact_export", "task_list", "task_acknowledge"]))).expect("Tauri metadata build failed");
}
