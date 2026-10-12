//! Request/response bookkeeping for the engine's JSON Lines protocol (docs/TZ.md, 6.1).
//! Pure logic: no process or IO, so it is unit-tested directly.

use std::collections::HashMap;

use serde::Serialize;
use serde_json::{json, Value};
use tokio::sync::oneshot;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct EngineError {
    pub code: String,
    pub message: String,
}

impl EngineError {
    pub fn new(code: &str, message: impl Into<String>) -> Self {
        Self { code: code.to_string(), message: message.into() }
    }
}

pub type Reply = Result<Value, EngineError>;

#[derive(Debug, PartialEq)]
pub enum Incoming {
    Response { id: u64, reply: Reply },
    Event { name: String, data: Value },
    Invalid(String),
}

pub fn parse_line(line: &str) -> Incoming {
    let value: Value = match serde_json::from_str(line) {
        Ok(v) => v,
        Err(e) => return Incoming::Invalid(format!("not JSON: {e}")),
    };
    if let Some(name) = value.get("event").and_then(Value::as_str) {
        let data = value.get("data").cloned().unwrap_or(Value::Null);
        return Incoming::Event { name: name.to_string(), data };
    }
    let Some(id) = value.get("id").and_then(Value::as_u64) else {
        return Incoming::Invalid(format!("message without id or event: {line}"));
    };
    if let Some(err) = value.get("error") {
        let field = |k: &str| err.get(k).and_then(Value::as_str).unwrap_or("").to_string();
        return Incoming::Response {
            id,
            reply: Err(EngineError { code: field("code"), message: field("message") }),
        };
    }
    let result = value.get("result").cloned().unwrap_or(Value::Null);
    Incoming::Response { id, reply: Ok(result) }
}

/// Assigns request ids and hands each response to the caller waiting on it.
#[derive(Default)]
pub struct Router {
    next_id: u64,
    pending: HashMap<u64, oneshot::Sender<Reply>>,
}

impl Router {
    /// Registers a request; returns the line to write and the receiver for its reply.
    pub fn begin(&mut self, method: &str, params: Value) -> (u64, String, oneshot::Receiver<Reply>) {
        self.next_id += 1;
        let id = self.next_id;
        let (tx, rx) = oneshot::channel();
        self.pending.insert(id, tx);
        let line = json!({ "id": id, "method": method, "params": params }).to_string() + "\n";
        (id, line, rx)
    }

    /// Delivers a reply. Returns false for an id nobody waits for.
    pub fn resolve(&mut self, id: u64, reply: Reply) -> bool {
        match self.pending.remove(&id) {
            Some(tx) => {
                let _ = tx.send(reply); // the caller may have given up; that's fine
                true
            }
            None => false,
        }
    }

    pub fn cancel(&mut self, id: u64, error: EngineError) {
        self.resolve(id, Err(error));
    }

    /// Fails every waiting request, e.g. when the engine process exits.
    pub fn fail_all(&mut self, error: EngineError) {
        for (_, tx) in self.pending.drain() {
            let _ = tx.send(Err(error.clone()));
        }
    }

    #[cfg(test)]
    pub fn pending_count(&self) -> usize {
        self.pending.len()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_result_error_and_event() {
        assert_eq!(
            parse_line(r#"{"id": 3, "result": {"ok": true}}"#),
            Incoming::Response { id: 3, reply: Ok(json!({"ok": true})) }
        );
        assert_eq!(
            parse_line(r#"{"id": 4, "error": {"code": "not_found", "message": "Нет файла"}}"#),
            Incoming::Response { id: 4, reply: Err(EngineError::new("not_found", "Нет файла")) }
        );
        assert_eq!(
            parse_line(r#"{"event": "job.progress", "data": {"fraction": 0.5}}"#),
            Incoming::Event { name: "job.progress".into(), data: json!({"fraction": 0.5}) }
        );
    }

    #[test]
    fn rejects_garbage() {
        assert!(matches!(parse_line("Traceback (most recent call last):"), Incoming::Invalid(_)));
        assert!(matches!(parse_line(r#"{"id": null, "error": {}}"#), Incoming::Invalid(_)));
        assert!(matches!(parse_line("[1]"), Incoming::Invalid(_)));
    }

    #[test]
    fn routes_replies_to_their_requests() {
        let mut router = Router::default();
        let (id1, line1, mut rx1) = router.begin("system.info", json!({}));
        let (id2, _, mut rx2) = router.begin("models.list", json!({}));
        assert_ne!(id1, id2);
        assert_eq!(
            serde_json::from_str::<Value>(&line1).unwrap(),
            json!({"id": id1, "method": "system.info", "params": {}})
        );
        assert!(line1.ends_with('\n') && line1.matches('\n').count() == 1);

        assert!(router.resolve(id2, Ok(json!(2))));
        assert!(router.resolve(id1, Ok(json!(1))));
        assert!(!router.resolve(id1, Ok(json!(1))), "a reply is delivered once");
        assert_eq!(rx1.try_recv().unwrap(), Ok(json!(1)));
        assert_eq!(rx2.try_recv().unwrap(), Ok(json!(2)));
    }

    #[test]
    fn fail_all_errors_every_waiter() {
        let mut router = Router::default();
        let (_, _, mut rx1) = router.begin("a", json!({}));
        let (_, _, mut rx2) = router.begin("b", json!({}));
        router.fail_all(EngineError::new("engine_exited", "Движок завершился"));
        assert_eq!(router.pending_count(), 0);
        for rx in [&mut rx1, &mut rx2] {
            assert_eq!(rx.try_recv().unwrap().unwrap_err().code, "engine_exited");
        }
    }
}
