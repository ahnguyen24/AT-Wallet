mod security;
mod wallet;
mod api;
mod models;

use axum::{routing::{get, post}, Router, middleware};
use sqlx::sqlite::SqlitePoolOptions;
use std::sync::Arc;
use std::net::SocketAddr;
use tower_http::cors::{Any, CorsLayer};
use tower_http::services::ServeDir;

// Import the AppState and handlers
use crate::api::handlers::{AppState, register_user, login_user, create_wallet, get_balance_handler, secure_transfer, get_logs, init_db};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // 1. ENVIRONMENT LOAD (Reads the local .env file)
    dotenvy::dotenv().ok();

    // 2. SECURITY ASSERTION (Application will crash immediately if missing)
    let jwt_secret = std::env::var("JWT_SECRET")
        .expect("CRITICAL SECURITY ERROR: JWT_SECRET environment variable is missing!");

    // 3. LOCK THE KEY into secure, read-only static memory
    crate::security::auth::JWT_SECRET_KEY.set(jwt_secret.into_bytes())
        .expect("CRITICAL SECURITY ERROR: Double initialization of JWT_SECRET detected!");

    let database_url = std::env::var("DATABASE_URL")
        .unwrap_or_else(|_| "sqlite://wallet.db?mode=rwc".to_string());

    // 4. PERSISTENCE INITIALIZATION (SQLx SQLite Connection)
    let pool = SqlitePoolOptions::new()
        .max_connections(5)
        .connect(&database_url)
        .await?;
    
    // Auto-create tables if missing
    init_db(&pool).await;
    println!("✔ Hardened Vault Security Configuration Locked.");

    // 5. SECURITY STATE & CORS SETUP
    let shared_state = Arc::new(AppState { db: pool });
    let rate_limiter = IpRateLimiter::new(); 
    let cors = CorsLayer::new().allow_origin(Any).allow_methods(Any).allow_headers(Any);

    // 6. DEFINE RATE-LIMITED AUTH ROUTES (Phase 4)
    let auth_routes = Router::new()
        .route("/register", post(register_user))
        .route("/login", post(login_user))
        .layer(middleware::from_fn_with_state(rate_limiter, rate_limit_middleware));

    // 7. COMPREHENSIVE ROUTER
    let app = Router::new()
        .nest("/api", auth_routes) // Auth routes protected by Rate Limiter
        .route("/api/wallet/create", post(create_wallet))
        .route("/api/wallet/balance/:address", post(get_balance_handler)) // Using POST for pwd
        .route("/api/wallet/transfer", post(secure_transfer))
        .route("/api/logs", get(get_logs))
        // Serve frontend files (HTML/CSS/JS) from 'static' folder
        .fallback_service(ServeDir::new("static"))
        .layer(cors)
        .with_state(shared_state);

    // 8. LAUNCH HTTP SERVER
    let addr = "0.0.0.0:3000";
    let listener = tokio::net::TcpListener::bind(addr).await?;
    println!("🛡️ IOTA Secure Vault Active");
    println!("🚀 Server running on http://localhost:3000");
    
    // Bind SocketAddr to capture client IPs for rate-limiting
    axum::serve(listener, app.into_make_service_with_connect_info::<SocketAddr>()).await?;
    Ok(())
}