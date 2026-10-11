import SwiftUI

struct ConnectionView: View {
    @Binding var serverURLString: String
    @Binding var isConnected: Bool
    
    @State private var inputURL: String = ""
    @State private var isTesting: Bool = false
    @State private var testMessage: String = ""
    @State private var isError: Bool = false
    @AppStorage("auto_connect_on_launch") private var autoConnect: Bool = true
    @FocusState private var isFieldFocused: Bool
    
    var body: some View {
        ZStack {
            Color(red: 0.03, green: 0.05, blue: 0.08)
                .ignoresSafeArea()
                .onTapGesture {
                    isFieldFocused = false
                }
            
            ScrollView {
                VStack(spacing: 24) {
                    Spacer(minLength: 20)
                    
                    // Brand Header (Apple Craft & Identity)
                    VStack(spacing: 12) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                .fill(LinearGradient(
                                    colors: [Color(red: 0.01, green: 0.52, blue: 0.78), Color(red: 0.0, green: 0.87, blue: 0.78)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                ))
                                .frame(width: 68, height: 68)
                                .shadow(color: Color(red: 0.0, green: 0.87, blue: 0.78).opacity(0.35), radius: 16, y: 6)
                            
                            Image(systemName: "terminal.fill")
                                .font(.system(size: 30, weight: .bold))
                                .foregroundColor(Color(red: 0.02, green: 0.08, blue: 0.12))
                        }
                        
                        Text("MovilClaw")
                            .font(.system(.title, design: .rounded).weight(.bold))
                            .foregroundColor(.white)
                        
                        Text("Sandboxes kamikaze en tu bolsillo")
                            .font(.subheadline)
                            .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                    }
                    .padding(.top, 10)
                    
                    // Form Card (Apple HIG Container)
                    VStack(alignment: .leading, spacing: 16) {
                        HStack {
                            Text("DIRECCIÓN DEL SERVIDOR")
                                .font(.system(.caption, design: .default).weight(.semibold))
                                .foregroundColor(Color(red: 0.0, green: 0.87, blue: 0.78))
                                .tracking(0.8)
                            Spacer()
                        }
                        
                        // Input Field con Clear Button y Focus State
                        HStack(spacing: 10) {
                            Image(systemName: "network")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundColor(isFieldFocused ? Color(red: 0.0, green: 0.87, blue: 0.78) : Color(red: 0.58, green: 0.64, blue: 0.72))
                            
                            TextField("http://192.168.1.XX:8788", text: $inputURL)
                                .focused($isFieldFocused)
                                .autocapitalization(.none)
                                .disableAutocorrection(true)
                                .keyboardType(.URL)
                                .submitLabel(.go)
                                .onSubmit(testAndConnect)
                                .foregroundColor(.white)
                                .font(.system(.body, design: .monospaced))
                            
                            if !inputURL.isEmpty {
                                Button(action: {
                                    Haptics.impact(.light)
                                    inputURL = ""
                                }) {
                                    Image(systemName: "xmark.circle.fill")
                                        .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                                        .frame(width: 32, height: 32)
                                }
                            }
                        }
                        .padding(.horizontal, 14)
                        .padding(.vertical, 12)
                        .background(Color(red: 0.06, green: 0.09, blue: 0.15))
                        .cornerRadius(12)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(isFieldFocused ? Color(red: 0.0, green: 0.87, blue: 0.78).opacity(0.8) : Color(red: 0.14, green: 0.20, blue: 0.30), lineWidth: 1.2)
                        )
                        
                        // Quick Presets con Touch Target HIG (>=44pt)
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Preajustes rápidos")
                                .font(.caption2)
                                .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                            
                            HStack(spacing: 10) {
                                Button(action: {
                                    Haptics.selection()
                                    inputURL = "http://127.0.0.1:8788"
                                }) {
                                    HStack(spacing: 6) {
                                        Image(systemName: "desktopcomputer")
                                            .font(.caption)
                                        Text("Localhost")
                                            .font(.system(.footnote, design: .default).weight(.medium))
                                    }
                                    .padding(.horizontal, 14)
                                    .frame(minHeight: 44)
                                    .background(Color(red: 0.09, green: 0.13, blue: 0.21))
                                    .foregroundColor(Color(red: 0.70, green: 0.76, blue: 0.84))
                                    .cornerRadius(10)
                                }
                                
                                Button(action: {
                                    Haptics.selection()
                                    if let base = inputURL.components(separatedBy: ":").first, base.contains("192.168") {
                                        // Conservar
                                    } else {
                                        inputURL = "http://192.168.1.100:8788"
                                    }
                                }) {
                                    HStack(spacing: 6) {
                                        Image(systemName: "wifi")
                                            .font(.caption)
                                        Text("LAN Wi-Fi")
                                            .font(.system(.footnote, design: .default).weight(.medium))
                                    }
                                    .padding(.horizontal, 14)
                                    .frame(minHeight: 44)
                                    .background(Color(red: 0.09, green: 0.13, blue: 0.21))
                                    .foregroundColor(Color(red: 0.70, green: 0.76, blue: 0.84))
                                    .cornerRadius(10)
                                }
                                
                                Spacer()
                            }
                        }
                        
                        Divider()
                            .background(Color(red: 0.14, green: 0.20, blue: 0.30))
                        
                        // Auto-connect toggle
                        Toggle(isOn: $autoConnect) {
                            Text("Conectar automáticamente al iniciar")
                                .font(.subheadline)
                                .foregroundColor(Color(red: 0.80, green: 0.85, blue: 0.92))
                        }
                        .toggleStyle(SwitchToggleStyle(tint: Color(red: 0.0, green: 0.87, blue: 0.78)))
                        
                        // Status feedback con animación
                        if !testMessage.isEmpty {
                            HStack(spacing: 8) {
                                Image(systemName: isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                                    .foregroundColor(isError ? Color(red: 0.94, green: 0.27, blue: 0.27) : Color(red: 0.13, green: 0.77, blue: 0.37))
                                Text(testMessage)
                                    .font(.footnote)
                                    .foregroundColor(isError ? Color(red: 0.94, green: 0.27, blue: 0.27) : Color(red: 0.13, green: 0.77, blue: 0.37))
                                    .lineLimit(2)
                            }
                            .transition(.opacity.combined(with: .move(edge: .top)))
                        }
                        
                        // Primary Connect Button (Touch Target >= 50pt)
                        Button(action: {
                            Haptics.impact(.medium)
                            testAndConnect()
                        }) {
                            HStack(spacing: 8) {
                                if isTesting {
                                    ProgressView()
                                        .progressViewStyle(CircularProgressViewStyle(tint: Color(red: 0.02, green: 0.08, blue: 0.12)))
                                }
                                Text(isTesting ? "Verificando orquestador..." : "Conectar al Servidor")
                                    .font(.system(.body, design: .default).weight(.bold))
                                    .foregroundColor(Color(red: 0.02, green: 0.08, blue: 0.12))
                            }
                            .frame(maxWidth: .infinity)
                            .frame(minHeight: 50)
                            .background(Color(red: 0.0, green: 0.87, blue: 0.78))
                            .cornerRadius(12)
                            .shadow(color: Color(red: 0.0, green: 0.87, blue: 0.78).opacity(isTesting ? 0.15 : 0.35), radius: 10, y: 4)
                        }
                        .disabled(isTesting || inputURL.trimmingCharacters(in: .whitespaces).isEmpty)
                        .opacity((isTesting || inputURL.trimmingCharacters(in: .whitespaces).isEmpty) ? 0.6 : 1.0)
                    }
                    .padding(20)
                    .background(Color(red: 0.07, green: 0.10, blue: 0.17))
                    .cornerRadius(18)
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .stroke(Color(red: 0.14, green: 0.20, blue: 0.30), lineWidth: 1)
                    )
                    .padding(.horizontal, 20)
                    
                    // Instructions Helper (Disclosure Card)
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 6) {
                            Image(systemName: "info.circle.fill")
                                .foregroundColor(Color(red: 0.0, green: 0.87, blue: 0.78))
                            Text("¿Cómo obtener la IP de tu PC?")
                                .font(.footnote.weight(.semibold))
                                .foregroundColor(.white)
                        }
                        
