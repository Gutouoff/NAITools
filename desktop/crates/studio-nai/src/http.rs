use reqwest::{blocking::Client, redirect::Policy, header::{HeaderValue,AUTHORIZATION}};
use serde_json::Value;
use std::{io::Read,time::Duration};
use studio_core::error::AppError;
pub struct Transport {client:Client,authorization:HeaderValue,profile:studio_core::connections::ConnectionProfile}
impl Transport {
    pub fn new(token:&str,profile:studio_core::connections::ConnectionProfile)->Result<Self,AppError>{
        validate_profile(&profile)?;
        let mut authorization=HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_|AppError::invalid())?;authorization.set_sensitive(true);
        let client=client_builder().https_only(true).build().map_err(|_|AppError::new("http_setup","无法初始化网络客户端；未发送请求。"))?;
        Ok(Self{client,authorization,profile})
    }
    pub fn post(&self,endpoint:&str,body:&Value,max:usize)->Result<Vec<u8>,AppError>{
        let url=self.endpoint_url(endpoint)?;
        self.post_to(&url,endpoint,body,max)
    }
    fn endpoint_url(&self,endpoint:&str)->Result<String,AppError>{
        let path=match endpoint {"generate"=>self.profile.generation_path.as_str(),"encode"=>self.profile.encode_path.as_deref().ok_or_else(||AppError::new("encoding_unsupported","此连接未配置氛围编码接口；未发送请求。"))?,_=>return Err(AppError::invalid())};
        let url=format!("{}{}",self.profile.base_url.trim_end_matches('/'),path);
        Ok(url)
    }
    fn post_to(&self,url:&str,endpoint:&str,body:&Value,max:usize)->Result<Vec<u8>,AppError>{
        let accept=if endpoint=="generate"{"application/zip"}else{"application/octet-stream"};
        let response=self.client.post(url).header(AUTHORIZATION,self.authorization.clone()).header("Accept",accept).json(body).send().map_err(|_|unknown("network_uncertain"))?;
        if !response.status().is_success(){return Err(match response.status().as_u16(){401|403=>unknown("authentication_rejected"),429=>unknown("rate_limited"),_=>unknown("remote_rejected")});}
        if endpoint=="generate" && !response.headers().get("content-type").and_then(|v|v.to_str().ok()).is_some_and(|s|s.starts_with("application/zip")||s.starts_with("application/octet-stream")){return Err(unknown("response_type"));}
        let mut bytes=Vec::new();response.take(max as u64+1).read_to_end(&mut bytes).map_err(|_|unknown("response_interrupted"))?;
        if bytes.is_empty()||bytes.len()>max{return Err(unknown("response_size"));}Ok(bytes)
    }
}
pub fn unknown(code:&'static str)->AppError {AppError::new(code,"请求已尝试提交，但结果未确认。请先核对所选服务账户/费用及任务记录；程序不会自动重新提交。")}

fn client_builder()->reqwest::blocking::ClientBuilder {
    Client::builder().http1_only().redirect(Policy::none()).retry(reqwest::retry::never()).connect_timeout(Duration::from_secs(10)).timeout(Duration::from_secs(180))
}
#[cfg(test)]mod tests {
    use super::*;
    use std::{io::Write,net::{TcpListener,TcpStream},thread,time::Instant};
    fn read_request(stream:&mut TcpStream)->Vec<u8>{
        stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
        let mut bytes=Vec::new();let mut buf=[0u8;1024];
        loop{let n=stream.read(&mut buf).unwrap();if n==0{break;}bytes.extend_from_slice(&buf[..n]);assert!(bytes.len()<16384);
            if let Some(end)=bytes.windows(4).position(|w|w==b"\r\n\r\n"){
                let headers=String::from_utf8_lossy(&bytes[..end]).to_ascii_lowercase();
                let len=headers.lines().find_map(|l|l.strip_prefix("content-length:").map(|n|n.trim().parse::<usize>().unwrap())).unwrap_or(0);
                if bytes.len()>=end+4+len{break;}
            }
        }bytes
    }
    fn check(status:&str,content_type:&str,body:&[u8],delay:bool)->(Result<Vec<u8>,AppError>,usize,Vec<u8>){
        let listener=TcpListener::bind("127.0.0.1:0").unwrap();let url=format!("http://{}/test",listener.local_addr().unwrap());
        let response=format!("HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nLocation: /must-not-follow\r\nConnection: close\r\n\r\n",body.len());let body=body.to_vec();
        let worker=thread::spawn(move||{let(mut stream,_)=listener.accept().unwrap();let request=read_request(&mut stream);if delay{thread::sleep(Duration::from_millis(300));}let _=stream.write_all(response.as_bytes());let _=stream.write_all(&body);drop(stream);
            listener.set_nonblocking(true).unwrap();let until=Instant::now()+Duration::from_millis(250);let mut count=1;while Instant::now()<until{if let Ok((mut extra,_))=listener.accept(){count+=1;let _=extra.write_all(b"HTTP/1.1 500 No Retry\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");}thread::sleep(Duration::from_millis(5));}(count,request)});
        let client=client_builder().https_only(false).no_proxy().timeout(Duration::from_millis(if delay{100}else{2000})).build().unwrap();let transport=Transport{client,authorization:HeaderValue::from_static("Bearer local-test-only"),profile:studio_core::connections::ConnectionProfile::official()};
        let result=transport.post_to(&url,"generate",&serde_json::json!({"input":"test"}),1024);let(count,request)=worker.join().unwrap();(result,count,request)
    }
    #[test]fn successful_post_is_single_and_json(){let(result,count,request)=check("200 OK","application/zip",b"PK_LOCAL_TEST",false);assert_eq!(result.unwrap(),b"PK_LOCAL_TEST");assert_eq!(count,1);let request=String::from_utf8(request).unwrap();assert!(request.starts_with("POST /test HTTP/1.1"));assert!(request.to_ascii_lowercase().contains("authorization: bearer local-test-only"));assert!(request.ends_with(r#"{"input":"test"}"#));}
    #[test]fn rejects_response_without_retry_or_redirect(){for status in ["401 Unauthorized","429 Too Many Requests","500 Server Error","302 Found"]{let(result,count,_)=check(status,"application/zip",b"SECRET_REMOTE_RESPONSE",false);let e=result.unwrap_err();assert_eq!(count,1);assert!(!e.message.contains("SECRET_REMOTE_RESPONSE"));}}
    #[test]fn timeout_never_reposts(){let(result,count,_)=check("200 OK","application/zip",b"ZIP",true);assert_eq!(result.unwrap_err().code,"network_uncertain");assert_eq!(count,1);}
    #[test]fn wrong_type_and_oversized_response_are_unknown(){let(result,count,_)=check("200 OK","text/html",b"wrong",false);assert_eq!(result.unwrap_err().code,"response_type");assert_eq!(count,1);let(result,count,_)=check("200 OK","application/zip",&vec![0u8;1025],false);assert_eq!(result.unwrap_err().code,"response_size");assert_eq!(count,1);}
}

