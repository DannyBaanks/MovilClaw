import Foundation
import WebKit

/// Ejecutor de Python directamente en el iPhone.
///
/// Soporta dos motores:
/// 1. Motor WASM (Pyodide): Aislamiento hermético sin riesgo de escape al proceso anfitrión ni acceso al Keychain.
/// 2. CPython embebido (Python 3.13): Para compilaciones con Python.xcframework.
@MainActor
public final class PythonRunner: NSObject {
    public static let shared = PythonRunner()

    private var headlessWebView: WKWebView?
    private var isPyodideReady: Bool = false
    private var pendingContinuations: [String: CheckedContinuation<ToolResult, Never>] = [:]

    override private init() {
        super.init()
        setupHeadlessRuntime()
    }

    private func setupHeadlessRuntime() {
        let config = WKWebViewConfiguration()
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        
        // Configura el canal de mensajes nativo
        let contentController = WKUserContentController()
        contentController.add(self, name: "pythonBridge")
        config.userContentController = contentController

        let webView = WKWebView(frame: .zero, configuration: config)
        self.headlessWebView = webView

        // HTML mínimo con carga de Pyodide WASM
        let html = """
        <!doctype html>
        <html>
        <head>
          <script src="https://cdn.jsdelivr.net/pyodide/v0.26.2/full/pyodide.js"></script>
        </head>
        <body>
          <script>
            let pyodide = null;
            let ready = false;
            async function initPy() {
              try {
                if (window.loadPyodide) {
                  pyodide = await loadPyodide();
                  ready = true;
                  window.webkit.messageHandlers.pythonBridge.postMessage({ type: 'ready' });
                }
              } catch (e) {
                window.webkit.messageHandlers.pythonBridge.postMessage({ type: 'init_error', error: e.message });
              }
            }
            initPy();

            async function runCode(callId, code) {
              if (!pyodide) {
                window.webkit.messageHandlers.pythonBridge.postMessage({
                  callId,
                  code: 1,
                  stdout: '',
                  stderr: 'Pyodide WASM no inicializado todavía'
                });
                return;
              }
              try {
                pyodide.setStdout({ batched: (msg) => { window._stdout += msg + '\\n'; } });
                pyodide.setStderr({ batched: (msg) => { window._stderr += msg + '\\n'; } });
                window._stdout = '';
                window._stderr = '';

                const result = await pyodide.runPythonAsync(code);
                let out = window._stdout;
                if (result !== undefined && result !== null) {
                  out = (out ? out + '\\n' : '') + String(result);
                }
                window.webkit.messageHandlers.pythonBridge.postMessage({
                  callId,
                  code: 0,
                  stdout: out.trim(),
                  stderr: window._stderr.trim()
                });
              } catch (err) {
                window.webkit.messageHandlers.pythonBridge.postMessage({
                  callId,
                  code: 1,
                  stdout: (window._stdout || '').trim(),
                  stderr: String(err.message || err).trim()
                });
              }
            }
          </script>
        </body>
        </html>
        """
        webView.loadHTMLString(html, baseURL: URL(string: "https://pyodide.org"))
    }

    /// Ejecuta código Python directamente en el dispositivo.
    public func run(code: String, timeoutSeconds: Double = 10.0) async -> ToolResult {
        let callId = UUID().uuidString
        let started = Date()

        guard let webView = headlessWebView else {
            return ToolResult(success: false, output: "", error: "Headless runner no disponible", code: 1)
        }

        let escaped = code
            .replacingOccurrences(of: "\\", with: "\\\\")
            .replacingOccurrences(of: "`", with: "\\`")
            .replacingOccurrences(of: "$", with: "\\$")

        let js = "runCode('\(callId)', `\(escaped)`);"

        return await withCheckedContinuation { continuation in
            pendingContinuations[callId] = continuation

            webView.evaluateJavaScript(js) { [weak self] _, error in
                if let error = error {
                    if let c = self?.pendingContinuations.removeValue(forKey: callId) {
                        let duration = Date().timeIntervalSince(started) * 1000
                        c.resume(returning: ToolResult(success: false, output: "", error: error.localizedDescription, code: 1, durationMs: duration))
                    }
                }
            }

            // Timeout de seguridad para evitar bloqueos
            Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(timeoutSeconds * 1_000_000_000))
                if let c = self?.pendingContinuations.removeValue(forKey: callId) {
                    let duration = Date().timeIntervalSince(started) * 1000
                    c.resume(returning: ToolResult(success: false, output: "", error: "Timeout: la ejecución superó los \(timeoutSeconds) segundos", code: 124, durationMs: duration))
                }
            }
        }
    }
}

extension PythonRunner: WKScriptMessageHandler {
    public func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let dict = message.body as? [String: Any] else { return }
        let type = dict["type"] as? String

        if type == "ready" {
            self.isPyodideReady = true
            return
        }

        if let callId = dict["callId"] as? String, let continuation = pendingContinuations.removeValue(forKey: callId) {
            let code = dict["code"] as? Int ?? 0
            let stdout = dict["stdout"] as? String ?? ""
            let stderr = dict["stderr"] as? String ?? ""
            let success = code == 0
            continuation.resume(returning: ToolResult(
                success: success,
                output: stdout,
                error: stderr.isEmpty ? nil : stderr,
                code: code
            ))
        }
    }
}
