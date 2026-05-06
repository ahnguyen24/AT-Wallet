# backend/solana_client.py
from solana.rpc.api import Client
# Trong phiên bản mới, Transaction nằm trong solders.transaction hoặc dùng trực tiếp từ thư viện solders
from solders.transaction import Transaction 
from solders.system_program import TransferParams, transfer
from solders.pubkey import Pubkey as PublicKey # PublicKey giờ là Pubkey
# Keypair thường được dùng từ thư viện solders
from solders.keypair import Keypair
from .config import SOLANA_RPC

client = Client(SOLANA_RPC)

def get_balance(address: str) -> int:
    # Cần convert string sang PublicKey object mới của solders
    resp = client.get_balance(PublicKey.from_string(address))
    # Cấu trúc response có thể thay đổi tùy version, thường là resp.value
    return getattr(resp, 'value', 0)

def send_signed_transaction(signed_tx) -> dict:
    resp = client.send_raw_transaction(signed_tx)
    return resp

def build_transfer_tx(sender_pubkey: PublicKey, recipient: str, lamports: int):
    # Cách khởi tạo Transaction trong version mới có thể khác, 
    # nhưng về cơ bản vẫn dùng các instructions (transfer)
    from solders.message import Message
    from solders.transaction import Transaction as SoldersTx
    
    inst = transfer(TransferParams(
        from_pubkey=sender_pubkey, 
        to_pubkey=PublicKey.from_string(recipient), 
        lamports=lamports
    ))
    # Lưu ý: Logic build transaction có thể cần blockhash gần nhất
    return inst