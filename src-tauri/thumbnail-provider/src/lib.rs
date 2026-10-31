use std::{
    cell::RefCell,
    ffi::c_void,
    io::{Cursor, Read},
    ptr::null_mut,
};

use windows::{
    core::{implement, w, Error, IUnknown, Interface, Ref, Result, GUID},
    Win32::{
        Foundation::{
            CLASS_E_CLASSNOTAVAILABLE, CLASS_E_NOAGGREGATION, COLORREF, E_FAIL, E_INVALIDARG,
            E_POINTER, HWND, LPARAM, RECT, S_FALSE, WPARAM,
        },
        Graphics::Gdi::{
            CreateDIBSection, DeleteObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
            HBITMAP, HGDIOBJ, LOGFONTW,
        },
        System::{
            Com::{IClassFactory, IClassFactory_Impl, IStream},
            Ole::{IObjectWithSite, IObjectWithSite_Impl, IOleWindow, IOleWindow_Impl},
            SystemServices::{SS_BITMAP, SS_CENTERIMAGE},
        },
        UI::{
            Shell::{
                IPreviewHandler, IPreviewHandlerVisuals, IPreviewHandlerVisuals_Impl,
                IPreviewHandler_Impl, IThumbnailProvider, IThumbnailProvider_Impl,
                PropertiesSystem::{IInitializeWithStream, IInitializeWithStream_Impl},
                WTSAT_ARGB,
            },
            WindowsAndMessaging::{
                CreateWindowExW, DestroyWindow, MoveWindow, SendMessageW, IMAGE_BITMAP, MSG,
                STM_SETIMAGE, WINDOW_EX_STYLE, WINDOW_STYLE, WS_CHILD, WS_VISIBLE,
            },
        },
    },
};

const MAX_AIPAINT_STREAM_BYTES: usize = 512 * 1024 * 1024;
const MAX_THUMBNAIL_PNG_BYTES: u64 = 16 * 1024 * 1024;
const MAX_THUMBNAIL_DIMENSION: u32 = 4096;
const MAX_THUMBNAIL_RGBA_BYTES: usize = 64 * 1024 * 1024;
const MAX_PREVIEW_DIMENSION: u32 = 4096;
const MAX_PREVIEW_RGBA_BYTES: usize = 64 * 1024 * 1024;
const THUMBNAIL_ENTRY_NAME: &str = "thumbnail.png";

pub const AIPAINT_THUMBNAIL_PROVIDER_CLSID: GUID = GUID::from_values(
    0x8f3cf5a5,
    0x6b4e,
    0x4eb8,
    [0x97, 0xf9, 0x32, 0xaa, 0x4e, 0xa6, 0x6f, 0xdd],
);

pub const AIPAINT_PREVIEW_HANDLER_CLSID: GUID = GUID::from_values(
    0xa4c0c13d,
    0x4045,
    0x4fe7,
    [0x9e, 0xb3, 0xeb, 0xa8, 0x56, 0xb9, 0x33, 0x28],
);

#[implement(
    IThumbnailProvider,
    IPreviewHandler,
    IPreviewHandlerVisuals,
    IInitializeWithStream,
    IObjectWithSite,
    IOleWindow
)]
struct AiPaintThumbnailProvider {
    archive_bytes: RefCell<Option<Vec<u8>>>,
    parent_window: RefCell<Option<HWND>>,
    preview_rect: RefCell<Option<RECT>>,
    preview_window: RefCell<Option<HWND>>,
    preview_bitmap: RefCell<Option<HBITMAP>>,
    site: RefCell<Option<IUnknown>>,
    background_color: RefCell<COLORREF>,
}

impl AiPaintThumbnailProvider {
    fn new() -> Self {
        Self {
            archive_bytes: RefCell::new(None),
            parent_window: RefCell::new(None),
            preview_rect: RefCell::new(None),
            preview_window: RefCell::new(None),
            preview_bitmap: RefCell::new(None),
            site: RefCell::new(None),
            background_color: RefCell::new(COLORREF(0x00ffffff)),
        }
    }

