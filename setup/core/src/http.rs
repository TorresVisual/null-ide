use std::{thread, time::Duration};

use crate::{Error, Result};

pub struct Http {
    agent: ureq::Agent,
    pub retry_delay: Duration,
}

impl Http {
    pub fn standard() -> Http { Http::with_delay(Duration::from_secs(1)) }

    pub fn with_delay(retry_delay: Duration) -> Http {
        let agent = ureq::AgentBuilder::new()
            .timeout_connect(Duration::from_secs(15))
            .timeout_read(Duration::from_secs(30))
            .user_agent("Null-IDE-Setup")
            .build();
        Http { agent, retry_delay }
    }

    pub fn get(&self, url: &str, range_from: Option<u64>) -> Result<ureq::Response> {
        self.send(url, range_from, false)
    }

    pub fn get_json(&self, url: &str) -> Result<serde_json::Value> {
        let body = self.send(url, None, true)?.into_string().map_err(|e| Error::Network(e.to_string()))?;
        serde_json::from_str(&body).map_err(|e| Error::Other(format!("invalid JSON from {url}: {e}")))
    }

    pub fn get_text(&self, url: &str) -> Result<String> {
        self.send(url, None, false)?.into_string().map_err(|e| Error::Network(e.to_string()))
    }

    /// 3 attempts. 4xx (except 429) is final; 5xx, 429 and transport errors are retried with backoff.
    fn send(&self, url: &str, range_from: Option<u64>, github_api: bool) -> Result<ureq::Response> {
        let mut last = Error::Network("no attempt made".into());
        for attempt in 0..3u32 {
            if attempt > 0 {
                thread::sleep(self.retry_delay * attempt);
            }
            let mut req = self.agent.get(url);
            if github_api {
                req = req.set("Accept", "application/vnd.github+json").set("X-GitHub-Api-Version", "2022-11-28");
                // Only the API call carries the token, never the asset download.
                if let Ok(t) = std::env::var("GITHUB_TOKEN") {
                    req = req.set("Authorization", &format!("Bearer {t}"));
                }
            }
            if let Some(n) = range_from {
                req = req.set("Range", &format!("bytes={n}-"));
            }
            match req.call() {
                Ok(r) => return Ok(r),
                Err(ureq::Error::Status(code, _)) if code < 500 && code != 429 => {
                    return Err(Error::Http { status: code, url: url.into() })
                }
                Err(ureq::Error::Status(code, _)) => last = Error::Http { status: code, url: url.into() },
                Err(ureq::Error::Transport(t)) => last = Error::Network(format!("{url}: {t}")),
            }
        }
        Err(last)
    }
}
