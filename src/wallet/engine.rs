use iota_sdk::client::constants::{SHIMMER_TESTNET_BECH32_HRP, SHIMMER_COIN_TYPE};
use iota_sdk::client::Client;
use iota_sdk::client::secret::{mnemonic::MnemonicSecretManager, SecretManage};
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
        // Build client (Unwrap Result with .expect)
        let _client = Client::builder()
            .with_node("https://api.testnet.shimmer.network")
            .expect("Invalid Node URL")
            .finish()
            .await
            .expect("Failed to build client");

        let secret_manager = MnemonicSecretManager::try_from_mnemonic(mnemonic)
            .expect("Invalid mnemonic");

        // Generate the Ed25519 address (coin_type, account, range, options)
        let addresses = secret_manager
            .generate_ed25519_addresses(
                SHIMMER_COIN_TYPE, 
                0, 
                0..1, 
                None, 
            )
            .await
            .expect("Failed to generate addresses");

        // Convert to Bech32 (rms1...)
        addresses[0].to_bech32(SHIMMER_TESTNET_BECH32_HRP).to_string()
    }

    /// MOCKED BALANCE: To bypass SDK versioning issues and allow security tests
    pub async fn get_balance(_address: &str) -> Result<u64, String> {
        // Return 0 Glow for now so you can run the server
        Ok(0)
    }

    /// Mocked transfer for Security Audit
    pub async fn send_transfer(_mnemonic: &str, recipient: &str, amount: u64) -> Result<String, String> {
        println!("🛡️ Security Engine: Signing transfer of {} to {}...", amount, recipient);
        Ok("0x789_mock_shimmer_block_id".to_string())
    }
}