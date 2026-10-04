use studio_core::error::AppError;
use zeroize::Zeroizing;
const SERVICE:&str="com.langbai.studio.pc.preview";
fn username_for(id:&str)->Result<String,AppError>{
    if !studio_core::dto::valid_id(id) {return Err(AppError::invalid());}
    let user=if id==studio_core::connections::DEFAULT_CONNECTION {"novelai-persistent-token".into()} else {format!("connection-{id}")};
    Ok(user)
}
fn entry_for(id:&str)->Result<keyring::Entry,AppError>{
    keyring::Entry::new(SERVICE,&username_for(id)?).map_err(|_|error())
}
fn error()->AppError{AppError::new("credential_unavailable","Windows 凭据存储不可用；没有明文降级存储。")}
pub fn status_for(id:&str)->Result<bool,AppError>{match entry_for(id)?.get_password(){Ok(s)=>{let _secret=Zeroizing::new(s);Ok(true)},Err(keyring::Error::NoEntry)=>Ok(false),Err(_)=>Err(error())}}
pub fn set_for(id:&str,token:String)->Result<(),AppError>{let token=Zeroizing::new(token);if token.len()<16||token.len()>4096||token.chars().any(|c|c.is_whitespace()||c.is_control()){return Err(AppError::new("token_invalid","请输入 API Key / Persistent API Token 本身，不要包含 Bearer 前缀或空白。"));}entry_for(id)?.set_password(&token).map_err(|_|error())}
pub fn get_for(id:&str)->Result<Zeroizing<String>,AppError>{match entry_for(id)?.get_password(){Ok(s)=>Ok(Zeroizing::new(s)),Err(keyring::Error::NoEntry)=>Err(AppError::new("token_required","请先为所选连接保存 API Key / Persistent API Token；未读取旧版账号。")),Err(_)=>Err(error())}}
pub fn delete_for(id:&str)->Result<(),AppError>{match entry_for(id)?.delete_credential(){Ok(())|Err(keyring::Error::NoEntry)=>Ok(()),Err(_)=>Err(error())}}

pub fn status()->Result<bool,AppError>{status_for(studio_core::connections::DEFAULT_CONNECTION)}
pub fn set(token:String)->Result<(),AppError>{set_for(studio_core::connections::DEFAULT_CONNECTION,token)}
pub fn delete()->Result<(),AppError>{delete_for(studio_core::connections::DEFAULT_CONNECTION)}

#[cfg(test)] mod tests {
    use super::*;
    #[test] fn account_names_are_isolated_and_keep_legacy_default() {
        assert_eq!(username_for(studio_core::connections::DEFAULT_CONNECTION).unwrap(),"novelai-persistent-token");
        assert_eq!(username_for("relay-a").unwrap(),"connection-relay-a");
        assert_ne!(username_for("relay-a").unwrap(),username_for("account-b").unwrap());
        assert!(username_for("../bad").is_err());
    }
}
