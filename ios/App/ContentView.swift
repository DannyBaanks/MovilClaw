import SwiftUI

enum ExecutionEngineMode: String, CaseIterable, Identifiable {
    case local = "📱 iPhone (Local)"
    case remote = "🖥️ PC (Docker)"
    
    var id: String { rawValue }
    
    var iconName: String {
        switch self {
        case .local: return "iphone"
        case .remote: return "desktopcomputer"
        }
    }
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
            Color(red: 0.03, green: 0.05, blue: 0.08)
                .ignoresSafeArea()
            
            VStack(spacing: 0) {
                // Top Native Bar con Apple Design (Touch Targets >= 44pt y feedback háptico)
                HStack(spacing: 12) {
                    // Selector de Modo (Local iPhone vs Remoto PC)
                    Menu {
                        ForEach(ExecutionEngineMode.allCases) { mode in
                            Button(action: {
                                Haptics.selection()
                                withAnimation(.spring(response: 0.35, dampingFraction: 0.8)) {
                                    engineMode = mode
                                }
                            }) {
                                Label {
                                    Text(mode.rawValue)
                                } icon: {
                                    Image(systemName: mode.iconName)
                                }
                            }
                        }
                    } label: {
                        HStack(spacing: 8) {
                            Circle()
                                .fill(engineMode == .local ? Color(red: 0.0, green: 0.87, blue: 0.78) : (isConnected ? Color(red: 0.13, green: 0.77, blue: 0.37) : Color(red: 0.94, green: 0.27, blue: 0.27)))
                                .frame(width: 8, height: 8)
                            
                            Text(engineMode.rawValue)
                                .font(.system(.subheadline, design: .default).weight(.semibold))
                                .foregroundColor(.white)
                            
                            Image(systemName: "chevron.down")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                        }
                        .padding(.horizontal, 12)
                        .frame(minHeight: 44)
                        .background(Color(red: 0.08, green: 0.12, blue: 0.20))
                        .cornerRadius(10)
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .stroke(Color(red: 0.14, green: 0.20, blue: 0.30), lineWidth: 1)
                        )
                    }
                    
                    Spacer()
                    
                    if engineMode == .remote {
                        Button(action: {
                            Haptics.impact(.light)
                            reloadKey = UUID()
                        }) {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 15, weight: .semibold))
                                .foregroundColor(Color(red: 0.70, green: 0.76, blue: 0.84))
                                .frame(width: 44, height: 44)
                                .background(Color(red: 0.08, green: 0.12, blue: 0.20))
                                .cornerRadius(10)
                        }
                        .accessibilityLabel("Recargar servidor")
                    }
                    
                    Button(action: {
                        Haptics.impact(.light)
                        showSettingsSheet = true
                    }) {
                        Image(systemName: "gearshape.fill")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(Color(red: 0.0, green: 0.87, blue: 0.78))
                            .frame(width: 44, height: 44)
                            .background(Color(red: 0.08, green: 0.12, blue: 0.20))
                            .cornerRadius(10)
                    }
                    .accessibilityLabel("Configuración y ajustes")
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 4)
                .background(Color(red: 0.04, green: 0.06, blue: 0.10))
                
                Divider()
                    .background(Color(red: 0.12, green: 0.16, blue: 0.24))
                
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
                            Haptics.impact(.light)
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
                    Haptics.notification(.warning)
                    showSettingsSheet = false
                    isConnected = false
                },
                onReload: {
                    Haptics.impact(.light)
                    showSettingsSheet = false
                    reloadKey = UUID()
                }
            )
        }
    }
}

// MARK: - Vista Local del Sandbox en iPhone (Apple Design & Terminal Craft)
struct LocalDeviceSandboxView: View {
    @Binding var output: String
    @Binding var isRunning: Bool
    @State private var pythonCodeInput: String = "def sumar(a, b):\n    return a + b\n\nprint('Resultado en iPhone:', sumar(20, 22))"
    @FocusState private var isEditorFocused: Bool
    
