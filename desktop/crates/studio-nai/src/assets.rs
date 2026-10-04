use base64::{engine::general_purpose::STANDARD, Engine};
use image::{DynamicImage, ImageFormat, ImageReader};
use serde::{Deserialize, Serialize};
use std::{io::{Cursor, Read, Write}, path::{Path, PathBuf}};
use studio_core::{dto::valid_id, error::AppError};
pub const MAX_IMAGE: usize = 16 * 1024 * 1024;
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct ImageAsset { pub id:String, pub width:u32, pub height:u32, pub preview_url:String }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct MetadataEntry { pub key:String, pub value:String }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct ArtifactMetadata { pub width:u32, pub height:u32, pub format:String, pub entries:Vec<MetadataEntry> }
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all="camelCase")]
pub struct VibeAsset { pub id:String, pub model:String, pub information_extracted:f64, pub cache_hit:bool }
#[derive(Serialize, Deserialize)]
pub struct VibeMeta { #[serde(default)] pub connection_scope:String, pub model:String, pub information_extracted:f64 }
pub fn path(root:&Path, folder:&str, id:&str, ext:&str)->Result<PathBuf,AppError>{
    if !valid_id(id){return Err(AppError::invalid());}
    Ok(root.join(folder).join(format!("{id}.{ext}")))
}
pub fn atomic_write(target:&Path, bytes:&[u8])->Result<(),AppError>{
    let parent=target.parent().ok_or_else(AppError::storage)?;
    std::fs::create_dir_all(parent).map_err(|_|AppError::storage())?;
    let tmp=parent.join(format!(".{}.tmp",uuid::Uuid::new_v4()));
    let result=(||{let mut f=std::fs::OpenOptions::new().write(true).create_new(true).open(&tmp).map_err(|_|AppError::storage())?;
        f.write_all(bytes).and_then(|_|f.sync_all()).map_err(|_|AppError::storage())?;
        std::fs::rename(&tmp,target).map_err(|_|AppError::storage())})();
    if result.is_err(){let _=std::fs::remove_file(&tmp);}result
}
pub fn read_bounded(target:&Path, max:usize)->Result<Vec<u8>,AppError>{
    let f=std::fs::File::open(target).map_err(|_|AppError::new("asset_missing","本地素材不存在；请重新导入，未发送请求。"))?;
    let mut out=Vec::new(); f.take(max as u64+1).read_to_end(&mut out).map_err(|_|AppError::storage())?;
    if out.len()>max{return Err(AppError::new("asset_too_large","素材超过本应用的安全大小限制。"));}Ok(out)
}
pub fn decode(bytes:&[u8])->Result<DynamicImage,AppError>{
    if bytes.is_empty()||bytes.len()>MAX_IMAGE{return Err(AppError::invalid());}
    let mut r=ImageReader::new(Cursor::new(bytes)).with_guessed_format().map_err(|_|AppError::invalid())?;
    if !matches!(r.format(),Some(ImageFormat::Png|ImageFormat::Jpeg|ImageFormat::WebP)){return Err(AppError::new("image_format","仅支持 PNG、JPEG、WebP。"));}
    let mut limits=image::Limits::default(); limits.max_image_width=Some(8192); limits.max_image_height=Some(8192); limits.max_alloc=Some(96*1024*1024);r.limits(limits);
    let dims=ImageReader::new(Cursor::new(bytes)).with_guessed_format().map_err(|_|AppError::invalid())?.into_dimensions().map_err(|_|AppError::invalid())?;
    if dims.0 as u64*dims.1 as u64>16_777_216{return Err(AppError::new("image_dimensions","输入图像不得超过 1600 万像素。"));}
    r.decode().map_err(|_|AppError::new("image_decode","图像解码失败；未发送请求。"))
}
pub fn png(image:&DynamicImage)->Result<Vec<u8>,AppError>{let mut c=Cursor::new(Vec::new());image.write_to(&mut c,ImageFormat::Png).map_err(|_|AppError::invalid())?;Ok(c.into_inner())}
pub fn data_url(bytes:&[u8])->String{format!("data:image/png;base64,{}",STANDARD.encode(bytes))}
pub fn thumbnail(bytes:&[u8])->Result<String,AppError>{Ok(data_url(&png(&decode(bytes)?.thumbnail(512,512))?))}
fn text_value(bytes:&[u8])->String{String::from_utf8_lossy(bytes).trim_matches(char::from(0)).trim().chars().take(65_536).collect()}
pub fn metadata(bytes:&[u8])->Result<ArtifactMetadata,AppError>{
    let image=decode(bytes)?; let mut entries=Vec::new();
    if bytes.starts_with(&[137,80,78,71,13,10,26,10]) { let mut at=8usize;
        while at.saturating_add(12)<=bytes.len() && entries.len()<128 { let len=u32::from_be_bytes(bytes[at..at+4].try_into().unwrap()) as usize; let ds=at+8; let de=ds.saturating_add(len); if de.saturating_add(4)>bytes.len(){break;} let kind=&bytes[at+4..at+8]; let data=&bytes[ds..de];
            if kind==b"tEXt" { if let Some(pos)=data.iter().position(|v|*v==0){ let key=text_value(&data[..pos]); let value=text_value(&data[pos+1..]); if !key.is_empty()&&!value.is_empty(){entries.push(MetadataEntry{key,value});} } }
            else if kind==b"iTXt" { let mut parts=data.splitn(6,|v|*v==0); let key=parts.next().map(text_value).unwrap_or_default(); let flag=parts.next().and_then(|v|v.first()).copied().unwrap_or(1); let _method=parts.next(); let _lang=parts.next(); let _translated=parts.next(); if flag==0 { if let Some(value)=parts.next().map(text_value){ if !key.is_empty()&&!value.is_empty(){entries.push(MetadataEntry{key,value});} } } }
            at=de+4; if kind==b"IEND"{break;}
        }
    }
    Ok(ArtifactMetadata{width:image.width(),height:image.height(),format:match image::guess_format(bytes).unwrap_or(ImageFormat::Png){ImageFormat::Png=>"PNG",ImageFormat::Jpeg=>"JPEG",ImageFormat::WebP=>"WebP",_=>"image"}.into(),entries})
}
pub fn import(root:&Path, base64:&str)->Result<ImageAsset,AppError>{
    if base64.len()>MAX_IMAGE*4/3+8{return Err(AppError::invalid());}
    let image=decode(&STANDARD.decode(base64).map_err(|_|AppError::invalid())?)?;
    let bytes=png(&image)?;if bytes.len()>MAX_IMAGE{return Err(AppError::invalid());}
    let id=uuid::Uuid::new_v4().to_string();atomic_write(&path(root,"assets",&id,"png")?,&bytes)?;
    Ok(ImageAsset{id,width:image.width(),height:image.height(),preview_url:thumbnail(&bytes)?})
}
pub fn output_from_zip(bytes:&[u8],width:u32,height:u32)->Result<Vec<u8>,AppError>{
    let bad=||AppError::new("response_invalid","服务返回图像未通过验证；付费结果待核对，不会自动重新提交。");
    let mut zip=zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_|bad())?;
    if zip.len()>16{return Err(bad());}let mut result=None;
    for i in 0..zip.len(){let mut f=zip.by_index(i).map_err(|_|bad())?;let name=f.name().to_owned();
        if !(name.starts_with("image_")&&(name.ends_with(".png")||name.ends_with(".webp"))){continue;}
        if name.contains('/')||name.contains('\\')||name.contains("..")||f.size()>MAX_IMAGE as u64||result.is_some(){return Err(bad());}
        let mut out=Vec::new();(&mut f).take(MAX_IMAGE as u64+1).read_to_end(&mut out).map_err(|_|bad())?;
        let image=decode(&out).map_err(|_|bad())?;if image.width()!=width||image.height()!=height{return Err(bad());}
        // Retain original PNG bytes, including NovelAI metadata. No path extraction.
        if image::guess_format(&out).map_err(|_|bad())?!=ImageFormat::Png{return Err(bad());}result=Some(out);
    }result.ok_or_else(bad)
}
#[cfg(test)] mod tests {
    use super::*;
    #[test]fn rejects_paths_and_non_images(){assert!(path(Path::new("test"),"assets","../private","png").is_err());assert!(decode(b"not png").is_err());}
    #[test]fn import_and_thumbnail_are_local(){let root=tempfile::tempdir().unwrap();let bytes=png(&DynamicImage::new_rgb8(32,48)).unwrap();let a=import(root.path(),&STANDARD.encode(bytes)).unwrap();assert_eq!((a.width,a.height),(32,48));assert!(a.preview_url.starts_with("data:image/png;base64,"));assert!(path(root.path(),"assets",&a.id,"png").unwrap().exists());}
    #[test]fn zip_retains_png_and_checks_size() {let bytes=png(&DynamicImage::new_rgb8(64,64)).unwrap();let mut c=Cursor::new(Vec::new());{let mut z=zip::ZipWriter::new(&mut c);z.start_file("image_0.png",zip::write::SimpleFileOptions::default()).unwrap();z.write_all(&bytes).unwrap();z.finish().unwrap();}assert_eq!(output_from_zip(c.get_ref(),64,64).unwrap(),bytes);assert!(output_from_zip(c.get_ref(),128,64).is_err());}
}
