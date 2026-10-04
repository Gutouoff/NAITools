#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]
use std::{sync::{Arc,Mutex},time::Instant};
use serde::Serialize;
use tauri::{Manager,State,WebviewWindowBuilder};
mod startup;
use studio_core::{contract::{self,NaiContractStatus},dto::*,error::AppError,generation::GenerationInput,store::TaskRecord};
use studio_nai::{NaiService,GenerationResult,EncodeInput,assets::{ImageAsset,VibeAsset}};
struct Runtime {started:Instant,renderer_ready:Mutex<Option<u64>>,service:NaiService}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
struct BootInfo {schema_version:u32,app_version:&'static str,runtime:&'static str,storage:&'static str,host_elapsed_ms:u64,renderer_ready_host_ms:Option<u64>,nai_contract:NaiContractStatus}
fn boot_info(s:&Runtime)->Result<BootInfo,AppError>{Ok(BootInfo{schema_version:IPC_SCHEMA_VERSION,app_version:env!("CARGO_PKG_VERSION"),runtime:"tauri",storage:"isolated_sqlite_lazy",host_elapsed_ms:s.started.elapsed().as_millis() as u64,renderer_ready_host_ms:*s.renderer_ready.lock().map_err(|_|AppError::storage())?,nai_contract:contract::status()})}
#[tauri::command]fn desktop_bootstrap(state:State<'_,Arc<Runtime>>)->Result<BootInfo,AppError>{boot_info(&state)}
#[tauri::command]fn desktop_mark_ready(state:State<'_,Arc<Runtime>>)->Result<BootInfo,AppError>{state.renderer_ready.lock().map_err(|_|AppError::storage())?.get_or_insert(state.started.elapsed().as_millis() as u64);boot_info(&state)}
async fn service<T:Send+'static>(s:Arc<Runtime>,f:impl FnOnce(&NaiService)->Result<T,AppError>+Send+'static)->Result<T,AppError>{tauri::async_runtime::spawn_blocking(move||f(&s.service)).await.map_err(|_|AppError::storage())?}
#[tauri::command]async fn draft_load(state:State<'_,Arc<Runtime>>)->Result<EditorDraft,AppError>{service(state.inner().clone(),|n|n.with_store(|s|s.load_draft())).await}
#[tauri::command]async fn draft_save(state:State<'_,Arc<Runtime>>,draft:EditorDraft)->Result<(),AppError>{draft.validate()?;service(state.inner().clone(),move|n|n.with_store(|s|s.save_draft(&draft))).await}
#[tauri::command]async fn history_list(state:State<'_,Arc<Runtime>>,query:HistoryQuery)->Result<HistoryPage,AppError>{query.page_size()?;service(state.inner().clone(),move|n|n.with_store(|s|s.list_history(&query))).await}
#[tauri::command]async fn history_request(state:State<'_,Arc<Runtime>>,id:String)->Result<GenerationInput,AppError>{service(state.inner().clone(),move|n|n.with_store(|s|s.history_request(&id))).await}
#[tauri::command]async fn generation_submit(state:State<'_,Arc<Runtime>>,input:GenerationInput)->Result<GenerationResult,AppError>{service(state.inner().clone(),move|n|n.generate(input)).await}
#[tauri::command]async fn credentials_status(state:State<'_,Arc<Runtime>>)->Result<bool,AppError>{service(state.inner().clone(),|_|studio_nai::credentials::status()).await}
#[tauri::command]async fn credentials_set(state:State<'_,Arc<Runtime>>,token:String)->Result<(),AppError>{service(state.inner().clone(),move|n|n.set_connection_token(studio_core::connections::DEFAULT_CONNECTION,token)).await}
#[tauri::command]async fn credentials_delete(state:State<'_,Arc<Runtime>>)->Result<(),AppError>{service(state.inner().clone(),|n|n.delete_connection_token(studio_core::connections::DEFAULT_CONNECTION)).await}
#[tauri::command]async fn image_import(state:State<'_,Arc<Runtime>>,base64:String)->Result<ImageAsset,AppError>{service(state.inner().clone(),move|n|n.import_image(&base64)).await}
#[tauri::command]async fn vibe_encode(state:State<'_,Arc<Runtime>>,input:EncodeInput)->Result<VibeAsset,AppError>{service(state.inner().clone(),move|n|n.encode(input)).await}
#[tauri::command]async fn artifact_read(state:State<'_,Arc<Runtime>>,id:String,thumbnail:bool)->Result<String,AppError>{service(state.inner().clone(),move|n|n.artifact(&id,thumbnail)).await}
#[tauri::command]async fn artifact_export(state:State<'_,Arc<Runtime>>,id:String)->Result<bool,AppError>{
    service(state.inner().clone(),move|n|{
        let bytes=studio_nai::assets::read_bounded(&studio_nai::assets::path(&n.root,"outputs",&id,"png")?,studio_nai::assets::MAX_IMAGE)?;
        let Some(target)=rfd::FileDialog::new().add_filter("PNG image",&["png"]).set_file_name(format!("novelai-{id}.png")).save_file() else{return Ok(false)};
        // The path is chosen by the user in a native dialog, never supplied by renderer.
        std::fs::write(target,bytes).map_err(|_|AppError::storage())?;Ok(true)
    }).await
}
#[tauri::command]async fn task_list(state:State<'_,Arc<Runtime>>)->Result<Vec<TaskRecord>,AppError>{service(state.inner().clone(),|n|n.with_store(|s|s.task_list())).await}
#[tauri::command]async fn task_acknowledge(state:State<'_,Arc<Runtime>>,id:String)->Result<(),AppError>{service(state.inner().clone(),move|n|n.with_store(|s|s.acknowledge_unknown(&id))).await}
#[tauri::command]async fn connections_list(state:State<'_,Arc<Runtime>>,check_credentials:Option<bool>)->Result<Vec<studio_nai::ConnectionStatus>,AppError>{service(state.inner().clone(),move|n|n.connections(check_credentials.unwrap_or(true))).await}
#[tauri::command]async fn connection_save(state:State<'_,Arc<Runtime>>,profile:studio_core::connections::ConnectionProfile)->Result<(),AppError>{service(state.inner().clone(),move|n|n.save_connection(profile)).await}
#[tauri::command]async fn connection_delete(state:State<'_,Arc<Runtime>>,id:String)->Result<(),AppError>{service(state.inner().clone(),move|n|n.delete_connection(&id)).await}
#[tauri::command]async fn connection_token_set(state:State<'_,Arc<Runtime>>,id:String,token:String)->Result<(),AppError>{service(state.inner().clone(),move|n|n.set_connection_token(&id,token)).await}
#[tauri::command]async fn connection_token_delete(state:State<'_,Arc<Runtime>>,id:String)->Result<(),AppError>{service(state.inner().clone(),move|n|n.delete_connection_token(&id)).await}
#[tauri::command]async fn drawing_presets_list(state:State<'_,Arc<Runtime>>)->Result<Vec<studio_core::presets::DrawingPreset>,AppError>{service(state.inner().clone(),|n|n.with_store(|s|s.drawing_presets())).await}
#[tauri::command]async fn drawing_preset_save(state:State<'_,Arc<Runtime>>,preset:studio_core::presets::DrawingPreset)->Result<(),AppError>{preset.validate()?;service(state.inner().clone(),move|n|n.with_store(|s|s.save_drawing_preset(&preset))).await}
#[tauri::command]async fn drawing_preset_delete(state:State<'_,Arc<Runtime>>,id:String)->Result<(),AppError>{service(state.inner().clone(),move|n|n.with_store(|s|s.delete_drawing_preset(&id))).await}
fn setup_runtime(app: &mut tauri::App, started: Instant) -> Result<(), Box<dyn std::error::Error>> {
    // Browser cache is disposable. Durable tasks, images and credentials retain
    // their existing per-user locations even when the executable is moved.
    let root = app.path().app_local_data_dir()?;
    let cache = startup::webview_cache_dir(&std::env::current_exe()?)?;
    std::fs::create_dir_all(&cache)?;
    app.manage(Arc::new(Runtime {
        started,
        renderer_ready: Mutex::new(None),
        service: NaiService::new(root),
    }));
    let config = app.config();
    let window = config.app.windows.iter().find(|w| w.label == "main")
        .ok_or("Missing main window configuration")?;
    WebviewWindowBuilder::from_config(app.handle(), window)?
        .data_directory(cache)
        .build()?;
    Ok(())
}
fn main(){let started=Instant::now();let result=tauri::Builder::default().setup(move|app|{
    if let Err(error) = setup_runtime(app, started) {
        startup::report_failure(&error.to_string());
        std::process::exit(1);
    }
    Ok(())
})
.invoke_handler(tauri::generate_handler![desktop_bootstrap,desktop_mark_ready,draft_load,draft_save,history_list,history_request,generation_submit,credentials_status,credentials_set,credentials_delete,image_import,vibe_encode,artifact_read,artifact_export,task_list,task_acknowledge,connections_list,connection_save,connection_delete,connection_token_set,connection_token_delete,drawing_presets_list,drawing_preset_save,drawing_preset_delete])
.run(tauri::generate_context!());
    if let Err(error) = result {
        startup::report_failure(&error.to_string());
        std::process::exit(1);
    }
}
