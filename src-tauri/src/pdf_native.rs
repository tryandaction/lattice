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
    pub char_end_index: usize,
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

fn utf16_len(text: &str) -> usize {
    text.encode_utf16().count()
}

fn utf16_offset_for_byte(text: &str, byte_index: usize) -> usize {
    let safe_index = byte_index.min(text.len());
    text[..safe_index].encode_utf16().count()
}

fn clamp_to_char_boundary(text: &str, mut byte_index: usize) -> usize {
    byte_index = byte_index.min(text.len());
    while byte_index > 0 && !text.is_char_boundary(byte_index) {
        byte_index -= 1;
    }
    byte_index
}

fn resolve_glyph_utf16_offset(
    page_text: &str,
    glyph_text: &str,
    search_byte_start: &mut usize,
    fallback_utf16_offset: &mut usize,
) -> (usize, usize) {
    if glyph_text.is_empty() {
        return (*fallback_utf16_offset, *fallback_utf16_offset);
    }

    let safe_search_start = clamp_to_char_boundary(page_text, *search_byte_start);
    let search_variants = glyph_search_variants(glyph_text);
    for search_text in search_variants {
        if let Some(relative_byte_index) = page_text[safe_search_start..].find(&search_text) {
            let byte_index = safe_search_start + relative_byte_index;
            let byte_end_index = byte_index + search_text.len();
            let utf16_index = utf16_offset_for_byte(page_text, byte_index);
            let utf16_end_index = utf16_offset_for_byte(page_text, byte_end_index);
            *search_byte_start = byte_end_index;
            *fallback_utf16_offset = utf16_end_index;
            return (utf16_index, utf16_end_index);
        }
    }

    let utf16_index = *fallback_utf16_offset;
    *fallback_utf16_offset += utf16_len(glyph_text);
    (utf16_index, *fallback_utf16_offset)
}

fn glyph_search_variants(glyph_text: &str) -> Vec<String> {
    let expanded = expand_pdf_ligatures(glyph_text);
    if expanded == glyph_text {
        vec![glyph_text.to_string()]
    } else {
        vec![glyph_text.to_string(), expanded]
    }
}

fn expand_pdf_ligatures(text: &str) -> String {
    text.chars()
        .flat_map(|character| match character {
            '\u{00A0}' => " ".chars().collect::<Vec<_>>(),
            '\u{FB00}' => "ff".chars().collect::<Vec<_>>(),
            '\u{FB01}' => "fi".chars().collect::<Vec<_>>(),
            '\u{FB02}' => "fl".chars().collect::<Vec<_>>(),
            '\u{FB03}' => "ffi".chars().collect::<Vec<_>>(),
            '\u{FB04}' => "ffl".chars().collect::<Vec<_>>(),
            '\u{FB05}' => "ft".chars().collect::<Vec<_>>(),
            '\u{FB06}' => "st".chars().collect::<Vec<_>>(),
            _ => vec![character],
        })
        .collect()
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
    let mut search_byte_start = 0usize;
    let mut fallback_utf16_offset = 0usize;
    let chars = text_page
        .chars()
        .iter()
        .filter_map(|character| {
            let glyph_text = character.unicode_string()?;
            if glyph_text.is_empty() {
                return None;
            }
            let (char_index, char_end_index) = resolve_glyph_utf16_offset(
                &text,
                &glyph_text,
                &mut search_byte_start,
                &mut fallback_utf16_offset,
            );

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
                char_end_index,
                text: glyph_text,
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

#[cfg(test)]
mod tests {
    use super::*;

    fn resolve_sequence_offsets(page_text: &str, glyphs: &[&str]) -> Vec<usize> {
        resolve_sequence_offset_ranges(page_text, glyphs)
            .into_iter()
            .map(|(start, _end)| start)
            .collect()
    }

    fn resolve_sequence_offset_ranges(page_text: &str, glyphs: &[&str]) -> Vec<(usize, usize)> {
        let mut search_byte_start = 0usize;
        let mut fallback_utf16_offset = 0usize;
        glyphs
            .iter()
            .map(|glyph| {
                resolve_glyph_utf16_offset(
                    page_text,
                    glyph,
                    &mut search_byte_start,
                    &mut fallback_utf16_offset,
                )
            })
            .collect()
    }

    #[test]
    fn maps_glyphs_to_offsets_in_pdfium_all_text_with_inserted_spaces() {
        let page_text = "fast, high-fidelity excitation";
        let offsets = resolve_sequence_offsets(page_text, &["f", "a", "s", "t", ",", "h"]);

        assert_eq!(offsets, vec![0, 1, 2, 3, 4, 6]);
    }

    #[test]
    fn keeps_offsets_aligned_after_superscript_citations() {
        let page_text = "ground state¹⁰. This creates high-fidelity excitation";
        let offsets = resolve_sequence_offsets(
            page_text,
            &[
                "g", "r", "o", "u", "n", "d", "s", "t", "a", "t", "e", "¹", "⁰", ".", "T",
                "h",
            ],
        );

        assert_eq!(offsets, vec![0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 16, 17]);
    }

    #[test]
    fn reports_utf16_offsets_for_non_bmp_text() {
        let page_text = "A😀B high";
        let offsets = resolve_sequence_offsets(page_text, &["A", "😀", "B", "h"]);

        assert_eq!(offsets, vec![0, 1, 3, 5]);
    }

    #[test]
    fn maps_ligature_glyphs_to_expanded_page_text_ranges() {
        let page_text = "high-fidelity excitation";
        let ranges = resolve_sequence_offset_ranges(page_text, &["h", "i", "g", "h", "-", "ﬁ", "d"]);

        assert_eq!(ranges, vec![(0, 1), (1, 2), (2, 3), (3, 4), (4, 5), (5, 7), (7, 8)]);
    }
}