    fn ensure_preview_window(&self) -> Result<HWND> {
        if let Some(hwnd) = *self.preview_window.borrow() {
            return Ok(hwnd);
        }

        let parent = (*self.parent_window.borrow())
            .ok_or_else(|| Error::new(E_FAIL, "Preview parent window is not set"))?;
        let rect = (*self.preview_rect.borrow())
            .ok_or_else(|| Error::new(E_FAIL, "Preview rectangle is not set"))?;
        let (left, top, width, height) = preview_rect_frame(&rect)?;
        let style = WINDOW_STYLE(WS_CHILD.0 | WS_VISIBLE.0 | SS_BITMAP.0 | SS_CENTERIMAGE.0);
        let hwnd = unsafe {
            CreateWindowExW(
                WINDOW_EX_STYLE(0),
                w!("STATIC"),
                w!(""),
                style,
                left,
                top,
                width,
                height,
                Some(parent),
                None,
                None,
                None,
            )
        }?;
        self.preview_window.replace(Some(hwnd));
        Ok(hwnd)
    }

    fn render_preview(&self) -> Result<()> {
        let hwnd = self.ensure_preview_window()?;
        let archive = self.archive_bytes.borrow();
        let archive = archive
            .as_deref()
            .ok_or_else(|| Error::new(E_FAIL, "Preview stream is not initialized"))?;
        let rect = (*self.preview_rect.borrow())
            .ok_or_else(|| Error::new(E_FAIL, "Preview rectangle is not set"))?;
        let (_, _, width, height) = preview_rect_frame(&rect)?;
        let png_bytes = extract_thumbnail_png(archive).map_err(to_windows_error)?;
        let decoded = decode_png_rgba(&png_bytes).map_err(to_windows_error)?;
        let composed = decoded
            .compose_for_preview(width as u32, height as u32, *self.background_color.borrow())
            .map_err(to_windows_error)?;
        let hbmp = create_hbitmap_from_rgba(&composed).map_err(to_windows_error)?;
        unsafe {
            SendMessageW(
                hwnd,
                STM_SETIMAGE,
                Some(WPARAM(IMAGE_BITMAP.0 as usize)),
                Some(LPARAM(hbmp.0 as isize)),
            );
        }
        if let Some(old_bitmap) = self.preview_bitmap.replace(Some(hbmp)) {
            delete_hbitmap(old_bitmap);
        }
        Ok(())
    }

    fn move_preview_window(&self) -> Result<()> {
        let Some(hwnd) = *self.preview_window.borrow() else {
            return Ok(());
        };
        let rect = (*self.preview_rect.borrow())
            .ok_or_else(|| Error::new(E_FAIL, "Preview rectangle is not set"))?;
        let (left, top, width, height) = preview_rect_frame(&rect)?;
        unsafe {
            MoveWindow(hwnd, left, top, width, height, true)?;
        }
        self.render_preview()
    }

    fn unload_preview(&self) {
        if let Some(hwnd) = self.preview_window.replace(None) {
            unsafe {
                let _ = DestroyWindow(hwnd);
            }
        }
        if let Some(hbmp) = self.preview_bitmap.replace(None) {
            delete_hbitmap(hbmp);
        }
    }
}

#[allow(non_snake_case)]
impl IInitializeWithStream_Impl for AiPaintThumbnailProvider_Impl {
    fn Initialize(&self, stream: Ref<'_, IStream>, _grfmode: u32) -> Result<()> {
        if stream.is_null() {
            return Err(Error::from_hresult(E_POINTER));
        }
        let bytes = read_stream_with_limit(stream.unwrap(), MAX_AIPAINT_STREAM_BYTES)?;
        self.archive_bytes.replace(Some(bytes));
        Ok(())
    }
}

