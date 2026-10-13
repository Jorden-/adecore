use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use serde::Serialize;
use serde_json::Value as Json;
use tokio::sync::{OwnedRwLockReadGuard, RwLock, mpsc, oneshot};

use crate::engine::{self, Canceller, Engine};
use crate::error::{DatabaseError, ErrorCode, Result};
use crate::mysql::MysqlCanceller;
use crate::protocol::*;
use crate::{discover, import};

pub type ResponseFuture = Pin<Box<dyn Future<Output = String> + Send>>;

const CANCEL_RETRIES: u32 = 20;
const CANCEL_RETRY_DELAY: Duration = Duration::from_millis(50);
const CLOSE_TIMEOUT: Duration = Duration::from_secs(3);

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

fn to_json<T: Serialize>(value: T) -> Result<Json> {
    serde_json::to_value(value).map_err(|e| DatabaseError::internal(format!("Could not serialize the result: {e}.")))
}

/// The id of the request a session is executing right now, if any.
type Slot = Arc<Mutex<Option<String>>>;

/// Held for reading while a MySQL kill is on its way, so the session starts nothing new that the kill could stop.
type Gate = Arc<RwLock<()>>;

struct RequestState {
    id: String,
    cancelled: Arc<AtomicBool>,
    /// Set under the lock of the slot, once the request will never run again.
    finished: AtomicBool,
    slot: Slot,
    gate: Gate,
    canceller: Arc<Canceller>,
}

struct Command {
    id: String,
    state: Arc<RequestState>,
    call: Call,
    reply: oneshot::Sender<Result<Json>>,
}

struct SessionHandle {
    queue: mpsc::UnboundedSender<Command>,
    canceller: Arc<Canceller>,
    slot: Slot,
    gate: Gate,
}

type Running = Arc<Mutex<HashMap<String, Arc<RequestState>>>>;

type Sessions = Arc<Mutex<HashMap<String, Arc<SessionHandle>>>>;

/// Routes requests to sessions. Requests on one session queue up in the order they were submitted.
pub struct Dispatcher {
    sessions: Sessions,
    running: Running,
    counter: AtomicU64,
}

impl Default for Dispatcher {
    fn default() -> Self {
        Self::new()
    }
}

impl Dispatcher {
    pub fn new() -> Self {
        Dispatcher {
            sessions: Sessions::default(),
            running: Arc::new(Mutex::new(HashMap::new())),
            counter: AtomicU64::new(0),
        }
    }

    /// Takes one line of input. Everything that fixes the order of requests happens here, before the
    /// future is polled; the future resolves to the line that answers.
    pub fn submit(self: &Arc<Self>, line: &str) -> ResponseFuture {
        let request = match Request::parse(line) {
            Ok(request) => request,
            Err(failure) => {
                let answer = response_line(&failure.id, Err(failure.error));

                return Box::pin(async move { answer });
            }
        };

        let Request { id, call } = request;

        match call {
            Call::Open(params) => {
                let dispatcher = self.clone();

                isolated(id, async move { dispatcher.open(params).await })
            }
            Call::Test(params) => isolated(id, async move { test(params).await }),
            Call::Sample(params) => isolated(id, async move { sample(params).await }),
            Call::Discover(params) => isolated(id, async move { discover(params).await }),
            Call::Cancel(params) => {
                let dispatcher = self.clone();

                isolated(id, async move { dispatcher.cancel(params).await })
            }
            call => self.enqueue(id, call),
        }
    }

    fn enqueue(&self, id: String, call: Call) -> ResponseFuture {
        let fail = |error: DatabaseError, id: String| -> ResponseFuture {
            let answer = response_line(&id, Err(error));

            Box::pin(async move { answer })
        };

        let session = call.session().unwrap_or_default().to_string();
        let is_close = matches!(call, Call::Close(_));

        let handle = {
            let mut sessions = locked(&self.sessions);

            if is_close {
                sessions.remove(&session)
            } else {
                sessions.get(&session).cloned()
            }
        };

        let Some(handle) = handle else {
            return fail(DatabaseError::unknown_session(&session), id);
        };

        let state = Arc::new(RequestState {
            id: id.clone(),
            cancelled: Arc::new(AtomicBool::new(false)),
            finished: AtomicBool::new(false),
            slot: handle.slot.clone(),
            gate: handle.gate.clone(),
            canceller: handle.canceller.clone(),
        });

        {
            let mut running = locked(&self.running);

            if running.contains_key(&id) {
                return fail(DatabaseError::invalid_request(format!("The request id \"{id}\" is already in use.")), id);
            }

            running.insert(id.clone(), state.clone());
        }

        let (reply, answer) = oneshot::channel();

        if handle
            .queue
            .send(Command {
                id: id.clone(),
                state,
                call,
                reply,
            })
            .is_err()
        {
            locked(&self.running).remove(&id);

            return fail(DatabaseError::unknown_session(&session), id);
        }

        Box::pin(async move {
            let outcome = answer.await.unwrap_or_else(|_| Err(DatabaseError::unknown_session(&session)));

            response_line(&id, outcome)
        })
    }

