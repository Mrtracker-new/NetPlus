use std::path::PathBuf;

fn main() {
    tauri_build::build();

    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("windows") {
        println!("cargo:rerun-if-env-changed=NPCAP_SDK_PATH");
        println!("cargo:rerun-if-env-changed=LIB");
        println!("cargo:rerun-if-env-changed=VCPKG_ROOT");

        let mut found = false;

        // 1. Check explicit NPCAP_SDK_PATH environment variable
        if let Ok(sdk_var) = std::env::var("NPCAP_SDK_PATH") {
            let base = PathBuf::from(sdk_var);
            let candidates = vec![
                base.join("Lib").join("x64"),
                base.join("lib").join("x64"),
                base.join("Lib"),
                base.clone(),
            ];
            for candidate in candidates {
                if candidate.exists() {
                    println!("cargo:rustc-link-search=native={}", candidate.display());
                    found = true;
                    break;
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
                default_paths.push(
                    PathBuf::from(prog_files)
                        .join("Npcap SDK")
                        .join("Lib")
                        .join("x64"),
                );
            }
            if let Ok(prog_files_x86) = std::env::var("ProgramFiles(x86)") {
                default_paths.push(
                    PathBuf::from(prog_files_x86)
                        .join("Npcap SDK")
                        .join("Lib")
                        .join("x64"),
                );
            }
            default_paths.push(PathBuf::from(r"C:\npcap-sdk\Lib\x64"));
            default_paths.push(PathBuf::from(r"C:\npcap-sdk\lib\x64"));

            for path in default_paths {
                if path.exists() {
                    println!("cargo:rustc-link-search=native={}", path.display());
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
                let lib_x64 = sdk_dir.join("Lib").join("x64");

                if lib_x64.exists() {
                    println!("cargo:rustc-link-search=native={}", lib_x64.display());
                    found = true;
                } else {
                    println!("cargo:warning=Npcap SDK not found locally. Downloading Npcap SDK for Windows build...");
                    let zip_path = out_dir.join("npcap-sdk.zip");
                    let ps_script = format!(
                        "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; \
                         Invoke-WebRequest -Uri 'https://npcap.com/dist/npcap-sdk-1.13.zip' -OutFile '{}'; \
                         Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                        zip_path.display(),
                        zip_path.display(),
                        sdk_dir.display()
                    );
                    let status = std::process::Command::new("powershell")
                        .args(["-NoProfile", "-Command", &ps_script])
                        .status();

                    if status.map(|s| s.success()).unwrap_or(false) && lib_x64.exists() {
                        println!("cargo:rustc-link-search=native={}", lib_x64.display());
                        found = true;
                    }
                }
            }
        }

        if !found {
            println!("cargo:warning=Npcap SDK library directory not found. Set NPCAP_SDK_PATH or LIB if live capture linking requires Npcap.");
        }
    }
}
