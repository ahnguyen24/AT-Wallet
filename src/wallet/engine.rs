use iota_sdk::client::constants::{SHIMMER_TESTNET_BECH32_HRP, SHIMMER_COIN_TYPE};
use iota_sdk::client::Client;
use iota_sdk::client::secret::{mnemonic::MnemonicSecretManager, SecretManage};
// CRITICAL: This trait must be in scope to use .to_bech32()
use iota_sdk::types::block::address::ToBech32Ext; 

pub struct WalletEngine;

impl WalletEngine {
    /// Generates a new cryptographically secure 24-word mnemonic as a String
    pub fn generate_mnemonic() -> String {
        iota_sdk::client::utils::generate_mnemonic()
            .expect("Failed to generate mnemonic")
            .to_string()
    }

    /// Initializes an IOTA Client and gets the first address
    pub async fn get_address_from_mnemonic(mnemonic: &str) -> String {
        // Build client context
        let _client = Client::builder()
            .with_node("https://api.testnet.shimmer.network")
            .expect("Failed to build client")
            .finish()
            .await
            .expect("Failed to finish client");

        let secret_manager = MnemonicSecretManager::try_from_mnemonic(mnemonic)
            .expect("Invalid mnemonic");

        // 1. Generate the raw Ed25519 address
        let addresses = secret_manager
            .generate_ed25519_addresses(
                SHIMMER_COIN_TYPE, 
                0, 
                0..1, 
                None, 
            )
            .await
            .expect("Failed to generate addresses");

        // 2. Encode to Bech32 (rms1...)
        // This now works because ToBech32Ext is in scope
        addresses[0].to_bech32(SHIMMER_TESTNET_BECH32_HRP).to_string()
    }
}