#[allow(non_snake_case)]
impl IThumbnailProvider_Impl for AiPaintThumbnailProvider_Impl {
    fn GetThumbnail(
        &self,
        cx: u32,
        phbmp: *mut HBITMAP,
        pdwalpha: *mut windows::Win32::UI::Shell::WTS_ALPHATYPE,
    ) -> Result<()> {
        if phbmp.is_null() || pdwalpha.is_null() {
            return Err(Error::from_hresult(E_POINTER));
        }
        if cx == 0 {
            return Err(Error::from_hresult(E_INVALIDARG));
        }

        let archive = self.archive_bytes.borrow();
        let archive = archive
            .as_deref()
            .ok_or_else(|| Error::new(E_FAIL, "IInitializeWithStream が呼ばれていません"))?;
        let png_bytes = extract_thumbnail_png(archive).map_err(to_windows_error)?;
        let decoded = decode_png_rgba(&png_bytes).map_err(to_windows_error)?;
        let resized = decoded.resize_to_fit(cx).map_err(to_windows_error)?;
        let hbmp = create_hbitmap_from_rgba(&resized).map_err(to_windows_error)?;

        unsafe {
            *phbmp = hbmp;
            *pdwalpha = WTSAT_ARGB;
        }
        Ok(())
    }
}

#[allow(non_snake_case)]
impl IPreviewHandler_Impl for AiPaintThumbnailProvider_Impl {
    fn SetWindow(&self, hwnd: HWND, prc: *const RECT) -> Result<()> {
        if hwnd.is_invalid() {
            return Err(Error::from_hresult(E_INVALIDARG));
        }
        if prc.is_null() {
            return Err(Error::from_hresult(E_POINTER));
        }
        self.parent_window.replace(Some(hwnd));
        self.preview_rect.replace(Some(unsafe { *prc }));
        self.move_preview_window()
    }

    fn SetRect(&self, prc: *const RECT) -> Result<()> {
        if prc.is_null() {
            return Err(Error::from_hresult(E_POINTER));
        }
        self.preview_rect.replace(Some(unsafe { *prc }));
        self.move_preview_window()
    }

    fn DoPreview(&self) -> Result<()> {
        self.render_preview()
    }

    fn Unload(&self) -> Result<()> {
        self.unload_preview();
        Ok(())
    }

    fn SetFocus(&self) -> Result<()> {
        Ok(())
    }

    fn QueryFocus(&self) -> Result<HWND> {
        if let Some(hwnd) = *self.preview_window.borrow() {
            return Ok(hwnd);
        }
        if let Some(hwnd) = *self.parent_window.borrow() {
            return Ok(hwnd);
        }
        Err(Error::new(E_FAIL, "Preview window is not available"))
    }

    fn TranslateAccelerator(&self, _pmsg: *const MSG) -> Result<()> {
        Ok(())
    }
}

#[allow(non_snake_case)]
impl IPreviewHandlerVisuals_Impl for AiPaintThumbnailProvider_Impl {
    fn SetBackgroundColor(&self, color: COLORREF) -> Result<()> {
        self.background_color.replace(color);
        if self.preview_window.borrow().is_some() {
            self.render_preview()?;
        }
        Ok(())
    }

    fn SetFont(&self, _plf: *const LOGFONTW) -> Result<()> {
        Ok(())
    }

    fn SetTextColor(&self, _color: COLORREF) -> Result<()> {
        Ok(())
    }
}

#[allow(non_snake_case)]
impl IObjectWithSite_Impl for AiPaintThumbnailProvider_Impl {
    fn SetSite(&self, punksite: Ref<'_, IUnknown>) -> Result<()> {
        if punksite.is_null() {
            self.site.replace(None);
        } else {
            self.site.replace(Some(punksite.unwrap().clone()));
        }
        Ok(())
    }

    fn GetSite(&self, riid: *const GUID, ppvsite: *mut *mut c_void) -> Result<()> {
        if riid.is_null() || ppvsite.is_null() {
            return Err(Error::from_hresult(E_POINTER));
        }
        unsafe {
            *ppvsite = null_mut();
        }
        let site = self.site.borrow();
        let site = site
            .as_ref()
            .ok_or_else(|| Error::new(E_FAIL, "Preview site is not set"))?;
        let hr = unsafe { site.query(riid, ppvsite) };
        if hr.is_ok() {
            Ok(())
        } else {
            Err(Error::from_hresult(hr))
        }
    }
}

