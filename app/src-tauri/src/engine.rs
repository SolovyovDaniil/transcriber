//! Runs the Python engine as a child process and talks to it over stdin/stdout.
//! Restarts it when it crashes (at most MAX_RESTARTS within RESTART_WINDOW).

use std::collections::VecDeque;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;
use serde_json::Value;

use crate::router::{EngineError, Incoming, Router};

const MAX_RESTARTS: usize = 3;
const RESTART_WINDOW: Duration = Duration::from_secs(60);
const RESTART_DELAY: Duration = Duration::from_millis(500);
const SHUTDOWN_GRACE: Duration = Duration::from_secs(3);
const STDERR_TAIL_LINES: usize = 20;

#[derive(Debug, Clone)]
pub struct EngineCommand {
    pub program: PathBuf,
    pub args: Vec<OsString>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "state", rename_all = "snake_case")]
pub enum EngineStatus {
    Starting,
    Running,
    Restarting { reason: String },
    Failed { reason: String },
    Stopped,
}

pub trait EventSink: Send + Sync + 'static {
    fn event(&self, name: &str, data: Value);
    fn status(&self, status: &EngineStatus);
}

struct Inner {
    router: Router,
    stdin: Option<ChildStdin>,
    child: Option<Child>,
    generation: u64,
    status: EngineStatus,
    restarts: VecDeque<Instant>,
    stopping: bool,
    stderr_tail: VecDeque<String>,
}

struct Shared {
    command: EngineCommand,
    sink: Box<dyn EventSink>,
    inner: Mutex<Inner>,
}

#[derive(Clone)]
pub struct Engine(Arc<Shared>);

impl Engine {
    pub fn new(command: EngineCommand, sink: impl EventSink) -> Self {
        Engine(Arc::new(Shared {
            command,
            sink: Box::new(sink),
            inner: Mutex::new(Inner {
                router: Router::default(),
                stdin: None,
                child: None,
                generation: 0,
                status: EngineStatus::Starting,
                restarts: VecDeque::new(),
                stopping: false,
                stderr_tail: VecDeque::new(),
            }),
        }))
    }

    pub fn status(&self) -> EngineStatus {
        self.0.inner.lock().unwrap().status.clone()
    }

    fn set_status(&self, inner: &mut Inner, status: EngineStatus) {
        inner.status = status.clone();
        self.0.sink.status(&status);
    }

    pub fn start(&self) {
        let mut inner = self.0.inner.lock().unwrap();
        self.set_status(&mut inner, EngineStatus::Starting);
        if let Err(e) = self.spawn(&mut inner) {
            let reason = format!("Не удалось запустить движок ({}): {e}", self.0.command.program.display());
            self.set_status(&mut inner, EngineStatus::Failed { reason });
        }
    }

    fn spawn(&self, inner: &mut Inner) -> std::io::Result<()> {
        let mut cmd = Command::new(&self.0.command.program);
        cmd.args(&self.0.command.args)
            .env("PYTHONIOENCODING", "utf-8")
            .env("PYTHONUNBUFFERED", "1")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            const CREATE_NO_WINDOW: u32 = 0x0800_0000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }
        let mut child = cmd.spawn()?;
        let stdout = child.stdout.take().expect("piped stdout");
        let stderr = child.stderr.take().expect("piped stderr");
        inner.stdin = child.stdin.take();
        inner.child = Some(child);
        inner.generation += 1;
        inner.stderr_tail.clear();
        let generation = inner.generation;
        self.set_status(inner, EngineStatus::Running);

