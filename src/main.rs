mod security;
mod wallet;
mod api;
mod models;

use axum::{routing::post, Router};
use sqlx::sqlite::SqlitePoolOptions;
use std::sync::Arc;

// Using direct path to avoid import errors
use crate::api::handlers::{AppState, register_user, create_wallet, init_db};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let database_url = "sqlite:wallet.db";

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(database_url)
        .await?;
    
    // Initialize DB
    init_db(&pool).await;

    let shared_state = Arc::new(AppState { db: pool });

    let app = Router::new()
        .route("/register", post(register_user))
        .route("/wallet/create", post(create_wallet))
        .with_state(shared_state);

    let addr = "0.0.0.0:3000";
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("🚀 IOTA Secure API running on http://{}", addr);
    
    axum::serve(listener, app).await?;

    Ok(())
}