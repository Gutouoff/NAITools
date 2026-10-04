pub mod assets;
pub mod local_images;
pub mod credentials;
mod http;
use assets::{ImageAsset,VibeAsset,VibeMeta};
use base64::{engine::general_purpose::STANDARD,Engine};
use serde::{Serialize,Deserialize};
use serde_json::{json,Value};
use sha2::{Digest,Sha256};
use std::{path::PathBuf,sync::Mutex,time::{SystemTime,UNIX_EPOCH}};
use studio_core::{error::AppError,dto::{HistoryItem,valid_id},store::Store,generation::{GenerationInput,GenerationMode,ResolvedVibe,MODELS,build_wire}};
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct GenerationResult {pub task_id:String,pub artifact_id:String,pub seed:u32,pub image_url:String}
#[derive(Deserialize,Serialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub struct EncodeInput {#[serde(default)] pub connection_id:Option<String>,pub image_id:String,pub model:String,pub information_extracted:f64,pub confirm_paid:bool}
#[derive(Serialize)]
#[serde(rename_all="camelCase")]
pub struct ConnectionStatus {pub profile:studio_core::connections::ConnectionProfile,pub has_token:Option<bool>}
pub struct NaiService {pub root:PathBuf,store:Mutex<Option<Store>>,remote:Mutex<()>}
fn now()->i64{SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as i64}
impl NaiService {
    pub fn new(root:PathBuf)->Self{Self{root,store:Mutex::new(None),remote:Mutex::new(())}}
    pub fn with_store<T>(&self,f:impl FnOnce(&mut Store)->Result<T,AppError>)->Result<T,AppError>{
        let mut slot=self.store.lock().map_err(|_|AppError::storage())?;
        if slot.is_none(){let s=Store::open(&self.root.join("studio.sqlite3"))?;s.recover_uncertain_tasks()?;*slot=Some(s);}
        f(slot.as_mut().ok_or_else(AppError::storage)?)
    }
    pub fn connections(&self,check_credentials:bool)->Result<Vec<ConnectionStatus>,AppError>{
        let profiles=self.with_store(|s|s.connections())?;
        Ok(profiles.into_iter().map(|profile|ConnectionStatus{has_token:if check_credentials{credentials::status_for(&profile.id).ok()}else{None},profile}).collect())
    }
    pub fn save_connection(&self,profile:studio_core::connections::ConnectionProfile)->Result<(),AppError>{
        http::validate_profile(&profile)?;
        let _guard=self.remote.try_lock().map_err(|_|AppError::new("remote_busy","付费任务进行中，不能修改连接。"))?;
        self.with_store(|s|s.save_connection(&profile))
    }
    pub fn delete_connection(&self,id:&str)->Result<(),AppError>{
        let _guard=self.remote.try_lock().map_err(|_|AppError::new("remote_busy","付费任务进行中，不能删除连接。"))?;
        if id==studio_core::connections::DEFAULT_CONNECTION {return Err(AppError::new("default_connection","默认账号不能删除；可以删除其凭据。"));}
        self.with_store(|s|{s.connection(id)?;credentials::delete_for(id)?;s.delete_connection(id)})
    }
    pub fn set_connection_token(&self,id:&str,token:String)->Result<(),AppError> {
        let _guard=self.remote.try_lock().map_err(|_|AppError::new("remote_busy","付费任务进行中，不能修改凭据。"))?;
        // Rotate before writing the OS credential: even a later failure must not
        // leave an encoding from a different account reusable under this profile.
        self.with_store(|s|s.rotate_connection_revision(id,&uuid::Uuid::new_v4().to_string()))?;
        credentials::set_for(id,token)
    }
    pub fn delete_connection_token(&self,id:&str)->Result<(),AppError> {
        let _guard=self.remote.try_lock().map_err(|_|AppError::new("remote_busy","付费任务进行中，不能删除凭据。"))?;
        self.with_store(|s|s.rotate_connection_revision(id,&uuid::Uuid::new_v4().to_string()))?;
        credentials::delete_for(id)
    }
    fn connection_scope(&self,id:Option<&str>)->Result<String,AppError>{
        let profile=self.with_store(|s|s.connection(id.unwrap_or(studio_core::connections::DEFAULT_CONNECTION)))?;
        let mut h=Sha256::new();h.update(profile.id.as_bytes());h.update(profile.base_url.as_bytes());
        h.update(profile.generation_path.as_bytes());h.update(profile.encode_path.as_deref().unwrap_or("").as_bytes());
        h.update(self.with_store(|s|s.connection_revision(&profile.id))?.as_bytes());
        Ok(format!("{:x}",h.finalize()))
    }
    pub fn import_image(&self,base64:&str)->Result<ImageAsset,AppError>{assets::import(&self.root,base64)}
    pub fn artifact(&self,id:&str,thumb:bool)->Result<String,AppError>{let b=assets::read_bounded(&assets::path(&self.root,"outputs",id,"png")?,assets::MAX_IMAGE)?;if thumb{assets::thumbnail(&b)}else{Ok(assets::data_url(&b))}}
    pub fn artifact_metadata(&self,id:&str)->Result<assets::ArtifactMetadata,AppError>{let b=assets::read_bounded(&assets::path(&self.root,"outputs",id,"png")?,assets::MAX_IMAGE)?;assets::metadata(&b)}
    fn source(&self,id:&str)->Result<Vec<u8>,AppError>{assets::read_bounded(&assets::path(&self.root,"assets",id,"png")?,assets::MAX_IMAGE)}
    fn record_result<T>(&self,id:&str,result:Result<T,AppError>)->Result<T,AppError>{match result {Ok(v)=>Ok(v),Err(e)=>{let _=self.with_store(|s|s.record_unknown(id,e.code));Err(http::unknown(e.code))}}}
    pub fn generate(&self,input:GenerationInput)->Result<GenerationResult,AppError>{
        self.generate_prepared(input,|profile|{
            let token=credentials::get_for(&profile.id)?;let transport=http::Transport::new(&token,profile.clone())?;
            Ok(move |body:&Value|transport.post("generate",body,32*1024*1024))
        })
    }
    #[cfg(test)]
    fn generate_with(&self,input:GenerationInput,post:impl FnOnce(&Value)->Result<Vec<u8>,AppError>)->Result<GenerationResult,AppError>{
        self.generate_prepared(input,|_|Ok(post))
    }
    fn generate_prepared<P:FnOnce(&Value)->Result<Vec<u8>,AppError>>(&self,mut input:GenerationInput,prepare:impl FnOnce(&studio_core::connections::ConnectionProfile)->Result<P,AppError>)->Result<GenerationResult,AppError>{
        let _guard=self.remote.try_lock().map_err(|_|AppError::new("remote_busy","另一个付费任务正在提交；不会重复发送。"))?;
        input.validate()?;self.with_store(|s|s.preflight_remote())?;
        let profile=self.with_store(|s|s.connection(input.connection_id.as_deref().unwrap_or(studio_core::connections::DEFAULT_CONNECTION)))?;
        let seed=input.seed.unwrap_or_else(||{let id=uuid::Uuid::new_v4();u32::from_le_bytes(id.as_bytes()[..4].try_into().unwrap())});input.seed=Some(seed);
        let image=if input.mode==GenerationMode::I2i {
            let img=assets::decode(&self.source(input.image_id.as_deref().ok_or_else(AppError::invalid)?)?)?;
            let resized=img.resize_to_fill(input.width,input.height,image::imageops::FilterType::Lanczos3);Some(STANDARD.encode(assets::png(&resized)?))
        }else{None};
        let scope=self.connection_scope(input.connection_id.as_deref())?;
        let mut vibes=Vec::new();for v in &input.vibes {
            let meta_bytes=assets::read_bounded(&assets::path(&self.root,"vibes",&v.encoding_id,"json")?,4096)?;
            let meta:VibeMeta=serde_json::from_slice(&meta_bytes).map_err(|_|AppError::storage())?;
            // Legacy official encodings remain valid only for the original official account.
            let legacy=meta.connection_scope.is_empty() && input.connection_id.as_deref().unwrap_or(studio_core::connections::DEFAULT_CONNECTION)==studio_core::connections::DEFAULT_CONNECTION && self.with_store(|s|s.connection_revision(&profile.id))?.is_empty();
            if !legacy && meta.connection_scope!=scope {return Err(AppError::new("vibe_connection_mismatch","氛围编码属于另一连接或接口版本；请在当前连接显式编码，不会自动收费。"));}
            if meta.model!=input.model{return Err(AppError::new("vibe_model_mismatch","氛围编码与所选模型不匹配；请显式重新编码，不会自动收费。"));}
            let bytes=assets::read_bounded(&assets::path(&self.root,"vibes",&v.encoding_id,"bin")?,8*1024*1024)?;
            vibes.push(ResolvedVibe{data:STANDARD.encode(bytes),information_extracted:meta.information_extracted,strength:v.strength});
        }
        let wire=build_wire(&input,seed,image,vibes)?;let snapshot=serde_json::to_string(&input).map_err(|_|AppError::invalid())?;let task=uuid::Uuid::new_v4().to_string();
        let post=prepare(&profile)?;
        let journal=serde_json::to_string(&json!({"request":&input,"connection":&profile})).map_err(|_|AppError::invalid())?;
        self.with_store(|s|s.begin_remote_task(&task,"generation",&journal,now()))?;
        let outcome=(||{
            let response=post(&wire)?;let bytes=assets::output_from_zip(&response,input.width,input.height)?;
            let artifact_id=uuid::Uuid::new_v4().to_string();assets::atomic_write(&assets::path(&self.root,"outputs",&artifact_id,"png")?,&bytes)?;
            let history=HistoryItem{id:task.clone(),created_at_ms:now(),prompt:input.draft.prompt.clone(),artifact_id:artifact_id.clone()};
            self.with_store(|s|s.finish_remote_task(&task,Some(&history),Some(&snapshot)))?;
            Ok(GenerationResult{task_id:task.clone(),artifact_id,seed,image_url:assets::data_url(&bytes)})
        })();self.record_result(&task,outcome)
    }
    pub fn encode(&self,input:EncodeInput)->Result<VibeAsset,AppError>{
        let id=input.connection_id.clone().unwrap_or_else(||studio_core::connections::DEFAULT_CONNECTION.into());
        self.encode_with(input,||{let profile=self.with_store(|s|s.connection(&id))?;
            if profile.encode_path.is_none(){return Err(AppError::new("encoding_unsupported","此连接未配置氛围编码接口；未发送请求。"));}
            let token=credentials::get_for(&profile.id)?;let transport=http::Transport::new(&token,profile)?;Ok(move |body:&Value|transport.post("encode",body,8*1024*1024))})
    }
    fn encode_with<P:FnOnce(&Value)->Result<Vec<u8>,AppError>>(&self,input:EncodeInput,prepare:impl FnOnce()->Result<P,AppError>)->Result<VibeAsset,AppError>{
        let _guard=self.remote.try_lock().map_err(|_|AppError::new("remote_busy","另一个付费任务正在提交。"))?;
        if input.connection_id.as_ref().is_some_and(|id|!valid_id(id))||!valid_id(&input.image_id)||!MODELS.contains(&input.model.as_str())||!input.information_extracted.is_finite()||!(0.0..=1.0).contains(&input.information_extracted){return Err(AppError::invalid());}
        let scope=self.connection_scope(input.connection_id.as_deref())?;
        let image=self.source(&input.image_id)?;let mut h=Sha256::new();h.update(scope.as_bytes());h.update(&image);h.update(input.model.as_bytes());h.update(input.information_extracted.to_be_bytes());let id=format!("{:x}",h.finalize());
        let meta_path=assets::path(&self.root,"vibes",&id,"json")?;let bin_path=assets::path(&self.root,"vibes",&id,"bin")?;
        // Recover a fully written binary whose metadata commit was interrupted. No POST.
        if bin_path.exists()&&!meta_path.exists(){
            let data=assets::read_bounded(&bin_path,8*1024*1024)?;
            if data.is_empty(){return Err(AppError::storage());}
            assets::atomic_write(&meta_path,&serde_json::to_vec(&VibeMeta{connection_scope:scope.clone(),model:input.model.clone(),information_extracted:input.information_extracted}).map_err(|_|AppError::storage())?)?;
        }
        if meta_path.exists()&&bin_path.exists(){
            let meta:VibeMeta=serde_json::from_slice(&assets::read_bounded(&meta_path,4096)?).map_err(|_|AppError::storage())?;let data=assets::read_bounded(&bin_path,8*1024*1024)?;
            if data.is_empty()||meta.connection_scope!=scope||meta.model!=input.model||meta.information_extracted!=input.information_extracted{return Err(AppError::storage());}
            return Ok(VibeAsset{id,model:input.model,information_extracted:input.information_extracted,cache_hit:true});
        }
        if !input.confirm_paid{return Err(AppError::new("confirmation_required","未命中缓存；V4+ 氛围编码可能收费，请显式确认。"));}
        self.with_store(|s|s.preflight_remote())?;
        let post=prepare()?; // All credential/client setup happens before the durable submission point.
        let wire=json!({"image":STANDARD.encode(image),"model":input.model,"information_extracted":input.information_extracted});
        let profile=self.with_store(|s|s.connection(input.connection_id.as_deref().unwrap_or(studio_core::connections::DEFAULT_CONNECTION)))?;
        let snapshot=serde_json::to_string(&json!({"request":&input,"connection":profile})).map_err(|_|AppError::invalid())?;let task=uuid::Uuid::new_v4().to_string();self.with_store(|s|s.begin_remote_task(&task,"vibe_encoding",&snapshot,now()))?;
        let outcome=(||{let bytes=post(&wire)?;if bytes.is_empty()||bytes.len()>8*1024*1024{return Err(http::unknown("encoding_invalid"));}
            let meta=VibeMeta{connection_scope:scope.clone(),model:input.model.clone(),information_extracted:input.information_extracted};
            assets::atomic_write(&bin_path,&bytes)?;assets::atomic_write(&meta_path,&serde_json::to_vec(&meta).map_err(|_|AppError::storage())?)?;
            self.with_store(|s|s.finish_remote_task(&task,None,None))?;Ok(VibeAsset{id,model:input.model,information_extracted:input.information_extracted,cache_hit:false})})();self.record_result(&task,outcome)
    }
}
#[cfg(test)] mod tests {
    #[test]fn generation_checks_storage_before_credentials(){
        let d=tempfile::tempdir().unwrap();let root=d.path().join("not-a-directory");std::fs::write(&root,b"blocked").unwrap();
        let s=NaiService::new(root);assert_eq!(s.generate(input()).err().unwrap().code,"storage_unavailable");
    }
    #[test]fn encoding_checks_journal_before_preparing_paid_transport(){
        let d=tempfile::tempdir().unwrap();let s=NaiService::new(d.path().into());
        let a=s.import_image(&STANDARD.encode(assets::png(&image::DynamicImage::new_rgb8(64,64)).unwrap())).unwrap();
        std::fs::write(d.path().join("studio.sqlite3"),b"not sqlite").unwrap();
        let i=EncodeInput{connection_id:None,image_id:a.id,model:MODELS[0].into(),information_extracted:0.8,confirm_paid:true};
        let e=s.encode_with(i,|| -> Result<fn(&Value)->Result<Vec<u8>,AppError>,AppError>{panic!("storage failure must not read credentials or initialize transport")}).unwrap_err();
        assert_eq!(e.code,"storage_corrupt");
        assert_eq!(std::fs::read(d.path().join("studio.sqlite3")).unwrap(), b"not sqlite");
    }

    use super::*;use std::io::{Cursor,Write};
    fn input()->GenerationInput{serde_json::from_value(serde_json::from_str::<Value>(include_str!("../../../contracts/generation-v1.fixture.json")).unwrap()["input"].clone()).unwrap()}
    fn response(w:u32,h:u32)->Vec<u8>{let bytes=assets::png(&image::DynamicImage::new_rgb8(w,h)).unwrap();let mut c=Cursor::new(Vec::new());{let mut z=zip::ZipWriter::new(&mut c);z.start_file("image_0.png",zip::write::SimpleFileOptions::default()).unwrap();z.write_all(&bytes).unwrap();z.finish().unwrap();}c.into_inner()}
    #[test]fn successful_generation_is_saved_with_replay_seed(){let d=tempfile::tempdir().unwrap();let s=NaiService::new(d.path().into());let i=input();let r=s.generate_with(i.clone(),|w|{assert_eq!(w["action"],"generate");Ok(response(i.width,i.height))}).unwrap();assert!(s.artifact(&r.artifact_id,false).unwrap().starts_with("data:image/png"));let replay=s.with_store(|db|db.history_request(&r.task_id)).unwrap();assert_eq!(replay.seed,Some(r.seed));assert!(!replay.confirm_paid);}
    #[test]fn uncertain_request_is_never_automatically_retried(){let d=tempfile::tempdir().unwrap();let s=NaiService::new(d.path().into());assert!(s.generate_with(input(),|_|Err(http::unknown("test_timeout"))).is_err());let t=s.with_store(|db|db.task_list()).unwrap();assert_eq!(t.len(),1);assert!(s.generate_with(input(),|_|panic!("must not send again")).is_err());drop(s);let s=NaiService::new(d.path().into());assert!(s.generate_with(input(),|_|panic!("must not send after restart")).is_err());s.with_store(|db|db.acknowledge_unknown(&t[0].id)).unwrap();assert!(!s.with_store(|db|db.has_unresolved()).unwrap());}
    #[test]fn encoding_cache_and_model_changes_are_explicit(){let d=tempfile::tempdir().unwrap();let s=NaiService::new(d.path().into());let a=s.import_image(&STANDARD.encode(assets::png(&image::DynamicImage::new_rgb8(64,64)).unwrap())).unwrap();let make=|p|EncodeInput{connection_id:None,image_id:a.id.clone(),model:MODELS[0].into(),information_extracted:p,confirm_paid:true};let first=s.encode_with(make(0.8),||Ok(|w:&Value|{assert_eq!(w["information_extracted"],0.8);Ok(vec![1,2,3])})).unwrap();let mut second=make(0.8);second.confirm_paid=false;let hit=s.encode_with(second,|| -> Result<fn(&Value)->Result<Vec<u8>,AppError>,AppError>{panic!("cache hit must not prepare or POST")}).unwrap();assert_eq!(first.id,hit.id);assert!(hit.cache_hit);let mut changed=make(0.9);changed.confirm_paid=false;assert_eq!(s.encode_with(changed,|| -> Result<fn(&Value)->Result<Vec<u8>,AppError>,AppError>{panic!("unconfirmed must not prepare or POST")}).unwrap_err().code,"confirmation_required");}
}

