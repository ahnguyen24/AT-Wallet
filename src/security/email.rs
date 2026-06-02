use lettre::transport::smtp::authentication::Credentials;
use lettre::{Message, SmtpTransport, Transport};
use std::env;

/// Gửi email chứa mã TOTP đến địa chỉ email của người đăng ký.
/// Chạy đồng bộ, nên gọi qua `send_totp_email_async` để tránh block thread.
pub fn send_totp_email(recipient_email: &str, totp_secret: &str) -> Result<(), String> {
    // Tải các biến môi trường từ file .env vào bộ nhớ process
    let _ = dotenvy::dotenv();

    let smtp_server = env::var("SMTP_SERVER").unwrap_or_else(|_| "smtp.gmail.com".to_string());
    let username = env::var("SMTP_USERNAME").map_err(|e| e.to_string())?;
    let password = env::var("SMTP_PASSWORD").map_err(|e| e.to_string())?;

    // Nếu cấu hình vẫn là mặc định, bỏ qua việc gửi mail để tránh lỗi panic
    if username == "your-email@gmail.com" || password == "your-app-password" {
        return Err("SMTP credentials are not configured in .env yet.".to_string());
    }

    // Tạo link QR thiết lập OTP tiện ích (otpauth URI)
    let otpauth_uri = format!(
        "otpauth://totp/AT-Wallet:{}?secret={}&issuer=AT-Wallet",
        recipient_email, totp_secret
    );

    // Xây dựng email body HTML
    let email_body = format!(
        r#"
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 30px; border: 1px solid #e2e8f0; rounded-2xl: 16px; background-color: #ffffff;">
            <div style="text-align: center; margin-bottom: 25px;">
                <h1 style="color: #059669; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">🛡️ AT-Wallet</h1>
                <p style="color: #64748b; font-size: 14px; margin-top: 5px;">Hệ sinh thái tài chính số bảo mật</p>
            </div>
            
            <hr style="border: 0; border-top: 1px solid #f1f5f9; margin-bottom: 25px;" />
            
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin-top: 0;">Chào bạn,</p>
            <p style="color: #334155; font-size: 15px; line-height: 1.6;">Chúc mừng bạn đã tạo tài khoản <strong>AT-Wallet</strong> thành công!</p>
            <p style="color: #334155; font-size: 15px; line-height: 1.6;">Dưới đây là mã bí mật xác thực 2 bước (TOTP) để thiết lập ứng dụng Google Authenticator hoặc Authy của bạn:</p>
            
            <div style="background-color: #f0fdf4; border: 1px dashed #bbf7d0; border-radius: 12px; padding: 20px; text-align: center; margin: 25px 0;">
                <span style="display: block; font-size: 11px; text-transform: uppercase; color: #166534; font-weight: 700; letter-spacing: 1px; margin-bottom: 5px;">Mã bảo mật (TOTP Secret Key)</span>
                <span style="font-family: monospace; font-size: 20px; font-weight: 700; color: #047857; letter-spacing: 2px; word-break: break-all; user-select: all;">{}</span>
            </div>

            <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 15px; margin-bottom: 25px;">
                <p style="color: #b45309; font-size: 13px; font-weight: 600; margin: 0; display: flex; align-items: center; gap: 8px;">
                    ⚠️ Lưu ý quan trọng:
                </p>
                <p style="color: #b45309; font-size: 12px; margin: 5px 0 0 0; line-height: 1.5;">
                    Không chia sẻ mã khóa bí mật này cho bất kỳ ai. Bạn sẽ cần nhập mã OTP từ ứng dụng xác thực mỗi lần đăng nhập.
                </p>
            </div>
            
            <p style="color: #334155; font-size: 13px; line-height: 1.6; margin-bottom: 0;">
                Bạn cũng có thể copy và import liên kết này trực tiếp nếu ứng dụng xác thực hỗ trợ: <br/>
                <a href="{}" style="color: #059669; font-weight: 600; text-decoration: underline; word-break: break-all;">{}</a>
            </p>
        </div>
        "#,
        totp_secret, otpauth_uri, otpauth_uri
    );

    // Xây dựng email
    let email = Message::builder()
        .from(username.parse().unwrap())
        .to(recipient_email.parse().unwrap())
        .subject("🛡️ Thiết lập bảo mật AT-Wallet TOTP")
        .header(lettre::message::header::ContentType::TEXT_HTML)
        .body(email_body)
        .map_err(|e| e.to_string())?;

    // Kết nối đến SMTP server và gửi thư
    let creds = Credentials::new(username, password);
    let mailer = SmtpTransport::relay(&smtp_server)
        .map_err(|e| e.to_string())?
        .credentials(creds)
        .build();

    mailer.send(&email).map_err(|e| e.to_string())?;
    Ok(())
}

