use std::{
    ffi::{c_char, c_void, CStr},
    fs,
    io::{Cursor, Read},
    os::windows::ffi::OsStringExt,
    path::PathBuf,
    ptr,
};

use windows_sys::Win32::Globalization::{MultiByteToWideChar, CP_ACP};

const PLUGIN_SUPPORT_READ: u32 = 0x0001;
const PICTURE_TYPE_RGB: i32 = 0;
const TRUE: i32 = 1;
const FALSE: i32 = 0;

const MAX_AIPAINT_FILE_BYTES: usize = 512 * 1024 * 1024;
const MAX_THUMBNAIL_PNG_BYTES: u64 = 16 * 1024 * 1024;
const MAX_THUMBNAIL_DIMENSION: u32 = 4096;
const MAX_THUMBNAIL_RGB_BYTES: usize = 64 * 1024 * 1024;
const THUMBNAIL_ENTRY_NAME: &str = "thumbnail.png";

#[derive(Debug)]
pub struct LoadedPicture {
    width: u32,
    height: u32,
    stride: usize,
    rgb: Vec<u8>,
}

#[no_mangle]
pub unsafe extern "system" fn gfpGetPluginInfo(
    _version: u32,
    label: *mut c_char,
    label_max_size: i32,
    extension: *mut c_char,
    extension_max_size: i32,
    support: *mut i32,
) -> i32 {
    if label.is_null()
        || extension.is_null()
        || support.is_null()
        || label_max_size <= 0
        || extension_max_size <= 0
    {
        return FALSE;
    }

    copy_c_string(label, label_max_size, b"AI Paint\0");
    copy_c_string(extension, extension_max_size, b"aipaint\0");
    unsafe {
        *support = PLUGIN_SUPPORT_READ as i32;
    }
    TRUE
}

#[no_mangle]
pub unsafe extern "system" fn gfpLoadPictureInit(file_name: *const c_char) -> *mut c_void {
    if file_name.is_null() {
        return ptr::null_mut();
    }

    let Some(path) = (unsafe { c_path_to_path_buf(file_name) }) else {
        return ptr::null_mut();
    };
    match load_aipaint_preview(&path) {
        Ok(image) => Box::into_raw(Box::new(image)).cast::<c_void>(),
        Err(_) => ptr::null_mut(),
    }
}

#[no_mangle]
pub unsafe extern "system" fn gfpLoadPictureGetInfo(
    user_data: *mut c_void,
    picture_type: *mut i32,
    width: *mut i32,
    height: *mut i32,
    dpi: *mut i32,
    bits_per_pixel: *mut i32,
    bytes_per_line: *mut i32,
    has_colormap: *mut i32,
    label: *mut c_char,
    label_max_size: i32,
) -> i32 {
    if user_data.is_null()
        || picture_type.is_null()
        || width.is_null()
        || height.is_null()
        || dpi.is_null()
        || bits_per_pixel.is_null()
        || bytes_per_line.is_null()
        || has_colormap.is_null()
    {
        return FALSE;
    }

    let image = unsafe { &*(user_data.cast::<LoadedPicture>()) };
    unsafe {
        *picture_type = PICTURE_TYPE_RGB;
        *width = image.width as i32;
        *height = image.height as i32;
        *dpi = 72;
        *bits_per_pixel = 24;
        *bytes_per_line = image.stride as i32;
        *has_colormap = FALSE;
    }
    copy_c_string(label, label_max_size, b"AI Paint\0");
    TRUE
}

#[no_mangle]
pub unsafe extern "system" fn gfpLoadPictureGetLine(
    user_data: *mut c_void,
    line: u32,
    buffer: *mut u8,
) -> i32 {
    if user_data.is_null() || buffer.is_null() {
        return FALSE;
    }

    let image = unsafe { &*(user_data.cast::<LoadedPicture>()) };
    if line >= image.height {
        return FALSE;
    }

    let start = line as usize * image.stride;
    let end = start + image.stride;
    unsafe {
        ptr::copy_nonoverlapping(image.rgb[start..end].as_ptr(), buffer, image.stride);
    }
    TRUE
}

#[no_mangle]
pub unsafe extern "system" fn gfpLoadPictureExit(user_data: *mut c_void) {
    if !user_data.is_null() {
        let _ = unsafe { Box::from_raw(user_data.cast::<LoadedPicture>()) };
    }
}

#[no_mangle]
pub extern "system" fn gfpLoadPictureGetColormap(
    _user_data: *mut c_void,
    _colormap: *mut c_void,
) -> i32 {
    FALSE
}

