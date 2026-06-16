use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};

use pdfium_auto::bind_bundled;
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};

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

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOcrWord {
    pub text: String,
    pub left: f32,
    pub top: f32,
    pub width: f32,
    pub height: f32,
    pub confidence: f32,
    pub line_index: Option<usize>,
    pub word_index: Option<usize>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOcrPageTextLayout {
    pub source: String,
    pub page_number: usize,
    pub width: f32,
    pub height: f32,
    pub text: String,
    pub words: Vec<PdfOcrWord>,
    pub confidence: f32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfOcrPageOptions {
    pub dpi: Option<u16>,
    pub language: Option<String>,
    pub psm: Option<u8>,
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

fn configure_hidden_command(command: &mut Command) {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000);
    }
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

fn byte_offset_for_utf16_offset(text: &str, target_utf16_offset: usize) -> usize {
    if target_utf16_offset == 0 {
        return 0;
    }

    let mut utf16_offset = 0usize;
    for (byte_index, character) in text.char_indices() {
        if utf16_offset >= target_utf16_offset {
            return byte_index;
        }
        utf16_offset += character.len_utf16();
        if utf16_offset >= target_utf16_offset {
            return byte_index + character.len_utf8();
        }
    }

    text.len()
}

fn clamp_to_char_boundary(text: &str, mut byte_index: usize) -> usize {
    byte_index = byte_index.min(text.len());
    while byte_index > 0 && !text.is_char_boundary(byte_index) {
        byte_index -= 1;
    }
    byte_index
}

fn find_closest_glyph_match(
    page_text: &str,
    search_text: &str,
    search_byte_start: usize,
    expected_byte_start: usize,
) -> Option<usize> {
    if search_text.is_empty() {
        return None;
    }

    const LOCAL_SEARCH_WINDOW_BYTES: usize = 512;
    let window_start = clamp_to_char_boundary(page_text, search_byte_start);
    let raw_window_end = page_text
        .len()
        .min(expected_byte_start.saturating_add(LOCAL_SEARCH_WINDOW_BYTES))
        .max(window_start.saturating_add(search_text.len()));
    let window_end = clamp_to_char_boundary(page_text, raw_window_end);
    if window_end <= window_start {
        return None;
    }

    let mut best_match: Option<(usize, usize)> = None;
    let mut relative_start = 0usize;
    let window = &page_text[window_start..window_end];
    while let Some(relative_index) = window[relative_start..].find(search_text) {
        let byte_index = window_start + relative_start + relative_index;
        let distance = byte_index.abs_diff(expected_byte_start);
        if best_match
            .map(|(best_distance, best_index)| {
                distance < best_distance || (distance == best_distance && byte_index < best_index)
            })
            .unwrap_or(true)
        {
            best_match = Some((distance, byte_index));
        }
        relative_start += relative_index + search_text.len().max(1);
        if relative_start >= window.len() {
            break;
        }
    }

    best_match.map(|(_distance, byte_index)| byte_index)
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
    let expected_byte_start = byte_offset_for_utf16_offset(page_text, *fallback_utf16_offset);
    let search_variants = glyph_search_variants(glyph_text);
    for search_text in search_variants {
        if let Some(byte_index) = find_closest_glyph_match(
            page_text,
            &search_text,
            safe_search_start,
            expected_byte_start,
        ) {
            let byte_end_index = byte_index + search_text.len();
            let utf16_index = utf16_offset_for_byte(page_text, byte_index);
            let utf16_end_index = utf16_offset_for_byte(page_text, byte_end_index);
            *search_byte_start = byte_end_index;
            *fallback_utf16_offset = utf16_end_index;
            return (utf16_index, utf16_end_index);
        }
    }

    let utf16_index = *fallback_utf16_offset;
    *fallback_utf16_offset += utf16_len(&expand_pdf_ligatures(glyph_text));
    *search_byte_start = byte_offset_for_utf16_offset(page_text, *fallback_utf16_offset);
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

fn parse_optional_usize(value: Option<&str>) -> Option<usize> {
    value?.trim().parse::<usize>().ok()
}

fn parse_tesseract_confidence(value: Option<&str>) -> Option<f32> {
    let raw = value?.trim().parse::<f32>().ok()?;
    if raw < 0.0 {
        return None;
    }
    Some((raw / 100.0).clamp(0.0, 1.0))
}

fn parse_tesseract_tsv(
    tsv: &str,
    page_number: usize,
    page_width: f32,
    page_height: f32,
    render_scale: f32,
) -> PdfOcrPageTextLayout {
    let mut words = Vec::new();
    let mut text_parts = Vec::new();
    let mut confidence_sum = 0.0f32;
    let mut confidence_count = 0usize;

    for line in tsv.lines().skip(1) {
        let columns = line.split('\t').collect::<Vec<_>>();
        if columns.len() < 12 {
            continue;
        }

        let text = columns[11].trim();
        if text.is_empty() {
            continue;
        }

        let Some(confidence) = parse_tesseract_confidence(columns.get(10).copied()) else {
            continue;
        };
        let left = columns.get(6).and_then(|value| value.parse::<f32>().ok()).unwrap_or(0.0) / render_scale;
        let top = columns.get(7).and_then(|value| value.parse::<f32>().ok()).unwrap_or(0.0) / render_scale;
        let width = columns.get(8).and_then(|value| value.parse::<f32>().ok()).unwrap_or(0.0) / render_scale;
        let height = columns.get(9).and_then(|value| value.parse::<f32>().ok()).unwrap_or(0.0) / render_scale;
        if width <= 0.0 || height <= 0.0 {
            continue;
        }

        confidence_sum += confidence;
        confidence_count += 1;
        text_parts.push(text.to_string());
        words.push(PdfOcrWord {
            text: text.to_string(),
            left,
            top,
            width,
            height,
            confidence,
            line_index: parse_optional_usize(columns.get(4).copied()),
            word_index: parse_optional_usize(columns.get(5).copied()),
        });
    }

    PdfOcrPageTextLayout {
        source: "ocr".to_string(),
        page_number,
        width: page_width,
        height: page_height,
        text: text_parts.join(" "),
        words,
        confidence: if confidence_count > 0 {
            confidence_sum / confidence_count as f32
        } else {
            0.0
        },
    }
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

#[tauri::command]
pub async fn desktop_ocr_pdf_page_text_layout(
    path: String,
    page_number: usize,
    options: Option<PdfOcrPageOptions>,
) -> Result<PdfOcrPageTextLayout, String> {
    if page_number < 1 {
        return Err("pageNumber must be >= 1".to_string());
    }

    let normalized_path = normalize_pdf_path(&path)?;
    tokio::task::spawn_blocking(move || {
        let options = options.unwrap_or(PdfOcrPageOptions {
            dpi: None,
            language: None,
            psm: None,
        });
        let dpi = options.dpi.unwrap_or(220).clamp(120, 400);
        let language = options.language.unwrap_or_else(|| "eng".to_string());
        let psm = options.psm.unwrap_or(6).clamp(3, 13);
        let tesseract = if cfg!(target_os = "windows") { "tesseract.exe" } else { "tesseract" };

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
        let render_scale = dpi as f32 / 72.0;
        let target_width = (page_width * render_scale).round().max(1.0) as i32;
        let render_config = PdfRenderConfig::new()
            .set_target_width(target_width)
            .render_form_data(true);

        let temp_path = std::env::temp_dir().join(format!(
            "lattice-ocr-{}-{}.png",
            std::process::id(),
            uuid_like_suffix()
        ));
        page.render_with_config(&render_config)
            .map_err(|error| error.to_string())?
            .as_image()
            .save(&temp_path)
            .map_err(|error| error.to_string())?;

        let mut command = Command::new(tesseract);
        configure_hidden_command(&mut command);
        let output = command
            .arg(&temp_path)
            .arg("stdout")
            .arg("-l")
            .arg(language)
            .arg("--psm")
            .arg(psm.to_string())
            .arg("tsv")
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .output()
            .map_err(|error| format!("Failed to run tesseract. Install Tesseract OCR and ensure it is on PATH. {error}"));
        let _ = std::fs::remove_file(&temp_path);
        let output = output?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            return Err(if stderr.is_empty() {
                "Tesseract OCR failed without stderr output".to_string()
            } else {
                stderr
            });
        }

        let tsv = String::from_utf8_lossy(&output.stdout).to_string();
        Ok(parse_tesseract_tsv(&tsv, page_number, page_width, page_height, render_scale))
    })
    .await
    .map_err(|error| error.to_string())?
}

fn uuid_like_suffix() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
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

    #[test]
    fn keeps_offsets_near_expected_position_after_unmatched_math_glyphs() {
        let page_text = "field stability required to hold Stark below field stability";
        let offsets = resolve_sequence_offsets(
            page_text,
            &[
                "f", "i", "e", "l", "d", "?", "?", "S", "t", "a", "r", "k", "f", "i", "e", "l", "d",
            ],
        );

        assert_eq!(offsets[7], page_text.find("Stark").unwrap());
        assert_eq!(offsets[12], page_text.rfind("field").unwrap());
    }

    #[test]
    fn parses_tesseract_tsv_words_to_page_layout() {
        let tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t40\t60\t100\t20\t95\tScanned\n5\t1\t1\t1\t1\t2\t150\t60\t50\t20\t89\ttext\n";
        let layout = parse_tesseract_tsv(tsv, 1, 600.0, 800.0, 2.0);

        assert_eq!(layout.text, "Scanned text");
        assert_eq!(layout.words.len(), 2);
        assert_eq!(layout.words[0].left, 20.0);
        assert_eq!(layout.words[0].confidence, 0.95);
        assert!((layout.confidence - 0.92).abs() < 0.001);
    }
}
