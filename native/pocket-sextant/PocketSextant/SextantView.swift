import SwiftUI
import WebKit
import UniformTypeIdentifiers

/// The Pocket Sextant screens, bundled inside the app so sights, the almanac and fixes work with no signal.
/// Pages are served from the app bundle at ps://localhost/… (a real web origin, so saved settings and the
/// sight log are kept between launches). Links to maps, websites and the other Cruise Apps open in Safari.
struct SextantView: UIViewControllerRepresentable {
    func makeUIViewController(context: Context) -> SextantController { SextantController() }
    func updateUIViewController(_ vc: SextantController, context: Context) {}
}

final class SextantController: UIViewController, WKNavigationDelegate, WKUIDelegate {
    static let scheme = "ps"
    static let webHome = "https://dfwilley.github.io/Cruise-Apps/"
    private var web: WKWebView!

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor(red: 11/255, green: 29/255, blue: 51/255, alpha: 1)
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: Self.scheme)
        cfg.websiteDataStore = .default()
        // The live camera view plays inside the page, not full screen.
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        web = WKWebView(frame: view.bounds, configuration: cfg)
        web.autoresizingMask = [.flexibleWidth, .flexibleHeight]
        web.navigationDelegate = self
        web.uiDelegate = self
        web.isOpaque = false
        web.backgroundColor = view.backgroundColor
        web.accessibilityIdentifier = "sextantWeb"
        view.addSubview(web)
        web.load(URLRequest(url: URL(string: "\(Self.scheme)://localhost/pocket-sextant/index.html")!))
    }

    /// Where a link should go: nil keeps it inside the app, otherwise the address to open in Safari.
    /// Only Pocket Sextant's own pages stay inside; a link to another Cruise App opens that app's web version.
    static func outsideURL(for url: URL) -> URL? {
        if url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" { return nil }
        guard url.scheme == scheme else { return url }
        // URL.path drops a trailing "/", which would turn a folder link into a file link; the raw path keeps it.
        let raw = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? url.path
        let path = String(raw.drop(while: { $0 == "/" }))
        if path.hasPrefix("pocket-sextant/") || path == "pocket-sextant" { return nil }
        return URL(string: webHome + path)
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url else { return decisionHandler(.cancel) }
        // Scripts and data files load through the scheme handler, not here; this only sees page navigations.
        guard let outside = Self.outsideURL(for: url) else { return decisionHandler(.allow) }
        UIApplication.shared.open(outside)
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        // target="_blank" links: outside addresses open in Safari, the app's own pages open in place
        guard let url = action.request.url else { return nil }
        if let outside = Self.outsideURL(for: url) { UIApplication.shared.open(outside) } else { webView.load(action.request) }
        return nil
    }
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) { webView.reload() }

    // MARK: Camera and tilt sensor
    // iOS still shows its own Allow prompt the first time (using the wording in the app's settings);
    // these just stop the page from asking a second time on top of that.
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
                 type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(type == .camera ? .grant : .deny)   // camera only, never the microphone
    }
    func webView(_ webView: WKWebView, requestDeviceOrientationAndMotionPermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo,
                 decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(.grant)
    }

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

/// Serves files from the app bundle for ps://localhost/<path>. Only files inside the bundle can be read.
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
            let resp = HTTPURLResponse(url: task.request.url ?? URL(string: "ps://localhost/")!, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"])!
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
