//! Pure Path — Chrome Native Messaging Host
//!
//! This binary is spawned by Chrome when the extension calls
//! `chrome.runtime.connectNative('com.purepath.companion')`.
//!
//! It speaks the Chrome Native Messaging protocol (4-byte LE length + JSON)
//! on stdin/stdout, and relays messages to the Tauri desktop app via a local
//! TCP connection on 127.0.0.1:17243.
//!
//! IMPORTANT: Never use println!() — it would corrupt the stdout protocol stream.
//! All diagnostics go to stderr or a log file.

use serde_json::Value;
use std::io::{self, BufReader, Read, Write};
use std::net::TcpStream;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

const TAURI_PORT: u16 = 17243;
const TAURI_ADDR: &str = "127.0.0.1";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);
const READ_TIMEOUT: Duration = Duration::from_millis(100);

/// Read a single Chrome Native Messaging message from stdin.
/// Format: 4 bytes (u32 LE) length, then `length` bytes of UTF-8 JSON.
fn read_native_message(reader: &mut impl Read) -> io::Result<Value> {
    let mut len_buf = [0u8; 4];
    reader.read_exact(&mut len_buf)?;
    let len = u32::from_le_bytes(len_buf) as usize;

    // Sanity check: Chrome limits messages to 1 MB
    if len > 1_048_576 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("Message too large: {} bytes", len),
        ));
    }

    let mut msg_buf = vec![0u8; len];
    reader.read_exact(&mut msg_buf)?;

    let json: Value = serde_json::from_slice(&msg_buf).map_err(|e| {
        io::Error::new(io::ErrorKind::InvalidData, format!("Invalid JSON: {}", e))
    })?;

    Ok(json)
}

/// Write a Chrome Native Messaging message to stdout.
/// Format: 4 bytes (u32 LE) length, then JSON bytes.
fn write_native_message(writer: &mut impl Write, msg: &Value) -> io::Result<()> {
    let json_bytes = serde_json::to_vec(msg).map_err(|e| {
        io::Error::new(io::ErrorKind::InvalidData, format!("JSON serialize error: {}", e))
    })?;
    let len = json_bytes.len() as u32;
    writer.write_all(&len.to_le_bytes())?;
    writer.write_all(&json_bytes)?;
    writer.flush()?;
    Ok(())
}

/// Try to connect to the Tauri app's TCP listener.
fn connect_to_tauri() -> io::Result<TcpStream> {
    let addr = format!("{}:{}", TAURI_ADDR, TAURI_PORT);
    let stream = TcpStream::connect_timeout(
        &addr.parse().map_err(|e| {
            io::Error::new(io::ErrorKind::InvalidInput, format!("Bad address: {}", e))
        })?,
        CONNECT_TIMEOUT,
    )?;
    stream.set_nodelay(true)?;
    Ok(stream)
}

/// Send a JSON message over TCP using a simple length-prefixed protocol.
/// Same format: 4 bytes LE length + JSON bytes.
fn send_tcp_message(stream: &mut TcpStream, msg: &Value) -> io::Result<()> {
    let json_bytes = serde_json::to_vec(msg).map_err(|e| {
        io::Error::new(io::ErrorKind::InvalidData, format!("JSON serialize error: {}", e))
    })?;
    let len = json_bytes.len() as u32;
    stream.write_all(&len.to_le_bytes())?;
    stream.write_all(&json_bytes)?;
    stream.flush()?;
    Ok(())
}

/// Read a JSON message from TCP using length-prefixed protocol.
fn read_tcp_message(reader: &mut BufReader<TcpStream>) -> io::Result<Value> {
    let mut len_buf = [0u8; 4];
    reader.read_exact(&mut len_buf)?;
    let len = u32::from_le_bytes(len_buf) as usize;

    if len > 1_048_576 {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            format!("TCP message too large: {} bytes", len),
        ));
    }

    let mut msg_buf = vec![0u8; len];
    reader.read_exact(&mut msg_buf)?;

    serde_json::from_slice(&msg_buf).map_err(|e| {
        io::Error::new(io::ErrorKind::InvalidData, format!("Invalid TCP JSON: {}", e))
    })
}