        let engine = self.clone();
        thread::Builder::new()
            .name("engine-stdout".into())
            .spawn(move || engine.read_stdout(stdout, generation))?;
        let engine = self.clone();
        thread::Builder::new()
            .name("engine-stderr".into())
            .spawn(move || engine.read_stderr(stderr, generation))?;
        Ok(())
    }

    fn read_stdout(&self, stdout: impl std::io::Read, generation: u64) {
        for line in BufReader::new(stdout).lines() {
            let Ok(line) = line else { break };
            if line.trim().is_empty() {
                continue;
            }
            match crate::router::parse_line(&line) {
                Incoming::Response { id, reply } => {
                    self.0.inner.lock().unwrap().router.resolve(id, reply);
                }
                Incoming::Event { name, data } => self.0.sink.event(&name, data),
                Incoming::Invalid(why) => eprintln!("[engine] ignored output: {why}"),
            }
        }
        self.on_exit(generation);
    }

    fn read_stderr(&self, stderr: impl std::io::Read, generation: u64) {
        for line in BufReader::new(stderr).lines() {
            let Ok(line) = line else { break };
            eprintln!("[engine] {line}");
            let mut inner = self.0.inner.lock().unwrap();
            if inner.generation == generation {
                inner.stderr_tail.push_back(line);
                if inner.stderr_tail.len() > STDERR_TAIL_LINES {
                    inner.stderr_tail.pop_front();
                }
            }
        }
    }

    fn on_exit(&self, generation: u64) {
        let mut inner = self.0.inner.lock().unwrap();
        if inner.generation != generation {
            return;
        }
        inner.stdin = None;
        let code = inner.child.take().and_then(|mut c| c.wait().ok()).and_then(|s| s.code());
        inner.router.fail_all(EngineError::new("engine_exited", "Движок завершил работу"));
        if inner.stopping {
            self.set_status(&mut inner, EngineStatus::Stopped);
            return;
        }
        // The stderr reader may still be draining; give it a moment for the traceback.
        drop(inner);
        thread::sleep(Duration::from_millis(100));
        let mut inner = self.0.inner.lock().unwrap();
        let tail: Vec<_> = inner.stderr_tail.iter().cloned().collect();
        let reason = format!(
            "Движок завершился (код {}). {}",
            code.map_or("—".to_string(), |c| c.to_string()),
            tail.join("\n")
        );

        let now = Instant::now();
        while inner.restarts.front().is_some_and(|t| now.duration_since(*t) > RESTART_WINDOW) {
            inner.restarts.pop_front();
        }
        if inner.restarts.len() >= MAX_RESTARTS {
            self.set_status(&mut inner, EngineStatus::Failed { reason });
            return;
        }
        inner.restarts.push_back(now);
        self.set_status(&mut inner, EngineStatus::Restarting { reason });
        drop(inner);

        thread::sleep(RESTART_DELAY);
        let mut inner = self.0.inner.lock().unwrap();
        if inner.stopping {
            return;
        }
        if let Err(e) = self.spawn(&mut inner) {
            self.set_status(&mut inner, EngineStatus::Failed { reason: format!("Перезапуск не удался: {e}") });
        }
    }

    pub async fn request(&self, method: &str, params: Value) -> Result<Value, EngineError> {
        let rx = {
            let mut inner = self.0.inner.lock().unwrap();
            let (id, line, rx) = inner.router.begin(method, params);
            let written = match inner.stdin.as_mut() {
                Some(stdin) => stdin.write_all(line.as_bytes()).and_then(|_| stdin.flush()),
                None => Err(std::io::Error::other("not running")),
            };
            if let Err(e) = written {
                inner.router.cancel(id, EngineError::new("engine_unavailable", format!("Движок недоступен: {e}")));
            }
            rx
        };
        rx.await.unwrap_or_else(|_| Err(EngineError::new("engine_exited", "Движок завершил работу")))
    }

    /// Asks the engine to exit, then kills it if it does not within SHUTDOWN_GRACE.
    pub fn shutdown(&self) {
        let mut inner = self.0.inner.lock().unwrap();
        inner.stopping = true;
        if let Some(stdin) = inner.stdin.as_mut() {
            let _ = stdin.write_all(b"{\"id\": 0, \"method\": \"shutdown\"}\n");
            let _ = stdin.flush();
        }
        inner.stdin = None; // closing stdin also ends the engine's read loop
        let Some(mut child) = inner.child.take() else { return };
        drop(inner);
        let deadline = Instant::now() + SHUTDOWN_GRACE;
        while Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            thread::sleep(Duration::from_millis(50));
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::mpsc;

    /// Collects sink calls so tests can wait for them.
    struct Probe {
        tx: Mutex<mpsc::Sender<(String, Value)>>,
    }

    impl EventSink for Probe {
        fn event(&self, name: &str, data: Value) {
            let _ = self.tx.lock().unwrap().send((name.to_string(), data));
        }
        fn status(&self, status: &EngineStatus) {
            let _ = self.tx.lock().unwrap().send(("status".into(), serde_json::to_value(status).unwrap()));
        }
    }

    fn python() -> Option<PathBuf> {
        ["python3", "python"].iter().map(PathBuf::from).find(|p| {
            Command::new(p).arg("--version").output().is_ok_and(|o| o.status.success())
        })
    }

    /// Minimal stand-in for the engine: answers `ping`, emits an event, crashes on `crash`.
    const FAKE_ENGINE: &str = r#"
import json, sys
for line in sys.stdin:
    req = json.loads(line)
    if req["method"] == "crash":
        print("boom", file=sys.stderr, flush=True)
        sys.exit(3)
    if req["method"] == "shutdown":
        print(json.dumps({"id": req["id"], "result": {"ok": True}}), flush=True)
        break
    print(json.dumps({"event": "job.status", "data": {"status": "queued"}}), flush=True)
    print(json.dumps({"id": req["id"], "result": {"pong": req["params"]}}), flush=True)
"#;

    fn start_fake() -> Option<(Engine, mpsc::Receiver<(String, Value)>)> {
        let program = python()?;
        let (tx, rx) = mpsc::channel();
        let engine = Engine::new(
            EngineCommand { program, args: vec!["-c".into(), FAKE_ENGINE.into()] },
            Probe { tx: Mutex::new(tx) },
        );
        engine.start();
        Some((engine, rx))
    }

    fn wait_for(rx: &mpsc::Receiver<(String, Value)>, pred: impl Fn(&str, &Value) -> bool) -> Value {
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            let left = deadline.saturating_duration_since(Instant::now());
            let (name, data) = rx.recv_timeout(left).expect("timed out waiting for engine message");
            if pred(&name, &data) {
                return data;
            }
        }
    }

    #[test]
    fn request_response_and_events() {
        let Some((engine, rx)) = start_fake() else { return };
        let reply = tauri::async_runtime::block_on(engine.request("ping", json!({"n": 1})));
        assert_eq!(reply, Ok(json!({"pong": {"n": 1}})));
        let data = wait_for(&rx, |name, _| name == "job.status");
        assert_eq!(data, json!({"status": "queued"}));
        engine.shutdown();
        wait_for(&rx, |name, data| name == "status" && data["state"] == "stopped");
    }

    #[test]
    fn crash_fails_pending_request_and_restarts() {
        let Some((engine, rx)) = start_fake() else { return };
        let reply = tauri::async_runtime::block_on(engine.request("crash", json!({})));
        assert_eq!(reply.unwrap_err().code, "engine_exited");
        let restarting = wait_for(&rx, |name, data| name == "status" && data["state"] == "restarting");
        assert!(restarting["reason"].as_str().unwrap().contains("boom"));
        wait_for(&rx, |name, data| name == "status" && data["state"] == "running");

        let reply = tauri::async_runtime::block_on(engine.request("ping", json!(2)));
        assert_eq!(reply, Ok(json!({"pong": 2})));
        engine.shutdown();
    }

    #[test]
    fn gives_up_after_repeated_crashes() {
        let Some((engine, rx)) = start_fake() else { return };
        for _ in 0..=MAX_RESTARTS {
            wait_for(&rx, |name, data| name == "status" && data["state"] == "running");
            let _ = tauri::async_runtime::block_on(engine.request("crash", json!({})));
        }
        wait_for(&rx, |name, data| name == "status" && data["state"] == "failed");
        let reply = tauri::async_runtime::block_on(engine.request("ping", json!({})));
        assert_eq!(reply.unwrap_err().code, "engine_unavailable");
    }

    #[test]
    fn missing_program_reports_failure() {
        let (tx, rx) = mpsc::channel();
        let engine = Engine::new(
            EngineCommand { program: "/nonexistent/transcriber-engine".into(), args: vec![] },
            Probe { tx: Mutex::new(tx) },
        );
        engine.start();
        wait_for(&rx, |name, data| name == "status" && data["state"] == "failed");
        assert!(matches!(engine.status(), EngineStatus::Failed { .. }));
    }
}