    async fn open(self: Arc<Self>, params: OpenParams) -> Result<Json> {
        let (engine, server, canceller) = engine::connect(&params.connection).await?;
        let session = format!("s{}", self.counter.fetch_add(1, Ordering::SeqCst) + 1);
        let (queue, commands) = mpsc::unbounded_channel();
        let slot = Slot::default();
        let gate = Gate::default();

        locked(&self.sessions).insert(
            session.clone(),
            Arc::new(SessionHandle {
                queue,
                canceller: Arc::new(canceller),
                slot: slot.clone(),
                gate: gate.clone(),
            }),
        );
        tokio::spawn(session_worker(
            Worker {
                session: session.clone(),
                sessions: self.sessions.clone(),
                running: self.running.clone(),
                slot,
                gate,
            },
            engine,
            commands,
        ));

        to_json(OpenResult { session, server })
    }

    async fn cancel(self: Arc<Self>, params: CancelParams) -> Result<Json> {
        let state = locked(&self.running).get(&params.request).cloned();

        let Some(state) = state else {
            return to_json(CancelResult { cancelled: false });
        };

        match reach(&state) {
            Reach::Finished => to_json(CancelResult { cancelled: false }),
            Reach::Queued => to_json(CancelResult { cancelled: true }),
            Reach::Running(killer) => {
                kill(killer).await;
                tokio::spawn(repeat_cancel(self.running.clone(), state));

                to_json(CancelResult { cancelled: true })
            }
        }
    }

    /// Stops what is running, then closes every session. Meant for the end of the input.
    pub async fn shutdown(&self) {
        let running: Vec<Arc<RequestState>> = locked(&self.running).values().cloned().collect();

        for state in running {
            if let Reach::Running(killer) = reach(&state) {
                kill(killer).await;
            }
        }

        let handles: Vec<Arc<SessionHandle>> = locked(&self.sessions).drain().map(|(_, handle)| handle).collect();

        for handle in handles {
            let (reply, answer) = oneshot::channel();
            let state = Arc::new(RequestState {
                id: String::new(),
                cancelled: Arc::new(AtomicBool::new(false)),
                finished: AtomicBool::new(false),
                slot: handle.slot.clone(),
                gate: handle.gate.clone(),
                canceller: handle.canceller.clone(),
            });
            let command = Command {
                id: String::new(),
                state,
                call: Call::Close(SessionParams { session: String::new() }),
                reply,
            };

            if handle.queue.send(command).is_ok() {
                let _ = tokio::time::timeout(CLOSE_TIMEOUT, answer).await;
            }
        }
    }
}

/// A MySQL kill still to be sent, with the gate that keeps its session from starting the next request until it is.
struct Kill {
    killer: MysqlCanceller,
    _gate: OwnedRwLockReadGuard<()>,
}

enum Reach {
    Finished,
    Queued,
    Running(Option<Kill>),
}

/// Marks the request cancelled and interrupts it only while it is the one its session is executing.
///
/// Everything happens under the lock of the slot, so the request cannot end and the next one begin in between. A MySQL
/// kill is sent after the lock is released, so it takes the session's gate first: a request that ends in that gap
/// leaves its successor waiting until the kill is done, instead of letting the server stop the successor.
fn reach(state: &RequestState) -> Reach {
    let slot = locked(&state.slot);

    if state.finished.load(Ordering::SeqCst) {
        return Reach::Finished;
    }

    state.cancelled.store(true, Ordering::SeqCst);

    if slot.as_deref() != Some(state.id.as_str()) {
        return Reach::Queued;
    }

    // The worker holds the gate for writing only while its slot is empty, so it is free while this request is in the slot.
    let killer = state.canceller.trigger();
    let gate = state.gate.clone().try_read_owned();

    Reach::Running(killer.zip(gate.ok()).map(|(killer, gate)| Kill { killer, _gate: gate }))
}

