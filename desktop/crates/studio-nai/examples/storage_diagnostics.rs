fn main(){
    let root=std::path::PathBuf::from(std::env::var_os("LOCALAPPDATA").expect("LOCALAPPDATA")).join("com.langbai.studio.pc.preview");
    match std::fs::create_dir_all(&root){Ok(())=>println!("root_create=ok"),Err(e)=>{println!("root_create=error os={:?} kind={:?}",e.raw_os_error(),e.kind());return;}}
    let test=root.join(format!("storage-probe-{}",std::process::id()));
    match std::fs::write(&test,b"diagnostic"){Ok(())=>{println!("root_write=ok");let _=std::fs::remove_file(test);},Err(e)=>println!("root_write=error os={:?} kind={:?}",e.raw_os_error(),e.kind())}
    let service=studio_nai::NaiService::new(root);
    match service.with_store(|s|s.list_history(&studio_core::dto::HistoryQuery{limit:Some(1),before:None})) {Ok(_)=>println!("history=ok"),Err(e)=>println!("history=error code={}",e.code)}
}
