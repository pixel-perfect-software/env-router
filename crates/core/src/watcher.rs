//! Asks a slow question for a window that asks it every time it gains focus, without ever
//! waiting long or piling up. One thread at a time asks for a key; an asker waits up to `wait` for it and
//! otherwise is given the answer of the last probe that finished for the same key (or nothing,
//! the first time), so a probe that hangs makes the answer "unknown", never an error or a queue.
//! If an asker went away without the answer, the probe says so when it finishes (`late`), so the
//! window can ask again instead of waiting for the next focus; that second ask is given the answer
//! the probe just found (it is younger than `max_age`), not a new probe, which could be late again.
//! Each key (a home folder) has its own probe and its own answer. Used for whether the secret store
//! works (`envrouter_keychain`) and for which agents a new terminal finds (`envrouter_ops`).

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::{Condvar, Mutex, MutexGuard, PoisonError};
use std::thread;
use std::time::{Duration, Instant};

pub struct Watcher<K, A> {
    state: Mutex<Vec<Entry<K, A>>>,
    finished: Condvar,
}

/// What is known of one key: a few at most (one per home folder), so a list will do.
struct Entry<K, A> {
    key: K,
    running: bool,
    /// An asker returned while the probe was still running, so it owes `late`.
    abandoned: bool,
    /// What the last probe that finished found (nothing, if it panicked), and when.
    last: Option<(Option<A>, Instant)>,
}

impl<K, A> Watcher<K, A>
where
    K: PartialEq + Clone + Send + 'static,
    A: Clone + Send + 'static,
{
    pub const fn new() -> Self {
        Self {
            state: Mutex::new(Vec::new()),
            finished: Condvar::new(),
        }
    }

    fn state(&self) -> MutexGuard<'_, Vec<Entry<K, A>>> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    /// Answers with what the last finished probe for `key` found if that is younger than
    /// `max_age`. Otherwise starts `probe` on its own thread unless one is running for that key,
    /// waits up to `wait` for it, and answers with what the last finished probe for it found.
    /// Each key has its own probe: one that hangs says nothing about another. `late` runs on the
    /// probe's thread once it finishes, but only if some asker returned before then. A probe that
    /// panics answers nothing, and says `late` like any other.
    pub fn ask(
        &'static self,
        key: &K,
        wait: Duration,
        max_age: Duration,
        probe: impl FnOnce(&K) -> A + Send + 'static,
        late: impl FnOnce() + Send + 'static,
    ) -> Option<A> {
        let mut state = self.state();
        let entry = entry_of(&mut state, key);
        if let Some((found, at)) = &entry.last {
            if at.elapsed() < max_age {
                return found.clone();
            }
        }
        if !entry.running {
            entry.running = true;
            entry.abandoned = false;
            let asked = key.clone();
            thread::spawn(move || {
                let found = catch_unwind(AssertUnwindSafe(|| probe(&asked))).ok();
                let mut state = self.state();
                let entry = entry_of(&mut state, &asked);
                // A probe that panicked is an answer of nothing, as fresh as any: asking again at
                // once must not start the same probe over, which may panic again.
                entry.last = Some((found, Instant::now()));
                entry.running = false;
                let owed = std::mem::take(&mut entry.abandoned);
                self.finished.notify_all();
                drop(state);
                if owed {
                    late();
                }
            });
            state = self
                .finished
                .wait_timeout_while(state, wait, |state| entry_of(state, key).running)
                .unwrap_or_else(PoisonError::into_inner)
                .0;
        }
        let entry = entry_of(&mut state, key);
        if entry.running {
            entry.abandoned = true;
        }
        entry.last.as_ref().and_then(|(found, _)| found.clone())
    }
}

/// `key`'s entry, made if it has none yet.
fn entry_of<'a, K: PartialEq + Clone, A>(
    entries: &'a mut Vec<Entry<K, A>>,
    key: &K,
) -> &'a mut Entry<K, A> {
    let at = entries
        .iter()
        .position(|entry| entry.key == *key)
        .unwrap_or_else(|| {
            entries.push(Entry {
                key: key.clone(),
                running: false,
                abandoned: false,
                last: None,
            });
            entries.len() - 1
        });
    &mut entries[at]
}