async fn kill(kill: Option<Kill>) {
    if let Some(kill) = kill
        && let Err(error) = kill.killer.cancel().await
    {
        eprintln!("adecore-database: could not cancel the query: {error}");
    }
}

/// SQLite ignores an interrupt that arrives before its statement has begun, so a cancel repeats while the request is still the running one.
async fn repeat_cancel(running: Running, state: Arc<RequestState>) {
    for _ in 0..CANCEL_RETRIES {
        tokio::time::sleep(CANCEL_RETRY_DELAY).await;

        let listed = locked(&running).get(&state.id).is_some_and(|current| Arc::ptr_eq(current, &state));

        match reach(&state) {
            Reach::Running(killer) if listed => kill(killer).await,
            _ => return,
        }
    }
}

/// Frees the slot and takes the request out of the running list. Returns whether it was cancelled by then.
fn finish(state: &RequestState, running: &Running) -> bool {
    let mut slot = locked(&state.slot);
    *slot = None;
    state.finished.store(true, Ordering::SeqCst);
    locked(running).remove(&state.id);

    state.cancelled.load(Ordering::SeqCst)
}

async fn test(params: OpenParams) -> Result<Json> {
    let (engine, server, _) = engine::connect(&params.connection).await?;
    engine.close().await;

    to_json(TestResult { server })
}

async fn sample(params: SampleParams) -> Result<Json> {
    let sampled = tokio::task::spawn_blocking(move || import::sample(&params))
        .await
        .map_err(|e| DatabaseError::internal(format!("The file reader failed: {e}.")))??;

    to_json(sampled)
}

async fn discover(params: DiscoverParams) -> Result<Json> {
    to_json(discover::discover(params).await?)
}

/// Runs a request in a task of its own, so a panic answers `internal` instead of ending the helper.
fn isolated<F>(id: String, work: F) -> ResponseFuture
where
    F: Future<Output = Result<Json>> + Send + 'static,
{
    Box::pin(async move {
        let outcome = match tokio::spawn(work).await {
            Ok(outcome) => outcome,
            Err(e) => Err(DatabaseError::internal(format!("The request failed unexpectedly: {e}."))),
        };

        response_line(&id, outcome)
    })
}

/// What the worker of a session shares with the dispatcher.
struct Worker {
    session: String,
    sessions: Sessions,
    running: Running,
    slot: Slot,
    gate: Gate,
}

async fn session_worker(worker: Worker, mut engine: Engine, mut commands: mpsc::UnboundedReceiver<Command>) {
    let Worker {
        session,
        sessions,
        running,
        slot,
        gate,
    } = worker;

    while let Some(Command { id, state, call, reply }) = commands.recv().await {
        // Waits out a kill still on its way to the request before, which would otherwise stop this one. The slot is empty
        // until this request takes it, so no new kill can start in between.
        drop(gate.write().await);
        // A cancel sets its flag under the same lock, so a request is either cancelled here or found in the slot.
        let cancelled_while_queued = {
            let mut current = locked(&slot);

            if state.cancelled.load(Ordering::SeqCst) {
                true
            } else {
                *current = Some(id.clone());
                false
            }
        };

        if cancelled_while_queued {
            finish(&state, &running);
            let _ = reply.send(Err(DatabaseError::cancelled()));
            continue;
        }

        if matches!(call, Call::Close(_)) {
            engine.close().await;
            finish(&state, &running);
            let _ = reply.send(Ok(Json::Null));

            return;
        }

        let writes = matches!(call, Call::Apply(_) | Call::Import(_) | Call::Export(_) | Call::Transaction(_));
        let cancelled = state.cancelled.clone();
        let task = tokio::spawn(async move {
            let outcome = run_call(&mut engine, call, cancelled).await;

            (engine, outcome)
        });

        let joined = task.await;
        let was_cancelled = finish(&state, &running);

        let (returned, outcome) = match joined {
            Ok(finished) => finished,
            Err(e) => {
                let _ = reply.send(Err(DatabaseError::internal(format!("The session failed unexpectedly: {e}."))));
                fail_queued(&mut commands, &running, || DatabaseError::internal("The session ended unexpectedly."));

                return;
            }
        };

        engine = returned;

        // Nothing can run on the session again, so it goes; `unknown-session` tells a client to open a new one for what it retries.
        if let Err(error) = &outcome
            && error.connection_lost
        {
            locked(&sessions).remove(&session);
            let _ = reply.send(Err(DatabaseError::new(
                ErrorCode::UnknownSession,
                format!("The connection of session \"{session}\" was lost, so the session closed. {}", error.message),
            )));
            fail_queued(&mut commands, &running, || DatabaseError::unknown_session(&session));
            let _ = tokio::time::timeout(CLOSE_TIMEOUT, engine.close()).await;

            return;
        }

        // A server may end an interrupted query without an error (MySQL's `SLEEP` does), and a committed write stays committed.
        let outcome = match outcome {
            Err(error) if was_cancelled && matches!(error.code, ErrorCode::QueryFailed | ErrorCode::Internal) => Err(DatabaseError::cancelled()),
            Ok(_) if was_cancelled && !writes => Err(DatabaseError::cancelled()),
            other => other,
        };

        let _ = reply.send(outcome);
    }

    engine.close().await;
}