#[no_mangle]
pub extern "system" fn gfpSavePictureIsSupported(
    _width: i32,
    _height: i32,
    _bits_per_pixel: i32,
    _has_colormap: i32,
) -> i32 {
    FALSE
}

fn copy_c_string(buffer: *mut c_char, buffer_size: i32, text: &[u8]) {
    if buffer.is_null() || buffer_size <= 0 {
        return;
    }
    let buffer_size = buffer_size as usize;
    let copy_len = text.len().min(buffer_size);
    unsafe {
        ptr::copy_nonoverlapping(text.as_ptr().cast::<c_char>(), buffer, copy_len);
        *buffer.add(buffer_size.saturating_sub(1)) = 0;
    }
}

unsafe fn c_path_to_path_buf(file_name: *const c_char) -> Option<PathBuf> {
    let path = unsafe { CStr::from_ptr(file_name) };
    if let Ok(path) = path.to_str() {
        return Some(PathBuf::from(path));
    }
    ansi_bytes_to_path_buf(path.to_bytes())
}

fn ansi_bytes_to_path_buf(bytes: &[u8]) -> Option<PathBuf> {
    if bytes.is_empty() {
        return None;
    }
    let wide_len = unsafe {
        MultiByteToWideChar(
            CP_ACP,
            0,
            bytes.as_ptr(),
            bytes.len() as i32,
            ptr::null_mut(),
            0,
        )
    };
    if wide_len <= 0 {
        return None;
    }

    let mut wide = vec![0u16; wide_len as usize];
    let written = unsafe {
        MultiByteToWideChar(
            CP_ACP,
            0,
            bytes.as_ptr(),
            bytes.len() as i32,
            wide.as_mut_ptr(),
            wide.len() as i32,
        )
    };
    if written <= 0 {
        return None;
    }
    wide.truncate(written as usize);
    Some(PathBuf::from(std::ffi::OsString::from_wide(&wide)))
}

fn load_aipaint_preview(path: &PathBuf) -> Result<LoadedPicture, String> {
    let bytes = fs::read(path).map_err(|e| format!("file read failed: {e}"))?;
    if bytes.len() > MAX_AIPAINT_FILE_BYTES {
        return Err("file too large".into());
    }
    let png = extract_thumbnail_png(&bytes)?;
    decode_png_to_rgb(&png)
}

fn extract_thumbnail_png(archive_bytes: &[u8]) -> Result<Vec<u8>, String> {
    let reader = Cursor::new(archive_bytes);
    let mut archive = zip::ZipArchive::new(reader).map_err(|e| format!("zip read failed: {e}"))?;
    let mut thumbnail = archive
        .by_name(THUMBNAIL_ENTRY_NAME)
        .map_err(|_| "thumbnail.png missing".to_string())?;

    if thumbnail.size() > MAX_THUMBNAIL_PNG_BYTES {
        return Err("thumbnail.png too large".into());
    }

    let mut bytes = Vec::with_capacity(thumbnail.size() as usize);
    thumbnail
        .read_to_end(&mut bytes)
        .map_err(|e| format!("thumbnail read failed: {e}"))?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err("thumbnail.png has invalid PNG signature".into());
    }
    Ok(bytes)
}

fn decode_png_to_rgb(bytes: &[u8]) -> Result<LoadedPicture, String> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|e| format!("png header failed: {e}"))?;
    let info = reader.info();
    validate_thumbnail_dimensions(info.width, info.height)?;

    let output_buffer_size = reader.output_buffer_size();
    if output_buffer_size > MAX_THUMBNAIL_RGB_BYTES {
        return Err("decoded thumbnail too large".into());
    }

    let mut decoded = vec![0; output_buffer_size];
    let frame = reader
        .next_frame(&mut decoded)
        .map_err(|e| format!("png decode failed: {e}"))?;
    let data = &decoded[..frame.buffer_size()];
    let rgb = normalize_to_rgb(data, frame.color_type)?;
    let stride = checked_rgb_stride(frame.width)?;

    Ok(LoadedPicture {
        width: frame.width,
        height: frame.height,
        stride,
        rgb,
    })
}