                        Text("1. En la terminal de tu PC ejecuta: `hostname -I` o `ip route get 1`")
                        Text("2. Inicia MovilClaw escuchando en tu red: `HOST=0.0.0.0 npm start`")
                        Text("3. Asegúrate de conectar tu iPhone y tu PC al mismo Wi-Fi o túnel Tailscale.")
                    }
                    .font(.caption)
                    .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                    .padding(16)
                    .background(Color(red: 0.05, green: 0.07, blue: 0.12))
                    .cornerRadius(14)
                    .padding(.horizontal, 20)
                    
                    Spacer(minLength: 20)
                }
            }
        }
        .onAppear {
            if inputURL.isEmpty {
                inputURL = serverURLString.isEmpty ? "http://192.168.1.100:8788" : serverURLString
            }
            if autoConnect && !serverURLString.isEmpty {
                testAndConnect()
            }
        }
    }
    
    private func testAndConnect() {
        isFieldFocused = false
        var clean = inputURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if !clean.hasPrefix("http://") && !clean.hasPrefix("https://") {
            clean = "http://" + clean
        }
        guard let url = URL(string: clean + "/api/health") else {
            testMessage = "URL inválida"
            isError = true
            Haptics.notification(.error)
            return
        }
        
        isTesting = true
        testMessage = "Comprobando orquestador..."
        isError = false
        
        var request = URLRequest(url: url)
        request.timeoutInterval = 4.0
        
        URLSession.shared.dataTask(with: request) { _, response, error in
            DispatchQueue.main.async {
                isTesting = false
                if let http = response as? HTTPURLResponse, http.statusCode == 200 {
                    testMessage = "Conexión exitosa"
                    isError = false
                    serverURLString = clean
                    Haptics.notification(.success)
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        isConnected = true
                    }
                } else {
                    isError = true
                    Haptics.notification(.error)
                    testMessage = "No se pudo conectar: \(error?.localizedDescription ?? "servidor no disponible")"
                }
            }
        }.resume()
    }
}
