mod security;
mod wallet;
mod api;
mod models;

use axum::{
    routing::{get, post}, // Fixed: added 'get'
    Router,
};
use sqlx::sqlite::SqlitePoolOptions;
use std::sync::Arc;
use tower_http::cors::{Any, CorsLayer}; // Fixed: CORS import
use tower_http::services::ServeDir;
use crate::api::handlers::{
    AppState, register_user, login_user, create_wallet, 
    get_balance_handler, secure_transfer, init_db, 
    get_logs // ADDED THIS
};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // This ensures we always find the DB in the project root
    let database_url = "sqlite://wallet.db?mode=rwc"; 

    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(database_url) // Note the change to 'sqlite://' and '?mode=rwc'
        .await?;
    
    // 2. Initialize Tables
    init_db(&pool).await;

    // 3. Setup CORS (Cross-Origin Resource Sharing)
    // This allows your HTML/JS frontend to talk to the API safely
    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    // 4. Shared State
    let shared_state = Arc::new(AppState { db: pool });

    // 5. Define Routes
    let app = Router::new()
        .route("/api/register", post(register_user))
        .route("/api/login", post(login_user))
        .route("/api/wallet/create", post(create_wallet))
        .route("/api/wallet/balance/:address", get(get_balance_handler))
        .route("/api/wallet/transfer", post(secure_transfer))
        .route("/api/logs", get(get_logs)) // ADDED THIS
        .fallback_service(ServeDir::new("static"))
        .layer(cors)
        .with_state(shared_state);

    // 6. Start Server
    let addr = "0.0.0.0:3000";
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("🛡️ IOTA Secure Wallet System Active");
    println!("🚀 Server running on http://localhost:3000");
    
    axum::serve(listener, app).await?;

    Ok(())
}