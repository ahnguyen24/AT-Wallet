mod security;
mod wallet;
mod api;
mod models;

use axum::{routing::{get, post}, Router};
use sqlx::sqlite::SqlitePoolOptions;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;

// Import the AppState and handlers
use crate::api::handlers::{AppState, register_user, login_user, create_wallet, get_balance_handler, secure_transfer, get_logs, init_db};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let database_url = "sqlite://wallet.db?mode=rwc";
    let pool = SqlitePoolOptions::new().max_connections(5).connect(database_url).await?;
    init_db(&pool).await;

    let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);
    let shared_state = Arc::new(AppState { db: pool });

    let app = Router::new()
        .route("/api/register", post(register_user))
        .route("/api/login", post(login_user))
        .route("/api/wallet/create", post(create_wallet))
        .route("/api/wallet/balance/:address", post(get_balance_handler)) // Using POST for pwd
        .route("/api/wallet/transfer", post(secure_transfer))
        .route("/api/logs", get(get_logs))
        .fallback_service(ServeDir::new("static"))
        .layer(cors)
        .with_state(shared_state);

    println!("🚀 IOTA Vault Active on http://0.0.0.0:3000");
    let listener = tokio::net::TcpListener::bind("0.0.0.0:3000").await?;
    axum::serve(listener, app).await?;
    Ok(())
}