#[cfg(test)] mod connection_tests {
    use super::*;
    #[test] fn credential_revision_and_endpoint_changes_invalidate_scope_but_renames_do_not() {
        let d=tempfile::tempdir().unwrap();let s=NaiService::new(d.path().into());
        let mut p=studio_core::connections::ConnectionProfile::official();p.id="account-b".into();s.save_connection(p.clone()).unwrap();
        let a=s.connection_scope(Some("account-b")).unwrap();p.name="renamed".into();s.save_connection(p.clone()).unwrap();assert_eq!(a,s.connection_scope(Some("account-b")).unwrap());
        s.with_store(|db|db.rotate_connection_revision("account-b","revision-test-only")).unwrap();assert_ne!(a,s.connection_scope(Some("account-b")).unwrap());
        assert_ne!(s.connection_scope(None).unwrap(),s.connection_scope(Some("account-b")).unwrap());
    }
    #[test] fn journal_connection_snapshot_survives_edits_and_deletion() {
        let d=tempfile::tempdir().unwrap();let s=NaiService::new(d.path().into());
        let mut p=studio_core::connections::ConnectionProfile::official();p.id="account-b".into();p.name="original account".into();s.save_connection(p.clone()).unwrap();
        let input=serde_json::json!({"request":{},"connection":&p}).to_string();
        s.with_store(|db|db.begin_remote_task("snapshot-test","generation",&input,1)).unwrap();
        p.name="renamed".into();s.save_connection(p).unwrap();s.with_store(|db|db.delete_connection("account-b")).unwrap();
        let records=s.with_store(|db|db.task_list()).unwrap();assert_eq!(records[0].connection.as_ref().unwrap().name,"original account");assert!(s.with_store(|db|db.has_unresolved()).unwrap());
    }
    #[test] fn missing_encoding_path_rejects_before_credentials_or_submission() {
        let d=tempfile::tempdir().unwrap();let s=NaiService::new(d.path().into());
        let mut p=studio_core::connections::ConnectionProfile::official();p.id="relay".into();p.kind=studio_core::connections::ConnectionKind::RelayNative;p.base_url="https://relay.example".into();p.encode_path=None;s.save_connection(p).unwrap();
        let a=s.import_image(&STANDARD.encode(assets::png(&image::DynamicImage::new_rgb8(64,64)).unwrap())).unwrap();
        let input=EncodeInput{connection_id:Some("relay".into()),image_id:a.id,model:MODELS[0].into(),information_extracted:0.8,confirm_paid:true};
        assert_eq!(s.encode(input).unwrap_err().code,"encoding_unsupported");assert!(s.with_store(|db|db.task_list()).unwrap().is_empty());
    }
}