impl<K, A> Default for Watcher<K, A>
where
    K: PartialEq + Clone + Send + 'static,
    A: Clone + Send + 'static,
{
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::mpsc;

    use super::*;

    /// A probe that hangs is "unknown", asking again while it hangs starts no second one (they
    /// used to pile up, one thread per focus), the asker that gave up is told once when it
    /// finishes, and asking again then, as that asker does, is given the answer it found rather
    /// than a new probe (which could be late again, forever).
    #[test]
    fn a_slow_probe_is_unknown_never_asked_twice_and_says_once_when_it_finishes() {
        static WATCHER: Watcher<&str, &str> = Watcher::new();
        static STARTED: AtomicUsize = AtomicUsize::new(0);
        let wait = Duration::from_millis(30);
        let fresh = Duration::from_secs(60);
        let (release, gate) = mpsc::channel::<()>();
        let (finished, told) = mpsc::channel::<()>();

        let slow = WATCHER.ask(
            &"a",
            wait,
            fresh,
            move |_| {
                STARTED.fetch_add(1, Ordering::SeqCst);
                gate.recv().ok();
                "found"
            },
            move || finished.send(()).unwrap(),
        );
        assert_eq!(slow, None);
        let again = WATCHER.ask(
            &"a",
            wait,
            fresh,
            |_| {
                STARTED.fetch_add(1, Ordering::SeqCst);
                "second"
            },
            || {},
        );
        assert_eq!(again, None);

        release.send(()).unwrap();
        told.recv_timeout(Duration::from_secs(5))
            .expect("the asker that gave up is told");
        let reasked = WATCHER.ask(
            &"a",
            wait,
            fresh,
            |_| {
                STARTED.fetch_add(1, Ordering::SeqCst);
                "third"
            },
            || panic!("nothing was late"),
        );
        assert_eq!(reasked, Some("found"));
        assert_eq!(STARTED.load(Ordering::SeqCst), 1);
        assert!(told.try_recv().is_err(), "told once");

        // Past its age the answer is asked for again; the probe is slow too, so meanwhile the
        // asker gets what the last one found.
        let (release, gate) = mpsc::channel::<()>();
        let kept = WATCHER.ask(
            &"a",
            wait,
            Duration::ZERO,
            move |_| {
                gate.recv().ok();
                "newer"
            },
            || {},
        );
        assert_eq!(kept, Some("found"));
        release.send(()).unwrap();
    }

    /// A probe that panics is an answer of nothing that is as fresh as any, so asking again from
    /// the `late` it still sends doesn't start it over (it could panic again, forever).
    #[test]
    fn a_probe_that_panics_answers_nothing_and_is_not_started_again() {
        static WATCHER: Watcher<&str, &str> = Watcher::new();
        static STARTED: AtomicUsize = AtomicUsize::new(0);
        let (finished, told) = mpsc::channel::<()>();
        let wait = Duration::from_millis(1);
        let fresh = Duration::from_secs(60);

        let first = WATCHER.ask(
            &"a",
            wait,
            fresh,
            |_| {
                STARTED.fetch_add(1, Ordering::SeqCst);
                std::thread::sleep(Duration::from_millis(30));
                panic!("the probe broke")
            },
            move || finished.send(()).unwrap(),
        );
        assert_eq!(first, None);
        told.recv_timeout(Duration::from_secs(5))
            .expect("late is sent after a panic");
        let again = WATCHER.ask(
            &"a",
            wait,
            fresh,
            |_| {
                STARTED.fetch_add(1, Ordering::SeqCst);
                "second"
            },
            || {},
        );
        assert_eq!(again, None);
        assert_eq!(STARTED.load(Ordering::SeqCst), 1);
    }

    /// A probe that hangs for one key says nothing about another: the other is probed on its own,
    /// and is told when it finishes, whatever the first is doing.
    #[test]
    fn each_key_is_probed_and_told_on_its_own() {
        static WATCHER: Watcher<&str, &str> = Watcher::new();
        let wait = Duration::from_millis(20);
        let fresh = Duration::from_secs(60);
        let (release_a, gate_a) = mpsc::channel::<()>();
        let (release_b, gate_b) = mpsc::channel::<()>();
        let (told_b, b_told) = mpsc::channel::<()>();

        let a = WATCHER.ask(
            &"a",
            wait,
            fresh,
            move |_| {
                gate_a.recv().ok();
                "a"
            },
            || {},
        );
        let b = WATCHER.ask(
            &"b",
            wait,
            fresh,
            move |_| {
                gate_b.recv().ok();
                "b"
            },
            move || told_b.send(()).unwrap(),
        );
        assert_eq!((a, b), (None, None));

        release_b.send(()).unwrap();
        b_told
            .recv_timeout(Duration::from_secs(5))
            .expect("b's asker is told while a is still running");
        assert_eq!(
            WATCHER.ask(&"b", wait, fresh, |_| "never", || {}),
            Some("b")
        );
        release_a.send(()).unwrap();
    }
}
