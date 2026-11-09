import SwiftUI
import WebKit
import UniformTypeIdentifiers

/// The Port Side Quests screens, bundled inside the app so quests and the journal work ashore with no signal.
/// Pages are served from the app bundle at psq://localhost/… (a real web origin, so the journal database,
/// photos and sign-in are kept between launches). The screens ask this side for "share" (send text)
/// and "shareFile" (send the journal backup). Links to maps and websites open outside the app.
struct QuestView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> QuestController { QuestController() }
    func updateUIViewController(_ vc: QuestController, context: Context) {}
}

final class QuestController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    static let scheme = "psq"
    private var web: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 18/255, green: 59/255, blue: 71/255, alpha: 1)
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: Self.scheme)
        cfg.websiteDataStore = .default()
        cfg.userContentController.add(WeakHandler(self), name: "psq")
        web = WKWebView(frame: view.bounds, configuration: cfg)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = view.backgroundColor
        web.accessibilityIdentifier = "questWeb"
        view.addSubview(web)
        web.load(URLRequest(url: URL(string: "\(Self.scheme)://localhost/port-side-quests/index.html")!))
    }

    // MARK: Messages from the screens
    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let m = message.body as? [String: Any], let cmd = m["cmd"] as? String else { return }
        switch cmd {
        case "share":
            present(activity([m["text"] as? String ?? ""]), animated: true)
        case "shareFile":
            let name = (m["name"] as? String ?? "Port-Side-Quests-journal.json").replacingOccurrences(of: "/", with: "-")
            let url = FileManager.default.temporaryDirectory.appendingPathComponent(name)
            do { try Data((m["text"] as? String ?? "").utf8).write(to: url, options: .atomic); present(activity([url]), animated: true) }
            catch { alert("Could not prepare the backup file: \(error.localizedDescription)") }
        default: break
        }
    }
    private func activity(_ items: [Any]) -> UIActivityViewController {
        let a = UIActivityViewController(activityItems: items, applicationActivities: nil)
        a.popoverPresentationController?.sourceView = view
        a.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        return a
    }
    private func alert(_ text: String) {
        let a = UIAlertController(title: nil, message: text, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default)); present(a, animated: true)
    }

    // MARK: Links: app pages stay inside, everything else (maps, websites, email) opens outside
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        if url.scheme == Self.scheme || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { return decisionHandler(.allow) }
        UIApplication.shared.open(url)
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { UIApplication.shared.open(url) }   // target="_blank" links
        return nil
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    // MARK: alert() and confirm() from the screens
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler() })
        present(a, animated: true)
    }
    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "Cancel", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "OK", style: .default) { _ in completionHandler(true) })
        present(a, animated: true)
    }
}

/// Serves files from the app bundle for psq://localhost/<path>. Only files inside the bundle can be read.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    private let root = Bundle.main.resourceURL!.standardizedFileURL

    static func file(for url: URL, in root: URL) -> URL? {
        var rel = String(url.path.drop(while: { $0 == "/" }))   // note: URL.path drops a trailing "/"
        if rel.isEmpty { rel = "index.html" }
        var file = root.appendingPathComponent(rel).standardizedFileURL
        guard file.path.hasPrefix(root.path + "/") else { return nil }   // no ../ escapes
        var isDir: ObjCBool = false
        if FileManager.default.fileExists(atPath: file.path, isDirectory: &isDir) && isDir.boolValue {
            file = file.appendingPathComponent("index.html")
        }
        return file
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url, let file = Self.file(for: url, in: root), let data = try? Data(contentsOf: file) else {
            let resp = HTTPURLResponse(url: task.request.url ?? URL(string: "psq://localhost/")!, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"])!
            task.didReceive(resp); task.didReceive(Data("Not found".utf8)); task.didFinish(); return
        }
        let ext = file.pathExtension.lowercased()
        let mime: String = ["js": "text/javascript", "html": "text/html", "css": "text/css", "json": "application/json",
                            "webmanifest": "application/manifest+json", "png": "image/png", "svg": "image/svg+xml"][ext]
            ?? UTType(filenameExtension: ext)?.preferredMIMEType ?? "application/octet-stream"
        let resp = HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1",
                                   headerFields: ["Content-Type": mime + (mime.hasPrefix("text/") ? "; charset=utf-8" : ""), "Content-Length": String(data.count), "Cache-Control": "no-cache"])!
        task.didReceive(resp); task.didReceive(data); task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

/// Avoids a retain cycle between the web view and its message handler.
final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: WKScriptMessageHandler?
    init(_ t: WKScriptMessageHandler) { target = t }
    func userContentController(_ uc: WKUserContentController, didReceive m: WKScriptMessage) { target?.userContentController(uc, didReceive: m) }
}