#[allow(non_snake_case)]
impl IOleWindow_Impl for AiPaintThumbnailProvider_Impl {
    fn GetWindow(&self) -> Result<HWND> {
        if let Some(hwnd) = *self.preview_window.borrow() {
            return Ok(hwnd);
        }
        if let Some(hwnd) = *self.parent_window.borrow() {
            return Ok(hwnd);
        }
        Err(Error::new(E_FAIL, "Preview window is not available"))
    }

    fn ContextSensitiveHelp(&self, _fentermode: windows::core::BOOL) -> Result<()> {
        Ok(())
    }
}

#[implement(IClassFactory)]
struct ThumbnailClassFactory;

#[allow(non_snake_case)]
impl IClassFactory_Impl for ThumbnailClassFactory_Impl {
    fn CreateInstance(
        &self,
        outer: Ref<'_, windows::core::IUnknown>,
        riid: *const GUID,
        ppvobject: *mut *mut c_void,
    ) -> Result<()> {
        if !outer.is_null() {
            return Err(Error::from_hresult(CLASS_E_NOAGGREGATION));
        }
        if ppvobject.is_null() || riid.is_null() {
            return Err(Error::from_hresult(E_POINTER));
        }
        unsafe {
            *ppvobject = null_mut();
        }

        let provider: IUnknown = AiPaintThumbnailProvider::new().into();
        let hr = unsafe { provider.query(riid, ppvobject) };
        if hr.is_ok() {
            Ok(())
        } else {
            Err(Error::from_hresult(hr))
        }
    }

    fn LockServer(&self, _flock: windows::core::BOOL) -> Result<()> {
        Ok(())
    }
}

#[no_mangle]
pub unsafe extern "system" fn DllGetClassObject(
    rclsid: *const GUID,
    riid: *const GUID,
    ppv: *mut *mut c_void,
) -> windows::core::HRESULT {
    if ppv.is_null() {
        return E_POINTER;
    }
    *ppv = null_mut();
    if rclsid.is_null() || riid.is_null() {
        return E_POINTER;
    }
    if *rclsid != AIPAINT_THUMBNAIL_PROVIDER_CLSID && *rclsid != AIPAINT_PREVIEW_HANDLER_CLSID {
        return CLASS_E_CLASSNOTAVAILABLE;
    }

    let factory: IClassFactory = ThumbnailClassFactory.into();
    factory.query(riid, ppv)
}

#[no_mangle]
pub extern "system" fn DllCanUnloadNow() -> windows::core::HRESULT {
    S_FALSE
}

