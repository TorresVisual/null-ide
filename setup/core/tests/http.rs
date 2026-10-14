mod support;
use std::{sync::{atomic::{AtomicUsize, Ordering}, Arc}, time::Duration};

use null_setup_core::{http::Http, Error};

fn http() -> Http { Http::with_delay(Duration::from_millis(1)) }

#[test]
fn a_404_fails_at_once_and_names_status_and_url() {
    let hits = Arc::new(AtomicUsize::new(0));
    let h = hits.clone();
    let srv = support::serve(move |_| { h.fetch_add(1, Ordering::SeqCst); (404, b"{}".to_vec(), vec![]) });
    let url = format!("{}/x", srv.base);
    match http().get(&url, None) {
        Err(Error::Http { status: 404, url: u }) => assert_eq!(u, url),
        other => panic!("unexpected: {other:?}", other = other.map(|_| ())),
    }
    assert_eq!(hits.load(Ordering::SeqCst), 1);
}

#[test]
fn a_503_is_retried_until_it_recovers() {
    let hits = Arc::new(AtomicUsize::new(0));
    let h = hits.clone();
    let srv = support::serve(move |_| {
        if h.fetch_add(1, Ordering::SeqCst) == 0 { (503, vec![], vec![]) } else { (200, b"ok".to_vec(), vec![]) }
    });
    assert_eq!(http().get_text(&format!("{}/x", srv.base)).unwrap(), "ok");
    assert_eq!(hits.load(Ordering::SeqCst), 2);
}

#[test]
fn a_429_is_retried_three_times_then_reported() {
    let hits = Arc::new(AtomicUsize::new(0));
    let h = hits.clone();
    let srv = support::serve(move |_| { h.fetch_add(1, Ordering::SeqCst); (429, vec![], vec![]) });
    assert!(matches!(http().get(&format!("{}/x", srv.base), None), Err(Error::Http { status: 429, .. })));
    assert_eq!(hits.load(Ordering::SeqCst), 3);
}