/// Answers what waits in the queue of a session that can no longer serve it.
fn fail_queued(commands: &mut mpsc::UnboundedReceiver<Command>, running: &Running, error: impl Fn() -> DatabaseError) {
    commands.close();

    while let Ok(command) = commands.try_recv() {
        locked(running).remove(&command.id);
        let _ = command.reply.send(Err(error()));
    }
}

async fn run_call(engine: &mut Engine, call: Call, cancelled: Arc<AtomicBool>) -> Result<Json> {
    match call {
        Call::Schemas(_) => to_json(engine.schemas().await?),
        Call::Tables(params) => to_json(engine.tables(params).await?),
        Call::Structure(params) => to_json(engine.structure(params).await?),
        Call::Rows(params) => to_json(engine.rows(params).await?),
        Call::Count(params) => to_json(engine.count(params).await?),
        Call::Cell(params) => to_json(engine.cell(params).await?),
        Call::Apply(params) => to_json(engine.apply(params).await?),
        Call::Execute(params) => to_json(engine.execute(params, cancelled).await?),
        Call::Page(params) => to_json(engine.page(params).await?),
        Call::Transaction(params) => to_json(engine.transaction(params).await?),
        Call::Export(params) => to_json(engine.export(params, cancelled).await?),
        Call::Import(params) => to_json(engine.import(params, cancelled).await?),
        Call::Open(_) | Call::Close(_) | Call::Test(_) | Call::Sample(_) | Call::Discover(_) | Call::Cancel(_) => {
            Err(DatabaseError::internal("A call without a session reached a session."))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn answer(dispatcher: &Arc<Dispatcher>, line: serde_json::Value) -> Json {
        serde_json::from_str(&dispatcher.submit(&line.to_string()).await).unwrap()
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn a_session_starts_nothing_while_a_kill_is_on_its_way() {
        let directory = tempfile::tempdir().unwrap();
        let dispatcher = Arc::new(Dispatcher::new());
        let path = directory.path().join("gate.sqlite");
        let opened = answer(
            &dispatcher,
            serde_json::json!({ "id": "1", "method": "open", "params": { "connection": { "engine": "sqlite", "path": path.to_str().unwrap(), "create": true } } }),
        )
        .await;
        let session = opened["result"]["session"].as_str().unwrap().to_string();
        let gate = locked(&dispatcher.sessions)[&session].gate.clone();
        let held = gate.clone().try_read_owned().unwrap();

        let next = tokio::spawn(
            dispatcher.submit(&serde_json::json!({ "id": "2", "method": "execute", "params": { "session": session, "sql": "SELECT 1" } }).to_string()),
        );
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!next.is_finished(), "the next request waits for the kill");

        drop(held);
        let line: Json = serde_json::from_str(&tokio::time::timeout(Duration::from_secs(5), next).await.unwrap().unwrap()).unwrap();
        assert_eq!(line["result"]["results"][0]["rows"], serde_json::json!([[1]]));
        assert!(gate.try_read_owned().is_ok(), "the gate is free again for the next kill");
    }
}