fn read_stream_with_limit(stream: &IStream, limit: usize) -> Result<Vec<u8>> {
    let mut bytes = Vec::new();
    let mut buffer = [0u8; 64 * 1024];

    loop {
        let mut read = 0u32;
        let hr = unsafe {
            stream.Read(
                buffer.as_mut_ptr().cast::<c_void>(),
                buffer.len() as u32,
                Some(&mut read),
            )
        };
        if hr.is_err() {
            return Err(Error::from_hresult(hr));
        }
        if read == 0 {
            break;
        }
        let read = read as usize;
        if bytes.len().saturating_add(read) > limit {
            return Err(Error::new(
                E_FAIL,
                ".aipaint ファイルがサムネイル抽出上限を超えています",
            ));
        }
        bytes.extend_from_slice(&buffer[..read]);
    }

    Ok(bytes)
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DecodedThumbnail {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

impl DecodedThumbnail {
    fn resize_to_fit(&self, max_side: u32) -> std::result::Result<Self, ThumbnailError> {
        let (width, height) = fit_within(self.width, self.height, max_side)?;
        if width == self.width && height == self.height {
            return Ok(self.clone());
        }

        let mut rgba = vec![0u8; checked_rgba_len(width, height)?];
        for y in 0..height {
            let src_y = (u64::from(y) * u64::from(self.height) / u64::from(height)) as u32;
            for x in 0..width {
                let src_x = (u64::from(x) * u64::from(self.width) / u64::from(width)) as u32;
                let src = ((src_y * self.width + src_x) * 4) as usize;
                let dst = ((y * width + x) * 4) as usize;
                rgba[dst..dst + 4].copy_from_slice(&self.rgba[src..src + 4]);
            }
        }

        Ok(Self {
            width,
            height,
            rgba,
        })
    }

    fn compose_for_preview(
        &self,
        width: u32,
        height: u32,
        background_color: COLORREF,
    ) -> std::result::Result<Self, ThumbnailError> {
        validate_preview_dimensions(width, height)?;
        let (image_width, image_height) = fit_within_rect(self.width, self.height, width, height)?;
        let offset_x = (width - image_width) / 2;
        let offset_y = (height - image_height) / 2;
        let background = colorref_rgb(background_color);
        let mut rgba = vec![255u8; checked_preview_rgba_len(width, height)?];

        for pixel in rgba.chunks_exact_mut(4) {
            pixel[0] = background[0];
            pixel[1] = background[1];
            pixel[2] = background[2];
        }

        for y in 0..image_height {
            let src_y = (u64::from(y) * u64::from(self.height) / u64::from(image_height)) as u32;
            for x in 0..image_width {
                let src_x = (u64::from(x) * u64::from(self.width) / u64::from(image_width)) as u32;
                let src = ((src_y * self.width + src_x) * 4) as usize;
                let dst = (((offset_y + y) * width + offset_x + x) * 4) as usize;
                blend_over_background(
                    &self.rgba[src..src + 4],
                    &mut rgba[dst..dst + 4],
                    background,
                );
            }
        }

        Ok(Self {
            width,
            height,
            rgba,
        })
    }
}

pub fn extract_thumbnail_png(archive_bytes: &[u8]) -> std::result::Result<Vec<u8>, ThumbnailError> {
    let reader = Cursor::new(archive_bytes);
    let mut archive =
        zip::ZipArchive::new(reader).map_err(|e| ThumbnailError::InvalidArchive(e.to_string()))?;
    let mut thumbnail = archive
        .by_name(THUMBNAIL_ENTRY_NAME)
        .map_err(|_| ThumbnailError::MissingThumbnail)?;

    if thumbnail.size() > MAX_THUMBNAIL_PNG_BYTES {
        return Err(ThumbnailError::ThumbnailTooLarge(thumbnail.size()));
    }

    let mut bytes = Vec::with_capacity(thumbnail.size() as usize);
    thumbnail
        .read_to_end(&mut bytes)
        .map_err(|e| ThumbnailError::InvalidArchive(e.to_string()))?;
    if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        return Err(ThumbnailError::InvalidPng(
            "PNG signature がありません".into(),
        ));
    }
    Ok(bytes)
}

pub fn decode_png_rgba(bytes: &[u8]) -> std::result::Result<DecodedThumbnail, ThumbnailError> {
    let mut decoder = png::Decoder::new(Cursor::new(bytes));
    decoder.set_transformations(png::Transformations::EXPAND | png::Transformations::STRIP_16);
    let mut reader = decoder
        .read_info()
        .map_err(|e| ThumbnailError::InvalidPng(e.to_string()))?;
    let header = reader.info();
    validate_thumbnail_dimensions(header.width, header.height)?;
    let output_buffer_size = reader.output_buffer_size();
    if output_buffer_size > MAX_THUMBNAIL_RGBA_BYTES {
        return Err(ThumbnailError::DecodedThumbnailTooLarge(output_buffer_size));
    }

    let mut buffer = vec![0; output_buffer_size];
    let info = reader
        .next_frame(&mut buffer)
        .map_err(|e| ThumbnailError::InvalidPng(e.to_string()))?;
    let bytes = &buffer[..info.buffer_size()];
    let rgba = normalize_to_rgba(bytes, info.color_type)?;

    Ok(DecodedThumbnail {
        width: info.width,
        height: info.height,
        rgba,
    })
}

fn normalize_to_rgba(
    bytes: &[u8],
    color_type: png::ColorType,
) -> std::result::Result<Vec<u8>, ThumbnailError> {
    let pixel_count = match color_type {
        png::ColorType::Rgb => bytes.len() / 3,
        png::ColorType::Rgba => bytes.len() / 4,
        png::ColorType::Grayscale => bytes.len(),
        png::ColorType::GrayscaleAlpha => bytes.len() / 2,
        png::ColorType::Indexed => {
            return Err(ThumbnailError::InvalidPng(
                "indexed PNG がRGBAへ展開されていません".into(),
            ))
        }
    };

    let mut rgba = Vec::with_capacity(pixel_count * 4);
    match color_type {
        png::ColorType::Rgb => {
            for pixel in bytes.chunks_exact(3) {
                rgba.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
            }
        }
        png::ColorType::Rgba => rgba.extend_from_slice(bytes),
        png::ColorType::Grayscale => {
            for gray in bytes {
                rgba.extend_from_slice(&[*gray, *gray, *gray, 255]);
            }
        }
        png::ColorType::GrayscaleAlpha => {
            for pixel in bytes.chunks_exact(2) {
                rgba.extend_from_slice(&[pixel[0], pixel[0], pixel[0], pixel[1]]);
            }
        }
        png::ColorType::Indexed => unreachable!(),
    }
    Ok(rgba)
}

fn fit_within(
    width: u32,
    height: u32,
    max_side: u32,
) -> std::result::Result<(u32, u32), ThumbnailError> {
    if width == 0 || height == 0 || max_side == 0 {
        return Err(ThumbnailError::InvalidDimensions);
    }
    if width <= max_side && height <= max_side {
        return Ok((width, height));
    }

    if width >= height {
        let scaled_height =
            ((u64::from(height) * u64::from(max_side)) / u64::from(width)).max(1) as u32;
        Ok((max_side, scaled_height))
    } else {
        let scaled_width =
            ((u64::from(width) * u64::from(max_side)) / u64::from(height)).max(1) as u32;
        Ok((scaled_width, max_side))
    }
}

fn fit_within_rect(
    width: u32,
    height: u32,
    max_width: u32,
    max_height: u32,
) -> std::result::Result<(u32, u32), ThumbnailError> {
    if width == 0 || height == 0 || max_width == 0 || max_height == 0 {
        return Err(ThumbnailError::InvalidDimensions);
    }

    if u64::from(width) * u64::from(max_height) > u64::from(height) * u64::from(max_width) {
        let scaled_height =
            ((u64::from(height) * u64::from(max_width)) / u64::from(width)).max(1) as u32;
        Ok((max_width, scaled_height))
    } else {
        let scaled_width =
            ((u64::from(width) * u64::from(max_height)) / u64::from(height)).max(1) as u32;
        Ok((scaled_width, max_height))
    }
}

fn checked_rgba_len(width: u32, height: u32) -> std::result::Result<usize, ThumbnailError> {
    let len = u64::from(width)
        .checked_mul(u64::from(height))
        .and_then(|value| value.checked_mul(4))
        .ok_or(ThumbnailError::InvalidDimensions)?;
    usize::try_from(len).map_err(|_| ThumbnailError::InvalidDimensions)
}

fn checked_preview_rgba_len(width: u32, height: u32) -> std::result::Result<usize, ThumbnailError> {
    let len = checked_rgba_len(width, height)?;
    if len > MAX_PREVIEW_RGBA_BYTES {
        return Err(ThumbnailError::DecodedThumbnailTooLarge(len));
    }
    Ok(len)
}

fn validate_thumbnail_dimensions(
    width: u32,
    height: u32,
) -> std::result::Result<(), ThumbnailError> {
    if width == 0
        || height == 0
        || width > MAX_THUMBNAIL_DIMENSION
        || height > MAX_THUMBNAIL_DIMENSION
    {
        return Err(ThumbnailError::InvalidDimensions);
    }
    let rgba_len = checked_rgba_len(width, height)?;
    if rgba_len > MAX_THUMBNAIL_RGBA_BYTES {
        return Err(ThumbnailError::DecodedThumbnailTooLarge(rgba_len));
    }
    Ok(())
}

fn validate_preview_dimensions(width: u32, height: u32) -> std::result::Result<(), ThumbnailError> {
    if width == 0 || height == 0 || width > MAX_PREVIEW_DIMENSION || height > MAX_PREVIEW_DIMENSION
    {
        return Err(ThumbnailError::InvalidDimensions);
    }
    checked_preview_rgba_len(width, height)?;
    Ok(())
}

fn preview_rect_frame(rect: &RECT) -> Result<(i32, i32, i32, i32)> {
    let width = rect.right - rect.left;
    let height = rect.bottom - rect.top;
    if width <= 0 || height <= 0 {
        return Err(Error::from_hresult(E_INVALIDARG));
    }
    Ok((rect.left, rect.top, width, height))
}

fn colorref_rgb(color: COLORREF) -> [u8; 3] {
    [
        (color.0 & 0xff) as u8,
        ((color.0 >> 8) & 0xff) as u8,
        ((color.0 >> 16) & 0xff) as u8,
    ]
}

fn blend_over_background(source_rgba: &[u8], target_rgba: &mut [u8], background: [u8; 3]) {
    let alpha = u16::from(source_rgba[3]);
    let inverse_alpha = 255 - alpha;
    target_rgba[0] = blend_channel(source_rgba[0], background[0], alpha, inverse_alpha);
    target_rgba[1] = blend_channel(source_rgba[1], background[1], alpha, inverse_alpha);
    target_rgba[2] = blend_channel(source_rgba[2], background[2], alpha, inverse_alpha);
    target_rgba[3] = 255;
}

fn blend_channel(source: u8, background: u8, alpha: u16, inverse_alpha: u16) -> u8 {
    ((u16::from(source) * alpha + u16::from(background) * inverse_alpha + 127) / 255) as u8
}

fn create_hbitmap_from_rgba(
    image: &DecodedThumbnail,
) -> std::result::Result<HBITMAP, ThumbnailError> {
    if image.width == 0 || image.height == 0 {
        return Err(ThumbnailError::InvalidDimensions);
    }
    if image.rgba.len() != checked_rgba_len(image.width, image.height)? {
        return Err(ThumbnailError::InvalidDimensions);
    }

    let mut bitmap_info = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: image.width as i32,
            biHeight: -(image.height as i32),
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut bits: *mut c_void = null_mut();
    let hbmp =
        unsafe { CreateDIBSection(None, &mut bitmap_info, DIB_RGB_COLORS, &mut bits, None, 0) }
            .map_err(|e| ThumbnailError::Gdi(e.message().to_string()))?;
    if bits.is_null() {
        return Err(ThumbnailError::Gdi(
            "CreateDIBSection が空ポインタを返しました".into(),
        ));
    }

    let target = unsafe { std::slice::from_raw_parts_mut(bits.cast::<u8>(), image.rgba.len()) };
    write_bgra_premultiplied(&image.rgba, target);
    Ok(hbmp)
}

fn delete_hbitmap(hbmp: HBITMAP) {
    if !hbmp.0.is_null() {
        unsafe {
            let _ = DeleteObject(HGDIOBJ(hbmp.0));
        }
    }
}

fn write_bgra_premultiplied(source_rgba: &[u8], target_bgra: &mut [u8]) {
    for (source, target) in source_rgba
        .chunks_exact(4)
        .zip(target_bgra.chunks_exact_mut(4))
    {
        let alpha = u16::from(source[3]);
        target[0] = premultiply(source[2], alpha);
        target[1] = premultiply(source[1], alpha);
        target[2] = premultiply(source[0], alpha);
        target[3] = source[3];
    }
}

fn premultiply(value: u8, alpha: u16) -> u8 {
    ((u16::from(value) * alpha + 127) / 255) as u8
}

fn to_windows_error(error: ThumbnailError) -> Error {
    Error::new(E_FAIL, error.to_string())
}

#[derive(Debug, PartialEq, Eq)]
pub enum ThumbnailError {
    InvalidArchive(String),
    MissingThumbnail,
    ThumbnailTooLarge(u64),
    DecodedThumbnailTooLarge(usize),
    InvalidPng(String),
    InvalidDimensions,
    Gdi(String),
}

impl std::fmt::Display for ThumbnailError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidArchive(message) => write!(f, ".aipaint ZIP を読めません: {message}"),
            Self::MissingThumbnail => write!(f, ".aipaint に thumbnail.png がありません"),
            Self::ThumbnailTooLarge(bytes) => {
                write!(f, "thumbnail.png が大きすぎます: {bytes} bytes")
            }
            Self::DecodedThumbnailTooLarge(bytes) => {
                write!(
                    f,
                    "thumbnail.png の展開後サイズが大きすぎます: {bytes} bytes"
                )
            }
            Self::InvalidPng(message) => write!(f, "thumbnail.png を読めません: {message}"),
            Self::InvalidDimensions => write!(f, "thumbnail.png のサイズが不正です"),
            Self::Gdi(message) => write!(f, "Windows bitmap を作成できません: {message}"),
        }
    }
}

