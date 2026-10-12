mod engine;
mod router;

use std::path::PathBuf;

use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};

use engine::{Engine, EngineCommand, EngineStatus, EventSink};
use router::EngineError;

struct TauriSink(AppHandle);

impl EventSink for TauriSink {
    fn event(&self, name: &str, data: Value) {
        let _ = self.0.emit("engine://event", json!({ "name": name, "data": data }));
    }
    fn status(&self, status: &EngineStatus) {
        let _ = self.0.emit("engine://status", status);
    }
}

/// Which engine to run:
/// 1. `TRANSCRIBER_ENGINE_CMD` — a full command line, for development;
/// 2. debug builds: `python -m transcriber_engine` from `engine/.venv` of this repo;
/// 3. the bundled `engine/transcriber-engine(.exe)` next to the app's resources.
fn engine_command(app: &AppHandle) -> EngineCommand {
    if let Ok(cmdline) = std::env::var("TRANSCRIBER_ENGINE_CMD") {
        let mut parts = cmdline.split_whitespace().map(Into::into);
        if let Some(program) = parts.next() {
            return EngineCommand { program: PathBuf::from(program), args: parts.collect() };
        }
    }
    if cfg!(debug_assertions) {
        let venv = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../engine/.venv");
        let python = if cfg!(windows) { venv.join("Scripts/python.exe") } else { venv.join("bin/python") };
        if python.exists() {
            return EngineCommand { program: python, args: vec!["-m".into(), "transcriber_engine".into()] };
        }
    }
    let exe = if cfg!(windows) { "transcriber-engine.exe" } else { "transcriber-engine" };
    let dir = app.path().resource_dir().unwrap_or_default().join("engine");
    EngineCommand { program: dir.join(exe), args: vec![] }
}

#[tauri::command]
async fn engine_request(
    engine: State<'_, Engine>,
    method: String,
    params: Option<Value>,
) -> Result<Value, EngineError> {
    engine.request(&method, params.unwrap_or_else(|| json!({}))).await
}

#[tauri::command]
fn engine_status(engine: State<'_, Engine>) -> EngineStatus {
    engine.status()
}

#[tauri::command]
fn engine_restart(engine: State<'_, Engine>) {
    engine.start();
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let engine = Engine::new(engine_command(&handle), TauriSink(handle));
            engine.start();
            app.manage(engine);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![engine_request, engine_status, engine_restart])
        .build(tauri::generate_context!())
        .expect("error while building the app")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                app.state::<Engine>().shutdown();
            }
        });
}
