import SwiftUI

enum ExecutionEngineMode: String, CaseIterable, Identifiable {
    case local = "📱 iPhone (Local)"
    case remote = "🖥️ PC (Docker)"
    
    var id: String { rawValue }
}

struct ContentView: View {
    @AppStorage("movilclaw_engine_mode") private var engineMode: ExecutionEngineMode = .remote
    @AppStorage("movilclaw_server_url") private var serverURL: String = ""
    @State private var isConnected: Bool = false
    @State private var reloadKey: UUID = UUID()
    @State private var showSettingsSheet: Bool = false
    
    // Estado local para cuando corre en el iPhone sin PC
    @State private var localPythonOutput: String = ""
    @State private var isRunningLocalPython: Bool = false
    
    var body: some View {
        ZStack {
            Color(red: 0.03, green: 0.05, blue: 0.08).ignoresSafeArea()
            
            VStack(spacing: 0) {
                // Top Native Bar con selector de Engine
                HStack(spacing: 10) {
                    // Selector de Modo (Local iPhone vs Remoto PC)
                    Menu {
                        ForEach(ExecutionEngineMode.allCases) { mode in
                            Button(action: { engineMode = mode }) {
                                HStack {
                                    Text(mode.rawValue)
                                    if engineMode == mode {
                                        Image(systemName: "checkmark")
                                    }
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 6) {
                            Circle()
                                .fill(engineMode == .local ? Color(red: 0.0, green: 0.87, blue: 0.78) : (isConnected ? Color(red: 0.13, green: 0.77, blue: 0.37) : Color(red: 0.94, green: 0.27, blue: 0.27)))
                                .frame(width: 7, height: 7)
                            Text(engineMode.rawValue)
                                .font(.system(size: 11, weight: .bold))
                                .foregroundColor(.white)
                            Image(systemName: "chevron.down")
                                .font(.system(size: 9, weight: .bold))
                                .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                        }
                        .padding(.horizontal, 8)
                        .padding(.vertical, 4)
                        .background(Color(red: 0.08, green: 0.12, blue: 0.20))
                        .cornerRadius(6)
                    }
                    
                    Spacer()
                    
                    if engineMode == .remote {
                        Button(action: { reloadKey = UUID() }) {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 12, weight: .bold))
                                .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                                .padding(6)
                        }
                    }
                    
                    Button(action: { showSettingsSheet = true }) {
                        Image(systemName: "gearshape")
                            .font(.system(size: 12, weight: .bold))
                            .foregroundColor(Color(red: 0.0, green: 0.87, blue: 0.78))
                            .padding(6)
                    }
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 6)
                .background(Color(red: 0.04, green: 0.06, blue: 0.10))
                
                // Contenido según el modo seleccionado
                if engineMode == .local {
                    // Modo Local: el iPhone es el Sandbox del agente
                    LocalDeviceSandboxView(
                        output: $localPythonOutput,
                        isRunning: $isRunningLocalPython
                    )
                } else {
                    // Modo Remoto: Docker en la PC
                    if isConnected, let targetURL = URL(string: serverURL) {
                        WebViewContainer(url: targetURL, onReload: {
                            reloadKey = UUID()
                        })
                        .id(reloadKey)
                    } else {
                        ConnectionView(serverURLString: $serverURL, isConnected: $isConnected)
                    }
                }
            }
        }
        .sheet(isPresented: $showSettingsSheet) {
            SettingsSheet(
                currentURL: serverURL,
                engineMode: $engineMode,
                onDisconnect: {
                    showSettingsSheet = false
                    isConnected = false
                },
                onReload: {
                    showSettingsSheet = false
                    reloadKey = UUID()
                }
            )
        }
    }
}

// MARK: - Vista Local del Sandbox en iPhone
struct LocalDeviceSandboxView: View {
    @Binding var output: String
    @Binding var isRunning: Bool
    @State private var pythonCodeInput: String = "def sumar(a, b):\n    return a + b\n\nprint('Resultado en iPhone:', sumar(20, 22))"
    @State private var activeTab: String = "python"
    
    var body: some View {
        VStack(spacing: 12) {
            // Header del Sandbox Local
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Sandbox Local en iPhone")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundColor(.white)
                    Text("Python WASM / CPython en dispositivo · Sin servidor PC")
                        .font(.system(size: 11))
                        .foregroundColor(Color(red: 0.0, green: 0.87, blue: 0.78))
                }
                Spacer()
                Button(action: runTestScript) {
                    HStack(spacing: 4) {
                        if isRunning {
                            ProgressView().progressViewStyle(CircularProgressViewStyle(tint: .black))
                        } else {
                            Image(systemName: "play.fill")
                        }
                        Text(isRunning ? "Ejecutando..." : "Ejecutar")
                    }
                    .font(.system(size: 12, weight: .bold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(Color(red: 0.0, green: 0.87, blue: 0.78))
                    .foregroundColor(Color(red: 0.03, green: 0.08, blue: 0.12))
                    .cornerRadius(8)
                }
                .disabled(isRunning)
            }
            .padding(.horizontal, 16)
            .padding(.top, 10)
            
            // Editor de código local
            VStack(alignment: .leading, spacing: 6) {
                Text("EDITOR DE SCRIPT (main.py)")
                    .font(.system(size: 10, weight: .bold))
                    .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                    .padding(.horizontal, 16)
                
                TextEditor(text: $pythonCodeInput)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundColor(Color(red: 0.94, green: 0.96, blue: 0.98))
                    .padding(8)
                    .background(Color(red: 0.06, green: 0.08, blue: 0.14))
                    .cornerRadius(10)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(red: 0.14, green: 0.20, blue: 0.30), lineWidth: 1))
                    .padding(.horizontal, 16)
                    .frame(height: 160)
            }
            
