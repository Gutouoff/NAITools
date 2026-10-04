use studio_core::error::AppError;
use zeroize::Zeroizing;
const SERVICE:&str="com.langbai.studio.pc.preview";
fn entry()->Result<keyring::Entry,AppError>{keyring::Entry::new(SERVICE,"novelai-persistent-token").map_err(|_|error())}
fn error()->AppError{AppError::new("credential_unavailable","Windows 凭据存储不可用；没有明文降级存储。")}
pub fn status()->Result<bool,AppError>{match entry()?.get_password(){Ok(s)=>{let _secret=Zeroizing::new(s);Ok(true)},Err(keyring::Error::NoEntry)=>Ok(false),Err(_)=>Err(error())}}
pub fn set(token:String)->Result<(),AppError>{let token=Zeroizing::new(token);if token.len()<16||token.len()>4096||token.chars().any(|c|c.is_whitespace()||c.is_control()){return Err(AppError::new("token_invalid","请输入 Persistent API Token 本身，不要包含 Bearer 前缀或空白。"));}entry()?.set_password(&token).map_err(|_|error())}
pub fn get()->Result<Zeroizing<String>,AppError>{entry()?.get_password().map(Zeroizing::new).map_err(|_|AppError::new("token_required","请先在新版设置中保存 Persistent API Token；未读取旧版账号。"))}
pub fn delete()->Result<(),AppError>{match entry()?.delete_credential(){Ok(())|Err(keyring::Error::NoEntry)=>Ok(()),Err(_)=>Err(error())}}
