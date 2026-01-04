// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use tauri::Manager;
use tauri_plugin_store::StoreExt;
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
struct AppSettings {
    default_folder: Option<String>,
    last_opened_folder: Option<String>,
}

// 获取默认文件夹
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

// 设置默认文件夹
#[tauri::command]
fn set_default_folder(app: tauri::AppHandle, folder: String) -> Result<(), String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    store.set("default_folder", serde_json::json!(folder));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

// 获取上次打开的文件夹
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

// 保存上次打开的文件夹
#[tauri::command]
fn set_last_opened_folder(app: tauri::AppHandle, folder: String) -> Result<(), String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    store.set("last_opened_folder", serde_json::json!(folder));
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

// 清除默认文件夹
#[tauri::command]
fn clear_default_folder(app: tauri::AppHandle) -> Result<(), String> {
    let store = app.store("settings.json").map_err(|e| e.to_string())?;
    store.delete("default_folder").map_err(|e| e.to_string())?;
    store.save().map_err(|e| e.to_string())?;
    Ok(())
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            get_default_folder,
            set_default_folder,
            get_last_opened_folder,
            set_last_opened_folder,
            clear_default_folder,
        ])
        .setup(|app| {
            // 启动时可以读取默认文件夹
            let app_handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                // 这里可以添加启动时的逻辑
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