    var body: some View {
        VStack(spacing: 14) {
            // Header del Sandbox Local
            HStack(alignment: .center) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Sandbox Local en iPhone")
                        .font(.system(.headline, design: .default).weight(.bold))
                        .foregroundColor(.white)
                    Text("Python WASM en dispositivo · Aislado de red y disco")
                        .font(.footnote)
                        .foregroundColor(Color(red: 0.0, green: 0.87, blue: 0.78))
                }
                Spacer()
                Button(action: runTestScript) {
                    HStack(spacing: 6) {
                        if isRunning {
                            ProgressView()
                                .progressViewStyle(CircularProgressViewStyle(tint: Color(red: 0.03, green: 0.08, blue: 0.12)))
                        } else {
                            Image(systemName: "play.fill")
                                .font(.caption)
                        }
                        Text(isRunning ? "Ejecutando..." : "Ejecutar")
                            .font(.system(.subheadline, design: .default).weight(.bold))
                    }
                    .padding(.horizontal, 16)
                    .frame(minHeight: 44)
                    .background(Color(red: 0.0, green: 0.87, blue: 0.78))
                    .foregroundColor(Color(red: 0.03, green: 0.08, blue: 0.12))
                    .cornerRadius(10)
                    .shadow(color: Color(red: 0.0, green: 0.87, blue: 0.78).opacity(isRunning ? 0.1 : 0.3), radius: 8, y: 3)
                }
                .disabled(isRunning)
            }
            .padding(.horizontal, 16)
            .padding(.top, 12)
            
            // Editor de código local
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Label("EDITOR DE CÓDIGO (main.py)", systemImage: "chevron.left.forwardslash.chevron.right")
                        .font(.system(.caption, design: .default).weight(.semibold))
                        .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                        .tracking(0.5)
                    Spacer()
                    if isEditorFocused {
                        Button("Listo") {
                            isEditorFocused = false
                        }
                        .font(.caption.weight(.bold))
                        .foregroundColor(Color(red: 0.0, green: 0.87, blue: 0.78))
                    }
                }
                .padding(.horizontal, 16)
                
                TextEditor(text: $pythonCodeInput)
                    .focused($isEditorFocused)
                    .font(.system(.body, design: .monospaced))
                    .foregroundColor(Color(red: 0.94, green: 0.96, blue: 0.98))
                    .padding(10)
                    .background(Color(red: 0.06, green: 0.08, blue: 0.14))
                    .cornerRadius(12)
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(isEditorFocused ? Color(red: 0.0, green: 0.87, blue: 0.78).opacity(0.8) : Color(red: 0.14, green: 0.20, blue: 0.30), lineWidth: 1.2)
                    )
                    .padding(.horizontal, 16)
                    .frame(height: 180)
            }
            
            // Consola de Salida del iPhone
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Label("SALIDA DE CONSOLA (Stdout / Stderr)", systemImage: "terminal")
                        .font(.system(.caption, design: .default).weight(.semibold))
                        .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                        .tracking(0.5)
                    Spacer()
                    if !output.isEmpty {
                        Button(action: {
                            Haptics.selection()
                            output = ""
                        }) {
                            Text("Limpiar")
                                .font(.caption.weight(.semibold))
                                .foregroundColor(Color(red: 0.0, green: 0.87, blue: 0.78))
                                .frame(minWidth: 44, minHeight: 32)
                        }
                    }
                }
                .padding(.horizontal, 16)
                
                ScrollView {
                    Text(output.isEmpty ? "Toca 'Ejecutar' para correr el código en el runtime local del iPhone..." : output)
                        .font(.system(.footnote, design: .monospaced))
                        .foregroundColor(output.isEmpty ? Color(red: 0.40, green: 0.46, blue: 0.54) : Color(red: 0.55, green: 0.94, blue: 0.76))
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(14)
                }
                .background(Color(red: 0.04, green: 0.06, blue: 0.10))
                .cornerRadius(12)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color(red: 0.14, green: 0.20, blue: 0.30), lineWidth: 1)
                )
                .padding(.horizontal, 16)
                .frame(maxHeight: .infinity)
            }
        }
    }
    
    private func runTestScript() {
        isEditorFocused = false
        isRunning = true
        Haptics.impact(.medium)
        
        Task {
            // Guarda el archivo en el sandbox local aislado
            _ = try? await LocalDeviceSandbox.shared.writeFile(path: "main.py", content: pythonCodeInput)
            // Ejecuta el código en el iPhone con PythonRunner
            let result = await PythonRunner.shared.run(code: pythonCodeInput)
            
            DispatchQueue.main.async {
                isRunning = false
                if result.success {
                    Haptics.notification(.success)
                } else {
                    Haptics.notification(.error)
                }
                let status = result.success ? "✓ Exitoso (código 0)" : "✕ Error (código \(result.code))"
                let body = result.output.isEmpty ? (result.error ?? "Sin salida") : result.output
                output = "[\(status)]\n\(body)"
            }
        }
    }
}

// MARK: - Settings Sheet (Apple NavigationStack & Grouped Cards)
struct SettingsSheet: View {
    let currentURL: String
    @Binding var engineMode: ExecutionEngineMode
    let onDisconnect: () -> Void
    let onReload: () -> Void
    @Environment(\.dismiss) private var dismiss
    