impl std::error::Error for ThumbnailError {}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Cursor, Write};
    use zip::{write::SimpleFileOptions, CompressionMethod, ZipWriter};

    #[test]
    fn extracts_thumbnail_png_from_aipaint_archive() {
        let png = tiny_png_rgba(2, 1, &[255, 0, 0, 255, 0, 255, 0, 128]);
        let archive = aipaint_archive(&png);

        let extracted = extract_thumbnail_png(&archive).expect("thumbnail");
        assert_eq!(extracted, png);
    }

    #[test]
    fn reports_missing_thumbnail() {
        let archive = archive_with_manifest_only();

        let error = extract_thumbnail_png(&archive).expect_err("missing thumbnail");
        assert_eq!(error, ThumbnailError::MissingThumbnail);
    }

    #[test]
    fn decodes_png_as_rgba() {
        let png = tiny_png_rgba(1, 1, &[10, 20, 30, 40]);

        let decoded = decode_png_rgba(&png).expect("decode png");
        assert_eq!(decoded.width, 1);
        assert_eq!(decoded.height, 1);
        assert_eq!(decoded.rgba, vec![10, 20, 30, 40]);
    }

    #[test]
    fn resizes_to_requested_max_side() {
        let decoded = DecodedThumbnail {
            width: 4,
            height: 2,
            rgba: vec![
                1, 0, 0, 255, 2, 0, 0, 255, 3, 0, 0, 255, 4, 0, 0, 255, 5, 0, 0, 255, 6, 0, 0, 255,
                7, 0, 0, 255, 8, 0, 0, 255,
            ],
        };

        let resized = decoded.resize_to_fit(2).expect("resize");
        assert_eq!((resized.width, resized.height), (2, 1));
        assert_eq!(resized.rgba, vec![1, 0, 0, 255, 3, 0, 0, 255]);
    }

    #[test]
    fn composes_preview_on_solid_background() {
        let decoded = DecodedThumbnail {
            width: 2,
            height: 1,
            rgba: vec![255, 0, 0, 128, 0, 255, 0, 255],
        };

        let preview = decoded
            .compose_for_preview(4, 4, COLORREF(0x00ffffff))
            .expect("compose preview");

        assert_eq!((preview.width, preview.height), (4, 4));
        assert_eq!(&preview.rgba[0..4], &[255, 255, 255, 255]);
        let first_image_pixel = ((4 + 0) * 4) as usize;
        let third_image_pixel = ((4 + 2) * 4) as usize;
        assert_eq!(
            &preview.rgba[first_image_pixel..first_image_pixel + 4],
            &[255, 127, 127, 255]
        );
        assert_eq!(
            &preview.rgba[third_image_pixel..third_image_pixel + 4],
            &[0, 255, 0, 255]
        );
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

    fn archive_with_manifest_only() -> Vec<u8> {
        let cursor = Cursor::new(Vec::new());
        let mut writer = ZipWriter::new(cursor);
        let options = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
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
