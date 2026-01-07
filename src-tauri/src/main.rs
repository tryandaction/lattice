//! Lattice Desktop Application
//!
//! This is the main entry point for the Lattice desktop application.
//! Built with Tauri 2.x for cross-platform support.
//!
//! # Features
//! - File system access via tauri-plugin-fs
//! - Native file dialogs via tauri-plugin-dialog
//! - Persistent settings via tauri-plugin-store

// Prevents additional console window on Windows in release builds
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_plugin_store::StoreExt;
use serde::{Deserialize, Serialize};

/// Application settings structure
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AppSettings {
    /// Default folder to open on startup
    pub default_folder: Option<String>,
    /// Last opened folder path
    pub last_opened_folder: Option<String>,
}

// ============================================================================
// Tauri Commands - These are callable from the frontend via invoke()
// ============================================================================

/// Get the default folder path from settings
#[tauri::command]
fn get_default_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    
    if let Some(value) = store.get("default_folder") {
        if let Some(folder) = value.as_str() {
            return Ok(Some(folder.to_string()));
        }
    }
    
    Ok(None)
}

/// Set the default folder path
#[tauri::command]
fn set_default_folder(app: tauri::AppHandle, folder: String) -> Result<(), String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    store.set("default_folder", serde_json::json!(folder));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// Get the last opened folder path
#[tauri::command]
fn get_last_opened_folder(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    
    if let Some(value) = store.get("last_opened_folder") {
        if let Some(folder) = value.as_str() {
            return Ok(Some(folder.to_string()));
        }
    }
    
    Ok(None)
}

/// Save the last opened folder path
#[tauri::command]
fn set_last_opened_folder(app: tauri::AppHandle, folder: String) -> Result<(), String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    store.set("last_opened_folder", serde_json::json!(folder));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

/// Clear the default folder setting
#[tauri::command]
fn clear_default_folder(app: tauri::AppHandle) -> Result<(), String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    store.delete("default_folder");
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

// ============================================================================
// Application Entry Point
// ============================================================================

fn main() {
    tauri::Builder::default()
        // Initialize plugins
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        // Register command handlers
        .invoke_handler(tauri::generate_handler![
            get_default_folder,
            set_default_folder,
            get_last_opened_folder,
            set_last_opened_folder,
            clear_default_folder,
        ])
        // Application setup
        .setup(|app| {
            // Ensure window starts maximized
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.maximize();
            }
            #[cfg(debug_assertions)]
            {
                // Open devtools in debug mode
                // This helps with debugging during development
            }
            Ok(())
        })
        // Run the application
        .run(tauri::generate_context!())
        .expect("Failed to run Lattice application");
}