    var body: some View {
        NavigationStack {
            ZStack {
                Color(red: 0.05, green: 0.07, blue: 0.12)
                    .ignoresSafeArea()
                
                ScrollView {
                    VStack(spacing: 20) {
                        // Selector de Motor con Picker Nativo
                        VStack(alignment: .leading, spacing: 10) {
                            Text("MOTOR DE EJECUCIÓN")
                                .font(.caption.weight(.semibold))
                                .foregroundColor(Color(red: 0.0, green: 0.87, blue: 0.78))
                                .tracking(0.6)
                            
                            Picker("Motor", selection: $engineMode) {
                                ForEach(ExecutionEngineMode.allCases) { mode in
                                    Text(mode.rawValue).tag(mode)
                                }
                            }
                            .pickerStyle(SegmentedPickerStyle())
                            .onChange(of: engineMode) { _ in
                                Haptics.selection()
                            }
                        }
                        .padding(16)
                        .background(Color(red: 0.08, green: 0.11, blue: 0.18))
                        .cornerRadius(16)
                        
                        // Opciones según el motor
                        if engineMode == .remote {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("SERVIDOR PC")
                                    .font(.caption.weight(.semibold))
                                    .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                                
                                Text(currentURL.isEmpty ? "No configurado" : currentURL)
                                    .font(.system(.body, design: .monospaced))
                                    .foregroundColor(.white)
                                    .padding(12)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .background(Color(red: 0.05, green: 0.07, blue: 0.12))
                                    .cornerRadius(10)
                                
                                Button(action: onReload) {
                                    HStack {
                                        Image(systemName: "arrow.clockwise")
                                        Text("Recargar Interfaz Web")
                                            .font(.subheadline.weight(.semibold))
                                    }
                                    .frame(maxWidth: .infinity)
                                    .frame(minHeight: 46)
                                    .background(Color(red: 0.10, green: 0.14, blue: 0.24))
                                    .foregroundColor(.white)
                                    .cornerRadius(12)
                                }
                                
                                Button(action: onDisconnect) {
                                    HStack {
                                        Image(systemName: "power")
                                        Text("Desconectar de PC")
                                            .font(.subheadline.weight(.semibold))
                                    }
                                    .frame(maxWidth: .infinity)
                                    .frame(minHeight: 46)
                                    .background(Color(red: 0.94, green: 0.27, blue: 0.27).opacity(0.15))
                                    .foregroundColor(Color(red: 0.97, green: 0.44, blue: 0.44))
                                    .cornerRadius(12)
                                }
                            }
                            .padding(16)
                            .background(Color(red: 0.08, green: 0.11, blue: 0.18))
                            .cornerRadius(16)
                        } else {
                            VStack(alignment: .leading, spacing: 12) {
                                Text("SANDBOX IPHONE")
                                    .font(.caption.weight(.semibold))
                                    .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                                
                                Text("Aislamiento estricto en Documents/MovilClaw/work/app.\nCero acceso a Keychain ni a la red local sin autorización.")
                                    .font(.footnote)
                                    .foregroundColor(Color(red: 0.70, green: 0.76, blue: 0.84))
                                    .lineSpacing(3)
                                
                                Button(action: {
                                    Haptics.notification(.warning)
                                    Task { try? await LocalDeviceSandbox.shared.resetWorkspace() }
                                    dismiss()
                                }) {
                                    HStack {
                                        Image(systemName: "trash.fill")
                                        Text("Limpiar Workspace Local")
                                            .font(.subheadline.weight(.semibold))
                                    }
                                    .frame(maxWidth: .infinity)
                                    .frame(minHeight: 46)
                                    .background(Color(red: 0.94, green: 0.27, blue: 0.27).opacity(0.15))
                                    .foregroundColor(Color(red: 0.94, green: 0.40, blue: 0.40))
                                    .cornerRadius(12)
                                }
                            }
                            .padding(16)
                            .background(Color(red: 0.08, green: 0.11, blue: 0.18))
                            .cornerRadius(16)
                        }
                    }
                    .padding(20)
                }
            }
            .navigationTitle("Ajustes")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Listo") {
                        Haptics.selection()
                        dismiss()
                    }
                    .font(.body.weight(.semibold))
                    .foregroundColor(Color(red: 0.0, green: 0.87, blue: 0.78))
                }
            }
        }
        .presentationDragIndicator(.visible)
        .presentationDetents([.medium, .large])
    }
}
