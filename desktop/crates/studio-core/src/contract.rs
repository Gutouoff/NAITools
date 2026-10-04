use serde::Serialize;
#[derive(Debug,Clone,Serialize)]
#[serde(rename_all="camelCase")]
pub struct NaiContractStatus {pub verification:&'static str,pub generation_enabled:bool,pub reason:&'static str,pub evidence_file:&'static str}
pub fn status()->NaiContractStatus{NaiContractStatus{verification:"observed_subset",generation_enabled:true,reason:"已按官方 Swagger 与官网客户端观察实现 V4.5 非流式子集；本地协议测试不等于真实付费验收。",evidence_file:"contracts/novelai-evidence.json"}}
