use axum::{
    extract::{State, ConnectInfo},
    http::{StatusCode, Request},
    middleware::Next,
    response::Response,
};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::sync::Mutex;
use std::time::{Instant, Duration};

#[derive(Clone)]
pub struct IpRateLimiter {
    // Maps IP strings to a list of request timestamps
    records: Arc<Mutex<HashMap<String, Vec<Instant>>>>,
}

impl IpRateLimiter {
    pub fn new() -> Self {
        Self {
            records: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

/// Axum Middleware to limit request frequency
pub async fn rate_limit_middleware(
    State(limiter): State<IpRateLimiter>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>, // Extract client IP address
    request: Request<axum::body::Body>,
    next: Next,
) -> Result<Response, StatusCode> {
    let ip = addr.ip().to_string();
    let now = Instant::now();
    let one_minute = Duration::from_secs(60);

    let mut records = limiter.records.lock().await;
    let timestamps = records.entry(ip.clone()).or_insert_with(Vec::new);

    // 1. Clean up old timestamps (older than 60s)
    timestamps.retain(|&time| now.duration_since(time) < one_minute);

    // 2. Check threshold (Max 5 requests per minute)
    if timestamps.len() >= 5 {
        println!("🚨 RATE LIMIT TRIGGERED: Blocked IP {}", ip);
        return Err(StatusCode::TOO_MANY_REQUESTS);
    }

    // 3. Record current request and proceed
    timestamps.push(now);
    Ok(next.run(request).await)
}