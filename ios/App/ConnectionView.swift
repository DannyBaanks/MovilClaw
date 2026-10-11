import SwiftUI

struct ConnectionView: View {
    @Binding var serverURLString: String
    @Binding var isConnected: Bool
    
    @State private var inputURL: String = ""
    @State private var isTesting: Bool = false
    @State private var testMessage: String = ""
    @State private var isError: Bool = false
    @AppStorage("auto_connect_on_launch") private var autoConnect: Bool = true
    
    var body: some View {
        ZStack {
            Color(red: 0.03, green: 0.05, blue: 0.08).ignoresSafeArea()
            
            VStack(spacing: 24) {
                Spacer()
                
                // Brand Header
                VStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 18)
                            .fill(LinearGradient(colors: [Color(red: 0.01, green: 0.52, blue: 0.78), Color(red: 0.0, green: 0.87, blue: 0.78)], startPoint: .topLeading, endPoint: .bottomTrailing))
                            .frame(width: 64, height: 64)
                            .shadow(color: Color(red: 0.0, green: 0.87, blue: 0.78).opacity(0.35), radius: 12)
                        
                        Image(systemName: "terminal.fill")
                            .font(.system(size: 28, weight: .bold))
                            .foregroundColor(Color(red: 0.02, green: 0.08, blue: 0.12))
                    }
                    
                    Text("MovilClaw")
                        .font(.system(size: 26, weight: .bold))
                        .foregroundColor(.white)
                    
                    Text("Sandboxes kamikaze en tu bolsillo")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                }
                
                // Form Card
                VStack(alignment: .leading, spacing: 14) {
                    Text("DIRECCIÓN DEL SERVIDOR")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(Color(red: 0.0, green: 0.87, blue: 0.78))
                        .tracking(1)
                    
                    HStack {
                        Image(systemName: "network")
                            .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                        
                        TextField("http://192.168.1.XX:8788", text: $inputURL)
                            .autocapitalization(.none)
                            .disableAutocorrection(true)
                            .keyboardType(.URL)
                            .foregroundColor(.white)
                            .font(.system(size: 14, design: .monospaced))
                    }
                    .padding(12)
                    .background(Color(red: 0.06, green: 0.09, blue: 0.15))
                    .cornerRadius(10)
                    .overlay(RoundedRectangle(cornerRadius: 10).stroke(Color(red: 0.14, green: 0.20, blue: 0.30), lineWidth: 1))
                    
                    // Quick Preset Buttons
                    HStack(spacing: 8) {
                        Button(action: { inputURL = "http://127.0.0.1:8788" }) {
                            Text("Localhost")
                                .font(.system(size: 11, weight: .semibold))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(Color(red: 0.09, green: 0.13, blue: 0.21))
                                .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                                .cornerRadius(6)
                        }
                        
                        Button(action: {
                            if let base = inputURL.components(separatedBy: ":").first, base.contains("192.168") {
                                // keep
                            } else {
                                inputURL = "http://192.168.1.100:8788"
                            }
                        }) {
                            Text("LAN IP")
                                .font(.system(size: 11, weight: .semibold))
                                .padding(.horizontal, 10)
                                .padding(.vertical, 6)
                                .background(Color(red: 0.09, green: 0.13, blue: 0.21))
                                .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                                .cornerRadius(6)
                        }
                        
                        Spacer()
                    }
                    
                    Toggle(isOn: $autoConnect) {
                        Text("Conectar automáticamente al iniciar")
                            .font(.system(size: 12))
                            .foregroundColor(Color(red: 0.70, green: 0.76, blue: 0.84))
                    }
                    .toggleStyle(SwitchToggleStyle(tint: Color(red: 0.0, green: 0.87, blue: 0.78)))
                    .padding(.top, 4)
                    
                    // Status feedback
                    if !testMessage.isEmpty {
                        HStack(spacing: 6) {
                            Image(systemName: isError ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                                .foregroundColor(isError ? Color(red: 0.94, green: 0.27, blue: 0.27) : Color(red: 0.13, green: 0.77, blue: 0.37))
                            Text(testMessage)
                                .font(.system(size: 12))
                                .foregroundColor(isError ? Color(red: 0.94, green: 0.27, blue: 0.27) : Color(red: 0.13, green: 0.77, blue: 0.37))
                        }
                    }
                    
                    // Connect Button
                    Button(action: testAndConnect) {
                        HStack {
                            if isTesting {
                                ProgressView()
                                    .progressViewStyle(CircularProgressViewStyle(tint: .black))
                                    .padding(.trailing, 4)
                            }
                            Text(isTesting ? "Verificando..." : "Conectar al Servidor")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundColor(Color(red: 0.02, green: 0.08, blue: 0.12))
                        }
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 12)
                        .background(Color(red: 0.0, green: 0.87, blue: 0.78))
                        .cornerRadius(10)
                        .shadow(color: Color(red: 0.0, green: 0.87, blue: 0.78).opacity(0.3), radius: 8)
                    }
                    .disabled(isTesting || inputURL.trimmingCharacters(in: .whitespaces).isEmpty)
                }
                .padding(20)
                .background(Color(red: 0.07, green: 0.10, blue: 0.17))
                .cornerRadius(16)
                .overlay(RoundedRectangle(cornerRadius: 16).stroke(Color(red: 0.14, green: 0.20, blue: 0.30), lineWidth: 1))
                .padding(.horizontal, 20)
                
                // Instructions Helper
                VStack(alignment: .leading, spacing: 6) {
                    Text("💡 ¿Cómo obtener la IP de tu PC?")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.white)
                    Text("1. En tu computadora ejecuta: `ip route get 1` o `hostname -I`")
                    Text("2. En la terminal de MovilClaw arranca con: `HOST=0.0.0.0 npm start`")
                    Text("3. Asegúrate de que el celular y la PC estén en la misma red Wi-Fi.")
                }
                .font(.system(size: 11))
                .foregroundColor(Color(red: 0.58, green: 0.64, blue: 0.72))
                .padding(14)
                .background(Color(red: 0.05, green: 0.07, blue: 0.12))
                .cornerRadius(12)
                .padding(.horizontal, 20)
                
                Spacer()
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
        var clean = inputURL.trimmingCharacters(in: .whitespacesAndNewlines)
        if !clean.hasPrefix("http://") && !clean.hasPrefix("https://") {
            clean = "http://" + clean
        }
        guard let url = URL(string: clean + "/api/health") else {
            testMessage = "URL inválida"
            isError = true
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
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) {
                        isConnected = true
                    }
                } else {
                    isError = true
                    testMessage = "No se pudo conectar: \(error?.localizedDescription ?? "servidor no disponible")"
                }
            }
        }.resume()
    }
}
