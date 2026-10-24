//! Asks whether a secret store can be used, for a window that asks every time it gains focus.
//! The Secret Service is started on demand over D-Bus and WSL runs a Windows process, either of
//! which can hang, so one thread at a time asks, and a store that takes longer than `wait` is
//! "unknown", not "missing": the window leaves locking on. The answer of the last check that
//! finished is kept and given to a window that asks while a slower one is still running, so
//! nothing piles up behind a hung store and only the first ask ever waits for it.

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::Duration;

/// A check's answer: `Err` is the store's own reason it can't be used.
pub type Answer = Result<(), String>;

pub struct Checker {
    state: Mutex<State>,
    finished: Condvar,
}

struct State {
    running: bool,
    /// What the last check that finished found, and for which account.
    last: Option<(String, Answer)>,
}

impl Checker {
    pub const fn new() -> Self {
        Self {
            state: Mutex::new(State {
                running: false,
                last: None,
            }),
            finished: Condvar::new(),
        }
    }

    fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Whether `account`'s store can be used. Starts `check` on its own thread unless one is
    /// running, and waits up to `wait` for it. `Err` only when a check has found the store
    /// unusable; a check still running, or one that never ran, is `Ok`.
    pub fn ask(
        &'static self,
        account: &str,
        wait: Duration,
        check: impl FnOnce(&str) -> Answer + Send + 'static,
    ) -> Answer {
        let mut state = self.state();
        if !state.running {
            state.running = true;
            let account = account.to_owned();
            thread::spawn(move || {
                // A check that panics must not leave `running` set for good.
                let found = catch_unwind(AssertUnwindSafe(|| check(&account))).unwrap_or(Ok(()));
                let mut state = self.state();
                state.last = Some((account, found));
                state.running = false;
                self.finished.notify_all();
            });
            state = self
                .finished
                .wait_timeout_while(state, wait, |state| state.running)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        state
            .last
            .as_ref()
            .filter(|(asked, _)| asked == account)
            .map_or(Ok(()), |(_, found)| found.clone())
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;

    use super::*;

    /// A store that hangs is "unknown", asking again while it hangs starts no second check (they
    /// used to pile up, one detached thread per focus), and its answer is kept once it comes.
    #[test]
    fn a_slow_store_is_unknown_and_is_never_asked_twice_at_once() {
        static CHECKER: Checker = Checker::new();
        static STARTED: AtomicUsize = AtomicUsize::new(0);
        let wait = Duration::from_millis(30);
        let (release, gate) = mpsc::channel::<()>();

        let slow = CHECKER.ask("a", wait, move |_| {
            STARTED.fetch_add(1, Ordering::SeqCst);
            gate.recv().ok();
            Err("no Secret Service".into())
        });
        assert_eq!(slow, Ok(()));
        let again = CHECKER.ask("a", wait, |_| {
            STARTED.fetch_add(1, Ordering::SeqCst);
            Ok(())
        });
        assert_eq!(again, Ok(()));
        assert_eq!(STARTED.load(Ordering::SeqCst), 1);

        release.send(()).unwrap();
        while CHECKER.state().running {
            thread::sleep(Duration::from_millis(5));
        }
        // The next check hangs too; meanwhile the window is told what the last one found.
        let (release, gate) = mpsc::channel::<()>();
        let kept = CHECKER.ask("a", wait, move |_| {
            gate.recv().ok();
            Ok(())
        });
        assert_eq!(kept, Err("no Secret Service".to_string()));
        release.send(()).unwrap();
    }
}