/// Gửi email bất đồng bộ bằng cách chạy trên worker thread chuyên dụng của tokio
pub async fn send_totp_email_async(recipient_email: String, totp_secret: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        send_totp_email(&recipient_email, &totp_secret)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Gửi email cảnh báo đăng nhập mới.
pub fn send_login_warning_email(recipient_email: &str, ip_addr: &str, device_info: &str) -> Result<(), String> {
    let _ = dotenvy::dotenv();

    let smtp_server = env::var("SMTP_SERVER").unwrap_or_else(|_| "smtp.gmail.com".to_string());
    let username = env::var("SMTP_USERNAME").map_err(|e| e.to_string())?;
    let password = env::var("SMTP_PASSWORD").map_err(|e| e.to_string())?;

    if username == "your-email@gmail.com" || password == "your-app-password" {
        return Err("SMTP credentials are not configured in .env yet.".to_string());
    }

    let email_body = format!(
        r#"
        <div style="font-family: 'Segoe UI', Arial, sans-serif; max-width: 500px; margin: 0 auto; padding: 30px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
            <div style="text-align: center; margin-bottom: 25px;">
                <h1 style="color: #ef4444; margin: 0; font-size: 24px; font-weight: 800; letter-spacing: -0.5px;">⚠️ AT-Wallet Alert</h1>
                <p style="color: #64748b; font-size: 14px; margin-top: 5px;">Cảnh báo đăng nhập mới</p>
            </div>
            
            <hr style="border: 0; border-top: 1px solid #f1f5f9; margin-bottom: 25px;" />
            
            <p style="color: #334155; font-size: 15px; line-height: 1.6; margin-top: 0;">Chào bạn,</p>
            <p style="color: #334155; font-size: 15px; line-height: 1.6;">Hệ thống phát hiện tài khoản của bạn vừa đăng nhập thành công vào <strong>AT-Wallet</strong>.</p>
            
            <div style="background-color: #fef2f2; border: 1px solid #fee2e2; border-radius: 12px; padding: 20px; margin: 25px 0;">
                <p style="margin: 0 0 8px 0; color: #374151; font-size: 14px;"><strong>Địa chỉ IP:</strong> {}</p>
                <p style="margin: 0; color: #374151; font-size: 14px;"><strong>Thiết bị/Trình duyệt:</strong> {}</p>
            </div>

            <p style="color: #475569; font-size: 13px; line-height: 1.6;">
                Nếu là bạn thực hiện, vui lòng bỏ qua email này. Nếu không phải bạn, hãy đổi mật khẩu ngay lập tức hoặc liên hệ hỗ trợ để khóa tài khoản khẩn cấp.
            </p>
        </div>
        "#,
        ip_addr, device_info
    );

    let email = Message::builder()
        .from(username.parse().unwrap())
        .to(recipient_email.parse().unwrap())
        .subject("⚠️ Cảnh báo đăng nhập mới - AT-Wallet")
        .header(lettre::message::header::ContentType::TEXT_HTML)
        .body(email_body)
        .map_err(|e| e.to_string())?;

    let creds = Credentials::new(username, password);
    let mailer = SmtpTransport::relay(&smtp_server)
        .map_err(|e| e.to_string())?
        .credentials(creds)
        .build();

    mailer.send(&email).map_err(|e| e.to_string())?;
    Ok(())
}

/// Gửi email cảnh báo đăng nhập bất đồng bộ
pub async fn send_login_warning_email_async(recipient_email: String, ip_addr: String, device_info: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        send_login_warning_email(&recipient_email, &ip_addr, &device_info)
    })
    .await
    .map_err(|e| e.to_string())?
}
