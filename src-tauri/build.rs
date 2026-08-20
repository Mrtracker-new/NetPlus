use std::path::{Path, PathBuf};

fn find_lib_directory(root: &Path) -> Option<PathBuf> {
    if root.join("wpcap.lib").exists() || root.join("Packet.lib").exists() {
        return Some(root.to_path_buf());
    }
    if let Ok(entries) = std::fs::read_dir(root) {
        let mut subdirs = Vec::new();
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                // Check if this subdirectory is an x64 lib directory containing wpcap.lib
                let is_x64 = path.to_string_lossy().to_lowercase().contains("x64");
                if is_x64 && (path.join("wpcap.lib").exists() || path.join("Packet.lib").exists()) {
                    return Some(path);
                }
                subdirs.push(path);
            }
        }
        for dir in subdirs {
            if let Some(found) = find_lib_directory(&dir) {
                return Some(found);
            }
        }
    }
    None
}

fn main() {
    tauri_build::build();

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rerun-if-env-changed=NPCAP_SDK_PATH");
        println!("cargo:rerun-if-env-changed=LIB");
        println!("cargo:rerun-if-env-changed=VCPKG_ROOT");

        let mut found = false;

        // 0. Check in-tree vendored libraries (guarantees offline & CI build reliability)
        if let Ok(manifest_dir) = std::env::var("CARGO_MANIFEST_DIR") {
            let manifest_path = PathBuf::from(manifest_dir);
            let in_tree_candidates = vec![
                manifest_path.join("lib").join("x64"),
                manifest_path
                    .join("..")
                    .join("crates")
                    .join("netpulse-platform")
                    .join("lib")
                    .join("x64"),
                manifest_path.join("..").join("lib").join("x64"),
            ];
            for candidate in in_tree_candidates {
                if let Some(lib_dir) = find_lib_directory(&candidate) {
                    println!("cargo:rustc-link-search=native={}", lib_dir.display());
                    found = true;
                    break;
                }
            }
        }

        // 1. Check explicit NPCAP_SDK_PATH environment variable
        if !found {
            if let Ok(sdk_var) = std::env::var("NPCAP_SDK_PATH") {
                let base = PathBuf::from(sdk_var);
                if let Some(lib_dir) = find_lib_directory(&base) {
                    println!("cargo:rustc-link-search=native={}", lib_dir.display());
                    found = true;
                }
            }
        }

        // 2. Check standard LIB environment variable
        if !found {
            if let Ok(lib_env) = std::env::var("LIB") {
                for path in std::env::split_paths(&lib_env) {
                    if path.join("wpcap.lib").exists() || path.join("Packet.lib").exists() {
                        println!("cargo:rustc-link-search=native={}", path.display());
                        found = true;
                        break;
                    }
                }
            }
        }

        // 3. Check VCPKG_ROOT directory
        if !found {
            if let Ok(vcpkg_root) = std::env::var("VCPKG_ROOT") {
                let vcpkg_lib = PathBuf::from(vcpkg_root)
                    .join("installed")
                    .join("x64-windows")
                    .join("lib");
                if vcpkg_lib.exists() {
                    println!("cargo:rustc-link-search=native={}", vcpkg_lib.display());
                    found = true;
                }
            }
        }

        // 4. Check common default Windows installation paths
        if !found {
            let mut default_paths = Vec::new();
            if let Ok(prog_files) = std::env::var("ProgramFiles") {
                default_paths.push(PathBuf::from(prog_files).join("Npcap SDK"));
            }
            if let Ok(prog_files_x86) = std::env::var("ProgramFiles(x86)") {
                default_paths.push(PathBuf::from(prog_files_x86).join("Npcap SDK"));
            }
            default_paths.push(PathBuf::from(r"C:\npcap-sdk"));

            for path in default_paths {
                if let Some(lib_dir) = find_lib_directory(&path) {
                    println!("cargo:rustc-link-search=native={}", lib_dir.display());
                    found = true;
                    break;
                }
            }
        }

        // 5. Automatic fallback for clean Windows environments / CI runners:
        // Fetch Npcap SDK into OUT_DIR if missing on host machine.
        if !found {
            if let Ok(out_dir_var) = std::env::var("OUT_DIR") {
                let out_dir = PathBuf::from(out_dir_var);
                let sdk_dir = out_dir.join("npcap-sdk");

                if let Some(lib_dir) = find_lib_directory(&sdk_dir) {
                    println!("cargo:rustc-link-search=native={}", lib_dir.display());
                    found = true;
                } else {
                    println!("cargo:warning=Npcap SDK not found locally. Downloading Npcap SDK for Windows build...");
                    let zip_path = out_dir.join("npcap-sdk.zip");
                    let ps_script = format!(
                        "$ProgressPreference = 'SilentlyContinue'; \
                         [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; \
                         Invoke-WebRequest -Uri 'https://npcap.com/dist/npcap-sdk-1.13.zip' -OutFile '{}' -UserAgent 'Mozilla/5.0'; \
                         Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                        zip_path.display(),
                        zip_path.display(),
                        sdk_dir.display()
                    );
                    let status = std::process::Command::new("powershell")
                        .args(["-NoProfile", "-Command", &ps_script])
                        .status();

                    if status.map(|s| s.success()).unwrap_or(false) {
                        if let Some(lib_dir) = find_lib_directory(&sdk_dir) {
                            println!("cargo:rustc-link-search=native={}", lib_dir.display());
                            found = true;
                        }
                    }
                }
            }
        }

        if !found {
            println!("cargo:warning=Npcap SDK library directory not found. Set NPCAP_SDK_PATH or LIB if live capture linking requires Npcap.");
        }
    }
}
