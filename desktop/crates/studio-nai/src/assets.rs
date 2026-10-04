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
fn latin1(bytes: &[u8]) -> String { bytes.iter().copied().map(char::from).collect() }
fn split_null(bytes: &[u8]) -> Option<(&[u8], &[u8])> {
    let at = bytes.iter().position(|value| *value == 0)?;
    Some((&bytes[..at], &bytes[at + 1..]))
}
// PNG Third Edition sections 11.3.3.2 and 11.3.3.4:
// https://www.w3.org/TR/png-3/#11iTXt
// Flag/method are individual bytes, not null-terminated strings. Compressed/stealth data
// remains unsupported; do not infer fields or report unknown formats as successfully parsed.
fn text_entry(kind: &[u8], data: &[u8]) -> Option<MetadataEntry> {
    let (keyword, remaining) = split_null(data)?;
    if keyword.is_empty() || keyword.len() > 79 { return None; }
    let key = latin1(keyword);
    let value = if kind == b"tEXt" {
        if remaining.contains(&0) { return None; }
        remaining.iter().copied().map(char::from).take(65_536).collect()
    } else if kind == b"iTXt" {
        if remaining.len() < 2 || remaining[0] != 0 || remaining[1] != 0 { return None; }
        let (_, remaining) = split_null(&remaining[2..])?; // language tag
        let (translated, text) = split_null(remaining)?;
        std::str::from_utf8(translated).ok()?;
        if text.contains(&0) { return None; }
        std::str::from_utf8(text).ok()?.chars().take(65_536).collect()
    } else { return None; };
    Some(MetadataEntry { key, value })
}
pub fn metadata(bytes:&[u8])->Result<ArtifactMetadata,AppError>{
    let image=decode(bytes)?; let mut entries=Vec::new();
    if bytes.starts_with(&[137,80,78,71,13,10,26,10]) { let mut at=8usize;
        while at.saturating_add(12)<=bytes.len() && entries.len()<128 { let len=u32::from_be_bytes(bytes[at..at+4].try_into().unwrap()) as usize; let ds=at+8; let de=ds.saturating_add(len); if de.saturating_add(4)>bytes.len(){break;} let kind=&bytes[at+4..at+8]; let data=&bytes[ds..de];
            if let Some(entry) = text_entry(kind, data) { entries.push(entry); }
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
    fn append_text_chunk(kind: &[u8; 4], data: &[u8]) -> Vec<u8> {
        let mut bytes = png(&DynamicImage::new_rgb8(32, 48)).unwrap();
        let mut chunk = Vec::new();
        chunk.extend_from_slice(&(data.len() as u32).to_be_bytes());
        chunk.extend_from_slice(kind);
        chunk.extend_from_slice(data);
        // Test-only CRC32 to create a valid PNG fixture without a new runtime dependency.
        let mut crc = u32::MAX;
        for byte in &chunk[4..] {
            crc ^= *byte as u32;
            for _ in 0..8 { crc = (crc >> 1) ^ (0xedb88320u32 & 0u32.wrapping_sub(crc & 1)); }
        }
        chunk.extend_from_slice(&(!crc).to_be_bytes());
        bytes.splice(bytes.len() - 12..bytes.len() - 12, chunk);
        bytes
    }
    #[test]fn metadata_preserves_text_without_inference_or_whitespace_changes() {
        let bytes = append_text_chunk(b"tEXt", b"Comment\0  {\"seed\":42}\n");
        let result = metadata(&bytes).unwrap();
        assert_eq!((result.width, result.height, result.format.as_str()), (32, 48, "PNG"));
        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].key, "Comment");
        assert_eq!(result.entries[0].value, "  {\"seed\":42}\n");
        assert!(metadata(&png(&DynamicImage::new_rgb8(32, 48)).unwrap()).unwrap().entries.is_empty());
    }
    #[test]fn metadata_reads_uncompressed_international_text_with_empty_language_fields() {
        let mut data = b"Comment\0\0\0\0\0".to_vec();
        data.extend_from_slice(" 清凉、高效 🎨 ".as_bytes());
        let result = metadata(&append_text_chunk(b"iTXt", &data)).unwrap();
        assert_eq!(result.entries.len(), 1);
        assert_eq!(result.entries[0].value, " 清凉、高效 🎨 ");
        let mut data = b"Comment\0\0\0zh-Hans\0".to_vec();
        data.extend_from_slice("注释".as_bytes()); data.push(0); data.extend_from_slice("提示词".as_bytes());
        assert_eq!(metadata(&append_text_chunk(b"iTXt", &data)).unwrap().entries[0].value, "提示词");
    }
    #[test]fn metadata_text_parser_rejects_unsupported_and_malformed_data() {
        assert!(text_entry(b"iTXt", b"Comment\0\x01\0\0\0compressed").is_none());
        assert!(text_entry(b"iTXt", b"Comment\0\0\x01\0\0invalid-method").is_none());
        assert!(text_entry(b"zTXt", b"Comment\0\0compressed").is_none());
        for data in [b"Comment".as_slice(), b"Comment\0".as_slice(), b"Comment\0\0\0en".as_slice(), b"Comment\0\0\0\0\0\xff".as_slice()] {
            assert!(text_entry(b"iTXt", data).is_none());
        }
        assert_eq!(text_entry(b"tEXt", b"Comment\0caf\xe9").unwrap().value, "café");
        assert_eq!(text_entry(b"tEXt", b"Comment\0").unwrap().value, "");
        assert!(text_entry(b"tEXt", b"\0invalid-key").is_none());
    }
    #[test]fn rejects_paths_and_non_images(){assert!(path(Path::new("test"),"assets","../private","png").is_err());assert!(decode(b"not png").is_err());}
    #[test]fn import_and_thumbnail_are_local(){let root=tempfile::tempdir().unwrap();let bytes=png(&DynamicImage::new_rgb8(32,48)).unwrap();let a=import(root.path(),&STANDARD.encode(bytes)).unwrap();assert_eq!((a.width,a.height),(32,48));assert!(a.preview_url.starts_with("data:image/png;base64,"));assert!(path(root.path(),"assets",&a.id,"png").unwrap().exists());}
    #[test]fn zip_retains_png_and_checks_size() {let bytes=png(&DynamicImage::new_rgb8(64,64)).unwrap();let mut c=Cursor::new(Vec::new());{let mut z=zip::ZipWriter::new(&mut c);z.start_file("image_0.png",zip::write::SimpleFileOptions::default()).unwrap();z.write_all(&bytes).unwrap();z.finish().unwrap();}assert_eq!(output_from_zip(c.get_ref(),64,64).unwrap(),bytes);assert!(output_from_zip(c.get_ref(),128,64).is_err());}
}
