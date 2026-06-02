mod security;
mod wallet;
mod api;
mod models;

use axum::{routing::{get, post}, Router, middleware};
use sqlx::sqlite::SqlitePoolOptions;
use std::sync::Arc;
use std::net::SocketAddr; // FIXED: Added this import
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;

use crate::api::handlers::{AppState, register_user, login_user, create_wallet, get_balance_handler, secure_transfer, get_logs, init_db};
use crate::api::middleware::{IpRateLimiter, rate_limit_middleware};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let database_url = "sqlite://wallet.db?mode=rwc";
    let pool = SqlitePoolOptions::new().max_connections(5).connect(database_url).await?;
    init_db(&pool).await;

    let shared_state = Arc::new(AppState { db: pool });
    let rate_limiter = IpRateLimiter::new(); 

    let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);

    let auth_routes = Router::new()
        .route("/register", post(register_user))
        .route("/login", post(login_user))
        .layer(middleware::from_fn_with_state(rate_limiter, rate_limit_middleware));

    let app = Router::new()
        .nest("/api", auth_routes) 
        .route("/api/wallet/create", post(create_wallet))
        .route("/api/wallet/balance/:address", post(get_balance_handler))
        .route("/api/wallet/transfer", post(secure_transfer))
        .route("/api/logs", get(get_logs))
        .fallback_service(ServeDir::new("static"))
        .layer(cors)
        .with_state(shared_state);

    let addr = "0.0.0.0:3000";
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("🛡️ IOTA Vault Hardened Active on http://{}", addr);
    
    // Using SocketAddr to track IP addresses for security
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;
    Ok(())
}