import SwiftUI
import WebKit

struct WebViewContainer: UIViewRepresentable {
    let url: URL
    let onReload: (() -> Void)?
    
    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }
    
    func makeUIView(context: Context) -> WKWebView {
        let contentController = WKUserContentController()
        contentController.add(context.coordinator, name: "movilclawNative")
        
        let config = WKWebViewConfiguration()
        config.userContentController = contentController
        config.allowsInlineMediaPlayback = true
        config.preferences.setValue(true, forKey: "allowFileAccessFromFileURLs")
        
        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.03, green: 0.05, blue: 0.08, alpha: 1.0)
        webView.scrollView.backgroundColor = UIColor(red: 0.03, green: 0.05, blue: 0.08, alpha: 1.0)
        webView.allowsBackForwardNavigationGestures = true
        
        // Pull to refresh
        let refreshControl = UIRefreshControl()
        refreshControl.tintColor = UIColor(red: 0.0, green: 0.87, blue: 0.78, alpha: 1.0)
        refreshControl.addTarget(context.coordinator, action: #selector(Coordinator.handleRefresh(_:)), for: .valueChanged)
        webView.scrollView.refreshControl = refreshControl
        context.coordinator.refreshControl = refreshControl
        context.coordinator.webView = webView
        
        let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 15.0)
        webView.load(request)
        return webView
    }
    
    func updateUIView(_ uiView: WKWebView, context: Context) {
        if uiView.url != url && uiView.url == nil {
            let request = URLRequest(url: url)
            uiView.load(request)
        }
    }
    
    class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler {
        var parent: WebViewContainer
        weak var refreshControl: UIRefreshControl?
        weak var webView: WKWebView?
        
        init(_ parent: WebViewContainer) {
            self.parent = parent
        }
        
        @objc func handleRefresh(_ sender: UIRefreshControl) {
            sender.endRefreshing()
            parent.onReload?()
        }
        
        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            refreshControl?.endRefreshing()
        }
        
        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            refreshControl?.endRefreshing()
        }
        
        // MARK: - WKScriptMessageHandler (Puente JavaScript <-> Sandbox Local)
        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "movilclawNative",
                  let body = message.body as? [String: Any],
                  let action = body["action"] as? String else { return }
            
            let sandbox = LocalDeviceSandbox.shared
            let callbackId = body["callbackId"] as? String ?? ""
            
            Task { @MainActor in
                var response: [String: Any] = ["status": "ok"]
                do {
                    switch action {
                    case "ping":
                        response["pong"] = true
                    case "readFile":
                        let path = body["path"] as? String ?? ""
                        let content = try await sandbox.readFile(path: path)
                        response["content"] = content
                    case "writeFile":
                        let path = body["path"] as? String ?? ""
                        let content = body["content"] as? String ?? ""
                        _ = try await sandbox.writeFile(path: path, content: content)
                    case "runPython":
                        let code = body["code"] as? String ?? ""
                        let result = await PythonRunner.shared.run(code: code)
                        response["output"] = result.output
                        response["exitCode"] = result.code
                        response["error"] = result.error
                    default:
                        response = ["status": "error", "error": "Acción nativa no reconocida: \(action)"]
                    }
                } catch {
                    response = ["status": "error", "error": error.localizedDescription]
                }
                
                // Enviar respuesta a JavaScript si se proporcionó callbackId
                if !callbackId.isEmpty, let jsonData = try? JSONSerialization.data(withJSONObject: response),
                   let jsonString = String(data: jsonData, encoding: .utf8) {
                    let js = "window.__movilclawNativeCallback && window.__movilclawNativeCallback('\(callbackId)', \(jsonString));"
                    self.webView?.evaluateJavaScript(js, completionHandler: nil)
                }
            }
        }
    }
}