// Paths are explicitly supplied from a provider contract, not guessed by probing POSTs.
pub fn validate_profile(profile:&studio_core::connections::ConnectionProfile)->Result<(),AppError>{
    profile.validate()?;
    let url=reqwest::Url::parse(&profile.base_url).map_err(|_|AppError::invalid())?;
    if url.scheme()!="https" || url.host_str().is_none() || !url.username().is_empty() || url.password().is_some()
        || url.query().is_some() || url.fragment().is_some() || url.path().contains("..") {
        return Err(AppError::new("connection_invalid","地址必须是 HTTPS，不得包含账号、密码、查询参数或片段。"));
    }
    Ok(())
}

#[cfg(test)] mod profile_tests {
    use super::*;
    use studio_core::connections::{ConnectionProfile,ConnectionKind};
    #[test] fn explicit_paths_are_used_without_probe_or_fallback() {
        let mut p=ConnectionProfile::official();p.id="relay".into();p.kind=ConnectionKind::RelayNative;p.base_url="https://relay.example/provider/".into();p.generation_path="/documented/generate".into();p.encode_path=None;
        let transport=Transport::new("synthetic-test-only-not-a-real-key",p).unwrap();
        assert_eq!(transport.endpoint_url("generate").unwrap(),"https://relay.example/provider/documented/generate");
        assert_eq!(transport.post("encode",&serde_json::json!({}),10).unwrap_err().code,"encoding_unsupported");
        assert!(transport.endpoint_url("invented").is_err());
    }
    #[test] fn official_cannot_be_retargeted() {
        let mut p=ConnectionProfile::official();p.base_url="https://other.example".into();assert!(validate_profile(&p).is_err());
    }
    #[test] fn relay_disallows_credentials_query_and_unsafe_paths() {
        let mut p=ConnectionProfile::official();p.kind=ConnectionKind::RelayNative;p.id="relay".into();
        for url in ["http://example.com","https://user:secret@example.com","https://example.com?key=secret","https://example.com#secret","https://"] {
            p.base_url=url.into();assert!(validate_profile(&p).is_err());
        }
        p.base_url="https://example.com/provider".into();assert!(validate_profile(&p).is_ok());
        for path in ["//evil.example","/../path","/path?key=secret","/path#x","/%2e%2e/path",""] {
            p.generation_path=path.into();assert!(validate_profile(&p).is_err());
        }
    }
}
