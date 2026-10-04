use reqwest::{blocking::Client, redirect::Policy, header::{HeaderValue,AUTHORIZATION}};
use serde_json::Value;
use std::{io::Read,time::Duration};
use studio_core::error::AppError;
pub struct Transport {client:Client,authorization:HeaderValue}
impl Transport {
    pub fn new(token:&str)->Result<Self,AppError>{
        let mut authorization=HeaderValue::from_str(&format!("Bearer {token}")).map_err(|_|AppError::invalid())?;authorization.set_sensitive(true);
        let client=client_builder().https_only(true).build().map_err(|_|AppError::new("http_setup","无法初始化网络客户端；未发送请求。"))?;
        Ok(Self{client,authorization})
    }
    pub fn post(&self,endpoint:&str,body:&Value,max:usize)->Result<Vec<u8>,AppError>{
        let url=match endpoint{"generate"=>"https://image.novelai.net/ai/generate-image","encode"=>"https://image.novelai.net/ai/encode-vibe",_=>return Err(AppError::invalid())};
        self.post_to(url,endpoint,body,max)
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
pub fn unknown(code:&'static str)->AppError {AppError::new(code,"请求已尝试提交，但结果未确认。请先核对 NovelAI 账户/费用及任务记录；程序不会自动重发。")}

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
        let client=client_builder().https_only(false).no_proxy().timeout(Duration::from_millis(if delay{100}else{2000})).build().unwrap();let transport=Transport{client,authorization:HeaderValue::from_static("Bearer local-test-only")};
        let result=transport.post_to(&url,"generate",&serde_json::json!({"input":"test"}),1024);let(count,request)=worker.join().unwrap();(result,count,request)
    }
    #[test]fn successful_post_is_single_and_json(){let(result,count,request)=check("200 OK","application/zip",b"PK_LOCAL_TEST",false);assert_eq!(result.unwrap(),b"PK_LOCAL_TEST");assert_eq!(count,1);let request=String::from_utf8(request).unwrap();assert!(request.starts_with("POST /test HTTP/1.1"));assert!(request.to_ascii_lowercase().contains("authorization: bearer local-test-only"));assert!(request.ends_with(r#"{"input":"test"}"#));}
    #[test]fn rejects_response_without_retry_or_redirect(){for status in ["401 Unauthorized","429 Too Many Requests","500 Server Error","302 Found"]{let(result,count,_)=check(status,"application/zip",b"SECRET_REMOTE_RESPONSE",false);let e=result.unwrap_err();assert_eq!(count,1);assert!(!e.message.contains("SECRET_REMOTE_RESPONSE"));}}
    #[test]fn timeout_never_reposts(){let(result,count,_)=check("200 OK","application/zip",b"ZIP",true);assert_eq!(result.unwrap_err().code,"network_uncertain");assert_eq!(count,1);}
    #[test]fn wrong_type_and_oversized_response_are_unknown(){let(result,count,_)=check("200 OK","text/html",b"wrong",false);assert_eq!(result.unwrap_err().code,"response_type");assert_eq!(count,1);let(result,count,_)=check("200 OK","application/zip",&vec![0u8;1025],false);assert_eq!(result.unwrap_err().code,"response_size");assert_eq!(count,1);}
}
