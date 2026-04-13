use std::path::PathBuf;
use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use pdfium_auto::bind_bundled;
use pdfium_render::prelude::*;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfNativeTextChar {
    pub char_index: usize,
    pub text: String,
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
    pub font_size: f32,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfNativePageTextLayout {
    pub source: String,
    pub page_number: usize,
    pub width: f32,
    pub height: f32,
    pub text: String,
    pub chars: Vec<PdfNativeTextChar>,
}

static PDF_PAGE_LAYOUT_CACHE: OnceLock<Mutex<HashMap<String, PdfNativePageTextLayout>>> = OnceLock::new();

fn get_pdfium() -> Result<Pdfium, String> {
    bind_bundled().map_err(|error| error.to_string())
}

fn normalize_pdf_path(path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(path);
    let canonical = std::fs::canonicalize(&candidate).map_err(|error| error.to_string())?;
    if !canonical.is_file() {
        return Err(format!("PDF path is not a file: {}", canonical.display()));
    }
    Ok(canonical)
}

fn pdf_page_layout_cache() -> &'static Mutex<HashMap<String, PdfNativePageTextLayout>> {
    PDF_PAGE_LAYOUT_CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn build_cache_key(path: &PathBuf, page_number: usize) -> String {
    format!("{}::{page_number}", path.to_string_lossy())
}

fn pdf_points_value(points: PdfPoints) -> f32 {
    points.value as f32
}

fn pdf_rect_to_top_left(rect: PdfRect, page_height: f32) -> (f32, f32, f32, f32) {
    let left = rect.left().value as f32;
    let right = rect.right().value as f32;
    let top = page_height - rect.top().value as f32;
    let bottom = page_height - rect.bottom().value as f32;
    (left, top, right, bottom)
}

#[tauri::command]
pub async fn desktop_extract_pdf_page_text_layout(
    path: String,
    page_number: usize,
) -> Result<PdfNativePageTextLayout, String> {
    if page_number < 1 {
        return Err("pageNumber must be >= 1".to_string());
    }

    let normalized_path = normalize_pdf_path(&path)?;
    let cache_key = build_cache_key(&normalized_path, page_number);
    if let Some(cached) = pdf_page_layout_cache()
        .lock()
        .map_err(|error| error.to_string())?
        .get(&cache_key)
        .cloned()
    {
        return Ok(cached);
    }

    let pdfium = get_pdfium()?;
    let document = pdfium
        .load_pdf_from_file(&normalized_path, None)
        .map_err(|error| error.to_string())?;
    let page = document
        .pages()
        .get((page_number - 1) as u16)
        .map_err(|error| error.to_string())?;

    let page_width = pdf_points_value(page.width());
    let page_height = pdf_points_value(page.height());
    let text_page = page.text().map_err(|error| error.to_string())?;
    let text = text_page.all();
    let chars = text_page
        .chars()
        .iter()
        .enumerate()
        .filter_map(|(char_index, character)| {
            let text = character.unicode_string()?;
            if text.is_empty() {
                return None;
            }

            let bounds = character
                .tight_bounds()
                .or_else(|_| character.loose_bounds())
                .ok()?;
            let (x1, y1, x2, y2) = pdf_rect_to_top_left(bounds, page_height);
            if x2 <= x1 || y2 <= y1 {
                return None;
            }

            Some(PdfNativeTextChar {
                char_index,
                text,
                x1,
                y1,
                x2,
                y2,
                font_size: character.scaled_font_size().value as f32,
            })
        })
        .collect::<Vec<_>>();

    let layout = PdfNativePageTextLayout {
        source: "pdfium".to_string(),
        page_number,
        width: page_width,
        height: page_height,
        text,
        chars,
    };

    pdf_page_layout_cache()
        .lock()
        .map_err(|error| error.to_string())?
        .insert(cache_key, layout.clone());

    Ok(layout)
}
