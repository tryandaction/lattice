use std::collections::HashMap;
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::sync::{Mutex, OnceLock};

use pdfium_auto::bind_bundled;
use pdfium_render::prelude::*;
use serde::{Deserialize, Serialize};

#[cfg(target_os = "windows")]
use windows::{
    core::HSTRING,
    Graphics::Imaging::BitmapDecoder,
    Media::Ocr::OcrEngine,
    Storage::{FileAccessMode, StorageFile},
};

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

static PDF_PAGE_LAYOUT_CACHE: OnceLock<Mutex<HashMap<String, PdfNativePageTextLayout>>> =
    OnceLock::new();

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

fn append_pdfium_glyph(
    page_text: &mut String,
    next_utf16_offset: &mut usize,
    glyph_text: &str,
) -> (usize, usize) {
    let start = *next_utf16_offset;
    page_text.push_str(glyph_text);
    *next_utf16_offset += utf16_len(glyph_text);
    (start, *next_utf16_offset)
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
    let mut previous_line_key: Option<(usize, usize, usize)> = None;
    let mut global_line_index = 0usize;

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
        let left = columns
            .get(6)
            .and_then(|value| value.parse::<f32>().ok())
            .unwrap_or(0.0)
            / render_scale;
        let top = columns
            .get(7)
            .and_then(|value| value.parse::<f32>().ok())
            .unwrap_or(0.0)
            / render_scale;
        let width = columns
            .get(8)
            .and_then(|value| value.parse::<f32>().ok())
            .unwrap_or(0.0)
            / render_scale;
        let height = columns
            .get(9)
            .and_then(|value| value.parse::<f32>().ok())
            .unwrap_or(0.0)
            / render_scale;
        if width <= 0.0 || height <= 0.0 {
            continue;
        }

        let line_key = (
            parse_optional_usize(columns.get(2).copied()).unwrap_or(0),
            parse_optional_usize(columns.get(3).copied()).unwrap_or(0),
            parse_optional_usize(columns.get(4).copied()).unwrap_or(0),
        );
        if previous_line_key.is_some() && previous_line_key != Some(line_key) {
            global_line_index += 1;
        }
        previous_line_key = Some(line_key);

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
            line_index: Some(global_line_index),
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

#[cfg(target_os = "windows")]
fn windows_ocr_max_image_dimension() -> Option<u32> {
    OcrEngine::MaxImageDimension().ok()
}

#[cfg(target_os = "windows")]
fn try_windows_ocr_page(
    image_path: &std::path::Path,
    page_number: usize,
    page_width: f32,
    page_height: f32,
    render_scale: f32,
) -> Result<Option<PdfOcrPageTextLayout>, String> {
    let engine = match OcrEngine::TryCreateFromUserProfileLanguages() {
        Ok(engine) => engine,
        Err(_) => return Ok(None),
    };
    let path = HSTRING::from(image_path.to_string_lossy().as_ref());
    let file = StorageFile::GetFileFromPathAsync(&path)
        .and_then(|operation| operation.join())
        .map_err(|error| format!("Windows OCR could not open the rendered PDF page: {error}"))?;
    let stream = file
        .OpenAsync(FileAccessMode::Read)
        .and_then(|operation| operation.join())
        .map_err(|error| format!("Windows OCR could not read the rendered PDF page: {error}"))?;
    let decoder = BitmapDecoder::CreateAsync(&stream)
        .and_then(|operation| operation.join())
        .map_err(|error| format!("Windows OCR could not decode the rendered PDF page: {error}"))?;
    let bitmap = decoder
        .GetSoftwareBitmapAsync()
        .and_then(|operation| operation.join())
        .map_err(|error| format!("Windows OCR could not create a software bitmap: {error}"))?;
    let result = engine
        .RecognizeAsync(&bitmap)
        .and_then(|operation| operation.join())
        .map_err(|error| format!("Windows OCR recognition failed: {error}"))?;
    let lines = result
        .Lines()
        .map_err(|error| format!("Windows OCR did not return readable lines: {error}"))?;

    let mut words = Vec::new();
    let mut text_parts = Vec::new();
    let line_count = lines
        .Size()
        .map_err(|error| format!("Windows OCR line collection failed: {error}"))?;
    for line_index in 0..line_count {
        let line = lines
            .GetAt(line_index)
            .map_err(|error| format!("Windows OCR line access failed: {error}"))?;
        let line_words = line
            .Words()
            .map_err(|error| format!("Windows OCR word collection failed: {error}"))?;
        let word_count = line_words
            .Size()
            .map_err(|error| format!("Windows OCR word count failed: {error}"))?;
        for word_index in 0..word_count {
            let word = line_words
                .GetAt(word_index)
                .map_err(|error| format!("Windows OCR word access failed: {error}"))?;
            let text = word
                .Text()
                .map_err(|error| format!("Windows OCR word text failed: {error}"))?
                .to_string_lossy()
                .trim()
                .to_string();
            if text.is_empty() {
                continue;
            }
            let rect = word
                .BoundingRect()
                .map_err(|error| format!("Windows OCR word geometry failed: {error}"))?;
            if rect.Width <= 0.0 || rect.Height <= 0.0 {
                continue;
            }

            text_parts.push(text.clone());
            words.push(PdfOcrWord {
                text,
                left: rect.X / render_scale,
                top: rect.Y / render_scale,
                width: rect.Width / render_scale,
                height: rect.Height / render_scale,
                confidence: 0.9,
                line_index: Some(line_index as usize),
                word_index: Some(word_index as usize),
            });
        }
    }

    Ok(Some(PdfOcrPageTextLayout {
        source: "ocr".to_string(),
        page_number,
        width: page_width,
        height: page_height,
        text: text_parts.join(" "),
        confidence: if words.is_empty() { 0.0 } else { 0.9 },
        words,
    }))
}

fn extract_pdf_page_text_layout(
    path: &str,
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

    let layout = build_pdf_native_page_text_layout(&page, page_number)?;

    pdf_page_layout_cache()
        .lock()
        .map_err(|error| error.to_string())?
        .insert(cache_key, layout.clone());

    Ok(layout)
}

fn build_pdf_native_page_text_layout(
    page: &PdfPage<'_>,
    page_number: usize,
) -> Result<PdfNativePageTextLayout, String> {
    let page_width = pdf_points_value(page.width());
    let page_height = pdf_points_value(page.height());
    let text_page = page.text().map_err(|error| error.to_string())?;
    // Pdfium's bounded `all()` text and indexed character stream are not guaranteed to
    // have identical lengths or ordering. Build text and geometry offsets from one stream.
    let mut text = String::new();
    let mut text_utf16_offset = 0usize;
    let chars = text_page
        .chars()
        .iter()
        .filter_map(|character| {
            let glyph_text = character.unicode_string()?;
            if glyph_text.is_empty() {
                return None;
            }
            let (char_index, char_end_index) =
                append_pdfium_glyph(&mut text, &mut text_utf16_offset, &glyph_text);

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

    Ok(PdfNativePageTextLayout {
        source: "pdfium".to_string(),
        page_number,
        width: page_width,
        height: page_height,
        text,
        chars,
    })
}

#[tauri::command]
pub async fn desktop_extract_pdf_page_text_layout(
    path: String,
    page_number: usize,
) -> Result<PdfNativePageTextLayout, String> {
    extract_pdf_page_text_layout(&path, page_number)
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
        let mut render_scale = dpi as f32 / 72.0;
        #[cfg(target_os = "windows")]
        if let Some(max_dimension) = windows_ocr_max_image_dimension() {
            let longest_side = page_width.max(page_height) * render_scale;
            if longest_side > max_dimension as f32 {
                render_scale *= max_dimension as f32 / longest_side;
            }
        }
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

        #[cfg(target_os = "windows")]
        match try_windows_ocr_page(
            &temp_path,
            page_number,
            page_width,
            page_height,
            render_scale,
        ) {
            Ok(Some(layout)) => {
                let _ = std::fs::remove_file(&temp_path);
                return Ok(layout);
            }
            Ok(None) => {}
            Err(error) => eprintln!("[PDF OCR] Windows OCR fallback failed: {error}"),
        }

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

    fn collect_pdf_paths(root: &std::path::Path, paths: &mut Vec<PathBuf>) {
        let entries = std::fs::read_dir(root).unwrap_or_else(|error| {
            panic!(
                "could not read corpus directory {}: {error}",
                root.display()
            )
        });
        for entry in entries {
            let entry = entry.expect("corpus directory entry should be readable");
            let path = entry.path();
            if path.is_dir() {
                collect_pdf_paths(&path, paths);
            } else if path
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| extension.eq_ignore_ascii_case("pdf"))
            {
                paths.push(path);
            }
        }
    }

    fn assert_layout_coordinate_text_invariants(
        path: &std::path::Path,
        page_number: usize,
        layout: &PdfNativePageTextLayout,
    ) {
        let text_utf16 = layout.text.encode_utf16().collect::<Vec<_>>();
        assert!(
            !layout.text.trim().is_empty(),
            "PDFium returned empty text for {} page {page_number}",
            path.display()
        );
        assert!(
            !layout.chars.is_empty(),
            "PDFium returned no positioned characters for {} page {page_number}",
            path.display()
        );
        for character in &layout.chars {
            assert!(character.char_index < character.char_end_index);
            assert!(character.char_end_index <= text_utf16.len());
            assert_eq!(
                &text_utf16[character.char_index..character.char_end_index],
                character.text.encode_utf16().collect::<Vec<_>>().as_slice(),
                "coordinate/text drift in {} page {page_number} at UTF-16 offset {} for {:?}",
                path.display(),
                character.char_index,
                character.text
            );
            assert!(
                [
                    character.x1,
                    character.y1,
                    character.x2,
                    character.y2,
                    character.font_size
                ]
                .into_iter()
                .all(f32::is_finite),
                "non-finite character geometry in {} page {page_number}",
                path.display()
            );
        }
    }

    #[test]
    fn builds_text_offsets_from_the_same_pdfium_character_stream() {
        let mut text = String::new();
        let mut next_utf16_offset = 0usize;
        let ranges = ["b", "o", "d", "y", " ", "ﬁ", "😀", "3"]
            .iter()
            .map(|glyph| append_pdfium_glyph(&mut text, &mut next_utf16_offset, glyph))
            .collect::<Vec<_>>();

        assert_eq!(text, "body ﬁ😀3");
        assert_eq!(
            ranges,
            vec![
                (0, 1),
                (1, 2),
                (2, 3),
                (3, 4),
                (4, 5),
                (5, 6),
                (6, 8),
                (8, 9),
            ]
        );
        assert_eq!(next_utf16_offset, text.encode_utf16().count());
    }

    #[test]
    #[ignore = "requires LATTICE_PDF_LAYOUT_FIXTURE"]
    fn extracts_real_pdf_layout_without_coordinate_text_drift() {
        let path = std::env::var("LATTICE_PDF_LAYOUT_FIXTURE")
            .expect("LATTICE_PDF_LAYOUT_FIXTURE must point to a real PDF");
        let page_number = std::env::var("LATTICE_PDF_LAYOUT_PAGE")
            .ok()
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(1);
        let target = std::env::var("LATTICE_PDF_LAYOUT_TARGET").unwrap_or_default();
        let layout = extract_pdf_page_text_layout(&path, page_number)
            .expect("real PDF page layout should be extractable");
        if !target.is_empty() {
            assert!(
                layout.text.contains(&target),
                "page text did not contain target {target:?}"
            );
        }
        assert_layout_coordinate_text_invariants(std::path::Path::new(&path), page_number, &layout);
    }

    #[test]
    #[ignore = "requires LATTICE_PDF_CORPUS_ROOT"]
    fn audits_pdfium_corpus_coordinate_text_invariants() {
        let root = PathBuf::from(
            std::env::var("LATTICE_PDF_CORPUS_ROOT")
                .expect("LATTICE_PDF_CORPUS_ROOT must point to a PDF corpus"),
        );
        let expected_failure = std::env::var("LATTICE_PDF_CORPUS_EXPECTED_FAILURE")
            .ok()
            .filter(|value| !value.trim().is_empty());
        let mut paths = Vec::new();
        collect_pdf_paths(&root, &mut paths);
        paths.sort();
        assert!(!paths.is_empty(), "PDF corpus should contain files");

        let pdfium = get_pdfium().expect("bundled PDFium should load");
        let mut files_loaded = 0usize;
        let mut pages_checked = 0usize;
        let mut characters_checked = 0usize;
        let mut observed_expected_failure = false;

        for path in &paths {
            let document = match pdfium.load_pdf_from_file(path, None) {
                Ok(document) => document,
                Err(error) => {
                    let path_text = path.to_string_lossy();
                    if expected_failure
                        .as_ref()
                        .is_some_and(|expected| path_text.ends_with(expected))
                    {
                        observed_expected_failure = true;
                        eprintln!("expected corpus load failure: {} ({error})", path.display());
                        continue;
                    }
                    panic!(
                        "unexpected PDFium load failure for {}: {error}",
                        path.display()
                    );
                }
            };
            files_loaded += 1;
            let pages = document.pages();
            assert!(!pages.is_empty(), "PDF has no pages: {}", path.display());
            for page_index in pages.as_range() {
                let page_number = page_index as usize + 1;
                let page = pages.get(page_index).unwrap_or_else(|error| {
                    panic!(
                        "could not load {} page {page_number}: {error}",
                        path.display()
                    )
                });
                let layout =
                    build_pdf_native_page_text_layout(&page, page_number).unwrap_or_else(|error| {
                        panic!(
                            "could not extract {} page {page_number}: {error}",
                            path.display()
                        )
                    });
                assert_layout_coordinate_text_invariants(path, page_number, &layout);
                pages_checked += 1;
                characters_checked += layout.chars.len();
            }
        }

        if expected_failure.is_some() {
            assert!(
                observed_expected_failure,
                "configured expected failure was not observed"
            );
        }
        eprintln!(
            "PDFIUM_CORPUS_SUMMARY files_discovered={} files_loaded={} pages_checked={} positioned_chars={}",
            paths.len(),
            files_loaded,
            pages_checked,
            characters_checked
        );
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

    #[test]
    fn assigns_stable_global_line_indexes_across_tesseract_blocks() {
        let tsv = "level\tpage_num\tblock_num\tpar_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n5\t1\t1\t1\t1\t1\t40\t60\t100\t20\t95\tFirst\n5\t1\t2\t1\t1\t1\t40\t160\t100\t20\t91\tSecond\n";
        let layout = parse_tesseract_tsv(tsv, 1, 600.0, 800.0, 2.0);

        assert_eq!(layout.words[0].line_index, Some(0));
        assert_eq!(layout.words[1].line_index, Some(1));
    }
}