fn normalize_to_rgb(bytes: &[u8], color_type: png::ColorType) -> Result<Vec<u8>, String> {
    let pixel_count = match color_type {
        png::ColorType::Rgb => bytes.len() / 3,
        png::ColorType::Rgba => bytes.len() / 4,
        png::ColorType::Grayscale => bytes.len(),
        png::ColorType::GrayscaleAlpha => bytes.len() / 2,
        png::ColorType::Indexed => return Err("indexed PNG was not expanded".into()),
    };

    let mut rgb = Vec::with_capacity(pixel_count * 3);
    match color_type {
        png::ColorType::Rgb => rgb.extend_from_slice(bytes),
        png::ColorType::Rgba => {
            for pixel in bytes.chunks_exact(4) {
                blend_over_white(pixel, &mut rgb);
            }
        }
        png::ColorType::Grayscale => {
            for gray in bytes {
                rgb.extend_from_slice(&[*gray, *gray, *gray]);
            }
        }
        png::ColorType::GrayscaleAlpha => {
            for pixel in bytes.chunks_exact(2) {
                blend_gray_over_white(pixel[0], pixel[1], &mut rgb);
            }
        }
        png::ColorType::Indexed => unreachable!(),
    }
    Ok(rgb)
}

fn blend_over_white(source_rgba: &[u8], rgb: &mut Vec<u8>) {
    let alpha = u16::from(source_rgba[3]);
    let inverse_alpha = 255 - alpha;
    rgb.push(blend_channel(source_rgba[0], alpha, inverse_alpha));
    rgb.push(blend_channel(source_rgba[1], alpha, inverse_alpha));
    rgb.push(blend_channel(source_rgba[2], alpha, inverse_alpha));
}

fn blend_gray_over_white(gray: u8, alpha: u8, rgb: &mut Vec<u8>) {
    let alpha = u16::from(alpha);
    let inverse_alpha = 255 - alpha;
    let value = blend_channel(gray, alpha, inverse_alpha);
    rgb.extend_from_slice(&[value, value, value]);
}

fn blend_channel(source: u8, alpha: u16, inverse_alpha: u16) -> u8 {
    ((u16::from(source) * alpha + 255 * inverse_alpha + 127) / 255) as u8
}

fn validate_thumbnail_dimensions(width: u32, height: u32) -> Result<(), String> {
    if width == 0
        || height == 0
        || width > MAX_THUMBNAIL_DIMENSION
        || height > MAX_THUMBNAIL_DIMENSION
    {
        return Err("invalid thumbnail dimensions".into());
    }
    let rgb_len = u64::from(width)
        .checked_mul(u64::from(height))
        .and_then(|value| value.checked_mul(3))
        .ok_or_else(|| "invalid thumbnail dimensions".to_string())?;
    if rgb_len > MAX_THUMBNAIL_RGB_BYTES as u64 {
        return Err("decoded thumbnail too large".into());
    }
    Ok(())
}

fn checked_rgb_stride(width: u32) -> Result<usize, String> {
    let stride = u64::from(width)
        .checked_mul(3)
        .ok_or_else(|| "invalid thumbnail width".to_string())?;
    usize::try_from(stride).map_err(|_| "invalid thumbnail width".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    #[test]
    fn decodes_thumbnail_png_to_rgb() {
        let png = tiny_png_rgba(2, 1, &[255, 0, 0, 255, 0, 255, 0, 128]);
        let archive = aipaint_archive(&png);
        let extracted = extract_thumbnail_png(&archive).expect("thumbnail");
        let image = decode_png_to_rgb(&extracted).expect("decode");

        assert_eq!((image.width, image.height), (2, 1));
        assert_eq!(image.stride, 6);
        assert_eq!(image.rgb, vec![255, 0, 0, 127, 255, 127]);
    }

    fn aipaint_archive(thumbnail_png: &[u8]) -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
        writer
            .start_file(THUMBNAIL_ENTRY_NAME, options)
            .expect("start thumbnail");
        writer.write_all(thumbnail_png).expect("write thumbnail");
        writer
            .start_file("manifest.json", options)
            .expect("start manifest");
        writer
            .write_all(br#"{"magic":"aipaint-v2","version":2}"#)
            .expect("write manifest");
        writer.finish().expect("finish zip").into_inner()
    }

    fn tiny_png_rgba(width: u32, height: u32, rgba: &[u8]) -> Vec<u8> {
        let mut bytes = Vec::new();
        {
            let mut encoder = png::Encoder::new(&mut bytes, width, height);
            encoder.set_color(png::ColorType::Rgba);
            encoder.set_depth(png::BitDepth::Eight);
            let mut writer = encoder.write_header().expect("png header");
            writer.write_image_data(rgba).expect("png data");
        }
        bytes
    }
}