fn main() {
    // All logging goes to stderr — stdout is reserved for the protocol
    eprintln!("[pure-path-host] Starting native messaging host");

    // Connect to the Tauri app
    let tcp_stream = match connect_to_tauri() {
        Ok(s) => {
            eprintln!("[pure-path-host] Connected to Tauri app at {}:{}", TAURI_ADDR, TAURI_PORT);
            s
        }
        Err(e) => {
            eprintln!("[pure-path-host] Failed to connect to Tauri app: {}", e);
            // Send an error back to the extension so it knows
            let mut stdout = io::stdout().lock();
            let err_msg = serde_json::json!({
                "type": "error",
                "error": "desktop_app_not_running",
                "message": "Pure Path desktop app is not running"
            });
            let _ = write_native_message(&mut stdout, &err_msg);
            return;
        }
    };

    // Clone the TCP stream for the reader thread
    let tcp_read_stream = match tcp_stream.try_clone() {
        Ok(s) => s,
        Err(e) => {
            eprintln!("[pure-path-host] Failed to clone TCP stream: {}", e);
            return;
        }
    };

    let mut tcp_write_stream = tcp_stream;

    // Channel for messages from TCP reader → stdout writer
    let (tx, rx) = mpsc::channel::<Value>();

    // Thread 1: Read from Tauri TCP → send to Chrome stdout
    let tcp_reader_handle = thread::spawn(move || {
        let mut reader = BufReader::new(tcp_read_stream);
        // Set read timeout so the thread can exit when stdin closes
        if let Ok(ref stream) = reader.get_ref().try_clone() {
            let _ = stream.set_read_timeout(Some(READ_TIMEOUT));
        }

        loop {
            match read_tcp_message(&mut reader) {
                Ok(msg) => {
                    eprintln!("[pure-path-host] Tauri → Extension: {}", msg);
                    if tx.send(msg).is_err() {
                        eprintln!("[pure-path-host] stdout channel closed, exiting TCP reader");
                        break;
                    }
                }
                Err(ref e) if e.kind() == io::ErrorKind::WouldBlock
                    || e.kind() == io::ErrorKind::TimedOut =>
                {
                    // No data available, keep looping
                    continue;
                }
                Err(e) => {
                    eprintln!("[pure-path-host] TCP read error: {}", e);
                    break;
                }
            }
        }
    });

    // Thread 2: Write messages from channel to Chrome stdout
    let stdout_writer_handle = thread::spawn(move || {
        let mut stdout = io::stdout().lock();
        loop {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(msg) => {
                    if let Err(e) = write_native_message(&mut stdout, &msg) {
                        eprintln!("[pure-path-host] stdout write error: {}", e);
                        break;
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    eprintln!("[pure-path-host] Channel disconnected, exiting stdout writer");
                    break;
                }
            }
        }
    });

    // Main thread: Read from Chrome stdin → send to Tauri TCP
    let mut stdin = io::stdin().lock();
    loop {
        match read_native_message(&mut stdin) {
            Ok(msg) => {
                eprintln!("[pure-path-host] Extension → Tauri: {}", msg);
                if let Err(e) = send_tcp_message(&mut tcp_write_stream, &msg) {
                    eprintln!("[pure-path-host] TCP write error: {}", e);
                    break;
                }
            }
            Err(ref e) if e.kind() == io::ErrorKind::UnexpectedEof => {
                eprintln!("[pure-path-host] stdin closed (extension disconnected)");
                break;
            }
            Err(e) => {
                eprintln!("[pure-path-host] stdin read error: {}", e);
                break;
            }
        }
    }

    eprintln!("[pure-path-host] Shutting down");
    // Threads will exit when their streams/channels close
    drop(tcp_write_stream);
    let _ = tcp_reader_handle.join();
    let _ = stdout_writer_handle.join();
}
