from .db import SessionLocal
from .models import Transaction
from pathlib import Path
import importlib.util

def assess_risk(tx_payload: dict) -> float:
    """Đánh giá rủi ro dựa trên mô hình frade-system và lịch sử giao dịch."""
    db = SessionLocal()
    sender_id = tx_payload.get("sender_id")
    amount = tx_payload.get("amount", 0)

    # 1. Kiểm tra tần suất: Đếm số giao dịch hiện có của người dùng trong DB
    # Dựa trên Transaction model trong backend/models.py
    recent_count = db.query(Transaction).filter(Transaction.sender_id == sender_id).count()
    
    try:
        # Xác định đường dẫn đến hệ thống frade-system bên ngoài
        base = Path(__file__).resolve().parents[2] 
        det_path = base / "frade-system" / "src" / "detection.py"
        feat_path = base / "frade-system" / "src" / "features.py"
        
        if det_path.exists() and feat_path.exists():
            # Load dynamic module detection.py và features.py
            spec = importlib.util.spec_from_file_location("frade_detection", str(det_path))
            mod = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(mod)
            
            spec2 = importlib.util.spec_from_file_location("frade_features", str(feat_path))
            fmod = importlib.util.module_from_spec(spec2)
            spec2.loader.exec_module(fmod)

            # Xây dựng vector đặc trưng (feature vector)
            features = {"amount": amount, "recent_tx_count": recent_count}
            if hasattr(fmod, "make_features"):
                features = fmod.make_features(tx_payload)
            
            # Gọi hàm chấm điểm từ model ML nếu có
            if hasattr(mod, "score_transaction"):
                return float(mod.score_transaction(features))
    except Exception:
        # Nếu có lỗi khi load model ML, chuyển sang logic dự phòng bên dưới
        pass

    # 2. Logic Heuristic dự phòng (Simple Rules)
    # Ngưỡng rủi ro cao cho các giao dịch lớn
    if amount > 5000:
        return 0.95
    if amount > 1000:
        return 0.75
    
    # Rủi ro trung bình nếu là người dùng mới thực hiện giao dịch
    return 0.1 if recent_count < 3 else 0.3