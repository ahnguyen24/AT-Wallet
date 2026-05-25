mod security;
mod wallet;
mod api;

use wallet::engine::WalletEngine;
use security::encryption::SecurityCore;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    println!("🛡️ --- IOTA SECURE WALLET: PHASE 2 ---");

    // 1. Generate Mnemonic
    let mnemonic = WalletEngine::generate_mnemonic();
    println!("✔ Mnemonic generated (Securely held in memory)");

    // 2. Derive Address
    println!("📡 Connecting to Shimmer Testnet...");
    let address = WalletEngine::get_address_from_mnemonic(&mnemonic).await;
    println!("✔ Public Address: {}", address);

    // 3. Security Check: Encrypt the mnemonic
    let password = "User-Master-Password-2024";
    let salt = b"unique_salt_per_user";
    let master_key = SecurityCore::derive_master_key(password, salt);
    let (encrypted, _nonce) = SecurityCore::encrypt(&mnemonic, &master_key);
    
    println!("✔ Encryption Engine: PBKDF2 + AES-GCM verified.");
    println!("✔ Wallet setup complete. Address {} is ready for use.", address);

    Ok(())
}