            // Consola de Salida del iPhone
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("SALIDA DE CONSOLA (iPhone Stdout/Stderr)")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                    Spacer()
                    Button("Limpiar") { output = "" }
                        .font(.system(size: 10))
                        .foregroundColor(Color(red: 0.0, green: 0.87, blue: 0.78))
                }
                .padding(.horizontal, 16)
                
                ScrollView {
                    Text(output.isEmpty ? "Toca 'Ejecutar' para correr el código directamente en el iPhone..." : output)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(output.isEmpty ? Color(red: 0.40, green: 0.46, blue: 0.54) : Color(red: 0.55, green: 0.94, blue: 0.76))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(12)
                }
                .background(Color(red: 0.04, green: 0.06, blue: 0.10))
                .cornerRadius(10)
                .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(red: 0.14, green: 0.20, blue: 0.30), lineWidth: 1))
                .padding(.horizontal, 16)
                .frame(maxHeight: .infinity)
            }
        }
    }
    
    private func runTestScript() {
        isRunning = true
        Task {
            // Guarda el archivo en el sandbox local aislado
            _ = try? await LocalDeviceSandbox.shared.writeFile(path: "main.py", content: pythonCodeInput)
            // Ejecuta el código en el iPhone con PythonRunner
            let result = await PythonRunner.shared.run(code: pythonCodeInput)
            DispatchQueue.main.async {
                isRunning = false
                let status = result.success ? "✓ Exitoso (código 0)" : "✕ Error (código \(result.code))"
                let body = result.output.isEmpty ? (result.error ?? "Sin salida") : result.output
                output = "[\(status)]\n\(body)"
            }
        }
    }
}

// MARK: - Settings Sheet
struct SettingsSheet: View {
    let currentURL: String
    @Binding var engineMode: ExecutionEngineMode
    let onDisconnect: () -> Void
    let onReload: () -> Void
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        ZStack {
            Color(red: 0.05, green: 0.07, blue: 0.12).ignoresSafeArea()
            
            VStack(spacing: 18) {
                HStack {
                    Text("Configuración de Motor")
                        .font(.system(size: 16, weight: .bold))
                        .foregroundColor(.white)
                    Spacer()
                    Button("Cerrar") { dismiss() }
                        .foregroundColor(Color(red: 0.0, green: 0.87, blue: 0.78))
                }
                .padding(.top, 20)
                
                Picker("Motor", selection: $engineMode) {
                    ForEach(ExecutionEngineMode.allCases) { mode in
                        Text(mode.rawValue).tag(mode)
                    }
                }
                .pickerStyle(SegmentedPickerStyle())
                
                if engineMode == .remote {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("SERVIDOR PC CONECTADO:")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                        Text(currentURL.isEmpty ? "No configurado" : currentURL)
                            .font(.system(size: 13, design: .monospaced))
                            .foregroundColor(.white)
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(red: 0.08, green: 0.11, blue: 0.18))
                            .cornerRadius(8)
                    }
                    
                    Button(action: onReload) {
                        HStack {
                            Image(systemName: "arrow.clockwise")
                            Text("Recargar Interfaz Web")
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Color(red: 0.09, green: 0.13, blue: 0.22))
                        .foregroundColor(.white)
                        .cornerRadius(10)
                    }
                    
                    Button(action: onDisconnect) {
                        HStack {
                            Image(systemName: "power")
                            Text("Desconectar de PC")
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Color(red: 0.94, green: 0.27, blue: 0.27).opacity(0.15))
                        .foregroundColor(Color(red: 0.97, green: 0.44, blue: 0.44))
                        .cornerRadius(10)
                    }
                } else {
                    VStack(alignment: .leading, spacing: 6) {
                        Text("SANDBOX IPHONE LOCAL:")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                        Text("Aislamiento estricto en Documents/MovilClaw/work/app.\nCero acceso a Keychain ni a la red local sin autorización.")
                            .font(.system(size: 12))
                            .foregroundColor(Color(red: 0.70, green: 0.76, blue: 0.84))
                            .padding(10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(red: 0.08, green: 0.11, blue: 0.18))
                            .cornerRadius(8)
                    }
                    
                    Button(action: {
                        Task { try? await LocalDeviceSandbox.shared.resetWorkspace() }
                        dismiss()
                    }) {
                        HStack {
                            Image(systemName: "trash")
                            Text("Limpiar Workspace Local")
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Color(red: 0.09, green: 0.13, blue: 0.22))
                        .foregroundColor(Color(red: 0.94, green: 0.40, blue: 0.40))
                        .cornerRadius(10)
                    }
                }
                
                Spacer()
            }
            .padding(.horizontal, 20)
        }
        .presentationDetents([.fraction(0.5)])
    }
}
